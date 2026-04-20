### SEC-001: Browser-usable API keys can create bookings across multiple write routes
- File: [src/lib/api/auth.ts#L145](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/api/auth.ts#L145), [src/lib/api/auth.ts#L271](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/api/auth.ts#L271), [src/app/api/table-bookings/route.ts#L103](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/table-bookings/route.ts#L103), [src/app/api/event-bookings/route.ts#L39](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/event-bookings/route.ts#L39), [src/app/api/event-waitlist/route.ts#L164](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/event-waitlist/route.ts#L164), [src/app/api/external/create-booking/route.ts#L37](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/external/create-booking/route.ts#L37), [src/app/api/parking/bookings/route.ts#L77](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/parking/bookings/route.ts#L77)
- Severity: Critical
- Category: Auth
- Description: `withApiAuth` accepts long-lived API keys from browser headers, allows wildcard `*` permissions, and defaults CORS to `*` while permitting `Authorization` and `X-API-Key`. Any extracted client-side key can be replayed from any origin to hit booking creation routes.
- Impact: Mass fake table/event/private/parking bookings, waitlist spam, outbound SMS/email abuse, and API quota exhaustion.
- Suggested fix: Remove browser-held write keys. Proxy these calls through a same-origin backend or short-lived signed tokens, eliminate `*` for public integrations, and split route-specific least-privilege scopes.

### SEC-002: `/api/public/private-booking` and `/api/private-booking-enquiry` are unauthenticated create endpoints
- File: [src/app/api/public/private-booking/route.ts#L58](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/public/private-booking/route.ts#L58), [src/app/api/private-booking-enquiry/route.ts#L99](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/private-booking-enquiry/route.ts#L99)
- Severity: Critical
- Category: Auth
- Description: Both routes create private-booking records with admin DB access and trigger manager notifications without any authentication. Idempotency only dedupes retries; it does not authenticate the caller.
- Impact: Unlimited fake enquiries/bookings, manager inbox flooding, and operational disruption.
- Suggested fix: Require server-verified caller auth for creation, or at minimum a verified challenge plus OTP. Decommission the deprecated public route if it is no longer needed.

### SEC-003: Public-facing booking routes lack CAPTCHA and contact ownership verification
- File: [src/app/api/table-bookings/route.ts#L183](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/table-bookings/route.ts#L183), [src/app/api/public/private-booking/route.ts#L180](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/public/private-booking/route.ts#L180), [src/app/api/private-booking-enquiry/route.ts#L185](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/private-booking-enquiry/route.ts#L185), [src/app/api/event-bookings/route.ts#L149](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/event-bookings/route.ts#L149), [src/app/api/event-waitlist/route.ts#L246](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/event-waitlist/route.ts#L246)
- Severity: High
- Category: Bot Protection
- Description: These routes create records and sometimes send SMS/email immediately after basic form validation. There is no Turnstile/reCAPTCHA, no proof-of-work, and no phone/email OTP proving the caller controls the supplied contact details.
- Impact: Automated fake bookings, victim-targeted SMS/email spam, CRM pollution, and continued abuse even if the current API key leak is fixed.
- Suggested fix: Add server-verified CAPTCHA before mutation and OTP verification before sending customer-facing notifications or converting a lead into a booking.

### SEC-004: The public rate limiter is per-process and trusts spoofable IP headers
- File: [src/lib/rate-limit.ts#L4](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/rate-limit.ts#L4), [src/lib/rate-limit.ts#L36](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/rate-limit.ts#L36), [src/app/api/public/private-booking/route.ts#L31](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/public/private-booking/route.ts#L31), [src/app/api/private-booking-enquiry/route.ts#L35](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/private-booking-enquiry/route.ts#L35)
- Severity: High
- Category: Rate Limiting
- Description: The limiter stores counters in a module-local `Map` and keys on raw `x-forwarded-for`/`x-real-ip`. Attackers can rotate spoofed headers, spread requests across instances, or benefit from restarts/cold starts resetting the budget.
- Impact: The only control on unauthenticated create routes is easy to bypass during a bot campaign.
- Suggested fix: Move to a centralized atomic limiter and trust only platform-controlled client IP headers after proxy normalization. Add non-IP dimensions such as phone, email, and device fingerprint.

### SEC-005: API-key rate limiting is raceable and effectively per-key only
- File: [src/lib/api/auth.ts#L80](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/api/auth.ts#L80), [src/lib/api/auth.ts#L280](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/api/auth.ts#L280), [src/lib/api/auth.ts#L306](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/api/auth.ts#L306)
- Severity: High
- Category: Rate Limiting
- Description: `withApiAuth` counts historical `api_usage` rows before running the handler and logs usage only after the handler returns. Parallel requests with the same key all see the same pre-count and pass, and there is no per-IP or per-caller component.
- Impact: A stolen key can burst far past its nominal limit and create many bookings quickly.
- Suggested fix: Reserve quota atomically before the mutation with a shared token bucket keyed by route plus key, and preferably route plus key plus normalized client identity.

### SEC-006: Deprecated public private-booking route lets callers inject internal items and pricing
- File: [src/app/api/public/private-booking/route.ts#L174](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/public/private-booking/route.ts#L174), [src/services/private-bookings/mutations.ts#L214](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/private-bookings/mutations.ts#L214), [supabase/migrations/20260421000003_fix_private_booking_customer_phone_canonical.sql#L13](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260421000003_fix_private_booking_customer_phone_canonical.sql#L13), [supabase/migrations/20260421000003_fix_private_booking_customer_phone_canonical.sql#L199](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260421000003_fix_private_booking_customer_phone_canonical.sql#L199)
- Severity: High
- Category: Input Validation
- Description: `/api/public/private-booking` passes `body.items` through without runtime validation. Downstream, the `SECURITY DEFINER` booking RPC inserts caller-controlled `space_id`, `package_id`, `vendor_id`, `quantity`, and `unit_price`.
- Impact: An unauthenticated attacker can create draft bookings with forged internal line items, manipulated pricing, or unauthorized foreign-key references.
- Suggested fix: Remove `items` from the public payload entirely or validate against server-owned catalogs and compute price server-side only. Reject client-supplied pricing and internal foreign keys.

### SEC-007: External PayPal table-booking routes allow write actions with `read:events`
- File: [src/app/api/external/table-bookings/[id]/paypal/create-order/route.ts#L16](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/external/table-bookings/[id]/paypal/create-order/route.ts#L16), [src/app/api/external/table-bookings/[id]/paypal/create-order/route.ts#L120](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/external/table-bookings/[id]/paypal/create-order/route.ts#L120), [src/app/api/external/table-bookings/[id]/paypal/capture-order/route.ts#L25](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/external/table-bookings/[id]/paypal/capture-order/route.ts#L25), [src/app/api/external/table-bookings/[id]/paypal/capture-order/route.ts#L163](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/external/table-bookings/[id]/paypal/capture-order/route.ts#L163)
- Severity: High
- Category: Auth
- Description: Both routes accept `read:events` and then mutate booking/payment state for arbitrary booking IDs. A read-only integration key should not be able to create deposit orders or mark bookings paid and confirmed.
- Impact: Unauthorized payment workflow manipulation, booking enumeration, and a much larger blast radius for any leaked read key.
- Suggested fix: Require a dedicated payment/write scope or a per-booking signed token, and bind booking access to caller context rather than a raw booking ID.

### SEC-008: Guest manage/preorder throttling is bypassable and raw guest tokens are logged
- File: [src/lib/guest/token-throttle.ts#L36](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/guest/token-throttle.ts#L36), [src/lib/guest/token-throttle.ts#L154](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/guest/token-throttle.ts#L154), [src/app/g/[token]/table-manage/action/route.ts#L78](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/g/[token]/table-manage/action/route.ts#L78), [src/app/g/[token]/sunday-preorder/action/route.ts#L67](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/g/[token]/sunday-preorder/action/route.ts#L67)
- Severity: Medium
- Category: Data Exposure
- Description: Guest-action throttling keys on spoofable IP data and uses a read-modify-write pattern that concurrent requests can outrun. Separately, error paths log raw guest bearer tokens, which are the full authorization secret for manage/preorder links.
- Impact: If logs are accessible or a token leaks elsewhere, attackers can replay live manage/preorder URLs to cancel bookings, alter party sizes, or change preorders, with weaker-than-expected abuse limits.
- Suggested fix: Never log raw tokens, redact/hash them in metadata, and move guest throttling to an atomic centralized limiter keyed primarily on token hash rather than client-supplied IP.

### SEC-009: `/api/customers/lookup` exposes customer PII to booking/read keys and can mutate on `GET`
- File: [src/app/api/customers/lookup/route.ts#L77](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/customers/lookup/route.ts#L77), [src/app/api/customers/lookup/route.ts#L196](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/customers/lookup/route.ts#L196), [src/app/api/customers/lookup/route.ts#L232](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/customers/lookup/route.ts#L232), [src/lib/api/auth.ts#L258](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/api/auth.ts#L258)
- Severity: High
- Category: Data Exposure
- Description: The route accepts the default `read:events` auth posture, returns `id`, name, email, and phone data for a supplied number, and on the legacy path can call `ensureCustomerForPhone`, causing a write during a `GET`.
- Impact: Any leaked booking/read key can enumerate customer PII and trigger unexpected customer creation/backfill.
- Suggested fix: Require a dedicated customer-lookup scope, minimize the response shape, and make `GET` strictly side-effect free.