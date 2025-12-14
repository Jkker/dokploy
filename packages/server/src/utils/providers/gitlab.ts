import { join } from "node:path";
import { paths } from "@dokploy/server/constants";
import type { apiGitlabTestConnection } from "@dokploy/server/db/schema";
import {
	findGitlabById,
	type Gitlab,
	updateGitlab,
} from "@dokploy/server/services/gitlab";
import type { InferResultType } from "@dokploy/server/types/with";
import { TRPCError } from "@trpc/server";

export const refreshGitlabToken = async (gitlabProviderId: string) => {
	const gitlabProvider = await findGitlabById(gitlabProviderId);
	const currentTime = Math.floor(Date.now() / 1000);

	const safetyMargin = 60;
	if (
		gitlabProvider.expiresAt &&
		currentTime + safetyMargin < gitlabProvider.expiresAt
	) {
		return;
	}

	const response = await fetch(`${gitlabProvider.gitlabUrl}/oauth/token`, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body: new URLSearchParams({
			grant_type: "refresh_token",
			refresh_token: gitlabProvider.refreshToken as string,
			client_id: gitlabProvider.applicationId as string,
			client_secret: gitlabProvider.secret as string,
		}),
	});

	if (!response.ok) {
		throw new Error(`Failed to refresh token: ${response.statusText}`);
	}

	const data = await response.json();

	const expiresAt = Math.floor(Date.now() / 1000) + data.expires_in;

	await updateGitlab(gitlabProviderId, {
		accessToken: data.access_token,
		refreshToken: data.refresh_token,
		expiresAt,
	});
	return data;
};

export const haveGitlabRequirements = (gitlabProvider: Gitlab) => {
	return !!(gitlabProvider?.accessToken && gitlabProvider?.refreshToken);
};

const getErrorCloneRequirements = (entity: {
	gitlabRepository?: string | null;
	gitlabOwner?: string | null;
	gitlabBranch?: string | null;
	gitlabPathNamespace?: string | null;
}) => {
	const reasons: string[] = [];
	const { gitlabBranch, gitlabOwner, gitlabRepository, gitlabPathNamespace } =
		entity;

	if (!gitlabRepository) reasons.push("1. Repository not assigned.");
	if (!gitlabOwner) reasons.push("2. Owner not specified.");
	if (!gitlabBranch) reasons.push("3. Branch not defined.");
	if (!gitlabPathNamespace) reasons.push("4. Path namespace not defined.");

	return reasons;
};

export type ApplicationWithGitlab = InferResultType<
	"applications",
	{ gitlab: true }
>;

export type ComposeWithGitlab = InferResultType<"compose", { gitlab: true }>;

export type GitlabInfo =
	| ApplicationWithGitlab["gitlab"]
	| ComposeWithGitlab["gitlab"];

const getGitlabRepoClone = (
	gitlab: GitlabInfo,
	gitlabPathNamespace: string | null,
) => {
	const repoClone = `${gitlab?.gitlabUrl.replace(/^https?:\/\//, "")}/${gitlabPathNamespace}.git`;
	return repoClone;
};

const getGitlabCloneUrl = (gitlab: GitlabInfo, repoClone: string) => {
	const isSecure = gitlab?.gitlabUrl.startsWith("https://");
	const cloneUrl = `http${isSecure ? "s" : ""}://oauth2:${gitlab?.accessToken}@${repoClone}`;
	return cloneUrl;
};

interface CloneGitlabRepository {
	appName: string;
	gitlabBranch: string | null;
	gitlabId: string | null;
	gitlabPathNamespace: string | null;
	enableSubmodules: boolean;
	serverId: string | null;
	type?: "application" | "compose";
}

export const cloneGitlabRepository = async ({
	type = "application",
	...entity
}: CloneGitlabRepository) => {
	let command = "set -e;";
	const {
		appName,
		gitlabBranch,
		gitlabId,
		gitlabPathNamespace,
		enableSubmodules,
		serverId,
	} = entity;
	const { COMPOSE_PATH, APPLICATIONS_PATH } = paths(!!serverId);

	if (!gitlabId) {
		command += `echo "Error: ❌ Gitlab Provider not found"; exit 1;`;
		return command;
	}

	await refreshGitlabToken(gitlabId);
	const gitlab = await findGitlabById(gitlabId);

	const requirements = getErrorCloneRequirements(entity);

	// Check if requirements are met
	if (requirements.length > 0) {
		command += `echo "❌ [ERROR] GitLab Repository configuration failed for application: ${appName}"; echo "Reasons:"; echo "${requirements.join("\n")}"; exit 1;`;
		return command;
	}

	const basePath = type === "compose" ? COMPOSE_PATH : APPLICATIONS_PATH;
	const outputPath = join(basePath, appName, "code");
	command += `rm -rf ${outputPath};`;
	command += `mkdir -p ${outputPath};`;
	const repoClone = getGitlabRepoClone(gitlab, gitlabPathNamespace);
	const cloneUrl = getGitlabCloneUrl(gitlab, repoClone);
	command += `echo "Cloning Repo ${repoClone} to ${outputPath}: ✅";`;
	command += `git clone --branch ${gitlabBranch} --depth 1 ${enableSubmodules ? "--recurse-submodules" : ""} ${cloneUrl} ${outputPath} --progress;`;
	return command;
};

export const getGitlabRepositories = async (gitlabId?: string) => {
	if (!gitlabId) {
		return [];
	}

	await refreshGitlabToken(gitlabId);

	const gitlabProvider = await findGitlabById(gitlabId);

	const allProjects = await validateGitlabProvider(gitlabProvider);

	const filteredRepos = allProjects.filter((repo: any) => {
		const { full_path, kind } = repo.namespace;
		const groupName = gitlabProvider.groupName?.toLowerCase();

		if (groupName) {
			return groupName
				.split(",")
				.some((name) =>
					full_path.toLowerCase().startsWith(name.trim().toLowerCase()),
				);
		}
		return kind === "user";
	});
	const mappedRepositories = filteredRepos.map((repo: any) => {
		return {
			id: repo.id,
			name: repo.name,
			url: repo.path_with_namespace,
			owner: {
				username: repo.namespace.path,
			},
		};
	});

	return mappedRepositories as {
		id: number;
		name: string;
		url: string;
		owner: {
			username: string;
		};
	}[];
};

export const getGitlabBranches = async (input: {
	id?: number;
	gitlabId?: string;
	owner: string;
	repo: string;
}) => {
	if (!input.gitlabId || !input.id || input.id === 0) {
		return [];
	}

	const gitlabProvider = await findGitlabById(input.gitlabId);

	const allBranches = [];
	let page = 1;
	const perPage = 100; // GitLab's max per page is 100

	while (true) {
		const branchesResponse = await fetch(
			`${gitlabProvider.gitlabUrl}/api/v4/projects/${input.id}/repository/branches?page=${page}&per_page=${perPage}`,
			{
				headers: {
					Authorization: `Bearer ${gitlabProvider.accessToken}`,
				},
			},
		);

		if (!branchesResponse.ok) {
			throw new Error(
				`Failed to fetch branches: ${branchesResponse.statusText}`,
			);
		}

		const branches = await branchesResponse.json();

		if (branches.length === 0) {
			break;
		}

		allBranches.push(...branches);
		page++;

		// Check if we've reached the total using headers (optional optimization)
		const total = branchesResponse.headers.get("x-total");
		if (total && allBranches.length >= Number.parseInt(total)) {
			break;
		}
	}

	return allBranches as {
		id: string;
		name: string;
		commit: {
			id: string;
		};
	}[];
};

export const testGitlabConnection = async (
	input: typeof apiGitlabTestConnection._type,
) => {
	const { gitlabId, groupName } = input;

	if (!gitlabId) {
		throw new Error("Gitlab provider not found");
	}

	await refreshGitlabToken(gitlabId);

	const gitlabProvider = await findGitlabById(gitlabId);

	const repositories = await validateGitlabProvider(gitlabProvider);

	const filteredRepos = repositories.filter((repo: any) => {
		const { full_path, kind } = repo.namespace;

		if (groupName) {
			return groupName
				.split(",")
				.some((name) =>
					full_path.toLowerCase().startsWith(name.trim().toLowerCase()),
				);
		}
		return kind === "user";
	});

	return filteredRepos.length;
};

export const getGitlabAccessLevelName = (accessLevel: number | null) => {
	if (accessLevel === null || accessLevel === undefined) return "none";
	if (accessLevel >= 50) return "owner";
	if (accessLevel >= 40) return "maintainer";
	if (accessLevel >= 30) return "developer";
	if (accessLevel >= 20) return "reporter";
	if (accessLevel >= 10) return "guest";
	return "none";
};

export const hasDeveloperOrHigherAccess = (accessLevel: number | null) => {
	return (accessLevel ?? 0) >= 30;
};

export const checkGitlabUserRepositoryPermissions = async (
	gitlabProvider: Gitlab,
	projectId: number | null,
	userId: number | null,
) => {
	if (!projectId || !userId) {
		return {
			hasWriteAccess: false,
			permission: null,
		};
	}
	try {
		await refreshGitlabToken(gitlabProvider.gitlabId);
		const provider = await findGitlabById(gitlabProvider.gitlabId);

		const response = await fetch(
			`${provider.gitlabUrl}/api/v4/projects/${projectId}/members/all/${userId}`,
			{
				headers: {
					Authorization: `Bearer ${provider.accessToken}`,
				},
			},
		);

		if (!response.ok) {
			return {
				hasWriteAccess: false,
				permission: null,
			};
		}

		const membership = await response.json();
		const accessLevel = membership.access_level as number | null;

		return {
			hasWriteAccess: hasDeveloperOrHigherAccess(accessLevel),
			permission: getGitlabAccessLevelName(accessLevel),
		};
	} catch (error) {
		console.warn(
			`Failed to validate GitLab permissions for user ${userId} in project ${projectId}`,
			error,
		);
		return {
			hasWriteAccess: false,
			permission: null,
		};
	}
};

const gitlabNoteHeaders = (provider: Gitlab) => ({
	Authorization: `Bearer ${provider.accessToken}`,
	"Content-Type": "application/json",
});

export const createMergeRequestNote = async (params: {
	gitlabId: string;
	projectId: number;
	mergeRequestIid: string | number;
	body: string;
}) => {
	const { gitlabId, projectId, mergeRequestIid, body } = params;
	await refreshGitlabToken(gitlabId);
	const provider = await findGitlabById(gitlabId);
	const response = await fetch(
		`${provider.gitlabUrl}/api/v4/projects/${projectId}/merge_requests/${mergeRequestIid}/notes`,
		{
			method: "POST",
			headers: gitlabNoteHeaders(provider),
			body: JSON.stringify({ body }),
		},
	);

	if (!response.ok) {
		throw new Error(`Failed to create GitLab MR note: ${response.statusText}`);
	}

	return response.json();
};

export const updateMergeRequestNote = async (params: {
	gitlabId: string;
	projectId: number;
	mergeRequestIid: string | number;
	noteId: number | string;
	body: string;
}) => {
	const { gitlabId, projectId, mergeRequestIid, body, noteId } = params;
	await refreshGitlabToken(gitlabId);
	const provider = await findGitlabById(gitlabId);
	const response = await fetch(
		`${provider.gitlabUrl}/api/v4/projects/${projectId}/merge_requests/${mergeRequestIid}/notes/${noteId}`,
		{
			method: "PUT",
			headers: gitlabNoteHeaders(provider),
			body: JSON.stringify({ body }),
		},
	);

	if (!response.ok) {
		throw new Error(`Failed to update GitLab MR note: ${response.statusText}`);
	}

	return response.json();
};

export const mergeRequestNoteExists = async (params: {
	gitlabId: string;
	projectId: number;
	mergeRequestIid: string | number;
	noteId: number | string;
}) => {
	const { gitlabId, projectId, mergeRequestIid, noteId } = params;
	await refreshGitlabToken(gitlabId);
	const provider = await findGitlabById(gitlabId);
	const response = await fetch(
		`${provider.gitlabUrl}/api/v4/projects/${projectId}/merge_requests/${mergeRequestIid}/notes/${noteId}`,
		{
			headers: {
				Authorization: `Bearer ${provider.accessToken}`,
			},
		},
	);

	return response.ok;
};

const GITLAB_SECURITY_MARKER =
	"🚨 Preview Deployment Blocked - Security Protection";

const getGitlabSecurityBlockedMessage = (
	mrAuthor: string,
	repositoryName: string,
	permission: string | null,
) => {
	return `### 🚨 Preview Deployment Blocked - Security Protection

**Your merge request was blocked from triggering preview deployments**

#### Why was this blocked?
- **User**: \`${mrAuthor}\`
- **Repository**: \`${repositoryName}\`
- **Permission Level**: \`${permission || "none"}\`
- **Required Level**: \`developer\`, \`maintainer\`, or \`owner\`

#### How to resolve this:

**Option 1: Get Project Access (Recommended)**
Ask a project maintainer to grant you at least **Developer** access.

**Option 2: Request Permission Override**
Ask a project administrator to disable the security check for this application if appropriate.

#### For Project Administrators:
To disable this security check (⚠️ **not recommended for public repositories**):
Enter the preview settings and disable the security check.

---
*This security measure protects against malicious code execution in preview deployments. Only trusted collaborators should trigger them.*
`;
};

export const createGitlabSecurityBlockedNote = async (params: {
	gitlabId: string;
	projectId: number;
	mergeRequestIid: number | string;
	mrAuthor: string;
	repositoryName: string;
	permission: string | null;
}) => {
	const { gitlabId, projectId, mergeRequestIid, mrAuthor, repositoryName } =
		params;
	await refreshGitlabToken(gitlabId);
	const provider = await findGitlabById(gitlabId);

	try {
		const existingNotesResponse = await fetch(
			`${provider.gitlabUrl}/api/v4/projects/${projectId}/merge_requests/${mergeRequestIid}/notes`,
			{
				headers: {
					Authorization: `Bearer ${provider.accessToken}`,
				},
			},
		);

		if (existingNotesResponse.ok) {
			const notes = (await existingNotesResponse.json()) as { body?: string }[];
			if (
				notes.some((note) => note.body?.includes(GITLAB_SECURITY_MARKER))
			) {
				return null;
			}
		}
	} catch (error) {
		console.warn(
			"Failed to check existing GitLab security notes, proceeding to create one",
			error,
		);
	}

	const body = getGitlabSecurityBlockedMessage(
		mrAuthor,
		repositoryName,
		params.permission,
	);

	return await createMergeRequestNote({
		gitlabId,
		projectId,
		mergeRequestIid,
		body,
	});
};

export const validateGitlabProvider = async (gitlabProvider: Gitlab) => {
	try {
		const allProjects = [];
		let page = 1;
		const perPage = 100; // GitLab's max per page is 100

		while (true) {
			const response = await fetch(
				`${gitlabProvider.gitlabUrl}/api/v4/projects?membership=true&page=${page}&per_page=${perPage}`,
				{
					headers: {
						Authorization: `Bearer ${gitlabProvider.accessToken}`,
					},
				},
			);

			if (!response.ok) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: `Failed to fetch repositories: ${response.statusText}`,
				});
			}

			const projects = await response.json();

			if (projects.length === 0) {
				break;
			}

			allProjects.push(...projects);
			page++;

			const total = response.headers.get("x-total");
			if (total && allProjects.length >= Number.parseInt(total)) {
				break;
			}
		}

		return allProjects;
	} catch (error) {
		throw error;
	}
};
