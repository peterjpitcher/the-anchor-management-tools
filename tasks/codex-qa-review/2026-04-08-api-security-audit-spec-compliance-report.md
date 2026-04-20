# Spec Compliance Audit Report

## Summary
[13 requirements checked, 4 fully compliant, 9 gaps found]

Reviewed all 128 `src/app/api/**/route.ts` files, the tokenized mutation routes under `/g/[token]` and `/m/[token]`, and the shared auth/rate-limit/idempotency helpers. Route inventory by auth posture: 58 session-auth, 21 API-key, 38 cron/webhook-signed, 8 public unauthenticated, 3 tokenized guest/callback. Of 55 mutating API routes, 2 are fully public unauthenticated, 9 are public API-key routes, and several `GET` routes still mutate state.

This was a source-only audit. The incident counts and named production API keys in the spec are not directly provable without live DB access.

## Requirements Coverage Matrix
| Spec Section | Claim | Status | Finding ID |
|---|---|---|---|
| 1, 3 | Incident counts and named production keys are validated by repo evidence | Incomplete | SPEC-004 |
| 2.1 | `POST /api/table-bookings` has the documented API-key, idempotency, and validation controls | Accurate | - |
| 2.2 | `POST /api/public/private-booking` is public and only in-memory IP-limited | Accurate | - |
| 2.3 | `POST /api/private-booking-enquiry` is public and only in-memory IP-limited | Accurate | - |
| 2.2-2.4 | File paths, line counts, and helper references are accurate | Inaccurate | SPEC-009 |
| 2.3 | The idempotency-persist failure issue is unique to enquiry route | Incomplete | SPEC-003 |
| 2.4 | Guest-token mutation route inventory is complete | Incomplete | SPEC-007 |
| 3, 4.4 | API-key audit/remediation is fully supported by code and query patterns | Incomplete | SPEC-004 |
| 4.4-4.5, 5 | Remediation scope covers all public mutation endpoints | Incomplete | SPEC-001 |
| 4.4, 7 | Read-only scopes cannot mutate booking/payment state | Missing | SPEC-002 |
| 7 | “Endpoints NOT requiring changes” table is accurate | Inaccurate | SPEC-008 |
| 7 | PayPal webhooks are the only relevant webhook surface | Incomplete | SPEC-006 |
| 5, user task 5 | All `src/app/api` routes were assessed for auth posture | Accurate | - |

## Findings (gaps, inaccuracies, or missed attack vectors)
### SPEC-001: Spec omits several public API-key mutation routes
- Spec Reference: Sections 2, 4.4-4.5, 5
- Claim: The meaningful public write surface is covered by the three named booking routes
- Code Reference: [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/parking/bookings/route.ts#L76), [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/external/create-booking/route.ts#L36), [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/event-bookings/route.ts#L38), [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/event-waitlist/route.ts#L163), [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/external/performer-interest/route.ts#L146), [auth.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/api/auth.ts#L145)
- Status: Missing
- Severity: High
- Description: The spec misses multiple public API-key mutation endpoints that create records or trigger email/SMS. If the same browser-held key is exposed, those routes are part of the same attack surface, and default CORS fallback to `*` increases reuse risk.

### SPEC-002: Two PayPal table-booking mutation routes only require `read:events`
- Spec Reference: Sections 4.4, 7
- Claim: Proposed scoped permissions are sufficient to prevent write access on ancillary booking routes
- Code Reference: [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/external/table-bookings/[id]/paypal/create-order/route.ts#L76), [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/external/table-bookings/[id]/paypal/create-order/route.ts#L120), [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/external/table-bookings/[id]/paypal/capture-order/route.ts#L84), [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/external/table-bookings/[id]/paypal/capture-order/route.ts#L163)
- Status: Missing
- Severity: High
- Description: Both routes mutate `table_bookings`, but both are gated by `['read:events']`. A nominally read-only key can create PayPal orders and mark bookings paid/confirmed.

### SPEC-003: Idempotency failure behavior is broader than the spec states
- Spec Reference: Section 2.3
- Claim: The 201-on-idempotency-persist-failure issue is specific to `/api/private-booking-enquiry`
- Code Reference: [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/table-bookings/route.ts#L415), [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/public/private-booking/route.ts#L231), [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/private-booking-enquiry/route.ts#L243), [idempotency.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/api/idempotency.ts#L110), [idempotency.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/api/idempotency.ts#L223)
- Status: Incomplete
- Severity: Medium
- Description: The same pattern exists on three routes, not one. When response persistence fails, the helper can leave the key stuck in a 24-hour `"processing"` state, so retries become `in_progress`.

### SPEC-004: API key audit section is only partially verifiable from source and misses auth-layer blind spots
- Spec Reference: Sections 3, 4.4-4.5
- Claim: The named key inventory and audit conclusions are fully validated by the repo
- Code Reference: [auth.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/api/auth.ts#L35), [auth.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/api/auth.ts#L80), [auth.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/api/auth.ts#L242), [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/customers/lookup/route.ts#L76), [20251123120000_squashed.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20251123120000_squashed.sql#L1701)
- Status: Incomplete
- Severity: Medium
- Description: Source confirms the query shape, schema defaults, wildcard-permission model, expiry check, and hourly `api_usage` counting, but not which keys exist in production or the exact wildcard counts. It also shows two missed issues: `api_usage` inserts are best-effort after the handler, and `/api/customers/lookup` accepts `create:bookings` or `read:events`, weakening proposed scope separation.

### SPEC-005: `api_keys` is publicly readable at the database layer
- Spec Reference: Section 3
- Claim: API key exposure is limited to browser-embedded keys
- Code Reference: [20251123120000_squashed.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20251123120000_squashed.sql#L4832), [20251123120000_squashed.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20251123120000_squashed.sql#L5568), [auth.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/api/auth.ts#L31)
- Status: Missing
- Severity: Medium
- Description: RLS allows public `SELECT` on active `api_keys`, and table grants include `anon` and `authenticated`. That leaks key names, permissions, rate limits, `last_used_at`, and `key_hash` even though raw keys are not exposed.

### SPEC-006: Webhook coverage is incomplete and `webhook_logs` is publicly insertable
- Spec Reference: Section 7
- Claim: PayPal webhooks are the only relevant webhook surface and are sufficiently covered
- Code Reference: [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/stripe/webhook/route.ts#L1176), [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/webhooks/twilio/route.ts#L17), [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/webhooks/twilio/route.ts#L365), [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/webhooks/paypal/route.ts#L104), [20251123120000_squashed.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20251123120000_squashed.sql#L4720), [20251123120000_squashed.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20251123120000_squashed.sql#L5889)
- Status: Incomplete
- Severity: Medium
- Description: Stripe and Twilio signed webhook routes also exist and should be part of the audit narrative. Separately, `webhook_logs` is publicly insertable via Supabase, so attackers can forge audit noise even if route handlers verify signatures correctly.

### SPEC-007: Guest-token/server-action inventory is incomplete
- Spec Reference: Section 2.4
- Claim: The three listed `/g/[token]/*` routes are the relevant no-session callable mutation routes
- Code Reference: [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/g/[token]/private-feedback/action/route.ts#L37), [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/g/[token]/waitlist-offer/confirm/route.ts#L203), [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/g/[token]/event-payment/checkout/route.ts#L23), [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/m/[token]/charge-request/action/route.ts#L71)
- Status: Incomplete
- Severity: Low
- Description: Additional tokenized mutation routes exist outside the three listed ones. They are still lower risk than the public APIs because they depend on possession of a high-entropy token plus token+IP throttling.

### SPEC-008: “Endpoints NOT requiring changes” is internally inconsistent and overlooks mutating GETs
- Spec Reference: Section 7
- Claim: The listed endpoints do not require changes, and the rest of the listed GET surfaces are harmless because they are read-only
- Code Reference: [api-security-audit-spec.md](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/tasks/api-security-audit-spec.md#L130), [api-security-audit-spec.md](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/tasks/api-security-audit-spec.md#L167), [api-security-audit-spec.md](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/tasks/api-security-audit-spec.md#L219), [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/redirect/[code]/route.ts#L255), [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/parking/payment/return/route.ts#L6), [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/private-bookings/contract/route.ts#L7)
- Status: Inaccurate
- Severity: Medium
- Description: The spec says `/api/table-bookings` needs no changes while earlier sections require Turnstile and per-phone rate limiting on that route. It also treats GET as read-only, but public and session-auth GET routes here can still insert/update records.

### SPEC-009: Several file metrics and helper references are wrong
- Spec Reference: Sections 2.1-2.4
- Claim: File lengths, line references, and the public limiter helper path are accurate
- Code Reference: [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/table-bookings/route.ts), [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/public/private-booking/route.ts), [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/private-booking-enquiry/route.ts), [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/g/[token]/table-manage/action/route.ts), [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/g/[token]/sunday-preorder/action/route.ts), [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/g/[token]/manage-booking/action/route.ts), [rate-limit.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/rate-limit.ts#L29), [rate-limiter.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/rate-limiter.ts#L17)
- Status: Inaccurate
- Severity: Low
- Description: The cited route line counts are off by one, and the live public rate limiter is `src/lib/rate-limit.ts`, not the deprecated wrapper in `src/lib/rate-limiter.ts`.

## Missed Attack Vectors
- Public API-key mutation routes omitted from the spec: [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/parking/bookings/route.ts#L76), [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/event-bookings/route.ts#L38), [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/event-waitlist/route.ts#L163), [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/external/create-booking/route.ts#L36), [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/external/performer-interest/route.ts#L146).
- Public mutation routes not named in the spec because they are `GET`: [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/redirect/[code]/route.ts#L255), [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/parking/payment/return/route.ts#L6).
- Under-scoped payment-state routes: [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/external/table-bookings/[id]/paypal/create-order/route.ts#L10), [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/external/table-bookings/[id]/paypal/capture-order/route.ts#L19).
- Direct DB exposure omitted by the spec: public read access to active [api_keys](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20251123120000_squashed.sql#L4832) and public inserts into [webhook_logs](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20251123120000_squashed.sql#L4720).
- Additional no-session token routes omitted: [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/g/[token]/private-feedback/action/route.ts#L37), [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/g/[token]/waitlist-offer/confirm/route.ts#L203), [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/g/[token]/event-payment/checkout/route.ts#L23), [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/m/[token]/charge-request/action/route.ts#L71).

## Fully Compliant Areas
- The spec is correct that [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/table-bookings/route.ts#L102) is API-key protected, requires `create:bookings`, requires `Idempotency-Key`, and validates input through Zod plus phone normalization.
- The spec is correct that [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/public/private-booking/route.ts#L58) and [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/private-booking-enquiry/route.ts#L99) are public write routes with only in-memory IP throttling and no Turnstile/CAPTCHA.
- The spec is correct that the listed guest-token routes rely on strong random tokens and DB-backed token+IP throttling via [token-throttle.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/guest/token-throttle.ts#L140).
- The spec is correct that signed webhook handlers verify authenticity before business-state processing: [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/webhooks/paypal/route.ts#L104), [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/stripe/webhook/route.ts#L1176), [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/webhooks/twilio/route.ts#L365).