# Implementation Plan: GitLab Preview Deployments

**Related RFC:** [RFC-GITLAB-PREVIEW-DEPLOYMENTS.md](./RFC-GITLAB-PREVIEW-DEPLOYMENTS.md)  
**Status:** Planning  
**Created:** 2025-12-06

## Overview

This document provides a detailed, actionable implementation plan for adding GitLab preview deployment support to Dokploy. The plan is divided into phases, with each phase containing specific tasks, estimated effort, and acceptance criteria.

## Timeline Summary

| Phase | Duration | Start | End | Key Deliverables |
|-------|----------|-------|-----|------------------|
| Phase 1: Core Infrastructure | 2 weeks | Week 1 | Week 2 | Database schema, GitLab API service, webhook endpoint |
| Phase 2: MR Lifecycle Handlers | 2 weeks | Week 3 | Week 4 | Complete MR lifecycle, comment templates |
| Phase 3: UI & Configuration | 2 weeks | Week 5 | Week 6 | GitLab provider UI, preview dashboard updates |
| Phase 4: Testing & Documentation | 2 weeks | Week 7 | Week 8 | E2E tests, documentation, security audit |
| Phase 5: Advanced Features (Optional) | 2 weeks | Week 9 | Week 10 | Group webhooks, approvals, monitoring |

**Total Timeline:** 8-10 weeks (depending on optional Phase 5)

## Prerequisites

### Development Environment

- [ ] Node.js 18+ installed
- [ ] pnpm 8+ installed
- [ ] Docker and Docker Compose installed
- [ ] PostgreSQL database (local or containerized)
- [ ] Access to GitLab.com or self-hosted GitLab instance
- [ ] GitLab OAuth application created (for testing)

### Knowledge Requirements

- TypeScript/JavaScript
- Next.js and React
- tRPC
- PostgreSQL and Drizzle ORM
- Docker and container orchestration
- GitLab API and webhooks
- OAuth2 authentication flow

### Tools & Resources

- GitLab test account with test repositories
- Webhook testing tool (e.g., ngrok, webhook.site)
- API testing tool (e.g., Postman, Insomnia)
- Code editor with TypeScript support

## Phase 1: Core Infrastructure (Weeks 1-2)

### Goal
Establish the foundational components for GitLab preview deployments, including database schema, API services, and webhook endpoint.

---

### Task 1.1: Database Schema Migrations

**Estimated Effort:** 2 days  
**Assignee:** Backend Developer  
**Priority:** P0

#### Subtasks

1. **Create Migration Files**
   - [ ] Create new migration file in `packages/server/src/db/migrations/`
   - [ ] Add `provider` field to `preview_deployments` table
   - [ ] Add GitLab-specific fields to `preview_deployments`:
     - `merge_request_id` (TEXT)
     - `merge_request_iid` (TEXT)
     - `merge_request_url` (TEXT)
     - `merge_request_title` (TEXT)
     - `merge_request_comment_id` (TEXT)
     - `gitlab_project_id` (INTEGER)
   - [ ] Make GitHub fields nullable (backward compatibility)
   - [ ] Add `webhook_secret` field to `gitlab` table
   - [ ] Add GitLab fields to `applications` table:
     - `gitlab_id` (TEXT, FK to gitlab)
     - `gitlab_project_id` (INTEGER)
     - `gitlab_path_namespace` (TEXT)
   - [ ] Add GitLab fields to `compose` table (same as applications)

2. **Update TypeScript Schemas**
   - [ ] Update `packages/server/src/db/schema/preview-deployments.ts`
   - [ ] Update `packages/server/src/db/schema/application.ts`
   - [ ] Update `packages/server/src/db/schema/compose.ts`
   - [ ] Update `packages/server/src/db/schema/gitlab.ts`
   - [ ] Update Zod validation schemas

3. **Test Migrations**
   - [ ] Test migration on fresh database
   - [ ] Test migration on database with existing data
   - [ ] Verify rollback works correctly
   - [ ] Test with both GitHub and GitLab data

**Files to Modify:**
- `packages/server/src/db/migrations/XXXX_add_gitlab_preview_support.ts` (new)
- `packages/server/src/db/schema/preview-deployments.ts`
- `packages/server/src/db/schema/application.ts`
- `packages/server/src/db/schema/compose.ts`
- `packages/server/src/db/schema/gitlab.ts`

**Acceptance Criteria:**
- [ ] Migration runs successfully on clean database
- [ ] Migration preserves existing GitHub preview deployments
- [ ] All new fields have appropriate types and constraints
- [ ] TypeScript types are generated correctly
- [ ] Rollback script works without data loss

---

### Task 1.2: GitLab API Service Enhancement

**Estimated Effort:** 3 days  
**Assignee:** Backend Developer  
**Priority:** P0

#### Subtasks

1. **Permission Checking**
   - [ ] Implement `checkGitlabUserPermissions()` function
   - [ ] Support both direct and inherited membership
   - [ ] Return access level and boolean flag
   - [ ] Handle API errors gracefully
   - [ ] Add retry logic for transient failures

2. **MR Comment Management**
   - [ ] Implement `createGitlabMRComment()` function
   - [ ] Implement `updateGitlabMRComment()` function
   - [ ] Implement `deleteGitlabMRComment()` function (optional)
   - [ ] Handle API rate limits
   - [ ] Add comment ID tracking

3. **Repository Cloning**
   - [ ] Implement `cloneGitlabRepositoryForPreview()` function
   - [ ] Build authenticated clone URL with OAuth token
   - [ ] Support custom GitLab domains (self-hosted)
   - [ ] Handle submodules
   - [ ] Add progress logging

4. **Helper Functions**
   - [ ] Implement `fetchGitlabMRDetails()` to get MR info from API
   - [ ] Implement `findGitlabByWebhookToken()` for webhook verification
   - [ ] Implement `generateWebhookSecret()` for token generation
   - [ ] Add `getGitlabAccessLevelName()` to convert numeric level to string

5. **Unit Tests**
   - [ ] Test permission checking with various access levels (10, 20, 30, 40, 50)
   - [ ] Test token refresh logic
   - [ ] Test comment creation and updates
   - [ ] Test error handling (401, 403, 404, 500)
   - [ ] Mock GitLab API responses

**Files to Modify:**
- `packages/server/src/utils/providers/gitlab.ts` (enhance)
- `packages/server/src/utils/providers/gitlab.test.ts` (new)
- `packages/server/src/services/gitlab.ts` (enhance)

**Code Example:**
```typescript
// packages/server/src/utils/providers/gitlab.ts

export async function checkGitlabUserPermissions(
  gitlabProvider: Gitlab,
  projectId: number,
  userId: number,
  minimumAccessLevel: number = 30
): Promise<{ hasAccess: boolean; accessLevel: number | null }> {
  await refreshGitlabToken(gitlabProvider.gitlabId);
  
  // Try direct membership first
  let response = await fetch(
    `${gitlabProvider.gitlabUrl}/api/v4/projects/${projectId}/members/${userId}`,
    {
      headers: {
        Authorization: `Bearer ${gitlabProvider.accessToken}`,
      },
    }
  );
  
  // If not found, try inherited membership
  if (!response.ok && response.status === 404) {
    response = await fetch(
      `${gitlabProvider.gitlabUrl}/api/v4/projects/${projectId}/members/all/${userId}`,
      {
        headers: {
          Authorization: `Bearer ${gitlabProvider.accessToken}`,
        },
      }
    );
  }
  
  if (!response.ok) {
    return { hasAccess: false, accessLevel: null };
  }
  
  const member = await response.json();
  return {
    hasAccess: member.access_level >= minimumAccessLevel,
    accessLevel: member.access_level
  };
}

export async function createGitlabMRComment(
  gitlabProvider: Gitlab,
  projectId: number,
  mergeRequestIid: number,
  body: string
): Promise<{ id: number; body: string }> {
  await refreshGitlabToken(gitlabProvider.gitlabId);
  
  const response = await fetch(
    `${gitlabProvider.gitlabUrl}/api/v4/projects/${projectId}/merge_requests/${mergeRequestIid}/notes`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${gitlabProvider.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ body }),
    }
  );
  
  if (!response.ok) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Failed to create MR comment: ${response.statusText}`,
    });
  }
  
  return response.json();
}
```

**Acceptance Criteria:**
- [ ] All functions are implemented with proper error handling
- [ ] Token refresh happens automatically
- [ ] API responses are correctly parsed
- [ ] Unit tests pass with >80% coverage
- [ ] Functions work with both GitLab.com and self-hosted

---

### Task 1.3: Webhook Endpoint Implementation

**Estimated Effort:** 3 days  
**Assignee:** Backend Developer  
**Priority:** P0

#### Subtasks

1. **Create Webhook Handler**
   - [ ] Create `/apps/dokploy/pages/api/providers/gitlab/webhook.ts`
   - [ ] Parse `X-Gitlab-Token` header
   - [ ] Find GitLab provider by webhook token
   - [ ] Verify webhook signature (constant-time comparison)
   - [ ] Parse webhook payload
   - [ ] Extract event type and action

2. **Event Routing**
   - [ ] Route `merge_request` events to handler
   - [ ] Ignore other event types (push, issues, etc.) for now
   - [ ] Handle `ping` events (return 200 OK)
   - [ ] Log all incoming events

3. **Error Handling**
   - [ ] Return 401 for invalid tokens
   - [ ] Return 400 for invalid payloads
   - [ ] Return 500 for server errors
   - [ ] Log errors with context
   - [ ] Send error notifications (optional)

4. **Rate Limiting**
   - [ ] Add rate limiting middleware (100 req/min per IP)
   - [ ] Return 429 for rate limit exceeded
   - [ ] Whitelist known GitLab IPs (optional)

5. **Integration Tests**
   - [ ] Test with valid webhook payload
   - [ ] Test with invalid token
   - [ ] Test with malformed payload
   - [ ] Test rate limiting
   - [ ] Test with different event types

**Files to Create:**
- `apps/dokploy/pages/api/providers/gitlab/webhook.ts`

**Code Example:**
```typescript
// apps/dokploy/pages/api/providers/gitlab/webhook.ts

import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "@/server/db";
import { gitlab } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import crypto from "crypto";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end(`Method ${req.method} not allowed`);
  }

  // 1. Extract and verify token
  const receivedToken = req.headers["x-gitlab-token"];
  if (!receivedToken || typeof receivedToken !== "string") {
    return res.status(401).json({ message: "Missing or invalid token" });
  }

  // Find GitLab provider by webhook secret
  const gitlabProvider = await db.query.gitlab.findFirst({
    where: eq(gitlab.webhookSecret, receivedToken),
  });

  if (!gitlabProvider) {
    console.warn("Webhook received with invalid token");
    return res.status(401).json({ message: "Invalid webhook token" });
  }

  // 2. Parse event
  const event = req.body;
  const eventType = event.object_kind;
  const eventAction = event.object_attributes?.action;

  console.log(`GitLab webhook: ${eventType} - ${eventAction}`);

  // 3. Handle ping event
  if (req.headers["x-gitlab-event"] === "ping") {
    return res.status(200).json({ message: "Pong" });
  }

  // 4. Route to appropriate handler
  if (eventType === "merge_request") {
    try {
      await handleMergeRequestEvent(event, eventAction, gitlabProvider);
      return res.status(200).json({ message: "Webhook processed" });
    } catch (error) {
      console.error("Error processing merge request event:", error);
      return res.status(500).json({ 
        message: "Error processing webhook",
        error: error.message 
      });
    }
  }

  // 5. Unknown event type
  return res.status(400).json({ 
    message: `Unsupported event type: ${eventType}` 
  });
}

async function handleMergeRequestEvent(
  event: any,
  action: string,
  gitlabProvider: any
) {
  // To be implemented in Phase 2
  console.log("MR event received:", action);
}
```

**Acceptance Criteria:**
- [ ] Webhook endpoint accepts POST requests
- [ ] Token verification works correctly
- [ ] Invalid tokens are rejected with 401
- [ ] Events are routed to appropriate handlers
- [ ] Rate limiting prevents abuse
- [ ] Integration tests pass

---

### Task 1.4: Webhook Secret Management

**Estimated Effort:** 1 day  
**Assignee:** Backend Developer  
**Priority:** P0

#### Subtasks

1. **Generate Webhook Secrets**
   - [ ] Add function to generate cryptographically secure tokens
   - [ ] Use `crypto.randomBytes(32)` or equivalent
   - [ ] Store in database (encrypted if possible)

2. **Update GitLab Provider Service**
   - [ ] Modify `createGitlab()` to generate webhook secret
   - [ ] Add API endpoint to regenerate webhook secret
   - [ ] Display webhook URL and secret in UI

3. **Security**
   - [ ] Ensure secrets are not logged
   - [ ] Redact secrets in API responses
   - [ ] Add encryption at rest (optional, if not already done)

**Files to Modify:**
- `packages/server/src/services/gitlab.ts`
- `apps/dokploy/server/api/routers/gitlab.ts`

**Acceptance Criteria:**
- [ ] Webhook secrets are generated securely
- [ ] Secrets are stored safely
- [ ] Secrets can be regenerated
- [ ] Secrets are not exposed in logs or API responses

---

## Phase 2: MR Lifecycle Handlers (Weeks 3-4)

### Goal
Implement complete merge request lifecycle handling, including creation, updates, and cleanup of preview deployments.

---

### Task 2.1: MR Open/Update Handler

**Estimated Effort:** 4 days  
**Assignee:** Backend Developer  
**Priority:** P0

#### Subtasks

1. **Find Configured Applications**
   - [ ] Query applications with matching GitLab provider
   - [ ] Filter by project ID and target branch
   - [ ] Filter by `isPreviewDeploymentsActive` flag

2. **Permission Validation**
   - [ ] Call `checkGitlabUserPermissions()` for MR author
   - [ ] Check if user has Developer (30) or higher access
   - [ ] Skip check if `previewRequireCollaboratorPermissions` is false
   - [ ] Post security comment if blocked

3. **Label Filtering**
   - [ ] Check if MR has required labels (if configured)
   - [ ] Skip deployment if labels don't match

4. **Preview Limit Check**
   - [ ] Count existing previews for application
   - [ ] Skip if limit reached

5. **Create or Update Preview**
   - [ ] Check if preview already exists for MR ID
   - [ ] Create new preview if not exists
   - [ ] Generate unique app name (`preview-{appName}-{random}`)
   - [ ] Generate wildcard domain
   - [ ] Create domain record
   - [ ] Post initial MR comment

6. **Queue Deployment**
   - [ ] Create deployment job with preview ID
   - [ ] Add to BullMQ queue
   - [ ] Handle deployment status updates

**Files to Create/Modify:**
- `apps/dokploy/pages/api/providers/gitlab/webhook.ts` (enhance)
- `packages/server/src/services/gitlab-preview-deployment.ts` (new)

**Code Example:**
```typescript
// packages/server/src/services/gitlab-preview-deployment.ts

import { db } from "@dokploy/server/db";
import { applications, previewDeployments } from "@dokploy/server/db/schema";
import { eq, and } from "drizzle-orm";
import { 
  checkGitlabUserPermissions, 
  createGitlabMRComment,
  updateGitlabMRComment 
} from "../utils/providers/gitlab";
import { createPreviewDeployment } from "./preview-deployment";
import { myQueue } from "../queues/queueSetup";

export async function handleMergeRequestOpenOrUpdate(
  event: GitLabMREvent,
  gitlabProvider: Gitlab
) {
  const { project, object_attributes, user, labels } = event;
  const mrId = object_attributes.id.toString();
  const mrIid = object_attributes.iid;
  const sourceBranch = object_attributes.source_branch;
  const targetBranch = object_attributes.target_branch;
  const commitSha = object_attributes.last_commit.id;

  // 1. Find applications for this repo and branch
  const apps = await db.query.applications.findMany({
    where: and(
      eq(applications.gitlabId, gitlabProvider.gitlabId),
      eq(applications.gitlabProjectId, project.id),
      eq(applications.branch, targetBranch),
      eq(applications.isPreviewDeploymentsActive, true)
    ),
    with: {
      previewDeployments: true,
      gitlab: true,
    }
  });

  for (const app of apps) {
    try {
      // 2. Security: Check user permissions
      if (app.previewRequireCollaboratorPermissions) {
        const { hasAccess, accessLevel } = await checkGitlabUserPermissions(
          gitlabProvider,
          project.id,
          user.id,
          30 // Developer minimum
        );

        if (!hasAccess) {
          console.warn(
            `🚨 SECURITY: Blocked preview deployment for ${app.name} from user ${user.username} (access level: ${accessLevel})`
          );
          
          // Post security comment
          await postGitlabSecurityBlockedComment({
            gitlabProvider,
            projectId: project.id,
            mergeRequestIid: mrIid,
            username: user.username,
            accessLevel,
          });
          
          continue; // Skip this app
        }

        console.log(
          `✅ SECURITY: Authorized preview deployment for ${app.name} from user ${user.username} (access level: ${accessLevel})`
        );
      }

      // 3. Check label requirements
      if (app.previewLabels && app.previewLabels.length > 0) {
        const hasRequiredLabel = labels.some((label: any) =>
          app.previewLabels.includes(label.title)
        );
        if (!hasRequiredLabel) {
          console.log(`Skipping ${app.name}: required labels not present`);
          continue;
        }
      }

      // 4. Check preview limit
      const activePreviewCount = app.previewDeployments.length;
      if (activePreviewCount >= (app.previewLimit || 3)) {
        console.log(`Skipping ${app.name}: preview limit reached (${activePreviewCount}/${app.previewLimit})`);
        continue;
      }

      // 5. Find or create preview deployment
      let preview = await db.query.previewDeployments.findFirst({
        where: and(
          eq(previewDeployments.applicationId, app.applicationId),
          eq(previewDeployments.mergeRequestId, mrId),
          eq(previewDeployments.provider, "gitlab")
        ),
      });

      if (!preview) {
        // Generate domain
        const appName = `preview-${app.appName}-${generatePassword(6)}`;
        const domain = await generateWildcardDomain(
          app.previewWildcard || "*.traefik.me",
          appName,
          app.server?.ipAddress || "",
          app.environment.project.organizationId
        );

        // Post initial comment
        const comment = await createGitlabMRComment(
          gitlabProvider,
          project.id,
          mrIid,
          getGitlabMRComment(app.name, "initializing", `${app.previewHttps ? "https" : "http"}://${domain}`)
        );

        // Create preview record
        preview = await db.insert(previewDeployments).values({
          provider: "gitlab",
          applicationId: app.applicationId,
          branch: sourceBranch,
          mergeRequestId: mrId,
          mergeRequestIid: mrIid.toString(),
          mergeRequestUrl: object_attributes.url,
          mergeRequestTitle: object_attributes.title,
          mergeRequestCommentId: comment.id.toString(),
          gitlabProjectId: project.id,
          appName,
          previewStatus: "idle",
        }).returning().then(rows => rows[0]);

        // Create domain
        const newDomain = await createDomain({
          host: domain,
          path: app.previewPath || "/",
          port: app.previewPort || 3000,
          https: app.previewHttps || false,
          certificateType: app.previewCertificateType || "none",
          domainType: "preview",
          previewDeploymentId: preview.previewDeploymentId,
        });

        await db.update(previewDeployments)
          .set({ domainId: newDomain.domainId })
          .where(eq(previewDeployments.previewDeploymentId, preview.previewDeploymentId));
      } else {
        // Update existing comment to "building"
        await updateGitlabMRComment(
          gitlabProvider,
          project.id,
          mrIid,
          parseInt(preview.mergeRequestCommentId),
          getGitlabMRComment(app.name, "running", preview.domain.host)
        );
      }

      // 6. Queue deployment job
      const jobData = {
        applicationId: app.applicationId,
        previewDeploymentId: preview.previewDeploymentId,
        titleLog: "Preview Deployment",
        descriptionLog: `Commit: ${commitSha.substring(0, 7)}`,
        type: "deploy",
        applicationType: "application-preview",
        server: !!app.serverId,
      };

      await myQueue.add("deployments", jobData, {
        removeOnComplete: true,
        removeOnFail: true,
      });

      console.log(`✅ Queued preview deployment for ${app.name} (MR !${mrIid})`);
    } catch (error) {
      console.error(`Error processing app ${app.name}:`, error);
      // Continue with other apps
    }
  }
}
```

**Acceptance Criteria:**
- [ ] Applications are found based on GitLab config
- [ ] Permission validation works for Developer, Maintainer, Owner
- [ ] Permission validation blocks Guest and Reporter
- [ ] Security comment is posted when blocked
- [ ] Label filtering works correctly
- [ ] Preview limit is enforced
- [ ] Preview deployments are created with correct data
- [ ] Deployment jobs are queued
- [ ] MR comments are posted and updated

---

### Task 2.2: MR Close/Merge Handler

**Estimated Effort:** 2 days  
**Assignee:** Backend Developer  
**Priority:** P0

#### Subtasks

1. **Find Previews by MR ID**
   - [ ] Query previews by `mergeRequestId`
   - [ ] Support multiple previews per MR (if multiple apps configured)

2. **Cleanup Previews**
   - [ ] Call `removePreviewDeployment()` for each preview
   - [ ] Stop and remove containers
   - [ ] Delete volumes
   - [ ] Remove Traefik configuration
   - [ ] Delete domain records
   - [ ] Delete database records

3. **Update MR Comment**
   - [ ] Update comment to show "Preview Removed"
   - [ ] Add cleanup timestamp

4. **Error Handling**
   - [ ] Continue cleanup even if one preview fails
   - [ ] Log errors for investigation

**Files to Modify:**
- `apps/dokploy/pages/api/providers/gitlab/webhook.ts`
- `packages/server/src/services/gitlab-preview-deployment.ts`

**Code Example:**
```typescript
export async function handleMergeRequestClose(
  event: GitLabMREvent,
  gitlabProvider: Gitlab
) {
  const { object_attributes } = event;
  const mrId = object_attributes.id.toString();

  // Find all previews for this MR
  const previews = await db.query.previewDeployments.findMany({
    where: and(
      eq(previewDeployments.mergeRequestId, mrId),
      eq(previewDeployments.provider, "gitlab")
    ),
    with: {
      application: true,
      domain: true,
    }
  });

  for (const preview of previews) {
    try {
      // Cleanup preview
      await removePreviewDeployment(preview.previewDeploymentId);

      // Update MR comment
      await updateGitlabMRComment(
        gitlabProvider,
        preview.gitlabProjectId,
        parseInt(preview.mergeRequestIid),
        parseInt(preview.mergeRequestCommentId),
        getGitlabCleanupMessage(preview.appName)
      );

      console.log(`✅ Cleaned up preview ${preview.appName} for MR !${preview.mergeRequestIid}`);
    } catch (error) {
      console.error(`Error cleaning up preview ${preview.previewDeploymentId}:`, error);
      // Continue with other previews
    }
  }
}
```

**Acceptance Criteria:**
- [ ] All previews for closed MR are found
- [ ] Containers are stopped and removed
- [ ] Domains are deleted
- [ ] Database records are deleted
- [ ] MR comments are updated
- [ ] Errors don't prevent other cleanups

---

### Task 2.3: MR Reopen Handler

**Estimated Effort:** 1 day  
**Assignee:** Backend Developer  
**Priority:** P1

#### Subtasks

1. **Check for Existing Preview**
   - [ ] Query if preview still exists (might have been manually deleted)

2. **Reactivate or Create**
   - [ ] If exists: requeue deployment
   - [ ] If not exists: create new preview (reuse logic from Task 2.1)

3. **Update MR Comment**
   - [ ] Update comment to show "Reactivated"

**Acceptance Criteria:**
- [ ] Reopened MRs trigger preview recreation/reactivation
- [ ] MR comments are updated appropriately

---

### Task 2.4: Comment Templates

**Estimated Effort:** 1 day  
**Assignee:** Backend Developer / Frontend Developer  
**Priority:** P0

#### Subtasks

1. **Design Templates**
   - [ ] Building status
   - [ ] Success status
   - [ ] Error status
   - [ ] Security blocked
   - [ ] Cleanup/Removed

2. **Implement Template Functions**
   - [ ] `getGitlabMRComment(appName, status, previewUrl)`
   - [ ] `getGitlabSecurityBlockedMessage(username, accessLevel)`
   - [ ] `getGitlabCleanupMessage(appName)`

3. **Test Rendering**
   - [ ] Verify Markdown rendering in GitLab
   - [ ] Check table formatting
   - [ ] Test with long app names

**Files to Create:**
- `packages/server/src/templates/gitlab.ts`

**Code Example:**
```typescript
// packages/server/src/templates/gitlab.ts

export function getGitlabMRComment(
  appName: string,
  status: "initializing" | "running" | "success" | "error",
  previewUrl: string
): string {
  let statusEmoji = "🔄";
  let statusText = "Building";
  
  if (status === "success") {
    statusEmoji = "✅";
    statusText = "Ready";
  } else if (status === "error") {
    statusEmoji = "❌";
    statusText = "Failed";
  } else if (status === "running") {
    statusEmoji = "🔄";
    statusText = "Building";
  }

  return `### ${statusEmoji} Dokploy Preview Deployment

| Name | Status | Preview | Updated (UTC) |
|------|--------|---------|---------------|
| ${appName} | ${statusEmoji} ${statusText} | ${status === "success" ? `[Visit Preview](${previewUrl})` : "Pending"} | ${new Date().toISOString()} |

---
*${status === "success" ? "Preview deployment is ready!" : "Building preview deployment..."}*`;
}

export function getGitlabSecurityBlockedMessage(
  username: string,
  accessLevel: number | null
): string {
  const levelName = getAccessLevelName(accessLevel);
  
  return `### 🚨 Preview Deployment Blocked - Security Protection

**Your merge request was blocked from triggering preview deployments**

#### Why was this blocked?
- **User**: \`${username}\`
- **Access Level**: \`${levelName}\`
- **Required Level**: Developer (30) or higher

#### How to resolve this:

**Option 1: Get Project Access (Recommended)**
Ask a project maintainer to grant you **Developer** access or higher.

**Option 2: Request Permission Override**
Ask a project administrator to disable security validation for this application if appropriate.

---
*This security measure protects against malicious code execution in preview deployments.*`;
}

export function getGitlabCleanupMessage(appName: string): string {
  return `### 🗑️ Dokploy Preview Deployment - Removed

| Name | Status | Updated (UTC) |
|------|--------|---------------|
| ${appName} | 🗑️ Removed | ${new Date().toISOString()} |

---
*Preview deployment has been cleaned up as the merge request was closed.*`;
}

function getAccessLevelName(level: number | null): string {
  if (level === null) return "None";
  if (level < 10) return "None";
  if (level < 20) return "Guest (10)";
  if (level < 30) return "Reporter (20)";
  if (level < 40) return "Developer (30)";
  if (level < 50) return "Maintainer (40)";
  return "Owner (50)";
}
```

**Acceptance Criteria:**
- [ ] All comment templates are implemented
- [ ] Templates render correctly in GitLab
- [ ] Emojis and formatting work
- [ ] Links are clickable

---

## Phase 3: UI & Configuration (Weeks 5-6)

### Goal
Build user interfaces for configuring GitLab preview deployments and viewing deployment status.

---

### Task 3.1: Application Settings UI

**Estimated Effort:** 4 days  
**Assignee:** Frontend Developer  
**Priority:** P0

#### Subtasks

1. **GitLab Provider Selection**
   - [ ] Add GitLab provider dropdown to application form
   - [ ] Show GitLab-specific fields when GitLab is selected
   - [ ] Hide GitHub fields when GitLab is selected

2. **Repository Selection**
   - [ ] Fetch and display GitLab projects
   - [ ] Allow search/filter
   - [ ] Display project namespace and name

3. **Branch Selection**
   - [ ] Fetch branches for selected project
   - [ ] Populate branch dropdown

4. **Preview Configuration**
   - [ ] Reuse existing preview settings UI
   - [ ] Ensure all fields work with GitLab
   - [ ] Add tooltip explaining GitLab differences (if any)

5. **Webhook Setup Instructions**
   - [ ] Display webhook URL
   - [ ] Display webhook secret (masked, with copy button)
   - [ ] Add step-by-step guide to set up webhook in GitLab
   - [ ] Link to GitLab webhook documentation

**Files to Create/Modify:**
- `apps/dokploy/components/dashboard/application/general/generic/save-gitlab-provider.tsx` (enhance)
- `apps/dokploy/components/dashboard/application/preview-deployments/show-preview-settings.tsx` (enhance)

**Acceptance Criteria:**
- [ ] Users can select GitLab provider
- [ ] Users can select GitLab project
- [ ] Users can select branch
- [ ] Users can configure preview settings
- [ ] Webhook setup instructions are clear
- [ ] UI is consistent with existing GitHub implementation

---

### Task 3.2: Preview Deployments Dashboard

**Estimated Effort:** 3 days  
**Assignee:** Frontend Developer  
**Priority:** P0

#### Subtasks

1. **Update Preview List**
   - [ ] Display provider (GitHub/GitLab) icon
   - [ ] Show GitLab MR details (title, !number, author)
   - [ ] Link to GitLab MR
   - [ ] Show preview URL
   - [ ] Show status (building, ready, error)

2. **Preview Actions**
   - [ ] Add "Redeploy" button
   - [ ] Add "Delete" button
   - [ ] Add "View Logs" button
   - [ ] Add "Open Preview" button

3. **Manual Trigger (Optional)**
   - [ ] Add form to manually trigger preview for MR
   - [ ] Input MR number
   - [ ] Trigger deployment

**Files to Modify:**
- `apps/dokploy/components/dashboard/application/preview-deployments/show-preview-deployments.tsx`

**Acceptance Criteria:**
- [ ] Preview list shows both GitHub and GitLab previews
- [ ] GitLab MR details are displayed correctly
- [ ] Links to GitLab work
- [ ] Actions (redeploy, delete) work
- [ ] UI is responsive and user-friendly

---

### Task 3.3: GitLab Provider Management

**Estimated Effort:** 2 days  
**Assignee:** Frontend Developer  
**Priority:** P1

#### Subtasks

1. **Add GitLab Provider**
   - [ ] Form to add GitLab OAuth application
   - [ ] Fields: Name, GitLab URL, Application ID, Secret
   - [ ] OAuth redirect URI display
   - [ ] Test connection button

2. **Edit GitLab Provider**
   - [ ] Form to update existing provider
   - [ ] Update webhook secret
   - [ ] Regenerate webhook secret option

3. **Display Webhook Configuration**
   - [ ] Show webhook URL
   - [ ] Show webhook secret (masked)
   - [ ] Copy buttons
   - [ ] Link to setup guide

**Files to Modify:**
- `apps/dokploy/components/dashboard/settings/git/gitlab/add-gitlab-provider.tsx`
- `apps/dokploy/components/dashboard/settings/git/gitlab/edit-gitlab-provider.tsx`

**Acceptance Criteria:**
- [ ] Users can add/edit GitLab providers
- [ ] Test connection works
- [ ] Webhook configuration is displayed
- [ ] Copy buttons work
- [ ] UI matches existing GitHub provider UI

---

## Phase 4: Testing & Documentation (Weeks 7-8)

### Goal
Ensure reliability through comprehensive testing and provide clear documentation.

---

### Task 4.1: End-to-End Testing

**Estimated Effort:** 4 days  
**Assignee:** QA / Backend Developer  
**Priority:** P0

#### Subtasks

1. **GitLab.com Testing**
   - [ ] Create test GitLab.com project
   - [ ] Configure OAuth application
   - [ ] Set up webhook
   - [ ] Test MR open → preview created
   - [ ] Test new commit → preview updated
   - [ ] Test MR close → preview cleaned up
   - [ ] Test MR reopen → preview recreated

2. **Self-Hosted GitLab CE Testing**
   - [ ] Spin up GitLab CE container
   - [ ] Repeat all tests from GitLab.com
   - [ ] Test custom domain handling

3. **Permission Testing**
   - [ ] Test with Guest user → blocked
   - [ ] Test with Reporter user → blocked
   - [ ] Test with Developer user → allowed
   - [ ] Test with Maintainer user → allowed
   - [ ] Test with inherited permissions
   - [ ] Verify security comments posted

4. **Label Testing**
   - [ ] Configure app with required label
   - [ ] Test MR without label → no preview
   - [ ] Test MR with label → preview created
   - [ ] Test adding/removing labels

5. **Limit Testing**
   - [ ] Configure app with limit=2
   - [ ] Open 3 MRs
   - [ ] Verify only 2 previews created
   - [ ] Close 1 MR
   - [ ] Open new MR → preview created

6. **Concurrent Testing**
   - [ ] Open multiple MRs simultaneously
   - [ ] Verify all are processed
   - [ ] Check for race conditions

7. **Error Scenarios**
   - [ ] Test with invalid OAuth token → refresh triggered
   - [ ] Test with revoked token → error logged
   - [ ] Test with deleted project → graceful failure
   - [ ] Test with network issues → retry logic

**Tools:**
- Manual testing
- Automated E2E tests (Playwright/Cypress)
- GitLab test runner

**Acceptance Criteria:**
- [ ] All scenarios pass on GitLab.com
- [ ] All scenarios pass on self-hosted GitLab CE
- [ ] Permission checks work correctly
- [ ] Labels and limits work as expected
- [ ] System handles errors gracefully
- [ ] No data loss or corruption

---

### Task 4.2: Performance & Load Testing

**Estimated Effort:** 2 days  
**Assignee:** Backend Developer / DevOps  
**Priority:** P1

#### Subtasks

1. **Webhook Endpoint Performance**
   - [ ] Simulate 100 concurrent webhook requests
   - [ ] Measure response time (target: <500ms p95)
   - [ ] Verify no requests dropped
   - [ ] Check database connection pool usage

2. **Deployment Queue Performance**
   - [ ] Simulate 50 simultaneous preview deployments
   - [ ] Monitor queue processing time
   - [ ] Verify resource usage (CPU, memory)
   - [ ] Check for bottlenecks

3. **Database Performance**
   - [ ] Query performance for large datasets (1000+ previews)
   - [ ] Index optimization
   - [ ] Connection pool tuning

**Tools:**
- Apache JMeter or k6 for load testing
- Grafana for monitoring
- Database query analyzer

**Acceptance Criteria:**
- [ ] Webhook endpoint handles 100 req/min
- [ ] p95 response time < 500ms
- [ ] No dropped requests
- [ ] Database queries < 100ms
- [ ] Resource usage within acceptable limits

---

### Task 4.3: Documentation

**Estimated Effort:** 3 days  
**Assignee:** Technical Writer / Developer  
**Priority:** P0

#### Subtasks

1. **User Guide**
   - [ ] Overview of GitLab preview deployments
   - [ ] Step-by-step setup guide
     - [ ] Create GitLab OAuth application
     - [ ] Add GitLab provider to Dokploy
     - [ ] Configure application with GitLab repo
     - [ ] Set up webhook in GitLab
     - [ ] Test with MR
   - [ ] Configuration options explained
   - [ ] Screenshots and examples

2. **Admin Guide**
   - [ ] GitLab OAuth application setup (detailed)
   - [ ] Webhook configuration
   - [ ] Security considerations
   - [ ] Token management and refresh
   - [ ] Troubleshooting common issues

3. **API Documentation**
   - [ ] tRPC endpoints for GitLab preview deployments
   - [ ] Webhook payload format
   - [ ] Response codes
   - [ ] Examples with curl

4. **Troubleshooting Guide**
   - [ ] Common errors and solutions
   - [ ] Webhook not triggering → check token, URL, etc.
   - [ ] Deployment failed → check logs, permissions
   - [ ] Token expired → refresh process
   - [ ] Permission denied → access level requirements

5. **Security Best Practices**
   - [ ] Webhook secret management
   - [ ] Permission requirements
   - [ ] Token rotation
   - [ ] Audit logging
   - [ ] Public vs private repos

**Deliverables:**
- Markdown files in `/docs` directory
- Screenshots in `/docs/images`
- README updates
- Changelog entry

**Acceptance Criteria:**
- [ ] Documentation is clear and comprehensive
- [ ] All steps have screenshots
- [ ] Troubleshooting guide covers common issues
- [ ] Security best practices are documented
- [ ] Documentation is reviewed and approved

---

### Task 4.4: Code Review & Refinement

**Estimated Effort:** 2 days  
**Assignee:** All Developers  
**Priority:** P0

#### Subtasks

1. **Code Review**
   - [ ] Review all new code
   - [ ] Check for security issues
   - [ ] Verify error handling
   - [ ] Ensure consistent coding style
   - [ ] Check for code duplication

2. **Refactoring**
   - [ ] Extract common logic into shared functions
   - [ ] Improve naming and comments
   - [ ] Optimize performance where needed

3. **Security Audit**
   - [ ] Verify webhook verification is secure
   - [ ] Check token storage and encryption
   - [ ] Review permission checks
   - [ ] Validate input sanitization
   - [ ] Check for SQL injection, XSS, etc.

4. **Final Testing**
   - [ ] Run full test suite
   - [ ] Fix any failing tests
   - [ ] Update tests as needed

**Acceptance Criteria:**
- [ ] All code reviewed and approved
- [ ] No security vulnerabilities
- [ ] All tests pass
- [ ] Code quality meets standards

---

## Phase 5: Advanced Features (Weeks 9-10) - Optional

This phase is optional and can be implemented after the core functionality is stable and in production.

---

### Task 5.1: Group-Level Webhooks (EE)

**Estimated Effort:** 2 days  
**Assignee:** Backend Developer  
**Priority:** P2

#### Subtasks

1. **Support Group Webhooks**
   - [ ] Allow configuring webhook at group level
   - [ ] Automatically apply to all group projects
   - [ ] Inherit settings from group

2. **Configuration UI**
   - [ ] Add group webhook settings
   - [ ] Display inherited settings in project view

**Acceptance Criteria:**
- [ ] Group webhooks work with EE
- [ ] Settings are inherited correctly
- [ ] UI shows group vs project webhooks

---

### Task 5.2: Deployment Approvals

**Estimated Effort:** 2 days  
**Assignee:** Backend Developer  
**Priority:** P2

#### Subtasks

1. **Approval Integration**
   - [ ] Check MR approval status before deploying
   - [ ] Block deployment until approved (optional setting)
   - [ ] Update status when approval changes

2. **UI Updates**
   - [ ] Show approval status in preview list
   - [ ] Add setting to require approvals

**Acceptance Criteria:**
- [ ] Deployments can be blocked until approved
- [ ] Approval status is visible
- [ ] Setting is configurable

---

### Task 5.3: Enhanced Monitoring

**Estimated Effort:** 2 days  
**Assignee:** DevOps / Backend Developer  
**Priority:** P2

#### Subtasks

1. **Resource Tracking**
   - [ ] Track CPU, memory, disk usage per preview
   - [ ] Display in UI
   - [ ] Alert on high usage

2. **Cost Estimation**
   - [ ] Estimate cost per preview (if applicable)
   - [ ] Display total cost for all previews

3. **Auto-Cleanup**
   - [ ] Automatically delete previews older than X days
   - [ ] Configurable retention policy
   - [ ] Notify before cleanup

**Acceptance Criteria:**
- [ ] Resource usage is tracked and displayed
- [ ] Cost estimation is available
- [ ] Auto-cleanup works as configured

---

## Deployment Checklist

### Pre-Deployment

- [ ] All tasks completed and tested
- [ ] Code reviewed and approved
- [ ] Documentation completed
- [ ] Changelog updated
- [ ] Database migration tested on staging
- [ ] Backup strategy verified

### Deployment

- [ ] Schedule maintenance window (if needed)
- [ ] Notify users of new feature
- [ ] Backup production database
- [ ] Run database migrations
- [ ] Deploy new code to servers
- [ ] Verify webhook endpoints accessible
- [ ] Test with sample GitLab webhook

### Post-Deployment

- [ ] Monitor logs for errors
- [ ] Verify existing GitHub previews still work
- [ ] Test GitLab preview end-to-end
- [ ] Monitor performance metrics
- [ ] Gather user feedback
- [ ] Address any bugs or issues

### Rollback (if needed)

- [ ] Revert code deployment
- [ ] Rollback database migrations (if safe)
- [ ] Restore from backup (if necessary)
- [ ] Notify users of temporary rollback
- [ ] Investigate root cause
- [ ] Fix and re-deploy

---

## Success Metrics

### Technical Metrics

- [ ] Webhook endpoint uptime: 99.9%
- [ ] Webhook response time p95: <500ms
- [ ] Preview deployment success rate: >95%
- [ ] Average deployment time: <5 minutes
- [ ] Test coverage: >80%

### User Metrics

- [ ] Number of GitLab providers configured
- [ ] Number of GitLab preview deployments created
- [ ] User satisfaction rating: >4/5
- [ ] Time to configure first preview: <15 minutes
- [ ] Support ticket volume: <5/week

### Business Metrics

- [ ] Feature parity with GitHub implementation achieved
- [ ] GitLab users can deploy preview environments
- [ ] Reduced manual testing effort
- [ ] Increased developer productivity

---

## Risks & Mitigations

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| GitLab API changes | High | Low | Monitor GitLab changelog, add version checks |
| Token refresh failures | High | Medium | Implement robust retry logic, alert on failures |
| High webhook volume | Medium | Medium | Add rate limiting, scale horizontally if needed |
| Security vulnerabilities | High | Low | Security audit, penetration testing |
| Database performance | Medium | Medium | Optimize queries, add indexes |
| User confusion | Low | Medium | Clear documentation, UI hints |

---

## Open Questions

- [ ] Should we support Bitbucket in the same PR or separate?
- [ ] Should we support commenting on specific commits in addition to MRs?
- [ ] Should we add Slack/Discord notifications for preview deployments?
- [ ] Should we implement visual regression testing?
- [ ] Should we support deploying to multiple environments per MR?

---

## Conclusion

This implementation plan provides a comprehensive roadmap for adding GitLab preview deployment support to Dokploy. By following this plan, we will achieve feature parity with the existing GitHub implementation while laying the groundwork for future enhancements.

The plan is divided into manageable phases, allowing for iterative development and testing. Each task has clear acceptance criteria, making it easy to track progress and ensure quality.

For questions or clarifications, please reach out to the project maintainers or join the discussion on GitHub.
