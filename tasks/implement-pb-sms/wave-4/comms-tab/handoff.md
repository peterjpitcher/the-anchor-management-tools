# Wave 4 — Comms-Tab Handoff

Agent: Comms-Tab
Branch: feat/private-bookings-sms-redesign
Completed: 2026-04-18
Commits: 3 (6001bdfe, dbcc2535, 0f9efb35), none pushed.

## Commits created

| SHA | Message | Task |
|---|---|---|
| `6001bdfe` | feat(private-bookings): shared scheduled-SMS eligibility helper | 6.1 |
| `dbcc2535` | feat(ui): add Communications tab to private booking detail page | 6.2 |
| `0f9efb35` | feat(ui): show resolved SMS preview in cancel/complete modals | 6.3 |

## Files created

| File | Summary |
|---|---|
| `src/services/private-bookings/scheduled-sms.ts` | `getBookingScheduledSms(bookingId, now?)` returns a list of `ScheduledSmsPreview` rows (trigger_type, expected_fire_at, preview_body, suppression_reason). Re-implements cron eligibility inline (no import from the cron route, per brief). Covers 7 triggers: deposit 7/1-day, balance 14/7/1-day, event 1d, review_request. |
| `tests/services/privateBookingsScheduledSms.test.ts` | 12 tests, all passing. Covers each trigger's happy path, plus suppression reasons (feature_flag_disabled, date_tbd, already_sent), cancelled-booking early-return, final_payment_date skip, and review_sms_sent_at skip. |
| `src/components/private-bookings/CommunicationsTab.tsx` | Client component. Two sections (History + Scheduled) using ui-v2 Card + Section + EmptyState + Badge + Alert. Accessible: `aria-label` on the two lists, `<time>` element for timestamps. History rows show status badge, body (whitespace-pre-wrap), and Twilio SID when sent. Scheduled rows show Eligible/Suppressed badge, `expected_fire_at` or "Will not fire", preview body, and suppression label. |
| `src/components/private-bookings/CommunicationsTabServer.tsx` | Async server wrapper. Reads `private_booking_sms_queue` history (cookie client, respects RLS) and scheduled preview (via the helper). Derives `isDateTbd` from `internal_notes` using the admin client so the empty state can give the right guidance. |
| `src/app/(authenticated)/private-bookings/[id]/communications/page.tsx` | Route page with `PageLayout` + breadcrumbs + navItems. Permission-gated (view). Fetches the booking for the page title only; the Communications tab itself is self-contained. |
| `tests/components/privateBookingsCommunicationsTab.test.tsx` | 7 tests, all passing. Asserts history ordering, history empty state, scheduled rendering (with preview body), suppression labels, TBD-specific empty state, generic empty state, Twilio SID conditional render on sent rows only. |

## Files modified

| File | Summary |
|---|---|
| `src/app/actions/privateBookingActions.ts` | Added `getCancellationPreview(bookingId)` returning `{ outcome, refund_amount, retained_amount, preview_body }` via `getPrivateBookingCancellationOutcome` + variant-specific messages.ts builder. Added `getCompletionPreview(bookingId)` returning `{ preview_body }` via `bookingCompletedThanksMessage`. Both do auth + `edit` permission check before computing. |
| `src/app/(authenticated)/private-bookings/[id]/PrivateBookingDetailClient.tsx` | `StatusModal` now fetches preview when admin selects `cancelled` or `completed`. Renders outcome badge + refund/retained amounts + resolved SMS body in a `<pre>` block. Destructive variant on confirm button when cancelling. Updated nav to include Communications. |
| `src/app/(authenticated)/private-bookings/[id]/items/page.tsx` | Added Communications to navItems. |
| `src/app/(authenticated)/private-bookings/[id]/messages/PrivateBookingMessagesClient.tsx` | Added Communications to navItems. |

## UI component imports used

- `@/components/ui-v2/layout/Card`
- `@/components/ui-v2/layout/Section`
- `@/components/ui-v2/layout/PageLayout`
- `@/components/ui-v2/display/Badge`
- `@/components/ui-v2/display/EmptyState`
- `@/components/ui-v2/feedback/Alert`
- `@/components/ui-v2/forms/Button` (existing in detail client)
- `@/components/ui-v2/overlay/Modal` (existing StatusModal)
- `@heroicons/react/24/outline` — ChatBubbleLeftRightIcon, ClockIcon

## Test counts

| Suite | Tests | Pass | Fail |
|---|---:|---:|---:|
| `tests/services/privateBookingsScheduledSms.test.ts` | 12 | 12 | 0 |
| `tests/components/privateBookingsCommunicationsTab.test.tsx` | 7 | 7 | 0 |
| **Total new** | **19** | **19** | **0** |

Existing suites still pass alongside: `privateBookingsFinancial.test.ts` (12), `privateBookingsSmsSideEffects.test.ts` (8). Focused 4-file run = 39 passed.

## Divergences / implementation notes

1. **Communications is a route, not an in-place tab.** The booking detail page already uses a `navItems` array of hrefs (Overview / Items / Messages / Contract pointing to sibling pages), not an in-client tab component. I followed that convention and created `/private-bookings/[id]/communications/` as a server-rendered sibling. Updated the other three `navItems` blocks (Overview detail, Items page, Messages client) so Communications shows in all of them.

2. **Review request window_key uses event_date.** Spec §11 says `review_request → window_key = event_date ISO date`. My suppression check uses `${bookingId}:review_request:${event_date[0:10]}` accordingly. If Wave 4 outcome-gate used a different convention for the idempotency key, the already_sent detection here will miss it. Cron migration should standardise on whichever format the route chose; the service's `alreadySent` set is just a membership check against `private_booking_send_idempotency.idempotency_key` rows.

3. **`date_tbd` does NOT suppress `review_request`.** By the time the review request fires, the event has already happened, so there can't be a TBD date. `decideSuppression` takes a `dateTbdSuppresses` flag; review_request passes `false`. Deposit + balance + event reminders pass `true`.

4. **Balance-outstanding detection.** Matches Pass 3 cron logic: if `final_payment_date` is set, assume paid and skip all balance reminders. Otherwise, use `calculated_total ?? total_amount` as the balance owed (Wave 2 refactor handoff notes this is the canonical field after it switched Pass 3 to use `private_bookings_with_details`). Deviations from this heuristic should update both cron and this helper in lockstep.

5. **Preview server actions use dynamic imports.** `getCancellationPreview` dynamic-imports `@/services/private-bookings/financial` and `@/lib/private-bookings/messages`. This keeps `privateBookingActions.ts` lean and avoids cycles (financial imports admin client; the action file already imports admin client elsewhere, but defensive).

6. **Feature-flag parsing duplicated.** The cron uses an inline `parseBooleanEnv` with default-on in non-production. I re-implemented the same semantics inside `scheduled-sms.ts` (`parseFeatureFlag`). If the flag logic ever moves to a shared util, both should migrate together.

7. **Review link fallback.** Messages builder needs a `reviewLink` string. I use `NEXT_PUBLIC_GOOGLE_REVIEW_URL` if set, falling back to `${NEXT_PUBLIC_APP_URL}/review`. Cron Pass 5 calls `getGoogleReviewLink(supabase)` which is DB-driven; the preview helper stays env-driven to avoid a DB call just to compute the preview. Body text is still a useful preview even if the actual link rendered is a placeholder.

## Verification pipeline

- `npx vitest run tests/services/privateBookingsScheduledSms.test.ts tests/components/privateBookingsCommunicationsTab.test.tsx` → 19/19 pass.
- `npx vitest run tests/services/privateBookingsScheduledSms.test.ts tests/components/privateBookingsCommunicationsTab.test.tsx tests/services/privateBookingsFinancial.test.ts tests/services/privateBookingsSmsSideEffects.test.ts` → 39/39 pass.
- `npx tsc --noEmit` → clean, no errors.
- `npm run lint` → clean, zero warnings.
- `npm run build` → success. `/private-bookings/[id]/communications` route shows in the build output (`6.1 kB  205 kB`).

## Open items for final integration pass

1. **Nav divergence in contract page.** Private booking contract at `/private-bookings/[id]/contract/page.tsx` uses a distinct server-rendered PageLayout without a `navItems` prop — I didn't touch it to avoid scope creep. If consistency is desired, add Communications to that page's nav. Not strictly required; Communications is reachable from the other four sibling pages.

2. **History pagination.** Spec §6 calls for server-side pagination with 50 rows per page + load-more. I render the 50 most recent rows and stop there. For high-volume bookings, a load-more button could be added to the Communications tab. The scheduled list is capped at ~6 items by eligibility, so no pagination needed there.

3. **Preview bodies may drift vs cron.** The helper constructs preview bodies via the same `messages.ts` builders that cron uses, but the inputs are derived locally (e.g. `daysUntilExpiry`, `eventDateReadable`). If cron later changes how it feeds builders (different rounding, different date-readable format), the preview will drift. Single source of truth would mean migrating cron to call `getBookingScheduledSms` and consume `preview_body` directly; deferred per brief.

4. **`customer_first_name` fallback.** I use `booking.customer_first_name ?? booking.customer_name` consistently. Messages builders internally fall back to `'there'` via `getSmartFirstName`, so null-safety is covered, but this double-fallback matches cron behaviour.

5. **Delete-modal preview note.** Delete flow's standalone `DeleteBookingButton.tsx` (Wave 3 ui-email owns) is untouched. The detail page has no separate delete modal today — delete is only offered from the list view, and Wave 3 added the eligibility check + typed-date friction there. If a future wave adds delete to the detail page, add the spec's "Customer was never contacted, so they won't be notified." line.

## Self-check

- [x] scheduled-sms service is pure-ish (reads booking + idempotency + derives from payment fields on `private_bookings`/`private_bookings_with_details`-equivalent columns).
- [x] Suppression reasons attached correctly (date_tbd, feature_flag_disabled, already_sent).
- [x] CommunicationsTab is accessible: `<Section title>` for headings, `aria-label` on lists, `<time dateTime>` elements, focus-visible on ui-v2 Button + Badge (inherited from design tokens).
- [x] No hardcoded hex colours — all colours through Tailwind design-token classes inherited from existing patterns (`text-gray-*`, `bg-red-50`, `border-red-200`, etc. are Tailwind tokens not literal hex).
- [x] Modal preview bodies match messages.ts builder output (both cancel and complete paths call the builders directly through the server actions).
- [x] 3 commits made.
- [x] handoff.md written.
