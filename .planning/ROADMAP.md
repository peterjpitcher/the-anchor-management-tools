# Roadmap: AMS UI Redesign

## Overview

Transform the Anchor Management Tools from its current three-layer UI system (legacy ui/, transitional ui-v2/, inline styles) into a unified design system matching the Claude Design handoff. Phase 1 establishes the canonical design system and swaps the app shell for all authenticated pages at once. Phase 2 migrates all 28 existing screens into the new design system. Phase 3 builds the 6 new sections (5 UI-only on existing backends, 1 full-stack with schema work). Phase 4 adds special modes, completes cleanup, and removes all legacy UI code.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3, 4): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Design System & App Shell** - Build canonical design system (tokens, 17 components, icons) and deploy new sidebar + topbar shell to all authenticated pages (completed 2026-05-18)
- [ ] **Phase 2: Screen Migrations** - Migrate all 28 existing screens to use ds/ components within the new shell
- [x] **Phase 3: New Sections** - Build 5 new sections (Events, Cashing Up, OJ Projects, Short Links UI on existing backends; Design System docs page) plus Performers removal (completed 2026-05-18)
- [ ] **Phase 4: Modes, Polish & Cleanup** - FOH chromeless mode, remove legacy ui/ and ui-v2/ directories, remove tailwind.config.js, update docs

## Phase Details

### Phase 1: Design System & App Shell
**Goal**: Every authenticated page renders inside a new collapsible sidebar + sticky topbar shell, powered by a canonical design system with consistent tokens, typography, and components -- while all existing functionality continues to work unchanged
**Depends on**: Nothing (first phase)
**Requirements**: DS-01, DS-02, DS-03, DS-04, DS-05, DS-06, DS-07, DS-08, DS-09, DS-10, DS-11, DS-12, DS-13, DS-14, DS-15, DS-16, DS-17, DS-18, DS-19, DS-20, SHELL-01, SHELL-02, SHELL-03, SHELL-04, SHELL-05, SHELL-06
**Success Criteria** (what must be TRUE):
  1. User opens any authenticated page and sees a collapsible sidebar (64px collapsed, 232px expanded) with correct navigation groups, icons, and active indicator for the current page
  2. User sees a sticky topbar with search placeholder, notification bell, and "New" button on every authenticated page
  3. All 17 design system primitives and composites (Button, Card, Stat, Badge, Tabs, Segmented, Alert, Modal, Avatar, Table, form controls, PageHeader, SectionNav, Empty, Toast, Skeleton) render with correct Bottle Green brand tokens and Inter/JetBrains Mono typography
  4. All existing pages continue to function correctly inside the new shell -- no auth regressions, no broken workflows, no layout overflow
  5. Tailwind v4 native syntax is active (`@theme` block in globals.css, `@import "tailwindcss"`, no tailwind.config.js dependency for token resolution)
**Plans**: 4 plans

Plans:
- [x] 01-01-PLAN.md -- Tailwind v4 migration and design token foundation
- [x] 01-02-PLAN.md -- Primitive components (Button, Badge, Avatar, Alert, Modal, form controls, Stat, Skeleton, Empty, Toast)
- [x] 01-03-PLAN.md -- Composite components (Card, PageHeader, SectionNav, Tabs, Segmented, Table, icons)
- [x] 01-04-PLAN.md -- App shell (Sidebar, Topbar, AppShell) and AuthenticatedLayout replacement

### Phase 2: Screen Migrations
**Goal**: Every existing screen uses ds/ components exclusively -- matching the design handoff pixel-perfectly -- with no imports remaining from ui-v2/ in migrated pages
**Depends on**: Phase 1
**Requirements**: MIG-01, MIG-02, MIG-03, MIG-04, MIG-05, MIG-06, MIG-07, MIG-08, MIG-09, MIG-10, MIG-11, MIG-12, MIG-13, MIG-14, MIG-15, MIG-16, MIG-17, MIG-18, MIG-19, MIG-20, MIG-21, MIG-22, MIG-23, MIG-24, MIG-25, MIG-26, MIG-27, MIG-28
**Success Criteria** (what must be TRUE):
  1. User navigates to Dashboard and sees redesigned revenue chart, stat grid, today card, upcoming events, activity feed, and mini metrics -- all using ds/ components
  2. User navigates to any of the 28 screens (Dashboard through Unauthorised page) and sees the design-handoff layout with correct PageHeader, SectionNav, stat tiles, tables, and form controls
  3. No page imports anything from `src/components/ui-v2/` or `src/components/ui/` -- all imports resolve to `@/ds/`
  4. All existing functionality (CRUD, search, filters, pagination, exports, payment flows) works identically to before migration
**Plans**: 5 plans

Plans:
- [x] 02-01-PLAN.md -- Component gap fill (13 new ds/ primitives, Chart composite, recharts, layout CSS) + high-traffic screens (Dashboard, Customers, Employees, Private Bookings)
- [x] 02-02-PLAN.md -- Operations screens (Parking, Menu Management, Table Bookings with 5 sub-pages, Rota with 6 sub-pages)
- [x] 02-03-PLAN.md -- Finance screens (Invoices, Quotes with shared SectionNav, Receipts, Mileage, Expenses, MGD)
- [x] 02-04-PLAN.md -- Communication and settings screens (Messages 3-panel, Users with reusable content, Profile, Settings hub)
- [x] 02-05-PLAN.md -- Auth and standalone-layout screens (Login, Onboarding, Staff Portal, Timeclock, Public Booking, Public Parking, Booking Confirmation, Privacy, Error, Unauthorised)

### Phase 3: New Sections
**Goal**: Five new sections are live and functional -- Events, Cashing Up, OJ Projects, and Short Links built as UI on existing backends; Design System page documenting the component library. Performers section removed from scope.
**Depends on**: Phase 2
**Requirements**: NEW-01, NEW-02, NEW-03, NEW-04, NEW-05, NEW-06, NEW-07, MODE-02
**Success Criteria** (what must be TRUE):
  1. User navigates to Events and sees list view with table/filters/pagination, calendar view with month navigation, and board/kanban view grouped by status -- all powered by existing event server actions
  2. User navigates to Cashing Up, OJ Projects, and Short Links and sees fully redesigned UIs (daily entry, weekly summary, insights for Cashing Up; projects/entries/clients/work-types for OJ Projects; link table with analytics for Short Links) with no new backend work required
  3. User navigates to the Design System page (via Settings) and sees live component previews, colour swatches, typography scale, and icon library
  4. Performers section is removed from sidebar navigation and route structure
**Plans**: 4 plans

Plans:
- [x] 03-01-PLAN.md -- Events section (list, calendar, board views) with drawer-based CRUD and SidebarNav cleanup
- [x] 03-02-PLAN.md -- Cashing Up (5 sub-pages with SectionNav) and Short Links (table + insights)
- [x] 03-03-PLAN.md -- OJ Projects section (overview, projects, entries, clients, work types)
- [x] 03-04-PLAN.md -- Design System documentation page and Performers route removal

### Phase 4: Modes & Cleanup
**Goal**: FOH chromeless mode is live for front-of-house managers, all legacy UI code is removed, and project documentation reflects the new design system as the canonical pattern
**Depends on**: Phase 3
**Requirements**: MODE-01, CLEAN-01, CLEAN-02, CLEAN-03, CLEAN-04
**Success Criteria** (what must be TRUE):
  1. FOH-only user logs in and sees a chromeless interface (no sidebar, no topbar) locked to the table management screen with a clock-in band
  2. The directories `src/components/ui/` and `src/components/ui-v2/` no longer exist -- `grep -r "ui-v2" src/app/ --include="*.tsx"` returns zero results
  3. The file `tailwind.config.js` no longer exists -- all Tailwind configuration lives in CSS via `@theme`
  4. CLAUDE.md documents `src/ds/` as the canonical component system with correct import patterns
**Plans**: 2 plans

Plans:
- [ ] 04-01-PLAN.md -- FOH chromeless mode (AppShell/Topbar FOH props, FohClockBand, layout wiring)
- [ ] 04-02-PLAN.md -- Legacy cleanup (build 6 gap ds/ components, migrate 193 files, delete ui/ and ui-v2/, update CLAUDE.md)

## Progress

**Execution Order:**
Phases execute in numeric order: 1 --> 1.1 --> 1.2 --> 2 --> 2.1 --> 3 --> 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Design System & App Shell | 4/4 | Complete   | 2026-05-18 |
| 2. Screen Migrations | 5/5 | Near Complete (26/28 screens, 18 nested sub-page files remain) | 2026-05-18 |
| 3. New Sections | 4/4 | Complete | 2026-05-18 |
| 4. Modes & Cleanup | 0/2 | Not started | - |
