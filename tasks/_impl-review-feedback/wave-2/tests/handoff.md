# Tests handoff — review feedback funnel (PR1), wave-2

Branch: `feat/review-feedback-funnel`

## File created
- `src/app/api/feedback/__tests__/route.test.ts` — Vitest unit tests for `POST /api/feedback`.

No feature (non-test) files were modified.

## Coverage (all six required cases + sub-cases → 9 `it` blocks)
1. Validation — `{}` (no rating) → 400 `VALIDATION_ERROR`, insert NOT called; `{ rating: 5 }` → 201, insert called once.
2. Honeypot — `{ rating: 5, honeypot: 'x' }` → 201, insert NOT called, sendEmail NOT called.
3. Rate limit — limiter returns a 429 Response → 429, insert NOT called.
4. Consent stripping — `contactConsent:false` with name/email/phone → 201, captured insert arg has `customer_name/email/phone === null`, `contact_consent === false`.
5. Email failure — `sendEmail` rejects → 201, insert WAS called once (submission persisted).
6. Idempotency — (a) missing `Idempotency-Key` → 400 `IDEMPOTENCY_KEY_REQUIRED`; (b) claim `{ state:'replay', response:{ ok:true } }` → 201, insert NOT called; (c) claim `{ state:'conflict' }` → 409 `IDEMPOTENCY_KEY_CONFLICT`, insert NOT called.

## Mock strategy
- `@/lib/distributed-rate-limit` → `applyDistributedRateLimit` mocked; default `null` (allowed), overridden to a 429 `Response` for the rate-limit test.
- `@/lib/supabase/admin` → `createAdminClient` returns a chainable mock; `.from().insert(payload).select().single()` resolves `{ data:{ id:'test-id' }, error:null }`. `insert` is a `vi.fn` whose first-call arg is asserted for consent stripping.
- `@/lib/email/emailService` → `sendEmail` mocked; default `{ success:true }`, rejects for the email-failure test.
- `@/lib/api/idempotency` → partial mock via `vi.importActual`: REAL `getIdempotencyKey` + `computeIdempotencyRequestHash`; mocked `claimIdempotencyKey` (default `{ state:'claimed' }`), `persistIdempotencyResponse`, `releaseIdempotencyClaim`.
- `@/lib/api/auth` (createApiResponse/createErrorResponse), `@/lib/utils` (formatPhoneForStorage), `@/lib/turnstile` left REAL → real status codes asserted.
- `beforeEach(() => vi.clearAllMocks())` then default impls re-applied.

## Vitest run summary
```
npx vitest run src/app/api/feedback/__tests__/route.test.ts

 Test Files  1 passed (1)
      Tests  9 passed (9)
   Duration  ~1.0s
```

## Issues / notes
- Request is cast to `NextRequest` via `as unknown as NextRequest`; the handler only touches `headers`/`json`/`url`, which a plain `Request` satisfies at runtime (cast documented inline).
- Consent-strip test uses `contactConsent:false`, so the phone is forced to `null` before normalisation — `formatPhoneForStorage` is never invoked, so leaving it real is safe.
