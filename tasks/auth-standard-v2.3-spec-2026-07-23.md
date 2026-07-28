# Authentication Standard v2.3, Revised Specification for Re-validation

Date: 2026-07-23
Status: v2.3 FINAL DRAFT. Supersedes `tasks/auth-standard-v2.2-spec-2026-07-23.md` after the third independent review (v2.2 review: 3 P0, 16 P1, 4 P2). All three P0s and all P1/P2s are resolved in this text; the decision log (section 4) closes every open choice. No code has been changed. The v1 standard remains in force until this spec is approved.
Evidence commit: `590711ba`. New evidence this round is cited inline.

Self-contained for re-validation. Section 10 gives the disposition of every round-3 finding.

## 1. Purpose and scope

Replacement for the workspace authentication standard (v1, 2026-06-26) for all Next.js App Router + Supabase apps in the portfolio. Authorisation models remain app-specific (6.7). Adoption is per app with explicit states (11.1); AMS pilots.

## 2. Context and threat model

As v2.2: invite-only internal staff tools; tens of known users; staff PII/payroll, customer contact, bookings, payments; public booking/recruitment/parking/feedback surfaces are the abuse surface; Supabase browser sessions are JavaScript-readable cookies so XSS implies session theft; email delivery is security-critical. Primary threats in order: credential stuffing; bot abuse of public forms; leaver/demoted access; unlocked shared devices.

New acknowledgement (round 3): the browser talks to Supabase directly in places (Realtime subscriptions, e.g. `src/app/(authenticated)/table-bookings/foh/hooks/useFohRealtime.ts`; upload flows), so authorisation must hold at the Supabase data plane, not only in Next.js code (6.3.1).

### 2.1 Residual risk register (accepted, with owner)

Owner for all product risks: the business owner (Peter Pitcher).

| Residual risk | Why accepted | Review trigger |
|---|---|---|
| Indefinite sessions, no 2FA, no step-up for business actions: an unlocked signed-in device reaches payroll and role changes | Owner decisions 2, 3 | Privileged access outside known staff |
| Existing weak/breached passwords persist until next change | Owner decision 4 | Credential-compromise incident |
| XSS session theft while `'unsafe-inline'` script CSP remains | Planned debt with owner + quarterly review (6.2) | Quarterly review / Next.js major upgrade |
| Issued JWTs remain usable at boundaries without the restrictive RLS check for up to 15 minutes after ban | Platform behaviour; bounded by 6.3; DB reads/writes are covered immediately by the restrictive policy | Restated in offboarding docs |
| CAPTCHA and email are external dependencies with one operational owner | 6.6 break-glass + 6.11 alerts | Provider incident |
| In-memory rate limiting only where no shared store exists (AMS uses Upstash) | Turnstile primary (6.5) | App gains external users |
| Plaintext staff email, IP and user agent in audit rows | Owner decision 10 + governance 6.9 (split retention, append-only, restricted read) | Data-protection review |
| Guest bearer tokens appear in infrastructure request logs (URL paths) | Hosting logs cannot be redacted app-side; mitigated by short TTLs, hashing at rest, no app logging (6.4.6) | Move to short exchange codes when routes are next rebuilt |
| Passwordless suppression depends on Supabase configuration (hook + templates) that dashboard edits could regress | Quarterly config review + negative proofs re-run (6.11, 6.15) | Any dashboard change |

## 3. Owner decisions (locked)

1. Email + password only. No magic links, no passwordless, no third-party identity providers ever. Enforced per 6.8.1 (the exact achieved property is stated there, without overclaim). Placeholder UI for other methods is a conformance failure.
2. No idle or absolute session timeout, and **no step-up re-authentication for business actions**. Clarified (round 3): requiring the current password (plus captcha) to change that same credential is credential-change confirmation, not step-up, and is retained (6.8.5). Recorded risk acceptance for unlocked shared devices (2.1).
3. No 2FA.
4. Passwords: min 12 (explicit deviation from the 15-character password-only baseline), no composition rules, breach check, applied at next set/change.
5. Turnstile on staff login, forgot-password, and every fully anonymous public write surface; token-gated links and server-to-server calls exempt; nothing on authenticated forms.
6. No Redis/Upstash requirement in the standard itself; apps that already run a shared store use it for auth limiting (AMS: Upstash).
7. Proportionality: the standard describes what is actually built and audited; deviations are recorded.
8. Leavers: banned at offboarding; deletion is a later retention step; audit trails, approvals and operational records survive intact.
9. (Merged into 2.)
10. Audit rows for signed-in actors keep plaintext actor email; pre-authentication events are pseudonymised.

## 4. Decision log (round 3, closes every "unresolved decision" from the v2.2 review)

| Question | Decision |
|---|---|
| Direct Data API access vs server-only data access | Direct access stays enabled. The active-identity check is enforced in the database itself via a restrictive RLS policy (6.3.1), so moving all data access server-side is unnecessary |
| Database/storage policy design for active identity | One `is_active_staff()` STABLE function (fail-closed: no matching active identity row = false) applied as a **restrictive** RLS policy by generated migration to every application table that grants `authenticated` access, and referenced by Storage policies. Indexed lookup |
| Recovery-grant storage, consumption, keys | Opaque 256-bit random value in an httpOnly cookie; **SHA-256 hash stored in a `recovery_grants` table** (user_id, hash, expires_at, consumed_at); atomic claim via single conditional UPDATE; no signing key needed (6.8.4) |
| Native Supabase invites | **Removed from the standard.** One invite profile only: custom token flow with the Auth user created banned (`createUser` accepts `ban_duration`, verified: `AdminUserAttributes`, types.d.ts:4,47; GoTrueAdminApi.d.ts:315) (6.8.3) |
| Hosted control for disabling passwordless | Primary: **Send Email Hook** (Postgres function) rejecting `magic_link` and `signup` action types, which fails the auth request. Secondary: neutered templates. The `/auth/v1/otp` endpoint itself remains enabled; the conformance claim is stated exactly (6.8.1) |
| Multiple grants / provider failure after claim | New reset request invalidates prior grants; validation precedes claim; claim is atomic and immediately precedes the provider update; a provider failure leaves the grant consumed and the UI offers a fresh link (6.8.4) |
| Admin email change | Defined saga with uniqueness check, ordered updates, forced re-login via ban/unban cycle, notification to old and new addresses, audit with actor + target + operation ID (6.8.6) |
| Step-up exception | Clarified in owner decision 2; Supabase "Secure password change" recorded **OFF** in the dashboard baseline (its nonce email is unused and its template neutered) (6.13) |
| Limiter reset and outage | Success resets the pair and email buckets only, never the IP bucket; Upstash variables in AMS startup validation; limiter-store outage fails open with an alert (6.5) |
| CSP reporting | Violations collected at an app endpoint (`/api/csp-report`), 2 weeks of production traffic in report-only, enforcement gate = no unexplained violation classes (6.2) |
| Audit retry technology | The existing AMS background jobs system (`/api/jobs/process`): outbox-style payload with unique event ID, backoff, dead-letter alert (6.9) |
| Audit retention basis | Split by class: administrative/change events (roles, offboarding, invites, email change, deletion) 6 years (employment-records basis); sign-in telemetry (login success/failure, logout, IP/UA rows) 12 months; deletion, not archival (6.9) |
| Rollback rules for security changes | Forward-fix policy for RLS/policy defects; expand/contract migrations; security controls are never removed by a rollback; per-task rollback notes in the delivery table (11.3) |
| Public hotfixes before approval | Recommended for immediate release independent of this programme (11.2 phase 0), subject to the owner's go-ahead |
| Node LTS | Node 22 (unchanged from v2.2) |

## 5. Current state (evidence at `590711ba`)

Carried over, all verified in rounds 1-2: 183 Route Handlers (77 method-mutating + 45 GET-invoked cron routes, all with side effects); middleware allowlists all of `/api`; 33 browser-called cookie-auth mutating handlers with no Origin checks; `/auth/confirm` accepts five token types incl. `magiclink` (route.ts:47); forgot-password and reset call Supabase from the browser; Turnstile soft-bypass on the private-booking pair; `/api/feedback` captcha-less; `/api/parking/payment/retry` unprotected; HSTS without `includeSubDomains`; Node 20 (EOL) pinned; admin client lacks `server-only`; audit stores plaintext `user_email`; AMS RBAC database-backed.

New this round (verified 2026-07-23): browser-side Supabase Realtime is in use (`useFohRealtime.ts`), so data-plane enforcement is required (6.3.1); `admin.createUser` supports `ban_duration` in the installed SDK, so banned-at-creation invites are implementable.

Dashboard facts remain unverified until the evidence pass (12).

## 6. Standard v2.3 (normative)

### 6.1 Clients, keys, runtime

As v2.2: three credential roles (browser public, server public, admin secret + `server-only`), one middleware session adapter, no ad-hoc clients; publishable/secret keys preferred with a legacy-key migration deadline; runtime = a currently supported Node LTS (today Node 22) with the exact version recorded per app; version floor Next.js 15+, `@supabase/ssr` 0.10+, `supabase-js` 2.101+; every relied-on platform behaviour must exist in the pinned versions.

### 6.2 Transport, headers, CSP, caching

As v2.2 (HSTS >= 1y, `includeSubDomains` after subdomain verification; nosniff; DENY; referrer policy; permissions policy; auth/token pages `no-store`, token pages `no-referrer` + no third-party resources; authenticated sensitive responses `private, no-store`) with these round-3 corrections:

- CSP profile semantics stated exactly: `default-src 'self'` is the inherited baseline; directives not listed inherit it. Required explicit entries: `base-uri 'self'`; `object-src 'none'`; `frame-ancestors 'none'`; `form-action 'self'`; `script-src` and `frame-src` + `https://challenges.cloudflare.com`; `connect-src` + the Supabase project origin. Expected app exceptions are declared per app (AMS today: `style-src 'unsafe-inline'`; `img-src 'self' data: blob:` + storage domain; PayPal origins), each with a reason.
- Report-only process defined: violations POST to `/api/csp-report` (stored, capped, reviewed); minimum 2 weeks of real production traffic; enforcement gate: no unexplained violation classes remain.
- The `'unsafe-inline'` script exception: owner recorded, **quarterly review** (one cadence everywhere), target state nonce-based.

### 6.3 Sessions, revocation, account lifecycle

Supabase sessions only; no timeout; single-session OFF; JWT expiry 15 minutes; sign-out scopes and ban-based admin revocation as v2.2 (`admin.signOut` with a user ID remains prohibited).

**6.3.1 Active-identity enforcement at every boundary (replaces the helper-only gate):**

- Each app names one authoritative active-identity source (AMS: the employee/user record and its status column, fixed during the preflight below).
- **Application layer:** shared helpers (6.7) check it on every authenticated request; server-path access ends immediately at offboarding.
- **Database layer:** one `is_active_staff()` STABLE SQL function, fail-closed (no active row for `auth.uid()` = false), applied as a **restrictive RLS policy via generated migration to every application table that grants the `authenticated` role access**, and referenced by Storage policies for staff buckets. Direct Data API, RPC and Storage access by an inactive user is therefore denied immediately, even with a still-valid JWT. The function is indexed and covered by the RLS test suite.
- **Realtime:** staging proof that a banned user's subscription stops receiving data no later than access-token expiry; staff-sensitive channels must also be policy-guarded where Realtime authorisation supports it.
- **Signed Storage URLs:** TTL <= 60 minutes for staff-sensitive objects, recorded per bucket in the registry; issued URLs are accepted as expiring rather than revocable.
- **Honest bound:** with the restrictive policy, database access ends immediately; any boundary not covered by RLS (e.g. an issued signed URL) is bounded by its recorded TTL; token refresh dies at the ban. No "immediate everywhere" claim is made beyond this.

**6.3.2 Leaver lifecycle (ordered):** 1) identity inactive (server paths and DB access end via 6.3.1); 2) roles removed; 3) Auth user banned (`ban_duration: '876000h'`, defence in depth; expiry is not a security boundary); 4) each step audited; steps continue on audit failure but the workflow is incomplete + alerts + retries via the audit queue (6.9). Deletion later per retention; audit/approvals/records survive (FK tests).
**Rehire:** identity and roles first, unban last; partial failure leaves the account unusable, alerts, re-runnable.
**Demotion:** authoritative data update + cache invalidation in the same operation; max bound = cache TTL (AMS 60 s), in-flight requests included.
**Emergency full revocation (any user):** ban then immediately unban; all refresh tokens die, sessions end within one JWT lifetime; documented as the support procedure after a suspected session theft.
**Identity preflight (new, before the gate is enforced):** produce and reconcile a one-to-one Auth-to-identity inventory (orphans, duplicates, portal-only and admin accounts, service identities); define exact active values; backfill; only then enable fail-closed enforcement. Missing identity = inactive = denied, so the backfill must be proven complete first (gap C6a).
**JWT expiry migration:** record prior value, change, wait one prior lifetime before relying on the new bound; monitor refresh errors.

### 6.4 Route protection and mutation safety

As v2.2 (semantic registry of all 183 handlers incl. GET/HEAD with data-sensitivity class, CI-enforced generation, GET side effects prohibited for browser routes with the documented idempotent cron exception, Server Actions preferred + single shared origin guard for the 33 cookie-auth handlers, class protections, POST sign-out, cookie minimums, abuse invariants for comms/payment endpoints), with the token model corrected:

**6.4.6 Guest-token classes (corrected):**
- **Default class, opaque:** >= 128-bit random value; stored server-side only as a hash; constant-time compare; purpose- and resource-bound; documented TTL and revocation per family in the registry; one-time where the action is one-time.
- **Signed class (separate, existing `verifyBookingToken` family):** self-contained signed tokens; must document key ownership and rotation, expiry, audience, and their non-revocability within TTL.
- **Logging (testable, no impossible claims):** application code never logs token values; infrastructure/CDN request logs will contain URL-path tokens and this is a recorded residual risk (2.1) mitigated by short TTLs and hashing at rest; new or rebuilt routes prefer a short single-use exchange code over a long-lived bearer in the path.

### 6.5 Login rate limiting and brute force

As v2.2 (server-side flows only; Supabase per-IP limits are egress-volume backstop; Turnstile primary; buckets: 10/15 min per canonical-email+IP pair, 20/15 min per email, 50/15 min per IP; canonical email = trim+lowercase; platform-trusted client IP), with round-3 corrections:

- **Reset semantics:** success resets the pair and email buckets for that account only; the IP bucket never resets on success (prevents an attacker clearing spray history with a controlled account) and decays only by its window.
- **Store:** AMS uses its existing Upstash store; the Upstash URL/token join AMS startup validation (6.13); limiter-store outage **fails open with an immediate alert** (captcha remains the primary control; recorded).
- Optional evaluation (from review O-04): `Sb-Forwarded-For` trusted client-IP forwarding to Supabase Auth, staging-only evaluation, never at the cost of exposing the secret key or weakening the app limiter.

### 6.6 CAPTCHA (Turnstile)

As v2.2 (contract A: Supabase-enforced auth flows, app never hard-requires the token, widget degrades gracefully and re-executes after every submission, hostname restrictions at widget config, dashboard toggle is the complete break-glass with end-to-end staging proof; contract B: application-verified public forms via one shared verifier with mandatory action + hostname checks; coverage per owner decision 5), plus round-3 monitoring:

- **Tokenless-success alert:** a successful login with no captcha token implies enforcement is off; the app emits a high-priority audit event and an email alert immediately, repeated daily while the condition persists, and the break-glass runbook includes verified re-enablement. Email alerting is independent of Supabase Auth; if the mail plane is also down, the daily repetition covers recovery.

### 6.7 Server-side authentication and authorisation

As v2.2 (server-side verification everywhere; helper contracts with typed result codes `unauthenticated | unauthorised | rate_limited | captcha_failed | validation_failed | service_unavailable | unexpected` and JSON 401/403/429/503 mappings; authorisation invariants; authoritative source named per app; demotion bound per 6.3.2), with the active-identity check from 6.3.1 folded into the shared helpers.

### 6.8 Auth flows

**6.8.1 Passwordless enforcement (claim corrected):** the achieved property is: *a passwordless request never yields a usable credential.* The `/auth/v1/otp` endpoint itself remains enabled (no hosted setting disables it while preserving password, recovery and invites; this is stated, not hidden). Controls, layered:
1. **Send Email Hook** (Postgres function, primary): rejects `magic_link` and `signup` email action types, failing the request before mail is sent.
2. **Neutered templates** (defence in depth): `magic_link` and `confirm_signup` bodies contain no token link.
3. **`/auth/confirm` accepts `type=recovery` only.**
4. Dashboard baseline: signup OFF, anonymous OFF, non-email providers OFF, single-session OFF, **Secure password change OFF**, Site URL exact, redirect allowlist exact per environment (no production wildcards).
5. Negative proofs (6.15): direct `/auth/v1/otp` and `/auth/v1/signup` requests produce no usable sign-in path; **redirect tests are outcome-based**: an unapproved `redirectTo` must never be reached; rejection or documented fallback to the Site URL are both passes, tested per flow.
Direct `/otp` mail abuse is bounded by the hook rejecting before send plus Supabase email rate limits.

**6.8.2 Sign-in:** as v2.2 (server action, captcha forwarded, limiter, audit, generic errors).

**6.8.3 Invites (single profile; native `inviteUserByEmail` removed from the standard):** custom invite token (opaque class, 6.4.6; TTL 7 days) issued and audited by an admin; acceptance: validate token → **create the Auth user banned** (`createUser` with `ban_duration` + `email_confirm: true`) → link the application identity → activate → **unban last** → sign the user in. State machine `pending → accepting → active`, terminal `cancelled`/`failed`; idempotency key per invite; single winner under concurrency; resend invalidates prior tokens; blocked once active; compensation (delete the still-banned Auth user) on linking failure with alert + periodic orphan reconciliation. At no state is a usable account exposed: the user is banned until active, and 6.3.1 denies every non-active state at the data plane too. Scanner-safety: the acceptance page is a form POST, never a GET side effect.

**6.8.4 Password reset (recovery grant, server-state):** forgot-password server action (captcha, limiter, per-address cooldown) → email link → `/auth/confirm` (GET interstitial, POST `verifyOtp type=recovery`). On success the confirm POST mints a **recovery grant**: 256-bit opaque random value set as an httpOnly, `Secure`, `SameSite=Lax`, `Path=/auth` cookie, 10-minute expiry; **its SHA-256 hash is stored in a `recovery_grants` row** (user_id, hash, expires_at, consumed_at NULL). Minting a new grant (or a new reset request) invalidates the user's outstanding grants. The reset action: 1) validates non-sensitive input (password policy) first; 2) **atomically claims the grant** (single conditional UPDATE setting consumed_at where hash matches, user matches, unexpired, unconsumed; exactly one winner under concurrency); 3) immediately performs the provider password update; 4) `signOut({scope:'others'})`; 5) audits. If the provider update fails after the claim, the grant stays consumed and the UI offers a fresh link (safe over convenient, stated). Expiry/consumption/sign-out clears the cookie. Ordinary sessions cannot mint or use grants. Cross-device: the grant lives where the link was opened.

**6.8.5 Password change (signed in):** current password verified server-side with its own captcha token (credential-change confirmation per owner decision 2), then update, then `signOut({scope:'others'})`. **Revocation failure handling (new):** one synchronous retry; on continued failure, audit the partial state, alert, and tell the user plainly that other devices may still be signed in, offering the emergency ban/unban revocation via an admin (6.3.2). The current session is never sacrificed.

**6.8.6 Account journeys:** as v2.2, with the admin email change now a defined saga: validate new address + uniqueness across Auth and app → update Auth email via Admin API → update the application record → force re-login via ban/unban cycle → notify old and new addresses → audit (actor, target, operation ID). Partial failure alerts and the saga is idempotently re-runnable; the application record is authoritative for staff communications, the Auth email for login. Email-changed notification adopted (review O-02).

**6.8.7 Sign-out:** as v2.2. Redirect params via the shared validator; password-field UX rules unchanged.

### 6.9 Audit logging and governance

As v2.2 (server-side producers; required events incl. banned/unbanned, email changed, deleted; record contract with actor/target/outcome/operation ID/app/environment; plaintext actor email per owner decision 10; HMAC pseudonyms for pre-auth events with versioned per-environment `AUDIT_HMAC_KEY`; append-only grants; restricted read), with round-3 corrections:

- **Retry queue named:** failed audit writes enqueue into the existing AMS background jobs system as an outbox payload with a unique event ID (dedupe), exponential backoff, and a dead-letter alert to the owner. If both the audit table and the jobs system are unavailable, the operation still completes and an error log is the last resort (recorded).
- **Retention split:** administrative/change events 6 years; sign-in telemetry (login success/failure, logout) 12 months; deletion by a tested scheduled job, not archival. IP/user agent live only as long as their event class.

### 6.10 Password policy and email

As v2.2 (policy values, shared `validatePassword`, HIBP contract; six templates enumerated: reset + invite active and accurate, magic link + confirm signup neutered, change email active for the admin saga notification path, reauthentication neutered with Secure-password-change OFF; production SMTP, SPF/DKIM/DMARC, no link tracking; password-changed and email-changed notifications enabled once SMTP is production-grade; provider bounce alerts to the owner).

### 6.11 Operational monitoring (minimum contract)

As v2.2 (named owner; immediate alerts for offboarding/rehire failure and sustained audit-write failure; provider alerts for SMTP and Turnstile; **quarterly** dashboard/config review, one cadence everywhere; change-triggered revalidation) plus: the tokenless-login alert (6.6) and the limiter-outage alert (6.5). Optional adopted: a read-only Management API quarterly snapshot (least-privilege token) to prepare the review evidence (review O-01).

### 6.12 Database security (RLS)

As v2.2 (app-owned scope, anon default-deny with justified narrow exceptions, least-privilege paths for anonymous writes with a documented admin-client exception contract, SECURITY DEFINER hygiene, migrations only, cross-user negative tests) plus the **restrictive active-identity policy** from 6.3.1 as a portfolio requirement for staff-facing tables.

### 6.13 Configuration (five control planes)

As v2.2, with additions: AMS plane 1 gains the Upstash URL/token and (where used) the CSP report endpoint config; plane 2 gains Secure password change OFF, the Send Email Hook, and single-session OFF (already listed); plane 5 unchanged. Secret rotation and per-environment separation as before. The recovery grant needs no key (opaque + hashed server-side).

### 6.14 Two-factor authentication

Not part of this standard. Placeholder 2FA UI is a conformance failure.

### 6.15 Testing, verification, accessibility, performance

As v2.2's three tiers and matrix, with the round-3 additions:

- inactive user's still-valid JWT against Data API, RPC, Storage, and Realtime: denied by the restrictive policy (DB) and dies at token expiry (Realtime); signed-URL TTL respected;
- identity preflight: orphan/duplicate mappings resolved before enforcement; missing identity = denied (staged, not sprung on production);
- recovery grant: replay after consumption, two concurrent submissions (single winner), provider failure after claim (grant stays consumed, clean UX), new request invalidates old grants;
- invite: banned-until-linked at every intermediate state, concurrent acceptance single-winner, compensation deletes the banned user, scanner prefetch cannot accept;
- passwordless: hook rejection, neutered-template fallback, outcome-based redirect tests per flow;
- password change with a >24 h-old session with Secure password change OFF (proves no hidden nonce dependency);
- limiter: per-bucket reset semantics, Upstash outage fail-open + alert;
- CSP: report collection works, 2-week window observed, enforcement gate met;
- rollback rehearsal: the active-identity policy and RLS survive every rollback path (11.3);
- admin email change: partial-failure re-run, forced re-login, notifications;
- post-change revocation failure: retry, alert, user notice.

Performance acceptance (measurable, round 3): login p95 < 2.5 s **measured server-side from server-action invocation to response on warm instances in production-like staging, excluding human/widget time**; protected-navigation auth overhead p95 < 300 ms on the same basis; reset submission p95 < 3 s (external calls included); auth verification deduplicated per request; double-submit prevented; JWT-rollback trigger = **failed refresh attempts / total refresh attempts > 1% over a rolling 60 minutes**, restoring the previous expiry.

Accessibility: WCAG 2.2 AA for the auth journeys; baseline matrix desktop Chrome keyboard-only + iOS Safari/VoiceOver; states incl. Turnstile blocked/expired; error summaries, focus management, live regions, 200% zoom, AA contrast.

Coverage: behaviour cases first; line + branch on named auth modules (helpers, guard, validators, limiter, verifier, grant store, audit producers): 90%; auth actions 80%; per app.

## 7. Removed from v1 (consistency-checked)

| Removed | Residual control |
|---|---|
| Magic links / passwordless / OAuth | Send Email Hook + neutered templates + recovery-only confirm + config baseline + negative proofs (exact property stated in 6.8.1) |
| Custom Redis session store | Active-identity enforcement at app + DB layers, ban, sign-out scopes, 15-min JWT |
| CSRF double-submit layer | Server Action origin checks + shared origin guard + class protections |
| `login_attempts` lockout table | Turnstile + three-bucket limiter with safe reset semantics + generic errors |
| 2FA section | Invite-only + CAPTCHA + breach-checked passwords; shared-device risk accepted (2.1) |
| CSP `'unsafe-inline'` prohibition | Documented exception, owner, quarterly review, report-only pipeline |

## 8. AMS conformance gap list (requirement-linked)

Phase 0 (immediate hotfixes, independent of the programme, pending owner go-ahead):
- B1. Protect `/api/parking/payment/retry` (guest token or Turnstile + limits; one live PayPal order per booking). [6.4.8]
- B2. Fix the Turnstile soft-bypass on the private-booking pair. [6.6B]
- B3. Turnstile on `/api/feedback`. [6.6B]

Prerequisites:
- A1. Node 22 upgrade with full build proof. [6.1]
- A2. Generated route registry, CI-enforced. [6.4]
- A3. Identity preflight: Auth-to-identity reconciliation, orphan/duplicate resolution, backfill. [6.3.1]

Auth flows and data plane:
- C1. Shared origin guard on the 33 cookie-auth handlers. [6.4]
- C2. Forgot/reset to server actions (captcha, limiter, audit). [6.5, 6.8.4]
- C3. `/auth/confirm` recovery-only; Send Email Hook; neutered templates. [6.8.1]
- C4. Recovery grant table + flow. [6.8.4]
- C5. Shared `validatePassword` everywhere; remove composition rule; raise min-8 surfaces. [6.10]
- C6. Revocation wiring: scopes on change/reset; offboarding ban + helper checks; rehire order; emergency ban/unban procedure. [6.3]
- C6a. Restrictive `is_active_staff()` RLS policy migration + Storage policies + Realtime staging proof. [6.3.1]
- C7. Invite flow: banned-until-linked state machine. [6.8.3]
- C8. Remove dead Microsoft 365 button and 2FA placeholder. [3.1, 6.14]
- C9. Admin email-change saga. [6.8.6]

Platform and hygiene:
- D1. `server-only` admin client guard. [6.1]
- D2. Typed auth result codes + HTTP mappings. [6.7]
- D3. Audit: missing events, HMAC pseudonymisation, append-only grants, split-retention jobs, jobs-system retry queue, operation IDs. [6.9]
- D4. Headers: HSTS `includeSubDomains` after subdomain check; CSP baseline via report-only pipeline incl. `/api/csp-report`; `no-store`/`no-referrer` on auth/token pages. [6.2]
- D5. Limiter on Upstash with 6.5 semantics; Upstash vars in startup validation. [6.5]
- D6. Replace string-matched permission handling. [6.7]
- D7. Dashboard/config passes across five planes, evidence recorded. [6.13, 12]

## 9. Out of scope

Code changes in this piece of work; per-app RBAC models; the timeclock kiosk PIN flow; customer flows that never authenticate; historical audit-row migration; non-auth performance work.

## 10. Disposition of round-3 findings

| Finding | Disposition |
|---|---|
| F-01 data-plane bypass | Accepted; verified browser Realtime usage; restrictive `is_active_staff()` RLS at the database + Storage policies + Realtime proof + signed-URL TTL bound; overclaim corrected (6.3.1) |
| F-02 cookie not single-use | Accepted; opaque grant with server-side hash state and atomic conditional-update claim; no signing key needed (6.8.4) |
| F-03 native invite contract | Accepted; native `inviteUserByEmail` removed; single custom profile with banned-at-creation (SDK support verified) (6.8.3) |
| F-04 provider-boundary claim | Accepted; claim restated exactly; Send Email Hook promoted to primary control, templates to defence in depth (6.8.1) |
| F-05 redirect rejection assumption | Accepted; outcome-based tests (never reach an unapproved origin; fallback to Site URL is a pass) (6.8.1) |
| F-06 identity backfill | Accepted; preflight + backfill gap A3 before fail-closed enforcement (6.3.1) |
| F-07 proof ordering | Accepted; feasibility probes split from release-candidate acceptance (11.2) |
| F-08 delayed hotfixes | Accepted; B1-B3 moved to phase 0, recommended for immediate release (11.2, owner action) |
| F-09 unsafe rollback | Accepted; forward-fix policy, expand/contract, never-remove-controls rule, per-task notes (11.3) |
| F-10 token contradiction/logging | Accepted; two token classes defined; logging claim made testable; infra-log exposure recorded as residual risk (6.4.6, 2.1) |
| F-11 grant failure/concurrency | Accepted; validate-then-claim-then-update sequence, consumed-on-provider-failure, sibling invalidation, concurrency tests (6.8.4) |
| F-12 email change | Accepted; defined saga with forced re-login and notifications (6.8.6) |
| F-13 step-up contradiction | Accepted; owner decision reworded (credential-change confirmation is not step-up); Secure password change OFF recorded (3.2, 6.13) |
| F-14 limiter reset/Upstash | Accepted; per-bucket reset semantics, IP bucket never resets on success, Upstash in startup validation, fail-open + alert (6.5) |
| F-15 CSP completeness | Accepted; inheritance semantics stated, expected app exceptions declared, report pipeline + gate defined (6.2) |
| F-16 audit queue | Accepted; existing jobs system named, outbox contract, dead-letter alerts (6.9) |
| F-17 retention assumption | Accepted; split retention by event class (6 y admin / 12 m telemetry), deletion not archival, owner-recorded (6.9) |
| F-18 bypass monitoring | Accepted; tokenless-success alert + daily repetition + verified re-enablement (6.6) |
| F-19 revocation failure | Accepted; retry, alert, honest user notice, ban/unban emergency path (6.8.5) |
| F-20 missing tests | Accepted; all listed cases added to 6.15 |
| F-21 measurability | Accepted; measurement bases and rollback denominator defined (6.15) |
| F-22 ownership/evidence | Accepted; accountable owner named (business owner) with per-task delivery table incl. implementer, reviewer, estimate, window, rollback owner, produced at 11.2 step 1; evidence stored in-repo, redacted, no secrets in captures (11, 12) |
| F-23 CSP cadence | Accepted; quarterly everywhere (6.2, 6.11, 12) |
| O-01 config snapshot | Adopted (6.11) |
| O-02 email-change notification | Adopted (6.8.6, 6.10) |
| O-03 sequence diagrams | Deferred to implementation docs (optional) |
| O-04 Sb-Forwarded-For | Adopted as a staging-only evaluation (6.5) |

## 11. Adoption, rollout and rollback

### 11.1 Adoption states

Per app: `v1-conformant` → `v2.3-migrating` → `v2.3-conformant`; else `non-conformant`. v1 governs until migration starts. Approver: the business owner. Accountable owner for all control planes: the business owner; implementation is executed by engineering sessions under the owner's direction with the owner as reviewer; each task in the delivery table names its implementer, reviewer, estimate, dependencies, acceptance evidence, deployment window and rollback owner.

### 11.2 AMS rollout phases

- **Phase 0 (now, independent):** hotfixes B1-B3 as small v1-compatible changes. Recommended for immediate release; needs only the owner's go-ahead.
- **Phase 1, plan:** requirement-to-evidence matrix + delivery table + route registry (A2) + identity preflight report (A3).
- **Phase 2, feasibility probes (staging, throwaway):** ban semantics incl. `createUser` banned; sign-out scopes; Send Email Hook behaviour; redirect fallback behaviour per flow; Realtime behaviour at token expiry; Secure-password-change-OFF flow on old sessions.
- **Phase 3, implementation:** A1 (Node 22), then C1-C9, C6a, D1-D6 with unit/local tests.
- **Phase 4, release-candidate acceptance (staging, from the RC build):** the full 6.15 staging matrix incl. recovery-grant concurrency, invite state machine, CAPTCHA break-glass end to end, active-identity data-plane denial.
- **Phase 5, production:** headers via report-only window then enforce (D4); JWT expiry change + wait one prior lifetime; CAPTCHA enablement sequence (keys → CSP → code → staging toggle → production toggle → smoke); dashboard passes recorded (D7); re-audit; state `v2.3-conformant`.

### 11.3 Rollback (security-preserving)

- **Never removed by any rollback:** the restrictive active-identity policy, RLS, ban state, and the passwordless controls. Defects in these are **forward-fixed**; a policy that wrongly blocks staff is corrected by a follow-up migration, not by dropping the policy.
- **Schema:** expand/contract only; every migration ships with a compatibility window in which the previous code version still runs; down-migrations exist for structural additions only, never for security policies.
- **Dashboard toggles** (CAPTCHA, JWT expiry, providers, hook): revert by toggle, owner-held, minutes; re-enabling security toggles is verified, and the tokenless-login alert (6.6) catches a forgotten CAPTCHA bypass.
- **Code:** revert the deploying commit only where the delivery-table entry marks it safe (no coupled schema/config); otherwise forward-fix.
- **Node:** previous version remains deployable until Phase 5 completes; the downgrade path is tested once in staging.
- Every rollback entry states what happens to sessions, outstanding recovery grants, queued audit events, and partially migrated identities.

## 12. Conformance evidence template

As v2.2 (per-plane rows: setting/proof, expected, actual, environment, source, verifier, date, next recheck **quarterly**; exceptions with rule, rationale, owner, review trigger; template ships in the auth-standardiser skill; completed copy lives in the app repo), plus: evidence captures are redacted (no secrets, token values, SMTP credentials, or unnecessary personal data) and stored in the repository's restricted docs area.
