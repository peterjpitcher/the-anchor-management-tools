# Phase 2 — Implementation Changes Log

## Summary

All 24 confirmed defects from the consolidated defect log were addressed. Changes span 8 files and 1 new migration.

---

## Files Modified

### `src/app/actions/cashing-up.ts`

- **DEF-C01**: Changed `setDailyTargetAction` permission check from `checkUserPermission('receipts', 'edit')` to `PermissionService.checkUserPermission('cashing_up', 'edit', user.id)` — was checking the wrong module entirely.
- **DEF-C02**: Added `cashing_up/view` permission check to `getInsightsDataAction` (previously unchecked).
- **DEF-C03**: Added `cashing_up/edit` permission check to `updateWeeklyTargetsAction` (previously unchecked).
- **DEF-H01**: Added `cashing_up/view` permission check to `getDailyTargetAction` (previously unchecked).
- **DEF-H02**: Added `cashing_up/view` permission check to `getWeeklyProgressAction` (previously unchecked).
- **DEF-H07**: Added `void logAuditEvent(...)` to all 7 mutation actions: `upsertSessionAction`, `submitSessionAction`, `approveSessionAction`, `lockSessionAction`, `unlockSessionAction`, `setDailyTargetAction`, `updateWeeklyTargetsAction`. Module had zero audit log calls before this.
- **DEF-M05**: Verified all actions return `{ success: boolean; data?: T; error?: string }` — shapes were already consistent, no changes needed.

### `src/services/cashing-up.service.ts`

- **DEF-C04**: Added `.eq('status', 'approved')` constraint to `lockSession` — previously any session could be locked regardless of status. Error message updated to `'Session not found or not in approved status'`.
- **DEF-C05**: Added compensating restore to `upsertSession` child-replace strategy. Now fetches `existingBreakdowns` and `existingCounts` before deleting. On breakdown insert failure, restores both breakdowns and counts in parallel. On counts insert failure, restores counts.
- **DEF-C06**: Added locked-session guard to `upsertSession` update path. Fetches current status and throws `'Cannot modify a locked session'` before proceeding.
- **DEF-H06**: Changed `setDailyTarget` from `.insert()` to `.upsert(..., { onConflict: 'site_id, day_of_week, effective_from' })` — INSERT was causing duplicate key violation if called twice for same date/site.
- **DEF-M02**: Replaced all `toISOString().split('T')[0]` date formatting with `format(d, 'yyyy-MM-dd')` from date-fns. All `new Date(dateString)` calls for date arithmetic now use `'T12:00:00'` suffix to pin to local noon and avoid UTC boundary shift. Added `format` to the existing `date-fns` import.
- **DEF-S01**: `expectedDays: 28 // Mock` replaced with computed value from `fromDate`/`toDate` range (calendar day count), or falls back to `sessions.length`.
- **DEF-S02**: `siteName: 'Site'` stub replaced by fetching `supabase.from('sites').select('id, name')` in parallel with sessions/targets, building a `siteMap`, and resolving names from it.
- **DEF-S03**: `paymentMix: []` stub replaced with in-memory aggregation from the already-fetched `cashup_payment_breakdowns` nested in sessions. Returns `{ paymentTypeCode, amount }[]` matching the type definition.
- **DEF-S04**: `topSitesByVariance: []` stub replaced with in-memory aggregation of net variance per site, sorted by absolute magnitude, top 5. Returns `{ siteId, siteName, totalVariance }[]`.
- **DEF-S05**: `compliance: []` stub replaced with per-site grouping of sessions counting `submittedDays` (submitted|approved|locked) and `approvedDays` (approved|locked). Returns `{ siteId, siteName, expectedDays, submittedDays, approvedDays }[]`.

### `src/app/actions/missing-cashups.ts`

- **DEF-H04**: Eliminated N+1 query pattern. Previously called `BusinessHoursService.isSiteOpen()` once per date (up to 728 DB queries for a 365-day range). Replaced with a single `Promise.all` fetching all `special_hours` and `business_hours` rows for the range, building in-memory Maps, then filtering all dates locally. Total DB queries: 3 (sessions, special_hours, business_hours). `BusinessHoursService` import removed.

### `src/app/actions/cashing-up-import.ts`

- **DEF-M01**: Fixed UTC date shift in import date parsing. Replaced `new Date(row.date).toISOString().split('T')[0]` with a timezone-safe IIFE that: (a) accepts YYYY-MM-DD strings directly (validated with T12:00:00), (b) reconstructs other formats from local date parts (`getFullYear()`, `getMonth()`, `getDate()`).

### `src/app/(authenticated)/cashing-up/weekly/page.tsx`

- **DEF-H03**: Added `checkUserPermission('cashing_up', 'view')` at the top of the page component with `redirect('/unauthorized')` on failure — page was previously accessible to all authenticated users.
- **UTC fix**: Changed `monday.toISOString().split('T')[0]` to local date part construction for the default week string.

### `src/components/features/cashing-up/DailyCashupForm.tsx`

- **DEF-M04**: Changed label from `"Total Variance"` to `"Cash Variance"` at the summary row. The label was misleading as it represents the cash-specific discrepancy (counted vs expected), not total takings.

### `src/app/(authenticated)/cashing-up/daily/page.tsx`

- **DEF-H08**: Removed `console.log('Server Page: Fetched session data: ...')` debug statement.
- **UTC fix**: Changed `new Date().toISOString().split('T')[0]` default date to local date part construction.

---

## New Files

### `supabase/migrations/20260308100000_add_cashup_targets_update_rls.sql`

- **DEF-H05**: Created new migration adding UPDATE and DELETE RLS policies to `cashup_targets`. Previously only SELECT and INSERT policies existed, causing `setWeeklyTargets` to fail silently on the UPDATE path of its UPSERT.

---

## Verification

- `npx tsc --noEmit` — clean (zero errors)
- `npm run lint` — clean (zero warnings)
- Phase 3 validation — GO for all 24 defects
