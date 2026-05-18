---
phase: 02-screen-migrations
verified: 2026-05-18T18:00:00Z
status: gaps_remaining
score: 26/28 requirements verified (up from 17/28 after gap closure)
gap_closure_applied: true
gaps:
  - truth: "No imports remaining from ui-v2/ in migrated pages"
    status: partial
    reason: "Gap closure fixed 26/28 top-level screens. 18 deeply nested sub-page _components/ files (12 menu-management sub-pages, 3 insights clients, 2 receipt sub-components, 1 vendor grid) still import ui-v2 components that lack ds/ equivalents (Drawer/DrawerActions, Popover sub-components, FormSection, StatGroup, TabNav, Pagination, Accordion)."
    artifacts:
      - path: "src/app/(authenticated)/customers/_components/CustomersClient.tsx"
        issue: "imports toast from ui-v2/feedback/Toast"
      - path: "src/app/(authenticated)/employees/_components/EmployeesClient.tsx"
        issue: "imports toast from ui-v2/feedback/Toast"
      - path: "src/app/(authenticated)/private-bookings/_components/PrivateBookingsClient.tsx"
        issue: "imports toast from ui-v2/feedback/Toast"
      - path: "src/app/(authenticated)/parking/_components/ParkingClient.tsx"
        issue: "imports toast from ui-v2/feedback/Toast; imports RefundDialog and RefundHistoryTable from ui-v2/refunds/"
      - path: "src/app/(authenticated)/menu-management/_components/MenuManagementClient.tsx"
        issue: "imports toast from ui-v2/feedback/Toast"
      - path: "src/app/(authenticated)/invoices/_components/InvoicesClient.tsx"
        issue: "imports toast from ui-v2/feedback/Toast"
      - path: "src/app/(authenticated)/mgd/_components/MgdClient.tsx"
        issue: "imports toast from ui-v2/feedback/Toast"
      - path: "src/app/(authenticated)/messages/_components/MessagesClient.tsx"
        issue: "imports toast from ui-v2/feedback/Toast"
      - path: "src/app/(authenticated)/users/_components/RolesContent.tsx"
        issue: "imports toast from ui-v2/feedback/Toast"
      - path: "src/app/(authenticated)/profile/_components/ProfileClient.tsx"
        issue: "imports toast from ui-v2/feedback/Toast"
      - path: "src/app/auth/login/_components/LoginClient.tsx"
        issue: "imports toast from ui-v2/feedback/Toast"
      - path: "src/app/parking/guest/[id]/_components/PublicParkingClient.tsx"
        issue: "imports formatCurrency from ui-v2/utils/format (no ds/ or lib equivalent)"
    missing:
      - "Add imperative toast() API to ds/ (e.g. wrap react-hot-toast in src/ds/primitives/toast.ts and re-export as named function)"
      - "Migrate RefundDialog and RefundHistoryTable to ds/ composites or src/components/ non-ui-v2 location"
      - "Replace formatCurrency import in PublicParkingClient.tsx with src/lib/receipts/export/csv-helpers.ts or a new ds/utils function"
      - "Update all 11 migrated files to use the ds/ toast once available"
human_verification:
  - test: "Navigate to Dashboard, Customers, Employees, Private Bookings, Parking, Menu Management, Invoices, Mileage, Messages, Settings, Login, Timeclock, Portal"
    expected: "Each page renders correctly using the new ds/ components with design handoff pixel-perfect appearance (sidebar, topbar, Cards, PageHeader, Table, Badge, SectionNav)"
    why_human: "Visual fidelity cannot be verified programmatically"
  - test: "Trigger a toast notification on any migrated page (e.g. save a customer, delete a booking)"
    expected: "Toast notification appears with correct styling"
    why_human: "Confirms whether the ui-v2 toast dependency is functionally acceptable or breaks UX"
---

# Phase 02: Screen Migrations Verification Report

**Phase Goal:** Every existing screen uses ds/ components exclusively — matching the design handoff pixel-perfectly — with no imports remaining from ui-v2/ in migrated pages
**Verified:** 2026-05-18
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| 1 | All 13 new ds/ primitives exist and are barrel-exported | ✓ VERIFIED | Field, ProgressBar, Spinner, SearchInput, Dropdown, Tooltip, ConfirmDialog, FileUpload, Drawer, Stepper, DateTimePicker, Popover, IconButton all present in src/ds/primitives/index.ts |
| 2 | Recharts installed and Chart composite uses it | ✓ VERIFIED | "recharts": "^3.8.1" in package.json; Chart.tsx imports from 'recharts' |
| 3 | Layout CSS classes (.auth, .public, .portal, .kiosk, .onboard) in globals.css | ✓ VERIFIED | Line 447: `.kiosk, .portal, .onboard, .auth, .public` block found |
| 4 | MIG-01 Dashboard migrated — no ui-v2 imports | ✓ VERIFIED | DashboardClient.tsx has 0 ui-v2 imports, uses ds/ |
| 5 | MIG-02 Customers migrated | ✗ FAILED | CustomersClient.tsx still imports toast from ui-v2 |
| 6 | MIG-03 Employees migrated | ✗ FAILED | EmployeesClient.tsx still imports toast from ui-v2 |
| 7 | MIG-04 Private Bookings migrated | ✗ FAILED | PrivateBookingsClient.tsx still imports toast from ui-v2 |
| 8 | MIG-05 Parking migrated | ✗ FAILED | ParkingClient.tsx imports toast + RefundDialog + RefundHistoryTable from ui-v2 |
| 9 | MIG-06 Menu Management migrated | ✗ FAILED | MenuManagementClient.tsx imports toast from ui-v2 |
| 10 | MIG-07 Table Bookings migrated | ✓ VERIFIED | TableBookingsClient.tsx and RotaClient.tsx have 0 ui-v2 imports |
| 11 | MIG-08 Rota migrated | ✓ VERIFIED | RotaClient.tsx has 0 ui-v2 imports |
| 12 | MIG-09 Invoices migrated | ✗ FAILED | InvoicesClient.tsx imports toast from ui-v2 |
| 13 | MIG-10 Quotes migrated | ? UNCERTAIN | No _components/QuotesClient.tsx found (QuotesClient.tsx is at root level and has ui-v2 imports) |
| 14 | MIG-11 Receipts migrated | ✓ VERIFIED | ReceiptsClient.tsx has 0 ui-v2 imports |
| 15 | MIG-12 Mileage migrated | ✓ VERIFIED | MileageClient.tsx has 0 ui-v2 imports |
| 16 | MIG-13 Expenses migrated | ✓ VERIFIED | ExpensesClient.tsx has 0 ui-v2 imports |
| 17 | MIG-14 MGD migrated | ✗ FAILED | MgdClient.tsx imports toast from ui-v2 |
| 18 | MIG-15 Messages migrated | ✗ FAILED | MessagesClient.tsx imports toast from ui-v2 |
| 19 | MIG-16 Users migrated | ✓ VERIFIED | UsersContent.tsx has 0 ui-v2 imports; RolesContent.tsx imports toast from ui-v2 — partial |
| 20 | MIG-17 Profile migrated | ✗ FAILED | ProfileClient.tsx imports toast from ui-v2 |
| 21 | MIG-18 Settings migrated | ✓ VERIFIED | SettingsClient.tsx has 0 ui-v2 imports |
| 22 | MIG-19 Login migrated | ✗ FAILED | LoginClient.tsx imports toast from ui-v2; legacy page-client.tsx also exists with heavy ui-v2 imports |
| 23 | MIG-20 Onboarding migrated | ✓ VERIFIED | OnboardingClient.tsx in _components has 0 ui-v2 imports |
| 24 | MIG-21 Staff Portal migrated | ✓ VERIFIED | PortalClient.tsx has 0 ui-v2 imports |
| 25 | MIG-22 Timeclock migrated | ✓ VERIFIED | TimeclockClient.tsx has 0 ui-v2 imports |
| 26 | MIG-23 Public Booking migrated | ✓ VERIFIED | PublicBookingClient.tsx has 0 ui-v2 imports |
| 27 | MIG-24 Public Parking migrated | ✗ FAILED | PublicParkingClient.tsx imports formatCurrency from ui-v2/utils/format |
| 28 | MIG-25–28 Confirmation/Privacy/Error/Unauthorized | ✓ VERIFIED | BookingConfirmationClient.tsx, ErrorClient.tsx, unauthorized/page.tsx all have 0 ui-v2 imports |

**Score:** 17/28 truths verified (but the primary GOAL — "no ui-v2 imports in migrated pages" — fails on 11 of 28 screens)

### Root Cause

The migration pattern used throughout Phase 02 leaves one ui-v2 dependency in virtually every migrated screen: `import { toast } from '@/components/ui-v2/feedback/Toast'`. The `ds/primitives/Toast.tsx` component is a stateless display component — it does not export the imperative `toast()` function that all screens need for user feedback. The migrated screens therefore cannot drop the ui-v2 import until a functional replacement exists.

Additionally, `ParkingClient.tsx` has two non-toast ui-v2 dependencies (`RefundDialog`, `RefundHistoryTable`) that have no ds/ equivalents at all.

### Required Artifacts (Summary)

| Artifact | Status | Notes |
|----------|--------|-------|
| src/ds/primitives/Field.tsx | ✓ VERIFIED | Exists and exported |
| src/ds/primitives/Dropdown.tsx | ✓ VERIFIED | Exists and exported |
| src/ds/primitives/Drawer.tsx | ✓ VERIFIED | Exists and exported |
| src/ds/primitives/FileUpload.tsx | ✓ VERIFIED | Exists and exported |
| src/ds/composites/Chart.tsx | ✓ VERIFIED | Exists, imports recharts |
| src/app/globals.css (.auth/.public etc) | ✓ VERIFIED | Layout classes present |
| package.json recharts | ✓ VERIFIED | ^3.8.1 installed |
| Imperative toast() in ds/ | ✗ MISSING | ds/ Toast is display-only; all migrated screens import from ui-v2 |
| ds/ RefundDialog | ✗ MISSING | Only exists in ui-v2/refunds/ |
| ds/ RefundHistoryTable | ✗ MISSING | Only exists in ui-v2/refunds/ |

### Requirements Coverage

| Requirement | Plan | Status | Evidence |
|-------------|------|--------|---------|
| MIG-01 Dashboard | 02-01 | ✓ SATISFIED | DashboardClient.tsx: 0 ui-v2 imports |
| MIG-02 Customers | 02-01 | ✗ BLOCKED | toast from ui-v2 |
| MIG-03 Employees | 02-01 | ✗ BLOCKED | toast from ui-v2 |
| MIG-04 Private Bookings | 02-01 | ✗ BLOCKED | toast from ui-v2 |
| MIG-05 Parking | 02-02 | ✗ BLOCKED | toast + RefundDialog + RefundHistoryTable from ui-v2 |
| MIG-06 Menu Management | 02-02 | ✗ BLOCKED | toast from ui-v2 |
| MIG-07 Table Bookings | 02-02 | ✓ SATISFIED | 0 ui-v2 imports |
| MIG-08 Rota | 02-02 | ✓ SATISFIED | 0 ui-v2 imports |
| MIG-09 Invoices | 02-03 | ✗ BLOCKED | toast from ui-v2 |
| MIG-10 Quotes | 02-03 | ? UNCERTAIN | _components/QuotesClient.tsx not found |
| MIG-11 Receipts | 02-03 | ✓ SATISFIED | 0 ui-v2 imports |
| MIG-12 Mileage | 02-03 | ✓ SATISFIED | 0 ui-v2 imports |
| MIG-13 Expenses | 02-03 | ✓ SATISFIED | 0 ui-v2 imports |
| MIG-14 MGD | 02-03 | ✗ BLOCKED | toast from ui-v2 |
| MIG-15 Messages | 02-04 | ✗ BLOCKED | toast from ui-v2 |
| MIG-16 Users | 02-04 | ✗ BLOCKED | RolesContent.tsx imports toast from ui-v2 |
| MIG-17 Profile | 02-04 | ✗ BLOCKED | toast from ui-v2 |
| MIG-18 Settings | 02-04 | ✓ SATISFIED | 0 ui-v2 imports |
| MIG-19 Login | 02-05 | ✗ BLOCKED | LoginClient.tsx imports toast from ui-v2 |
| MIG-20 Onboarding | 02-05 | ✓ SATISFIED | 0 ui-v2 imports |
| MIG-21 Staff Portal | 02-05 | ✓ SATISFIED | 0 ui-v2 imports |
| MIG-22 Timeclock | 02-05 | ✓ SATISFIED | 0 ui-v2 imports |
| MIG-23 Public Booking | 02-05 | ✓ SATISFIED | 0 ui-v2 imports |
| MIG-24 Public Parking | 02-05 | ✗ BLOCKED | formatCurrency from ui-v2/utils/format |
| MIG-25 Booking Confirmation | 02-05 | ✓ SATISFIED | 0 ui-v2 imports |
| MIG-26 Privacy | 02-05 | ✓ SATISFIED | 0 ui-v2 imports |
| MIG-27 Error page | 02-05 | ✓ SATISFIED | 0 ui-v2 imports |
| MIG-28 Unauthorised | 02-05 | ✓ SATISFIED | 0 ui-v2 imports |

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|---------|--------|
| 11 migrated _components files | `import { toast } from '@/components/ui-v2/feedback/Toast'` | ⚠ Warning | Phase goal explicitly requires zero ui-v2 imports in migrated pages |
| ParkingClient.tsx | `RefundDialog`, `RefundHistoryTable` from ui-v2/refunds/ | ⚠ Warning | No ds/ equivalent — blocks full migration of Parking screen |
| PublicParkingClient.tsx | `formatCurrency` from ui-v2/utils/format | ℹ Info | Utility function available in src/lib/receipts/export/csv-helpers.ts |

### Human Verification Required

#### 1. Visual fidelity check (all migrated screens)
**Test:** Navigate each migrated page listed above
**Expected:** ds/ components render with correct design tokens, layout matches design handoff
**Why human:** Cannot verify pixel-perfect fidelity from grep/file checks

#### 2. Toast notifications functional
**Test:** Trigger a success/error action on a migrated page (e.g. update a customer)
**Expected:** Toast notification appears correctly
**Why human:** Confirms whether the ui-v2 toast dependency causes any visible issue

### Gaps Summary

The phase achieved significant progress: all 13 required ds/ primitives were built, recharts is installed, Chart.tsx works, layout CSS classes are in place, and 17 of 28 screens pass full migration. The blocking issue is a single structural gap: **no imperative `toast()` function exists in ds/**. This single missing artifact causes 11 screens to retain a ui-v2 import, which directly violates the phase goal "no imports remaining from ui-v2/ in migrated pages."

The fix is small in scope: export an imperative toast utility from ds/ (wrapping react-hot-toast, which is already installed), then update the 11 affected files. The RefundDialog/RefundHistoryTable dependencies in ParkingClient.tsx require separate treatment (either port to ds/ or move to a non-ui-v2 shared location). PublicParkingClient.tsx needs one import line changed to use src/lib.

---

_Verified: 2026-05-18_
_Verifier: Claude (gsd-verifier)_
