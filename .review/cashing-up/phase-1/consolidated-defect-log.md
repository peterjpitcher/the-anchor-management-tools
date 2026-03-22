# Phase 1 — Consolidated Defect Log

> Produced by orchestrator after cross-referencing all four agent reports.
> False positives investigated and removed before inclusion.

## False Positives Investigated and Rejected
- **QA DEF-006** (unlockSession clears approved_by_user_id): INCORRECT — line 320 update does NOT include approved_by_user_id, so it is preserved. No defect.
- **QA DEF-013/DEF-014** (getDailyTarget ignores effective_from): INCORRECT — line 485 clearly has `.lte('effective_from', date)` filter. The agent missed it. No defect.
- **QA DEF-022** (Sunday week-start calculation wrong): INCORRECT — for Sunday (day=0), formula gives `date - 0 + (-6) = date - 6` which correctly lands on Monday. Agent arithmetic error. No defect.

---

## Master Defect Log

### CRITICAL — Actively Harming Business Now

**DEF-C01** | Wrong permission module on `setDailyTargetAction`
- Summary: Checks `checkUserPermission('receipts', 'edit')` instead of `cashing_up`
- Impact: Users with receipts/edit permission can modify cashing-up targets; users WITH cashing_up permission but NOT receipts/edit are incorrectly blocked
- Root cause: Wrong string passed to checkUserPermission
- Agents: Structural Mapper, Business Rules Auditor (POLICY-001), QA Specialist (DEF-010)
- File: `src/app/actions/cashing-up.ts:213`

**DEF-C02** | No permission check on `getInsightsDataAction`
- Summary: Auth checked but no `checkUserPermission('cashing_up', 'view')` call
- Impact: Any authenticated user can view business analytics regardless of role
- Root cause: Permission check omitted
- Agents: Business Rules Auditor (POLICY-002), QA Specialist (DEF-007)
- File: `src/app/actions/cashing-up.ts:167-193`

**DEF-C03** | No permission check on `updateWeeklyTargetsAction`
- Summary: Auth checked but no permission check; any user can modify revenue targets
- Impact: Non-managers can corrupt revenue targets
- Root cause: Permission check omitted
- Agents: Business Rules Auditor (POLICY-004), QA Specialist (DEF-008)
- File: `src/app/actions/cashing-up.ts:225-242`

**DEF-C04** | `lockSession()` has no status guard — can lock from any state
- Summary: No `.eq('status', 'approved')` guard; draft and submitted sessions can be locked directly
- Impact: Workflow bypassed — sessions can skip submission and approval; no approver recorded; audit trail broken
- Root cause: Guard clause missing from update query
- Agents: Business Rules Auditor (POLICY-007), Technical Architect, QA Specialist (DEF-004/005)
- File: `src/services/cashing-up.service.ts:304-315`

**DEF-C05** | `upsertSession` has no DB transaction — partial failure leaves orphaned records
- Summary: 5-step operation (session upsert → delete breakdowns → delete counts → insert breakdowns → insert counts) is not wrapped in a transaction. If any step 3-5 fails after previous steps committed, session exists with missing or partial child records.
- Impact: Data corruption — session appears saved but has no breakdown or denomination data; dashboard shows zeros; form cannot reconstruct values on reload
- Root cause: Supabase JS client does not natively support transactions; requires a DB function (RPC) or careful error-recovery rollback
- Agents: Technical Architect (TECH-001), QA Specialist (DEF-001/002/003)
- File: `src/services/cashing-up.service.ts:160-263`

**DEF-C06** | No server-side guard preventing edits to locked/approved sessions
- Summary: `upsertSessionAction` does not check session status before overwriting. Form has client-side "Edit Anyway" warning, but server accepts saves regardless.
- Impact: Any user with cashing_up/edit permission can silently overwrite approved or locked sessions
- Root cause: `upsertSession` has no status guard on the update path
- Agents: Business Rules Auditor (POLICY-018), QA cross-reference
- File: `src/services/cashing-up.service.ts:208-219` (update path, no status check)

---

### HIGH — Structural: Will Break Under Edge Cases

**DEF-H01** | No permission check on `getDailyTargetAction`
- Summary: Auth checked, no RBAC check; target data readable by any authenticated user
- Root cause: Permission check omitted
- Agents: Business Rules Auditor (POLICY-003), QA Specialist (DEF-009)
- File: `src/app/actions/cashing-up.ts:195-206`

**DEF-H02** | No permission check on `getWeeklyProgressAction`
- Summary: Auth checked, no RBAC check; weekly progress readable by any authenticated user
- Root cause: Permission check omitted
- Agents: Business Rules Auditor (POLICY-005), QA Specialist (DEF-011)
- File: `src/app/actions/cashing-up.ts:244-255`

**DEF-H03** | `/cashing-up/weekly` page has no permission check
- Summary: Weekly page fetches and renders data without `checkUserPermission`. Only auth enforced via layout.
- Root cause: Permission check omitted from page
- Agents: Business Rules Auditor (POLICY-006), QA Specialist (DEF-012)
- File: `src/app/(authenticated)/cashing-up/weekly/page.tsx:1-27`

**DEF-H04** | N+1 query: `getMissingCashupDatesAction` calls `isSiteOpen()` in a loop
- Summary: For each date in a 365-day range, calls `BusinessHoursService.isSiteOpen()` which makes 2 DB calls per date. Worst case: 730 DB calls for one load.
- Impact: Severe page load hang (2-5s+) on daily entry form; worsens with history depth
- Root cause: Sequential await in loop; should batch query business_hours and special_hours once
- Agents: Technical Architect (TECH-005), QA Specialist (DEF-016)
- File: `src/app/actions/missing-cashups.ts:34-45`

**DEF-H05** | `cashup_targets` RLS policy missing UPDATE — `setWeeklyTargets` upsert fails on update path
- Summary: Migration creates INSERT policy only. `setWeeklyTargets` uses `upsert(..., { onConflict: ... })`. On a conflict (updating existing day target), Supabase executes an UPDATE which fails RLS.
- Impact: Setting weekly defaults from the modal fails silently for existing entries
- Root cause: Missing UPDATE policy in `20260402000000_create_cashup_targets.sql`
- Agents: Technical Architect (TECH-014)
- File: `supabase/migrations/20260402000000_create_cashup_targets.sql:18-26`

**DEF-H06** | `setDailyTarget` uses INSERT not UPSERT — fails with unique constraint on repeat call
- Summary: User cannot update a target for a day they already set a target for on the same effective_from date. Second call throws a unique constraint violation.
- Impact: Target edit is unusable once initially set; only `setWeeklyTargets` (which uses upsert) works correctly
- Root cause: Should use `.upsert(..., { onConflict: 'site_id, day_of_week, effective_from' })` like setWeeklyTargets
- Agents: Technical Architect (TECH-004, TECH-015)
- File: `src/services/cashing-up.service.ts:498-513`

**DEF-H07** | No audit logging anywhere in cashing-up module
- Summary: Zero `logAuditEvent()` calls across all 13 server actions including upsert, submit, approve, lock, unlock. Project CLAUDE.md requires audit logs on all mutations.
- Impact: No traceability for who changed status, who modified a session, who locked it
- Root cause: Audit logging not implemented
- Agents: Structural Mapper, Business Rules Auditor (POLICY-017)
- File: `src/app/actions/cashing-up.ts` (all actions)

**DEF-H08** | `console.log` of session data in production server component
- Summary: Line 62 logs `{ id, status }` of the fetched session to server console on every page load
- Impact: Noise in production logs; exposes record-level data; violates Definition of Done
- Root cause: Debug log not removed
- Agents: Technical Architect (TECH-020)
- File: `src/app/(authenticated)/cashing-up/daily/page.tsx:62`

---

### STRUCTURAL — Unimplemented Features Shipped as Stubs

**DEF-S01** | Dashboard `paymentMix` always returns empty array
- Summary: `getDashboardData` line 453 hardcodes `paymentMix: []` with comment "Requires joining breakdowns"
- Impact: Payment method breakdown chart never renders; core KPI missing
- Agents: Technical Architect (TECH-016), QA Specialist (DEF-017)
- File: `src/services/cashing-up.service.ts:453`

**DEF-S02** | Dashboard `topSitesByVariance` always returns empty array
- Summary: Hardcoded `topSitesByVariance: []`; no implementation
- Impact: Site variance ranking chart never renders
- Agents: Technical Architect (TECH-016), QA Specialist (DEF-018)
- File: `src/services/cashing-up.service.ts:454`

**DEF-S03** | Dashboard `compliance` table always returns empty array
- Summary: Hardcoded `compliance: []`; no implementation
- Impact: Submission/approval compliance tracking never shows
- Agents: Technical Architect (TECH-017), QA Specialist (DEF-019)
- File: `src/services/cashing-up.service.ts:472`

**DEF-S04** | Dashboard `expectedDays` KPI hardcoded to 28
- Summary: `expectedDays: 28` hardcoded with comment "Mock"; not calculated from actual date range or business open days
- Impact: Dashboard KPI always shows 28 regardless of date range selected
- Agents: Technical Architect (TECH-018), QA Specialist (DEF-020)
- File: `src/services/cashing-up.service.ts:447`

**DEF-S05** | Dashboard `siteName` hardcoded to string `'Site'`
- Summary: Variance table rows all show "Site" instead of fetching site name
- Impact: Multi-site setups cannot distinguish sessions by site in the dashboard table
- Agents: Technical Architect (TECH-019), QA Specialist (DEF-021)
- File: `src/services/cashing-up.service.ts:459`

---

### MEDIUM — Data Quality and UX Issues

**DEF-M01** | Date parsing in import: `new Date(row.date)` treats YYYY-MM-DD as UTC
- Summary: JavaScript `Date` constructor parses ISO date strings as UTC. `new Date('2026-03-08')` → UTC midnight → 2026-03-07 23:00 London time in winter. `.toISOString().split('T')[0]` then yields the wrong day.
- Impact: Imported sessions created on wrong date for UK system; historical data corrupted
- Root cause: Should use `row.date` directly as ISO string without Date construction, or use `parseISO` from date-fns
- Agents: Technical Architect (TECH-011), QA Specialist (DEF-015)
- File: `src/app/actions/cashing-up-import.ts:73-77`

**DEF-M02** | Date handling throughout service uses raw `new Date()` not London timezone utils
- Summary: `new Date(weekStartDate + 'T00:00:00')`, `startDate.toISOString().split('T')[0]`, `new Date(date).getDay()` used throughout. Project standard requires `dateUtils.ts` utilities.
- Impact: Date boundaries shift in non-UTC environments; day-of-week calculations may be off
- Agents: Technical Architect (TECH-012, TECH-013)
- Files: `src/services/cashing-up.service.ts` (multiple lines)

**DEF-M03** | `onSubmitClick` is a two-step non-atomic operation in UI
- Summary: Save (step 1) succeeds, submit (step 2) fails → session is in draft with data saved, user sees error. On retry, `handleSave` runs again (with `existingId` set) which works, then submit is attempted again. Mostly recoverable but confusing UX.
- Impact: User confusion; not data-corrupting since retry path works
- Agents: Technical Architect (TECH-002)
- File: `src/components/features/cashing-up/DailyCashupForm.tsx:333-353`

**DEF-M04** | "Total Variance" label in form calculates only cash variance, not all-types variance
- Summary: Form `variance` variable (line 246-249) = cashCountedTotal - cashExpected. But DB stores total_variance_amount = total_counted - total_expected across all types. Since card/stripe have 0 variance (expected = counted), they're mathematically equal — but the label "Total Variance" is misleading.
- Impact: User confusion about what "Total Variance" represents; minor semantic bug
- Agents: Business Rules Auditor (POLICY-011/022)
- File: `src/components/features/cashing-up/DailyCashupForm.tsx:656`

**DEF-M05** | Inconsistent error response shapes across actions
- Summary: Some actions return `{ error }`, others return `{ success: false, error }`. Callers must defensively handle both shapes.
- Agents: Technical Architect (TECH-022)
- File: `src/app/actions/cashing-up.ts` (multiple actions)
