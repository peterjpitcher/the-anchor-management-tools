# Private Bookings — SOP & Contract Pack Compliance Review

- **Date:** 2026-07-05 · **Mode:** fix-function Read-only Diagnosis (no code changed)
- **Base commit:** 1e53841d
- **Pack:** `~/Library/Mobile Documents/com~apple~CloudDocs/Downloads/the_anchor_private_bookings_sop_contract_rewording_pack.md` (55 sections)
- **Detailed evidence:** [discovery-ui.md](discovery-ui.md) · [discovery-logic.md](discovery-logic.md) · [discovery-contract.md](discovery-contract.md) · [discovery-comms.md](discovery-comms.md)
- **Method:** 4 parallel read-only agents (UI, business logic, contract/waiver, comms/crons) + live prod schema/function inspection via Supabase MCP.

## Pack acceptance-test scorecard (§28)

| Test | Result |
|---|---|
| Event Sun 19 Jul 2026 → due Sun 5 Jul 2026 | ❌ produces 12 Jul (event − 7; app default AND DB trigger) |
| Draft <14 days out → due immediately / manager deadline | ❌ 48h short-notice hold instead; nothing due immediately |
| Hold blocks the space from other enquiries | ❌ holds block nothing; no availability system |
| Hold reminders 7/3/1 days | ❌ 7 and 1 only, no 3-day |
| Hold expires unpaid → release confirmation + space freed | ✅ (SMS; daily cron so up to ~24h lag) |
| Guest count exceeds capacity → confirmation blocked | ❌ no capacity comparison anywhere |
| Entire Pub blocks all spaces / Dining Room conflicts | ❌ no conflict model; "Entire Pub" appears nowhere in code |
| Deposit reduced below £250 → GM override reason | ❌ anyone with manage_deposits, no reason; £0 silently auto-confirms |
| BYO food → waiver annex + waiver status required | ◐ annex auto-appends (UUID+name detection) but no waiver_status |
| Waiver required but unsigned → event-sheet blocker | ❌ no waiver tracking, no event sheet |
| High-power equipment → £25 charge + approval | ❌ nothing; contract says vague "standing charge" |
| Under-18s after licence times → flag | ❌ nothing; no under-18 capture |
| Cancellation <30 days → GM review | ❌ automatic full retention (code + SMS + email + contract) |
| Deposit deduction → evidence, discussion, Billy approval | ❌ no deduction workflow |
| Contract sent before payment → timestamp + version recorded | ❌ contract is never sent by the app; no sent tracking; version not on PDF; no snapshot |
| Payment before contract → compliance flag | ❌ impossible (sends unrecorded); payment auto-confirms with no contract check |
| Customer price clear: total before event, deposit separate | ◐ deposit separate ✅; no VAT shown, no "total to pay before event" / "potentially returnable" rows |

## Defect & improvement log

Severity: C=Critical, H=High, M=Medium, L=Low. All confidence High unless noted. Full evidence in the four discovery files.

| ID | Sev | Finding | Key evidence |
|---|---|---|---|
| FF-001 | C | Balance due = event − 7 days in app default AND DB trigger (trigger overwrites app fixes); contract, new-form help text and reminders promise/quote inconsistent dates. No final-details due date concept. | `mutations.ts:321-326`; trigger in `squashed.sql:35-47` + `20260629000000:14-21`; `contract-template.ts:466,468` |
| FF-002 | C | Automatic full deposit retention <30 days, enforced in code and asserted to customers in SMS, email and contract. Pack: "may retain up to", GM-reviewed. | `financial.ts:108-110,151,195-203`; `messages.ts:183`; `private-booking-emails.ts:413`; `contract-template.ts:466-467,514-515,525` |
| FF-003 | C | Waiver is a blanket release ("any and all claims… death") with no negligence carve-out; exclusive-jurisdiction claim; loose allergen names. Pack §§51-52 rewrites this entirely. | `contract-template.ts:629-630,644,665,673` |
| FF-004 | C | No conflict prevention: holds/confirmed bookings block nothing; no Entire-Pub/partial-space model; no setup/clear-down overlap checks; no GM conflict override. Spaces are just line items. | `mutations.ts:304-475`; RPC migration; grep zero hits |
| FF-005 | C | Contract governance: never sent by app; no contract_sent_at/sent_to/acceptance_method; no stored PDF snapshot (regenerated from live data); version not printed on PDF; deposit payment auto-confirms without contract check; booking portal shows no terms before payment. | `contract/route.ts:74-123`; `payments.ts:365-374`; `booking-portal/[token]/page.tsx` |
| FF-006 | C | Contract wording vs pack §§30-50: missing clauses (children/licensing §43, complaints §48, privacy §49, lawful-refusal/drugs part of §42, venue-cancellation part of §47, accessibility disclosure §44); £25 electricity + £20 staff-hour absent (§38); financial summary lacks Discounts/VAT/total-before-event/potentially-returnable (§31); liability cap at :589 without carve-outs; indemnities lack negligence carve-out (§46); Billy Summers signature block missing (§33); waiver never referenced (§39); "external drinks not permitted" missing (§37). | discovery-contract.md gap table |
| FF-007 | H | Hard delete: only SMS-history gate; no payment/contract/email checks; cancelled bookings (with payments+contracts) always deletable — contradicts §8 retention. | `privateBookingActions.ts:481-591,532-538`; `20260623000000` |
| FF-008 | H | Hold rules: cap at event − 7 (must not pass balance due date); extensions need no GM/no reason; no immediate-due rule for bookings inside 14 days. | `types.ts:73-96`; `mutations.ts:1466-1564`; `privateBookingActions.ts:1105-1146` |
| FF-009 | H | Reminder schedules: hold 7/1 only (no 3-day); balance reminders at 14/7/1 days before EVENT (7/1 chase past-due balance) instead of 21/16/15/14 before due; exact-day matching skips late-created bookings; missed deadline → keeps auto-chasing instead of GM review. | `private-booking-monitor/route.ts:513-740`; `scheduled-sms.ts:132-234` |
| FF-010 | H | Deposit controls: reduction below £250 without GM/reason; £0 deposit silently auto-confirms; no deduction workflow (evidence/discussion/GM approval/itemised explanation); no post-event 48h refund workflow. | `privateBookingActions.ts:2143-2224`; `payments.ts:842-880`; refundActions |
| FF-011 | H | Cancellation flow captures nothing: no written-evidence store, received date/time, channel, or approver; no no-show concept; no unpaid-balance GM-review-then-cancel path; contract doesn't list accepted written channels. | `mutations.ts:1176`; DC:632-668; `contract-template.ts:512` |
| FF-012 | H | GM override permission absent across the module — underpins FF-002/008/010/011 and conflict overrides. | `permissions.ts:4-20` |
| FF-013 | H | Capacity: guest count never compared to seated/standing capacity; no layout question; no 30-guest minimum with override reason. | `types.ts:141`; grep zero hits |
| FF-014 | H | VAT: zero handling anywhere; customer totals silent on VAT (pack §12/§31/§53.6). Packages/spaces have no vat_rate. | discovery-logic §15; schema |
| FF-015 | M | Waiver/package model: no requires_waiver / requires_allergy_capture / vat_rate / seasonal on catering_packages; detection by hardcoded UUID + name regex; no waiver_status or signed-tracking/blocker. | `contract-template.ts:24-39,165-181`; schema |
| FF-016 | M | §8 workflow flags missing: final_details_status, supplier_status, waiver_status, risk_status, event_sheet_status, post_event_status; deposit/balance status states incomplete (no waived/retained/disputed/overdue). | schema; discovery-logic §13 |
| FF-017 | M | Intake gaps vs §9: layout, adults/under-18s split, bar tab (entirely absent), outside-food flag, entertainment/high-power equipment, decorations, dogs, special-risk flags, clear-down window, communication preference, high-risk event-type triggers (§18). | discovery-ui §2 |
| FF-018 | M | Staff event sheet (§29): does not exist; no pre-event readiness checks/blockers. | grep zero hits |
| FF-019 | M | Supplier documents (§20/§28.18): no storage, approval status, or 14-day deadline chasing. | vendors page; schema |
| FF-020 | M | Sensitive data: allergy/dietary/accessibility notes are free-text visible to anyone with `view`; no privacy-restricted access (§5/§22/§27.4). | DC:2432-2442 |
| FF-021 | M | Date change: no written-request capture; no old/new-date audit (updateBooking logs no field diffs); confirmed bookings get no date-change notification. | `mutations.ts:482-1051,763-810` |
| FF-022 | M | Audit model: `private_booking_audit`/`audit_logs` lack customer_notified + attachment_id; reason only enforced for discounts/refunds; payments service functions rely wholly on wrappers. | schema; discovery-logic §11 |
| FF-023 | M | Cancellation confirmation is SMS-only (no email); 3 refund/balance email functions are dead code (unexported, zero callers). | `private-booking-emails.ts:451,519,581` |
| FF-024 | M | Retention (§27): no private-booking retention schedule (7yr/18mo), no dispute record-locking beyond has_open_dispute flag, no allergy/accessibility anonymisation. GDPR plumbing exists app-wide. | `gdpr.ts`; crons |
| FF-025 | M | Complaints (§26): no module, no wording anywhere, no 3-day/10-day tracking. | grep zero hits |
| FF-026 | L | Business details inconsistent: VAT number grouping differs across footer/page4/route; phone spacing; privacy URL absent; "The Anchor" vs "The Anchor Pub"; `companyDetails` param accepted but ignored by generator. | `contract-template.ts:42,207-209,597`; `route.ts:57-64` |
| FF-027 | L | expire-holds runs daily 06:00 → hold can sit ~24h past expiry; release confirmation SMS-only. | cron route |
| FF-028 | L | Spaces settings UI missing minimum_hours (type exists), setup fee, display order; PaymentModal lacks bank-transfer method; edit page has no page-level permission check (action-level only). | discovery-ui §4,§6,§9 |
| FF-029 | L | Cancellation SMS promises refunds "within 10 working days" — pack sets no cancellation SLA (48h is post-event refunds only). Owner to confirm intended commitment. | `messages.ts:162,173` |

Compliant bright spots worth keeping: £250 default deposit; deposit strictly separate from balance (view + RPC maths, floored at zero); 5% admin deduction correctly computed from deposit only; 14-day hold default with cleared-funds language; hold expiry auto-release with customer SMS + audit; refund engine (permission-gated, balance-capped, idempotent, audited); comprehensive email/SMS logging with fail-loud `requireLog`; versioned document storage table already exists; both seated and standing capacities already in schema; licensing-hours table in contract matches the licence exactly; no "credit card hold" legacy language anywhere.

## Proposed plan of action (4 phases, each independently deployable)

### Phase 1 — Money, dates & wording (the compliance core)
The pack's §53 critical fixes that change what customers are told and charged.
1. **14-day due date** (FF-001): migration to change `calculate_balance_due_date` trigger to −14 days (with function audit per supabase rules), update app default, column comment, reminder view; treat `balance_due_date` as the combined "balance & final details" deadline everywhere (UI labels, contract, SMS). Backfill decision below (D1).
2. **Cancellation policy engine** (FF-002 part): <30 days → outcome "GM review required" with retention up to full deposit chosen by manager (new decision step + reason), not automatic; ≥30-day path unchanged; update SMS/email templates to pack wording; no-show and unpaid-balance-after-review paths added.
3. **Contract + waiver rewrite** (FF-003/006/026): implement pack §§30–52 wording in `contract-template.ts` — all replacement clauses, financial summary per §31 (incl. VAT line, total-before-event, potentially-returnable), Billy Summers signature block, privacy + complaints clauses, children/licensing, lawful refusal, accessibility disclosure, £25/£20 charges, waiver renamed "responsibility agreement" with negligence carve-outs and the 14 regulated allergen names; fix business-detail inconsistencies; wire up the ignored `companyDetails` param.
4. **Hold rules** (FF-008): cap holds at the 14-day due date; bookings created inside 14 days → deposit/balance/details due immediately with GM-approval override; hold extension requires reason (GM permission arrives Phase 3 — interim: require reason + audit).
5. **Hard-delete guard** (FF-007): extend eligibility + DB trigger to block deletion when any payment exists, any contract was generated, or any customer email sent; remove the cancelled-bookings bypass.
6. **Deposit reduction guard** (FF-010 part): reductions below £250 require a reason (audited); stop £0 deposits silently auto-confirming (explicit "GM approved no-deposit" flag instead).

### Phase 2 — Contract governance & communications
7. **Contract lifecycle** (FF-005): store PDF snapshot in `private_booking_documents` on every generation; print version on the PDF; add `contract_sent_at`/`sent_to`/`acceptance_method` columns; new "Send contract" action (email with PDF + terms); booking portal shows terms before payment; deposit payment flags a compliance warning if no contract was sent first.
8. **Reminder schedules** (FF-009): add 3-day hold reminder; move balance/final-details reminders to 21/16/15/14 days before the due date with window-based catch-up for late-created bookings; after a missed deadline, stop auto-chasing and surface a GM-review task (weekly digest + dashboard).
9. **Comms completeness** (FF-023/027/029): cancellation confirmation email alongside SMS; delete or wire the dead email functions; privacy-notice link + complaints line in customer emails; agreed refund-SLA wording (D3).

### Phase 3 — Workflow model & controls
10. **GM override framework** (FF-012): new `gm_override` permission; reason-required flows for deposit reductions, retention decisions, hold extensions, sub-30-guest bookings, conflict overrides, delete exceptions; all audited (extend audit with `customer_notified`, `attachment_id` — FF-022).
11. **Package flags & waiver status** (FF-015): migration adding `requires_waiver`, `requires_allergy_capture`, `vat_rate`, `seasonal` (+ self-catering category); settings UI; waiver detection flag-first/name-fallback; `waiver_status` tracking (required/sent/signed/overdue) with signed-upload and a pre-event blocker.
12. **Workflow flags & statuses** (FF-016): add final_details_status, supplier_status, risk_status, post_event_status + richer deposit/balance states; surfaced on detail page and list badges.
13. **Intake & risk capture** (FF-017): layout (seated/standing/mixed), adults/under-18s split, bar tab (limit, pre-pay/pre-auth, approver), outside-food flag, entertainment + high-power equipment (auto-adds £25 line + approval flag), decorations, dogs, special-risk/high-risk event-type triggers (§18), clear-down window.
14. **Deduction & post-event workflow** (FF-010 rest): 48h post-event inspection task; deduction records with evidence attachments, customer-discussion note, GM approval, itemised explanation email; refund processed from the same flow.
15. **Cancellation & date-change capture** (FF-011/021): cancellation form records channel, received date/time, evidence upload, processor; date-change flow records request, old/new dates, reason, approver, and notifies confirmed customers; field-level audit diffs in `updateBooking`.
16. **Sensitive-data restriction** (FF-020): allergy/dietary/accessibility behind a `view_sensitive` permission; event-day surfaces show minimum necessary.

### Phase 4 — Structural builds
17. **Conflict prevention & capacity** (FF-004/013): structured space-booking model (booking↔space↔time incl. setup/clear-down); holds and confirmed bookings block; Entire Pub blocks all spaces and vice-versa; overlap warnings; confirmation blocked on conflict or over-capacity; 30-guest minimum with GM override; capacity compared against the chosen layout.
18. **Supplier documents** (FF-019): document storage per booking-supplier, approval status, 14-day deadline chasing, event-sheet integration.
19. **Staff event sheet** (FF-018): generated document per §29 checklist with readiness blockers (waiver unsigned, docs missing, balance unpaid), lockable.
20. **Retention & complaints** (FF-024/025): retention schedule fields + dispute record-locking; minimal complaints log (booking-linked, status + 3/10-day dates). Automated deletion/anonymisation deferred to its own approved piece (destructive).

### Adjacent areas flagged (outside /private-bookings — separate decisions)
- **Table bookings**: same absolute-retention framing in customer SMS (`table-bookings/bookings.ts:1326-1327`).
- **Events module**: free-text per-category cancellation policies in DB may carry "non-refundable" wording.
- **Invoices/quotes/OJ Projects**: ex-VAT displays are B2B-appropriate but should show VAT + total payable before acceptance (§12.3).
- **GDPR/retention app-wide**: no booking retention schedule or record locking.
- **the-anchor.pub website (separate repo)**: private-events marketing pages + privacy/terms pages should be checked against the pack once AMS links to them.

### Decisions needed before implementation (with recommendations)
- **D1 — Backfill existing bookings to the 14-day date?** Recommend: yes for future, non-completed/cancelled bookings whose current date equals event − 7 (i.e. auto-set), leaving staff-set dates alone; list affected bookings for review first.
- **D2 — VAT display**: are stored package/space prices VAT-inclusive gross? Recommend: treat as gross and show "includes VAT where applicable" line per §31 now; confirm with accountant (§54.1) before any net/VAT split work.
- **D3 — Cancellation-refund SLA wording**: SMS currently promises "within 10 working days". Recommend: keep 10 working days (pack is silent; 48h applies only to post-event deposit refunds).
- **D4 — Complaints log scope**: recommend the minimal booking-linked log in Phase 4 rather than a full module.
- **D5 — Solicitor sequencing**: pack wording is itself draft-for-solicitor. Recommend: implement pack wording now (strictly safer than current wording), re-issue after solicitor feedback as a version bump.
- **D6 — Phase 4 appetite**: conflict/capacity engine requires a new structured space-booking data model — the largest single piece. Recommend: commit to it (it's the pack's headline operational protection) but as its own release.
