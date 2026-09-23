# Spec: PayPal webhook verification, make deliveries actually land

Date: 2026-09-23
Status: spec only, no code written

## Why this exists

The private bookings PayPal webhook has never accepted a single delivery. The earliest
rejection in `webhook_logs` is 26 March 2026 and the latest is 22 September 2026, every one
logged as `signature_failed` with "Invalid PayPal signature". The fix shipped on 22 September
(commit `ec38d409`) resolves the webhook id from PayPal by URL, and discovery confirms it now
resolves the correct id, but it still cannot succeed, because a second defect rejects every
PayPal retry before the signature is even checked.

No money was lost. That is luck of design, not of this endpoint: the synchronous return from
PayPal checkout writes the deposit, and a reconciliation cron runs every 15 minutes.

## Evidence gathered (23 September 2026)

Read-only: Supabase queries on `webhook_logs` and `private_bookings`, a read-only PayPal API
call listing registered webhooks, and the code on `origin/main`.

1. **Only three webhooks are registered in PayPal**, all on `management.orangejelly.co.uk`:
   - `/api/webhooks/paypal/invoices` id `5LU15237HW8378515`, events CAPTURE.COMPLETED, CAPTURE.DENIED
   - `/api/webhooks/paypal/private-bookings` id `6DH730426A1114341`, events CAPTURE.COMPLETED, CAPTURE.DENIED, CAPTURE.REFUNDED
   - `/api/webhooks/paypal/table-bookings` id `9WV925791Y5609407`, events CAPTURE.COMPLETED, CAPTURE.DENIED, CAPTURE.REFUNDED

   There is **no webhook for parking, none for event bookings, and none for the legacy
   `/api/webhooks/paypal` route**. Those three endpoints have never received a delivery, which
   `webhook_logs` confirms: the only sources ever logged are `invoices`, `private_bookings` and
   `table_bookings`.

2. **The stale env var is confirmed.** `PAYPAL_PRIVATE_BOOKINGS_WEBHOOK_ID` in the local env is
   `9JK32573HE5355827`, which is not any currently registered webhook. The registered one is
   `6DH730426A1114341`. Resolving by URL returns the registered id correctly, so the 22 September
   fix does the right thing.

3. **The 5 minute freshness gate rejects every PayPal retry.**
   `isPayPalTransmissionTimeFresh` in `src/lib/paypal.ts` (added 25 June 2026, commit `42893423`)
   returns false when `paypal-transmission-time` is more than 5 minutes from now.
   PayPal reuses the original transmission time on every retry, and retries for about 3 days.
   All ten deliveries since the fix went live are retries of one event transmitted at
   2026-09-21 09:44:07Z, so all ten were rejected before the signature was checked, and all ten
   were logged as "Invalid PayPal signature", which is not what happened.

4. **The log cannot tell the four failure causes apart.** Missing headers, a stale transmission,
   PayPal returning `verification_status: FAILURE`, and the PayPal verify API being unreachable
   all produce the same row: `status = 'signature_failed'`, message "Invalid PayPal signature".
   The webhook id actually used is never recorded. This is why the 22 September fix looked like
   it had failed when its own outcome is still unknown.

5. **The signature header is deliberately not stored** (`sanitizeHeadersForLog` keeps only
   `paypal-transmission-sig-present`). Correct for security, but it means a past delivery cannot
   be replayed to prove a fix. Proof must come from a fresh delivery.

6. **Three routes let a stale env var beat correct resolution.** `invoices`, `table-bookings` and
   `event-bookings` use `process.env.PAYPAL_*_WEBHOOK_ID || resolveWebhookIdForUrl(...)`.
   `private-bookings` and `parking` resolve only. The env-first order is exactly the failure mode
   that has just cost six months of dead webhook.

7. **No money lost, and the safety net was never needed for captures.** All nine private booking
   deposits that reached this endpoint (14 May to 14 September 2026, 100.00 to 600.00 GBP) have
   `deposit_paid_date` and `paypal_deposit_capture_id` set, each written about 5 seconds *before*
   the webhook attempt. The synchronous capture path records the deposit, and
   `/api/cron/paypal-deposit-reconciliation` runs every 15 minutes as backup.

8. **The real uncovered gap is refunds and denials.** The reconciliation cron only finalises
   pending captures. `PAYMENT.CAPTURE.DENIED` and `PAYMENT.CAPTURE.REFUNDED` are handled only by
   the webhook, so a refund issued inside PayPal has never been reflected on a private booking.

9. **Nothing alerted anyone.** `webhook_logs` holds over 1,200 `signature_failed` rows for this
   endpoint across six months. No alert, no dashboard, no cron check.

## Defects to fix

| Ref | Defect | Severity |
|---|---|---|
| D1 | PayPal retries can never verify: the 5 minute transmission window rejects them | High: removes the entire retry safety net on all five endpoints |
| D2 | Four different failure causes logged identically, webhook id never recorded | High: caused a day of wrong diagnosis and six months of invisibility |
| D3 | A stale env var overrides correct URL resolution on three routes | Medium: the bug we just had, still live on three endpoints |
| D4 | Parking and event bookings have no registered PayPal webhook | Medium: dashboard change, not code |
| D5 | Webhook failures raise no alert | Medium: the reason this ran for six months |
| D6 | Per-endpoint webhook id env vars are undocumented in `.env.example` | Low |

## Scope

In scope: `src/lib/paypal.ts`, the five `src/app/api/webhooks/paypal/*/route.ts` handlers, their
tests, `.env.example`, and one new health check. Behaviour only, no schema change.

Out of scope: the deposit rules, the reconciliation crons, Stripe, the legacy
`/api/webhooks/paypal` route, and any change to what the handlers do once an event is verified.

## Changes

### C1. Accept PayPal retries (fixes D1)

- Widen the transmission window to 4 days (PayPal retries for about 3), as a single exported
  constant with a comment naming the retry horizon.
- Keep the check only as a bound on ancient replays. Replay protection already comes from
  PayPal's own signature verification plus the idempotency claim, which has a 30 day TTL in
  every handler, comfortably longer than the retry horizon.
- A transmission outside the window is logged as `stale_transmission`, never as a signature
  failure, and returns 400, not 401.

### C2. Say what actually failed (fixes D2)

Replace the single `signature_failed` outcome with distinct statuses, written by every one of
the five handlers:

| Status | Meaning | HTTP |
|---|---|---|
| `missing_signature_headers` | A required `paypal-*` header is absent | 400 |
| `stale_transmission` | Outside the retry window | 400 |
| `signature_rejected` | PayPal returned `verification_status: FAILURE` | 401 |
| `verification_unavailable` | The PayPal verify call itself failed or was unreachable | 500, so PayPal retries |
| `configuration_error` | No webhook registered for this URL (unchanged) | 500 |

Every one of these rows records, in `error_details`: the webhook id used, where it came from
(`resolved` or `env`), PayPal's `verification_status` when there was one, and the transmission
age in seconds. The webhook id is an identifier, not a secret, and is already visible to any
staff member with PayPal access.

### C3. One resolution rule everywhere (fixes D3)

Add `resolvePayPalWebhookId(endpointPath)` in `src/lib/paypal.ts`, used by all five handlers:

1. Resolve by URL from PayPal (current `resolveWebhookIdForUrl`, 10 minute cache).
2. Only if that returns null, fall back to the endpoint's own env var, and log that it did.
3. Never fall back to `PAYPAL_WEBHOOK_ID`, which belongs to another endpoint.
4. If both are empty, fail closed with `configuration_error` and a 500 so PayPal retries.

This inverts today's order on the three env-first routes.

### C4. Make a dead webhook visible (fixes D5)

Add `/api/cron/paypal-webhook-health`, daily, cron-authenticated, read-only against PayPal:

- Compare the registered webhooks against the expected endpoint list and report any endpoint
  with no webhook, any webhook pointing at an unknown URL, and any missing event type.
- Count `webhook_logs` rows in the failure statuses above for the last 24 hours, per source.
- Email `CRON_ALERT_EMAIL` only when something is wrong, so a quiet day sends nothing.

### C5. Documentation (fixes D6)

Record the four per-endpoint webhook id env vars in `.env.example`, each noting that it is an
emergency override and that the id is normally resolved from PayPal. Add a line to the project
`CLAUDE.md` integrations table pointing at the health cron.

### C6. Owner action, not code (D4)

Register the missing webhooks in the PayPal dashboard for parking and event bookings, and delete
the stale `9JK32573HE5355827` value from Vercel once C3 ships.

## Acceptance criteria

1. A delivery whose transmission time is 2 days old and whose signature is valid is processed,
   not rejected.
2. A delivery with a valid signature and a fresh transmission is processed on every one of the
   five endpoints, with the id resolved from PayPal even when the env var is stale.
3. Each of the five failure causes writes its own status, and `error_details` names the webhook
   id used and its source.
4. A PayPal verify outage returns 500 and logs `verification_unavailable`, so the event is
   retried rather than silently dropped as a bad signature.
5. The health cron emails when an endpoint has no registered webhook, and stays silent when all
   is well.
6. `npm run lint`, `npx tsc --noEmit`, `npm run typecheck:tests`, `npm test` and `npm run build`
   all pass.

## Test plan

Unit tests, extending `src/app/api/webhooks/paypal/table-bookings/__tests__/route.test.ts` and
adding the equivalent for private bookings:

- A transmission 48 hours old with a valid signature is accepted.
- A transmission 5 days old is logged `stale_transmission` and returns 400.
- Missing `paypal-transmission-sig` is logged `missing_signature_headers`, not as a failed
  signature.
- PayPal returning FAILURE is logged `signature_rejected` with the webhook id in `error_details`.
- The PayPal verify call throwing is logged `verification_unavailable` and returns 500.
- A stale env var does not override the resolved id.
- The resolver returning null is logged `configuration_error` and returns 500.

Live proof, which is the part that cannot be faked: the stored signature is not retained, so no
past delivery can be replayed. Proof is the first fresh delivery after deploy showing
`received` then `success` for `source = private_bookings`. The existing scheduled check already
watches for exactly that.

## Rollout

One branch, three commits: `fix(paypal): accept retried webhook deliveries`,
`fix(paypal): record why a webhook verification failed`, `feat(paypal): alert on a dead webhook`.
Full gate before each commit. No migration, so nothing to apply to production. After deploy,
confirm the deployment id and watch `webhook_logs` for the first accepted private bookings
delivery.

## Risks

- Widening the transmission window weakens a replay bound. Mitigated by PayPal's own signature
  verification and by the 30 day idempotency claim, which rejects a duplicate event id.
- Resolving the id from PayPal adds a dependency on the PayPal API in the webhook path. It is
  already there today, cached for 10 minutes, and failure now returns 500 so PayPal retries.
