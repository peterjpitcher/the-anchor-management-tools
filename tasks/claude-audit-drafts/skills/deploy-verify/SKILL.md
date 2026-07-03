---
name: deploy-verify
description: Use after any git push to a Vercel-deployed project, or whenever claiming something is "live", "shipped", or "deployed". Verifies the deployment actually built (Ready) and that the production alias moved to the new commit. Triggers - "verify the deploy", "is it live", "check the deployment", or any completion claim following a push.
---

# Deploy Verify

A push is not a deploy. Never report work as live until the checks below pass.

## Steps

1. **Identify the commit and project.** `git rev-parse --short HEAD` for the sha. Project name from `.vercel/project.json` or the repo name.

2. **Special case — the-anchor.pub website repo is a MANUAL deploy.** A push there deploys nothing. Report: "pushed; website requires manual deploy" and stop. (anchor-management-tools auto-deploys main.)

3. **Find the deployment for this commit:**
   ```bash
   vercel ls <project> | head -8
   ```
   Match the newest deployment to the pushed commit (`vercel inspect <deployment-url>` shows the commit sha in its metadata). If no new deployment appears within ~2 minutes, wait and retry once.

4. **Check state = Ready.** `vercel inspect <deployment-url>` → state must be `READY`. `ERROR` → fetch build logs (`vercel logs <url>` or dashboard) and report the failure; the work is NOT shipped.

5. **Check the production alias moved:**
   ```bash
   vercel ls <project> --prod | head -5
   ```
   The production deployment must be the one from step 3 (same sha/age). A Ready preview with an unmoved prod alias is still not shipped.

6. **Smoke-test if the change is user-facing:** hit the affected route on the prod domain and confirm the change is present (or at minimum that the route returns 200 and no new errors appear in `vercel logs`).

## Reporting

Always end with one of:
- **Done — deployed and verified**: commit `<sha>` is Ready and serving at `<prod domain>`.
- **Not done — pushed but NOT verified live**: <exactly which check failed or could not be run>.

Never say "deployed", "live", or "shipped" without step 4 AND step 5 passing.
