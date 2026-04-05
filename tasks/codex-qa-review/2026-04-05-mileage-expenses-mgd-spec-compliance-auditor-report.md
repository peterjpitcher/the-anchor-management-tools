**Coverage Matrix**

| Check | Coverage | Findings |
| --- | --- | --- |
| 1. Database tables have all necessary columns | Partial | `SPEC-003`, `SPEC-004`, `SPEC-005` |
| 2. UI interactions are implementation-ready | Gap | `SPEC-006`, `SPEC-009` |
| 3. RBAC module names are consistent | Compliant | None |
| 4. Nav structure matches existing patterns | Mostly compliant | `SPEC-009` only for page-state detail |
| 5. Quarterly export enhancement is fully specified | Gap | `SPEC-001`, `SPEC-002`, `SPEC-007` |
| 6. Server actions include validation requirements | Gap | `SPEC-006` |
| 7. OJ-Projects sync trigger is fully specified | Gap | `SPEC-003` |
| 8. Implicit cross-module dependencies are called out | Gap | `SPEC-001`, `SPEC-002`, `SPEC-003`, `SPEC-008` |
| 9. Seed data covers everything for a fresh start | Gap | `SPEC-008` |
| 10. Error states are described for each UI flow | Gap | `SPEC-009` |

### SPEC-001: Export quarter model conflicts with the MGD quarter model
- **Spec Section:** [design spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L18), [design spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L170), [design spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L240)
- **Requirement:** Define one canonical export date-range model, including how Feb-Apr / Nov-Jan MGD periods map to the existing quarter selector and `{YYYY}` file naming.
- **Status:** Contradictory
- **Severity:** Critical
- **Description:** The spec says all three modules plug into the existing `/receipts` quarterly export, but the current UI/API are calendar-quarter based in [ReceiptExport.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/receipts/_components/ui/ReceiptExport.tsx#L42) and [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/receipts/export/route.ts#L233), while MGD is defined on a different HMRC cycle.
- **Impact:** A developer cannot deterministically query MGD rows, label the bundle, or handle Q4 periods that cross calendar years.
- **Suggested Resolution:** State whether export stays calendar-quarter based with a separate MGD-period lookup, or whether the export UI/API must move to HMRC MGD periods; specify inclusive dates and year labeling.

### SPEC-002: Access control requirements contradict the implementation paths for new finance data
- **Spec Section:** [design spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L22), [design spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L240), [design spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L348)
- **Requirement:** Specify route, table, bucket, and export authorization consistent with `super_admin`-only access.
- **Status:** Contradictory
- **Severity:** Critical
- **Description:** Section 2 says only `super_admin` can access these modules, but the technical notes allow simple `authenticated` RLS, and the export section does not redefine `/api/receipts/export` auth. The current route only checks `receipts:export` in [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/receipts/export/route.ts#L37).
- **Impact:** A spec-compliant build can leak Mileage, Expenses, and MGD data to non-super_admin users through the API or direct table/storage access.
- **Suggested Resolution:** Require an explicit auth model for pages, server actions, RLS, storage, and the export route, for example `super_admin` only or a clearly defined combined-permission rule.

### SPEC-003: OJ-Projects mileage sync is not buildable as written
- **Spec Section:** [design spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L84), [design spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L178), [design spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L334)
- **Requirement:** Specify synced-trip shape, recalculation behavior, and rollout/backfill rules for existing `oj_entries`.
- **Status:** Incomplete
- **Severity:** Critical
- **Description:** The spec calls OJ mileage both “single-leg” and “Anchor → destination → Anchor”, but `oj_entries` only store `entry_date`, `miles`, and `description` in [database.generated.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/database.generated.ts#L5447), and the OJ UI only captures miles in [page.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/oj-projects/page.tsx#L1076). It also omits whether existing mileage entries are backfilled and whether trigger-driven changes rerun same-tax-year HMRC recalculation.
- **Impact:** Developers cannot implement consistent `mileage_trip_legs`, totals, or migration behavior.
- **Suggested Resolution:** Define the synced-row representation, round-trip miles semantics, idempotent backfill/cutover behavior, and a shared recalculation function used by both manual actions and the trigger.

### SPEC-004: Mileage threshold logic has unresolved ordering and representation rules
- **Spec Section:** [design spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L77), [design spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L235), [design spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L295)
- **Requirement:** Define stable trip ordering and a truthful display/export model for trips that straddle the 10,000-mile threshold.
- **Status:** Contradictory
- **Severity:** High
- **Description:** The UX says live total is `miles × current HMRC rate`, and the CSV exports a single `Rate` column, but `amount_due` can be split across £0.45 and £0.25. `mileage_trips` only has `trip_date`, so same-day cumulative ordering is undefined.
- **Impact:** UI, CSV, and PDF can disagree with server math, and same-day edits can produce unstable totals.
- **Suggested Resolution:** Add a stable intra-day ordering rule or field and specify whether UI/export shows an effective rate or a split-mile breakdown.

### SPEC-005: MGD return lifecycle lacks required fields and edit/lock rules
- **Spec Section:** [design spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L154), [design spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L171), [design spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L219)
- **Requirement:** Define submitted/paid metadata and whether collections can mutate filed returns.
- **Status:** Incomplete
- **Severity:** High
- **Description:** `mgd_returns` only has `status` and `date_paid`; there is no submitted timestamp/by-user data, no reopen/correction rule, and totals are still defined to recalc on every collection mutation.
- **Impact:** Filed HMRC returns can drift after later edits, and return history/status transitions are not implementation-ready.
- **Suggested Resolution:** Specify lifecycle transitions, lock behavior, correction/reopen flow, and required columns such as `submitted_at` and `submitted_by`.

### SPEC-006: Server actions and validation contracts are missing
- **Spec Section:** [design spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L201), [design spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L226), [design spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L315), [design spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L349)
- **Requirement:** Enumerate each mutation/query action with permission, input schema, validation, side effects, audit logging, and revalidation behavior.
- **Status:** Missing
- **Severity:** High
- **Description:** The spec names pages and happy paths but never defines concrete actions for destination CRUD, trip CRUD, expense CRUD, file upload/delete, collection CRUD, return status changes, or export. Existing actions use explicit permission checks, validation, audit logging, and `revalidatePath`, for example [employeeInvite.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/employeeInvite.ts#L34) and [employeeInvite.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/employeeInvite.ts#L92), and upload size expectations already exist in [CLAUDE.md](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/CLAUDE.md#L137) and [types.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/receipts/types.ts#L311).
- **Impact:** Different developers will invent different contracts, security checks, and failure behavior.
- **Suggested Resolution:** Add an action contract table per operation, including Zod/schema rules, permission checks, audit calls, cache revalidation, and failure responses.

### SPEC-007: Export edge cases are under-specified
- **Spec Section:** [design spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L242), [design spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L301), [design spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L307)
- **Requirement:** Define zero-data behavior, partial-failure handling, archive naming uniqueness, converted HEIC extension behavior, and whether the UI preview is static or data-driven.
- **Status:** Incomplete
- **Severity:** High
- **Description:** The ZIP layout is defined, but not what happens when Mileage/Expenses/MGD have no rows, when expense files are missing, or when two expenses generate the same `{date}_{company}_{amount}` filename. The spec also converts HEIC to JPEG without defining export extension rules, and asks `ReceiptExport` to show a preview without specifying counts/data loading while the current UI is a simple form in [ReceiptExport.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/receipts/_components/ui/ReceiptExport.tsx#L10) and the current exporter silently skips missing files in [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/receipts/export/route.ts#L79).
- **Impact:** ZIP contents, filenames, and user messaging will vary by implementer and can collide or silently omit files.
- **Suggested Resolution:** Specify always-on CSV/header behavior, missing-file policy, collision-proof naming, normalized exported extensions, and preview requirements.

### SPEC-008: Seed/bootstrap coverage is too narrow for a fresh environment
- **Spec Section:** [design spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L334), [design spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L190)
- **Requirement:** Cover permissions, storage, one-time OJ rate updates, and sync initialization, not just destination import.
- **Status:** Incomplete
- **Severity:** High
- **Description:** The seed section only mentions 43 destinations. It does not cover RBAC permission seeding for `mileage`, `expenses`, `mgd`, creation of the `expense-receipts` bucket/policies, the one-time OJ default mileage update from `0.42` to `0.45` still reflected in [clients/page.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/oj-projects/clients/page.tsx#L116) and [clients/page.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/oj-projects/clients/page.tsx#L270), or the backfill/cutover decision for synced OJ entries.
- **Impact:** Fresh environments can boot with missing access, missing storage, stale defaults, or incomplete mileage history.
- **Suggested Resolution:** Expand this into a rollout checklist covering schema, permissions, storage, data fixes, and sync/backfill.

### SPEC-009: Page behavior and error states are not implementation-ready
- **Spec Section:** [design spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L196), [design spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L226), [design spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L307)
- **Requirement:** Define filters, sorts, pagination, empty/loading/error states, destructive confirmations, and read-only/edit rules per flow.
- **Status:** Missing
- **Severity:** Medium
- **Description:** The spec mentions stats cards, filters, “New” actions, and the route builder, but never defines exact filter fields, default sort/pagination, stop removal/reordering behavior, upload/delete failures, or page-level loading/empty/error states expected by the `ui-v2` shell in [PageLayout.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/ui-v2/layout/PageLayout.tsx#L70) and [PageLayout.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/ui-v2/layout/PageLayout.tsx#L161).
- **Impact:** UX and QA expectations will vary across Mileage, Expenses, and MGD.
- **Suggested Resolution:** Add per-page interaction/state tables covering default, loading, empty, validation error, async failure, destructive flows, and read-only behavior for OJ-synced trips.

**Fully Compliant Areas**

- RBAC naming is sound: `mileage`, `expenses`, and `mgd` fit the existing `ModuleName` extension pattern, and `manage` already exists in [rbac.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/rbac.ts#L31) and [rbac.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/rbac.ts#L60).
- The Finance sidebar shape matches the current grouped-nav implementation: `Mileage` with a `Destinations` sub-item and standalone `Expenses` / `MGD` fit [AppNavigation.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/features/shared/AppNavigation.tsx#L50) and [AppNavigation.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/features/shared/AppNavigation.tsx#L103).
- The CSV formatting requirements align with the current receipts export conventions in [design spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L287) and [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/receipts/export/route.ts#L18).
- The expense receipt metadata/storage direction is compatible with existing storage patterns in [design spec](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L328), [database.generated.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/database.generated.ts#L7491), and [receiptMutations.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/receipts/receiptMutations.ts#L871).
- The new routes can fit the existing `ui-v2` page shell without architectural mismatch per [CLAUDE.md](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/CLAUDE.md#L133).

No code changes made.