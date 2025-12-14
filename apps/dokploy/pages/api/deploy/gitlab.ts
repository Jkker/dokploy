import {
	checkGitlabUserRepositoryPermissions,
	createGitlabSecurityBlockedNote,
	createPreviewDeployment,
	findPreviewDeploymentByApplicationId,
	findPreviewDeploymentsByPullRequestId,
	IS_CLOUD,
	removePreviewDeployment,
} from "@dokploy/server";
import { and, eq } from "drizzle-orm";
import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "@/server/db";
import { applications } from "@/server/db/schema";
import type { DeploymentJob } from "@/server/queues/queue-types";
import { myQueue } from "@/server/queues/queueSetup";
import { deploy } from "@/server/utils/deploy";

export default async function handler(
	req: NextApiRequest,
	res: NextApiResponse,
) {
	if (req.headers["x-gitlab-event"] !== "Merge Request Hook") {
		res
			.status(400)
			.json({ message: "We only accept merge request hook events" });
		return;
	}

	const gitlabBody = req.body;
	const projectIdRaw =
		gitlabBody?.project?.id ||
		gitlabBody?.project_id ||
		gitlabBody?.object_attributes?.target_project_id;
	const projectId = Number(projectIdRaw);
	const pathNamespace = gitlabBody?.project?.path_with_namespace;

	if (!projectId || Number.isNaN(projectId)) {
		res.status(400).json({ message: "GitLab project not found in payload" });
		return;
	}

	const apps = await db.query.applications.findMany({
		where: and(
			eq(applications.sourceType, "gitlab"),
			eq(applications.gitlabProjectId, projectId),
			eq(applications.isPreviewDeploymentsActive, true),
		),
		with: {
			previewDeployments: true,
			gitlab: true,
		},
	});

	if (apps.length === 0 || !apps[0].gitlab) {
		res.status(200).json({ message: "No GitLab apps configured" });
		return;
	}

	const gitlabProvider = apps[0].gitlab;
	const hookToken = Array.isArray(req.headers["x-gitlab-token"])
		? req.headers["x-gitlab-token"][0]
		: req.headers["x-gitlab-token"];

	if (gitlabProvider.secret && gitlabProvider.secret !== hookToken) {
		res.status(401).json({ message: "Unauthorized" });
		return;
	}

	const action = gitlabBody?.object_attributes?.action;
	const state = gitlabBody?.object_attributes?.state;
	const mergeRequestId = `${gitlabBody?.object_attributes?.id || ""}`;

	if (
		action === "merge" ||
		action === "close" ||
		state === "merged" ||
		state === "closed"
	) {
		const previewDeploymentResult =
			await findPreviewDeploymentsByPullRequestId(mergeRequestId);

		if (previewDeploymentResult.length > 0) {
			for (const previewDeployment of previewDeploymentResult) {
				try {
					await removePreviewDeployment(previewDeployment.previewDeploymentId);
				} catch (error) {
					console.log(error);
				}
			}
		}
		res.status(200).json({ message: "Preview Deployment Closed" });
		return;
	}

	if (!["open", "reopen", "update"].includes(action)) {
		res.status(400).json({ message: "No Actions matched" });
		return;
	}

	const repositoryName =
		gitlabBody?.project?.path_with_namespace ||
		gitlabBody?.project?.path ||
		gitlabBody?.project?.name;
	const commitSha = gitlabBody?.object_attributes?.last_commit?.id;
	const targetBranch = gitlabBody?.object_attributes?.target_branch || "";
	const sourceBranch = gitlabBody?.object_attributes?.source_branch || "";
	const mrAuthor = gitlabBody?.user?.username;
	const mrAuthorId = Number(gitlabBody?.user?.id) || null;
	const labels =
		(gitlabBody?.labels as { title?: string; name?: string }[]) ||
		(gitlabBody?.object_attributes?.labels as {
			title?: string;
			name?: string;
		}[]) ||
		[];

	if (!gitlabBody?.object_attributes?.iid || !sourceBranch) {
		res.status(400).json({ message: "Missing merge request data" });
		return;
	}

	const filteredApps = apps.filter((app) => {
		if (app.gitlabBranch && targetBranch && app.gitlabBranch !== targetBranch) {
			return false;
		}

		if (pathNamespace && app.gitlabPathNamespace) {
			return app.gitlabPathNamespace === pathNamespace;
		}

		return true;
	});

	const secureApps: typeof filteredApps = [];
	const blockedApps: string[] = [];
	let userPermission: string | null = null;

	for (const app of filteredApps) {
		if (app.previewRequireCollaboratorPermissions !== false) {
			const { hasWriteAccess, permission } =
				await checkGitlabUserRepositoryPermissions(
					app.gitlab,
					projectId,
					mrAuthorId,
				);

			userPermission = permission;
			if (!hasWriteAccess) {
				blockedApps.push(app.name);
				continue;
			}
		}
		secureApps.push(app);
	}

	if (blockedApps.length > 0 && mrAuthor) {
		await createGitlabSecurityBlockedNote({
			gitlabId: gitlabProvider.gitlabId,
			projectId,
			mergeRequestIid: gitlabBody?.object_attributes?.iid,
			mrAuthor,
			repositoryName: repositoryName || "",
			permission: userPermission,
		});
	}

	for (const app of secureApps) {
		if (app?.previewLabels && app?.previewLabels?.length > 0) {
			let hasLabel = false;
			for (const label of labels) {
				const labelName = label?.title || label?.name;
				if (labelName && app.previewLabels?.includes(labelName)) {
					hasLabel = true;
					break;
				}
			}
			if (!hasLabel) continue;
		}

		const previewLimit = app?.previewLimit || 0;
		if (app?.previewDeployments?.length > previewLimit) {
			continue;
		}

		const previewDeploymentResult = await findPreviewDeploymentByApplicationId(
			app.applicationId,
			mergeRequestId,
		);

		let previewDeploymentId =
			previewDeploymentResult?.previewDeploymentId || "";

		if (!previewDeploymentResult) {
			const previewDeployment = await createPreviewDeployment({
				applicationId: app.applicationId as string,
				branch: sourceBranch,
				pullRequestId: mergeRequestId,
				pullRequestNumber: `${gitlabBody?.object_attributes?.iid}`,
				pullRequestTitle: gitlabBody?.object_attributes?.title,
				pullRequestURL: gitlabBody?.object_attributes?.url,
			});
			previewDeploymentId = previewDeployment.previewDeploymentId;
		}

		const jobData: DeploymentJob = {
			applicationId: app.applicationId as string,
			titleLog: "Preview Deployment",
			descriptionLog: `Hash: ${commitSha}`,
			type: "deploy",
			applicationType: "application-preview",
			server: !!app.serverId,
			previewDeploymentId,
		};

		if (IS_CLOUD && app.serverId) {
			jobData.serverId = app.serverId;
			await deploy(jobData);
			continue;
		}
		await myQueue.add(
			"deployments",
			{ ...jobData },
			{
				removeOnComplete: true,
				removeOnFail: true,
			},
		);
	}

	return res.status(200).json({ message: "Apps Deployed" });
}
