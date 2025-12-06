# RFC: GitLab Preview Deployments for Merge Requests

**Status:** Draft  
**Author:** Dokploy Contributors  
**Created:** 2025-12-06  
**Related Issues:** [#1483](https://github.com/Dokploy/dokploy/issues/1483), [#2723](https://github.com/Dokploy/dokploy/issues/2723)

## Executive Summary

This RFC proposes a comprehensive preview deployment system for GitLab (both Community Edition and Enterprise Edition) that provides feature parity with and improvements beyond Dokploy's existing GitHub App-based preview deployment system. The solution will support the full merge request (MR) lifecycle, including creation, updates, reopening, labeling, and closure, while implementing robust security measures and future-proof architecture.

## Table of Contents

1. [Background](#background)
2. [Current State: GitHub Implementation](#current-state-github-implementation)
3. [Objectives](#objectives)
4. [GitLab MR Lifecycle Analysis](#gitlab-mr-lifecycle-analysis)
5. [Proposed Architecture](#proposed-architecture)
6. [Database Schema Changes](#database-schema-changes)
7. [API Design](#api-design)
8. [Security Considerations](#security-considerations)
9. [Implementation Plan](#implementation-plan)
10. [Testing Strategy](#testing-strategy)
11. [Migration Strategy](#migration-strategy)
12. [Future Enhancements](#future-enhancements)
13. [References](#references)

## Background

Dokploy currently supports preview deployments for GitHub through a GitHub App integration. This feature allows automatic deployment of preview environments for pull requests, enabling developers to test changes before merging. GitLab users require equivalent functionality to maintain feature parity and enable the same CI/CD workflows.

### Problem Statement

Users deploying applications from GitLab repositories cannot:
- Automatically deploy preview environments for merge requests
- Receive deployment status updates as MR comments
- Clean up preview deployments when MRs are closed or merged
- Leverage GitLab-specific features like group webhooks and approval workflows

## Current State: GitHub Implementation

### Key Features

1. **Webhook-based Triggering**: Uses GitHub App webhooks to detect PR events (opened, synchronize, reopened, closed)
2. **Permission Validation**: Checks if PR author has write/maintain/admin permissions before allowing deployment
3. **Status Comments**: Posts and updates comments on PRs with deployment status
4. **Automatic Cleanup**: Removes preview deployments when PRs are closed
5. **Label Filtering**: Supports deployment based on PR labels
6. **Preview Limits**: Configurable limits on concurrent preview deployments per application
7. **Custom Configuration**: Per-application settings for:
   - Environment variables (`previewEnv`)
   - Build arguments (`previewBuildArgs`, `previewBuildSecrets`)
   - Domain configuration (`previewWildcard`, `previewHttps`, `previewPath`)
   - Port and certificate settings
   - Security settings (`previewRequireCollaboratorPermissions`)

### Implementation Components

```
GitHub App → Webhook → /api/deploy/github → 
  ↓
  Permission Check → Preview Deployment Creation →
  ↓
  Queue Deployment Job → Build & Deploy →
  ↓
  Update MR Comment with Status
```

### Current Limitations

- GitHub-specific: tightly coupled to GitHub's App authentication model
- No support for GitLab or other Git providers
- Limited extensibility for provider-specific features

## Objectives

### Must Have (P0)

1. **Full MR Lifecycle Support**
   - Create preview on MR open
   - Update preview on new commits (synchronize)
   - Handle MR reopen events
   - Clean up on MR close/merge
   - Support label-based filtering

2. **Security & Permissions**
   - Validate MR author permissions (Developer/Maintainer/Owner)
   - Secure webhook verification using secret tokens
   - Prevent unauthorized preview deployments
   - Audit logging for security events

3. **Status Reporting**
   - Post initial comment with preview URL
   - Update comment with deployment status
   - Support deployment success/failure notifications
   - Link to deployment logs

4. **GitLab CE & EE Compatibility**
   - Work with both Community and Enterprise editions
   - Support self-hosted GitLab instances
   - Handle GitLab.com and custom domains

### Should Have (P1)

5. **Advanced Configuration**
   - Per-application preview settings
   - Custom environment variables for previews
   - Build arguments and secrets
   - Wildcard domain generation
   - SSL/TLS certificate management
   - Preview limits per application

6. **Group-Level Features (EE)**
   - Group webhooks for monitoring multiple projects
   - Shared configuration across group projects

7. **Token Management**
   - OAuth2 token refresh automation
   - Secure token storage and rotation
   - Token expiry handling

### Could Have (P2)

8. **Enhanced Features**
   - Deployment approval workflows (EE)
   - Integration with GitLab CI/CD status checks (EE)
   - Multi-environment previews (e.g., staging, production-like)
   - Resource usage monitoring for previews
   - Automatic preview expiration based on age

9. **Developer Experience**
   - CLI commands for manual preview management
   - Dashboard for preview deployment overview
   - Deployment history and rollback
   - Performance metrics and logs

## GitLab MR Lifecycle Analysis

### Webhook Events

GitLab provides a unified "Merge Request" webhook event with an `action` field indicating the lifecycle stage:

| Event Action | Trigger | GitHub Equivalent | Required Action |
|--------------|---------|-------------------|-----------------|
| `open` | MR created | `opened` | Create preview deployment |
| `update` | New commits pushed | `synchronize` | Redeploy preview |
| `reopen` | Closed MR reopened | `reopened` | Recreate/reactivate preview |
| `close` | MR closed without merge | `closed` | Clean up preview |
| `merge` | MR merged | `closed` (merged=true) | Clean up preview |
| `approved` | MR approved (EE) | N/A | Optional: update status |
| `unapproved` | Approval removed (EE) | N/A | Optional: update status |

### Webhook Payload Structure

```json
{
  "object_kind": "merge_request",
  "event_type": "merge_request",
  "object_attributes": {
    "id": 99,
    "iid": 1,
    "title": "Feature: Add new feature",
    "state": "opened",
    "action": "open",
    "source_branch": "feature-branch",
    "target_branch": "main",
    "source_project_id": 42,
    "target_project_id": 42,
    "author_id": 10
  },
  "labels": [
    { "id": 1, "title": "deploy-preview" }
  ],
  "project": {
    "id": 42,
    "name": "awesome-project",
    "path_with_namespace": "group/awesome-project",
    "web_url": "https://gitlab.com/group/awesome-project"
  },
  "user": {
    "id": 10,
    "username": "developer",
    "name": "Developer Name"
  }
}
```

### Authentication & Security

**Webhook Verification:**
- GitLab sends webhook secret token in `X-Gitlab-Token` header
- Simple constant-time string comparison for verification
- Always use HTTPS for webhook endpoints

**API Authentication:**
- OAuth2 Application with access/refresh tokens
- Access token in `Authorization: Bearer <token>` header
- Tokens expire after ~2 hours; requires refresh logic
- Scope: `api` for full access to projects and MRs

### Permission Levels

GitLab uses numeric access levels:

| Role | Access Level | Numeric Code | Can Merge to Protected? | Notes |
|------|--------------|--------------|------------------------|-------|
| Guest | 10 | 10 | No | Read-only |
| Reporter | 20 | 20 | No | Can create issues |
| Developer | 30 | 30 | Limited | Can push to non-protected |
| Maintainer | 40 | 40 | Yes | Can manage project |
| Owner | 50 | 50 | Yes | Full control (group level) |

**Security Recommendation:** Require Developer (30) or higher for preview deployments.

### GitLab API Endpoints

#### Get Project Member Permissions
```
GET /api/v4/projects/:id/members/:user_id
GET /api/v4/projects/:id/members/all/:user_id  # Includes inherited
```

Response:
```json
{
  "id": 10,
  "username": "developer",
  "access_level": 30,
  "expires_at": null
}
```

#### Create/Update MR Note (Comment)
```
POST /api/v4/projects/:id/merge_requests/:merge_request_iid/notes
PUT /api/v4/projects/:id/merge_requests/:merge_request_iid/notes/:note_id
```

Body:
```json
{
  "body": "### Dokploy Preview Deployment\n\n| Name | Status | Preview | Updated |\n..."
}
```

#### List MR Labels
```
GET /api/v4/projects/:id/merge_requests/:merge_request_iid
```

Response includes `labels` array.

## Proposed Architecture

### High-Level Flow

```
┌─────────────────┐
│  GitLab Server  │
│  (CE/EE/Cloud)  │
└────────┬────────┘
         │ Webhook Event
         │ (X-Gitlab-Token)
         ▼
┌─────────────────────────────┐
│  Dokploy Webhook Endpoint   │
│  /api/providers/gitlab/     │
│       webhook               │
└────────┬────────────────────┘
         │
         ├─1. Verify X-Gitlab-Token
         │
         ├─2. Parse event_type & action
         │
         ├─3. Extract MR details
         │
         ▼
┌─────────────────────────────┐
│  Event Handler Router       │
└────────┬────────────────────┘
         │
         ├──[open/update/reopen]──────────────┐
         │                                     ▼
         │                          ┌──────────────────────┐
         │                          │  Permission Validator │
         │                          │  (GitLab Members API) │
         │                          └──────────┬───────────┘
         │                                     │
         │                          [Developer+] ✓    [Below Developer] ✗
         │                                     │              │
         │                                     ▼              ▼
         │                          ┌──────────────────────┐ │
         │                          │  Check Config:       │ │
         │                          │  - Labels            │ │
         │                          │  - Preview limit     │ │
         │                          └──────────┬───────────┘ │
         │                                     │              │
         │                                     ▼              │
         │                          ┌──────────────────────┐ │
         │                          │  Create/Update       │ │
         │                          │  Preview Deployment  │ │
         │                          └──────────┬───────────┘ │
         │                                     │              │
         │                                     ▼              ▼
         │                          ┌──────────────────────────────────┐
         │                          │  Post MR Comment                 │
         │                          │  (Success/Building/Blocked)      │
         │                          └──────────┬───────────────────────┘
         │                                     │
         │                                     ▼
         │                          ┌──────────────────────┐
         │                          │  Queue Deployment    │
         │                          │  Job (BullMQ)        │
         │                          └──────────┬───────────┘
         │                                     │
         │                                     ▼
         │                          ┌──────────────────────┐
         │                          │  Build & Deploy      │
         │                          │  Container           │
         │                          └──────────┬───────────┘
         │                                     │
         │                                     ▼
         │                          ┌──────────────────────┐
         │                          │  Update MR Comment   │
         │                          │  with Final Status   │
         │                          └──────────────────────┘
         │
         └──[close/merge]──────────────────────┐
                                               ▼
                                    ┌──────────────────────┐
                                    │  Find Preview by     │
                                    │  MR ID               │
                                    └──────────┬───────────┘
                                               │
                                               ▼
                                    ┌──────────────────────┐
                                    │  Cleanup:            │
                                    │  - Stop container    │
                                    │  - Remove volumes    │
                                    │  - Delete domain     │
                                    │  - Delete DB record  │
                                    └──────────┬───────────┘
                                               │
                                               ▼
                                    ┌──────────────────────┐
                                    │  Update MR Comment   │
                                    │  "Preview Removed"   │
                                    └──────────────────────┘
```

### Component Design

#### 1. Webhook Handler (`/api/providers/gitlab/webhook.ts`)

**Responsibilities:**
- Receive and verify webhook requests
- Route to appropriate handler based on event type and action
- Handle errors and return appropriate HTTP responses

**Key Functions:**
```typescript
export async function handleGitlabWebhook(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // 1. Verify X-Gitlab-Token
  const token = req.headers["x-gitlab-token"];
  const gitlabProvider = await findGitlabByWebhookToken(token);
  
  // 2. Parse event
  const event = req.body;
  const eventType = event.object_kind;
  const action = event.object_attributes?.action;
  
  // 3. Route to handler
  if (eventType === "merge_request") {
    await handleMergeRequestEvent(event, action, gitlabProvider);
  }
  
  res.status(200).json({ message: "Webhook processed" });
}
```

#### 2. MR Event Handlers

**Create/Update Preview:**
```typescript
async function handleMergeRequestOpenOrUpdate(
  event: GitLabMREvent,
  gitlabProvider: Gitlab
) {
  const { project, object_attributes, user, labels } = event;
  
  // Find applications configured for this repo
  const apps = await findApplicationsByGitlabRepo(
    project.id,
    object_attributes.target_branch,
    gitlabProvider.gitlabId
  );
  
  for (const app of apps) {
    // Security: Check user permissions
    if (app.previewRequireCollaboratorPermissions) {
      const hasAccess = await checkGitlabUserPermissions(
        gitlabProvider,
        project.id,
        user.id,
        30 // Minimum Developer level
      );
      
      if (!hasAccess) {
        await postSecurityBlockedComment(/* ... */);
        continue;
      }
    }
    
    // Check label requirements
    if (app.previewLabels?.length > 0) {
      const hasLabel = labels.some(l => 
        app.previewLabels.includes(l.title)
      );
      if (!hasLabel) continue;
    }
    
    // Check preview limit
    if (app.previewDeployments.length >= app.previewLimit) {
      continue;
    }
    
    // Create or get existing preview
    let preview = await findPreviewByMRId(
      app.applicationId,
      object_attributes.id
    );
    
    if (!preview) {
      preview = await createPreviewDeployment({
        applicationId: app.applicationId,
        branch: object_attributes.source_branch,
        mergeRequestId: object_attributes.id,
        mergeRequestIid: object_attributes.iid,
        mergeRequestUrl: object_attributes.url,
        mergeRequestTitle: object_attributes.title,
        gitlabProjectId: project.id
      });
    }
    
    // Queue deployment
    await queueDeploymentJob({
      applicationId: app.applicationId,
      previewDeploymentId: preview.previewDeploymentId,
      type: "application-preview",
      commitSha: object_attributes.last_commit.id
    });
  }
}
```

**Cleanup Preview:**
```typescript
async function handleMergeRequestClose(
  event: GitLabMREvent,
  gitlabProvider: Gitlab
) {
  const { object_attributes } = event;
  
  // Find all previews for this MR
  const previews = await findPreviewsByMRId(
    object_attributes.id
  );
  
  for (const preview of previews) {
    await removePreviewDeployment(preview.previewDeploymentId);
    
    // Update MR comment
    await updateGitlabMRComment(
      gitlabProvider,
      preview.gitlabProjectId,
      preview.mergeRequestIid,
      preview.mergeRequestCommentId,
      getCleanupMessage(preview.appName)
    );
  }
}
```

#### 3. GitLab API Service (`packages/server/src/utils/providers/gitlab.ts`)

**Key Functions:**

```typescript
/**
 * Check if user has sufficient permissions for preview deployments
 */
export async function checkGitlabUserPermissions(
  gitlabProvider: Gitlab,
  projectId: number,
  userId: number,
  minimumAccessLevel: number = 30
): Promise<{ hasAccess: boolean; accessLevel: number | null }> {
  await refreshGitlabToken(gitlabProvider.gitlabId);
  
  try {
    // Check direct membership
    const response = await fetch(
      `${gitlabProvider.gitlabUrl}/api/v4/projects/${projectId}/members/${userId}`,
      {
        headers: {
          Authorization: `Bearer ${gitlabProvider.accessToken}`,
        },
      }
    );
    
    if (!response.ok) {
      // Try inherited membership
      const allResponse = await fetch(
        `${gitlabProvider.gitlabUrl}/api/v4/projects/${projectId}/members/all/${userId}`,
        {
          headers: {
            Authorization: `Bearer ${gitlabProvider.accessToken}`,
          },
        }
      );
      
      if (!allResponse.ok) {
        return { hasAccess: false, accessLevel: null };
      }
      
      const member = await allResponse.json();
      return {
        hasAccess: member.access_level >= minimumAccessLevel,
        accessLevel: member.access_level
      };
    }
    
    const member = await response.json();
    return {
      hasAccess: member.access_level >= minimumAccessLevel,
      accessLevel: member.access_level
    };
  } catch (error) {
    console.error("Error checking GitLab permissions:", error);
    return { hasAccess: false, accessLevel: null };
  }
}

/**
 * Create a comment on a GitLab merge request
 */
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
    throw new Error(`Failed to create MR comment: ${response.statusText}`);
  }
  
  return response.json();
}

/**
 * Update an existing comment on a GitLab merge request
 */
export async function updateGitlabMRComment(
  gitlabProvider: Gitlab,
  projectId: number,
  mergeRequestIid: number,
  noteId: number,
  body: string
): Promise<void> {
  await refreshGitlabToken(gitlabProvider.gitlabId);
  
  const response = await fetch(
    `${gitlabProvider.gitlabUrl}/api/v4/projects/${projectId}/merge_requests/${mergeRequestIid}/notes/${noteId}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${gitlabProvider.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ body }),
    }
  );
  
  if (!response.ok) {
    throw new Error(`Failed to update MR comment: ${response.statusText}`);
  }
}

/**
 * Clone GitLab repository for preview deployment
 */
export async function cloneGitlabRepositoryForPreview(
  preview: PreviewDeployment,
  app: Application,
  gitlabProvider: Gitlab
): Promise<string> {
  await refreshGitlabToken(gitlabProvider.gitlabId);
  
  const basePath = paths(!!app.serverId).APPLICATIONS_PATH;
  const outputPath = join(basePath, preview.appName, "code");
  
  // Build clone URL with access token
  const repoUrl = app.gitlabPathNamespace; // e.g., "group/project"
  const cloneUrl = `${gitlabProvider.gitlabUrl.replace(/^https?:\/\//, "")}/${repoUrl}.git`;
  const authenticatedUrl = `https://oauth2:${gitlabProvider.accessToken}@${cloneUrl}`;
  
  let command = "set -e;";
  command += `rm -rf ${outputPath};`;
  command += `mkdir -p ${outputPath};`;
  command += `echo "Cloning ${repoUrl} (branch: ${preview.branch}) to ${outputPath}";`;
  command += `git clone --branch ${preview.branch} --depth 1 ${app.enableSubmodules ? "--recurse-submodules" : ""} ${authenticatedUrl} ${outputPath} --progress;`;
  
  return command;
}
```

#### 4. Comment Templates

**Building Status:**
```markdown
### 🔄 Dokploy Preview Deployment - Building

| Name | Status | Preview | Updated (UTC) |
|------|--------|---------|---------------|
| {app.name} | 🔄 Building | Pending | {timestamp} |

**Branch:** `{sourceBranch}`  
**Commit:** `{commitSha}`

---
*Preview deployment will be available shortly...*
```

**Success Status:**
```markdown
### ✅ Dokploy Preview Deployment - Ready

| Name | Status | Preview | Updated (UTC) |
|------|--------|---------|---------------|
| {app.name} | ✅ Ready | [Visit Preview]({previewUrl}) | {timestamp} |

**Branch:** `{sourceBranch}`  
**Commit:** `{commitSha}`

---
*Preview deployment is live and ready for testing.*
```

**Error Status:**
```markdown
### ❌ Dokploy Preview Deployment - Failed

| Name | Status | Preview | Updated (UTC) |
|------|--------|---------|---------------|
| {app.name} | ❌ Failed | N/A | {timestamp} |

**Branch:** `{sourceBranch}`  
**Commit:** `{commitSha}`  
**Error:** {errorMessage}

---
*Check deployment logs for more details.*
```

**Security Blocked:**
```markdown
### 🚨 Preview Deployment Blocked - Security Protection

**Your merge request was blocked from triggering preview deployments**

#### Why was this blocked?
- **User**: `{username}`
- **Project**: `{projectName}`
- **Access Level**: `{accessLevel}` (Guest/Reporter/None)
- **Required Level**: Developer (30) or higher

#### How to resolve this:

**Option 1: Get Project Access (Recommended)**
Ask a project maintainer to grant you **Developer** access or higher.

**Option 2: Request Permission Override**
Ask a project administrator to disable security validation for this application if appropriate.

#### For Project Administrators:
To disable this security check (⚠️ **not recommended for public projects**):
Navigate to the application's preview settings and disable the collaborator permission requirement.

---
*This security measure protects against malicious code execution in preview deployments.*
```

## Database Schema Changes

### New Tables

#### `gitlab_webhooks`
Stores webhook configuration for GitLab projects:

```sql
CREATE TABLE gitlab_webhooks (
  webhook_id TEXT PRIMARY KEY DEFAULT nanoid(),
  gitlab_id TEXT NOT NULL REFERENCES gitlab(gitlab_id) ON DELETE CASCADE,
  webhook_token TEXT NOT NULL UNIQUE,
  webhook_url TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  enabled BOOLEAN NOT NULL DEFAULT true,
  
  UNIQUE(gitlab_id)
);
```

### Modified Tables

#### `preview_deployments`
Add GitLab-specific fields:

```sql
ALTER TABLE preview_deployments ADD COLUMN provider TEXT NOT NULL DEFAULT 'github';
ALTER TABLE preview_deployments ADD COLUMN merge_request_id TEXT;
ALTER TABLE preview_deployments ADD COLUMN merge_request_iid TEXT;
ALTER TABLE preview_deployments ADD COLUMN merge_request_comment_id TEXT;
ALTER TABLE preview_deployments ADD COLUMN gitlab_project_id INTEGER;

-- Rename GitHub-specific columns (optional, for clarity)
-- pullRequestId → generic_pr_id
-- pullRequestNumber → generic_pr_number (or use mergeRequestIid)
-- pullRequestURL → generic_pr_url
-- pullRequestTitle → generic_pr_title
-- pullRequestCommentId → generic_comment_id
```

#### `applications`
Add GitLab repository fields:

```sql
ALTER TABLE applications ADD COLUMN gitlab_id TEXT REFERENCES gitlab(gitlab_id) ON DELETE SET NULL;
ALTER TABLE applications ADD COLUMN gitlab_project_id INTEGER;
ALTER TABLE applications ADD COLUMN gitlab_path_namespace TEXT;
```

#### `compose`
Similar GitLab fields:

```sql
ALTER TABLE compose ADD COLUMN gitlab_id TEXT REFERENCES gitlab(gitlab_id) ON DELETE SET NULL;
ALTER TABLE compose ADD COLUMN gitlab_project_id INTEGER;
ALTER TABLE compose ADD COLUMN gitlab_path_namespace TEXT;
```

#### `gitlab`
Add webhook secret field:

```sql
ALTER TABLE gitlab ADD COLUMN webhook_secret TEXT;
```

### TypeScript Schema Updates

**`packages/server/src/db/schema/preview-deployments.ts`:**

```typescript
export const previewDeployments = pgTable("preview_deployments", {
  previewDeploymentId: text("previewDeploymentId")
    .notNull()
    .primaryKey()
    .$defaultFn(() => nanoid()),
  
  // Generic fields (work for both GitHub and GitLab)
  provider: text("provider", { enum: ["github", "gitlab"] })
    .notNull()
    .default("github"),
  branch: text("branch").notNull(),
  
  // GitHub-specific (nullable for GitLab)
  pullRequestId: text("pullRequestId"),
  pullRequestNumber: text("pullRequestNumber"),
  pullRequestURL: text("pullRequestURL"),
  pullRequestTitle: text("pullRequestTitle"),
  pullRequestCommentId: text("pullRequestCommentId"),
  
  // GitLab-specific (nullable for GitHub)
  mergeRequestId: text("mergeRequestId"),
  mergeRequestIid: text("mergeRequestIid"),
  mergeRequestUrl: text("mergeRequestUrl"),
  mergeRequestTitle: text("mergeRequestTitle"),
  mergeRequestCommentId: text("mergeRequestCommentId"),
  gitlabProjectId: integer("gitlabProjectId"),
  
  // Common fields
  previewStatus: applicationStatus("previewStatus").notNull().default("idle"),
  appName: text("appName")
    .notNull()
    .$defaultFn(() => generateAppName("preview"))
    .unique(),
  applicationId: text("applicationId")
    .notNull()
    .references(() => applications.applicationId, {
      onDelete: "cascade",
    }),
  domainId: text("domainId").references(() => domains.domainId, {
    onDelete: "cascade",
  }),
  createdAt: text("createdAt")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  expiresAt: text("expiresAt"),
});
```

**`packages/server/src/db/schema/application.ts`:**

```typescript
export const applications = pgTable("application", {
  // ... existing fields ...
  
  // GitLab fields
  gitlabId: text("gitlabId").references(() => gitlab.gitlabId, {
    onDelete: "set null",
  }),
  gitlabProjectId: integer("gitlabProjectId"),
  gitlabPathNamespace: text("gitlabPathNamespace"),
  
  // ... rest of fields ...
});
```

## API Design

### TRPC Router: `gitlab-preview-deployment`

```typescript
export const gitlabPreviewDeploymentRouter = createTRPCRouter({
  /**
   * List all preview deployments for an application
   */
  all: protectedProcedure
    .input(z.object({ applicationId: z.string() }))
    .query(async ({ input, ctx }) => {
      const app = await findApplicationById(input.applicationId);
      validateOrganizationAccess(app, ctx.session.activeOrganizationId);
      return findPreviewDeploymentsByApplicationId(input.applicationId);
    }),
  
  /**
   * Get a single preview deployment
   */
  one: protectedProcedure
    .input(z.object({ previewDeploymentId: z.string() }))
    .query(async ({ input, ctx }) => {
      const preview = await findPreviewDeploymentById(input.previewDeploymentId);
      validateOrganizationAccess(preview.application, ctx.session.activeOrganizationId);
      return preview;
    }),
  
  /**
   * Manually trigger a preview deployment
   */
  trigger: protectedProcedure
    .input(z.object({
      applicationId: z.string(),
      mergeRequestIid: z.number(),
      gitlabProjectId: z.number(),
    }))
    .mutation(async ({ input, ctx }) => {
      const app = await findApplicationById(input.applicationId);
      validateOrganizationAccess(app, ctx.session.activeOrganizationId);
      
      // Fetch MR details from GitLab API
      const mrDetails = await fetchGitlabMRDetails(
        app.gitlabId,
        input.gitlabProjectId,
        input.mergeRequestIid
      );
      
      // Create preview deployment
      return createGitlabPreviewDeployment({
        applicationId: input.applicationId,
        mergeRequestData: mrDetails,
        gitlabProvider: app.gitlab,
      });
    }),
  
  /**
   * Delete a preview deployment
   */
  delete: protectedProcedure
    .input(z.object({ previewDeploymentId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const preview = await findPreviewDeploymentById(input.previewDeploymentId);
      validateOrganizationAccess(preview.application, ctx.session.activeOrganizationId);
      
      await removePreviewDeployment(input.previewDeploymentId);
      return true;
    }),
});
```

### REST API Endpoints

#### Webhook Endpoint

```
POST /api/providers/gitlab/webhook
```

**Headers:**
- `X-Gitlab-Token`: Webhook secret token
- `X-Gitlab-Event`: "Merge Request Hook"
- `Content-Type`: application/json

**Body:** GitLab MR webhook payload

**Response:**
- `200 OK`: Webhook processed
- `401 Unauthorized`: Invalid token
- `400 Bad Request`: Invalid payload
- `500 Internal Server Error`: Processing error

## Security Considerations

### 1. Webhook Verification

**Implementation:**
```typescript
function verifyGitlabWebhook(
  req: NextApiRequest,
  expectedToken: string
): boolean {
  const receivedToken = req.headers["x-gitlab-token"];
  
  if (!receivedToken || typeof receivedToken !== "string") {
    return false;
  }
  
  // Constant-time comparison to prevent timing attacks
  return crypto.timingSafeEqual(
    Buffer.from(receivedToken),
    Buffer.from(expectedToken)
  );
}
```

**Best Practices:**
- Use cryptographically random tokens (min 32 bytes)
- Store tokens encrypted in database
- Rotate tokens periodically
- Use HTTPS for all webhook endpoints
- Rate limit webhook endpoint

### 2. User Permission Validation

**Security Levels:**

| Setting | Behavior | Use Case |
|---------|----------|----------|
| `previewRequireCollaboratorPermissions: true` (default) | Require Developer+ access | Public repos, security-critical apps |
| `previewRequireCollaboratorPermissions: false` | Allow any MR author | Private repos, trusted teams |

**Implementation:**
```typescript
async function validateMRAuthorPermissions(
  gitlabProvider: Gitlab,
  projectId: number,
  userId: number,
  app: Application
): Promise<{ allowed: boolean; reason?: string }> {
  // Skip check if disabled
  if (!app.previewRequireCollaboratorPermissions) {
    return { allowed: true };
  }
  
  // Check permissions
  const { hasAccess, accessLevel } = await checkGitlabUserPermissions(
    gitlabProvider,
    projectId,
    userId,
    30 // Developer minimum
  );
  
  if (!hasAccess) {
    return {
      allowed: false,
      reason: `User access level (${accessLevel || "none"}) is below Developer (30)`
    };
  }
  
  return { allowed: true };
}
```

**Audit Logging:**
```typescript
// Log all permission checks
await logSecurityEvent({
  type: "preview_deployment_permission_check",
  userId,
  projectId,
  applicationId: app.applicationId,
  accessLevel,
  allowed,
  timestamp: new Date().toISOString(),
});

// Alert on blocked attempts
if (!allowed) {
  await sendSecurityAlert({
    severity: "warning",
    message: `Blocked preview deployment attempt from user ${userId}`,
    details: { projectId, applicationId: app.applicationId },
  });
}
```

### 3. Token Management

**Access Token Security:**
- Store tokens encrypted at rest
- Implement automatic refresh before expiry
- Handle refresh failures gracefully
- Revoke tokens on provider deletion

**Refresh Token Flow:**
```typescript
async function ensureValidAccessToken(
  gitlabProvider: Gitlab
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const expiryBuffer = 300; // 5 minutes
  
  // Check if token needs refresh
  if (gitlabProvider.expiresAt && 
      now + expiryBuffer >= gitlabProvider.expiresAt) {
    await refreshGitlabToken(gitlabProvider.gitlabId);
    const updated = await findGitlabById(gitlabProvider.gitlabId);
    return updated.accessToken;
  }
  
  return gitlabProvider.accessToken;
}
```

### 4. Resource Isolation

**Container Security:**
- Each preview runs in isolated container
- Limited resource allocation (CPU, memory)
- Network isolation between previews
- Read-only volumes where possible

**Environment Variables:**
- Use preview-specific env vars (`previewEnv`)
- Never expose production secrets
- Sanitize user-provided values
- Inject Dokploy metadata (preview URL, MR info)

### 5. Rate Limiting & DoS Protection

**Webhook Rate Limiting:**
```typescript
const webhookRateLimiter = new RateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // Max 100 requests per minute per IP
  message: "Too many webhook requests",
});

app.post("/api/providers/gitlab/webhook", webhookRateLimiter, handleWebhook);
```

**Deployment Queue:**
- Limit concurrent preview builds per org
- Queue excessive deployments
- Implement deployment timeouts
- Auto-cleanup on repeated failures

### 6. Data Privacy

**PII Handling:**
- Log minimal user information
- Redact tokens in logs
- Comply with data retention policies
- Allow user data export/deletion

## Implementation Plan

### Phase 1: Core Infrastructure (Week 1-2)

**Goal:** Establish foundation for GitLab preview deployments

#### Tasks:

1. **Database Schema** (2 days)
   - [ ] Create migration script for schema changes
   - [ ] Add GitLab fields to `applications` and `compose` tables
   - [ ] Extend `preview_deployments` with provider discrimination
   - [ ] Add `gitlab_webhooks` table
   - [ ] Test migrations on dev/staging databases

2. **GitLab Provider Service Enhancement** (3 days)
   - [ ] Implement `checkGitlabUserPermissions()`
   - [ ] Implement `createGitlabMRComment()`
   - [ ] Implement `updateGitlabMRComment()`
   - [ ] Implement `cloneGitlabRepositoryForPreview()`
   - [ ] Add webhook token generation and storage
   - [ ] Unit tests for all functions

3. **Webhook Endpoint** (3 days)
   - [ ] Create `/api/providers/gitlab/webhook.ts`
   - [ ] Implement webhook verification
   - [ ] Add event parsing and routing
   - [ ] Add rate limiting
   - [ ] Error handling and logging
   - [ ] Integration tests with mock payloads

**Deliverables:**
- Updated database schema
- Core GitLab API functions
- Webhook endpoint (basic routing)
- Unit and integration tests

### Phase 2: MR Lifecycle Handlers (Week 3-4)

**Goal:** Implement full MR lifecycle support

#### Tasks:

1. **MR Open/Update Handler** (4 days)
   - [ ] Implement `handleMergeRequestOpenOrUpdate()`
   - [ ] Permission validation
   - [ ] Label filtering
   - [ ] Preview limit checks
   - [ ] Create preview deployment
   - [ ] Post initial MR comment
   - [ ] Queue deployment job
   - [ ] Update comment on deployment status change

2. **MR Close/Merge Handler** (2 days)
   - [ ] Implement `handleMergeRequestClose()`
   - [ ] Find and cleanup preview deployments
   - [ ] Update MR comment with cleanup status
   - [ ] Handle errors gracefully

3. **MR Reopen Handler** (1 day)
   - [ ] Implement `handleMergeRequestReopen()`
   - [ ] Reactivate existing preview or create new one
   - [ ] Update MR comment

4. **Comment Templates** (1 day)
   - [ ] Design comment templates (building, success, error, security)
   - [ ] Implement template rendering
   - [ ] Add formatting and emojis

**Deliverables:**
- Complete MR lifecycle handling
- Comment templates
- Integration tests for each lifecycle event

### Phase 3: UI & Configuration (Week 5-6)

**Goal:** Enable users to configure GitLab preview deployments

#### Tasks:

1. **Application Settings UI** (4 days)
   - [ ] Add GitLab repository selector (similar to GitHub)
   - [ ] Add preview deployment configuration form
   - [ ] Add webhook setup instructions
   - [ ] Display webhook URL and secret
   - [ ] Add "Test Connection" button

2. **Preview Deployments Dashboard** (3 days)
   - [ ] Update preview list to support GitLab
   - [ ] Show MR details (title, author, branch)
   - [ ] Add link to GitLab MR
   - [ ] Add manual trigger button
   - [ ] Add delete button

3. **GitLab Provider Management** (2 days)
   - [ ] Update GitLab provider add/edit forms
   - [ ] Add webhook configuration fields
   - [ ] Test connection with GitLab API
   - [ ] Display project/group access

**Deliverables:**
- Complete UI for GitLab preview deployments
- User-friendly configuration flow
- Documentation for setup

### Phase 4: Testing & Documentation (Week 7-8)

**Goal:** Ensure reliability and provide comprehensive documentation

#### Tasks:

1. **End-to-End Testing** (4 days)
   - [ ] Test with GitLab.com
   - [ ] Test with self-hosted GitLab (CE)
   - [ ] Test with self-hosted GitLab (EE)
   - [ ] Test full MR lifecycle (open → update → close)
   - [ ] Test permission checks (Developer, Guest, etc.)
   - [ ] Test label filtering
   - [ ] Test preview limits
   - [ ] Test concurrent deployments
   - [ ] Load testing for webhook endpoint

2. **Documentation** (3 days)
   - [ ] User guide: Setting up GitLab preview deployments
   - [ ] Admin guide: Configuring OAuth application
   - [ ] API documentation
   - [ ] Troubleshooting guide
   - [ ] Security best practices

3. **Code Review & Refinement** (2 days)
   - [ ] Code review with team
   - [ ] Address feedback
   - [ ] Performance optimizations
   - [ ] Security audit

**Deliverables:**
- Comprehensive test coverage
- User and admin documentation
- Production-ready code

### Phase 5: Advanced Features (Week 9-10) - Optional

**Goal:** Go beyond feature parity with GitHub

#### Tasks:

1. **Group-Level Webhooks (EE)** (2 days)
   - [ ] Support group webhooks for multiple projects
   - [ ] Shared configuration across group
   - [ ] Inheritance rules

2. **Deployment Approvals** (2 days)
   - [ ] Integrate with GitLab approval workflows (EE)
   - [ ] Block deployment until approved
   - [ ] Status check integration

3. **Enhanced Monitoring** (2 days)
   - [ ] Resource usage tracking for previews
   - [ ] Cost estimation
   - [ ] Automatic cleanup of old/unused previews

4. **Multi-Environment Previews** (2 days)
   - [ ] Support multiple preview environments per MR
   - [ ] Different configurations (e.g., staging, production-like)

**Deliverables:**
- Advanced features for power users
- Documentation for advanced features

## Testing Strategy

### Unit Tests

**Target Coverage:** 80%+

**Key Test Suites:**

1. **GitLab API Functions** (`packages/server/src/utils/providers/gitlab.test.ts`)
   - Test permission checking with various access levels
   - Test token refresh logic
   - Test comment creation/update
   - Mock GitLab API responses

2. **Preview Deployment Service** (`packages/server/src/services/preview-deployment.test.ts`)
   - Test preview creation with GitLab MR data
   - Test preview cleanup
   - Test finding previews by MR ID

3. **Webhook Verification** (`apps/dokploy/pages/api/providers/gitlab/webhook.test.ts`)
   - Test token verification
   - Test event parsing
   - Test error handling

**Example Test:**
```typescript
describe("checkGitlabUserPermissions", () => {
  it("should grant access to Developer (30)", async () => {
    const mockGitlab = createMockGitlab();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_level: 30 }),
    });
    
    const result = await checkGitlabUserPermissions(
      mockGitlab,
      123,
      456,
      30
    );
    
    expect(result.hasAccess).toBe(true);
    expect(result.accessLevel).toBe(30);
  });
  
  it("should deny access to Guest (10)", async () => {
    const mockGitlab = createMockGitlab();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_level: 10 }),
    });
    
    const result = await checkGitlabUserPermissions(
      mockGitlab,
      123,
      456,
      30
    );
    
    expect(result.hasAccess).toBe(false);
    expect(result.accessLevel).toBe(10);
  });
});
```

### Integration Tests

**Scenarios:**

1. **MR Lifecycle Flow**
   - Create application with GitLab repo
   - Trigger webhook: MR opened
   - Verify preview created
   - Verify comment posted to MR
   - Trigger webhook: New commit pushed
   - Verify preview redeployed
   - Trigger webhook: MR closed
   - Verify preview cleaned up

2. **Permission Validation**
   - Guest user opens MR → blocked, security comment posted
   - Developer opens MR → allowed, preview created
   - Maintainer opens MR → allowed, preview created

3. **Label Filtering**
   - MR without required label → no preview
   - MR with required label → preview created
   - Add label to existing MR → preview created
   - Remove label from MR → preview removed (optional)

4. **Preview Limits**
   - Create app with limit=2
   - Open 2 MRs → 2 previews created
   - Open 3rd MR → no preview created (limit reached)
   - Close 1 MR → preview cleaned up
   - Open new MR → preview created (under limit)

### End-to-End Tests

**Test Environments:**

1. **GitLab.com** (SaaS)
   - Create test project
   - Configure OAuth application
   - Set up webhook
   - Run full MR lifecycle

2. **Self-Hosted GitLab CE** (Docker)
   - Spin up GitLab CE container
   - Configure OAuth and webhook
   - Test custom domain support
   - Test token refresh

3. **Self-Hosted GitLab EE** (Optional)
   - Test EE-specific features
   - Test group webhooks
   - Test approval integrations

**Automated E2E Tests:**
- Use Playwright/Cypress for UI tests
- Mock GitLab webhooks in controlled environment
- Verify deployment status in Docker
- Verify comment updates in GitLab

### Performance Tests

**Load Testing:**
- Simulate 100 concurrent webhook requests
- Measure response time (target: <500ms)
- Verify no requests dropped
- Check database connection pool

**Stress Testing:**
- Simulate 1000 MRs opened simultaneously
- Verify queue handles load gracefully
- Monitor resource usage (CPU, memory, disk)
- Test with preview limits (e.g., 100 concurrent previews)

### Security Tests

**Penetration Testing:**
- Try to bypass webhook verification
- Attempt SQL injection in webhook payload
- Test for XSS in MR comments
- Verify token encryption at rest

**Compliance:**
- Audit permission checks
- Verify minimal logging of PII
- Test token rotation

## Migration Strategy

### Backward Compatibility

**Goals:**
- Existing GitHub preview deployments continue to work
- No breaking changes to existing APIs
- Graceful transition for users

**Approach:**

1. **Database Schema:**
   - Add new columns with nullable/default values
   - Keep existing columns (e.g., `pullRequestId`)
   - Use `provider` field to discriminate

2. **API Endpoints:**
   - Keep existing GitHub webhook endpoint
   - Add new GitLab webhook endpoint
   - Share common business logic via services

3. **UI Updates:**
   - Add GitLab options to existing forms
   - Auto-detect provider based on application configuration
   - Show appropriate fields based on provider

### Deployment Steps

**Pre-Deployment:**
1. [ ] Review and approve RFC
2. [ ] Create feature branch
3. [ ] Run database migration on staging
4. [ ] Deploy to staging environment
5. [ ] Run full test suite on staging

**Deployment:**
1. [ ] Schedule maintenance window (if needed)
2. [ ] Backup production database
3. [ ] Run database migrations
4. [ ] Deploy new code
5. [ ] Verify webhook endpoints are accessible
6. [ ] Monitor logs for errors

**Post-Deployment:**
1. [ ] Verify existing GitHub preview deployments work
2. [ ] Test new GitLab preview deployment (end-to-end)
3. [ ] Monitor performance metrics
4. [ ] Address any issues reported by users
5. [ ] Update documentation and announce feature

### Rollback Plan

**If Issues Arise:**
1. [ ] Revert code deployment to previous version
2. [ ] Rollback database migrations (if safe)
3. [ ] Restore from backup (if necessary)
4. [ ] Investigate root cause
5. [ ] Fix issues in development
6. [ ] Re-deploy after thorough testing

**Database Rollback:**
```sql
-- Remove new columns (if safe)
ALTER TABLE preview_deployments DROP COLUMN provider;
ALTER TABLE preview_deployments DROP COLUMN merge_request_id;
-- ... etc

-- Drop new tables
DROP TABLE gitlab_webhooks;
```

## Future Enhancements

### Short-Term (3-6 months)

1. **Bitbucket Support**
   - Extend preview deployment framework to Bitbucket
   - Leverage shared infrastructure

2. **Preview Environment Variables**
   - UI to manage preview-specific env vars
   - Templating support (e.g., `PR_NUMBER`, `BRANCH_NAME`)

3. **Deployment Metrics**
   - Track build time, success rate
   - Display metrics in dashboard

4. **Webhook Replay**
   - Ability to manually replay webhook events
   - Useful for debugging

### Medium-Term (6-12 months)

5. **Multi-Region Previews**
   - Deploy previews to different regions
   - Edge locations for faster access

6. **Preview Templates**
   - Pre-configured preview setups for common frameworks
   - One-click preview deployment

7. **Cost Management**
   - Track resource costs per preview
   - Set budgets and alerts
   - Auto-cleanup based on cost

8. **Collaboration Features**
   - Share preview links with team
   - Comments on preview deployments
   - Visual regression testing

### Long-Term (12+ months)

9. **AI-Powered Optimization**
   - Predict optimal preview configurations
   - Auto-scale based on usage patterns
   - Smart resource allocation

10. **Enterprise Features**
    - SSO integration for preview access
    - RBAC for preview management
    - Audit trails and compliance reports

11. **Developer Platform**
    - Webhook API for custom integrations
    - Plugin system for extending preview functionality
    - SDKs for popular languages

## References

### GitLab Documentation

- [GitLab Webhooks](https://docs.gitlab.com/user/project/integrations/webhooks/)
- [GitLab Webhook Events](https://docs.gitlab.com/user/project/integrations/webhook_events/)
- [GitLab REST API](https://docs.gitlab.com/api/rest/)
- [GitLab Members API](https://docs.gitlab.com/api/members/)
- [GitLab Notes API](https://docs.gitlab.com/api/notes/)
- [GitLab Merge Requests API](https://docs.gitlab.com/api/merge_requests/)
- [GitLab OAuth2 Authentication](https://docs.gitlab.com/api/rest/authentication/)
- [GitLab Roles and Permissions](https://docs.gitlab.com/user/permissions/)

### Related Issues

- [#1483: GitLab preview deployment support](https://github.com/Dokploy/dokploy/issues/1483)
- [#2723: Enhance preview deployment lifecycle](https://github.com/Dokploy/dokploy/issues/2723)

### Internal Documentation

- `packages/server/src/services/preview-deployment.ts` - Current preview deployment implementation
- `apps/dokploy/pages/api/deploy/github.ts` - GitHub webhook handler
- `packages/server/src/utils/providers/github.ts` - GitHub API utilities
- `packages/server/src/utils/providers/gitlab.ts` - GitLab API utilities (existing)

### External Resources

- [GitHub Pull Request Webhooks](https://docs.github.com/en/developers/webhooks-and-events/webhooks/webhook-events-and-payloads#pull_request) - For comparison
- [Vercel Preview Deployments](https://vercel.com/docs/deployments/preview-deployments) - Industry reference
- [Netlify Deploy Previews](https://docs.netlify.com/site-deploys/deploy-previews/) - Industry reference

---

## Appendix A: Comparison with GitHub Implementation

| Feature | GitHub App | GitLab OAuth | Notes |
|---------|------------|--------------|-------|
| Authentication | App Installation | OAuth2 Access Token | GitLab requires token refresh |
| Webhook Verification | HMAC SHA-256 | Secret Token | GitLab uses simpler approach |
| Permission Check | Collaborator API | Members API | Similar but different endpoints |
| Comment API | Issues API | Notes API | Different but equivalent |
| MR/PR Lifecycle | open, sync, reopen, close | open, update, reopen, close, merge | GitLab has explicit merge event |
| Label Support | Native | Native | Both support labels |
| Approval Workflows | Limited | Native (EE) | GitLab EE has built-in approvals |
| Group-Level Webhooks | No | Yes (EE) | GitLab EE advantage |
| Self-Hosted | GitHub Enterprise | GitLab CE/EE | GitLab CE is free |

## Appendix B: Sample Webhook Payloads

### GitLab MR Opened

```json
{
  "object_kind": "merge_request",
  "event_type": "merge_request",
  "user": {
    "id": 10,
    "name": "John Doe",
    "username": "johndoe",
    "avatar_url": "https://gitlab.com/uploads/-/avatar.png",
    "email": "john@example.com"
  },
  "project": {
    "id": 42,
    "name": "Awesome Project",
    "description": "A cool project",
    "web_url": "https://gitlab.com/group/awesome-project",
    "avatar_url": null,
    "git_ssh_url": "git@gitlab.com:group/awesome-project.git",
    "git_http_url": "https://gitlab.com/group/awesome-project.git",
    "namespace": "Group",
    "visibility_level": 20,
    "path_with_namespace": "group/awesome-project",
    "default_branch": "main"
  },
  "object_attributes": {
    "id": 99,
    "iid": 1,
    "target_branch": "main",
    "source_branch": "feature-branch",
    "source_project_id": 42,
    "author_id": 10,
    "title": "Feature: Add new feature",
    "description": "This MR adds a new feature",
    "state": "opened",
    "created_at": "2025-12-06T00:00:00Z",
    "updated_at": "2025-12-06T00:00:00Z",
    "merge_status": "unchecked",
    "target_project_id": 42,
    "url": "https://gitlab.com/group/awesome-project/-/merge_requests/1",
    "action": "open",
    "last_commit": {
      "id": "abc123def456",
      "message": "feat: add new feature",
      "timestamp": "2025-12-06T00:00:00Z",
      "url": "https://gitlab.com/group/awesome-project/-/commit/abc123def456",
      "author": {
        "name": "John Doe",
        "email": "john@example.com"
      }
    }
  },
  "labels": [
    {
      "id": 1,
      "title": "deploy-preview",
      "color": "#0033CC",
      "project_id": 42,
      "created_at": "2025-01-01T00:00:00Z",
      "updated_at": "2025-01-01T00:00:00Z",
      "description": "Auto-deploy preview"
    }
  ]
}
```

### GitLab MR Updated (New Commit)

```json
{
  "object_kind": "merge_request",
  "event_type": "merge_request",
  "object_attributes": {
    "id": 99,
    "iid": 1,
    "action": "update",
    "state": "opened",
    "last_commit": {
      "id": "def456ghi789",
      "message": "fix: update feature",
      "timestamp": "2025-12-06T01:00:00Z"
    }
  }
  // ... rest of payload similar to open event
}
```

### GitLab MR Closed

```json
{
  "object_kind": "merge_request",
  "event_type": "merge_request",
  "object_attributes": {
    "id": 99,
    "iid": 1,
    "action": "close",
    "state": "closed"
  }
  // ... rest of payload
}
```

## Appendix C: Security Checklist

- [ ] Webhook secret tokens are cryptographically random (min 32 bytes)
- [ ] Webhook verification uses constant-time comparison
- [ ] All webhook endpoints use HTTPS
- [ ] Access tokens are encrypted at rest
- [ ] Refresh tokens are encrypted at rest
- [ ] Token refresh happens automatically before expiry
- [ ] Permission checks occur before every preview deployment
- [ ] Security events are logged (blocked attempts, permission failures)
- [ ] Rate limiting is enabled on webhook endpoint
- [ ] User-provided input is sanitized (MR titles, branch names, etc.)
- [ ] Preview environments are isolated from production
- [ ] Preview environment variables do not contain production secrets
- [ ] Resource limits are enforced on preview containers
- [ ] Old/unused previews are automatically cleaned up
- [ ] Audit logs are retained for compliance
- [ ] PII is minimized in logs
- [ ] Security documentation is provided to users
- [ ] Incident response plan is documented
- [ ] Regular security reviews are scheduled

---

**End of RFC**

For questions, feedback, or contributions, please open an issue on GitHub or join our Discord community.
