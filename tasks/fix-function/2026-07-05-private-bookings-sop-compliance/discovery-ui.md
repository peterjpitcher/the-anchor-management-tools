# Discovery — Private Bookings UI vs SOP Pack

Agent: UI mapping. Base commit: 1e53841d. Abbreviations: **PB/** = `src/app/(authenticated)/private-bookings/`; **DC** = `PB/[id]/PrivateBookingDetailClient.tsx` (2,979 lines, live); **ACT** = `src/app/actions/privateBookingActions.ts`; **CT** = `src/lib/contract-template.ts`.

## 1. Route inventory (live components verified via page.tsx imports)

| Route | Live component(s) |
|---|---|
| `/private-bookings` | `PB/page.tsx` → `PB/_components/PrivateBookingsClient.tsx` (834 lines) |
| `/private-bookings/new` | `PB/new/page.tsx` (client page, 482 lines) |
| `/private-bookings/calendar` | `src/components/private-bookings/CalendarView.tsx` |
| `/private-bookings/sms-queue` | `PB/sms-queue/page.tsx` (server) + `SmsQueueActionForm.tsx` |
| `/private-bookings/[id]` | `PB/PrivateBookingDetailServer.tsx` (one level ABOVE `[id]/`) → **DC** + `PaymentHistoryTable.tsx` |
| `/private-bookings/[id]/edit` | `PB/[id]/edit/page.tsx` (client page, 545 lines) |
| `/private-bookings/[id]/items` | `PB/[id]/items/page.tsx` (935 lines) + permission-gate layout |
| `/private-bookings/[id]/contract` | redirect to `/api/private-bookings/contract?bookingId=` (regenerates on the fly — §28.2 snapshot unmet by route) |
| `/private-bookings/[id]/communications` | `CommunicationsTabServer.tsx` (last 50 SMS queue rows) |
| `/private-bookings/[id]/messages` | `PrivateBookingMessagesClient.tsx` |
| `/private-bookings/settings{,/spaces,/catering,/vendors}` | settings hub; spaces server page; `CateringManager.tsx`/`CateringPackageModal.tsx`; vendors page |

**Dead duplicates: none found in this section.**

## 2. Intake fields vs pack §9 (new:`PB/new/page.tsx`, edit:`PB/[id]/edit/page.tsx`)

| §9 item | Status | Evidence |
|---|---|---|
| Host name | PRESENT | new:145-165 |
| Host phone | PARTIAL | new:174-179; no communication-preference capture |
| Host email | PRESENT | new:190-195 |
| Event type | PARTIAL | new:245-252 free-text; no high-risk category flagging |
| Event date/time | PARTIAL | new:230-236,277-296; setup new:322-338; **no clear-down window** |
| Expected guests | PARTIAL | new:301-309 single count; **no adults/under-18s split** |
| Space requested | MISSING at intake | attached later as line items (DC:1009-1036, items:411) |
| Seated/standing/mixed layout | MISSING | nowhere |
| Catering/drinks (DB packages) | PRESENT (post-intake) | DC:1026-1031; items:160-165 |
| Bar tab | MISSING | 0 matches outside contract prose (CT:459,508) |
| Outside food flag | MISSING as flag | UUID+name detection only at contract time (CT:21-27,171) |
| External suppliers | PARTIAL | vendor line items only; no documents capture |
| Entertainment | PARTIAL | via vendor items only |
| High-power equipment (£25) | MISSING | zero matches |
| Decorations | MISSING | generic notes only (new:394-443) |
| Allergies/dietary | MISSING as field | free-text "Special Requirements" new:428-432; no sensitive-access marking |
| Accessibility | PARTIAL | free-text new:439-443, shown DC:2442; **visible to anyone with `view`** |
| Under-18s licence rules | MISSING | — |
| Dogs | MISSING | — |
| Special-risk flags | MISSING | — |

## 3. Status model & workflow flags vs §8

- Primary statuses match (`draft|confirmed|completed|cancelled`, types:1). Transition-constrained selects (edit:28-44; DC:603-606).
- Flags: deposit_status PARTIAL (derived 'Paid'|'Required'|'Not Required', types:243; no waived/retained/part-refunded/disputed); balance_status PARTIAL (derived, overdue not modelled); final_details_status / supplier_status / waiver_status / risk_status / event_sheet_status / post_event_status **all MISSING**.
- `has_open_dispute` checkbox on edit (edit:362-367).
- Hard delete UI (`DeleteBookingButton.tsx:49-115`) gated by `getBookingDeleteEligibility` (ACT:481-591) — **blocks only on SMS sent/scheduled** (ACT:568-585), skips gate for cancelled (ACT:533-539). Payment-made and contract-sent gates NOT checked.

## 4. Settings vs §6/§7

- **Spaces**: name/seated/standing capacities (:165-188 — both supported), hourly rate, active, description. MISSING UI: minimum hours (type exists types:99), setup fees, display order. §6 capacity RULES not implemented anywhere.
- **Catering** (`CateringPackageModal.tsx`): category food/drink/addon (:126-129 — no self-catering/other), all 7 pricing models (:142-148), minimum_guests (:222-225), active. MISSING: **seasonal, requires_waiver, requires_allergy_capture, vat_rate**.
- **Vendors**: name/service_type/contacts/etc. MISSING: **supplier document storage + approval status** (§28.18).

## 5. Capacity validation / 30+ minimum / GM override

- Only guest validation is `min="1"` (new:306-308). **No guest-vs-capacity comparison anywhere**; seated/standing capacities never used.
- **No conflict/double-booking check** (0 matches in PB/ + ACT + services), no Entire-Pub blocking.
- **No 30-guest minimum, no GM override UI/reason capture anywhere.**

## 6. Deposit/balance/refund/payment UI

- Default deposit £250 (new:352-360). Contract "No deposit required" branch when 0/NULL (CT:92-98,155-158).
- Deposit/balance separation good: Financial Summary DC:2478-2799; contract mirrors (CT:103,151-162).
- Deposit reduction: inline edit while unpaid, gated `canManageDeposits` (DC:2591-2642, 1706-1731) — **no reason field, no GM approval** (fails §28 test).
- PaymentModal methods **card/cash/invoice only** (DC:246,337-341) — bank transfer missing; PayPal via separate buttons (DC:2659-2678,1670-1704).
- Refunds: `canRefund`-gated (DC:2700-2708); RefundDialog captures method/amount-capped/reason-required (`invoices/RefundDialog.tsx:69-87,224-248`); RefundHistoryTable (DC:2714).
- **Deduction workflow MISSING** — only computed labels in cancellation preview (DC:507,517-519); no evidence/discussion/approval.
- **Bar tab UI MISSING entirely.**
- Discounts have required reason (DC:1234-1324).

## 7. Cancellation and date-change flows

- Cancellation (StatusModal DC:534-777): preview shows outcome badge `refundable`/`deposit_partial_refund` (5% admin)/`non_refundable_retained` (<30 days) (DC:497-530), refund/retained amounts (DC:696-711), SMS preview (DC:713-719). **Not captured: written evidence, received date/time, reason, approver — no input fields at all** (DC:632-668). No GM-review hook for <30-day refunds.
- Date change: plain date input on edit (edit:399-407). **No written-request evidence/reason/approver/14-day handling.** Nothing auto-refunds on date edit (§15.5 OK).

## 8. Staff event sheet

**Does not exist.** Zero matches for event sheet in src. Nothing from §29.

## 9. Permission gating vs §5

- In use: view, create, edit, delete, send, manage, manage_deposits, manage_spaces, manage_catering, manage_vendors, view_sms_queue, approve_sms, refund (`src/lib/private-bookings/permissions.ts:4-20`; mapping `PB/[id]/page.tsx:49-60`).
- **GM override permission MISSING** — no override permission or reason-required flows.
- **Privacy-restricted access MISSING** — accessibility/special-requirements visible to anyone with `view` (DC:2432-2442).
- `edit/page.tsx` has **no page-level permission check** (enforced only in `updatePrivateBooking` ACT:297-298); new page checks client-side post-mount (new:47-55).

## 10. Other notable

- No legacy "credit card hold" language in section.
- Provisional holds exist: `hold_expiry` defaults to deposit due date (ACT:228); list countdown + "Extend hold 7/14/30 days" with SMS notice (PrivateBookingsClient:90-95,283-291,564,605-620). No hold-reminder status in UI.
- Dashboard: "Draft Holds Expiring" (:259), "Balances Due Soon" (:262) cards.
- Balance due help text says auto-calc 14 days before event (new:376) — NB: DB trigger uses 7 days (see schema findings); needs reconciling.
- Contract version shown when >0 (DC:2861-2867); `contract_note` feeds PDF verbatim (edit:493-495).
