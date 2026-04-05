# Standards Enforcer Report: Mileage, Expenses & MGD Design Spec

**Spec:** `docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md`
**Date:** 2026-04-05
**Reviewer:** Standards Enforcement (automated)
**Verdict:** 9 deviations found (2 High, 4 Medium, 3 Low)

---

### STD-001: Missing snake_case to camelCase conversion pattern
- **Spec Section:** 3 (Data Model), 10 (Technical Notes)
- **Severity:** Medium
- **Standard:** Workspace `CLAUDE.md` and `supabase.md` require: "DB columns are `snake_case`; TypeScript types are `camelCase`. Always wrap DB results with a conversion helper (e.g. `fromDb<T>()`)."
- **Current spec says:** Nothing about snake_case to camelCase conversion or a `fromDb` helper.
- **Expected per standard:** The spec should note that all DB query results must be wrapped with the project's key-conversion utility before use in TypeScript. Type interfaces for each table should use camelCase property names (e.g. `tripDate`, `totalMiles`, `ratePerMile`). Note: this project does not currently have a `fromDb` utility (no matches found in `src/`), so the spec should either (a) note that one needs to be created, or (b) document whatever the actual project pattern is for handling DB results.
- **Auto-fixable:** Yes

---

### STD-002: RBAC module names use hyphens instead of underscores
- **Spec Section:** 2 (Access Control)
- **Severity:** High
- **Standard:** `src/types/rbac.ts` defines `ModuleName` as a union of snake_case strings (e.g. `'private_bookings'`, `'table_bookings'`, `'oj_projects'`, `'menu_management'`). All existing modules use underscores.
- **Current spec says:** RBAC modules are `mileage`, `expenses`, `mgd` (single-word, so no issue with these specific names). However, the spec does not mention adding these to the `ModuleName` type union in `src/types/rbac.ts`.
- **Expected per standard:** The spec should explicitly state that `'mileage'`, `'expenses'`, and `'mgd'` must be added to the `ModuleName` union type in `src/types/rbac.ts` and that corresponding permission rows must be seeded into the `permissions` table. The `ActionType` union already includes both `'view'` and `'manage'`, so no changes needed there.
- **Auto-fixable:** Yes

---

### STD-003: Navigation structure not specified with enough detail
- **Spec Section:** 5.1, 5.2, 5.3 (Routes & Pages)
- **Severity:** Medium
- **Standard:** `src/components/features/shared/AppNavigation.tsx` defines navigation as typed arrays of `NavigationItemWithPermission` objects grouped into `financeNavigation[]`. Each item has `name`, `href`, `icon`, `permission: { module: ModuleName, action: ActionType }`, and optionally `subItem: true`.
- **Current spec says:** "Nav: Finance group, top-level item 'Mileage' with sub-item 'Destinations'", etc. This is prose-level only.
- **Expected per standard:** The spec should show the exact entries to add to `financeNavigation[]` in `AppNavigation.tsx`, including: icon selection (which Heroicons to use), the `permission` object shape, and `subItem: true` for "Destinations". Currently Receipts is the last item before Short Links in the Finance group -- the spec should clarify insertion order. Example:
  ```typescript
  { name: 'Mileage', href: '/mileage', icon: TBDIcon, permission: { module: 'mileage', action: 'view' } },
  { name: 'Destinations', href: '/mileage/destinations', icon: TBDIcon, permission: { module: 'mileage', action: 'view' }, subItem: true },
  { name: 'Expenses', href: '/expenses', icon: TBDIcon, permission: { module: 'expenses', action: 'view' } },
  { name: 'MGD', href: '/mgd', icon: TBDIcon, permission: { module: 'mgd', action: 'view' } },
  ```
- **Auto-fixable:** Yes

---

### STD-004: Storage bucket naming inconsistency
- **Spec Section:** 3.2 (Expenses), 8.2 (Storage)
- **Severity:** Low
- **Standard:** Existing buckets use mixed conventions: `receipts` (no separator) and `hiring-docs` (hyphenated). The `receipt_files` DB table uses underscores.
- **Current spec says:** Bucket named `expense-receipts` (hyphenated).
- **Expected per standard:** This is acceptable -- it follows the `hiring-docs` precedent. However, note for consistency the DB table is `expense_files` (underscores) while the bucket is `expense-receipts` (hyphens). This mismatch is fine (buckets and tables follow different conventions) but should be explicitly acknowledged to avoid confusion during implementation.
- **Auto-fixable:** No (design decision)

---

### STD-005: No mention of ui-v2 component pattern for new pages
- **Spec Section:** 5 (Routes & Pages)
- **Severity:** High
- **Standard:** Project `CLAUDE.md` states: "Migrating from legacy `PageWrapper`/`Page` pattern to `PageLayout` + `HeaderNav` from `src/components/ui-v2/`. New pages must use the `ui-v2` pattern."
- **Current spec says:** Nothing about which component pattern to use for pages.
- **Expected per standard:** The spec should explicitly state that all new pages (`/mileage`, `/mileage/destinations`, `/expenses`, `/mgd`) must use the `PageLayout` + `HeaderNav` pattern from `src/components/ui-v2/`. This is mandatory for new pages per project convention.
- **Auto-fixable:** Yes

---

### STD-006: No mention of date handling utilities
- **Spec Section:** 3 (Data Model), 6 (Trip Entry UX)
- **Severity:** Medium
- **Standard:** Workspace `CLAUDE.md`: "Always use the project's `dateUtils` for display. Never use raw `new Date()` or `.toISOString()` for user-facing dates. Default timezone: Europe/London."
- **Current spec says:** Uses DATE columns (`trip_date`, `expense_date`, `collection_date`) and mentions "tax year (6 April - 5 April)" but does not reference `dateUtils.ts` or the London timezone convention.
- **Expected per standard:** The spec should note that: (a) all user-facing date display must use `formatDateInLondon()` or equivalent from `src/lib/dateUtils.ts`, (b) tax year boundary calculations must use London timezone (not UTC), (c) `getTodayIsoDate()` should be used when defaulting date fields.
- **Auto-fixable:** Yes

---

### STD-007: No mention of loading/error/empty states for UI
- **Spec Section:** 5 (Routes & Pages), 6 (Trip Entry UX)
- **Severity:** Medium
- **Standard:** `ui-patterns.md`: "Every data-driven UI must handle all three states: 1. Loading -- skeleton loaders or spinners, 2. Error -- user-facing error message, 3. Empty -- meaningful empty state component."
- **Current spec says:** Lists pages and their purpose but does not mention loading, error, or empty states.
- **Expected per standard:** Each page should specify: (a) loading state (skeleton or spinner), (b) error state handling, (c) empty state content (e.g., "No trips recorded yet -- add your first trip" for mileage, "No collections recorded" for MGD). These are required per the UI patterns standard.
- **Auto-fixable:** Yes

---

### STD-008: No mention of testing requirements
- **Spec Section:** 10 (Technical Notes) or missing section
- **Severity:** Low
- **Standard:** `testing.md` requires: "Minimum per feature: happy path + at least 1 error/edge case." Priority order: server actions/business logic first, then data transformation utilities. `definition-of-done.md` requires: "New tests written for business logic."
- **Current spec says:** Nothing about tests.
- **Expected per standard:** The spec should identify key testable areas, at minimum: (a) HMRC rate calculation logic (threshold crossing, cumulative miles), (b) MGD quarter period mapping, (c) CSV generation with BOM and formula injection protection, (d) image optimisation pipeline. The HMRC rate calculation in particular has complex edge cases (straddling the 10,000-mile threshold, recalculation on delete) that demand thorough test coverage.
- **Auto-fixable:** Yes

---

### STD-009: Server action pattern described but missing explicit structure
- **Spec Section:** 10 (Technical Notes)
- **Severity:** Low
- **Standard:** Workspace `CLAUDE.md` defines the server action pattern: auth check via `getSupabaseServerClient()` + `getUser()`, permission check via `checkUserPermission()`, business logic, `logAuditEvent()`, `revalidatePath()`, return `{ success?: boolean; error?: string }`. The existing `receipts.ts` also shows a `requireCurrentUser()` helper pattern.
- **Current spec says:** "Audit logging: All mutations call `logAuditEvent()` per existing codebase pattern" and "RLS policies: Server actions check `super_admin` role via RBAC." These are correct but incomplete.
- **Expected per standard:** The spec should explicitly note the full server action contract: (a) `'use server'` directive, (b) auth check via `requireCurrentUser()` or equivalent, (c) permission check via `checkUserPermission('mileage', 'manage', userId)`, (d) typed return `Promise<{ success?: boolean; error?: string }>`, (e) `revalidatePath()` after mutations, (f) `logAuditEvent()` with correct `resource_type`. The receipts module also demonstrates a service-layer extraction pattern (`src/services/receipts`) -- the spec should note whether this pattern will be followed.
- **Auto-fixable:** Yes

---

## Summary

| Severity | Count | Items |
|----------|-------|-------|
| High     | 2     | STD-002 (RBAC type registration), STD-005 (ui-v2 pattern) |
| Medium   | 4     | STD-001 (fromDb), STD-003 (nav detail), STD-006 (dateUtils), STD-007 (UI states) |
| Low      | 3     | STD-004 (bucket naming), STD-008 (testing), STD-009 (server action detail) |

### Recommendation

The spec is well-structured and covers the data model and business logic thoroughly. The two **High** items should be addressed before implementation begins:

1. **STD-002**: Add the three new module names to `ModuleName` in `rbac.ts` -- without this, TypeScript will reject the permission checks at compile time.
2. **STD-005**: Mandate `ui-v2` (`PageLayout` + `HeaderNav`) for all new pages -- using the legacy pattern would create tech debt on day one.

The **Medium** items are implementation details that a senior developer would likely handle correctly by following existing code patterns, but documenting them in the spec reduces ambiguity and prevents inconsistency across the three modules.
