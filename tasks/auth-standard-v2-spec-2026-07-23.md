# Authentication Standard v2, Specification for Third-Party Validation

Date: 2026-07-23
Status: DRAFT, awaiting independent validation. No code has been changed. The current standard remains in force until this spec is approved.
Author: Claude (discovery + drafting), decisions by the product owner.

## 1. Purpose and scope

This document proposes a replacement for the workspace authentication standard at `.claude/docs/auth-standard.md` (v1, last amended 2026-06-26). It is written to be validated by a reviewer with no access to the conversation that produced it. Everything needed to judge it is in this document.

Scope: authentication for all Next.js App Router + Supabase applications in the workspace portfolio. Authorisation (roles, permissions) remains app-specific and is out of scope beyond the safe-pattern rules in section 5.7.

The validator is asked to answer the questions in section 9.

## 2. Context and threat model

- The portfolio is a set of internal management tools for small hospitality businesses (pubs). The largest is AnchorManagementTools (AMS): staff rotas, payroll, bookings, SMS/email to customers.
- All apps are invite-only. There is no public registration and no self-service sign-up. User counts are small (tens, not thousands), and all users are known staff.
- Sensitive data held: staff PII and payroll data, customer contact details, booking and payment records.
- Some apps expose genuinely public pages (table booking, recruitment interview booking, parking, review funnels). These accept writes from anonymous visitors and are the main bot/abuse surface.
- Primary threats, in order of realistic likelihood: credential stuffing and password reuse against staff accounts; bot abuse of public forms (spam bookings, SMS-triggering submissions); a leaver or demoted staff member retaining access; opportunistic access to an unlocked shared device on premises.
- Explicitly out of threat model (accepted risk): targeted state-level attackers, malware on staff personal devices, compromise of a staff member's personal email mailbox (see 6.1 for why).

## 3. Owner decisions (locked, not for re-litigation)

The product owner has decided the following. The validator may flag consequences but these are product decisions:

1. Sign-in is email + password only. No magic links, no passwordless, and no third-party identity providers of any kind (no Microsoft 365, Google, Facebook, Apple ID, or any other OAuth/social sign-in), now or as a future option unless the standard is re-amended.
2. Sessions do not time out. A signed-in user stays signed in until they sign out or are revoked server-side.
3. No two-factor authentication for now. The standard does not define or require 2FA. Revisit only if an app ever grants privileged access to users outside the known staff group.
4. Password rule as presented to users: at least 12 characters, no composition requirements, known-breached passwords rejected. Applies when a password is next set or changed; existing passwords are not force-expired.
5. CAPTCHA (Cloudflare Turnstile) on the staff login and forgot-password forms AND on every unauthenticated public form that performs a write or triggers email/SMS. Not on forms behind authentication.
6. No Redis/Upstash requirement anywhere in the auth standard.
7. Simplicity is an explicit goal: the standard must describe what is actually built and auditable, not aspirational machinery.

## 4. Current state (evidence, gathered 2026-07-23)

Working tree audited at commit `590711ba` (main tip). Two findings matter for the validator:

**4.1 The v1 standard mandates subsystems that no app in the portfolio has built:**

| v1 requirement | Reality in AMS (flagship app) |
|---|---|
| Custom session store in Upstash Redis, `app-session-id` cookie, validate-on-every-request | Absent. Plain Supabase cookie sessions via `@supabase/ssr` |
| CSRF double-submit cookie layer in middleware | Absent. Zero `csrf` hits in `src/**`. All mutations are Next.js Server Actions |
| Turnstile on login and forgot-password | Absent on both. Present only on the public recruitment booking form |
| `login_attempts` lockout table (5 fails / 15 min / 30 min lock) | Absent. Only an in-memory per-IP 5/min limiter (`src/services/auth.ts:9`, `src/lib/rate-limit.ts:29-82`), per-instance, resets on deploy |
| Min 12 chars, composition rules banned, HIBP check | Min 8 everywhere; change-password path additionally requires 3 of 4 character classes (`src/app/actions/profile.ts:295-317`), which v1 bans; no HIBP anywhere |
| Full auth audit event list | Partial: login, login_failed, logout, password_change, invite. Missing: reset requested, reset completed |
| CSP without `'unsafe-inline'` | CSP present (`next.config.mjs:22-38`) but with `'unsafe-inline'` on script-src and style-src |

**4.2 What AMS does that already conforms to sensible practice:** middleware validates with `supabase.auth.getUser()` (never `getSession()`) and gates non-public routes (`src/middleware.ts:195,227-249`); sign-up is hard-disabled (`src/services/auth.ts:73-80`); invites are a custom audited token flow ending in `admin.createUser` (`src/app/actions/employeeInvite.ts:508-561`); password reset uses the PKCE `verifyOtp` flow via `/auth/confirm`; sign-out is a server action (POST semantics); security headers including HSTS, X-Frame-Options DENY and frame-ancestors 'none' are set in `next.config.mjs:40-77`.

Conclusion drawn: v1 is a paper standard. v2 is designed so that the gap between standard and reality is small, closable, and honestly auditable.

## 5. Proposed Standard v2 (normative)

### 5.1 Supabase clients

Three clients, strictly separated. Unchanged from v1.

- Browser client (`src/lib/supabase/client.ts`): anon key, `createBrowserClient` from `@supabase/ssr`, singleton, `flowType: 'pkce'`.
- Server client (`src/lib/supabase/server.ts`): anon key, `createServerClient`, handles cookies for Server Components/Actions/Route Handlers, respects RLS.
- Admin client (`src/lib/supabase/admin.ts`): service-role key, `server-only`, must throw in a browser context, used only for system operations (invites, crons, webhooks).

Prohibited: admin client in client components; admin client for user-scoped reads; ad-hoc clients; tokens in localStorage; implicit flow for recovery/invite token exchange.

### 5.2 Middleware and route protection

A single `middleware.ts`:

1. Refresh/validate the session with `supabase.auth.getUser()` on every request. `getSession()` is prohibited for auth decisions (it trusts the local cookie without server validation).
2. Public-path allowlist, segment-bounded prefixes, each app-specific entry commented with why it is public.
3. Redirect unauthenticated requests on protected paths to the login page. Any post-login redirect target (query param or cookie) must be validated as a same-origin path before use. Open redirects are prohibited.

Security headers (HSTS, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` denying camera/microphone/geolocation, CSP with `frame-ancestors 'none'`) are required on every response but MAY be set in `next.config` headers() instead of middleware. Change from v1, which mandated middleware placement; the location is not security-relevant.

CSP: required. Nonce-based or hash-based `script-src` is the target state. `'unsafe-inline'` is a documented, accepted exception while the app uses App Router inline bootstrapping, and must be recorded in the app's CLAUDE.md. It is not by itself a conformance failure. Change from v1, which prohibited it outright and was universally violated.

### 5.3 Sessions

Supabase's built-in session management is the only session layer. The v1 custom session store (Upstash Redis, `app-session-id` cookie, per-request store lookup) is withdrawn entirely.

- No idle timeout, no absolute timeout. Users stay signed in until sign-out or revocation. The Supabase dashboard settings "Inactivity timeout" and "Time-box user sessions" must be verified OFF and recorded in the app's CLAUDE.md.
- Access-token (JWT) expiry: 1 hour (Supabase default). Do not raise it; this bounds the revocation window below.
- Server-side revocation: `supabase.auth.admin.signOut(userId)` (service-role), which revokes the user's refresh tokens. Required at these points:
  - password change or reset (revoke all sessions, then re-authenticate the current user so they are not silently logged out),
  - staff offboarding (part of the leaver process),
  - privilege demotion in apps that have roles.
- Accepted trade-off (validator, see Q2): after revocation, an existing access token remains valid until expiry, so revocation takes effect within at most 1 hour rather than instantly. For this threat model (internal staff apps, small user base, offboarding is not adversarial in the moment) the owner accepts this in exchange for deleting an entire custom subsystem (store, fail-closed logic, session-fixation handling, cleanup cron, config).

### 5.4 Mutation protection (CSRF)

The v1 double-submit-cookie layer is withdrawn. Replacement rules:

1. All state-changing operations initiated by the browser MUST be Next.js Server Actions. Next.js enforces POST semantics and Origin/Host validation on Server Actions; combined with SameSite cookies this is the CSRF defence.
2. Custom Route Handlers that mutate state are permitted only for: webhooks (signature verification required, e.g. Twilio/Stripe/PayPal), cron endpoints (`Authorization: Bearer CRON_SECRET`), and documented public APIs (API-key auth). Each must be listed in the app's CLAUDE.md with its protection mechanism.
3. A browser-called mutating Route Handler outside those categories is a conformance failure unless it validates Origin against the app's own origin server-side.
4. Sign-out must have POST semantics (server action or POST route), never GET.

### 5.5 Rate limiting and abuse protection

- Supabase Auth's own per-IP rate limits on sign-in/token endpoints are the primary brute-force control. The project's configured limits must be checked in the dashboard once and recorded in the app's CLAUDE.md.
- CAPTCHA on login (5.6) is the second control against credential stuffing.
- The v1 `login_attempts` lockout table (5 fails / 15 min / 30 min lock) is withdrawn. No custom lockout is required.
- Login failures must return a generic error identical for wrong-password and unknown-email (no account enumeration). Forgot-password always returns generic success.
- No Redis/Upstash is required by this standard. Apps may keep distributed rate limiting for non-auth surfaces (e.g. SMS-sending actions); that is app-specific and out of scope here.

### 5.6 CAPTCHA

Provider: Cloudflare Turnstile only.

Required on:
- Staff sign-in and forgot-password. Implement via Supabase Auth's built-in CAPTCHA integration (enable Turnstile in the Supabase dashboard; pass `captchaToken` in the `signInWithPassword` and `resetPasswordForEmail` options). Verification is then enforced server-side by Supabase itself; client-only checks are prohibited.
- Every unauthenticated public form that writes data or triggers email/SMS (examples in AMS: recruitment interview booking, public table booking, parking guest forms, review funnel). These verify server-side against the Turnstile siteverify API before processing, and should validate the `action` field where used.

Not required on: any form behind authentication; invite-acceptance links (the signed, expiring email link is the control).

Availability trade-off (validator, see Q4): with Supabase-enforced CAPTCHA, a Turnstile outage blocks staff login until it recovers or the dashboard toggle is flipped off. The owner accepts this for the simplicity of not building a bypass path; a documented runbook line ("if Turnstile is down, disable Attack Protection > CAPTCHA in the Supabase dashboard") is required instead.

### 5.7 Server-side authentication and authorisation checks

Unchanged in substance from v1:

- Every protected page, Server Action and Route Handler verifies the user server-side. UI hiding is never a control.
- Required helpers per app: `requireAuth()` (redirects), `getCurrentUser()` (nullable), `withAuth(handler)` (401), plus role-specific variants as needed.
- Roles, where an app has them: stored in `app_metadata` only (never `user_metadata`), set only via the service-role Admin API, re-checked server-side on every decision, hierarchy comparisons use `>=`. Demotion triggers session revocation (5.3).

### 5.8 Auth flows

- Sign-in: `supabase.auth.signInWithPassword()` with a Turnstile token (5.6). Nothing else. Prohibited outright: OAuth/social providers of any kind, magic links, passwordless OTP login for staff. Any UI advertising such options (including inert placeholder buttons) is a conformance failure.
- Sign-up: invite-only, no public registration route; any `/register`-like route returns 404 or is hard-disabled. Two acceptable invite mechanisms:
  a. `supabaseAdmin.auth.admin.inviteUserByEmail()` with atomic metadata setup (delete the user if the second step fails), or
  b. a custom invite-token flow, provided the token is single-use and expiring, acceptance is atomic (no half-created users), and issue/acceptance are audit-logged. (AMS's existing employee-invite flow qualifies.)
- Password reset: `resetPasswordForEmail` with `redirectTo` pointing at the app's own `/auth/confirm` route; token exchanged server-side via `verifyOtp` (PKCE); reset link expiry 60 minutes; reset completion revokes all sessions then re-authenticates the requester.
- All `next`/`from` redirect params validated same-origin.
- Sign-out: POST semantics, calls `supabase.auth.signOut()`, audit-logged.

### 5.9 Audit logging

All auth events go to the same audit table as application mutations. Required events:

| Event | operation_type |
|---|---|
| Successful sign-in | auth.login.success |
| Failed sign-in | auth.login.failure |
| Sign-out | auth.logout |
| Password reset requested | auth.password_reset.requested |
| Password updated (reset or change) | auth.password_updated |
| Invite sent | auth.invite.sent |
| Invite accepted | auth.invite.accepted |
| Session(s) revoked server-side | auth.session.revoked (with reason) |
| Role/privilege changed (apps with roles) | auth.role.changed |

Email addresses in audit rows are SHA-256 hashed, never plaintext. IP and user agent may be plaintext. (Apps may keep existing operation_type spellings, e.g. AMS's `login`/`logout`, provided the event coverage is complete; renaming is not required.)

### 5.10 Password policy

One shared server-side function (`validatePassword`) used by every password-setting surface. Client-side checks are UX only.

| Constraint | Value |
|---|---|
| Minimum length | 12 characters |
| Maximum length | 72 bytes (bcrypt limit), enforced in bytes |
| Composition rules | Prohibited (no required classes; aligns with NIST SP 800-63B / OWASP) |
| Breached-password check | Required: prefer Supabase's built-in leaked-password protection (dashboard, "Prevent use of compromised passwords") if the project's plan supports it; otherwise HIBP k-anonymity range API (SHA-1 prefix, first 5 chars only) in `validatePassword` |
| Current password | Must not match on change |

Supabase dashboard minimum-length setting should also be set to 12 as a second layer. Existing passwords are not force-expired; the policy applies at next set/change.

### 5.11 Email content

Unchanged from v1: every Supabase default template replaced with plain-text-style content (no images, logos or marketing layout; visible full URL; expiry stated; support contact; app name). All templates replaced even for disabled flows (safety net, marked as such). All links point at the app's `/auth/confirm`, never a Supabase domain.

### 5.12 Database security (RLS)

Unchanged from v1: RLS enabled on every table including service-role-only tables; explicit policies per role (anon default-deny, authenticated scoped, service_role bypasses by design); all changes as versioned migrations, never dashboard edits; views and SECURITY DEFINER functions audited; anon/authenticated/service-role tests required for protected tables.

### 5.13 Startup configuration validation

Unchanged in principle, trimmed in content: a single config module validates required env vars at startup/build and fails loudly if missing. Required minimum: Supabase URL, anon key, service-role key, app base URL, and Turnstile keys where CAPTCHA is used. Redis/Upstash variables are no longer part of the auth standard. No silent `|| fallback` for anything security-relevant. All vars documented in `.env.example`.

### 5.14 Two-factor authentication

Not part of this standard. No app implements or advertises 2FA. Placeholder 2FA UI must be removed. If a future need arises, the standard will be amended first.

### 5.15 Testing requirements

Mandatory coverage, trimmed to what v2 actually contains:

- Auth helpers: `requireAuth` redirects, `getCurrentUser` nullability, `withAuth` 401s.
- Password policy: min 12 enforced server-side, 72-byte cap, no composition rules present, breach check invoked (mocked), current-password reuse rejected.
- Invite flow: atomicity (no half-created user on failure), single-use/expiring token, resend rules.
- Revocation: password change/reset triggers revocation for the user; demotion triggers revocation (apps with roles).
- Mutation protection: browser-mutating route handlers outside the allowed categories are absent (lint/audit check), sign-out is POST.
- RLS: anon denied, authenticated scoped to own rows, service-role path works.
- Startup validation: build/boot fails on missing required vars.
- External services (Supabase, HIBP, Turnstile) always mocked in tests.

## 6. Removed from v1, with rationale (summary for the validator)

| Removed | Rationale | Residual control |
|---|---|---|
| Magic links / passwordless (never allowed; ban re-affirmed) | Email reset already reduces account takeover to inbox security, so passwordless adds an availability dependency (email delivery on every login) without reducing risk; login is rare because sessions persist | Password policy + CAPTCHA + Supabase limits |
| Custom Redis session store + `app-session-id` cookie | Never built in any app; duplicate of Supabase's own revocable refresh-token sessions; large maintenance surface | `auth.admin.signOut(userId)` revocation, 1h JWT expiry bound |
| CSRF double-submit layer | Never built; all mutations are Server Actions which Next.js origin-validates | 5.4 rules + webhook signatures + cron secret |
| `login_attempts` lockout table | Never built; DoS-by-lockout risk; invite-only app with tiny user base | Supabase per-IP auth limits + Turnstile on login + generic errors |
| Turnstile fail-soft plumbing | Replaced by Supabase-enforced CAPTCHA with a documented dashboard runbook for outages | Runbook line in CLAUDE.md |
| 2FA section | Owner decision: not now | Invite-only, CAPTCHA, breach-checked 12+ passwords |
| CSP `'unsafe-inline'` prohibition | Universally violated; App Router makes it costly; kept as target state with documented exception | Full header set incl. frame-ancestors 'none' still required |

## 7. Known conformance gaps in AMS against v2 (future fix list, no code changed yet)

1. Password minimums are 8 (four surfaces) and the change-password path enforces composition rules that v2 prohibits (`src/app/actions/profile.ts:295-317`). Move to shared `validatePassword`, min 12, no composition, breach check.
2. No CAPTCHA on staff login or forgot-password; enable Supabase Turnstile integration and pass tokens.
3. Public forms other than recruitment booking (table booking, parking guest, review funnel) need Turnstile per 5.6.
4. Missing audit events: password reset requested, reset completed.
5. Dead "Sign in with Microsoft 365" button and inert 2FA screen on the login page (`LoginClient.tsx:89-128,197-203`) violate 5.8/5.14; remove.
6. Revocation calls (`auth.admin.signOut`) not yet wired to password change/reset or offboarding.
7. Supabase dashboard checks to record in CLAUDE.md: inactivity/time-box OFF, JWT expiry 1h, auth rate limits, leaked-password protection availability, email templates replaced.
8. In-memory login limiter is redundant once Supabase limits + CAPTCHA are confirmed; keep or delete during implementation (implementer's choice, low stakes).

## 8. Out of scope

- Any code changes (this is a spec only).
- Authorisation/RBAC models per app.
- Non-auth rate limiting (SMS sending, uploads).
- The timeclock kiosk PIN flow (public kiosk route, not Supabase auth; unchanged).
- Customer-facing flows that never sign in (booking confirmation links etc.).

## 9. Questions for the validator

1. CSRF: is "all browser mutations via Server Actions + SameSite cookies + Next.js Origin/Host validation" sufficient without a token layer? Identify any gap (older browser SameSite behaviour, multipart edge cases, route handlers we have missed).
2. Revocation window: is refresh-token revocation with up to 1 hour of residual access-token validity acceptable for this threat model? If not, what is the simplest mitigation short of re-introducing a per-request session store (e.g. shorter JWT expiry)?
3. Lockout: is dropping per-account lockout defensible given Supabase per-IP limits + CAPTCHA on login + generic errors + invite-only user base? What residual credential-stuffing exposure remains?
4. CAPTCHA on login enforced by Supabase: is accepting a Turnstile outage as a login outage (with a dashboard-toggle runbook) reasonable, or should the standard require an app-side fail-soft path?
5. Password policy: min 12, no composition, breach check, 72-byte cap: any objection?
6. CSP: is treating `'unsafe-inline'` as a documented accepted exception (target: nonces) defensible, or should nonce adoption be mandatory with a deadline?
7. Sessions without any time-based expiry on shared premises devices: acceptable given server-side revocation at offboarding, or should the standard require a re-auth prompt for high-sensitivity areas (payroll) instead?
8. Anything removed in section 6 that you would keep, or anything kept that you would remove, bearing in mind the owner's explicit simplicity goal?

## 10. Rollout after validation

1. Incorporate validator feedback; owner signs off final text.
2. Rewrite `.claude/docs/auth-standard.md` as v2.
3. Update the `auth-standardiser` skill to match: conformance checklist rows, automated checks in `audit.mjs` (drop Redis/CSRF-token/lockout-table checks; add checks for Server-Action-only mutations, Turnstile presence on login and public forms, password policy values, revocation call sites, prohibited social-login code), reference snapshots and lessons.
4. Schedule the AMS fix list (section 7) as a separate changeset with its own review.
