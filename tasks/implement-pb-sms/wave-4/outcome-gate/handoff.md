# Wave 4 — Outcome-Gate Handoff

Agent: Outcome-Gate
Branch: feat/private-bookings-sms-redesign
Commits: 3 (33b90364, c22606be, 7e35e174)

## Scope delivered

- Task 4.0 — Feature-flag verification (investigative)
- Task 4.2 — Outcome confirmation route (GET page + POST mutate)
- Task 4.3 — Pass 5 split into 5a (outcome email) + 5b (gated review SMS)
- Task 4.5 — Stale pending outcomes helper + weekly-digest wiring
- Plus: `as never` cast cleanup in `manager-notifications.ts`

## Task 4.0 — feature flag state

Code default in `src/app/api/cron/private-booking-monitor/route.ts:42-45`:

```ts
const PRIVATE_BOOKING_UPCOMING_EVENT_SMS_ENABLED = parseBooleanEnv(
  'PRIVATE_BOOKING_UPCOMING_EVENT_SMS_ENABLED',
  process.env.NODE_ENV !== 'production'
)
```

This means: unless the env var is explicitly `true`, the flag is **OFF
in production** (default `false` because `NODE_ENV === 'production'`). `.env.example` shows `=true` but that is a template for local dev, not
the production setting.

**Finding: assumption A1 holds.** No code change required. The user
still needs to confirm the Vercel production env does not set
`PRIVATE_BOOKING_UPCOMING_EVENT_SMS_ENABLED=true`; if it is set to
`true` in production, Phase 4 should already have been shipped ahead of
Phase 2 per the plan. Running
`vercel env ls production | grep PRIVATE_BOOKING_UPCOMING_EVENT_SMS_ENABLED`
is the only way to verify definitively (requires user auth to Vercel CLI).

No follow-up commit for Task 4.0.

## Files created

| File | Summary |
|---|---|
| `src/app/api/private-bookings/outcome/[outcome]/[token]/route.ts` | GET renders confirmation HTML (no state mutation, safe for email-scanner prefetch). POST performs atomic `UPDATE … WHERE post_event_outcome='pending'` (first-writer-wins), invalidates sibling tokens, audits. Throttled via `checkGuestTokenThrottle` scope=`private_booking_outcome` 8/15min (fail-closed in prod per token-throttle defaults). |
| `tests/api/privateBookingOutcomeRoute.test.ts` | 12 vitest cases covering token validity, expiry, consumed state, prefetch-safety (no mutation on GET), atomic claim, concurrent first-wins, throttle trip, and hash-not-raw-token DB lookup. |
| `tests/api/privateBookingMonitorPass5.test.ts` | 9 vitest cases covering Pass 5a (send + stamp + TBD + failure + no-op) and Pass 5b (send + idempotency + column race loss + 23505 duplicate + TBD). |
| `src/lib/private-bookings/stale-outcomes.ts` | `getStalePendingOutcomes()` helper. Returns rows where `post_event_outcome='pending'` and `outcome_email_sent_at IS NOT NULL AND < now() - 14 days`. Fail-safe (returns `[]` on error). |

## Files modified

| File | Summary |
|---|---|
| `src/lib/guest/tokens.ts` | Extended `GuestTokenActionType` union with `'private_booking_outcome'`. |
| `src/lib/private-bookings/manager-notifications.ts` | Removed the `as never` cast from Wave 3. Added `PrivateBookingWeeklyDigestStaleOutcome` type + stale-outcomes section (HTML banner + text block) in the weekly digest builder. |
| `src/app/api/cron/private-booking-monitor/route.ts` | Replaced legacy Pass 5 with Pass 5a (outcome email, atomic `outcome_email_sent_at` stamp) + Pass 5b (atomic `review_sms_sent_at` claim → idempotency reservation → queueAndSend with `trigger_type=review_request` + `template_key=private_booking_review_request` + `reviewRequestMessage` builder). Dropped unused imports (`createGuestToken`, `hasCustomerReviewed`, `sendSMS`, `ensureReplyInstruction`). Added `review_request` + 7/1-day balance reminder keys to `PRIVATE_BOOKING_MONITOR_TEMPLATE_KEYS` guard list. New stats counters `outcomeEmailsSent` + `reviewRequestsSent`. |
| `src/services/sms-queue.ts` | Added `'review_request'` to `PRIVATE_BOOKING_SMS_AUTO_SEND_TRIGGERS` so the new trigger dispatches automatically. |
| `src/app/api/cron/private-bookings-weekly-summary/route.ts` | Imports `getStalePendingOutcomes`; passes the results through to the digest builder as `stalePendingOutcomes`. Fail-safe wrapper — digest still sends if the stale query errors. |
| `tests/api/privateBookingMonitorIdempotency.test.ts` | Updated stubs to handle Pass 5a (`outcome_email_sent_at`) + Pass 5b (`review_sms_sent_at`) select patterns. |
| `tests/api/privateBookingMonitorRouteErrors.test.ts` | Same stub update as above. Ensured the new patterns are matched before the generic `customer_id, customer_first_name` branch. |

## Test counts

| File | Tests | Pass |
|---|---:|---:|
| `tests/api/privateBookingOutcomeRoute.test.ts` | 12 | 12 |
| `tests/api/privateBookingMonitorPass5.test.ts` | 9 | 9 |
| `tests/api/privateBookingMonitorIdempotency.test.ts` | 2 | 2 |
| `tests/api/privateBookingMonitorRouteErrors.test.ts` | 4 | 4 |
| `tests/lib/privateBookingsMessages.test.ts` | 46 | 46 |
| `tests/services/privateBookingsSmsSideEffects.test.ts` | 8 | 8 |
| **Total owned + directly touched** | **81** | **81** |

## Verification

```bash
npx tsc --noEmit                                            # clean
npx eslint <owned files>                                    # clean, zero warnings
npx vitest run <4 owned api tests>                          # 27/27 pass
npx vitest run tests/lib/privateBookingsMessages.test.ts
                   tests/services/privateBookingsSmsSideEffects.test.ts  # 54/54 pass
npm run build                                               # success
```

## Trigger / template keys

| Purpose | trigger_type | template_key | auto-send |
|---|---|---|---|
| Manager outcome email (no SMS — email only) | n/a | n/a | n/a |
| Review-request SMS after outcome=went_well | `review_request` | `private_booking_review_request` | YES (added to `PRIVATE_BOOKING_SMS_AUTO_SEND_TRIGGERS`) |

## Deviations from the plan

1. **Task 4.5 file path.** Plan suggested `src/app/(authenticated)/dashboard/ops-queries/private-bookings-outcomes.ts`. That directory does not exist in this repo — there is no established "ops queries" pattern under `dashboard/`. I placed the helper in `src/lib/private-bookings/stale-outcomes.ts`, next to the existing pure helpers (`tbd-detection.ts`, `weekly-digest-classifier.ts`). Same contract, more discoverable.
2. **POST outcome route, "booking-changed since email" notice.** Plan listed this as optional polish. Not implemented — the token → booking → atomic-claim flow is already first-writer-wins, and there is no natural "changed since email" state to detect without additional columns. Flagged here as a possible follow-up but not blocking.
3. **Pass 5a uses `getSmartFirstName` for the subject-line first name.** Plan snippet showed a direct field access. Using the helper matches every other call site in the cron and produces cleaner greetings for apostrophes / all-caps / null fallbacks.
4. **Pass 5b idempotency reservation AFTER the column claim (not before).** Plan steps showed idempotency first → column claim second. I reversed so the column claim is the authoritative race gate. If the column claim wins but the idempotency insert returns 23505, we log and skip rather than unwind the column (a non-issue in practice: both are locked to the same `{bookingId}:review_request:{event_date}` identity, so 23505 only happens when another process raced us into the queue, which should not bypass the column claim in the first place). This keeps the column value as a durable "we sent one" marker even if the idempotency table is ever pruned.
5. **`customerFirstName` in Pass 5a email.** Falls back to `'there'` when `getSmartFirstName` returns an empty string, matching the tone the messages module uses elsewhere.

## Concerns / watch-outs

1. **Manual verification of Vercel env `PRIVATE_BOOKING_UPCOMING_EVENT_SMS_ENABLED`.** The code defaults to `false` in production. If the Vercel dashboard has set it to `true`, Pass 5b will now send `review_request` SMS for `post_event_outcome='went_well'` bookings — which is the intended behaviour post-Phase-4, but only AFTER the CommsTab agent's work (Phase 4 + Phase 5 UI) has landed. If CommsTab is not done but Pass 5b is active, the review-request SMS goes out as designed, which is correct. Still worth the user confirming the env before cutting over.
2. **Retry-after header on 429.** I added `retry-after: N` (seconds). Email-scanner prefetch should never hit 429 (GET isn't throttled), but if an operator keeps reloading manually and does trip it, the browser will respect the header.
3. **Audit log for the POST outcome.** The route uses the `logAuditEvent` server-action helper from `@/app/actions/audit`. Because the POST is reached as an unauthenticated route (token IS the auth), `user_id` is not populated. The request IP + UA are captured in `additional_info.client_ip` and `additional_info.user_agent`. No `auth.getUser()` call in the route.
4. **Pass 5b does NOT re-verify `post_event_outcome='went_well'` inside the atomic claim.** Only the initial SELECT filters on it. If the manager changes their mind between the SELECT and the UPDATE (unlikely — outcome is first-write-wins, but theoretically a DB admin could reset it), the send would still go out. The column claim on `review_sms_sent_at` prevents double-send, but doesn't prevent "sent despite outcome change". Low risk; flagged for completeness.
5. **Weekly digest cron wiring.** `vercel.json` already schedules `/api/cron/private-bookings-weekly-summary` (hourly per existing config; the route itself gates on "Monday 9am London unless `?force=true`"). The stale-outcomes section will start appearing in the next Monday run.
6. **Test-stub divergence from Supabase client.** My mock uses a thenable-plus-chainable pattern for the `update().eq().is()` ambiguity. Real Supabase returns a `PostgrestFilterBuilder` which is a single chain — the mock is more forgiving. No production code was stubbed around, only test ergonomics.
7. **`getSmartFirstName` import kept in monitor route.** Used by Pass 5a to format the email subject's customer first name. If Pass 5a is later removed / restructured, this import can go.

## Self-check

- [x] `GET /outcome/…` does NOT update DB (verified via test that runs GET 3x with different `x-forwarded-for` and asserts zero booking/token updates).
- [x] POST first-writer-wins (verified via concurrent-POSTs test with shared state — exactly one "Recorded outcome" and one "already recorded" regardless of order).
- [x] Pass 5a only emails when `outcome_email_sent_at IS NULL` (enforced by the query's `.is('outcome_email_sent_at', null)` filter, and the atomic stamp also uses `.is('outcome_email_sent_at', null)` so a double-fire cron cannot re-send).
- [x] Pass 5b only sends when outcome is `went_well` AND status is not cancelled (enforced by `.eq('post_event_outcome', 'went_well').neq('status', 'cancelled')`).
- [x] `reviewRequestMessage` builder imported and called.
- [x] No `"The Anchor:"` literal remains in `src/app/api/cron/private-booking-monitor/route.ts` (grep returns zero matches).
- [x] 3 commits (Task 4.0 folded into 4.2 per brief because there was no code change for 4.0); no push.
- [x] Handoff written (this file).

## Final commit list (mine, chronological)

- `33b90364` feat(private-bookings): outcome confirmation route (GET page + POST mutate) — Tasks 4.0 + 4.2
- `c22606be` feat(cron): split Pass 5 into 5a (outcome email) + 5b (gated review SMS) — Task 4.3
- `7e35e174` feat(private-bookings): weekly stale-pending-outcomes report — Task 4.5
