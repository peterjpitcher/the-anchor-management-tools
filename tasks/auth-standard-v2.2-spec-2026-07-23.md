# Authentication Standard v2.2, Revised Specification for Re-validation

Date: 2026-07-23
Status: v2.2 FINAL DRAFT. Supersedes `tasks/auth-standard-v2.1-spec-2026-07-23.md` after the second independent review (v2.1 review, 2026-07-23: 7 P0, 21 P1, 4 P2). All seven P0s are resolved in this text; all previously pending choices are closed in the decision log (section 4). No code has been changed. The v1 standard remains in force until this spec is approved.
Evidence commit: `590711ba` (main tip). New evidence gathered this round is cited inline.

Self-contained for re-validation. Section 10 gives the disposition of every round-2 finding.

## 1. Purpose and scope

Replacement for the workspace authentication standard (`.claude/docs/auth-standard.md`, v1 2026-06-26) for all Next.js App Router + Supabase apps in the portfolio. Authorisation models remain app-specific (6.7). Adoption is per app with explicit states (11.1); AMS pilots.

## 2. Context and threat model

Unchanged in substance from v2.1: invite-only internal staff tools for small hospitality businesses; tens of known users; staff PII/payroll, customer contact, bookings, payments; public booking/recruitment/parking/feedback surfaces are the bot/abuse surface; Supabase browser sessions are JavaScript-readable cookies so XSS implies session theft; email delivery is security-critical.

Primary threats in order: credential stuffing/password reuse; bot abuse of public forms (spam writes, email/SMS triggering, payment-order spam); leaver or demoted staff retaining or regaining access; unlocked shared devices on premises.

### 2.1 Residual risk register (accepted, with owner)

Every accepted risk has a named owner (the business owner, Peter Pitcher, for all product risks) and a review trigger. None is claimed to be mitigated by controls this standard does not provide.

| Residual risk | Why accepted | Review trigger |
|---|---|---|
| Indefinite sessions, no step-up, no 2FA: an unlocked signed-in device reaches payroll and role changes | Owner decisions 2, 3, 9 | Any privileged access granted outside known staff |
| Existing weak/breached passwords persist until next change | Owner decision 4 (no forced reset) | Any credential-compromise incident |
| XSS session theft while `'unsafe-inline'` script CSP remains | Nonce migration is planned debt (6.2, owner + trigger recorded) | Annual CSP review or Next.js major upgrade |
| Issued JWTs stay valid up to 15 minutes after ban/sign-out | Supported platform behaviour; bounded by 6.3 | Never (inherent), restated in offboarding docs |
| CAPTCHA and email are external dependencies run by a one-person operation | Proportionality (6.6 break-glass, 6.11 alerts) | Provider incident affecting login or reset |
| In-memory rate limiting on apps without a shared store | Turnstile is the primary control (6.5); AMS uses its existing shared store | App gains external users or multi-region scale |
| Plaintext staff email, IP and user agent in audit rows | Owner decision 10 + governance in 6.9 (retention, access, append-only) | Data-protection review or staff complaint |

## 3. Owner decisions (locked)

1. Email + password only. No magic links, no passwordless, no third-party identity providers ever. Enforced at the provider boundary, not just the UI (6.8.1). Placeholder UI advertising other methods is a conformance failure.
2. No idle or absolute session timeout, and no step-up re-authentication anywhere. Recorded risk acceptance (2.1 row 1): mitigations are revocation (6.3), a visible sign-out control, and premises practice.
3. No 2FA.
4. Passwords: minimum 12 (explicit deviation from the 15-character NIST/OWASP password-only baseline), no composition rules, breach check, applied at next set/change.
5. Turnstile on staff login, forgot-password, and every fully anonymous public write surface; not on authenticated forms; token-gated links and server-to-server calls exempt.
6. No Redis/Upstash requirement in the standard itself (apps that already run one may use it, and AMS does for rate limiting).
7. Proportionality: the standard describes what is actually built and audited; deliberate process deviations are recorded, not implied.
8. Leavers: banned at offboarding; deletion is a later retention step only; audit trails, approvals and operational records survive intact.
9. No step-up re-authentication (restated for clarity; see 2).
10. Audit rows for signed-in actors keep plaintext actor email; pre-authentication events are pseudonymised.

All decisions are locked. Nothing in this spec is pending owner input.

## 4. Decision log (round 2, closes every "unresolved decision" from the v2.1 review)

| Question | Decision |
|---|---|
| Mechanism to disable email OTP/magic-link while keeping password, recovery, invites | Template neutering + confirm-route restriction (6.8.1): the `magic_link` and `confirm_signup` templates contain no token link; `/auth/confirm` accepts `type=recovery` only; negative test required. Supabase's send-email hook is the named alternative if template neutering is ever insufficient |
| Recovery-authority mechanism | Server-minted single-use recovery grant (6.8.4). The JWT `amr` option is dropped |
| Authoritative active-identity source; does inactivity block reads | Per app; AMS: the employee/user record status. Inactive blocks ALL authenticated access (reads included) via the shared helpers (6.3, 6.7) |
| Durable leaver control and rehire ordering | App-level active-identity check is the durable control; the Auth ban (far-future, `876000h`) is defence in depth, so ban expiry is not a security boundary. Rehire: restore identity and roles first, unban last (6.3) |
| Single-session-per-user setting | OFF (staff may be signed in on phone and desktop). Recorded in the dashboard baseline |
| Email change, admin-set passwords, self-deletion | Email change: admin-only via Admin API. Admin-set temporary passwords: prohibited (use invite/reset). User self-deletion: not offered. (6.8.6) |
| Limiter dimensions and values | Normative defaults in 6.5 |
| Guest-token TTL/reuse rules | Class invariants in 6.4.3; per-family TTLs documented in the app registry |
| Audit retention, access, HMAC rotation, retry | 6.9: 6-year retention, append-only, restricted read, versioned `AUDIT_HMAC_KEY` per environment, retry queue with operation ID |
| Node LTS version | Node 22 LTS (Node 20 is EOL). AMS upgrade is a prerequisite task (8, item A1) |
| Monitoring cadence and owner | 6.11: named owner, two immediate alerts, provider alerts, quarterly review + change-triggered revalidation |
| Rollback strategy per change class | 11.3 |

## 5. Current state (evidence at `590711ba`, updated this round)

Carried over from v2.1 (all verified): 183 Route Handlers; 77 export mutating methods; middleware allowlists the whole `/api` prefix (`src/middleware.ts:14`); 33 cookie-auth browser-called mutating handlers with no Origin/CSRF validation; Turnstile present on table/event bookings, private-booking pair (with a soft-bypass bug), recruitment; `/api/feedback` has no CAPTCHA; `/api/parking/payment/retry` is fully unprotected; admin client lacks `server-only` (`src/lib/supabase/admin.ts:1-20`); audit stores plaintext `user_email` (`src/services/audit.ts:30-38`); AMS RBAC is database-backed (`src/services/permission.ts:142-196`).

New this round (verified 2026-07-23):

- **Cron/GET side effects:** `vercel.json` schedules 43 routes; 45 cron route dirs exist; **all 45 export GET** and only 4 also export POST. The v2.1 "77 mutating handlers" inventory therefore missed at least 41 GET-invoked state-changing routes. Method-based counting is withdrawn as a completeness claim (6.4.4).
- **Passwordless exposure:** `/auth/confirm` accepts `['recovery','email','signup','magiclink','email_change']` (`src/app/auth/confirm/route.ts:47`), so a directly requested magic-link token is currently exchangeable despite no UI offering it.
- **Client-side auth calls:** forgot-password calls `resetPasswordForEmail` from a Client Component (`src/app/auth/reset-password/page.tsx:39`) and the reset form calls `supabase.auth.updateUser` in the browser (`src/app/auth/reset/reset-password-form.tsx:40`), bypassing server-side validation, auditing and limiting.
- **HSTS:** `max-age=63072000` with no `includeSubDomains` (`next.config.mjs:41`).
- **Runtime:** `.nvmrc` pins Node 20, which is end-of-life; `engines` allows `>=20 <23`.

Dashboard-side facts remain unverified until the conformance evidence pass (12): signup, anonymous sign-ins, provider and passwordless settings, Site URL and redirect allowlist, inactivity/time-box, JWT expiry, rate limits, leaked-password protection, single-session, SMTP, templates.

## 6. Standard v2.2 (normative)

### 6.1 Clients, keys, runtime

As v2.1: browser client (public key, PKCE), server client (public key, SSR cookies), admin client (secret key, `server-only`, throws in browser context), plus one shared middleware session adapter. No other clients. Prefer publishable/secret keys; legacy key migration deadline recorded per app.

Runtime baseline: **a currently supported Node LTS release** (today: Node 22). Naming a major version permanently is prohibited; each app records its exact version. Version floor: Next.js 15+, `@supabase/ssr` 0.10+, `supabase-js` 2.101+. Every platform behaviour this standard relies on (Server Action origin checks, sign-out scopes, `ban_duration`, CAPTCHA options, template variables) must exist in the pinned versions.

### 6.2 Transport, headers, CSP, caching

Required on every page response (middleware or `next.config`): HSTS `max-age` >= 31536000; `includeSubDomains` required **once all subdomains of the serving domain are confirmed HTTPS-ready** (verification is a rollout task, 11.2); `X-Content-Type-Options: nosniff`; `X-Frame-Options: DENY`; `Referrer-Policy: strict-origin-when-cross-origin`; `Permissions-Policy` denying camera/microphone/geolocation.

CSP minimum profile (complete baseline, not a directive sample): `default-src 'self'`; `base-uri 'self'`; `object-src 'none'`; `frame-ancestors 'none'`; `form-action 'self'`; `script-src` and `frame-src` including `https://challenges.cloudflare.com`; `connect-src` including the app's Supabase project origin; additional sources (PayPal, storage domains) via a documented per-app exception list. Deployment of any CSP change goes through a `Content-Security-Policy-Report-Only` phase first (11.2). The `'unsafe-inline'` script exception is recorded debt with a named owner (business owner) and trigger (annual review or Next.js major upgrade), target state nonce-based.

Caching and leakage (new): auth pages (login, forgot, confirm, reset, invite acceptance) and all token-bearing pages (`/g`, `/m`, `/r`, onboarding, booking portal) return `Cache-Control: no-store`; token-bearing pages set `Referrer-Policy: no-referrer` and load no third-party resources before the token is consumed; where feasible the token is removed from the address bar after capture. Authenticated responses containing sensitive data are `private, no-store`.

### 6.3 Sessions, revocation, account lifecycle

Supabase sessions are the only session layer. No timeout (owner decision 2). Dashboard inactivity/time-box OFF; single-session OFF (decision log); JWT expiry **15 minutes**.

- User-present revocation: `signOut({ scope })`: `local` (sign-out), `others` (after password change/reset), `global` where wanted.
- Admin revocation: `admin.updateUserById(userId, { ban_duration })`. Calling `admin.signOut` with a user ID is prohibited (it takes a JWT).
- **Active-identity gate (new, mandatory):** every app names one authoritative active-identity source (AMS: the employee/user record status). The shared auth helpers (6.7) verify it on every authenticated request path, reads included. A user is authorised only when Supabase authentication AND the active-identity check both pass. This, not the ban timer, is the durable leaver control.
- **Leaver lifecycle (ordered):** 1) set identity inactive (access ends at once via the gate); 2) remove roles/permissions; 3) ban the Auth user (`ban_duration: '876000h'`, defence in depth; its distant expiry is not a security boundary because of the gate); 4) audit each step. Access-removal steps continue even if an audit write fails, but the workflow is then marked incomplete, alerts, and retries the audit record under the same operation ID (6.9). Deletion of the Auth user is a later retention step and must leave audit trails, approvals and operational records intact (FK/deletion tests required, 6.15).
- **Rehire:** restore identity and roles first, unban last. A partial rehire (any step failed) leaves the account unusable, alerts, and is re-runnable.
- **Demotion:** update the authoritative permission data AND invalidate the permission cache in the same operation; effect is immediate in practice with a stated maximum bound of the cache TTL (AMS: 60 s). The residual-access statement includes in-flight requests.
- **JWT expiry migration (new):** record the previous expiry, change it, then wait at least one previous maximum lifetime before relying on the 15-minute bound in any offboarding statement or proof; monitor refresh errors after the change.

### 6.4 Route protection and mutation safety

1. **Registry covers every Route Handler** (all 183 at the evidence commit), including GET and HEAD: path, methods, side effects (semantic, not method-derived), data sensitivity of responses, caller class, protection class, owner. A mutating handler is any handler with side effects regardless of method. Method-export scanning is a discovery aid only.
2. Registry generation is automated from source with human-reviewed metadata; CI fails on an unregistered or metadata-less `route.ts` (adopted from review O-01). Unclassified = non-conformant.
3. Browser-triggered state changes over GET are prohibited. The Vercel cron GET convention is a documented exception: cron handlers must be idempotent under platform retries and protected by the cron secret.
4. Server Actions are the preferred browser mutation surface (Next.js Origin/Host checks; `allowedOrigins` configured where proxies differ). Browser-called cookie-auth Route Handlers require the single shared same-origin guard (Origin against configured canonical origins; missing Origin rejected unless `Sec-Fetch-Site: same-origin`), applied at the shared wrapper level and tested behind the production proxy and preview domains.
5. Non-browser classes as before: webhook signatures, cron secret, API keys, signed/hashed guest tokens.
6. **Guest-token invariants (new):** opaque tokens have >= 128 bits of randomness; stored server-side only as hashes; compared in constant time; bound to one purpose and one resource; documented TTL and revocation per route family in the registry; one-time where the action is one-time (payment capture, waitlist confirm); never logged; served only on `no-store`, `no-referrer` pages (6.2).
7. Sign-out is POST. Cookie minimums (`SameSite=Lax`, `Secure` in production) asserted in tests.
8. **Abuse invariants for costly public endpoints (new):** any public or token-gated endpoint that sends email/SMS or creates a payment order must validate business state server-side, be idempotent (at most one live payment order per booking; duplicate submissions return the existing result), and carry a per-target cooldown or quota (e.g. reset and invite emails per address per hour). CAPTCHA proves a challenge; it does not replace these.

### 6.5 Login rate limiting and brute force

- Login, forgot-password, password change and reset are executed server-side only (server action or handler); browser-direct Supabase auth calls are non-conformant (AMS gaps A6, A7).
- Supabase's per-IP auth limits see the app server egress IP and are a volume backstop only. Primary controls: Turnstile (6.6) plus an app-level limiter with **normative defaults** (per-app overrides documented): 10 failures / 15 min per canonical-email+IP pair; 20 failures / 15 min per canonical email across IPs; 50 failures / 15 min per IP across emails. Canonical email = trim + lowercase. Client IP from the hosting platform's trusted header (Vercel: the platform-set forwarded header, never a client-supplied value). Counters reset on success; responses stay generic.
- Apps with an existing shared store (AMS: Upstash) use it for these counters; in-memory is acceptable only where no shared store exists and is recorded in the app's conformance evidence.
- No lockout table. Generic errors; forgot-password always generic success.

### 6.6 CAPTCHA (Turnstile)

Two distinct integration contracts:

**A. Supabase-verified auth flows (login, forgot-password, password re-verification):** enforcement lives in Supabase (Attack Protection > CAPTCHA). The application renders the widget and forwards `captchaToken`; **the application never enforces token presence itself**. If the widget fails to load within a short timeout, the form still submits without a token (Supabase rejects while enforcement is on, which is the correct fail-closed outcome, with user guidance shown). Consequence: the dashboard toggle alone is a complete break-glass. Hostname restrictions are set in the Turnstile widget configuration (the app cannot check hostname on this path and does not claim to). The widget is re-executed after **every** submission (tokens are single-use; a wrong password consumes the token).
**Break-glass:** owner verifies the outage (Cloudflare status page), toggles dashboard CAPTCHA off, notes start time, re-enables within 24 hours. The staging proof must demonstrate the full path: widget unavailable, form submits without token, dashboard toggle off, login succeeds (11.2).

**B. Application-verified public forms** (feedback, bookings, recruitment, parking): server-side siteverify through one shared verifier: 2 s timeout, mandatory `action` match, mandatory hostname allowlist, single-use handling with widget reset, per-environment keys, no response-body logging, safe generic errors. An API-key path may skip CAPTCHA only after the key validates (fixing the current soft-bypass).

Coverage and exemptions as owner decision 5, recorded per route in the registry.

### 6.7 Server-side authentication and authorisation

- Every protected page, Server Action and Route Handler verifies the user server-side AND passes the active-identity gate (6.3). UI hiding is never a control.
- Helper contracts: pages `requireAuth()` (redirect) / `getCurrentUser()`; Server Actions return a **shared typed result** with stable codes: `unauthenticated`, `unauthorised`, `rate_limited`, `captcha_failed`, `validation_failed`, `service_unavailable`, `unexpected` (public messages stay generic; enumeration-safe); Route Handlers map to JSON 401/403/429 (+`Retry-After`)/503 (`no-store`). Auth-service outage returns `service_unavailable`, never "logged out".
- Authorisation invariants unchanged from v2.1: server-controlled authoritative source named per app (AMS: DB `roles`/`user_roles`/`permissions`); privileged operations re-check server-side; cache bound per 6.3 demotion rule; `user_metadata` never trusted; `>=` only over a defined total ordering.
- Step-up: none (owner decision 9).

### 6.8 Auth flows

**6.8.1 Passwordless enforcement (new, resolves the provider-boundary gap):**
- The `magic_link` and `confirm_signup` email templates are **neutered**: their bodies contain no token link, only a notice that the method is disabled plus the support contact. A triggered passwordless request therefore yields no usable credential even though Supabase's email provider remains enabled for password flows.
- `/auth/confirm` accepts `type=recovery` only; every other token type (`magiclink`, `email`, `signup`, `email_change`) is rejected with a generic error. (AMS today accepts all five: gap A5.)
- Dashboard baseline: signup OFF, anonymous sign-ins OFF, all providers except email OFF, single-session OFF, **Site URL set to the exact production origin and the redirect allowlist limited to exact per-environment `/auth/confirm` URLs; no broad wildcards in production** (tightly scoped preview patterns documented separately).
- Negative proofs required (6.15): direct `POST /auth/v1/otp` and `POST /auth/v1/signup` for existing and unknown users produce no usable sign-in path in each environment; an unapproved `redirectTo` is rejected by Supabase.
- If template neutering ever proves insufficient, the named fallback is Supabase's send-email hook refusing passwordless mail; adopting it is a standard amendment, not an ad-hoc change.

**6.8.2 Sign-in:** server action; `signInWithPassword` + forwarded captcha token; limiter (6.5); audit (6.9); generic errors.

**6.8.3 Invites:** `inviteUserByEmail` or the custom token flow, governed by an explicit state machine: `pending → accepting → active`, terminal `cancelled`/`failed`. The Auth user is **created banned** and unbanned only after application linking completes, so no usable half-linked account exists at any intermediate state (this replaces the unimplementable "atomic" wording; the active-identity gate denies every non-active state as well). Idempotency key per invite; resend invalidates prior tokens; blocked once confirmed; concurrent acceptance safe (single winner); compensating cleanup with alert on failure; periodic orphan reconciliation owned by the app's audit cadence. Custom token TTL default 7 days.

**6.8.4 Password reset:** forgot-password server action (captcha + limiter + per-address cooldown) → email link to `/auth/confirm` (GET interstitial stores state, POST performs `verifyOtp`, scanner-safe, standardised). On successful `verifyOtp` with `type=recovery`, the confirm POST **mints a recovery grant**: a server-signed, single-use, httpOnly cookie bound to the user ID, expiring in 10 minutes. The reset action requires and atomically consumes this grant, so an ordinary signed-in session can never reach the reset surface; the grant cannot be minted by any other path and is cleared on success, failure, sign-out and expiry. Multi-device note: the grant lives where the link was opened; opening the form elsewhere requires a fresh link. After reset: password set server-side through `validatePassword`, `signOut({ scope: 'others' })`, audit. Expired/used links get a "request a new link" screen.

**6.8.5 Password change (signed in):** current password required, verified server-side with its own captcha token; then update, `signOut({ scope: 'others' })`, audit. A failed post-change sign-out never locks the user out.

**6.8.6 Account journeys (new, explicit):** email change: admin-only via the Admin API (Supabase user-initiated email change unused; its template still neutered-safe, 6.10). Admin-set temporary passwords: prohibited; use invite or reset. Reset for banned/inactive users: forgot-password still returns generic success; the link exchange fails on the ban and the active-identity gate blocks regardless. Duplicate invite for an existing active user: rejected. Invite cancellation: tokens invalidated, state `cancelled`. User self-deletion: not offered. Deleted Auth identity with a surviving application record: repaired only via a fresh invite (new Auth user, relink), audited.

**6.8.7 Sign-out:** POST, `signOut({ scope: 'local' })`, audit. Optional "sign out everywhere else" (`others`) permitted once scope behaviour is staging-proven.

All redirect params pass the shared same-origin path validator (rejects absolute URLs, `//host`, backslashes, encoded separators, control characters, auth loops). Password field UX: correct `autocomplete`, paste allowed, show-password, clear byte-limit errors.

### 6.9 Audit logging and governance

- Producers are server-side only (guaranteed by 6.5's server-side flow rule). Audit-write failure never blocks the user-facing operation; for multi-step admin workflows (offboarding, rehire) the steps continue but the workflow is marked incomplete, alerts, and the missing record is retried from a queue under the same operation ID.
- Required events: login success/failure, logout, reset requested, password updated, invite sent/accepted/cancelled, account banned/unbanned, role changed, email changed (admin), account deleted.
- Record contract: actor (user_id + email snapshot), target (for admin events), operation type, outcome, reason where applicable, operation/correlation ID for multi-step workflows, app + environment, server timestamp.
- PII: signed-in actor rows keep plaintext email (owner decision 10); pre-auth email events use HMAC-SHA-256 with `AUDIT_HMAC_KEY` (versioned, per-environment, in startup validation; canonical email input; rotation = new key version, old correlations simply age out; cross-app correlation not required). IP and user agent plaintext permitted.
- Governance (new): retention 6 years (aligned with UK employment/financial record practice) then deletion or archival by a tested job; the audit table is append-only for application roles (no UPDATE/DELETE grants); read access restricted to admin-level permission; audit rows survive Auth-user deletion (6.3).

### 6.10 Password policy and email

Password policy unchanged from v2.1 (min 12 code points, max 72 UTF-8 bytes, no composition, breach check via Supabase leaked-password protection or HIBP k-anonymity with `Add-Padding`, 2 s timeout, fail-open with audit event, no reuse of current password; one shared `validatePassword` on every password-setting surface, dashboard min length 12).

Email (corrected template scope): Supabase currently ships **six** auth templates: confirm signup, invite, magic link, change email, reset password, reauthentication. Each is mapped: reset + invite = active, plain-text-style, full URL, correct stated expiry matching configuration, support contact; magic link + confirm signup = **neutered** (6.8.1); change email + reauthentication = flows unused, templates replaced with a safe "not available" notice. Plus password-changed security notification enabled once SMTP is production-grade (adopted from review O-05), with a support path that does not rely on the possibly compromised session. Delivery: production SMTP, SPF/DKIM/DMARC, no link-rewriting on auth mail, provider bounce/complaint alerts configured to the owner's inbox, escalation = the owner (6.11).

### 6.11 Operational monitoring (minimum contract)

Named owner: the business owner. Mandatory minimum:

1. Immediate alert (in-app admin surface and/or email) on offboarding/rehire workflow failure and on sustained audit-write failure.
2. Provider-side alerts configured once: SMTP bounce/complaint notifications; Cloudflare status subscription for Turnstile.
3. Quarterly: re-verify the dashboard baseline (12) and review the CSP exception.
4. Event-triggered revalidation after changes to auth dependencies, domains, proxy, SMTP, Supabase plan, or this standard.

Continuous Management-API drift automation remains rejected as disproportionate (recorded, 2.1).

### 6.12 Database security (RLS)

As v2.1 (app-owned tables/views/functions/storage; anon default-deny; narrow anon policies only with per-table justification; versioned migrations; SECURITY DEFINER owner + fixed `search_path` + qualified objects) with one tightening: **anonymous public writes default to least-privilege paths** (narrow RPC or an equivalently restricted server credential). The full admin client on an anonymous route is a documented per-route exception requiring strict schema validation, fixed table/column operations, no client-supplied ownership fields, audit, and negative tests. Cross-user negative tests required.

### 6.13 Configuration (five control planes)

Conformance evidence is recorded per plane (template in 12):

1. **App environment (startup-validated, fail-fast):** Supabase URL + public key + secret key, app base URL + canonical-origins allowlist, Turnstile site/secret keys per environment, `AUDIT_HMAC_KEY` (versioned), HIBP toggle where used. No silent fallbacks.
2. **Supabase Auth dashboard:** signup OFF, anonymous OFF, providers except email OFF, single-session OFF, inactivity/time-box OFF, JWT expiry 15 min, min password length 12, leaked-password protection (plan permitting), Site URL + redirect allowlist, rate-limit values, CAPTCHA state, all six templates as 6.10.
3. **Cloudflare Turnstile:** widgets per environment with hostname restrictions; key rotation owner.
4. **SMTP/DNS:** provider, sender domain, SPF/DKIM/DMARC, alert configuration. (SMTP is dashboard-plane configuration; app env vars are only required where app code itself sends mail.)
5. **Hosting (Vercel):** Node version, trusted IP header behaviour, preview-domain policy including removal of stale preview origins.

Secret rotation: each plane's secrets have an owner and a tested rotation path; per-environment separation is mandatory (no shared keys between production and preview).

### 6.14 Two-factor authentication

Not part of this standard (owner decision 3). Placeholder 2FA UI is a conformance failure.

### 6.15 Testing, verification, accessibility, performance

Tiers as v2.1 (unit mocked; local Supabase for RLS; staging contract proofs; production read-only checks + smoke), with the round-2 additions to the staging/post-rollout matrix:

- direct OTP and signup denial per environment (6.8.1); redirect-allowlist denial; `/auth/confirm` type restriction;
- full CAPTCHA break-glass path (6.6 A); login retry after a consumed token;
- active-identity gate: inactive user denied on reads and writes; ban-expiry irrelevance (gate holds with ban lapsed); partial offboarding and partial rehire failures;
- invite state machine: banned-until-linked, concurrent acceptance, cancellation;
- recovery grant: single-use, expiry, cannot be minted by ordinary login, cross-device behaviour;
- GET semantic audit: registry complete, cron idempotency under retry, no sensitive-data GET without auth;
- headers: CSP (report-only then enforced), HSTS, `no-store`/`no-referrer` on token pages;
- audit: HMAC versioning, retry queue, offboarding-continues-on-audit-failure, FK survival of records after Auth-user deletion;
- origin guard behind the production proxy and preview domains; payment/message idempotency (6.4.8); refresh behaviour under realistic concurrency after the 15-minute JWT change.

Coverage: mandatory behaviour cases above take precedence; numeric thresholds are line + branch over the named auth modules (helpers, guard, validators, limiter, verifier, audit producers) configured in the test runner: 90% helpers/guard/validators, 80% auth actions. Targets are per app.

Accessibility: target WCAG 2.2 AA for login, forgot/reset, invite acceptance and Turnstile states (loading, error, expired, blocked-widget fallback with support contact). Portfolio baseline matrix: desktop Chrome keyboard-only, iOS Safari + VoiceOver. Focus management, live-region announcements, error summaries for multi-field validation, 200% zoom, contrast per AA.

Performance/resilience acceptance (proportionate): p95 login < 2.5 s and protected-navigation auth overhead < 300 ms in production-like staging; auth verification deduplicated within a request; double-submit prevented on auth forms; refresh error rate monitored after the JWT change with rollback (restore previous expiry) if sustained errors exceed 1%.

## 7. Removed from v1 (consistency-checked)

| Removed | Residual control |
|---|---|
| Magic links / passwordless / OAuth | Provider-boundary enforcement (6.8.1) + neutered templates + confirm-type restriction + negative proofs |
| Custom Redis session store | Active-identity gate + ban + sign-out scopes + 15-min JWT |
| CSRF double-submit layer | Server Action origin checks + shared origin guard + class protections |
| `login_attempts` lockout table | Turnstile + normative limiter defaults (6.5) + generic errors |
| 2FA section | Invite-only + CAPTCHA + breach-checked passwords (no other compensating control is claimed; shared-device risk is accepted, 2.1) |
| CSP `'unsafe-inline'` prohibition | Documented exception with owner, trigger and target state |

## 8. AMS conformance gap list (requirement-linked; the full requirement-to-evidence matrix is produced at rollout step 1 and kept beside this spec)

Prerequisites:
- A1. Node 22 LTS upgrade (`.nvmrc`, `engines`, CI, Vercel; prove pdf/canvas/sharp/puppeteer builds). [6.1]
- A2. Generated route registry for all 183 handlers incl. the 45 GET cron routes; CI enforcement. [6.4.1-3]

Public-surface security:
- B1. Protect `/api/parking/payment/retry` (guest token or Turnstile + limits; one live PayPal order per booking). [6.4.8, 6.6B]
- B2. Fix the Turnstile soft-bypass on the private-booking pair. [6.6B]
- B3. Turnstile on `/api/feedback`. [6.6B]
- B4. Abuse invariants (idempotency, cooldowns) on comms/payment-triggering public endpoints. [6.4.8]

Auth flows:
- C1. Shared origin guard on the 33 browser-called cookie-auth mutating handlers. [6.4.4]
- C2. Move forgot-password and reset (`resetPasswordForEmail`, `updateUser`) to server actions with captcha, limiter, audit. [6.5, 6.8.4]
- C3. Restrict `/auth/confirm` to `type=recovery`; neuter magic-link/signup templates. [6.8.1]
- C4. Recovery grant implementation. [6.8.4]
- C5. Shared `validatePassword` everywhere (remove 3-of-4 rule, raise min-8 surfaces to 12, byte cap, breach check). [6.10]
- C6. Revocation wiring: `signOut({scope:'others'})` on change/reset; ban-based offboarding + active-identity gate in shared helpers; rehire order. [6.3, 6.7]
- C7. Invite flow: banned-until-linked + state machine + idempotency. [6.8.3]
- C8. Remove dead Microsoft 365 button and placeholder 2FA screen. [3.1, 6.14]

Platform and hygiene:
- D1. `server-only` guard on the admin client. [6.1]
- D2. Typed auth result codes; JSON 401/403/429/503 mappings. [6.7]
- D3. Audit: missing events, HMAC pseudonymisation + `AUDIT_HMAC_KEY`, append-only grants, retention job, operation IDs. [6.9]
- D4. Headers: HSTS `includeSubDomains` after subdomain check; CSP baseline via report-only; `no-store`/`no-referrer` on auth/token pages. [6.2]
- D5. Limiter on the existing Upstash store with 6.5 defaults. [6.5]
- D6. Replace string-matched permission handling in menu-management/receipts handlers. [6.7]
- D7. Dashboard/config passes across all five planes, evidence recorded. [6.13, 12]

## 9. Out of scope

Code changes in this piece of work; per-app RBAC models; the timeclock kiosk PIN flow; customer flows that never authenticate; historical audit-row migration; non-auth performance work.

## 10. Disposition of round-2 findings

| Finding | Disposition |
|---|---|
| F-01 passwordless not enforced | Accepted; verified (`confirm/route.ts:47`); template neutering + confirm restriction + negative proofs (6.8.1) |
| F-02 GET mutations missed | Accepted; verified (45 cron routes, all GET); semantic registry replaces method counting (6.4.1-3) |
| F-03 read handlers unregistered | Accepted; registry covers all handlers incl. GET/HEAD with data-sensitivity class (6.4.1) |
| F-04 Node 20 EOL | Accepted; supported-LTS baseline, AMS upgrade is gap A1 (6.1) |
| F-05 offboarding gaps | Accepted; mandatory active-identity gate, ban demoted to defence in depth, rehire ordering, FK survival tests (6.3) |
| F-06 reset authority undecided | Accepted; single mechanism chosen and specified: server-minted single-use recovery grant (6.8.4) |
| F-07 break-glass incomplete | Accepted; Supabase is the sole enforcement point, app never hard-requires the token, widget-failure degradation defined, end-to-end staging proof required (6.6A) |
| F-08 contradictions | Accepted; §7 table and dispositions rewritten; full consistency pass done |
| F-09 demotion wording | Accepted; cache invalidation on change + 60 s max bound (6.3) |
| F-10 gap list omissions | Accepted; verified client-side reset/forgot calls and HSTS; gap list rebuilt requirement-linked (8) |
| F-11 Supabase URL config | Accepted; Site URL + exact redirect allowlist in baseline + negative tests (6.8.1, 6.13) |
| F-12 verifier/Supabase mapping | Accepted; split contracts A/B, widget re-executed every attempt, hostname at widget config for path A (6.6) |
| F-13 limiter underspecified | Accepted; normative defaults, three buckets, canonical email, trusted IP source, shared store where present (6.5) |
| F-14 abuse partly excluded | Accepted; minimum abuse invariants brought into scope (6.4.8) |
| F-15 guest tokens | Accepted; token class invariants (6.4.6) + page leakage controls (6.2) |
| F-16 invite guarantee | Accepted; state machine + banned-until-linked makes intermediate states unusable (6.8.3) |
| F-17 journeys undefined | Accepted; explicit allowed/prohibited journey set (6.8.6) + single-session recorded |
| F-18 typed errors | Accepted; shared result codes + HTTP mappings (6.7) |
| F-19 audit governance | Accepted; retention, append-only, access, record contract (6.9) |
| F-20 HMAC/audit failure | Accepted; versioned key in startup config, canonicalisation, retry queue, offboarding-continues clarification (6.9, 6.3) |
| F-21 service-role discretion | Accepted; least-privilege default with documented per-route exception contract (6.12) |
| F-22 CSP/header completeness | Accepted; full baseline profile, report-only phase, subdomain verification before includeSubDomains, gap D4 (6.2) |
| F-23 cache/leakage | Accepted; no-store, no-referrer, no third-party on token pages (6.2) |
| F-24 template scope | Accepted; six templates enumerated and mapped, notification enabled, delivery alerts owned (6.10) |
| F-25 JWT rollout bound | Accepted; change-then-wait rule (6.3) |
| F-26 config planes | Accepted; five-plane split with rotation ownership (6.13) |
| F-27 monitoring contract | Accepted proportionately; minimum contract with named owner (6.11); continuous automation still declined (2.1) |
| F-28 ownership/rollback/states | Accepted; adoption states, per-class rollback, evidence template included (11, 12) |
| F-29 negative tests | Accepted; folded into 6.15 |
| F-30 accessibility measurability | Accepted; WCAG 2.2 AA + named matrix (6.15) |
| F-31 coverage ambiguity | Accepted; behaviour-first + line/branch over named modules (6.15) |
| F-32 latency/refresh | Accepted; p95 targets, dedupe, rollback trigger (6.15) |
| O-01 CI registry | Adopted (6.4.2) |
| O-02 state diagrams | Adopted as state/transition tables (6.8.3, 6.3); diagrams optional at implementation |
| O-03 shared limiter | Adopted for AMS (existing Upstash); not universal (6.5) |
| O-04 CSP deadline | Adopted as owner + trigger; a fixed calendar date is declined in favour of the Next.js-upgrade trigger (6.2) |
| O-05 security notifications | Adopted: password-changed notification once SMTP is production-grade (6.10) |

## 11. Adoption, rollout and rollback

### 11.1 Adoption states

Per app: `v1-conformant` → `v2.2-migrating` → `v2.2-conformant`; anything else is `non-conformant`. v1 continues to govern an app until its migration starts; v2.2 governs from that point. The state is recorded in the app's CLAUDE.md. Approver for the standard, the AMS pilot and each later app: the business owner. Implementer: engineering sessions under this workspace.

### 11.2 AMS rollout order (each step has its rollback in 11.3)

1. Produce the requirement-to-evidence matrix + route registry (gaps A2, D7 evidence baseline).
2. Node 22 upgrade (A1) with full build/test proof.
3. Staging proofs: OTP/signup denial, redirect denial, sign-out scopes, ban + gate, recovery grant, invite state machine, CAPTCHA break-glass end-to-end, template rendering.
4. Public-surface fixes (B1-B4), then origin guard (C1).
5. Auth-flow changes (C2-C8) with the 6.15 tests.
6. Headers via report-only CSP phase; then enforce; HSTS subdomain check then `includeSubDomains` (D4).
7. JWT expiry to 15 min; record prior value; wait one prior lifetime before relying on the new bound.
8. CAPTCHA enablement: keys → CSP entries → code (degrading widget, token forwarding) → staging toggle + smoke → production toggle → immediate login/reset smoke.
9. Dashboard/config passes recorded across the five planes (12).
10. Re-audit with the updated auth-standardiser; state moves to `v2.2-conformant`.

### 11.3 Rollback per change class

Dashboard toggles (CAPTCHA, JWT expiry, providers): revert the toggle, owner-held, minutes. Code (guards, flows, validators): revert the deploying commit. RLS/migrations: paired down-migration written with each up-migration; service-role paths tested before deploy. Header/CSP: report-only mode is itself the rollback stage; enforcement reverts by config change. Node upgrade: previous pinned version retained in a branch until step 10 completes.

## 12. Conformance evidence template (per app)

For each row of the five planes (6.13) and each staging proof (6.15): setting/proof; expected value; actual value; environment; source (dashboard screenshot reference, test run, config file at commit); verified by; date; next recheck (quarterly or event-triggered). Exceptions carry: rule deviated from, rationale, owner, review trigger. The template ships inside the auth-standardiser skill and the completed copy lives in the app repository beside its CLAUDE.md.
