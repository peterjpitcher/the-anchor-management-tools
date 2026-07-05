# Discovery — Business Logic vs SOP Pack (§§8, 10–15, 25, 28)

Agent: business-logic audit. Base commit: 1e53841d. Scope: `src/app/actions/privateBookingActions.ts` (2,391 lines), `src/app/actions/refundActions.ts`, `src/services/private-bookings/{types,queries,mutations,payments,financial,scheduled-sms}.ts`, `src/lib/private-bookings/**`, `src/types/private-bookings.ts`, plus migrations.

## 1. Due-date maths — NON-COMPLIANT (fails pack acceptance test)
- App: `mutations.ts:321-326` — `d.setDate(d.getDate() - 7)` → balance due = **event − 7 days**.
- DB trigger `calculate_balance_due_date()` fires on insert/update of `event_date`, overrides app: `squashed.sql:35-47,4342`; re-affirmed `20260629000000_add_date_tbd_column.sql:14-21`. Column comment squashed.sql:3016.
- Acceptance test: event Sun 19 Jul 2026 → code produces **12 Jul 2026**; pack requires 5 Jul. FAIL.
- **Final-details due date: MISSING** — no field/concept anywhere.

## 2. Provisional hold — PARTIAL
- 14-day default ✔ (`types.ts:73-96`, `STANDARD_HOLD_DAYS=14`) but **capped at event − 7** (:95) — violates §10.5 (should not pass event − 14).
- Short notice <7 days: 48h hold (`types.ts:85-90`). §10.6 immediate-due-inside-14-days NOT implemented.
- **Hold blocks nothing** — no availability system (see 3).
- Extension `extendBookingHold` (`privateBookingActions.ts:1105-1146`): `edit` OR `manage` (not GM), **no reason**, audit only `{action, days}`. Service caps at −7, SMSes customer (`mutations.ts:1466-1564`).
- Expiry auto-release + release SMS + audit ✔ (`expire-holds` cron; `expireBooking` `mutations.ts:1344-1459`, SMS :1433-1447).
- Hold reminders: 7-day (4–10-day window) and 1-day (0–2-day window) only (`scheduled-sms.ts:132,159`). No 3-day. PARTIAL.

## 3. Conflict prevention — MISSING entirely
- `createBooking` (`mutations.ts:304-475`) and `create_private_booking_transaction` RPC: no conflict/overlap/capacity logic.
- Spaces are only line items (`types/private-bookings.ts:3`); no structured space/date-slot linkage.
- "Entire Pub": zero hits in src. No setup/clear-down overlap warnings, no block-on-conflict, no GM override. Confirmation does no conflict check (`payments.ts:318-405`).

## 4. Capacity — MISSING
- `capacity_seated`/`capacity_standing` stored (`types:96-97`) but **never compared to guest_count**. Validation is `z.number().min(0)` (`types.ts:141`). No 30-guest minimum/GM override anywhere.

## 5. Deposit — PARTIAL
- Default £250 ✔ (`mutations.ts:331`).
- Reduction: any creator sets any amount ≥0; edits need `manage`/`manage_deposits`, **no reason, no GM** (`privateBookingActions.ts:2143-2147,2197-2224`); **£0 deposit silently auto-confirms** (`payments.ts:842-880`). Audit does capture old/new (2229-2244).
- Separate from balance ✔ (`calculate_private_booking_balance`, `20260527000000` migration).
- **48h post-event refund workflow: MISSING** (post-event flow drives review SMS, not refunds).
- Same-method refund: PayPal → original capture ✔ (`refundActions.ts:254`); manual refunds no original-method check (:441-449). PARTIAL.
- **Deduction workflow MISSING** — free-text reason only; no evidence/attachment, no approval step, no itemised customer explanation.

## 6. Balance — COMPLIANT
- `GREATEST(0, discounted_total − balance_payments)`, deposit excluded ✔. Line-item mutations never touch payments; payment edits are deliberate + audited ✔.

## 7. Cancellation — NON-COMPLIANT in key places
- Engine `financial.ts`. Written-only capture MISSING — `cancelPrivateBooking(bookingId, reason?)` optional string, default 'Cancelled by staff' (`mutations.ts:1176`); no evidence/received-time/channel.
- 30-day threshold ✔ Europe/London (`financial.ts:108-143`); ≥30 days: deposit less 5% of deposit ✔ (:183-193); incurred costs not modelled.
- <30 days: **automatic `non_refundable_retained`** (:151,195-203) + SMS asserting retention (`privateBookingActions.ts:690-695`). Pack requires GM review "may retain up to". NON-COMPLIANT.
- No-show: MISSING. Unpaid balance → GM-review-then-cancel workflow MISSING (weekly digest flags only). Chargeback: `has_open_dispute` forces manual_review ✔ (:168-175) but manual flag only; refund actions don't check it.
- No money moves on cancellation; refunds separate via refundActions.

## 8. Date change — NON-COMPLIANT
- Any `edit` user changes `event_date` (`mutations.ts:534-545`); only completed/cancelled immutable (:669-683). No written request, no GM gate.
- Payments preserved ✔. Audit MISSING old/new date/reason/approver (no logAuditEvent inside `updateBooking` :482-1051; wrapper logs status only, `privateBookingActions.ts:377-387`).
- Draft bookings get date-change SMS (:763-792); **confirmed bookings get no notification** (:797-810 setup-only).

## 9. Hard delete — NON-COMPLIANT
- Only SMS-history gate (`privateBookingActions.ts:481-591`; `mutations.ts:1574-1612`; trigger `20260418120300`). **No payment/contract/email checks.**
- Cancelled bookings bypass entirely (`privateBookingActions.ts:532-538`; `20260623000000`) — cancelled bookings with payments+contracts hard-deletable. Contradicts §8 retention.

## 10. Contract-before-payment — NON-COMPLIANT / MISSING
- Deposit payment auto-confirms with no contract check (`payments.ts:365-374`).
- Booking portal (`src/app/booking-portal/[token]/page.tsx`) shows **no terms/contract** before payment.
- Only `contract_version` exists; incremented + audited on generation (`contract/route.ts:74-110`). **No contract_sent_at/sent_to/acceptance_method; no PDF snapshot** (route returns HTML :123). `payment_received_at` ≈ `deposit_paid_date` ✔. Payment-before-contract flag MISSING.

## 11. Audit coverage — PARTIAL
- `audit_logs` has old/new values, tamper-proofed (squashed:1746-1761,4334-4338); `private_booking_audit` has field/old/new/metadata/performed_by (squashed:2828-2838). **No `customer_notified` or `attachment_id`.**
- Covered: create/update-shallow/delete, deposit+balance payments, hold extension, discounts (with reason), PayPal, payment edit/delete old/new, cancellation reason, expiry, refunds, contract generation, settings CRUD.
- Gaps: `updateBooking` no field-level diffs (date/contact/deposit-amount changes leave no old→new); payments.ts services zero audit calls (rely on wrappers); reason enforced only for discounts + refunds.

## 12. RBAC vs §5 — PARTIAL
- In use: view/create/edit/delete/manage/manage_deposits/manage_spaces/manage_catering/manage_vendors/approve_sms/view_sms_queue/refund/generate_contracts (citations in report body). `manage` excludes high-risk ✔ (`permissions.ts:15-20`).
- **Missing: GM override permission entirely** — cancellation + hold extension need only `edit`; deposit reduction `manage_deposits` no reason; no deduction-approval, no conflict-override, no "Billy only" control.

## 13. Status/flags vs §8 — mostly MISSING
- Primary statuses ✔. Existing: view-derived deposit_status (3 states), payment_status, deposit_refund_status, has_open_dispute, post_event_outcome.
- Missing: 8-state deposit_status, balance overdue/disputed, final_details_status, supplier_status, waiver_status, risk_status, event_sheet_status, post_event_status. No final-details/supplier/waiver/risk/event-sheet data model at all.

## 14. Bar tab — MISSING (zero code)

## 15. VAT — MISSING (zero hits in business logic; no VAT field or inclusive/exclusive marker anywhere)

## Headline non-compliances
1. 14-day due-date wrong twice over (app + DB trigger; trigger silently overwrites app fixes).
2. No conflict prevention or capacity checking (0 of 7 §28 conflict items).
3. Automatic full deposit retention <30 days + customer SMS asserting it.
4. Hard delete allowed with payments/contracts; cancelled always deletable.
5. No contract-before-payment gating; no sent/acceptance tracking or snapshot.
6. No GM-and-reason controls on deposit reductions, hold extensions, retention, date changes; date changes unaudited.
7. Final details, waivers, supplier docs, risk, event sheets, bar tabs, VAT: no data model.

Bright spots: balance maths, hold expiry auto-release with SMS + audit, refund engine (permission-gated, capped, idempotent, audited), 5%-of-deposit maths, payment edit/delete audits.
