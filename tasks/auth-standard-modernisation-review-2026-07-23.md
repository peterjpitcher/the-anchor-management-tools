# Auth Standard Modernisation Review (2026-07-23)

Discovery and decisions only. No code changes in this piece of work. Output of this review: an agreed new standard, then an update to `.claude/docs/auth-standard.md` (workspace root) and the `auth-standardiser` skill (checklist, auditor, snapshots) to match.

## 1. The written standard today (plain English)

Source: `/Users/peterpitcher/Cursor/.claude/docs/auth-standard.md`, last amended 2026-06-26. Fifteen sections:

1. **Three Supabase clients** (browser, server, admin), strict separation, PKCE flow, no ad-hoc clients.
2. **One middleware** that refreshes the session with `getUser()`, allowlists public paths, sets security headers and a strict CSP, gates unauthenticated users, validates a custom session cookie, and issues a CSRF token.
3. **Sessions never time out.** Users stay signed in until they sign out or are revoked. A custom session record in Upstash Redis exists purely so an admin can kill a session instantly.
4. **CSRF protection** via a double-submit cookie on every mutation.
5. **Account lockout**: 5 failed logins in 15 minutes locks the account for 30 minutes; separate rate limiting.
6. **CAPTCHA** (Cloudflare Turnstile) on login and forgot-password.
7. **Server-side auth check on every page, action and route.** Roles are app-specific but must live in `app_metadata`.
8. **Email + password only.** Magic links, OAuth and passwordless are explicitly banned. Sign-up is invite-only, no public registration. Reset links last 60 minutes, invites 7 days.
9. **Audit logging** of all auth events, with emails hashed.
10. **Password policy**: minimum 12 characters, no composition rules (banned outright), breached-password (HIBP) check.
11. **Plain-text emails** replacing every default Supabase template.
12. **RLS on every table** with explicit policies, delivered as migrations, with tests.
13. **Startup env validation**: fail fast if config is missing.
14. **2FA optional** (Supabase TOTP) per app.
15. **Mandatory test coverage** for all of the above.

## 2. What the app actually does (evidence from discovery)

Working tree at `590711ba` (main tip, detached).

| Standard says | AMS reality | Evidence |
|---|---|---|
| Custom Redis session layer | Absent. Plain Supabase cookie sessions | no `app-session-id`, no session store; Upstash only used for rate limiting (`src/lib/distributed-rate-limit.ts`) |
| CSRF double-submit middleware | Absent. Relies on Server Actions origin checks + SameSite cookies | zero `csrf` hits in `src/**` |
| Turnstile on login | Absent on login; present only on public recruitment booking | `RecruitmentBookingClient.tsx:48-78` |
| Account lockout table | Absent. In-memory per-IP 5/min limit only (resets on redeploy, not shared across instances) | `src/services/auth.ts:9`, `src/lib/rate-limit.ts:29-82` |
| Min 12 chars, no composition rules, HIBP | Min 8 everywhere; change-password path adds 3-of-4 character classes (which the standard bans); no HIBP | `src/app/actions/profile.ts:295-317`, `reset-password-form.tsx:28`, `employeeInvite.ts:509` |
| `inviteUserByEmail` invite flow | Custom token invite flow + `admin.createUser` | `src/app/actions/employeeInvite.ts:508-561` |
| Full auth audit event list | Partial: login, login_failed, logout, password_change, invite. Missing: reset requested/completed | `src/services/auth.ts:34,61,93`, `profile.ts:373` |
| CSP without 'unsafe-inline' | CSP present but with 'unsafe-inline' on script-src and style-src | `next.config.mjs:22-38` |
| Headers set in middleware | Headers set in `next.config.mjs` (works fine) | `next.config.mjs:40-77` |
| Email + password only | Conforms. Plus two dead placeholders: a "Sign in with Microsoft 365" button that just errors, and an inert 2FA screen | `LoginClient.tsx:89-128,197-203` |
| Invite-only, no public sign-up | Conforms (signUp hard-disabled) | `src/services/auth.ts:73-80` |
| Middleware getUser + allowlist | Conforms | `src/middleware.ts:195,227-249` |

Conclusion: the standard mandates a lot of machinery no app has built (Redis sessions, CSRF layer, lockout table, login CAPTCHA, HIBP), while the app quietly does simpler modern things that work. The standard should be right-sized so it describes something we actually build and audit.

## 3. Magic links only: assessment

Recommendation: **do not switch to magic-links-only.** Keep email + password.

- **The hacking argument does not hold.** Any app with email password reset already falls to an attacker who controls the user's inbox. Removing passwords does not remove that route; it just makes the inbox the only factor for every single login.
- **It creates an availability problem.** Every login would depend on an email arriving promptly. Spam filters, Graph/Resend outages or delays mean staff locked out at shift start. With passwords, an email outage does not block login.
- **It solves friction that barely exists.** Sessions persist until sign-out, so staff rarely log in. Making a rare event slightly smoother is not worth a new failure mode.
- **The confusion argument cuts both ways.** "I didn't get the email" support pings replace "I forgot my password" pings.
- Password breach risk is already handled by minimum length + breached-password checking, and the app is invite-only with a tiny known user base.
- **Passkeys**, not magic links, are the genuinely modern successor to passwords, but Supabase Auth support is not mature enough to adopt without custom work. Revisit in a year or two; do not build now.

Optional middle ground (not recommended for now, for simplicity): keep passwords and add "email me a sign-in link" as a fallback next to forgot-password.

## 4. Proposed modernised standard (security decisions, not user-visible)

Decisions I am making under the "simple but safe, not over-engineered" brief. All subject to the answers in section 5.

**Remove from the standard:**
1. **Custom Redis session layer (old §3).** Supabase sessions already support server-side revocation (`auth.admin.signOut(userId)` revokes refresh tokens; access dies at next token expiry, within about an hour). For a staff app, revocation-within-the-hour is acceptable and deletes an entire subsystem: store, fail-closed logic, session-fixation handling, cleanup cron. Standard keeps: revoke sessions on password change, on staff leaving, and on privilege demotion.
2. **CSRF double-submit layer (old §4).** New rule: all mutations must go through Server Actions (Next.js validates Origin/Host on these) or, for hand-rolled mutating API routes, signature verification (webhooks) or an explicit origin/CSRF check. Matches what the app already does.
3. **Turnstile on staff login (old §6).** Invite-only internal app; rate limiting suffices. Turnstile stays required for genuinely public write forms (recruitment booking already conforms).
4. **Custom `login_attempts` lockout table (old §5 Option A).** Replaced by: Supabase's own per-IP limits on the sign-in endpoint plus a distributed (Upstash) per-IP limit on the login action. Generic error messages retained (no enumeration).

**Keep, simplified:**
5. Three-client convention, PKCE, no ad-hoc clients (unchanged).
6. Middleware: `getUser()` (never `getSession()`), public-path allowlist, auth gate. Security headers may live in `next.config` or middleware (the standard currently insists on middleware; reality in next.config is fine).
7. CSP required, but the baseline becomes realistic for Next.js App Router: nonce-based script-src as the goal, `'unsafe-inline'` as a documented accepted exception until then. Not a rebuild trigger.
8. Sessions: stay signed in until sign-out (unchanged); Supabase dashboard inactivity/time-box settings must stay off; document in project CLAUDE.md.
9. Invite-only sign-up, no public registration (unchanged). The custom token invite flow is permitted as an alternative to `inviteUserByEmail` provided it is atomic and audited (AMS's flow qualifies).
10. Password policy: **minimum 12 characters, no composition rules, max 72 bytes**, enforced server-side in one shared function, plus Supabase's built-in leaked-password protection where the plan supports it (dashboard setting), otherwise a lightweight HIBP k-anonymity check on the two password-set flows only.
11. Audit logging: trimmed required list: login success/failure, logout, reset requested, reset completed, invite sent/accepted, role changed, session revoked. Emails hashed.
12. Plain-text emails, RLS-everywhere with migrations and tests, startup env validation: all unchanged (they are cheap and genuinely protective).
13. 2FA stays optional (Supabase TOTP), off by default.

**Known AMS gaps under the new standard (future fix list, NOT this piece of work):**
- Min 8 passwords and the 3-of-4 composition rule in `profile.ts` (composition rules are banned).
- Login rate limit is in-memory per instance; should use the existing Upstash distributed limiter.
- Missing audit events for reset requested/completed.
- Dead Microsoft 365 button and inert 2FA screen on the login page.
- Supabase email templates not yet confirmed as plain-text replacements (unverified, needs a dashboard check).

## 5. Open questions (user)

1. Login stays email + password only, no magic links? Recommend yes.
2. Add "email me a sign-in link" as a fallback beside forgot-password? Recommend no, keep one path.
3. Keep "signed in until you sign out" with no timeout? Recommend yes.
4. 2FA: none for now, revisit later? Recommend none for now.
5. New password rule "at least 12 characters, no other rules, breached passwords blocked" (applies on next password change only)? Recommend yes.
6. Remove the dead Microsoft 365 button and placeholder 2FA screen from the login page (when we next touch that code)? Recommend yes.

## 6. Next steps after answers

1. Rewrite `.claude/docs/auth-standard.md` to the agreed standard.
2. Update the `auth-standardiser` skill to match: conformance checklist rows, `audit.mjs` checks (remove Redis/CSRF/Turnstile/lockout-table checks, add Server-Action-mutation and distributed-limiter checks), reference snapshots, lessons.
3. Separately (not now): fix list above as a small AMS changeset once the standard is agreed.
