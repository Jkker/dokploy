# GitLab Preview Deployments - Quick Reference

**Status:** RFC Draft  
**Created:** 2025-12-06

## 📋 Documents

1. **[RFC-GITLAB-PREVIEW-DEPLOYMENTS.md](./RFC-GITLAB-PREVIEW-DEPLOYMENTS.md)** - Full technical specification (52KB)
2. **[IMPLEMENTATION-PLAN-GITLAB-PREVIEW.md](./IMPLEMENTATION-PLAN-GITLAB-PREVIEW.md)** - Detailed implementation plan (42KB)
3. **This Document** - Quick reference and summary

## 🎯 Executive Summary

This proposal adds GitLab preview deployment support to Dokploy, achieving feature parity with the existing GitHub App implementation while adding GitLab-specific enhancements. The solution supports both GitLab CE and EE, self-hosted instances, and the full merge request lifecycle.

## 🚀 Key Features

### Core Features (Must Have)
- ✅ **Full MR Lifecycle**: open, update, reopen, close, merge events
- ✅ **Security & Permissions**: Developer/Maintainer/Owner validation
- ✅ **Status Comments**: Real-time updates on merge requests
- ✅ **GitLab CE & EE**: Compatible with both editions
- ✅ **Self-Hosted Support**: Works with GitLab.com and custom domains
- ✅ **Label Filtering**: Deploy only MRs with specific labels
- ✅ **Preview Limits**: Configurable concurrent preview limits
- ✅ **Token Management**: Automatic OAuth2 token refresh

### Beyond GitHub Parity
- 🎉 **Self-Hosted GitLab**: Full support for custom instances
- 🎉 **Inherited Permissions**: Support group-level access rights
- 🎉 **Explicit Merge Event**: Separate handling for merged MRs
- 🎉 **Group Webhooks (EE)**: Optional support for EE features

## 📊 Timeline

| Phase | Duration | Deliverables |
|-------|----------|--------------|
| **Phase 1**: Core Infrastructure | 2 weeks | Database schema, GitLab API, webhook endpoint |
| **Phase 2**: MR Lifecycle | 2 weeks | Event handlers, comment templates |
| **Phase 3**: UI & Config | 2 weeks | Settings UI, dashboard updates |
| **Phase 4**: Testing & Docs | 2 weeks | E2E tests, documentation |
| **Phase 5**: Advanced (Optional) | 2 weeks | Group webhooks, approvals, monitoring |

**Total:** 8-10 weeks

## 🔑 Key Technical Decisions

### 1. Provider Discrimination
```typescript
// preview_deployments table
provider: "github" | "gitlab"
```
- Maintains backward compatibility
- Allows future providers (Bitbucket, Gitea)
- Fields specific to each provider are nullable

### 2. Webhook Authentication
- **GitHub**: HMAC SHA-256 signature verification
- **GitLab**: Secret token in `X-Gitlab-Token` header
- Constant-time comparison with length check

### 3. Permission Levels
| Role | Access Level | Can Deploy? |
|------|--------------|-------------|
| Guest | 10 | ❌ |
| Reporter | 20 | ❌ |
| Developer | 30 | ✅ |
| Maintainer | 40 | ✅ |
| Owner | 50 | ✅ |

Default: Require Developer (30) or higher

### 4. MR Event Mapping

| GitLab Action | GitHub Equivalent | Preview Action |
|---------------|-------------------|----------------|
| `open` | `opened` | Create preview |
| `update` | `synchronize` | Redeploy preview |
| `reopen` | `reopened` | Recreate preview |
| `close` | `closed` | Cleanup preview |
| `merge` | `closed` (merged=true) | Cleanup preview |

## 📝 Database Schema Changes

### New Fields in `preview_deployments`
```sql
provider TEXT DEFAULT 'github'
merge_request_id TEXT
merge_request_iid TEXT
merge_request_url TEXT
merge_request_title TEXT
merge_request_comment_id TEXT
gitlab_project_id INTEGER
```

### New Fields in `applications` & `compose`
```sql
gitlab_id TEXT REFERENCES gitlab(gitlab_id)
gitlab_project_id INTEGER
gitlab_path_namespace TEXT
```

### New Field in `gitlab`
```sql
webhook_secret TEXT
```

## 🔒 Security Highlights

### Webhook Verification
```typescript
// Verify X-Gitlab-Token header
const receivedBuffer = Buffer.from(receivedToken, "utf8");
const expectedBuffer = Buffer.from(expectedToken, "utf8");

// Length check prevents timing attacks
if (receivedBuffer.length !== expectedBuffer.length) {
  return false;
}

// Constant-time comparison
return crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
```

### Permission Validation
```typescript
// Check user access level via GitLab API
const { hasAccess, accessLevel } = await checkGitlabUserPermissions(
  gitlabProvider,
  projectId,
  userId,
  30 // Developer minimum
);

if (!hasAccess) {
  // Post security comment and block deployment
  await postGitlabSecurityBlockedComment(...);
  return;
}
```

### Token Management
- OAuth2 access tokens expire after ~2 hours
- Automatic refresh before expiry (5-minute buffer)
- Secure storage (encrypted at rest)
- Fallback to refresh token on API errors

## 🛠️ API Design

### GitLab API Functions
```typescript
// Check user permissions
checkGitlabUserPermissions(provider, projectId, userId, minLevel)

// Create/update MR comments
createGitlabMRComment(provider, projectId, mrIid, body)
updateGitlabMRComment(provider, projectId, mrIid, noteId, body)

// Clone repository
cloneGitlabRepositoryForPreview(preview, app, provider)

// Token management
refreshGitlabToken(gitlabId)
ensureValidAccessToken(provider)
```

### tRPC Router
```typescript
gitlabPreviewDeploymentRouter = {
  all: (applicationId) => PreviewDeployment[]
  one: (previewDeploymentId) => PreviewDeployment
  trigger: (applicationId, mrIid, projectId) => PreviewDeployment
  delete: (previewDeploymentId) => boolean
}
```

### Webhook Endpoint
```
POST /api/providers/gitlab/webhook
Headers:
  X-Gitlab-Token: <secret>
  X-Gitlab-Event: "Merge Request Hook"
Body: GitLab MR webhook payload
```

## 📈 Success Metrics

### Technical
- Webhook uptime: 99.9%
- Response time p95: <500ms
- Deployment success rate: >95%
- Test coverage: >80%

### User
- Time to configure first preview: <15 minutes
- User satisfaction: >4/5
- Support tickets: <5/week

## 🧪 Testing Strategy

### Unit Tests
- GitLab API functions
- Permission checking logic
- Token refresh mechanism
- Comment template rendering

### Integration Tests
- MR lifecycle (open → update → close)
- Permission validation (Guest, Developer, Maintainer)
- Label filtering
- Preview limits

### E2E Tests
- GitLab.com integration
- Self-hosted GitLab CE
- Full deployment workflow
- Error scenarios

### Performance Tests
- 100 concurrent webhooks
- 50 simultaneous deployments
- Large datasets (1000+ previews)

## 📦 Deliverables

### Code
- [ ] Database migrations
- [ ] GitLab API service enhancements
- [ ] Webhook endpoint implementation
- [ ] MR lifecycle handlers
- [ ] Comment templates
- [ ] UI components for GitLab config
- [ ] Preview dashboard updates

### Documentation
- [ ] User guide: Setting up GitLab preview deployments
- [ ] Admin guide: OAuth application configuration
- [ ] API documentation
- [ ] Troubleshooting guide
- [ ] Security best practices
- [ ] Migration guide

### Tests
- [ ] Unit tests (>80% coverage)
- [ ] Integration tests
- [ ] E2E tests (GitLab.com + self-hosted)
- [ ] Performance tests
- [ ] Security audit

## 🚧 Known Limitations

### GitLab CE vs EE
- **CE**: No group-level webhooks (project-level only)
- **EE**: Additional features like approval workflows, external status checks

### Future Considerations
- Bitbucket support (similar architecture)
- Gitea support (self-hosted)
- Multi-environment previews
- Visual regression testing
- Resource usage tracking

## 🔗 Related Issues

- [#1483: GitLab preview deployment support](https://github.com/Dokploy/dokploy/issues/1483)
- [#2723: Enhanced preview deployment lifecycle](https://github.com/Dokploy/dokploy/issues/2723)

## 📚 Resources

### GitLab Documentation
- [Webhooks](https://docs.gitlab.com/user/project/integrations/webhooks/)
- [Webhook Events](https://docs.gitlab.com/user/project/integrations/webhook_events/)
- [Members API](https://docs.gitlab.com/api/members/)
- [Notes API](https://docs.gitlab.com/api/notes/)
- [OAuth2 Authentication](https://docs.gitlab.com/api/rest/authentication/)

### Dokploy Internal
- `packages/server/src/services/preview-deployment.ts` - Current implementation
- `apps/dokploy/pages/api/deploy/github.ts` - GitHub webhook handler
- `packages/server/src/utils/providers/gitlab.ts` - GitLab utilities

## 🎓 Quick Start (After Implementation)

### 1. Create GitLab OAuth Application
```
GitLab > User Settings > Applications
Name: Dokploy
Redirect URI: https://dokploy.example.com/api/providers/gitlab/callback
Scopes: api
```

### 2. Add GitLab Provider in Dokploy
```
Settings > Git Providers > Add GitLab
- Name: My GitLab
- GitLab URL: https://gitlab.com
- Application ID: <from step 1>
- Secret: <from step 1>
```

### 3. Configure Application
```
Applications > [Your App] > General
- Source Provider: GitLab
- Project: [Select from dropdown]
- Branch: main
```

### 4. Enable Preview Deployments
```
Applications > [Your App] > Preview Deployments
- Enable: ✓
- Wildcard Domain: *.preview.example.com
- Labels: deploy-preview (optional)
- Limit: 3
- Security: Require Developer access ✓
```

### 5. Set Up Webhook in GitLab
```
GitLab Project > Settings > Webhooks
URL: https://dokploy.example.com/api/providers/gitlab/webhook
Secret Token: <from Dokploy>
Trigger: Merge request events
```

### 6. Test
```
1. Create merge request in GitLab
2. Watch Dokploy create preview deployment
3. See comment on MR with preview URL
4. Close MR, watch preview cleanup
```

## 💡 Pro Tips

1. **Use Labels**: Configure required labels to control which MRs get previews
2. **Set Limits**: Prevent resource exhaustion with preview limits (e.g., 3-5)
3. **Enable Security**: Always require Developer access for public repos
4. **Monitor Tokens**: Set up alerts for token refresh failures
5. **Custom Domains**: Use wildcard DNS for easier preview URL management
6. **Environment Variables**: Use `previewEnv` for preview-specific configs

## 🆘 Troubleshooting

### Webhook Not Triggering
- ✅ Check webhook secret matches
- ✅ Verify webhook URL is accessible from GitLab
- ✅ Check webhook delivery logs in GitLab
- ✅ Verify "Merge request events" is enabled

### Deployment Fails
- ✅ Check Dokploy logs for errors
- ✅ Verify GitLab token is valid (not expired)
- ✅ Check repository access permissions
- ✅ Verify Docker resources available

### Permission Denied
- ✅ Check user has Developer (30) or higher access
- ✅ Verify `previewRequireCollaboratorPermissions` setting
- ✅ Check if access is inherited from group

### Token Expired
- ✅ Token refresh should happen automatically
- ✅ Check refresh token is valid
- ✅ Re-authenticate GitLab provider if needed

## 🏁 Next Steps

1. ✅ Review and approve RFC
2. ⏳ Create implementation branch
3. ⏳ Begin Phase 1: Core Infrastructure
4. ⏳ Set up test environment (GitLab.com + self-hosted)
5. ⏳ Iterate through phases
6. ⏳ Deploy to production

---

**For detailed information, see:**
- 📘 [Full RFC](./RFC-GITLAB-PREVIEW-DEPLOYMENTS.md)
- 📋 [Implementation Plan](./IMPLEMENTATION-PLAN-GITLAB-PREVIEW.md)

**Questions?** Open an issue or join the Discord community.
