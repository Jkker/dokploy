# RFC: GitLab Merge Request Preview Deployments

## Context
- Issues: Dokploy#1483, Dokploy#2723
- Goal: Achieve full feature parity between GitHub and GitLab preview deployments (CE + EE) across the entire MR lifecycle while reusing the existing GitLab App integration.

## Objectives
- Support end-to-end MR lifecycle hooks: open/reopen/update/label changes → create/update preview; merge/close → teardown.
- Reuse existing preview settings (wildcard domains, limits, labels, security toggle, env/build overrides).
- Surface status via MR notes identical to GitHub comment table (initializing → running → success/error).
- Enforce safety: optional collaborator permission gate, token/secret validation, cleanup guarantees.
- Keep backward compatibility with existing GitLab provider setup and data model.

## Functional Requirements
1. **Webhook ingestion (GitLab App/Webhooks)**
   - Accept `Merge Request Hook` events with actions: `open`, `reopen`, `update`, label changes, `merge`, `close`.
   - Validate `X-Gitlab-Token` against the configured GitLab App secret.
   - Ignore non-MR events.
2. **Target resolution**
   - Match applications by `gitlabProjectId`, `gitlabPathNamespace`, `gitlabBranch` (target branch), `gitlabId`, and `isPreviewDeploymentsActive=true`.
   - Enforce `previewLimit` and optional `previewLabels` gates.
3. **Security**
   - When `previewRequireCollaboratorPermissions` is true, allow only MR authors with Developer+ access (30+) on the project; otherwise post a security note once and skip deployment.
4. **Preview creation**
   - Create preview deployment records with MR metadata (id, iid, title, URL, source branch).
   - Provision domain via existing wildcard logic and Traefik integration.
   - Post MR note with preview table; store note id for subsequent updates.
5. **Preview deployment**
   - Clone via GitLab token (respect submodules), build using preview args/env, deploy container, and update MR note to running/success/error.
6. **Teardown**
   - On MR close/merge remove services, deployments, domains, code checkout, and DB row.
7. **Parity/UX**
   - Same comment body, security messaging, label gating, and limit behavior as GitHub previews.

## Non-Functional Requirements
- Works for GitLab CE/EE/self-managed.
- Token refresh supported via existing `refreshGitlabToken`.
- Idempotent, resilient to duplicate hooks; safe retries.
- Minimal schema churn; no user-visible breaking changes.

## Design
1. **Webhook endpoint**
   - New Next.js API route `/api/deploy/gitlab` mirroring the GitHub handler.
   - Validate `X-Gitlab-Token` === GitLab App secret.
   - Extract project + MR data (`project.id`, `project.path_with_namespace`, `object_attributes.target_branch/source_branch`, `iid`, `id`, `title`, `url`, `last_commit.id`, `labels`).
2. **Security gate**
   - New helper to check member access level via `/projects/:id/members/all/:user_id`; require access_level >= 30 (Developer).
   - Security note posted once per MR when blocked.
3. **Comments/notes**
   - New GitLab note helpers: create, update, existence check using `/projects/:id/merge_requests/:iid/notes`.
   - Shared comment body generator reused from GitHub for parity.
4. **Preview lifecycle**
   - Extend preview creation to branch by provider (GitHub vs GitLab) when creating the initial note and storing `pullRequestCommentId`.
   - Extend preview deployment executor to handle GitLab clones and MR note updates.
5. **Cleanup**
   - On MR `merge` or `close`, delete associated preview deployments and infra via existing teardown pipeline.

## Implementation Plan
1. Add webhook route `/api/deploy/gitlab` with MR event handling, token validation, security check, label/limit gates, creation/teardown logic, and queue dispatch.
2. Add GitLab MR note utilities (create/update/check) + security note helper + permission check helper.
3. Update preview creation/deployment services to support GitLab (commenting + clone/build path).
4. Add focused tests for new helper logic (permission mapping/note body), and update docs.
5. Validate with targeted vitest scope (new tests) acknowledging existing unrelated real-deploy failures.

## Rollout & Backwards Compatibility
- No schema changes; reuses existing GitLab App secret as webhook token.
- Existing GitHub flows untouched.
- Self-managed GitLab supported (URL configurable).

## Open Items / Future Work
- Optional dedicated webhook secret field (if separation from App secret is desired).
- Optional MR pipeline status reporting (post-build logs, artifact links).
- UI wizard to auto-provision GitLab project hooks via API.
