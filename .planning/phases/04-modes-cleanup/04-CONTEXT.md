# Phase 4 Context: Modes, Polish & Cleanup

**Created:** 2026-05-19
**Phase:** 4 — Modes, Polish & Cleanup
**Requirements:** MODE-01, CLEAN-01, CLEAN-02, CLEAN-03, CLEAN-04

## Decisions

### 1. FOH Chromeless Mode Behaviour

**Decision:** Keep the existing topbar for FOH users (no custom FOH bar). Hide the sidebar (already done via `showSidebar={!fohOnlyMode}`). Lock FOH users to `/table-bookings/foh` only — no access to BOH, Reports, or Settings sub-pages. Sign out via a small avatar dropdown in the topbar corner.

**Clock-in band:** A coloured top banner strip below the topbar, showing clock-in status and action button. Integrates with the existing timeclock system (`clock_events` table and timeclock server actions). Shows "You are clocked in since HH:MM" with Clock Out button when active, or "Not clocked in" with Clock In button when inactive.

**Key files:**
- `src/app/(authenticated)/AuthenticatedLayout.tsx` — already has `fohOnlyMode` and `showSidebar={!fohOnlyMode}`
- `src/lib/foh/user-mode.ts` — `isFohOnlyUser()` detection (user has ONLY `table_bookings:view` permissions)
- `src/app/(authenticated)/table-bookings/foh/` — existing FOH page and components
- `src/ds/shell/AppShell.tsx` — `showSidebar` prop already supported

**Implementation:** Add a `showTopbarSearch`, `showTopbarActions` prop to AppShell (or detect FOH mode) to hide search/notifications/"New" button for FOH users. Build a `FohClockBand` component that fetches current clock status and renders the banner. Wire into the FOH page layout.

### 2. Legacy Cleanup Scope — Migrate All 140 Files

**Decision:** Migrate ALL 140 files that import from `ui-v2/` and all 5 files importing from `ui/` to use `ds/` equivalents. After migration, delete both `src/components/ui/` and `src/components/ui-v2/` directories entirely.

**Scope breakdown:**
- 134 files in `(authenticated)/` area — these are sub-pages, settings panels, and detail views that weren't fully migrated in Phase 2
- 6 files in auth/public areas (Login, Staff Portal, Public Booking, etc.)
- The 10 unmigrated screens (MIG-19 through MIG-28) get **full redesigns** matching the design handoff style, not just import swaps

**Key areas with many remaining imports:**
- Private bookings (main + 8 sub-pages): settings, calendar, SMS queue, new, edit, items, communications, messages
- Rota (templates, payroll, leave): 6 files
- Receipts (vendors, monthly, missing-expense, bulk, PnL): 9+ files  
- Settings (calendar-notes, pay-bands, menu-target, business-hours, audit-logs, api-keys, table-bookings, message-templates, background-jobs): 12+ files
- Employees (main, birthdays, new, detail, edit): 5 files
- Customers (main, insights, detail): 3 files
- Auth pages (login, reset-password, booking-portal): 4 files
- Staff portal (leave, leave request form): 2 files

### 3. tailwind.config.js — Already Removed

**Decision:** CLEAN-03 is already satisfied. `tailwind.config.js` was removed during Phase 1's Tailwind v4 migration. `globals.css` uses `@theme` block as the canonical token source. No action needed.

### 4. Documentation Update — Full Sweep

**Decision:** Comprehensive documentation update covering:
- **CLAUDE.md** (project-level): Update to reference `ds/` as canonical component system, remove all ui-v2 references, update import patterns
- **Design System page** (`/settings/design-system`): Update with any new components or patterns added during cleanup
- **Inline code comments**: Sweep for any comments referencing ui-v2, legacy patterns, or migration state that are now outdated

## Code Context

**FOH mode infrastructure (already exists):**
- `src/lib/foh/user-mode.ts` — `isFohOnlyUser(permissions)` checks user has ONLY `table_bookings` module permissions
- `AuthenticatedLayout.tsx` lines 24-28: `fohOnlyMode` computed from permissions
- `AuthenticatedLayout.tsx` line 144: `showSidebar={!fohOnlyMode}` already hides sidebar
- `AuthenticatedLayout.tsx` lines 86-93: Redirect non-FOH paths to `/table-bookings/foh`

**Timeclock system (for clock-in band):**
- `src/app/actions/timeclock.ts` — clock in/out server actions
- `src/app/(timeclock)/` — existing kiosk interface
- `clock_events` table in Supabase

**Legacy directories to delete:**
- `src/components/ui/` — contains only `SortableHeader.tsx`
- `src/components/ui-v2/` — contains: display, feedback, forms, hooks, layout, navigation, overlay, refunds, tokens.ts, types.ts, utility, utils, GlobalSearch.tsx, index.ts

**ds/ barrel export:** `src/ds/index.ts` — all new imports should use `@/ds`

## Deferred Ideas

- Dark mode support (v2 THEME-01)
- Density system (v2 THEME-02)
- Brand colour switching (v2 THEME-03)
- Drag-and-drop on Events calendar (v2 VIEW-01)
- Floor plan editor for Table Bookings (v2 VIEW-02)
- Global search functionality (v2 VIEW-03)
