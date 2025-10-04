# Authentication Hardening Checklist

## Password Recovery
- Supabase redirect whitelist must include `/auth/recover`.
- After adding the redirect, remove legacy `/auth/callback?next=/profile/change-password` entry.
- Password reset emails now send users to `/auth/recover`; ensure DNS + HTTPS is valid so Supabase treats the origin as secure.
- Recovery flow expects the `type=recovery` fragment or a one-time `code`; both lead to an exchange before presenting the password form.
- The page preserves an optional `redirectedFrom` path (validated to stay on-site) so users resume where they left off after resetting their password.
- If a user reports "Link not recognised", capture the full URL they landed on and check the browser console for an `Unsupported password recovery payload` warning—this means the link was stripped of its tokens (often by email relay/safelinks) or is stale; request a fresh reset email.

## Sessions in Middleware
- `src/middleware.ts` calls the auth helper to refresh sessions on every request.
- If users report unexpected logouts, check for revoked refresh tokens or invalid cookie signatures in Supabase logs.

## Login Event Auditing
- Login and logout now run through server actions in `src/app/actions/auth.ts`.
- Audit entries appear in `audit_logs` with operation types `login`, `login_failed`, and `logout`.
- Rate limiting: 5 attempts/minute per IP. Update `checkRateLimit` config before high-traffic deployments.

## Manual QA
- Smoke test: login success/failure, password reset email + recovery, logout and re-login.
- Mobile & desktop browsers should retain the `redirectedFrom` query when middleware bounces unauthenticated users.

## Monitoring
- Alert on consecutive password reset failures by checking Supabase auth logs or the audit log table.
- Consider adding Playwright coverage for login + recovery when credentials are available in CI secrets.
