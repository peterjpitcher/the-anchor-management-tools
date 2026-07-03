# Backend handoff — review feedback funnel (PR1)

Branch: `feat/review-feedback-funnel`

## Files created / edited

| File | Action |
|------|--------|
| `src/lib/feedback/schema.ts` | new — Zod schema + `FeedbackSubmission` type |
| `src/lib/feedback/manager-email.ts` | new — `buildManagerFeedbackEmail()` |
| `src/app/api/feedback/route.ts` | new — `POST` + `OPTIONS` handlers |
| `src/middleware.ts` | edited — added `'/feedback'` to `PUBLIC_PATH_PREFIXES` |

Note: `/api/feedback` was already public via the `'/api'` prefix in middleware; the added `/feedback` prefix is for the frontend page route the other agent is building.

## API contract (as implemented)

`POST /api/feedback`
- `Content-Type: application/json`
- Required header: `Idempotency-Key: <uuid>`

### Request body (camelCase)
```jsonc
{
  "rating": 1-5,            // required, integer (z.coerce.number — string digits also accepted)
  "comments": "string?",    // optional, max 4000, trimmed
  "customerName": "string?",// optional, max 200
  "customerEmail": "string?", // optional, valid email OR "" , max 320
  "customerPhone": "string?", // optional, max 40 (normalised to E.164 server-side)
  "contactConsent": false,  // optional boolean, defaults false
  "honeypot": "string?"     // optional — non-empty => silently accepted, no insert/email
}
```

### Responses
All bodies go through `createApiResponse` / `createErrorResponse`.

| Scenario | HTTP | Body |
|----------|------|------|
| Success (incl. honeypot, replay) | 201 | `{ success: true, data: { ok: true } }` |
| Missing `Idempotency-Key` | 400 | `{ success: false, error: { code: 'IDEMPOTENCY_KEY_REQUIRED', message } }` |
| Invalid JSON | 400 | `{ ..., error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON body' } }` |
| Zod validation failure | 400 | `{ ..., error: { code: 'VALIDATION_ERROR', message: <first issue> } }` |
| Invalid phone | 400 | `{ ..., error: { code: 'VALIDATION_ERROR', message: 'Please enter a valid phone number' } }` |
| Idempotency key reused w/ different payload | 409 | `code: 'IDEMPOTENCY_KEY_CONFLICT'` |
| Idempotency claim in progress | 409 | `code: 'IDEMPOTENCY_KEY_IN_PROGRESS'` |
| DB insert failure | 500 | `code: 'FEEDBACK_SAVE_ERROR', message: 'Could not save your feedback'` |
| Rate limited (>10/h per IP) | 429 | `{ success: false, error: { code: 'RATE_LIMITED', message } }` (from `applyDistributedRateLimit`) |

`OPTIONS /api/feedback` → 200 `{ success: true, data: {} }`.

Replay note: on `claim.state === 'replay'` the persisted response `{ ok: true, id }` is returned wrapped in `createApiResponse(..., 201)`, i.e. `{ success: true, data: { ok: true, id } }`. First success returns only `{ ok: true }` (no `id`) — tests should assert `data.ok === true`, not the presence of `id`.

## DB insert object (into `public.review_feedback`)
```js
{
  rating,                                  // integer 1-5
  comments,                                // string | null (trimmed, null if empty)
  customer_name,                           // string | null
  customer_email,                          // string | null
  customer_phone,                          // string | null (E.164)
  contact_consent,                         // boolean
  source: 'review-funnel',
  submitted_ip: getClientIp(request),      // string | null
  user_agent: request.headers.get('user-agent') // string | null
}
```
`.select('id').single()`.

### Consent stripping (server-enforced)
If `contactConsent !== true`, `customer_name` / `customer_email` / `customer_phone` are forced to `null` BEFORE insert — the client cannot smuggle contact fields in without consent. Satisfies the DB CHECK (consent=false ⇒ all three contact cols null).

## `buildManagerFeedbackEmail` signature
```ts
buildManagerFeedbackEmail(input: {
  rating: number
  comments?: string | null
  customerName?: string | null
  customerEmail?: string | null
  customerPhone?: string | null
  contactConsent: boolean
  submittedAt?: Date        // defaults to new Date()
}): { subject: string; html: string }
```
- `subject` is always `'New guest feedback — The Anchor'`.
- HTML includes rating (`N / 5`), comments (or `—`), a London-formatted timestamp, and — if `contactConsent` — a contact block; otherwise the line "Guest did not leave contact details."
- Every guest value is escaped via an inline `escapeHtml`.
- The route spreads it into `sendEmail({ to: MANAGER_EMAIL, ...built })`.
- Recipient: `process.env.MANAGER_EMAIL || 'manager@the-anchor.pub'`.

## Behavioural notes for tests
- Email is best-effort: a thrown error or `{ success: false }` from `sendEmail` is `console.error`'d and does NOT change the 201. Mock `sendEmail`.
- `persistIdempotencyResponse` failure is logged, not thrown.
- Honeypot short-circuits BEFORE any DB/email work.
- No `logAuditEvent`, no `withApiAuth`, no `console.log` (eslint-banned). Only `console.error` used.
- Mock these modules in route tests: `@/lib/supabase/admin`, `@/lib/email/emailService`, `@/lib/distributed-rate-limit`, and (optionally) `@/lib/api/idempotency`.

## Verification done
- `npx tsc --noEmit` filtered to my four files → no errors.
- Full repo typecheck NOT run (frontend files being written in parallel).

## Assumptions
- `MANAGER_EMAIL` env var reused (falls back to `manager@the-anchor.pub`); no new env var introduced.
- `source` set explicitly to `'review-funnel'` (matches column default).
