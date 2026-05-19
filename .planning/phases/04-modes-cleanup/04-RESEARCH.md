# Phase 4: Modes, Polish & Cleanup - Research

**Researched:** 2026-05-19
**Domain:** Legacy UI cleanup, FOH chromeless mode, component migration
**Confidence:** HIGH

## Summary

Phase 4 completes the AMS UI Redesign by migrating all remaining 188 files off `@/components/ui-v2` (and 5 files off `@/components/ui/`), building the FOH chromeless mode with clock-in band, and updating documentation. The ds/ design system already provides equivalents for most ui-v2 primitives (Button, Card, Modal, Input, Select, Badge, etc.). However, several ui-v2 components have no direct ds/ equivalent and need resolution: PageLayout (page wrapper), FormGroup/Form (form wrappers), Section (content grouping), LinkButton (navigating button), Pagination, DataTable, Container, HeaderNav, TabNav, BackButton, FilterPanel, DebouncedTextarea, Accordion, and the format utility module.

The FOH mode infrastructure is already partially built: `isFohOnlyUser()` detection, sidebar hiding via `showSidebar={!fohOnlyMode}`, and path redirection to `/table-bookings/foh`. What remains is: hiding topbar search/notifications/New button for FOH users, building the `FohClockBand` banner component, and wiring it into the layout. The existing `FohClockWidget` in the FOH page already integrates with timeclock server actions and can inform the clock-in band design.

**Primary recommendation:** Migrate the 188 ui-v2 files in waves grouped by area (settings, private-bookings, rota, employees, etc.), building missing ds/ components (PageLayout equivalent, form wrappers, LinkButton) in a preparatory wave. FOH mode can be built in parallel as it touches only AppShell/Topbar and a new FohClockBand component.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
1. FOH Chromeless Mode Behaviour: Keep existing topbar for FOH users, hide sidebar (already done), lock FOH users to `/table-bookings/foh` only. Clock-in band as coloured top banner below topbar showing status and action button. Integrates with `clock_events` table and timeclock server actions.
2. Legacy Cleanup Scope: Migrate ALL 188 files importing from ui-v2/ and all 5 files importing from ui/ to ds/ equivalents. After migration, delete both `src/components/ui/` and `src/components/ui-v2/` directories entirely.
3. tailwind.config.js: Already removed during Phase 1. CLEAN-03 is already satisfied.
4. Documentation Update: Comprehensive update to CLAUDE.md (project-level), Design System page, and inline code comments to reference ds/ as canonical.

### Claude's Discretion
None specified -- all decisions locked.

### Deferred Ideas (OUT OF SCOPE)
- Dark mode support (v2 THEME-01)
- Density system (v2 THEME-02)
- Brand colour switching (v2 THEME-03)
- Drag-and-drop on Events calendar (v2 VIEW-01)
- Floor plan editor for Table Bookings (v2 VIEW-02)
- Global search functionality (v2 VIEW-03)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MODE-01 | Build FOH-only chromeless mode (no sidebar, locked to table management screen with clock-in band) | FOH infrastructure audit in Section 4 -- sidebar hiding exists, topbar needs FOH-aware props, FohClockBand is new build |
| CLEAN-01 | Remove legacy `ui/` components after all pages migrated | 5 files use SortableHeader -- trivial migration, move or inline |
| CLEAN-02 | Remove `ui-v2/` components after all pages migrated | Full 188-file audit in Section 1 with component mapping and gap analysis |
| CLEAN-03 | Remove `tailwind.config.js` after v4 migration complete | Already satisfied -- confirmed not present in project root |
| CLEAN-04 | Update CLAUDE.md to reflect new design system patterns | 7 lines in CLAUDE.md reference ui-v2 as current pattern -- need updating |
</phase_requirements>

## 1. Legacy ui-v2 Import Audit

**Total files importing from `@/components/ui-v2`:** 188 (142 in `src/app/`, 43 in `src/components/`, 3 internal ui-v2 self-references)

### Components Imported (by frequency)

| ui-v2 Component | Import Count | ds/ Equivalent | Gap? |
|-----------------|-------------|----------------|------|
| `forms/Button` | 112 | `Button` from `@/ds` | No |
| `layout/Card` | 87 | `Card, CardHeader, CardBody, CardFooter` from `@/ds` | No |
| `layout/PageLayout` | 81 | No direct equivalent | **YES** |
| `feedback/Alert` | 71 | `Alert` from `@/ds` | No |
| `forms/Input` | 69 | `Input` from `@/ds` | No |
| `feedback/Toast` | 62 | `toast` from `@/ds` | No |
| `display/Badge` | 49 | `Badge` from `@/ds` | No |
| `forms/FormGroup` | 48 | `Field` from `@/ds` (partial) | **PARTIAL** |
| `forms/Select` | 43 | `Select` from `@/ds` | No |
| `layout/Section` | 41 | No direct equivalent | **YES** |
| `forms/Textarea` | 39 | `Textarea` from `@/ds` | No |
| `display/EmptyState` | 29 | `Empty` from `@/ds` | No |
| `overlay/Modal` | 26 | `Modal` from `@/ds` | No |
| `display/DataTable` | 24 | `Table` from `@/ds` (different API) | **PARTIAL** |
| `overlay/ConfirmDialog` | 21 | `ConfirmDialog` from `@/ds` | No |
| `navigation/LinkButton` | 20 | No equivalent | **YES** |
| `feedback/Spinner` | 20 | `Spinner` from `@/ds` | No |
| `forms/Checkbox` | 16 | `Checkbox` from `@/ds` | No |
| `display/Stat` | 10 | `Stat` from `@/ds` | No |
| `navigation/Pagination` | 9 | `TablePagination` from `@/ds` (Table-coupled) | **PARTIAL** |
| `forms/Form` | 9 | No equivalent (wrapper) | **YES** |
| `navigation/HeaderNav` | 7 | No equivalent | **YES** |
| `utils/format` | 7 | No equivalent (utility) | **MOVE** |
| `navigation/Tabs` | 5 | `Tabs` from `@/ds` | No |
| `overlay/Drawer` | 4 | `Drawer` from `@/ds` | No |
| `navigation/TabNav` | 4 | `SectionNav` from `@/ds` (partial) | **PARTIAL** |
| `forms/SearchInput` | 3 | `SearchInput` from `@/ds` | No |
| `layout/Container` | 3 | No equivalent | **YES** |
| `display/FilterPanel` | 3 | No equivalent | **YES** |
| `navigation/Dropdown` | 2 | `Dropdown` from `@/ds` | No |
| `navigation/BackButton` | 2 | No equivalent | **YES** |
| `forms/Radio` | 2 | `Radio` from `@/ds` | No |
| `forms/DebouncedTextarea` | 2 | No equivalent | **YES** |
| `refunds/RefundDialog` | 2 | Domain component, not primitive | **MOVE** |
| `refunds/RefundHistoryTable` | 2 | Domain component, not primitive | **MOVE** |
| `overlay/Popover` | 1 | `Popover` from `@/ds` | No |
| `forms/Toggle` | 1 | `Switch` from `@/ds` | No |
| `feedback/Skeleton` | 1 | `Skeleton` from `@/ds` | No |
| `feedback/ProgressBar` | 1 | `ProgressBar` from `@/ds` | No |
| `display/Accordion` | 1 | No equivalent | **YES** |
| `@/components/ui-v2` (barrel) | 1 | `@/ds` barrel | No |
| `navigation` (barrel) | 1 | N/A | No |

### Files by Area

| Area | File Count | Key ui-v2 Components Used |
|------|-----------|--------------------------|
| **Private Bookings** (main + sub-pages) | 13 | PageLayout, Card, Button, Input, Select, Alert, Modal, Badge, FormGroup, DataTable, HeaderNav, LinkButton, Section, ConfirmDialog |
| **Employees** (main + features) | 19 | PageLayout, Card, Button, Input, Select, FormGroup, Alert, Toast, Badge, Modal, Checkbox, Section, ConfirmDialog |
| **Settings** (12+ sub-pages) | 24 | PageLayout, Card, Button, Input, Select, FormGroup, Alert, Toast, Section, Modal, ConfirmDialog, Tabs |
| **Invoices** (main + sub-pages) | 13 | PageLayout, Card, Button, Input, Select, FormGroup, Alert, Toast, Badge, DataTable, Pagination, LinkButton |
| **Rota** (main + sub-pages) | 14 | PageLayout, Card, Button, Alert, Toast, Modal, Badge, FormGroup, Input, Select, Section, ConfirmDialog |
| **Menu Management** | 13 | PageLayout, Card, Button, Input, Select, FormGroup, Alert, Toast, Badge, Modal, Drawer, Checkbox, Section |
| **Receipts** (main + sub-pages) | 9 | PageLayout, Card, Button, Alert, Badge, DataTable, Section, Stat |
| **Quotes** | 5 | PageLayout, Card, Button, Input, FormGroup, Alert, Toast, LinkButton |
| **Table Bookings** (BOH/FOH/detail) | 8 | PageLayout, Card, Button, Modal, ConfirmDialog, Badge, LinkButton, Alert |
| **Events** (command center) | 5 | Card, Button, Badge, Alert, Input, Select, FilterPanel |
| **Features/shared** | 7 | Button, Input, Select, FormGroup, Card, Modal, Alert, Toast |
| **Customers** | 6 | PageLayout, Card, Button, Input, FormGroup, Alert, Badge, Toast |
| **Roles** | 4 | PageLayout, Card, Button, Badge, Modal, ConfirmDialog |
| **Mileage** | 3 | PageLayout, Card, Badge, Stat |
| **MGD** | 2 | PageLayout, Card, Badge |
| **Expenses** | 2 | PageLayout, Card, Badge |
| **Messages** | 1 | PageLayout, Card, Button, Textarea |
| **Parking** | 1 | PageLayout, Card, Button, Badge, DataTable |
| **Profile** | 1 | Card, Button, Input, FormGroup, Alert, Toast |
| **Auth** (login, reset-password, reset) | 3 | Container, Card, Form, FormGroup, Input, Button, LinkButton, Toast, EmptyState, Spinner |
| **Staff Portal** (leave) | 2 | Badge, Button, Input, FormGroup, Alert |
| **Booking Portal** | 1 | formatCurrency utility only |
| **Dashboard** | 1 | Card (ScheduleCalendar) |
| **Modals** (shared) | 3 | Modal, Button, Input, FormGroup, Alert, Toast |
| **Schedule Calendar** | 1 | Card, Badge |
| **Catering** (features) | 3 | Card, Button, Input, FormGroup, Alert, Modal, Toast |

## 2. Legacy ui/ Import Audit

**Total files importing from `@/components/ui/`:** 5

| File | Component Used |
|------|---------------|
| `src/app/(authenticated)/expenses/_components/ExpensesClient.tsx` | `SortableHeader` |
| `src/app/(authenticated)/expenses/insights/_components/ExpensesInsightsClient.tsx` | `SortableHeader` |
| `src/app/(authenticated)/mgd/_components/MgdClient.tsx` | `SortableHeader` |
| `src/app/(authenticated)/mileage/_components/MileageClient.tsx` | `SortableHeader` |
| `src/app/(authenticated)/mileage/insights/_components/MileageInsightsClient.tsx` | `SortableHeader` |

**Only component in `src/components/ui/`:** `SortableHeader.tsx`

**Resolution:** Either move `SortableHeader` into ds/ as a primitive or composites component, or inline its functionality into the ds/ Table component (which already supports sortable headers via `TableHead`).

## 3. Component Gap Analysis

### ds/ Components Available (complete inventory)

**Primitives (29):** Alert, Avatar (+ AvatarStack), Badge, Button, Checkbox, ConfirmDialog, DateTimePicker, Drawer, Dropdown (+ DropdownItem), Empty, Field, FileUpload, IconButton, Input, Modal, Popover, ProgressBar, Radio, SearchInput, Select, Skeleton, Spinner, Stat, Stepper, Switch, Textarea, Toast (+ toast function), Tooltip

**Composites (7):** Card (+ CardHeader/CardBody/CardFooter), Chart (RevenueChart + Sparkline), PageHeader, SectionNav, Segmented, Table (+ TableHeader/TableBody/TableRow/TableHead/TableCell/TablePagination), Tabs

**Icons (1):** Icon (with 38+ icon paths)

**Shell (5):** AppShell, Sidebar, SidebarNav (+ NAV_GROUPS), Topbar, UserFooter

**Tokens (1):** colors, spacing, shadows, radii, easing, getToken()

### Gap Components (need resolution before bulk migration)

| ui-v2 Component | Usage Count | Resolution Strategy | Effort |
|-----------------|-------------|---------------------|--------|
| **PageLayout** | 81 files | Build `PageLayout` composite in ds/ (wraps PageHeader + content area + optional nav). This is the most-used component after Button/Card. | MEDIUM |
| **FormGroup** | 48 files | ds/ `Field` covers label+error. Need to verify API compatibility or build adapter. FormGroup adds `htmlFor`, `required`, `helpText`, `error` -- Field likely covers this. | LOW |
| **Section** | 41 files | Build `Section` composite in ds/ (title, description, collapsible, children). Used on 83% of pages in ui-v2. | LOW |
| **LinkButton** | 20 files | Build `LinkButton` in ds/ (wraps Button + Next.js Link). Thin wrapper. | LOW |
| **DataTable** | 24 files | ds/ `Table` is structurally different (manual rows vs data-driven). Build `DataTable` composite in ds/ that wraps Table with data mapping + sorting + pagination. | MEDIUM |
| **Form/FormActions** | 9 files | `Form` is a `<form>` wrapper, `FormActions` is a footer div. Inline or build thin wrapper. | LOW |
| **HeaderNav** | 7 files | Build or integrate into PageLayout. Currently renders tab-style navigation below page header. | LOW |
| **Container** | 3 files | Simple max-width centered div. Inline into usage or add to ds/. | TRIVIAL |
| **FilterPanel** | 3 files | Likely domain-specific. Inline or add to composites. | LOW |
| **BackButton** | 2 files | Thin wrapper over Button + router.back(). Inline. | TRIVIAL |
| **TabNav** | 4 files | ds/ `SectionNav` serves same purpose. Verify API compatibility. | LOW |
| **DebouncedTextarea** | 2 files | Textarea + useDebounce hook. Keep as utility or build in ds/. | TRIVIAL |
| **Accordion** | 1 file | Build in ds/ primitives or use Headless UI Disclosure. | LOW |
| **Pagination** | 9 files | ds/ has `TablePagination` -- may need standalone version. | LOW |
| **format utils** | 7 files | Move `formatCurrency`, `formatBytes`, etc. to `src/lib/format.ts`. | TRIVIAL |
| **RefundDialog + RefundHistoryTable** | 2+2 files | Domain components. Move to `src/components/features/invoices/` or similar, update imports to use ds/ internally. | LOW |
| **SortableHeader** (ui/) | 5 files | Inline into Table usage or add sort header support to ds/ Table. | LOW |

### Priority Order for Gap Resolution

1. **PageLayout** -- blocks 81 files, highest priority
2. **Section** -- blocks 41 files
3. **FormGroup->Field mapping** -- verify API compatibility for 48 files
4. **DataTable** -- blocks 24 files
5. **LinkButton** -- blocks 20 files
6. **Everything else** -- low-count, can be inlined during file migration

## 4. FOH Mode Infrastructure

### Current State

**Detection logic** (`src/lib/foh/user-mode.ts`):
```typescript
export function isFohOnlyUser(permissions: UserPermission[]): boolean {
  // Returns true if user has ONLY table_bookings permissions (no other modules)
  const hasFohView = permissions.some(p => p.module_name === 'table_bookings' && p.action === 'view')
  return hasFohView && permissions.every(p => p.module_name === 'table_bookings')
}
```

**Layout integration** (`AuthenticatedLayout.tsx`):
- Line 24-27: `fohOnlyMode` computed via `useMemo(() => isFohOnlyUser(permissions))`
- Line 86-93: Non-FOH paths redirect to `/table-bookings/foh`
- Line 144: `<AppShell showSidebar={!fohOnlyMode}>` -- sidebar already hidden

**AppShell** (`src/ds/shell/AppShell.tsx`):
- `showSidebar` prop: controls desktop sidebar and mobile sidebar overlay
- When `showSidebar=false`: both sidebar and topbar are hidden (line 92: topbar is conditionally rendered)
- **Issue:** Currently topbar is ALSO hidden when `showSidebar=false`. For FOH mode, we want topbar visible but with reduced elements.

**Topbar** (`src/ds/shell/Topbar.tsx`):
- Currently renders: mobile hamburger, search placeholder, notification bell, "New" button
- For FOH mode: hide search, notifications, "New" button. Show only the hamburger (for mobile) and a sign-out avatar dropdown.
- No current props for controlling element visibility.

### What Needs Building

1. **AppShell changes:** Decouple topbar from sidebar visibility. Add `showTopbar` prop (default true), or always show topbar and add `fohMode` prop that controls element visibility.

2. **Topbar changes:** Add props like `hideSearch`, `hideNotifications`, `hideNewButton` (or a single `fohMode` prop). Add avatar/sign-out dropdown for FOH users.

3. **FohClockBand component** (new):
   - Coloured banner strip rendered between topbar and main content
   - Fetches current user's clock status from `clock_events` table
   - Shows "Clocked in since HH:MM" + Clock Out button, or "Not clocked in" + Clock In button
   - Integrates with existing `clockIn()` and `clockOut()` server actions from `src/app/actions/timeclock.ts`
   - Should accept `employeeId` as prop (resolved from auth user in layout)

4. **Layout wiring:** Pass `fohOnlyMode` down to AppShell with new props. Render FohClockBand inside the FOH page or as part of AppShell when in FOH mode.

### Existing Timeclock Infrastructure

**Server actions** (`src/app/actions/timeclock.ts`):
- `clockIn(employeeId)` -- creates clock_events record, returns session
- `clockOut(employeeId)` -- closes open session, returns session
- `getOpenSessions()` -- returns all currently open sessions
- `TimeclockSession` type exported with: id, employee_id, work_date, clock_in_at, clock_out_at, etc.

**Existing FohClockWidget** (`src/app/(authenticated)/table-bookings/foh/FohClockWidget.tsx`):
- Already integrates with `clockIn`/`clockOut` server actions
- Shows clocked-in employee badges with clock-out on click
- Uses ui-v2 `Modal` and `ConfirmModal` -- needs migration to ds/
- Currently only shown for `manager@the-anchor.pub` email (manager kiosk style)

**FOH page** (`src/app/(authenticated)/table-bookings/foh/page.tsx`):
- Uses `PageLayout` from ui-v2 -- needs migration
- Uses `LinkButton` from ui-v2 -- needs migration
- Has special `useManagerKioskStyle` mode for iPad kiosk
- Clock widget employees fetched from `employees` table
- Open sessions fetched via `getOpenSessions()`

## 5. Unmigrated Screens (MIG-19 to MIG-28)

### MIG-19: Login Page (`src/app/auth/login/`)

**Files:** `page.tsx`, `page-client.tsx`, `_components/LoginClient.tsx`
**ui-v2 imports (page-client.tsx):** Container, Card, Form, FormActions, FormGroup, Input, Button, LinkButton, toast
**Current state:** Traditional card-centered login form with email/password fields
**Redesign scope:** Replace all ui-v2 imports with ds/ equivalents. Auth pages use their own layout (not AppShell). Need Container equivalent or inline the centering CSS. LinkButton needs ds/ equivalent or replace with Button + Link.

### MIG-20: Onboarding Wizard (`src/app/(employee-onboarding)/`)

**Files:** `layout.tsx`, `onboarding/[token]/page.tsx`, `_components/OnboardingClient.tsx`, 6 step files, `success/page.tsx`
**ui-v2 imports:** None in step files. `_components/OnboardingClient.tsx` already uses `@/ds` (Button, Stepper). `page.tsx` uses `@/ds` (Icon, Button).
**Current state:** Already partially migrated to ds/. Step files use plain Tailwind without any component library imports.
**Redesign scope:** Minimal -- already using ds/. May need styling polish to match design handoff aesthetic. No ui-v2 to migrate.

### MIG-21: Staff Portal (`src/app/(staff-portal)/portal/`)

**Files:** `page.tsx`, `_components/PortalClient.tsx`, `leave/page.tsx`, `leave/LeaveRequestForm.tsx`, `shifts/page.tsx`, `shifts/CalendarSubscribeButton.tsx`, `shifts/PaySummaryCard.tsx`
**ui-v2 imports (leave/page.tsx):** Badge
**ui-v2 imports (LeaveRequestForm.tsx):** Button, Input, FormGroup, Alert
**ds/ already in use:** PortalClient.tsx uses Button, Badge, Stat, Card from `@/ds`
**Redesign scope:** 2 files need ui-v2 migration (leave page and form). Rest already uses ds/ or plain Tailwind.

### MIG-22: Timeclock Kiosk (`src/app/(timeclock)/timeclock/`)

**Files:** `page.tsx`, `TimeclockKiosk.tsx`, `_components/TimeclockClient.tsx`, `layout.tsx`
**ui-v2 imports:** None
**ds/ already in use:** `TimeclockClient.tsx` uses Avatar from `@/ds`
**Current state:** Full-screen dark mode kiosk with employee grid. Uses own layout (not AppShell).
**Redesign scope:** No ui-v2 migration needed. Styling polish for design handoff consistency.

### MIG-23: Public Booking (`src/app/table-booking/`)

**Files:** `page.tsx`, `[reference]/page.tsx`, `[reference]/payment/page.tsx`, `_components/PublicBookingClient.tsx`, `success/page.tsx`
**ui-v2 imports:** None
**ds/ already in use:** `PublicBookingClient.tsx` uses Button, Field, Input, Textarea from `@/ds`
**Redesign scope:** No ui-v2 migration needed. Already using ds/ and plain Tailwind.

### MIG-24: Public Parking (`src/app/parking/guest/`)

**Files:** `[id]/page.tsx`, `[id]/_components/PublicParkingClient.tsx`
**ui-v2 imports:** None
**ds/ already in use:** `PublicParkingClient.tsx` uses Icon from `@/ds`
**Redesign scope:** No ui-v2 migration needed. May need styling polish.

### MIG-25: Booking Confirmation (`src/app/booking-confirmation/[token]/`)

**Files:** `page.tsx`, `_components/BookingConfirmationClient.tsx`
**ui-v2 imports:** None
**ds/ already in use:** `BookingConfirmationClient.tsx` uses Icon from `@/ds`
**Redesign scope:** No ui-v2 migration needed. Styling polish for design handoff.

### MIG-26: Privacy Page (`src/app/privacy/page.tsx`)

**ui-v2 imports:** None
**Current state:** Server component with prose layout using custom CSS classes (`public__hero`, `public__prose`, etc.)
**Redesign scope:** No ui-v2 migration needed. Styling update for design handoff consistency if desired.

### MIG-27: Error Page (`src/app/(authenticated)/error.tsx`)

**ui-v2 imports:** None
**Current state:** Uses raw Tailwind classes (`bg-blue-600`, `text-gray-600`) -- not design-token-aware
**Redesign scope:** No ui-v2 migration. Replace hardcoded colours with design tokens. Wrap in ds/ Card with ds/ Button.

### MIG-28: Unauthorised Page (`src/app/unauthorized/page.tsx`)

**ui-v2 imports:** None
**ds/ already in use:** Uses Icon and Button from `@/ds`
**Current state:** Already using ds/ components with design tokens
**Redesign scope:** Already migrated. Minor styling polish at most.

### MIG-19 to MIG-28 Summary

| Screen | ui-v2 Files to Migrate | Already on ds/ | Status |
|--------|----------------------|----------------|--------|
| MIG-19 Login | 3 files (page-client + reset-password + reset-form) | No | Needs migration |
| MIG-20 Onboarding | 0 | Yes (partial) | Styling polish only |
| MIG-21 Staff Portal | 2 files (leave page + form) | Yes (partial) | Light migration |
| MIG-22 Timeclock Kiosk | 0 | Yes (partial) | Styling polish only |
| MIG-23 Public Booking | 0 | Yes | No work needed |
| MIG-24 Public Parking | 0 | Yes (partial) | Styling polish only |
| MIG-25 Booking Confirmation | 0 | Yes (partial) | Styling polish only |
| MIG-26 Privacy | 0 | No (plain HTML) | Styling polish only |
| MIG-27 Error | 0 | No (raw Tailwind) | Token update needed |
| MIG-28 Unauthorised | 0 | Yes | Done |

**Total ui-v2 migration needed for MIG-19 to MIG-28:** 5 files only

## 6. tailwind.config.js Status

**Confirmed: Already removed.** No `tailwind.config.js` or `tailwind.config.ts` exists in the project root.

**Residual references found:**
- `components.json` (shadcn/ui config): references `"config": "tailwind.config.ts"` -- stale reference, harmless but should be cleaned up
- `.claude/worktrees/*/tailwind.config.js` -- old agent worktrees, not part of active codebase
- `scripts/analysis/analyze-file-structure.ts` -- analysis script, references as search target

**CLEAN-03 is satisfied.** No action needed beyond optional cleanup of `components.json`.

## Component Mapping Reference

### Direct 1:1 Mappings (no gap)

| ui-v2 Path | ds/ Import | Notes |
|------------|-----------|-------|
| `forms/Button` | `Button` from `@/ds` | API likely compatible |
| `layout/Card` | `Card, CardHeader, CardBody, CardFooter` from `@/ds` | Subcomponent pattern differs |
| `feedback/Alert` | `Alert` from `@/ds` | Tone names may differ |
| `forms/Input` | `Input` from `@/ds` | Check icon prop compatibility |
| `feedback/Toast` | `toast` from `@/ds` | Function-based API |
| `display/Badge` | `Badge` from `@/ds` | Tone names may differ |
| `forms/Select` | `Select` from `@/ds` | |
| `forms/Textarea` | `Textarea` from `@/ds` | |
| `display/EmptyState` | `Empty` from `@/ds` | Name change |
| `overlay/Modal` | `Modal` from `@/ds` | Check footer/ModalActions API |
| `overlay/ConfirmDialog` | `ConfirmDialog` from `@/ds` | |
| `feedback/Spinner` | `Spinner` from `@/ds` | |
| `forms/Checkbox` | `Checkbox` from `@/ds` | |
| `display/Stat` | `Stat` from `@/ds` | |
| `navigation/Tabs` | `Tabs` from `@/ds` | |
| `overlay/Drawer` | `Drawer` from `@/ds` | |
| `forms/SearchInput` | `SearchInput` from `@/ds` | |
| `navigation/Dropdown` | `Dropdown` from `@/ds` | |
| `forms/Radio` | `Radio` from `@/ds` | |
| `overlay/Popover` | `Popover` from `@/ds` | |
| `forms/Toggle` | `Switch` from `@/ds` | Name change |
| `feedback/Skeleton` | `Skeleton` from `@/ds` | |
| `feedback/ProgressBar` | `ProgressBar` from `@/ds` | |

### Mappings Requiring API Verification

| ui-v2 | ds/ | What to Check |
|-------|-----|---------------|
| `forms/FormGroup` | `Field` | Does Field support `htmlFor`, `required`, `helpText`, `error`? |
| `navigation/TabNav` | `SectionNav` | Verify pill strip vs tab-line API compatibility |
| `navigation/Pagination` | `TablePagination` | Can it be used standalone (outside Table)? |
| `display/DataTable` | `Table` | DataTable is data-driven; Table is declarative markup. Need adapter or new component. |

## Common Pitfalls

### Pitfall 1: Card API Differences
**What goes wrong:** ui-v2 Card uses `<Card title="..." subtitle="...">content</Card>` flat API. ds/ Card uses `<Card><CardHeader><CardBody>` subcomponent pattern.
**Why it happens:** The migration is not just an import swap -- the JSX structure changes.
**How to avoid:** For each file, restructure the Card JSX to use subcomponents. This is the most common structural change across all 87 Card usages.
**Warning signs:** Runtime errors about missing children or unexpected props.

### Pitfall 2: Modal Footer Pattern
**What goes wrong:** ui-v2 Modal uses `<ModalActions>` for footer buttons. ds/ Modal uses `footer` prop or different pattern.
**Why it happens:** Different compositional APIs.
**How to avoid:** Check ds/ Modal API before bulk migration. May need to add `ModalActions`-equivalent or use footer prop.

### Pitfall 3: Toast Import Change
**What goes wrong:** ui-v2 uses `import { toast } from '@/components/ui-v2/feedback/Toast'`. Some files also use `react-hot-toast` directly.
**Why it happens:** Mixed toast systems in the codebase.
**How to avoid:** Verify ds/ `toast` function wraps `react-hot-toast` consistently. Standardize all toast calls to ds/ pattern.

### Pitfall 4: PageLayout is Deep Integration
**What goes wrong:** PageLayout wraps Container + PageHeader + HeaderNav + ErrorBoundary + loading/error states. Simply removing it breaks page structure.
**Why it happens:** It provides layout orchestration that no single ds/ component replaces.
**How to avoid:** Build a ds/ PageLayout composite FIRST, then migrate pages. Do not attempt inline replacement for 81 files.

### Pitfall 5: Breaking Production During Migration
**What goes wrong:** Removing ui-v2 directories before all 188 files are migrated breaks production.
**Why it happens:** Missing components cause build failures.
**How to avoid:** Migrate ALL files first, verify build passes, THEN delete directories. Use `grep -rl "@/components/ui-v2" src/` to verify zero remaining references before deletion.

### Pitfall 6: Format Utility Dependency
**What goes wrong:** 7 files import `formatCurrency` from ui-v2 utils. Deleting ui-v2 breaks them.
**Why it happens:** Utility functions bundled with component library.
**How to avoid:** Move format utilities to `src/lib/format.ts` early in the migration process.

## Architecture Patterns

### Migration Execution Order

```
Wave 0: Gap components (build missing ds/ components)
  - ds/ PageLayout composite
  - ds/ Section composite  
  - ds/ LinkButton wrapper
  - Move format utils to src/lib/format.ts
  - Move RefundDialog/RefundHistoryTable to src/components/features/
  - Verify FormGroup -> Field API compatibility
  - Build or adapt DataTable -> Table mapping

Wave 1: Settings area (24 files -- highest count, repetitive pattern)
Wave 2: Private Bookings + Employees (13 + 19 files)
Wave 3: Invoices + Quotes + Rota (13 + 5 + 14 files)
Wave 4: Menu Management + Receipts (13 + 9 files)
Wave 5: Remaining areas (Table Bookings, Events, Customers, Roles, etc.)
Wave 6: Auth + Staff Portal + Public pages (MIG-19 to MIG-28 residual)
Wave 7: Shared components (src/components/features/*, modals/*, etc.)

Post-migration:
  - Verify: grep -rl "@/components/ui-v2" src/ returns 0 results
  - Verify: grep -rl "@/components/ui/" src/ returns 0 results (excluding ui-v2)
  - Verify: npm run build succeeds
  - Delete src/components/ui-v2/
  - Delete src/components/ui/
  - Verify build again
```

### FOH Mode Build (parallel track)

```
Step 1: Modify AppShell to always show Topbar (decouple from showSidebar)
Step 2: Add fohMode prop to Topbar (hides search, bell, New button)
Step 3: Build FohClockBand component
Step 4: Wire FohClockBand into AuthenticatedLayout for FOH users
Step 5: Add avatar/sign-out dropdown to Topbar for FOH mode
```

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Debounced input | Custom debounce hook | `useDebounce` from ui-v2/hooks or build minimal ds/ version | Edge cases with cleanup and stale closures |
| Clock-in/out | New server actions | Existing `clockIn()`/`clockOut()` from `src/app/actions/timeclock.ts` | Already handles employee validation, session management, timezone conversion |
| Format utilities | New formatters | Move existing `src/components/ui-v2/utils/format.ts` to `src/lib/format.ts` | Well-tested, handles UK locale formatting |

## Documentation Updates Required (CLEAN-04)

### CLAUDE.md Lines to Update

| Line | Current | Should Be |
|------|---------|-----------|
| 133 | "Migrating from legacy `PageWrapper`/`Page` pattern to `PageLayout` + `HeaderNav` from `src/components/ui-v2/`" | "All pages use `@/ds` design system components. PageHeader, Card, and other primitives imported from `@/ds`." |
| 311 | "New code uses `src/components/ui-v2/` via the barrel export" | "All components imported from `@/ds` (barrel: `src/ds/index.ts`)" |
| 312 | "Legacy `PageWrapper`/`Page` pattern still exists but being phased out" | Remove line -- no longer applicable |
| 313 | "New pages: use `PageLayout` + `HeaderNav` from `ui-v2`" | "All pages use `PageHeader` + layout patterns from `@/ds`" |
| 314 | "Defined in `src/components/ui-v2/tokens.ts`" | "Design tokens defined in `globals.css` `@theme` block, JS access via `@/ds` tokens" |
| 320 | "`src/components/ui-v2/index.ts` is the single export point" | "`src/ds/index.ts` is the single export point for the design system" |
| 321 | "`src/components/ui-v2/navigation/index.ts` sub-barrel" | Remove line -- ds/ uses flat exports |

### Other Documentation
- `components.json`: Update tailwind config reference or remove file if shadcn/ui is no longer used
- Inline comments referencing "ui-v2 migration" should be removed or updated

## Sources

### Primary (HIGH confidence)
- Direct codebase audit via grep and file reads
- `src/ds/index.ts` and sub-barrel exports -- verified complete component inventory
- `src/components/ui-v2/` directory listing -- verified all legacy components
- `src/lib/foh/user-mode.ts` -- verified FOH detection logic
- `src/ds/shell/AppShell.tsx` -- verified current shell props and topbar coupling
- `src/app/actions/timeclock.ts` -- verified clock-in/out server actions

### Secondary (MEDIUM confidence)
- Component API compatibility between ui-v2 and ds/ versions -- inferred from file structure but not all props verified

## Metadata

**Confidence breakdown:**
- Legacy import audit: HIGH -- based on exhaustive grep of codebase
- Component gap analysis: HIGH -- direct comparison of ds/ and ui-v2 inventories
- FOH infrastructure: HIGH -- read all relevant source files
- Unmigrated screens: HIGH -- checked all 10 screens' imports and current state
- Migration strategy: MEDIUM -- execution order is a recommendation, may need adjustment based on dependency analysis during planning

**Research date:** 2026-05-19
**Valid until:** 2026-06-19 (stable -- internal codebase, no external dependency changes expected)
