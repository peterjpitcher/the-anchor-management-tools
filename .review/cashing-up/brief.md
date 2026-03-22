# Cashing-Up Section — Review Brief

## Target Section
`/cashing-up` — Daily cash reconciliation and reporting module.

## File Inventory (Critical Path)
- `src/services/cashing-up.service.ts` (714 lines) — All business logic
- `src/app/actions/cashing-up.ts` (255 lines) — Server actions (main CRUD)
- `src/app/actions/cashing-up-import.ts` (151 lines) — Historical import server action
- `src/app/actions/missing-cashups.ts` (54 lines) — Missing date detection
- `src/components/features/cashing-up/DailyCashupForm.tsx` (809 lines) — Primary UI form
- `src/app/(authenticated)/cashing-up/daily/page.tsx` (79 lines) — Daily entry page
- `src/app/(authenticated)/cashing-up/weekly/page.tsx` (101 lines) — Weekly breakdown page
- `src/app/(authenticated)/cashing-up/dashboard/page.tsx` (250 lines) — Dashboard page
- `src/app/(authenticated)/cashing-up/insights/page.tsx` (111 lines) — Insights page
- `src/app/(authenticated)/cashing-up/import/page.tsx` (348 lines) — Import page
- `src/app/api/cashup/weekly/print/route.ts` (78 lines) — PDF generation API
- `src/types/cashing-up.ts` (130 lines) — Type definitions

## Supporting Files
- `src/components/features/cashing-up/WeeklyTargetsModal.tsx` (113 lines)
- `src/components/features/cashing-up/InsightsYearFilter.tsx` (54 lines)
- `src/lib/cashing-up-pdf-template.ts` (284 lines)
- `supabase/migrations/20260402000000_create_cashup_targets.sql`

## DB Tables
- `cashup_sessions` — Primary session record (one per site per day)
- `cashup_payment_breakdowns` — Per-type breakdown (CASH, CARD, STRIPE)
- `cashup_cash_counts` — Denomination-level cash breakdown
- `cashup_targets` — Daily revenue targets by day-of-week with effective date
- `cashup_weekly_view` — DB view joining sessions

## Status Machine
`draft` → `submitted` → `approved` → `locked`
Unlock: `locked` → `approved`

## Business Rules (as understood)
1. One cashup session per site per date
2. Session tracks: cash expected (Z-read), cash counted (denomination breakdown), card total, Stripe total
3. Variance = counted - expected (cash only); shown to user
4. Sessions flow through draft → submitted → approved → locked
5. Only draft sessions can be submitted; only submitted can be approved
6. Locked sessions prevent editing; can be unlocked back to approved
7. Revenue targets are set per day-of-week with an effective date (latest effective_from wins)
8. Missing cashup dates = open business days with no session (up to 365 days back)
9. Historical import creates sessions as 'approved' status

## Known Issues (Pre-spotted during Recon — Investigate These)
1. `setDailyTargetAction` checks permission for `'receipts', 'edit'` — wrong module
2. `getInsightsDataAction` — no permission check at all
3. `updateWeeklyTargetsAction` — no permission check at all
4. `getDailyTargetAction` — no permission check at all
5. `getWeeklyProgressAction` — no permission check at all
6. `lockSession()` in service — no status guard (can lock from any status)
7. `getDashboardData()` has hardcoded `expectedDays: 28` mock value
8. `getDashboardData()` returns empty arrays for `paymentMix`, `topSitesByVariance`, `compliance`
9. `getDashboardData()` returns `siteName: 'Site'` placeholder (no join)
10. `upsertSession()` delete-then-insert child records — partial failure risk
11. `onSubmitClick` in DailyCashupForm — save succeeds but submit could fail
12. `getMissingCashupDatesAction()` — N+1: calls `BusinessHoursService.isSiteOpen()` in a loop
13. `setDailyTarget()` uses INSERT with unique constraint — will error on duplicate
14. No audit logging anywhere in the module
15. Hardcoded email check `'billy@orangejelly.co.uk'` in daily page (easter egg — note but don't report as defect)
16. Date handling uses raw `new Date()` not London timezone utilities
17. `cashup_targets` migration has no UPDATE RLS policy
18. Weekly page has no permission check — fetches data without auth guard
19. `console.log` in production code (daily page line 62)
20. Import: `new Date(row.date)` may parse YYYY-MM-DD as UTC (timezone issue)

## Multi-Step Operations Requiring Failure-Path Analysis
1. **upsertSession**: insert/update session → delete breakdowns → delete cash counts → insert breakdowns → insert cash counts (5 steps, partial failure possible)
2. **onSubmitClick (UI)**: save draft → submit → navigate (if submit fails after save, session stuck in draft)
3. **importCashupHistoryAction**: loops over rows calling upsertSession — sequential, no rollback if some fail
4. **PDF generation**: auth → permission check → fetch site → fetch data → generate HTML → generate PDF
