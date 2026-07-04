# Whole-App End-to-End Review — 2026-07-04

Mode: fix-function **Read-only Diagnosis** (no code changed). Base commit: `76655f69`.
Full per-area evidence in `agent-reports/` (6 reports). Plan in `plan.md`.

## Executive summary

The app is in far better shape than its history suggests. Re-verifying the June 2026 whole-app reports against today's code shows **all 37 critical/high correctness/security findings fixed** and **27 of 28 UI/UX highs fixed** — a deliberate remediation batch (the `20260708*` migrations) plus feature work closed nearly everything. What remains falls into four buckets:

1. **New money/booking-correctness bugs in recently shipped features** (events ticket types, refunds, transfers; FOH walk-ins on communal days) — 1 Critical, 4 High.
2. **Staff-vs-website feature lag** — the user-reported gaps: staff can't name new customers, can't pick ticket types, can't enter attendee names (EV-04 = FF-001/002).
3. **Owner UX requests** — dashboard starts halfway down on mobile (root-caused), short-links unusable on mobile (root-caused), remove skeletons everywhere (inventoried).
4. **Chronic pattern debt + CRUD gaps** — loading/error states, hand-rolled modals, raw dates, ~10 missing correction paths (void cash-up, manual receipt transaction, etc.).

## Ranked open findings

### CRITICAL
| ID | Finding | Where |
|---|---|---|
| TP-01 | FOH walk-in/override allocator ignores communal-event tables → DB trigger rejects → **orphaned confirmed booking + 500** on match days | `api/foh/bookings/route.ts:178-430,515` |

### HIGH
| ID | Finding | Where |
|---|---|---|
| EV-01 | Manager's refund decision silently lost if cancel follow-ups fail (no refund, no SMS, no audit; retry can't recover) | `actions/events.ts:1488-1656` |
| EV-02 | Staff "Cash/Card paid" records wrong amount for multi-ticket bookings + applies online discount at the door | `actions/events.ts:1956-1959` |
| EV-03 | Staff seat edits desync multi-type bookings (stale line items/charges/attendee names); prepaid bookings resize with no money movement | `actions/events.ts:1115-1337`, seats RPC |
| EV-04 | Manual booking form: no name fields for new customers; no real ticket-type/attendee-name entry (user-reported FF-001/002) | `EventDetailClient.tsx:1060-1094` |
| TP-02 | Conflict classifiers (3 copies) don't recognise the communal trigger error → raw 500s | `move-table.ts:37`, 2 more |
| FB-01 | Feedback form: contact details silently discarded without consent tick, but thanks page promises "we'll be in touch" | `api/feedback/route.ts:59`, `thanks/page.tsx:13` |
| SL-01/02 | Short-links table collapses/overlaps on mobile; actions off-screen; no card fallback (owner-reported) | `ShortLinksClient.tsx:319-420` |
| DB-01 | Dashboard mobile renders 90 days of past entries above Today then auto-scrolls the page down (owner-reported) | `ScheduleCalendarList.tsx:21-53` |

### MEDIUM (grouped)
- **Events money/reporting:** EV-05 refunds double-counted in "Paid"; EV-06 transfer drops ticket types/names + mislabels "Comp"; EV-07 transfer non-transactional; EV-08 per-type sell-out → public 500; EV-09 kiosk walk-ins bypass capacity/payment; EV-10 no audit on seat updates; EV-11 no after-the-fact refund path; EV-12 "Est. Revenue" hardcoded £25/seat; EV-13 transfer to cheaper event keeps customer's overpayment.
- **Table bookings:** TP-03 multi-table move non-atomic; TP-04 grow flow moves table before size (no compensation); TP-08 **contract prints "£250 deposit due" when none set** (customer-facing); TP-13 Tabology webhook limbo (500 + log row per delivery if still registered).
- **Feedback funnel:** FB-02 funnel killable via unguarded short-link/settings row; FB-03 rate limit only real if Upstash env set (verify in Vercel); FB-04 inbox capped at 200, no filters/pagination.
- **Short-links:** SL-03 Edit/Delete buried under ~40 channel entries; SL-04 UTM params can never be removed; SL-05 URL validation bypassed (submit outside form); SL-06 tap targets ~21px.
- **Dashboard mobile:** DB-03 upcoming-events rows overflow 375px viewport.

### LOW (grouped)
- Events: EV-14 capacity stats vs holds/expired; EV-15 transfer dropdown offers past events; EV-16 reconciliation cron silently skips broken refunds; EV-17 seat clamp/comp-confirm/dialog-loading/no name-or-type edit; EV-18 flag-off regression risk.
- Table/PB/cashup: TP-05 party-size TOCTOU misreport; TP-06 dedup guard silent catch; TP-07 N+1 RPC fan-out; TP-09 waiver name-fallback narrow; TP-10 parking relink name sync; TP-11 contract version race; TP-14 webhook dead machinery.
- Feedback: FB-05 middleware prefix over-match; FB-06/07 handled_at semantics + phantom-update success + unbounded notes; FB-08 fire-and-forget manager email + stale .env doc; FB-09 no funnel KPIs/provenance; FB-10 IP/UA retention; FB-11 review-gating policy risk (business decision); FB-12 nits.
- Short-links: SL-07 clicks charted as £; SL-08 legacy-domain tables on mobile; SL-09 no search loading state + redundant refetch; SL-10 menu detaches on scroll; SL-11 silent create + raw dates.
- Dashboard: DB-04 sticky headers under chrome; DB-05 media-query flash; DB-06 dead overflow classes.
- June residuals: `saveOnboardingSection` writes NI/bank/health PII with **no audit logging**; `getCustomerList` missing RBAC check (RLS backstopped); ~10 raw `setHours(0,…)` display-path date usages; expenses form bypasses @/ds entirely; `window.confirm` in `SquareImageUpload.tsx:110`, `SmsQueueActionForm.tsx:70`; dead `calculateRefundTier` in `lib/table-bookings/refunds.ts`.

## Owner requests (this session)

- **FF-003 — Remove skeleton loading screens everywhere.** Inventory: `src/ds/primitives/Skeleton.tsx` (+ index export + `DataTable.tsx` usage); 10 route `loading.tsx` files (customers, dashboard, employees, events, events/[id], invoices, private-bookings, rota, table-bookings, portal/shifts); in-component pulses in `CustomersClient`, `MessagesClient`, `PrivateBookingDetailClient`, `ProfileClient`, `settings/design-system`. Recommendation: one shared minimal centred-spinner `loading.tsx` treatment; strip in-component skeletons; delete the primitive last so it can't creep back.
- **FF-004 — Hide past events on dashboard (mobile).** Root cause = DB-01; fix is a 2-file, mobile-only `hidePast` prop (desktop month grid untouched).
- **FF-005 — Short-links unusable on mobile.** Root causes = SL-01/02 (+ SL-03..06 usability, SL-04/05 are genuine form bugs on any device).

## Chronic pattern debt (from June re-verification, still true)
1. Only 8-10 route-level loading states; 1 error boundary app-wide.
2. No inline field-level validation (7 `aria-invalid` app-wide); no unsaved-changes guards outside menu-management.
3. 11 files with hand-rolled `fixed inset-0` modals (6 rota + timeclock + expenses + recruitment).
4. ~90 raw `toLocaleDateString`/`toISOString` in authenticated pages (display-level).
5. DataTable mobile cards mouse-only (`<div onClick>`, no keyboard).
6. Fragmented shells/toasts (PageLayout 74 vs PageHeader 30; 54 raw `react-hot-toast` imports); 22 hardcoded colour hits inside `src/ds`.

## Top CRUD gaps still open
1. Cash-up: no void/delete for mis-entries (financial records permanent).
2. Employee attachments: can't edit category/description (delete + re-upload).
3. Recruitment email templates: edit-only (no create/delete).
4. Messages: no resend-failed/archive in conversation view.
5. Menu/menu categories: seed-only, no management UI.
6. Timeclock kiosk: no on-kiosk mis-clock undo.
7. Receipts: no manual transaction create/delete (CSV-only).
8. Expenses: category still free-text `company_ref`.
9. Staff portal: no payslip entity.
10. Rota sales-target override: no removal path.

## Verified healthy (fresh reviews)
No legacy "credit card hold" language anywhere; refund permission gates correct; webhook signature+idempotency strong (PayPal events, Resend, Twilio); public booking API idempotency fail-closed; feedback funnel RLS deny-all + consent double-enforcement; cash-up manual flow atomic + audited; contract null-safety and escaping sound; June's dead-duplicate-client problem eliminated.

## Prod verification notes (not code)
- DB-level June fixes verified in repo migrations only — confirm `20260708*` series applied to prod (Supabase MCP migration history).
- FB-03: confirm `UPSTASH_REDIS_REST_URL/TOKEN` set in Vercel prod.
- TP-13: decide Tabology webhook fate (unregister vs set `TABOLOGY_WEBHOOK_SECRET`).
