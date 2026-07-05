# Private Bookings SOP Compliance — Remediation Plan (approved 2026-07-05)

PROGRESS (updated as phases complete):
- Phase 1: DONE (code) — 14-day dates (migration 20260705100000 + app), VAT-aware money model (net storage, gross customer totals), GM-reviewed cancellation retention, contract+waiver rewritten to pack §§30–52, hold caps/reasons, hard-delete guard (20260705100001), deposit reduction/waiver guards. Verified: lint ✓ tsc ✓ build ✓; new unit tests 39/39 ✓.
- Phase 2: DONE (code) — contract lifecycle (snapshot bucket + versioned storage + send-by-email + sent/acceptance tracking + payment-before-contract compliance flag, migration 20260705100002), reminder schedules (hold 7/3/1; balance 21/16/15/14 keyed to due date, no post-due chasing), cancellation email, refund emails wired, privacy+complaints footer on all customer emails, portal terms-before-payment.
- Phase 3+4: migrations written (20260705100003–100006); backend agents implementing; UI wave next.
- Test suite: ~45 stale tests being updated to SOP behaviour by dedicated agent.
- NOT pushed, migrations NOT applied to prod — owner review gate at the end.

FOLLOW-UP DEFECTS found mid-build (fix before final verify):
- FF-030: `PRIVATE_BOOKING_MONITOR_TEMPLATE_KEYS` (private-booking-monitor/route.ts ~L49–60) still lists OLD reminder template keys (balance_reminder_14day/7day/1day) and omits the new ones (deposit_reminder_3day, balance_reminder_21day/16day/15day/due). The SMS rate-window guard undercounts new sends. Fix after service-wiring agent releases the file.

Decisions: D1 backfill=YES (auto-set −7 rows only, future bookings). D2 stored prices are NET → show VAT + gross totals on all customer-facing money; balance system becomes VAT-aware. D3 keep 10-working-day cancellation refund SLA. D5 implement pack wording now. D6 full Phase 4 approved.

Verification gate per phase: lint → typecheck → test → build. Commits local only; push + prod migrations at the end after owner confirmation.

## Phase 1 — Money, dates & wording
- [ ] P1.1 Migration: `calculate_balance_due_date` → event − 14 days; column comment; audit all functions/views referencing balance_due_date; backfill future auto-set rows (GREATEST(event−14, today))
- [ ] P1.2 App default −14 (`mutations.ts`); UI labels "balance & final details due"
- [ ] P1.3 VAT: `vat_rate` columns (catering_packages, venue_spaces, private_booking_items default 20); VAT-aware balance function + views (gross totals); contract/portal/SMS quote gross
- [ ] P1.4 Cancellation engine: <30d → GM-review retention picker (amount + reason), no automatic full retention; SMS/email wording to pack; no-show & unpaid-balance treat-as-cancelled path
- [ ] P1.5 Contract + waiver full rewrite to pack §§30–52 (financial summary w/ VAT + total-before-event + returnable, Billy signature block, privacy, complaints, children/licensing, lawful refusal, accessibility, £25/£20 charges, waiver → responsibility agreement w/ carve-outs + 14 regulated allergens); fix business details; wire companyDetails
- [ ] P1.6 Hold rules: cap at balance due date; inside-14-days → due immediately; extension requires reason (audited)
- [ ] P1.7 Hard-delete guard: block on payments/contract/emails; remove cancelled bypass (app + DB trigger)
- [ ] P1.8 Deposit guards: reduction below £250 requires reason; £0 no longer auto-confirms (explicit deposit_waived + reason)
- [ ] P1.9 Tests: due-date maths (19 Jul→5 Jul), VAT/balance calc, cancellation outcomes, hold expiry
- [ ] P1 verification pipeline + commit

## Phase 2 — Contract governance & comms
- [ ] P2.1 Contract snapshot: render PDF (puppeteer path), store in private_booking_documents + storage on each generation; version printed on PDF
- [ ] P2.2 contract_sent_at / sent_to / acceptance_method columns; Send-contract email action; payment-before-contract compliance flag; portal shows terms + acceptance before payment
- [ ] P2.3 Reminders: hold 7/3/1 + release; balance/details at 21/16/15/14 days pre-event keyed to due date, window-based catch-up for late bookings; stop post-due auto-chasing → GM review surface
- [ ] P2.4 Cancellation confirmation email; wire dead refund/balance email fns; privacy link + complaints line in customer emails
- [ ] P2 verification pipeline + commit

## Phase 3 — Workflow model & controls
- [ ] P3.1 GM override permission (rbac seed + checks); reason-required flows (deposit reduction, retention, hold extension, sub-30 guests, delete exception)
- [ ] P3.2 Package flags: requires_waiver, requires_allergy_capture, seasonal (+ self-catering category); settings UI; waiver detection flag-first; waiver_status (not_required/required/sent/signed/overdue) + signed upload + pre-event blocker
- [ ] P3.3 Workflow flags: final_details_status, supplier_status, risk_status, post_event_status; richer deposit/balance states; list + detail badges
- [ ] P3.4 Intake: layout (seated/standing/mixed) + adults/under-18s; bar tab (limit, prepay/preauth, approver); outside-food flag; entertainment + high-power equipment (£25 auto line + approval); decorations; dogs; special-risk flags + §18 high-risk triggers
- [ ] P3.5 Deduction workflow: deductions table (evidence attachment, customer-discussion note, GM approval, itemised email); post-event 48h deposit-review task
- [ ] P3.6 Cancellation capture (channel, received_at, evidence, processor); date-change flow (old/new/reason/approver audit + confirmed-customer notification); field-level audit diffs in updateBooking
- [ ] P3.7 Sensitive-data restriction: view_sensitive permission gating allergy/dietary/accessibility
- [ ] P3 verification pipeline + commit

## Phase 4 — Structural builds
- [ ] P4.1 Space-slot model: booking↔space↔time (incl. setup/clear-down); blocks_all flag for Entire Pub; conflict checks (hold + confirmed block); overlap warnings; block confirm on conflict; GM override w/ reason
- [ ] P4.2 Capacity: layout-aware guest-vs-capacity block; 30-guest minimum w/ GM override
- [ ] P4.3 Supplier documents: per-booking suppliers + docs + approval status + 14-day chasing
- [ ] P4.4 Staff event sheet (§29) with readiness blockers; stored as document
- [ ] P4.5 Retention locking (locked_at/reason guards); minimal complaints log (booking-linked, status, 3/10-day dates)
- [ ] P4 verification pipeline + commit

## Final
- [ ] Full pipeline (lint/typecheck/test/build) on the complete build
- [ ] Re-run discovery pass (fix-function step 8) for new defects
- [ ] defect-log.md final statuses
- [ ] Owner: review build, approve push to main + prod migrations (Supabase MCP)
