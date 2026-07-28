# Authentication Standard v2.1, Revised Specification for Re-validation

Date: 2026-07-23
Status: v2.1 FINAL DRAFT, revised after independent review of v2 (`tasks/auth-standard-v2-spec-review-2026-07-23.md`). Supersedes `tasks/auth-standard-v2-spec-2026-07-23.md`. All owner decisions are locked (sections 3 and 11); ready for re-validation. No code has been changed. The v1 standard remains in force until this spec is approved.
Evidence commit: `590711ba` (main tip). All file:line citations are at that commit.

This document is self-contained for re-validation. Section 9 gives the disposition of every review finding (F-01 to F-36, O-01 to O-06).

## 1. Purpose and scope

Replacement for the workspace authentication standard at `.claude/docs/auth-standard.md` (v1, 2026-06-26). Applies to all Next.js App Router + Supabase applications in the portfolio. Authorisation models remain app-specific (section 5.7). Adoption is per app via audited conformance (section 10); AMS is the pilot.

## 2. Context and threat model

- Internal management tools for small hospitality businesses. Invite-only, no public registration, tens of users, all known staff. Sensitive data: staff PII and payroll, customer contact details, bookings, payments.
- Public surfaces exist (table booking, recruitment, parking, feedback, guest self-service links) and are the main bot/abuse surface. A full inventory is in section 4.3.
- Primary threats in order: credential stuffing and password reuse against staff accounts; bot abuse of public forms (spam writes, email/SMS triggering, payment-order spam); a leaver or demoted staff member retaining or regaining access; opportunistic use of an unlocked shared device on premises.
- Acknowledged architectural facts (v2.1 addition): Supabase browser sessions live in JavaScript-readable cookies (`SameSite=Lax`, not HttpOnly, by SDK design), so XSS implies session theft; and email delivery is a security-critical dependency (reset and invites), so auth email must be production-grade (5.11).
- Accepted out of threat model (owner risk acceptance): targeted state-level attackers; malware on staff devices; compromise of a staff member's personal mailbox (email reset already reduces account takeover to mailbox security, with or without passwords).

## 3. Owner decisions (locked)

1. Email + password only. No magic links, no passwordless, no third-party identity providers ever (Microsoft, Google, Facebook, Apple or any OAuth/SSO). Placeholder UI advertising such options is a conformance failure.
2. Sessions have no idle or absolute timeout, and no step-up re-authentication anywhere. **Recorded risk acceptance:** anyone at an unlocked, signed-in device can perform any action that user can, including payroll and role changes. Mitigations are server-side revocation (5.3), a visible sign-out control, and premises practice. The reviewer's step-up recommendation (F-18) was put to the owner and declined.
3. No 2FA. Revisit only if privileged access is ever granted outside known staff.
4. Password minimum 12 characters, no composition rules, breached-password check. **Recorded as an explicit owner deviation from NIST SP 800-63B-4 / OWASP guidance of 15 characters for password-only authentication.** Not force-expired; applies at next set/change.
5. CAPTCHA (Cloudflare Turnstile) on staff login, forgot-password, and every fully anonymous public write surface. Not on authenticated forms. Signed/tokenised guest links and server-to-server API-key calls are exempt (5.6).
6. No Redis/Upstash requirement in the auth standard.
7. Simplicity: the standard describes what is actually built and audited. Proportionate-process deviations from the review are recorded in section 9 (monitoring, break-glass authority, portfolio matrix).

8. Leavers: the Auth account is banned at offboarding; deletion is a later data-retention step only. All audit trails, approvals and operational records tied to the person are retained intact through and after any deletion.
9. No step-up re-authentication (see decision 2).
10. Audit rows for signed-in actors keep the plaintext actor email for attribution; only pre-authentication events are pseudonymised (5.9).

All decisions are locked; nothing in this spec is pending owner input.

## 4. Current state (evidence at `590711ba`)

### 4.1 Corrections to v2's claims

- v2 claimed "all mutations are Server Actions". **False.** There are 183 Route Handlers, 77 exporting POST/PUT/PATCH/DELETE. Full classification in 4.2.
- v2 required `supabase.auth.admin.signOut(userId)`. **That API does not exist**: the installed `@supabase/auth-js` 2.101.1 signature is `admin.signOut(jwt, scope)` (`GoTrueAdminApi.d.ts:46`). `ban_duration` on `admin.updateUserById` is available (`types.d.ts:446`) and is the supported admin-side control.
- v2 carried v1's "roles in `app_metadata`" rule. AMS's authorisation is database-backed (`roles`, `user_roles`, `permissions`, checked via `checkUserPermission`, `src/services/permission.ts:142-196`). The rule is rewritten (5.7).
- Middleware allowlists the entire `/api` prefix (`src/middleware.ts:14`); every API handler self-enforces auth. The standard now regulates this explicitly (5.2, 5.4).
- `src/lib/supabase/admin.ts:1-20` has no `server-only` import or browser guard (fix list).
- The shared audit table stores plaintext `user_email` and looks it up when missing (`src/services/audit.ts:30-38`).

### 4.2 Mutating Route Handler inventory (77 total)

| Class | Count | Protection | Examples |
|---|---:|---|---|
| Webhook | 8 | Provider signature (Twilio validateRequest, Stripe sig, PayPal transmission sig, Svix) | `/api/webhooks/twilio`, `/api/stripe/webhook`, 4x PayPal refund |
| Cron | 5 | `Authorization: Bearer CRON_SECRET` via `authorizeCronRequest` (timing-safe) | `/api/cron/*`, `/api/jobs/process` |
| External API | 13 | Hashed API key via `withApiAuth` (`src/lib/api/auth.ts:303-315`); 3 also accept browser calls with Turnstile | `/api/table-bookings`, `/api/event-bookings`, `/api/external/*`, `/api/parking/bookings` |
| Cookie-auth self-check | 33 | `requireModulePermission` wrappers or `checkUserPermission` in the called server action, or direct `getUser()` | `/api/foh/*`, `/api/boh/*`, `/api/settings/table-bookings/*`, `/api/menu-management/*` |
| Token-gated public | 13 | Signed or hashed opaque token in URL + per-token throttle | `/g/[token]/*`, `/m/[token]/*`, `/api/recruitment/booking/[token]*`, `/api/private-bookings/outcome/*` |
| Public anonymous | 5 | Mixed, see defects below | `/api/feedback`, `/api/private-booking-enquiry`, `/api/public/private-booking`, `/api/parking/payment/retry`, `/auth/confirm` |

Browser-called cookie-auth mutating set (the CSRF-relevant set): `/api/foh/bookings*`, `/api/foh/event-bookings`, `/api/foh/food-order-alert`, `/api/boh/table-bookings/*`, `/api/menu-management/*`, `/api/menu/ai-parse`, `/api/rota/resync-calendar`, `/api/settings/table-bookings/*`. **None validates Origin or a CSRF token**; protection today is Supabase cookies' default `SameSite=Lax` only.

Defects found during this revision (added to the fix list, section 7):

- `/api/parking/payment/retry` (POST): fully anonymous, re-initiates a PayPal payment order, no token, no CAPTCHA, no rate limit; gated only by a guessable booking UUID.
- `/api/feedback` (POST): anonymous DB write + manager email, honeypot and 10/hour limit only, no CAPTCHA.
- Turnstile soft-bypass: `/api/private-booking-enquiry` (route L127) and `/api/public/private-booking` (L105) skip CAPTCHA whenever any `authorization`/`x-api-key` header is present, without validating the key.
- Menu-management/receipts handlers enforce permissions by string-matching errors thrown from server actions (fragile; works today).
- `authorizeCronRequest` authorises without a secret when not in production (`src/lib/cron-auth.ts:28-32`); acceptable, noted.

### 4.3 Public write surface inventory

| Surface | Writes | Email/SMS | Payment | Gating | CAPTCHA today |
|---|---|---|---|---|---|
| `/table-booking` → `/api/table-bookings` | Yes | SMS | Deposit | Anonymous | Turnstile |
| `/api/private-booking-enquiry`, `/api/public/private-booking` | Yes | Email | No | Anonymous | Turnstile (with soft-bypass bug) |
| `/api/recruitment/applications`, `/recruitment/book/[token]` | Yes | Email/SMS | No | Anon (apps) / token (booking) | Turnstile |
| `/feedback` → `/api/feedback` | Yes | Email | No | Anonymous | **None** |
| `/parking/guest` → `/api/parking/payment/retry` | Yes | No | PayPal | Anonymous (UUID) | **None** |
| `/g/[token]/*`, `/m/[token]/*`, `/r/[token]` guest self-service | Yes | Some SMS | Some | Hashed token + throttle | None (exempt, 5.6) |
| `/onboarding/[token]` | Yes | Possibly | No | Token + 60/15min middleware limit | None (exempt) |
| `/booking-portal/[token]` | Yes | Maybe | Maybe | Token | None (exempt) |
| `/timeclock` kiosk | Yes | No | No | PIN hash (no session) | None (exempt, out of scope) |

Dashboard-side facts remain **unverified** and are part of the conformance evidence to collect: signup enabled/disabled, anonymous sign-ins, provider list, inactivity/time-box settings, JWT expiry, auth rate-limit values, leaked-password protection availability, SMTP provider, email templates.

## 5. Proposed Standard v2.1 (normative)

### 5.1 Supabase clients and keys

Three credential roles, strictly separated:

- **Browser client** (`src/lib/supabase/client.ts`): public (publishable/anon) key, `createBrowserClient`, `flowType: 'pkce'`.
- **Server client** (`src/lib/supabase/server.ts`): public key, `createServerClient`, cookie handling for Server Components/Actions/Route Handlers.
- **Admin client** (`src/lib/supabase/admin.ts`): secret (service-role) key, marked `server-only` (import or an explicit browser-context throw), `autoRefreshToken: false`, `persistSession: false`. System operations only.

Additionally permitted (v2.1): one shared **middleware session adapter** using the public key with request/response cookie plumbing (Next.js middleware cannot reuse the server client unchanged). No other ad-hoc clients.

Keys: prefer Supabase publishable/secret keys for new work. Legacy `anon`/`service_role` JWT keys are deprecated by Supabase; each app records a migration plan with a deadline no later than the Supabase end-of-support date. Version baseline: Next.js 15+, `@supabase/ssr` 0.10+, `supabase-js` 2.101+, Node 20 LTS; any behaviour this standard depends on (Server Action origin checks, sign-out scopes, `ban_duration`, CAPTCHA options) must exist in the pinned versions.

Prohibited: admin client in client components or for user-scoped reads; tokens in localStorage; implicit flow for recovery/invite exchange.

### 5.2 Middleware and route protection

- Middleware refreshes/validates the session on protected page routes using `getUser()` (or `getClaims()` with asymmetric JWT verification where the project has it enabled; either satisfies the rule, `getSession()` alone never does).
- Public-path allowlist: segment-bounded prefixes, each entry commented. The `/api` prefix MAY be allowlisted (APIs must return JSON 401/403, not login redirects) **provided** every mutating handler carries a protection class per 5.4 and the audit verifies the classification. "Public in middleware" never means "public endpoint" for `/api`.
- Unauthenticated protected-page requests redirect to login. All redirect targets (`from`/`next` params, cookies) pass one shared same-origin path validator: path-only values; reject absolute URLs, network-path references (`//host`), backslashes, encoded separators, control characters, and auth-route loops.
- Auth service outage in middleware: fail closed to an error response, not a silent "logged out" redirect loop.

Security headers required on every page response (middleware or `next.config` headers, either placement conforms): HSTS `max-age` >= 31536000 with `includeSubDomains` (preload optional per app), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` denying camera/microphone/geolocation, CSP including `frame-ancestors 'none'`, `object-src 'none'`, `form-action 'self'`.

CSP for Turnstile requires `script-src` and `frame-src` entries for `https://challenges.cloudflare.com`. `'unsafe-inline'` in `script-src` is a documented accepted exception recorded in the app's CLAUDE.md **with an annual review trigger**; nonce-based CSP is the target state. The exception is explicitly linked to the JS-readable session cookie risk in section 2: XSS is the main residual session-theft path, so dependency patching and no unreviewed `dangerouslySetInnerHTML` are part of this rule.

### 5.3 Sessions, revocation and account lifecycle

Supabase's built-in session management is the only session layer. No custom store.

- No idle/absolute timeout. Dashboard "Inactivity timeout" and "Time-box user sessions" verified OFF and recorded.
- Access-token (JWT) expiry: **15 minutes** (dashboard; Supabase advises not below 5). This bounds all residual-access windows below.
- **User-present revocation** (supported client API): `supabase.auth.signOut({ scope })` with an explicit scope: `local` for normal sign-out, `others` after a password change/reset (keeps the current session), `global` where full sign-out is wanted.
- **Admin-initiated revocation** (no user JWT available): `admin.updateUserById(userId, { ban_duration })`. A banned user cannot sign in and cannot refresh tokens; residual access is bounded by the 15-minute JWT expiry. Calling `admin.signOut` with a user ID is prohibited (that API takes a JWT).
- **Leaver lifecycle (mandatory, ordered):** 1) mark the application identity inactive; 2) remove roles/permissions; 3) ban the Auth user (`ban_duration: '87600h'` or similar); 4) audit each step; if any step fails, alert and do not report offboarding complete. Deletion of the Auth user is a later data-retention step, not the access control, and it must leave audit trails, approvals and other operational records intact: nothing may cascade-delete or overwrite them, and audit attribution survives deletion via the stored actor email (5.9). Session revocation alone is never sufficient: a revoked-but-not-banned user can sign straight back in.
- **Demotion:** update the authoritative permission data (effective immediately for DB-checked permissions); no JWT dependency exists in DB-backed models. Apps that put authorisation claims in JWTs must additionally ban/re-issue within one token lifetime.
- Reactivation/rehire: unban via `ban_duration: 'none'`, restore roles, audit.

Staging proof required before approval is implemented: sign-out scopes behave as specified; a banned user's refresh fails and sign-in fails; unban restores access. (Section 10 step 2.)

### 5.4 Mutation protection (CSRF)

1. **Server Actions are the preferred surface** for browser-initiated mutations. Next.js enforces POST and Origin/Host validation on them; `serverActions.allowedOrigins` must list canonical production origins where proxies/preview domains differ.
2. **Browser-called cookie-auth Route Handlers are permitted** only through one shared same-origin guard (a wrapper alongside `requireModulePermission`). The guard compares the `Origin` header against a configured allowlist of canonical origins (app base URL + explicitly listed preview origins). Missing `Origin` on a mutating browser-class route: reject, unless `Sec-Fetch-Site: same-origin` is present. The guard is implemented once, tested behind the production proxy, and never re-implemented ad hoc. Migration of the existing 33 cookie-auth handlers to Server Actions is architectural preference, not a security requirement, once the guard is applied.
3. Non-browser mutating handlers use their class protection: webhooks (signature), cron (secret bearer), external API (API key), token-gated guest routes (signed/hashed single-purpose token + throttle).
4. Every mutating Route Handler is classified in a small route registry (path, class, protection, owner); the audit fails on unclassified mutating handlers. The registry for AMS is section 4.2.
5. Sign-out has POST semantics.
6. Cookie attributes: the Supabase SSR defaults (`SameSite=Lax`, `Secure` in production) are required minimums and asserted in tests.

### 5.5 Login rate limiting and brute force

- Login and forgot-password MUST be executed server-side (server action or route handler calling Supabase from the server), never by the browser calling Supabase Auth directly. This makes CAPTCHA forwarding, rate limiting, and audit logging trustworthy (5.9). AMS already conforms (`src/services/auth.ts` via the `signIn` action).
- Consequence (v2.1 correction to the review's assumption): Supabase's per-IP auth limits see the app server's egress IP, not the client's. They are therefore a backstop against total volume, not the per-attacker control. The controls that carry the load are: **Turnstile on login (5.6)** and an **app-level limiter keyed on client IP + hashed email** at the login action (modest: e.g. 10 failures per 15 minutes per key, using any per-instance or shared store; in-memory is acceptable given CAPTCHA carries the primary load, and this is recorded as such).
- No account lockout table. Generic error for wrong-password/unknown-email/limited states. Forgot-password always returns generic success.
- Configured Supabase auth rate-limit values are recorded in the app's conformance evidence at audit time.

### 5.6 CAPTCHA

Provider: Cloudflare Turnstile only.

Required on:

- **Staff sign-in and forgot-password**, via Supabase Auth's built-in CAPTCHA integration: enable in the dashboard; the client renders the widget; the server action forwards `captchaToken` in the `signInWithPassword`/`resetPasswordForEmail` options. Any other server-side `signInWithPassword` call (e.g. current-password verification, 5.8) must also carry a fresh token from its own widget.
- **Every fully anonymous public write surface** (no session, no signed token): for AMS today that is `/api/feedback`, `/api/parking/payment/retry` (which also needs a stronger fix, section 7), the private-booking pair, table/event bookings and recruitment applications (already present).

Exempt, with the exemption recorded per route in the registry: token-gated guest links (`/g`, `/m`, `/r`, onboarding, booking-portal, recruitment slot-picker where token-gated), the PIN-gated timeclock kiosk, webhooks/cron/API-key server-to-server calls, and payment-provider callbacks.

Shared verifier requirements (one module, no per-route implementations): server-side siteverify with a bounded timeout (2 s), **mandatory** `action` match and hostname allowlist check, single-use tokens (a failed/duplicate token resets the widget client-side), per-environment site/secret keys, no CAPTCHA response bodies logged, and siteverify failures return a safe generic error. Remove the header-presence soft-bypass; an API-key path skips CAPTCHA only after the key actually validates.

Outage policy: Supabase-enforced login CAPTCHA means a Turnstile outage blocks staff login. Break-glass: the named owner (single-operator business; two-person authority is intentionally not required) verifies the outage on the Cloudflare status page, disables Attack Protection > CAPTCHA in the dashboard, notes start time in the audit log or ops channel, and re-enables on recovery with a stated maximum of 24 hours. This is recorded as an owner-accepted availability trade-off.

### 5.7 Server-side authentication and authorisation

Authentication (standardised):

- Every protected page, Server Action and Route Handler verifies the user server-side. UI hiding is never a control.
- Required helper shapes per surface: pages `requireAuth()` (redirect) / `getCurrentUser()` (nullable); Server Actions return typed `{ error }` on auth failure (401-equivalent) rather than redirecting; Route Handlers `withAuth`-style returning JSON 401 (unauthenticated) / 403 (unauthorised). Auth-service outage in a helper returns a service error, never "not logged in".

Authorisation (app-specific; invariants only, v2.1 rewrite):

- Authorisation data is server-controlled and its **authoritative source is named per app** (AMS: database `roles`/`user_roles`/`permissions` via `checkUserPermission`; this model is the reference for permissioned apps).
- Every privileged operation re-checks the authoritative source server-side. Short read-caches (AMS: 60 s) are acceptable; the demotion propagation bound is the cache TTL for DB-backed models, or one JWT lifetime for claim-based models.
- `user_metadata` is never trusted for authorisation. `app_metadata` is one acceptable pattern, not mandated. Ordered (`>=`) comparisons only where the app defines a total ordering.

Step-up re-authentication: none (owner decision 9). High-impact actions rely on the ordinary session plus RBAC checks. The residual shared-device risk is the recorded acceptance in owner decision 2.

### 5.8 Auth flows

- **Sign-in:** server action calls `signInWithPassword` with the forwarded Turnstile token. Failures are audit-logged server-side with the limiter updated. Success creates the Supabase cookie session.
- **Sign-up:** invite-only. Public registration disabled in **Supabase project configuration**, not only app code: dashboard "Allow new users to sign up" OFF, anonymous sign-ins OFF, all providers except email OFF, and it must be proven (staging) that admin `createUser`/`inviteUserByEmail` still works with signup off. App-level: `/register`-like routes 404 or hard-disabled (AMS conforms).
- **Invites:** either `inviteUserByEmail` or a custom token flow. Contract (replaces v2's "atomic"): idempotent acceptance; single-use, expiring tokens (custom-token TTL: 7 days default, per-app documented); resend invalidates prior tokens and is blocked once confirmed; cancelled invites unusable; concurrent acceptance safe; compensating cleanup on partial failure (Auth-user deletion) with the failure alerting and a periodic orphan reconciliation; **no usable half-linked account at any point**. True cross-service atomicity is explicitly not assumed.
- **Password reset:** `resetPasswordForEmail` (with Turnstile) using `redirectTo` at the app's `/auth/confirm`. The confirm route keeps AMS's scanner-safe shape (GET interstitial that stores the token, POST performs `verifyOtp`), now standardised. The reset page requires a session established by the recovery flow (verify via the JWT `amr`/session evidence or a server-set one-time flag from the confirm POST; mechanism proven in staging), so an ordinary signed-in session cannot use the reset surface to skip current-password rules. Expired/used links get a clear "request a new link" screen. After a successful reset: `signOut({ scope: 'others' })`, keep the current session, audit event.
- **Password change (signed in):** requires current password, verified server-side via `signInWithPassword` with its own CAPTCHA token (or Supabase's nonce-based reauthentication where adopted). On success: update password, `signOut({ scope: 'others' })`, audit event. Failure of the post-change sign-out never locks the user out (their session remains valid).
- **Sign-out:** POST semantics, `signOut({ scope: 'local' })`, audit event. An optional "sign out everywhere else" profile action (`scope: 'others'`) is permitted once scope behaviour is staging-proven.
- Redirect params validated by the shared validator (5.2).
- UX baseline for all password fields: correct `autocomplete` tokens, paste allowed, show-password toggle, byte-limit errors shown clearly.

### 5.9 Audit logging

- Producers must be trusted: auth events are written server-side by the server action/route that performed the operation (never a browser-callable "log this" endpoint). This is guaranteed by the server-side-auth-calls rule (5.5).
- Required events: login success/failure, logout, password reset requested, password updated, invite sent/accepted, account banned/unbanned (offboarding), role changed.
- Audit-write failure never blocks the auth operation; it logs an error (fail-open, recorded).
- PII: rows for **signed-in actors** keep `user_id` and plaintext actor email (owner decision 10: internal staff tool, managers need attribution, and records must stay readable after the Auth user is eventually deleted). Events keyed to an **unauthenticated, unverified email** (failed login, reset request) store an HMAC-SHA-256 pseudonym with a server-side key, not bare SHA-256 and not plaintext. IP and user agent plaintext permitted. No migration of historical rows is required.

### 5.10 Password policy

One shared server-side `validatePassword`; client checks are UX only.

| Constraint | Value |
|---|---|
| Minimum length | 12 Unicode code points (owner deviation from the 15-char NIST/OWASP password-only baseline, recorded in 3.4) |
| Maximum length | 72 bytes UTF-8 (bcrypt backend limit), enforced server-side in bytes, clear UI error, no silent truncation. Recorded deviation from "allow 64+ characters" guidance for multibyte passphrases |
| Composition rules | Prohibited |
| Breach check | Supabase leaked-password protection (dashboard) where the plan supports it; otherwise HIBP range API: SHA-1 k-anonymity prefix, `Add-Padding` header, 2 s timeout, no hash/password logging. **Fail-open** on HIBP outage with an audit event (availability priority for an invite-only staff app; recorded) |
| Current password | Must not match on change |

Normalisation: passwords are not case- or Unicode-normalised; bytes as entered. Supabase dashboard minimum length also set to 12.

### 5.11 Email delivery and content

Content rules unchanged from v1/v2: plain-text-style templates replacing every Supabase default (all four, disabled flows marked as safety nets), full visible action URL, stated expiry, support contact, links only to the app's own `/auth/confirm`.

Delivery (v2.1 addition): production projects use custom SMTP (Supabase's default sender is best-effort and rate-limited to a handful of emails per hour, unsuitable for real use); sender domain has SPF/DKIM/DMARC; auth emails are exempt from any link-rewriting/click-tracking; the conformance evidence records the SMTP provider and a delivered test of invite + reset emails. Bounce/delivery monitoring is the provider dashboard (proportionate; no bespoke pipeline required).

### 5.12 Database security (RLS)

As v2, scoped (v2.1): applies to application-owned tables, views, functions and storage buckets (not Supabase-managed internal schemas). anon default-deny; narrow anon policies are permitted only with a documented per-table justification. Public-form writes go through server-side handlers; prefer narrow `SECURITY DEFINER` RPCs (owner and `search_path` audited) over broad admin-client writes where practical. Policies per role, delivered as versioned migrations, views and definer functions audited, anon/authenticated/service-role tests plus cross-user negative tests required.

### 5.13 Startup configuration validation

As v2: single config module validating required vars at boot/build, fail fast, no silent fallbacks for security-relevant config, `.env.example` complete. Required minimum: Supabase URL + public key + secret key, app base URL, Turnstile site/secret keys per environment, SMTP config where applicable. No Redis variables.

### 5.14 Two-factor authentication

Not part of this standard (owner decision 3). Placeholder 2FA UI is a conformance failure.

### 5.15 Testing and verification

Three tiers (v2.1 restructure; "always mock everything" is withdrawn as unprovable):

1. **Unit (mocked externals):** auth helpers (redirect/null/401/403/outage), shared origin guard (allowed, disallowed, missing Origin, Sec-Fetch-Site), redirect validator (malicious-input table), `validatePassword` (min/max bytes, no composition, breach-check invocation, reuse), Turnstile verifier (action/hostname mismatch, timeout, duplicate token), invite lifecycle (single-use, expiry, resend invalidation, concurrent acceptance, compensation), audit producers (events fired, pseudonymisation, fail-open).
2. **Local Supabase integration:** RLS suites (anon denied, authenticated scoped, cross-user negative, service-role path).
3. **Staging contract proofs (once per adoption, evidence retained):** signup disabled but admin creation works; sign-out scopes; ban blocks sign-in and refresh; recovery flow end-to-end including scanner-safe confirm, expired/reused link UX, and reset-page recovery-session gating; CAPTCHA enforcement on login/reset (Cloudflare test keys); email delivery of invite + reset via production SMTP.
4. **Post-rollout production checks:** read-only dashboard configuration verification and one controlled login/logout smoke test.

Accessibility acceptance for auth journeys (login, forgot/reset, invite acceptance): keyboard-only completion, labelled fields, error announcements via live regions, focus moved to errors, Turnstile-blocked fallback message with support contact, 200% zoom usability. Verified manually once per app plus automated checks where present.

Coverage targets: auth helpers and origin guard 90%; password/validators 90%; auth actions 80%.

## 6. Removed from v1 (unchanged rationale, updated residuals)

| Removed | Residual control |
|---|---|
| Magic links / passwordless / OAuth (ban re-affirmed, now also enforced at Supabase provider config) | Password policy + CAPTCHA + limiter + provider config baseline |
| Custom Redis session store | Ban-based admin revocation + `signOut` scopes + 15-min JWT |
| CSRF double-submit layer | Server Actions origin checks + shared origin guard for the 33 cookie-auth handlers + webhook signatures + cron secret |
| `login_attempts` lockout table | Turnstile on login + app-level IP+email limiter + generic errors |
| 2FA section | Invite-only + CAPTCHA + breach-checked passwords + step-up for high-impact actions |
| CSP 'unsafe-inline' prohibition | Documented exception with annual review + XSS hygiene rules |

## 7. AMS conformance gap list under v2.1 (future changeset, no code changed)

Security-ordered:

1. Protect `/api/parking/payment/retry`: require the guest booking token (or Turnstile + rate limit) before creating PayPal orders.
2. Fix the Turnstile soft-bypass on `/api/private-booking-enquiry` and `/api/public/private-booking` (skip only after the API key validates).
3. Add Turnstile to `/api/feedback`.
4. Apply the shared same-origin guard to the 33 browser-called cookie-auth mutating handlers (one wrapper change at `requireModulePermission` level covers most).
5. Wire revocation: `signOut({scope:'others'})` on password change/reset; ban-based offboarding step in the leaver flow; unban on rehire.
6. Enable Supabase CAPTCHA and pass tokens from login/reset/change forms (deployment order in section 10).
7. Replace password rules with shared `validatePassword` (min 12, no composition, 72-byte, breach check); remove the 3-of-4 class rule in `profile.ts`; raise the four min-8 surfaces.
8. Add missing audit events (reset requested/completed, ban/unban) and HMAC pseudonymisation for pre-auth email events.
9. `server-only` guard on `src/lib/supabase/admin.ts`.
10. Remove the dead Microsoft 365 button and placeholder 2FA screen from the login page.
11. Replace the fragile string-matched permission handling in menu-management/receipts handlers with the standard helper.
12. Dashboard work (recorded as evidence): signup off, anonymous off, providers off, JWT expiry 15 min, inactivity/time-box off, min length 12, leaked-password protection on (plan permitting), rate limits recorded, SMTP + templates verified.

## 8. Out of scope

Code changes; per-app RBAC models; non-auth rate limiting; the timeclock kiosk PIN flow; customer flows that never authenticate; historical audit-row migration.

## 9. Disposition of review findings

| Finding | Disposition |
|---|---|
| F-01 invalid revocation API | Accepted; verified against installed SDK; replaced with scopes + ban (5.3) |
| F-02 leaver re-login | Accepted; mandatory lifecycle with ban (5.3); ban-vs-delete default pending owner |
| F-03 Server Action claim false | Accepted; verified (183/77); inventory embedded (4.2); shared origin guard replaces forced migration (5.4) |
| F-04 app_metadata contradiction | Accepted; invariants only; AMS DB model is the reference (5.7) |
| F-05 Supabase-boundary enforcement | Accepted; provider/signup config baseline (5.8) with staging proof |
| F-06 password flows unimplementable | Accepted; explicit sequences incl. CAPTCHA interplay (5.8) |
| F-07 CSRF contradiction | Accepted; single guard spec, missing-Origin and proxy behaviour defined (5.4) |
| F-08 /api exemption | Accepted; classification registry rule (5.2, 5.4) |
| F-09 recovery authority | Accepted; recovery-session gating + scanner-safe confirm standardised (5.8) |
| F-10 atomicity overstated | Accepted; saga contract wording (5.8) |
| F-11 invite lifecycle | Accepted; lifecycle contract + 7-day TTL (5.8) |
| F-12 NIST mislabel | Accepted; 12 recorded as explicit owner deviation; counting and byte rules defined (5.10) |
| F-13 HIBP contract | Accepted; fail-open + timeout + padding + logging rules (5.10) |
| F-14 brute-force quantification | Partially accepted with correction: login is server-side, so Supabase per-IP limits are not client-attributable; Turnstile + app-level IP+email limiter are primary (5.5). Full alerting stack rejected as disproportionate (see F-29) |
| F-15 CAPTCHA scope undeliverable | Accepted; full public-surface inventory embedded (4.3) + registry + named exemptions (5.6) |
| F-16 Turnstile incomplete | Accepted; shared verifier contract incl. action/hostname/CSP/test keys (5.6); soft-bypass bug added to fix list |
| F-17 runbook unsafe | Adapted: break-glass with named single owner, status-page verification, time-box, audit; two-person authority rejected (single-operator business, recorded) (5.6) |
| F-18 shared-device risk | Put to the owner and declined: no step-up; recorded as an explicit risk acceptance (owner decision 2) |
| F-19 getUser guidance | Accepted; getClaims permitted, outage behaviour defined (5.2, 5.7) |
| F-20 middleware client + admin guard | Accepted; adapter permitted (5.1); admin `server-only` in fix list |
| F-21 key deprecation | Accepted; generic key roles + migration deadline + version baseline (5.1) |
| F-22 JS-readable cookies + CSP | Accepted; acknowledged in threat model + CSP exception tied to XSS hygiene and annual review (2, 5.2) |
| F-23 audit producers | Accepted; server-side auth calls make producers trusted; fail-open defined (5.5, 5.9) |
| F-24 email-hash conflict | Adapted: plaintext actor email retained for signed-in events (pending owner), HMAC pseudonym for pre-auth events, no backfill (5.9) |
| F-25 RLS scope | Accepted; scoped to app-owned objects, narrow anon policies with justification, RPC preference (5.12) |
| F-26 mock-only contradiction | Accepted; three-tier testing with staging proofs (5.15) |
| F-27 missing journeys | Accepted; expanded mandatory list incl. outage, enumeration, redirect, accessibility (5.15) |
| F-28 email delivery | Accepted; SMTP + SPF/DKIM/DMARC + no link tracking + delivered-test evidence (5.11) |
| F-29 monitoring/drift | Adapted (proportionality): re-verification at every auth-standardiser audit + dashboard checks in rollout, provider dashboards for delivery; continuous Management-API drift detection and alert SLAs rejected for a single-owner estate; recorded as owner risk acceptance |
| F-30 portfolio rollout | Adapted: per-app audit-gated adoption via the auth-standardiser skill; apps are "unaudited" until run; AMS pilots; up-front portfolio matrix rejected (skill produces the same evidence app by app) |
| F-31 deployment order | Accepted; ordered enablement runbook (10) |
| F-32 evidence incomplete | Accepted; current-state regenerated with inventories and named unverified items (4) |
| F-33 helper contracts | Accepted; per-surface contracts incl. Server Actions and 403 (5.7) |
| F-34 redirect validation | Accepted; shared validator spec (5.2) |
| F-35 header values | Accepted; minimums defined, placement flexible (5.2) |
| F-36 accessibility | Accepted; acceptance checks in testing (5.15) |
| O-01 sign-out other devices | Accepted as optional (5.8) |
| O-02 security notifications | Deferred (backlog) |
| O-03 route registry | Accepted, lightweight (5.4) |
| O-04 CSP review date | Accepted, annual trigger (5.2) |
| O-05 evidence template | Accepted; will live in the auth-standardiser skill checklist |
| O-06 password-manager UX | Accepted (5.8) |

## 10. Rollout and deployment order (AMS pilot)

1. Owner decisions complete (sections 3 and 11). Validator re-reviews this v2.1.
2. **Staging proofs** (disposable/staging Supabase project): sign-out scopes; ban/unban; signup-off + admin creation; recovery-flow gating; CAPTCHA on login/reset with Cloudflare test keys.
3. Rewrite `.claude/docs/auth-standard.md` as v2.1; update the auth-standardiser skill (checklist rows, `audit.mjs` checks: drop Redis/CSRF-token/lockout/Turnstile-fail-soft checks; add origin-guard, registry-classification, password-policy, ban-lifecycle, provider-config and prohibited-social-login checks; refresh reference snapshots).
4. AMS changeset(s) per section 7, ordered: fixes 1 to 3 (public-surface holes) first; then guard rollout (4); then password/flows (5 to 8); each with the verification pipeline.
5. **CAPTCHA enablement order:** create per-env Turnstile keys → add CSP entries → deploy code that renders widgets and forwards tokens (inert while dashboard CAPTCHA is off) → enable in staging dashboard, smoke → enable in production dashboard → immediate login/reset smoke. Rollback for every dashboard step is the toggle itself, owner-held.
6. Dashboard configuration pass (fix item 13) recorded in the conformance evidence.
7. Other portfolio apps adopt via individual auth-standardiser audits before claiming conformance.

## 11. Owner decisions record (resolved 2026-07-23)

1. Leavers: ban at offboarding; delete later per data retention; audit trails, approvals and records retained intact through and after deletion. Adopted in 5.3.
2. Step-up re-authentication: declined; recorded risk acceptance. Adopted in 3.2 and 5.7.
3. Audit rows for signed-in actors keep plaintext staff email. Adopted in 5.9.
