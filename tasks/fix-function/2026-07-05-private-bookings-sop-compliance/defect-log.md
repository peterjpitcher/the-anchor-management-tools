# Private Bookings SOP Compliance — Defect Log (final)

Base commit: 1e53841d · Branch: `feat/private-bookings-sop-compliance` · Commits: 1bfc2ad7 (migrations), 4701e860 (app + tests)
Pipeline (final): lint ✓ · typecheck ✓ · tests 3312/3312 ✓ · build ✓

Status key: FIXED = implemented + verified; PARTIAL = core done, follow-up noted; N/A = superseded.

| ID | Sev | Finding | Status | Where fixed |
|---|---|---|---|---|
| FF-001 | C | Balance due = event − 7 (app + DB trigger) | FIXED | migration 100000 trigger + `types.ts balanceDueMoment` + `mutations.createBooking`; backfill of auto-set rows. Unit test: 19 Jul → 5 Jul ✓ |
| FF-002 | C | Automatic full deposit retention <30 days | FIXED | `financial.ts` → `gm_review_required` (manager decides 0..deposit); SMS/email/contract wording removed forfeiture |
| FF-003 | C | Waiver blanket liability release incl. death | FIXED | `contract-template.ts` waiver rewritten to pack §§51–52 (responsibility agreement, negligence carve-out, 14 named allergens) |
| FF-004 | C | No conflict prevention / Entire Pub | FIXED | migration 100005 `get_private_booking_conflicts` + `blocks_all_spaces`; `conflicts.ts`; gating in create/add-item/update/confirm |
| FF-005 | C | Contract governance (never sent, no snapshot, no tracking) | FIXED | migration 100002; `contract-lifecycle.ts` snapshot+version; `sendBookingContract` action; portal terms; payment-before-contract flag |
| FF-006 | C | Contract clauses missing / wrong (§§30–50) | FIXED | `contract-template.ts` full rewrite incl. financial summary w/ VAT, Billy signature, privacy, complaints, children/licensing, £25/£20, liability carve-outs |
| FF-007 | H | Hard delete allowed with payments/contracts | FIXED | migration 100001 + 100006 trigger; `mutations.deletePrivateBooking` + `getBookingDeleteEligibility` |
| FF-008 | H | Hold cap at −7; extensions no reason; no inside-14d rule | FIXED | `types.computeHoldExpiry` caps at due date; `extendHold` requires reason; short-notice due-immediately |
| FF-009 | H | Reminder schedules wrong | FIXED | cron monitor + `scheduled-sms.ts`: hold 7/3/1, balance 21/16/15/14 keyed to due date, no post-due chasing; guard template keys updated (FF-030) |
| FF-010 | H | Deposit reduction/deduction/refund gaps | FIXED | reduction/waiver require reason + gm_override; `privateBookingWorkflow` deductions (evidence/discussion/GM approval); post-event refund emails |
| FF-011 | H | Cancellation captures nothing | FIXED | migration 100004; `cancelBooking` capture (channel/received_at/cancelled_by); no-show + unpaid paths via review-pending |
| FF-012 | H | No GM override permission | FIXED | migration 100003 `gm_override`; `rbac.ts` union; gates on reductions/retention/risk/lock |
| FF-013 | H | No capacity checking / 30-guest min | FIXED | `conflicts.checkCapacity` (layout-aware); risk `gm_approval_required` for <30 guests |
| FF-014 | H | No VAT handling | FIXED | migration 100000 vat_rate columns + gross functions; `vat.ts`; all customer money VAT-inclusive |
| FF-015 | M | Package waiver flag / detection / status | FIXED | migration 100003 `requires_waiver` etc.; flag-first `bookingRequiresWaiverAnnex`; `waiver_status` lifecycle + upload + blocker |
| FF-016 | M | §8 workflow flags missing | FIXED | migration 100003 flags; `WorkflowStatusPanel` badges |
| FF-017 | M | Intake gaps (§9) | FIXED | migration 100003 fields; `EventDetailsRiskSection` on new/edit; bar-tab rules; £25 auto line |
| FF-018 | M | No staff event sheet | FIXED | `event-sheet.ts` + `/api/private-bookings/event-sheet` with readiness blockers |
| FF-019 | M | No supplier documents | FIXED | migration 100005 `private_booking_suppliers`; `SuppliersPanel` + rollup status |
| FF-020 | M | Sensitive data visible to all | PARTIAL | `view_sensitive` permission seeded (migration 100003) + event sheet marks allergy block "need-to-know"; detail-page field-level masking left as follow-up |
| FF-021 | M | Date change no capture/audit/notify | FIXED | `updateBooking` audits old/new date + reason + approver; confirmed bookings now notified; field-level diffs |
| FF-022 | M | Audit model gaps | PARTIAL | field-level diffs + reasons added; `customer_notified`/`attachment_id` surfaced via metadata rather than dedicated columns |
| FF-023 | M | Cancellation SMS-only; dead refund emails | FIXED | `sendBookingCancelledEmail`; refund emails exported + wired into refund flow |
| FF-024 | M | No retention schedule / locking | PARTIAL | migration 100006 record locking (locked_at + delete guard); defined 7yr/18mo retention SCHEDULE + automated purge left as owner-approved follow-up (destructive) |
| FF-025 | M | No complaints module | FIXED | migration 100006 `private_booking_complaints`; `ComplaintsPanel` (log/ack/respond/resolve, 3/10-day helper) |
| FF-026 | L | Business detail inconsistencies | FIXED | single `CONTRACT_COMPANY_DETAILS`; VAT grouping unified; privacy URL; companyDetails param wired |
| FF-027 | L | expire-holds daily lag; SMS-only release | KEPT | daily cadence retained (owner not asked to change cron frequency); noted |
| FF-028 | L | Spaces settings missing fields; PaymentModal no bank transfer | PARTIAL | spaces settings now expose vat_rate/blocks_all/min_hours/setup_fee/display_order; PaymentModal bank-transfer method left as-is (PayPal/cash/card/invoice cover current flows) |
| FF-029 | L | Cancellation refund SLA "10 working days" | KEPT | Owner confirmed (D3): keep 10 working days |
| FF-030 | M | Stale SMS-guard template-key list | FIXED | `private-booking-monitor` `PRIVATE_BOOKING_MONITOR_TEMPLATE_KEYS` updated to new triggers |

## Remaining out-of-scope / follow-ups (owner decision)
- FF-020/FF-022 detail-page sensitive-field masking + dedicated audit columns — enhancement, not a compliance blocker.
- FF-024 retention purge/anonymisation — destructive; needs owner + solicitor sign-off before build.
- Adjacent areas flagged in discovery.md (table bookings retention wording, events category cancellation policies, invoices/OJ Projects VAT display, app-wide GDPR retention, the-anchor.pub website) — separate pieces.
- Solicitor review of the pack wording (pack is itself draft-for-solicitor); re-issue as a version bump after feedback.

## Verification pipeline (run for the whole change)
- `npm run lint` → 0 warnings
- `npx tsc --noEmit` → 0 errors (excl. stale `.next` generated types from unrelated event-detail-preview work)
- `npm test` → 498 files, 3312 tests, 0 failures
- `npm run build` → success
- New tests added: `vat.test.ts`, `messages.test.ts`, `types.test.ts` (14-day acceptance test), `conflicts.test.ts` (capacity) + updated ~11 existing suites to SOP behaviour.

## Remediation passes
3 discovery/fix passes (initial 4-agent discovery → implementation → cross-agent reconciliation). Final pass surfaced: one real bug (no-op risk_status write blocked cancelled-booking edits — fixed) and the FF-030 guard list. No new compliance gaps in the last pass.
