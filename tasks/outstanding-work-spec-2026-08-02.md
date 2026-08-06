# Outstanding work, both applications

Date: 2026-08-02
Repos: `OJ-AnchorManagementTools` (AMS) and `OJ-The-Anchor.pub` (website).

Everything planned in the table-booking programme is shipped and live. This document is what remains: one genuine defect, several deliberate deferrals, and some tidying that stops future work tripping over today's scaffolding.

Nothing here is urgent except item 1, and item 1 is only urgent in the sense that it is a real wrong answer rather than a cosmetic one.

Ordered by value for effort.

---

## 1. Dates computed in the wrong timezone. Effort: S. Real defect.

### The fault

Two functions build or parse a date in the **machine's** timezone and then format it in **Europe/London**. The two halves disagree, so on any machine ahead of London the answer lands on the previous day.

**`src/lib/invoices/date-ranges.ts:3-12`**
```ts
const quarterStart = new Date(now.getFullYear(), currentQuarter * 3, 1)  // midnight, MACHINE time
return { startDate: toLocalIsoDate(quarterStart) }                        // formatted in LONDON
```
On CEST, `new Date(2026, 3, 1)` is 1 April 00:00 +0200, which is 31 March 23:00 in London, so the quarter start comes back as **2026-03-31**.

**`src/lib/leave/working-days.ts:41-47`**
```ts
const start = parseISO(startDate)                                          // midnight, MACHINE time
.map(date => formatInTimeZone(date, 'Europe/London', 'yyyy-MM-dd'))        // formatted in LONDON
```
Same shape, same off-by-one. `isCountedLeaveDate` is fine; the bug is only in `getCountedLeaveDates`.

### Does it reach a real user

**Invoices: yes.** `getCurrentQuarterDateRange` is called from `src/app/(authenticated)/invoices/_components/InvoicesClient.tsx:237`, a **client** component, so it runs in the staff member's browser and uses their device timezone. Anyone whose device is ahead of London (a laptop still on Paris time after a trip, a misconfigured device, a VPN that changes the OS clock) gets a quarter that starts a day early. It is also called from `invoices/export/page.tsx:31`, which is server-side and therefore currently correct.

**Leave: not today, but fragile.** The leave paths run server-side on Vercel, which is UTC, and UTC is never ahead of London, so the answer is right in production. It would break on any non-UTC runtime.

Current real-world exposure is low because the staff are UK-based. It is still a wrong answer, and quarter boundaries feed VAT.

### The fix

Fix the **source**, not the tests. Both functions must build and format in the same timezone, which per the project rule is Europe/London via `src/lib/dateUtils.ts`.

- `getCurrentQuarterDateRange`: derive the year and month from London (`formatInTimeZone(now, 'Europe/London', 'yyyy-MM')` or the existing `dateUtils` helpers), then construct the quarter boundaries from those parts rather than from `getFullYear()`/`getMonth()` on a machine-local Date.
- `getCountedLeaveDates`: take the London calendar dates directly from the ISO strings rather than round-tripping through a machine-local `Date`. The inputs are already `yyyy-MM-dd`; iterating them as calendar dates removes the timezone question entirely.

Grep for the same pattern elsewhere before finishing: any `new Date(y, m, d)` or `parseISO(dateOnlyString)` whose result is later formatted or compared in Europe/London. That combination is always wrong.

### Also pin the test timezone

Separately from the source fix, set the timezone once so the suite is deterministic:

```ts
// vitest.config.ts
test: { env: { TZ: 'Europe/London' }, ... }
```

`vitest.config.ts` currently sets `environment: 'jsdom'` and `setupFiles: ['./vitest.setup.ts']` with no TZ. Adding it means every developer and CI run matches the project's declared timezone.

**Do both.** Pinning the TZ alone would hide the source bug rather than fix it.

### Verify

`npx vitest run` with **no** TZ override, passing on a machine set to CEST. Currently 9 tests fail across `tests/lib/leaveWorkingDays.test.ts` (2), `tests/lib/invoiceDateRanges.test.ts` (1), `tests/actions/leave.test.ts` (5) and `tests/components/InvoicesClient.test.tsx` (1).

Add one test per fixed function that runs under a deliberately non-London TZ and asserts the London answer, so the source fix is what is being proved rather than the config.

---

## 2. Delete the old four-step booking path. Effort: M. Website.

The two-screen flow is live behind the runtime flag `booking_options_step1`. The old four-step path still ships as the rollback. Once you are happy with the new flow (a week of real bookings is a sensible bar), delete it, because carrying two flows is how the codebase got into the state that produced most of this programme's defects.

The redesign left a precise list. In `ManagementTableBookingForm.tsx`: the `twoScreenFlow` prop and every branch on it, the `step === 'choose'` and `step === 'review'` blocks, the `!twoScreenFlow` find and details blocks, `handleContinueToReview`, `handleBackToFind`, `requestedTime`, `showAllTimes`, `slotWindowAnchorTime`, `visibleSlots`, `hideHighChairPicker`, and the `slotsStep` / `reportSlotDropped` forks. In `journey.ts`: `STEP_ORDER`, `STEP_LABELS`, the `'choose'` and `'review'` members, and rename `TWO_SCREEN_*` to plain names. `BookingProgressBar`'s `stepKeys`/`stepLabels` defaults. `lib/table-booking-slot-window.ts` and its test become dead. `app/book-table/page.tsx` loses the flag read.

**The real work is the test file, not the component.** `tests/unit/ManagementTableBookingForm.test.tsx` cannot simply be deleted: its idempotency-key, London-timezone, busyness, funnel-sequence, stale-alternatives, food-check-notice, purpose-derivation and phone-privacy tests all describe behaviour that survives. Each needs a two-screen equivalent **before** the old path goes.

Also delete in the same pass, both now dead:
- `coversHighChairRequest` on `SlotVerdict` (`lib/table-booking/selection.ts`), which has no production consumer and exists only because of an over-correction during review.
- `kitchen_open` on the wire. It is produced by the shared slot builder and passed through, is marked informational only in both the shared type and the form, and decides nothing. A dead field that once decided bookings is exactly what someone re-trusts in a year.

---

## 3. Two pre-existing booking-form defects. Effort: S each. Website.

Both were confirmed by running code during the release gates, both predate this programme, and both were deliberately left alone rather than widen scope at the gate.

**3a. A contradictory empty state.** After choosing a nearest alternative and pressing Back, the choose step renders "No online times available" for a date whose times it is listing directly below. Reachable with the flag off, so it affects the live path today.

**3b. A date change never supersedes an in-flight availability request.** `handleDateChange` clears state but does not invalidate a request already in the air, so a slow answer about the old date can still land. It fails towards "unknown" rather than towards a phantom bookable slot, which is why it was not treated as blocking, but it is the last request path not covered by the shared generation context introduced during this work.

Fixing 3b properly means folding the remaining ref into `beginAvailabilityRequest` / `cancelAvailabilityRequests`, which is the same consolidation already done for the search, re-read and alternatives paths.

---

## 4. Staff screen for non-Christmas seasonal questions. Effort: M. AMS.

The seasonal system supports any number of periods (Mother's Day, Easter, Father's Day), and the API accepts `booking_period_id` and `booking_period_answer` on both create routes. **But FOH has no UI that sends them.**

So today staff can only take a seasonal booking through the `christmas` purpose. Christmas works; nothing else does. Until this is built, do not create a Mother's Day or Easter period expecting staff to be able to use it.

Needs: the period question on the FOH create-booking modal when the chosen date falls inside an active period, the answer passed through, and the deposit consequence shown before the booking is taken.

---

## 5. Should amending a party size re-price a seasonal deposit? Effort: S once decided. Owner decision.

Today, changing the party size on a booking that carries a `booking_period_id` **refuses and warns** rather than re-pricing. Staff correct the money by hand.

That was chosen deliberately: when the groups-of-10 rule beat the seasonal one, the booking's snapshot records the **group** basis and rate, so the period's rate is not available to re-apply, and reading it back off `booking_periods` would price the guest against terms a manager may have edited since.

The consequence is that an over-collection stays visible rather than silently vanishing, which is the safer failure. But it is manual work.

**Options:** leave as is; or snapshot the period's rate alongside the winning rule so a re-price is always possible; or re-price only when the seasonal rule won. My recommendation is the second, because it makes the snapshot genuinely self-sufficient, which was its whole purpose.

---

## 6. Monitoring and alerting. Effort: M. Both.

Never built, flagged repeatedly, and the gap is now larger because more of the booking path is automated.

There is no operational signal for: availability answering `unknown`, a shown-available slot being refused at create, payment setup or capture failures, expired holds, seasonal validation failures, or flag exposure. Problems surface as a customer complaint or not at all.

Minimum useful version: structured logs with a correlation id across website, AMS and PayPal (no personal data), counters for the six cases above, and an alert threshold on the two that cost money (create-time refusals and payment failures).

---

## 7. Measure whether the redesign actually helped. Effort: S. Website.

The analytics baseline shipped, and the funnel events that were documented but never fired now fire. Nobody has looked at the numbers.

The original goals were: completion rate from search to confirmed booking rises, median time from landing to confirmation falls, zero occurrences of the details-step dead end, and no high-chair shortfall surprises at confirmation.

None of these has a decision threshold. Before the old path is deleted (item 2), agree what "better" means numerically, or the deletion is a decision taken on faith.

---

## 8. Christmas, before it opens. Owner actions, not code.

The period `christmas-2026` is seeded **inactive**: 10 Nov to 20 Dec 2026, GBP 10 per head, pre-order required, zero menu items. Nothing can be charged until it is switched on.

To open it:
1. Settings, Table bookings, Seasonal periods.
2. Open the menu on "Christmas dinner 2026" and add each dish with its course and price. It will not go live with an empty menu and the screen says so.
3. Check the dates and the GBP 10 deposit read correctly.
4. Press **Switch on**.

To stop taking deposits at any point without a deploy, untick "Collect seasonal deposits" on the same screen.

**Know this before December:** a Christmas booking outside 10 Nov to 20 Dec is now permanently refused. That window was never enforced before, so this is a deliberate tightening. If a guest wants a December date outside the window, it is an ordinary booking.

---

## Not doing, recorded so nobody re-opens them

- **Sunday lunch pre-orders.** Retired in code, owner confirmed not returning for now. The mechanism is revivable groundwork for Christmas pre-orders; do not delete it.
- **The aircraft note.** Stays in the flow, treated as an attraction. Its conditional visual weight was specified and never built; low value, do it only if the flow is being touched anyway.
- **Refund boundary as elapsed hours.** Deliberately whole calendar days in Europe/London, so seven days minus a minute still refunds in full. Matches the existing `calculateRefundTier`. Do not "fix" this.

---

## A note on how to verify anything in this document

Across this programme, roughly 25 real defects were found by adversarial review, most of them introduced by the previous round's own fixes, and **every one of them had a green test suite at handover**. Two were found only by driving a real browser, and one of those was a defect I invented because my own test dispatched a `blur` event, which does not bubble and which React therefore never receives.

Treat a passing test as a starting point, not as evidence. For anything in this document that touches a date, money, or what a guest sees, prove it by executing the real thing: run the SQL against a real Postgres, or drive the real browser with `focusout` rather than `blur`.
