# Developer Review Report — Authentication Standard v2 Specification

**Reviewed document:** `tasks/auth-standard-v2-spec-2026-07-23.md`  
**Evidence snapshot named by the specification:** `590711ba718567f7c65b5c800dd7f8b897342892`  
**Review date:** 2026-07-23  
**Original document changed:** No  
**Review scope:** technical correctness, security, functional completeness, data, integrations, accessibility, performance, operations, testing, migration, deployment, and delivery

## 1. Overall assessment

**Readiness: not ready for approval or implementation.**

The direction is sensible: remove controls that were never built, use Supabase's supported session model, make public abuse protection explicit, and keep the standard small enough to audit. The draft also records product decisions clearly and correctly keeps UI hiding out of the security model.

However, five approval blockers make the current draft unsafe to adopt:

1. The central revocation call, `supabase.auth.admin.signOut(userId)`, is not a supported user-ID revocation API. The installed SDK and Supabase documentation require a valid user access JWT, not a user ID.
2. Revoking sessions does not stop a former employee signing in again. The standard has no mandatory account suspension, deletion, or active-staff check.
3. The claim that all AMS mutations are Server Actions is false at the stated evidence commit. AMS has 183 Route Handlers, including 77 with POST, PUT, PATCH, or DELETE exports, and many are called by the browser.
4. The authorisation rule requires roles in `app_metadata`, while AMS actually uses database-backed `roles`, `user_roles`, and `permissions`. This contradicts both the stated current reality and the promise that authorisation remains app-specific.
5. Invite-only status and the ban on other auth methods are enforced only in app code/UI, not as required Supabase project settings, so the public Auth API can remain outside the intended policy.

The draft should be revised and revalidated before it replaces v1. Removing Redis, the bespoke CSRF token layer, and the custom lockout table can still be a good outcome, but the replacement controls must be accurate and implementable.

### Strengths worth keeping

- Locked product decisions are separated from validator questions.
- The threat model identifies real portfolio risks rather than theoretical ones.
- `getSession()` is correctly prohibited as the sole basis for a server-side auth decision.
- Server-side auth and permission checks are mandatory on protected operations.
- Generic wrong-email/wrong-password behaviour is required.
- Turnstile verification is placed server-side.
- RLS, configuration validation, audit coverage, and versioned migrations remain required.
- The draft openly records the one-hour access-token residual window and the Turnstile availability trade-off.
- Rollout is separated from the standard decision.

### Key counts from this review

| Classification | Count |
|---|---:|
| Confirmed issues | 36 |
| Optional improvements | 6 |
| P0 approval blockers | 5 |
| P1 issues | 24 |
| P2 issues | 7 |

## 2. Classification

- **Confirmed issue:** a factual error, contradiction, missing requirement, unsafe assumption, or delivery gap that must be resolved for the affected scope.
- **Optional improvement:** useful hardening or simplification that is not required to make v2 viable.
- **P0:** do not approve v2 until resolved.
- **P1:** resolve before implementation starts.
- **P2:** resolve before production rollout.
- **P3:** optional backlog item.

### Evidence checked

| Evidence | Result |
|---|---|
| `node_modules/@supabase/auth-js/src/GoTrueAdminApi.ts:112-136` | `admin.signOut` takes a JWT and scope, not a user ID |
| Git tree at `590711ba` | 183 Route Handlers; 77 export POST, PUT, PATCH, or DELETE |
| `src/middleware.ts:10-33` at `590711ba` | Entire `/api` namespace is allowlisted by middleware |
| Browser callers under `src/app/(authenticated)` | Mutating Route Handlers are used for FOH, BOH, settings, and menu flows |
| `src/services/permission.ts:142-196` | AMS permissions are database-backed and cached, not stored only in `app_metadata` |
| `src/lib/supabase/admin.ts:1-20` | Admin client lacks the specified `server-only` import/browser guard |
| `src/services/auth.ts:7-68` and `src/app/actions/profile.ts:319-382` | Login/current-password checks call `signInWithPassword`; current-password call has no CAPTCHA token |
| `src/services/audit.ts:5-68` | Audit service stores plaintext `user_email` and silently absorbs write failures |
| `src/app/actions/employeeInvite.ts:508-561` | Invite acceptance uses compensation and records a possible orphan cleanup failure |
| `src/app/auth/confirm/route.ts:36-103` | AMS already uses a GET-to-POST interstitial before OTP verification |
| `package.json` and lockfile | Next 15.5; installed Supabase JS/Auth 2.101.1; legacy key names in use |
| Supabase, Next.js, Cloudflare, NIST, OWASP, and HIBP primary documentation | Used for volatile API and standards checks; links are in §11 |

## 3. Approval blockers

### F-01 — The specified user-ID revocation API does not exist

**Status:** Confirmed issue  
**Priority:** P0  
**Type:** Technical correctness / security  
**Relevant section:** §5.3, §6, §7 item 6, §9 question 2

**Description:** The draft requires `supabase.auth.admin.signOut(userId)` and says it revokes the user's refresh tokens. In the installed `@supabase/auth-js` 2.101.1 SDK, `admin.signOut(jwt, scope)` requires a valid logged-in access JWT. A UUID is accepted by TypeScript because both values are strings, but it is sent as a bearer JWT and will fail. The public Supabase reference also describes JWT-based sign-out, not user-ID sign-out.

**Rationale:** This call is the residual control used to justify removing the custom session store. It is also the required implementation for password changes, resets, offboarding, and demotion.

**Impact:** The standard could be approved on the false belief that remote revocation by user ID is available. Offboarding and demotion may leave refresh tokens usable, and the required revocation tests could mock a behaviour that production cannot perform.

**Recommended action:** Replace this design with supported, separately defined flows:

- Current user: use authenticated `signOut` scopes deliberately (`local`, `others`, or `global`).
- Password reset/change: define whether the current recovery session is retained and use a supported scope.
- Leaver: disable, ban, or delete the Auth user and enforce application account status; do not rely on sign-out alone.
- Demotion: change the authoritative permission data immediately and define how stale access-token claims are avoided.
- If arbitrary session revocation remains mandatory, prove the exact supported Supabase mechanism in a staging project before approval.

**Suggested wording:** “Do not call `auth.admin.signOut` with a user ID. Session termination must use a Supabase-supported authenticated sign-out scope or an explicitly validated administrative account-disable mechanism. Access JWTs remain usable until expiry unless sensitive operations perform a fresh account-status check.”

**Open questions:**

- Must an administrator be able to terminate all sessions without possessing a user's JWT?
- Is banning, deleting, or retaining a disabled Auth user the required leaver policy?
- Is a one-hour residual window acceptable for payroll exports, role management, and payment operations?

### F-02 — Offboarding does not prevent a former employee signing in again

**Status:** Confirmed issue  
**Priority:** P0  
**Type:** Functional security / account lifecycle  
**Relevant section:** §2, §5.3, §5.7, §7 item 6, §8

**Description:** The threat model names leaver access as a primary risk, but the normative rule only revokes sessions. A user whose refresh tokens are revoked can sign in again with the same email and password unless the Auth account is disabled, banned, deleted, or every login/request checks an authoritative active-employment state. AMS currently deletes roles and later attempts to delete the Auth user during separation, which is materially different from the draft.

**Rationale:** Session revocation ends existing sessions; it is not account suspension.

**Impact:** The standard does not satisfy one of its own primary threat cases. A former employee could regain access, trigger password reset, or obtain a new session.

**Recommended action:** Add a mandatory account lifecycle:

1. Mark the application identity inactive.
2. Block new sign-in and password recovery for inactive staff.
3. Remove permissions.
4. Disable, ban, or delete the Supabase Auth user according to the retention decision.
5. End existing sessions as far as the platform supports.
6. Audit every step and fail closed if the access-removal steps do not complete.
7. Define a controlled rehire/reactivation path.

**Suggested wording:** “Offboarding MUST prevent both continued use of existing sessions and all future sign-ins. Session revocation alone is insufficient.”

**Open questions:**

- Should leavers' Auth users be deleted, banned indefinitely, or retained in a disabled state?
- Does the business need a reversible rehire flow?
- What is the offboarding SLA and who owns failed-step alerts?

### F-03 — The Server Action current-state claim is false

**Status:** Confirmed issue  
**Priority:** P0  
**Type:** Accuracy / delivery scope / security  
**Relevant section:** §4.1, §5.4, §6, §7, §10

**Description:** At the specification's own evidence commit, AMS has 183 `route.ts` files and 77 Route Handlers exporting a mutating method. Browser code calls many of them, including FOH bookings, table movement, menu management, booking settings, feedback, and recruitment actions. Therefore “All mutations are Next.js Server Actions” is false. The known conformance gaps omit this large migration or origin-validation programme.

**Rationale:** The removal of the v1 CSRF layer is justified mainly by a current-state claim that does not hold.

**Impact:** The stated “small, closable” gap is materially understated. Implementation could expose existing cookie-authenticated Route Handlers without the replacement control required by v2, or turn a much larger refactor into an unplanned changeset.

**Recommended action:** Replace the claim with an evidence-based inventory. For each mutating Route Handler, record:

- caller: browser, webhook, cron, public API, or tokenised guest flow;
- authentication mechanism;
- CSRF/origin mechanism;
- whether it will remain a Route Handler or move to a Server Action;
- owner and test.

Prefer one shared same-origin wrapper for existing browser Route Handlers rather than forcing a low-value rewrite of all 77 handlers.

**Open questions:**

- Is v2 intended to permit existing browser Route Handlers with a shared origin check?
- Is migration to Server Actions a security requirement or only a preferred architecture?
- Which of the 77 handlers are no longer used?

### F-04 — The authorisation rule contradicts AMS and the stated scope

**Status:** Confirmed issue  
**Priority:** P0  
**Type:** Architecture / contradiction / scope  
**Relevant section:** §1, §5.7, §5.15, §7 item 6

**Description:** The draft says authorisation is app-specific, then mandates that roles be stored only in `app_metadata` and compared with `>=`. AMS uses database-backed `roles`, `user_roles`, `permissions`, and RPC permission checks. Its permissions are not a single ordered hierarchy. The implementation also caches some permission results for 60 seconds and invalidates tags on change.

**Rationale:** `app_metadata` is one valid pattern, not the only safe pattern. It is also embedded in JWTs and may be stale until refresh. A numeric or ordered `>=` comparison is invalid for named roles and capability-based permissions.

**Impact:** AMS would become non-conformant for using a reasonable existing authorisation design. A developer might copy roles into JWT metadata, creating two authorities and new stale-claim problems.

**Recommended action:** Keep only invariant safety rules in the auth standard:

- authorisation data must be server-controlled;
- the authoritative source must be named per app;
- every privileged operation must re-check it server-side;
- demotion must take effect within a stated maximum;
- user-editable metadata must never be trusted;
- hierarchical comparison is allowed only where the app explicitly defines a total ordering.

Remove “stored in `app_metadata` only” and unconditional `>=`.

**Open questions:**

- Is AMS's database role model the intended reference for permissioned apps?
- What is the acceptable demotion propagation window: immediate, 60 seconds, or one JWT lifetime?
- Do any portfolio apps actually use `app_metadata` roles?

### F-05 — Invite-only status is not enforced at the Supabase boundary

**Status:** Confirmed issue  
**Priority:** P0  
**Type:** Security configuration / account creation  
**Relevant section:** §2, §3 decision 1, §5.8, §7 item 5

**Description:** Returning 404 for `/register` and hard-disabling an app wrapper does not stop direct calls to the public Supabase Auth signup endpoint. Supabase provides project settings for “Allow new users to sign up” and anonymous sign-ins, but the draft does not require them to be disabled. It also does not require unused phone, OTP, social, anonymous, or third-party Auth methods to be disabled at project level.

**Rationale:** The browser has the public project URL and publishable/anon key. UI absence is not a security control.

**Impact:** A portfolio app can pass the code audit while still allowing direct account creation or an owner-prohibited auth method through Supabase.

**Recommended action:** Add a versioned or independently verified Auth configuration baseline:

- new user signup disabled;
- anonymous sign-ins disabled;
- unused phone, OTP, OAuth, SSO, and third-party auth disabled;
- email/password sign-in enabled for existing users;
- invite/admin user creation proven to work while signup is disabled;
- settings checked in every environment.

**Suggested wording:** “Invite-only MUST be enforced by Supabase Auth configuration, not only by application routes or UI.”

**Open questions:**

- Can every portfolio invite mechanism create users while project signup is disabled?
- Are any public or anonymous Supabase users used for non-staff flows?
- How will configuration drift be detected?

## 4. Other confirmed issues

### F-06 — Password change and reset session handling is not implementable as written

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Functional flow / integration  
**Relevant section:** §5.3, §5.6, §5.8, §5.10

**Description:** “Revoke all sessions, then re-authenticate the current user” does not define how to retain the reset recovery session, how to re-authenticate a reset user, or which sign-out scope is intended. Enabling Supabase CAPTCHA also affects `signInWithPassword` calls used internally to verify a current password. AMS currently verifies a password by calling `signInWithPassword` without a CAPTCHA token. Supabase now supports a `current_password` field, but the draft neither requires a compatible SDK version nor chooses that flow.

**Rationale:** Password change, password reset, sign-out scope, CAPTCHA, and session retention interact. They cannot be specified independently.

**Impact:** Enabling CAPTCHA can break profile password changes. A global sign-out may unexpectedly log out every device, while a failed re-login can leave the user locked out after successfully changing the password.

**Recommended action:** Define separate sequence diagrams and failure behaviour for:

- profile password change with current-password verification;
- recovery-link password reset;
- administrator password reset, if allowed;
- “sign out this device,” “sign out other devices,” and “sign out all devices.”

Use explicit Supabase sign-out scopes and prove the chosen flows against the pinned SDK and a staging project.

**Open questions:**

- Must profile password change require the current password or a fresh reauthentication nonce?
- Should reset keep the recovery session, sign out other sessions, or sign out everything?
- What happens if session termination succeeds but reauthentication fails?

### F-07 — The CSRF rules contradict each other

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Security requirements / ambiguity  
**Relevant section:** §5.4

**Description:** Rule 1 says all browser-initiated mutations MUST be Server Actions. Rule 3 then says a browser-called mutating Route Handler can conform if it validates Origin. Both cannot be the normative rule. The draft also relies on SameSite cookies without requiring or testing their attributes, and it does not define behaviour for a missing or `null` Origin, reverse proxies, forwarded hosts, multiple production hosts, or preview environments.

**Rationale:** Next.js provides Origin/Host protection for Server Actions, not arbitrary Route Handlers. A safe Route Handler policy needs one canonical implementation.

**Impact:** Different developers can reach opposite conformance decisions. Ad hoc checks are likely to trust attacker-controlled host headers or reject legitimate proxied traffic.

**Recommended action:** Simplify to:

- Server Actions are preferred for browser mutations and use Next.js's built-in protection.
- Browser Route Handlers are allowed only through one shared same-origin helper.
- The helper compares Origin with a configured allowlist of canonical origins, defines missing-Origin behaviour, and is tested behind the production proxy.
- Webhooks, crons, public APIs, and signed guest-token flows use named non-cookie protections.

**Open questions:**

- Which production and preview origins are valid?
- Must non-browser clients call any cookie-authenticated mutation?
- Are requests with no Origin rejected or handled using Fetch Metadata headers?

### F-08 — AMS's broad `/api` middleware exemption is omitted from the gap list

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Route protection / accuracy  
**Relevant section:** §4.2, §5.2, §5.7, §7

**Description:** AMS allowlists the segment-bounded prefix `/api`, so middleware does not gate any API Route Handler. Some handlers correctly authenticate themselves, but middleware protection cannot be claimed for the namespace. The draft does not explicitly prohibit broad namespace allowlisting or require a complete per-handler check.

**Rationale:** “Public in middleware” can mean “handler owns authentication,” but it must not be confused with a genuinely public endpoint.

**Impact:** A handler missing its local check is publicly reachable. The proposed audit may report middleware conformance while missing the real boundary.

**Recommended action:** Require separate labels for:

- truly public;
- middleware-protected;
- handler-authenticated;
- signed-token;
- webhook;
- cron;
- API-key.

Either remove the broad `/api` exemption or make the handler-auth inventory and automated wrapper mandatory.

**Open questions:** Is `/api` intentionally excluded because of response semantics, or is it legacy?

### F-09 — Recovery-session authority is not defined

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Functional security / user journey  
**Relevant section:** §5.8

**Description:** The draft says a recovery token is exchanged and then `updateUser` sets the password, but it does not require the password-reset page to prove it was reached through a valid recovery flow. An ordinary signed-in session must not be allowed to use the reset surface to bypass current-password or reauthentication rules. It also does not cover email-link scanners, multiple reset requests, reused links, expired links, opening on another device, or direct navigation to the reset page.

**Rationale:** Recovery is a privileged account-control flow. AMS already uses a GET interstitial followed by POST before `verifyOtp`, which helps avoid link scanners consuming a token, but this useful behaviour is not in the standard.

**Impact:** A stolen unlocked session could potentially set a new password without the current password, or reset links could fail when scanned by email security tooling.

**Recommended action:** Define a recovery-only state marker, one-time transition, direct-navigation rejection, GET-scanner-safe confirmation step, and exact expired/reused-link UX. Test ordinary-session and recovery-session paths separately.

**Open questions:**

- How is recovery state distinguished from a normal authenticated session?
- Does the newest reset request invalidate older links?
- Should a successful reset notify the user separately?

### F-10 — “Atomic” invite creation and acceptance is overstated

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Data integrity / integration  
**Relevant section:** §5.8, §5.15

**Description:** Deleting a Supabase user after a second step fails is compensation, not atomicity. The deletion can also fail, as AMS's own code records. `inviteUserByEmail` can send email before later metadata work completes, creating a race. A custom Auth user creation and application-database update cannot normally share one database transaction across the Auth API boundary.

**Rationale:** The required guarantee is operational consistency, not true cross-service atomicity.

**Impact:** The standard sets an impossible acceptance criterion and may hide orphaned Auth users, sent-but-invalid emails, or partly linked employee records.

**Recommended action:** Replace “atomic” with a saga contract:

- idempotency key;
- explicit pending state;
- ordered steps;
- compensating deletion/invalidation;
- retry behaviour;
- orphan detection and reconciliation;
- alert on compensation failure;
- no access until the final link state is complete.

**Suggested wording:** “Invite acceptance MUST be idempotent and leave no usable half-linked account. Cross-service failures require compensation and reconciliation; true atomicity is not assumed.”

**Open questions:** Which system owns the identity while an invite is pending? How are orphaned users found and repaired?

### F-11 — Invite lifecycle requirements are incomplete

**Status:** Confirmed issue  
**Priority:** P2  
**Type:** Functional detail / edge cases  
**Relevant section:** §5.8, §5.15

**Description:** Tests must cover “resend rules,” but those rules are not defined. Custom invite expiry has no standard duration. There is no required behaviour for concurrent acceptance, resend invalidation, cancelled invites, changed email, existing confirmed users, former employees, duplicate employees, expired links, or invite enumeration.

**Rationale:** These cases decide whether an invite is single-use and whether an account is linked to the intended employee.

**Impact:** Implementations can pass nominal tests while accepting an old or wrong invite.

**Recommended action:** Add one lifecycle table with state, allowed transition, expiry, actor, audit event, user message, and idempotency result. Set one default custom-token TTL or require each app to document it.

**Open questions:** Must resend invalidate all older tokens immediately? Can an invited email be changed after issue?

### F-12 — The password policy is mislabelled as NIST/OWASP aligned

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Standards accuracy / security / usability  
**Relevant section:** §3 decision 4, §5.10, §9 question 5

**Description:** NIST SP 800-63B-4 requires at least 15 characters when a password is the only factor. OWASP repeats that passwords shorter than 15 are weak without MFA. This draft mandates 12 and explicitly has no MFA. “No composition rules” is aligned, but the overall policy is not. The 72-byte maximum also conflicts with guidance to permit at least 64 characters for Unicode passphrases: 64 multibyte characters can exceed 72 UTF-8 bytes. “Characters” is not defined as UTF-16 units, Unicode code points, or grapheme clusters.

**Rationale:** The owner may choose a pragmatic deviation, but the standard must not claim compliance it does not have.

**Impact:** Assurance statements become misleading, and valid long Unicode passphrases may be rejected unexpectedly.

**Recommended action:** Either change the minimum to 15 or record 12 as an explicit owner-approved deviation from current NIST single-factor guidance. Define:

- how characters are counted;
- UTF-8 byte calculation;
- Unicode normalization policy;
- accepted character set, spaces, paste, and password managers;
- no silent truncation;
- clear UI errors for byte-limit failures.

**Open questions:** Is standards alignment required, or is 12 a documented risk acceptance? Does Supabase enforce the same maximum and normalization?

### F-13 — The HIBP fallback has no availability or privacy contract

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** External integration / security  
**Relevant section:** §5.10, §5.15

**Description:** The draft does not say whether password setting fails open or closed when HIBP times out, rate-limits, or returns malformed data. It omits request timeouts, retry limits, response size limits, `Add-Padding`, cache policy, logging redaction, and monitoring. It also does not define how every password-setting surface is forced through the shared function when admin tools or Supabase-hosted flows exist.

**Rationale:** A mandatory synchronous third-party check becomes both an availability dependency and a sensitive-data handling path.

**Impact:** Password changes can hang or fail during an outage, or a developer can accidentally log hashes or full API responses.

**Recommended action:** Choose and document one portfolio policy:

- Supabase built-in protection where supported, with plan evidence; or
- HIBP Range API with a short timeout, padded response, no password/hash logging, bounded parsing, mocked unit tests, and a staging contract test.

Define fail-open/fail-closed behaviour and an audit event for degraded checks.

**Open questions:** Which Supabase projects are on plans that include leaked-password protection? Is account creation blocked during an HIBP outage?

### F-14 — The brute-force control is not quantitatively specified

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Security / monitoring  
**Relevant section:** §5.5, §9 question 3

**Description:** “Check the dashboard once” does not define an acceptable sign-in rate, burst, forwarded client-IP behaviour, or alert threshold. Supabase's documented sign-in limit is per IP and allows bursts. Turnstile raises attacker cost but does not stop distributed password spraying or human solver services. There is no account-correlated detection because unknown and known accounts intentionally share a response.

**Rationale:** Credential stuffing is the first threat in the model. Controls need measurable configuration and detection, not only presence.

**Impact:** A project can be conformant with unsafe defaults or with every server-side request appearing to come from one proxy IP.

**Recommended action:** Record exact configured values through the Management API, validate actual client IP attribution, and define alerts for failures by IP, email pseudonym, user, and project. If the owner rejects lockout, document the residual distributed-attack risk and consider short exponential delay rather than a hard lock.

**Open questions:** Are login calls made directly from browsers or through the app server? Which IP does Supabase actually rate-limit in each app?

### F-15 — “Every unauthenticated public form” is not a deliverable scope

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Functional coverage / delivery  
**Relevant section:** §3 decision 5, §5.6, §7 item 3, §8

**Description:** The draft gives examples but no authoritative inventory. AMS has anonymous forms, tokenised guest actions, payment actions, recruitment cancellation/rescheduling, feedback, waitlists, external APIs, and GET links that cause or lead to changes. It is unclear whether a signed guest link is exempt, whether PayPal create/capture calls need CAPTCHA, and whether server-to-server public APIs are “forms.”

**Rationale:** An example list cannot prove complete protection or avoid applying CAPTCHA to the wrong flows.

**Impact:** High-cost SMS/email paths may be missed, while legitimate payment or signed-link journeys may gain unnecessary friction.

**Recommended action:** Create a route/action registry with:

- authentication type;
- human/browser or server caller;
- data write;
- email/SMS/payment side effect;
- Turnstile required or exception;
- rate limit;
- idempotency control;
- abuse cost;
- owner.

Require documented exceptions based on equivalent signed-token or server authentication.

**Open questions:** Are tokenised guest-management links exempt? Are payment-provider callbacks and create-order calls in scope?

### F-16 — Turnstile verification requirements are incomplete

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Integration security / error handling  
**Relevant section:** §5.6, §5.13, §5.15

**Description:** The draft says public forms “should” validate `action`, making a key binding optional. It omits hostname validation, token expiry and single-use handling, maximum token size, request timeout, retry/idempotency behaviour, remote IP policy, widget reset after a failed or duplicate token, separate environment keys, hostname restrictions, key rotation, and rate limiting of Siteverify calls. It also omits the CSP additions required for `challenges.cloudflare.com`.

**Rationale:** Cloudflare recommends validating action and hostname where used; tokens expire after five minutes and are single-use.

**Impact:** Tokens can be replayed across forms or environments, users can become stuck after expiry, and the production widget can be blocked by CSP.

**Recommended action:** Define a shared Turnstile verifier and client wrapper. Make expected action and allowed hostname mandatory for application-verified forms. Add bounded timeouts, safe errors, token reset, environment-specific keys, CSP changes, and Cloudflare test keys for automated UI tests.

**Open questions:** One widget per app, per environment, or per risk surface? Will remote IP be sent to Cloudflare?

### F-17 — The CAPTCHA outage runbook is not a safe break-glass process

**Status:** Confirmed issue  
**Priority:** P2  
**Type:** Operations / security exception  
**Relevant section:** §5.6, §9 question 4

**Description:** “If Turnstile is down, disable CAPTCHA in the dashboard” has no authority check, evidence threshold, notification, time limit, compensating rate limit, audit record, or restore step. A local network/content-blocker problem could be mistaken for a provider outage.

**Rationale:** The runbook temporarily removes a control protecting the highest-ranked threat.

**Impact:** CAPTCHA may be disabled unnecessarily or left disabled after recovery.

**Recommended action:** Add a break-glass runbook with two-person or named-owner authority, provider-status verification, start/end timestamps, temporary tighter rate limiting, staff notification, monitoring, restore verification, and post-incident review.

**Open questions:** Who has dashboard access outside working hours? What maximum disable period is acceptable?

### F-18 — The no-timeout decision has no control for shared devices or sensitive actions

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Accepted risk / functional security  
**Relevant section:** §2, §3 decision 2, §5.3, §9 question 7

**Description:** Unlocked shared devices are a named primary threat, yet sessions never expire and the draft has no step-up check for payroll, role changes, personal-data export, password change, or payment operations. Server revocation does not detect that the wrong person is using a still-valid session.

**Rationale:** The chosen session lifetime directly increases the impact of walk-away and stolen-device access.

**Impact:** A staff member can inherit another person's long-lived privileged session with no fresh proof of identity.

**Recommended action:** Keep the owner decision if required, but add current-password or recent-authentication checks for a small list of high-impact actions, a visible sign-out control, shared-device guidance, and a tested remote access-removal procedure. Record any rejection of step-up as an explicit risk acceptance.

**Open questions:** Which actions require fresh authentication? Are pub devices managed, shared OS accounts, or personal devices?

### F-19 — `getUser()` on every request is neither current guidance nor operationally specified

**Status:** Confirmed issue  
**Priority:** P2  
**Type:** Performance / availability / dependency  
**Relevant section:** §5.2

**Description:** Supabase's current Next.js guidance prefers `getClaims()` for page and data protection when asymmetric signing keys are available; it can verify locally with cached JWKS. `getUser()` always calls the Auth server. The draft mandates it on every request, including public traffic, without a latency budget, outage behaviour, timeout, or distinction between verifying identity and fetching fresh user metadata.

**Rationale:** AMS has public traffic and 183 Route Handlers. Putting Supabase Auth on every request's hot path adds latency and an availability dependency.

**Impact:** Auth slowness can affect public forms and protected navigation. A network error may be treated as “not logged in,” causing confusing redirects rather than a service error.

**Recommended action:** Define the required property, not only the method:

- use verified claims for identity where supported;
- use `getUser()` when a fresh Auth user record is actually needed;
- perform a fresh application account/permission check for sensitive decisions;
- define Auth outage and timeout behaviour;
- pin the supported Supabase key/signing configuration.

**Open questions:** Do all projects use asymmetric signing keys? Is fresh Auth metadata used for any permission decision?

### F-20 — The three-client rule conflicts with middleware and misses a current admin-client gap

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Architecture / conformance accuracy  
**Relevant section:** §5.1, §4.2, §7

**Description:** The server client described for Components, Actions, Route Handlers, and Middleware cannot be used unchanged in Next.js middleware because middleware needs request/response cookie adapters. AMS creates `createServerClient` directly in middleware, which the draft's “no ad-hoc clients” rule appears to prohibit. AMS's admin client also does not currently import `server-only` or explicitly throw in a browser context, but this is absent from the known gaps.

**Rationale:** The standard must distinguish a fourth credential class from a framework-specific adapter for the same credential class.

**Impact:** A conforming Next.js implementation may be reported as non-conforming, while a real current gap is missed.

**Recommended action:** Permit one shared middleware/proxy session-update adapter using the public key. Add the AMS admin-client server-only change to the conformance list. Define whether `createBrowserClient`'s built-in singleton behaviour is sufficient.

**Open questions:** Should the middleware adapter live inline or in `src/lib/supabase/middleware.ts`?

### F-21 — The key names and dependency baseline will become obsolete during v2's life

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Dependency / migration / security  
**Relevant section:** §5.1, §5.13, §10

**Description:** The standard hard-codes legacy `anon` and `service-role` keys. Supabase says these legacy keys are being deprecated by the end of 2026 in favour of publishable and secret keys. Secret keys add browser-use rejection and independent rotation. The draft also has no minimum compatible Next.js, `@supabase/ssr`, `supabase-js`, or Node versions even though it depends on specific Server Action, CAPTCHA, cookie, sign-out-scope, and password APIs.

**Rationale:** This is a new portfolio standard dated July 2026, so it should not mandate keys scheduled for deprecation within months.

**Impact:** Every app may need another auth-standard rewrite and key migration shortly after v2 rollout.

**Recommended action:** Write credential roles generically (“publishable/public key” and “secret/admin key”), prefer new Supabase keys for new work, and create a legacy-key migration deadline. Add a tested version-support matrix.

**Open questions:** Which projects already support new keys and asymmetric signing? Are any Edge Functions or `pg_net` calls dependent on legacy JWT keys?

### F-22 — JavaScript-readable session cookies and weak CSP are not acknowledged together

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** XSS / session security  
**Relevant section:** §2, §5.1, §5.2

**Description:** The installed `@supabase/ssr` default session cookie is `SameSite=Lax` and not HttpOnly so the browser client can refresh the session. Supabase documentation explains that HttpOnly is not feasible for a rich client using the browser SDK. The draft prohibits localStorage but does not state that session material is JavaScript-readable. At the same time it accepts `'unsafe-inline'` in `script-src` indefinitely.

**Rationale:** XSS can become session theft. This matters more when malware is out of scope and sessions have no time limit.

**Impact:** The threat model and CSP exception understate the consequence of an injection flaw.

**Recommended action:** Explicitly document cookie properties and the residual XSS risk. Require secure cookies in production, narrow cookie scope where supported, dependency patching, no unsafe HTML without review, and a tracked CSP improvement plan or formal exception review.

**Open questions:** Are browser Supabase data calls necessary in every app, or can some apps use an HttpOnly server-only model?

### F-23 — Pre-auth audit logging has no trusted implementation path

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Observability / security / error handling  
**Relevant section:** §5.5, §5.8, §5.9

**Description:** Login and forgot-password may call Supabase directly from the browser, but failed-login and reset-request audit events must be trusted server-side. A public “log this failure” endpoint would be forgeable and abusable. The draft does not choose between a Server Action wrapper, Supabase Auth hooks/log export, or another trusted source. It also does not say whether audit-write failure blocks security-sensitive actions.

**Rationale:** A required event list is not sufficient without a trustworthy producer and failure policy.

**Impact:** Logs can be missing, spoofed, or used as an amplification surface. Developers may record raw Supabase error messages containing unnecessary detail.

**Recommended action:** Define the producer for each event, required fields, correlation ID, normalized outcome, actor/subject distinction, and fail-open/fail-closed rule. Login/reset should flow through a trusted application boundary if application audit rows are mandatory.

**Open questions:** Are Supabase Auth audit logs available on every plan? Which events are mandatory enough to block the user flow if logging fails?

### F-24 — The email-hash rule conflicts with the existing audit product and lacks a migration

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Data model / privacy / migration  
**Relevant section:** §5.9, §7

**Description:** AMS's shared audit table stores and displays plaintext `user_email` for many application mutations. The draft says email addresses in audit rows are never plaintext but does not say whether this applies only to auth events or the whole shared table. Plain SHA-256 of a normalized email is easily dictionary-tested and remains personal data. Hashing also removes the readable actor label used by current audit screens. No schema, backfill, UI, retention, or compatibility migration is listed.

**Rationale:** The new rule changes both the data contract and a user-facing audit function.

**Impact:** A broad implementation can break audit screens and historical search while providing less privacy than assumed.

**Recommended action:** Decide the actual purpose:

- Known authenticated actor: prefer stable `user_id` plus a restricted display snapshot where there is a legitimate audit need.
- Pre-auth unknown email correlation: use normalized keyed HMAC with a rotatable secret, not bare SHA-256.
- Define normalization, retention, access, deletion, and migration.

**Open questions:** Must managers see historical actor emails after a user is deleted? Does “never plaintext” apply to all application audit rows?

### F-25 — RLS scope and public-write architecture are ambiguous

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Database security / scope  
**Relevant section:** §2, §5.6, §5.12

**Description:** “RLS on every table” does not distinguish application-owned tables from Supabase-managed schemas, views, storage objects, foreign tables, and migration metadata. “anon default-deny” also conflicts with genuine public database operations unless every public form goes through a server and uses an admin client. The standard does not say whether narrow anon policies are allowed.

**Rationale:** Public forms and RLS must have a clear trust boundary. Using a full admin client for every public write increases the consequence of an application bug.

**Impact:** Developers may create unsafe broad anon policies or bypass RLS with a full secret key without compensating validation.

**Recommended action:** Scope the rule to application-owned tables/views/functions/storage. State the preferred public-write pattern and permitted exceptions. Require explicit grants, `SECURITY DEFINER` owner/search-path checks, storage policies, cross-user negative tests, and least-privilege RPCs where practical.

**Open questions:** Are direct anon inserts allowed anywhere? Can public server writes use narrow RPCs instead of a general admin client?

### F-26 — “External services always mocked” contradicts the required proof

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Testing strategy / integration  
**Relevant section:** §5.15

**Description:** RLS behaviour, real Supabase session revocation, Auth dashboard settings, email links, CAPTCHA enforcement, cookie refresh, and provider rate limits cannot be proven with all external services mocked. The current CI uses placeholder Supabase values and has no required deployed auth smoke test.

**Rationale:** Unit tests should mock external services, but critical contracts require local Supabase or isolated staging integration tests.

**Impact:** Tests can pass while the production configuration blocks all login, allows signup, fails to revoke, or sends broken recovery links.

**Recommended action:** Change the requirement to:

- unit tests mock network services;
- local Supabase tests exercise RLS and auth-compatible database behaviour;
- isolated staging contract tests cover Supabase Auth, Turnstile test keys, email-link generation, and cookie/session flows;
- production gets read-only configuration checks and a controlled smoke test.

**Open questions:** Is there a non-production Supabase project and test mailbox for each app?

### F-27 — The mandatory test list omits key security and user journeys

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Testing / acceptance criteria  
**Relevant section:** §5.15, §9, §10

**Description:** The list omits sign-in success/failure/system outage; public signup rejection; disabled-leaver rejection; CAPTCHA missing/invalid/expired/replayed/outage; generic enumeration responses and timing; reset scanner/reuse/expiry/direct access; redirect attacks; sign-out scopes; route-handler origin checks; middleware Auth outage; audit failure; Turnstile CSP; email delivery; accessibility; and post-deploy dashboard verification.

**Rationale:** These are the paths most changed by v2.

**Impact:** A PR can meet the written test list without proving the standard's main controls or user experience.

**Recommended action:** Add a requirement-to-test matrix. Every normative statement should map to automated, integration, or named manual evidence. Define pass criteria, environment, owner, and retained artifact.

**Open questions:** Which tests gate merge, deployment, and portfolio conformance separately?

### F-28 — Email delivery is treated as content only

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Integration / availability / security  
**Relevant section:** §2, §5.8, §5.11

**Description:** Invites, password reset, reauthentication, and security notifications depend on email delivery. Supabase's default mail service is best effort and limited to two emails per hour; Supabase recommends custom SMTP for production. The draft specifies template appearance but not SMTP, sender domain, SPF/DKIM/DMARC, bounce handling, link tracking, delivery monitoring, retries, or support fallback.

**Rationale:** Password reset is the only recovery method and email mailbox compromise is accepted, making mail both a security and availability dependency.

**Impact:** Staff can be locked out, invites can silently fail, and tracking providers can rewrite auth links.

**Recommended action:** Require production SMTP, verified sender/domain controls, disabled link tracking for auth emails, delivery/bounce monitoring, rate-limit checks, and tested support escalation. Enable appropriate password-change security notifications.

**Open questions:** Which provider sends Supabase Auth mail today? Who monitors bounces and delivery failures?

### F-29 — Operational monitoring and configuration drift are missing

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Operations / monitoring  
**Relevant section:** §5.3, §5.5, §5.6, §5.9, §5.13, §10

**Description:** Recording dashboard values once in `CLAUDE.md` is not continuous evidence. The draft has no alerts or service levels for login failures, CAPTCHA failures, reset volume, audit-write failures, disabled-user attempts, Supabase Auth latency/errors, HIBP failures, mail delivery, or accidental config changes.

**Rationale:** Several critical controls live outside source control and can be changed without a deployment.

**Impact:** An app can drift out of conformance immediately after audit, and an attack or provider outage may go unnoticed.

**Recommended action:** Export supported Auth settings through the Supabase Management API, compare them with an approved baseline in CI or a scheduled job, and define a small alert set with owners and runbooks. Treat `CLAUDE.md` as explanation, not evidence.

**Open questions:** Which monitoring system and on-call contact exist for this portfolio?

### F-30 — The rollout plan is not portfolio-ready

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Delivery / migration / deployment  
**Relevant section:** §1, §7, §10

**Description:** The standard applies to all portfolio apps, but the evidence and fix list cover AMS only. There is no inventory of apps, Supabase projects, plans, framework versions, owners, environments, public forms, Auth settings, exceptions, or delivery dates. Approval would make unknown apps non-conformant without a transition policy.

**Rationale:** A portfolio standard needs an adoption model, not only one flagship changeset.

**Impact:** Delivery effort, cost, dependencies, and risk are understated. Teams may copy AMS-specific decisions into incompatible apps.

**Recommended action:** Before approval, create a portfolio matrix and define:

- applicability;
- owner;
- current version/config;
- required changes;
- plan-dependent controls;
- accepted exceptions;
- target date;
- evidence;
- temporary status: compliant, partially compliant, blocked, or not applicable.

**Open questions:** How many apps and Supabase projects are in scope? Which app rolls out first after AMS?

### F-31 — Deployment order and rollback are missing

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Release engineering / availability  
**Relevant section:** §7, §10

**Description:** Enabling Supabase CAPTCHA before the UI passes tokens will block login and reset. A CSP change can block Turnstile. Raising password requirements before all password surfaces are updated creates inconsistent behaviour. Audit schema changes can break existing screens. The rollout has no staging order, feature flag, rollback, or production smoke gate.

**Rationale:** Code, Supabase dashboard settings, Cloudflare settings, email templates, secrets, and migrations are separate deployment systems.

**Impact:** A partially completed rollout can lock out all staff or leave authentication in an unknown mixed state.

**Recommended action:** Add an ordered runbook:

1. inventory and backups/evidence;
2. dependency and key preparation;
3. code capable of handling old and new config;
4. staging integration tests;
5. CSP and Turnstile keys;
6. deploy UI/server changes;
7. enable Supabase settings;
8. production smoke tests;
9. monitoring;
10. time-boxed rollback steps for every external change.

**Open questions:** Can CAPTCHA enforcement be safely feature-flagged per environment? Who can roll back dashboard and Cloudflare changes?

### F-32 — The evidence section and known-gap list are incomplete

**Status:** Confirmed issue  
**Priority:** P1  
**Type:** Auditability / accuracy  
**Relevant section:** §4, §7

**Description:** In addition to the Route Handler error, the gap list misses the database-backed role-model conflict, broad `/api` exemption, admin client lacking `server-only`, plaintext audit emails, missing Turnstile environment/CSP configuration, missing shared auth helpers, and provider-level signup settings. “Everything needed to judge it is in this document” is therefore not true.

**Rationale:** The stated goal is independent validation and an honest, small conformance gap.

**Impact:** Approval and implementation estimates will be based on incomplete work.

**Recommended action:** Regenerate the current-state section from a reproducible evidence appendix at a named commit. Include commands/counts and mark dashboard facts as verified or unverified.

**Open questions:** Was the whole portfolio audited or only AMS? Which dashboard values were actually observed?

### F-33 — Auth helper contracts do not cover all server surfaces

**Status:** Confirmed issue  
**Priority:** P2  
**Type:** Functional architecture / error handling  
**Relevant section:** §5.7

**Description:** `requireAuth()` redirects and `withAuth()` returns 401, but no required pattern is defined for Server Actions, where redirect, thrown error, and structured result have different UX and logging consequences. There is also no 403 authorisation contract, active-account check, or rule for APIs that must return JSON rather than a login redirect.

**Rationale:** Middleware alone is not the security boundary for exported Server Actions or allowlisted APIs.

**Impact:** Apps will implement inconsistent failure semantics and may leak internal errors or redirect API clients.

**Recommended action:** Define minimal helpers by surface: page, Server Action, Route Handler, and sensitive fresh-auth action. Include 401/403/service-unavailable behaviour and active-account verification.

**Open questions:** Should unauthenticated Server Actions redirect or return a typed error?

### F-34 — Redirect validation is named but not specified

**Status:** Confirmed issue  
**Priority:** P2  
**Type:** Security / edge cases  
**Relevant section:** §5.2, §5.8, §5.15

**Description:** “Same-origin path” does not define handling of `//host`, encoded slashes, backslashes, control characters, whitespace, nested encoding, fragments, auth-loop destinations, or host-header poisoning. It also does not require one shared validator.

**Rationale:** Open-redirect prevention is easy to implement inconsistently across `next`, `from`, and cookie paths.

**Impact:** A recovery or login flow can redirect to an attacker-controlled or looping destination.

**Recommended action:** Require a shared path-only validator using a configured base origin, reject network-path references and auth-loop destinations, and add a malicious-input test table.

**Open questions:** Are cross-subdomain redirects ever valid?

### F-35 — Security-header requirements lack exact conformance values

**Status:** Confirmed issue  
**Priority:** P2  
**Type:** Security configuration / testing  
**Relevant section:** §5.2

**Description:** The draft names HSTS and Permissions Policy but does not set a minimum HSTS age, subdomain/preload decision, development exception, CSP reporting policy, or allowed app-specific feature exception. “Every response” is also not test-defined for redirects, errors, static files, short-link hosts, and framework-generated responses.

**Rationale:** Presence-only checks can pass weak or broken headers.

**Impact:** Apps can be declared conformant with ineffective values or can break legitimate features by copying an over-broad policy.

**Recommended action:** Define a baseline with minimum values, explicit environment differences, allowed documented overrides, and automated response tests across representative routes and statuses.

**Open questions:** Are all subdomains safe to include in HSTS? Is CSP report-only telemetry available?

### F-36 — Accessibility acceptance is missing from the auth journeys

**Status:** Confirmed issue  
**Priority:** P2  
**Type:** Accessibility / user experience  
**Relevant section:** §5.6, §5.8, §5.10, §5.15

**Description:** Cloudflare states that Turnstile is WCAG 2.2 AA compliant, but the application integration still needs accessible labels, keyboard flow, focus management, status announcements, error recovery, sufficient contrast, zoom/reflow, and a support route when scripts or privacy extensions block the widget. The draft has no accessibility tests for login, forgot-password, reset, invite acceptance, or Turnstile failures.

**Rationale:** Provider compliance does not make the complete form accessible. CAPTCHA expiry and asynchronous errors are particularly easy to make invisible to screen-reader users.

**Impact:** A legitimate staff member or public visitor may be unable to authenticate, recover an account, or submit a protected form.

**Recommended action:** Add keyboard and screen-reader acceptance checks, live-region requirements for asynchronous status, focus movement to errors, Turnstile blocked/expired recovery, 200% zoom/reflow, and automated checks backed by a short manual test.

**Open questions:** What assisted support path exists when Turnstile cannot run on a staff member's device?

## 5. Optional improvements

### O-01 — Add a self-service “sign out other devices” control

**Status:** Optional improvement  
**Priority:** P3  
**Type:** User security / support  
**Relevant section:** §5.3, §5.8

**Description:** Users have no specified way to end other sessions after losing a device or suspecting access.

**Rationale:** A supported `others` sign-out scope may provide a simple user-controlled response without an admin workflow.

**Impact:** Reduces support time and the exposure of lost devices.

**Recommended action:** Add a profile action only after sign-out-scope behaviour is proven.

**Open questions:** Should it require the current password or recent authentication?

### O-02 — Add security notifications

**Status:** Optional improvement  
**Priority:** P3  
**Type:** Detection / user communication  
**Relevant section:** §5.9, §5.11

**Description:** The required email content does not include password-changed, email-changed, or suspicious-sign-in notifications.

**Rationale:** Users can detect unauthorised account changes even without MFA.

**Impact:** Faster compromise detection.

**Recommended action:** Enable and test the smallest useful set of Supabase security notifications with a support contact.

**Open questions:** Is suspicious-sign-in data available without adding a separate service?

### O-03 — Use a route protection registry as the audit source of truth

**Status:** Optional improvement  
**Priority:** P3  
**Type:** Simplification / tooling  
**Relevant section:** §5.4, §5.6, §10

**Description:** Static analysis cannot reliably infer whether a Route Handler is browser-called, signed-token, webhook, cron, or abandoned.

**Rationale:** One small registry can drive audit checks, documentation, and tests.

**Impact:** Makes the standard more auditable and avoids fragile grep rules.

**Recommended action:** Generate or maintain a route manifest with protection class and owner; fail CI for unclassified mutating handlers.

**Open questions:** Can wrappers attach this metadata automatically?

### O-04 — Set a review date for the CSP exception

**Status:** Optional improvement  
**Priority:** P3  
**Type:** Security debt management  
**Relevant section:** §5.2, §6

**Description:** Nonce-based CSP is only a target state, with no review date.

**Rationale:** Undated target states tend to become permanent.

**Impact:** Keeps the accepted XSS risk visible without forcing an immediate rebuild.

**Recommended action:** Add an annual review or framework-upgrade trigger rather than an arbitrary implementation deadline.

**Open questions:** Which app should pilot nonce CSP first?

### O-05 — Provide a conformance evidence template

**Status:** Optional improvement  
**Priority:** P3  
**Type:** Delivery efficiency  
**Relevant section:** §10

**Description:** Every app will need to record the same external configuration and manual evidence.

**Rationale:** A standard template reduces omissions and makes cross-app comparison easier.

**Impact:** Faster, more consistent audits.

**Recommended action:** Include fields for project, environment, setting, actual value, source, verifier, date, expiry/recheck date, and exception.

**Open questions:** Should evidence live in each repository or a central portfolio register?

### O-06 — Add password-manager-focused UX guidance

**Status:** Optional improvement  
**Priority:** P3  
**Type:** Accessibility / usability  
**Relevant section:** §5.8, §5.10

**Description:** The standard does not require correct autocomplete tokens, paste support, show-password controls, or password-manager compatibility.

**Rationale:** These controls reduce reuse and typing errors without weakening policy.

**Impact:** Better adoption of long unique passphrases.

**Recommended action:** Add lightweight UX acceptance checks for login, change, reset, and invite password fields.

**Open questions:** None.

## 6. Direct answers to the validator questions

### Q1 — Is Server Actions + SameSite + Origin/Host sufficient for CSRF?

**Answer:** Yes for correctly implemented, supported Next.js Server Actions, with server-side authentication and authorisation on every action. Next.js documents POST-only invocation and Origin versus Host/forwarded-host checks. It is not sufficient as a description of AMS today because many browser mutations are Route Handlers. Those need a shared origin policy or migration. The standard must also pin compatible Next.js behaviour, require cookie attributes, and define proxy/missing-Origin cases.

### Q2 — Is a one-hour revocation window acceptable?

**Answer:** It can be an explicit accepted risk for ordinary internal access, but only after the revocation mechanism is corrected and leaver accounts are prevented from signing in again. High-sensitivity actions should check current account/permission state rather than relying only on a possibly stale JWT. A shorter JWT, such as 10–15 minutes, is the simplest way to reduce residual access if load and clock-skew tests are acceptable; Supabase advises not going below five minutes.

### Q3 — Is dropping account lockout defensible?

**Answer:** Defensible as an owner-approved trade-off, but not risk-free and not fully aligned with NIST's account-based throttling direction. Per-IP limits plus Turnstile handle basic automation, not distributed password spraying. Exact rate configuration, client-IP attribution, monitoring, and alerting are required. A short exponential delay or risk-triggered CAPTCHA could improve protection without a hard account lockout, but the current owner decision already requires CAPTCHA on every login.

### Q4 — Is a Turnstile outage becoming a login outage reasonable?

**Answer:** Reasonable for a small internal portfolio if accepted explicitly and supported by a safe break-glass process. A one-line dashboard instruction is not enough. The bypass must have named authority, outage verification, tighter temporary monitoring/rate limiting, a time limit, an audit trail, and a mandatory restore step.

### Q5 — Any objection to minimum 12, no composition, breach check, 72-byte cap?

**Answer:** No objection to no composition rules or breach checking. Minimum 12 is a pragmatic owner choice, but it is not current NIST/OWASP guidance for password-only authentication; that baseline is 15. The 72-byte cap needs careful Unicode and UI definition and can conflict with the recommendation to allow at least 64 characters. Do not claim full NIST/OWASP alignment unless those deviations are resolved.

### Q6 — Is documented `'unsafe-inline'` defensible?

**Answer:** Temporarily, yes, if the exception is explicit and reviewed. It is riskier here because Supabase browser sessions use JavaScript-readable cookies. Require compensating XSS controls, exact CSP source restrictions, Turnstile CSP updates, and a review trigger. Do not call nonce CSP a target without ownership or a review date.

### Q7 — Are sessions without time expiry acceptable on shared devices?

**Answer:** This is the weakest locked product decision. It can be accepted only as a clear risk decision, not as standards-aligned best practice. Require visible logout, remote account disable, operational shared-device controls, and fresh authentication for a small set of high-impact actions such as password change, payroll export, role change, and sensitive data export.

### Q8 — What should stay removed or be restored?

**Answer:** Keep Redis session storage, the generic double-submit layer, and the custom lockout table removed unless a future app has a stronger compliance need. Do not restore them portfolio-wide. Add only:

- a supported leaver/account-disable control;
- a shared same-origin wrapper for existing browser Route Handlers;
- exact rate-limit and monitoring requirements;
- a small fresh-auth control for high-impact actions;
- reliable external configuration evidence.

These are simpler than the v1 machinery and directly address the current gaps.

## 7. Required changes before approval

1. Replace the invalid user-ID session-revocation design with proven supported flows.
2. Add mandatory account suspension/deletion and active-staff enforcement for leavers.
3. Correct the Server Action claim and inventory all mutating Route Handlers.
4. Rewrite §5.7 so authorisation remains app-specific and AMS's database roles can conform.
5. Enforce invite-only and prohibited auth methods in Supabase project configuration.
6. Define password-change and recovery flows, including CAPTCHA and sign-out scopes.
7. Resolve the CSRF rule contradiction and define one Route Handler origin helper.
8. Define the public-form/Turnstile inventory and full validation contract.
9. Correct the password standards claim and define Unicode/byte behaviour.
10. Replace invite “atomicity” with idempotency, compensation, and reconciliation.
11. Define trusted audit producers and resolve the email-hash/data migration.
12. Add integration testing, configuration drift checks, monitoring, deployment order, and rollback.
13. Add a portfolio rollout matrix and update the conformance gap list from reproducible evidence.
14. Prefer new Supabase publishable/secret keys or document a near-term migration.

## 8. Unresolved decisions

- Administrative session termination mechanism and acceptable residual access by risk level.
- Leaver Auth account policy: delete, ban, or disabled retention.
- Authoritative role/permission source and maximum demotion propagation time per app.
- Whether minimum 12 remains an explicit NIST deviation or changes to 15.
- HIBP outage behaviour and Supabase plan dependency.
- CAPTCHA exemptions for signed guest links and payment journeys.
- Current-password versus reauthentication-nonce requirement.
- Sign-out scope for normal logout, password change, and password reset.
- Plaintext actor email, keyed pseudonym, and historical audit usability.
- Fresh-auth actions on shared devices.
- Valid production/preview origins and missing-Origin behaviour.
- Portfolio owners, order, target dates, staging projects, and rollback authority.

## 9. Major risks and dependencies

| Risk or dependency | Consequence | Needed control |
|---|---|---|
| Supabase Auth API and dashboard behaviour | Lockout, signup exposure, failed revocation | Staging contract tests and config baseline |
| Cloudflare Turnstile | Login/public-form outage or bypass | Shared verifier, safe runbook, monitoring |
| Email/SMTP | No invite or account recovery | Production SMTP and delivery monitoring |
| Existing Route Handlers | Unplanned CSRF/refactor scope | Protection inventory and shared wrapper |
| Database-backed AMS permissions | Standard/implementation conflict | App-specific authoritative role model |
| Long-lived sessions | Shared-device misuse | Fresh auth for sensitive actions and account disable |
| JavaScript-readable cookies + inline scripts | Session theft after XSS | CSP/XSS controls and exception review |
| Dashboard configuration drift | Silent non-conformance | Management API checks |
| Legacy Supabase keys | Forced migration by end of 2026 | Publishable/secret key plan |
| Portfolio diversity | Unknown effort and incompatible assumptions | App/project inventory |

## 10. Recommended next steps

1. Product owner decides the unresolved P0 account lifecycle and authorisation questions.
2. Developer proves the supported session/logout options in a disposable or staging Supabase project.
3. Generate the AMS route/protection and public-form/CAPTCHA inventories at commit `590711ba`.
4. Revise the specification, current-state section, and known-gap list.
5. Add a requirement-to-evidence matrix and an ordered rollout/rollback plan.
6. Re-run independent validation on the revised draft.
7. Only then replace the workspace standard and update `auth-standardiser`.
8. Pilot the implementation in AMS, with staging integration tests before any production dashboard toggle.
9. Roll out to other apps through the portfolio matrix rather than by copying AMS blindly.

## 11. Primary references

- [Supabase JavaScript sign-out reference](https://supabase.com/docs/reference/javascript/auth-signout)
- [Supabase signing out and scope behaviour](https://supabase.com/docs/guides/auth/signout)
- [Supabase user sessions and JWT expiry](https://supabase.com/docs/guides/auth/sessions)
- [Supabase SSR client guidance: `getClaims`, `getUser`, and `getSession`](https://supabase.com/docs/guides/auth/server-side/creating-a-client)
- [Supabase Auth general configuration](https://supabase.com/docs/guides/auth/general-configuration)
- [Supabase Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits)
- [Supabase password security](https://supabase.com/docs/guides/auth/password-security)
- [Supabase password-based Auth and production SMTP](https://supabase.com/docs/guides/auth/passwords)
- [Supabase email templates and redirect allowlists](https://supabase.com/docs/guides/auth/auth-email-templates)
- [Supabase migration to publishable and secret keys](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys)
- [Next.js Server Actions security guidance](https://nextjs.org/docs/app/guides/data-security)
- [Next.js Server Action allowed origins](https://nextjs.org/docs/app/api-reference/config/next-config-js/serverActions)
- [Cloudflare Turnstile server-side validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)
- [Cloudflare Turnstile automated testing keys](https://developers.cloudflare.com/turnstile/troubleshooting/testing/)
- [Cloudflare Turnstile overview and accessibility](https://developers.cloudflare.com/turnstile/)
- [NIST SP 800-63B-4 password requirements](https://pages.nist.gov/800-63-4/sp800-63b.html)
- [NIST SP 800-63B-4 session management](https://pages.nist.gov/800-63-4/sp800-63b/session/)
- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [Have I Been Pwned API and Pwned Passwords padding](https://haveibeenpwned.com/API/V3)
