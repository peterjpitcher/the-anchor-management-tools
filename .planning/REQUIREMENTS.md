# Requirements: AMS UI Redesign

**Defined:** 2026-05-18
**Core Value:** Every staff member sees a consistent, modern, professional interface matching the design handoff pixel-perfectly.

## v1 Requirements

### Design System Foundation

- [x] **DS-01**: Migrate Tailwind from v3 syntax to v4 native (`@theme`, CSS-first config, remove `tailwind.config.js`)
- [x] **DS-02**: Implement design tokens via `@theme` block (brand palette 50-900, semantic surfaces, borders, text, status colours, shadows, radii, spacing, typography)
- [x] **DS-03**: Set up Inter (400-800) and JetBrains Mono (400-600) via `next/font`
- [ ] **DS-04**: Build Button component (4 variants: primary/secondary/ghost/danger, 3 sizes: sm/md/lg, icon support, loading state)
- [ ] **DS-05**: Build Card component (header with title/subtitle/action, padded body, optional footer)
- [ ] **DS-06**: Build Stat tile component (label, value, delta with direction, icon, hint)
- [ ] **DS-07**: Build Badge component (6 tones: neutral/primary/success/warning/danger/info, optional dot)
- [ ] **DS-08**: Build Tabs component (underline style with count pills)
- [ ] **DS-09**: Build Segmented control component (inline button group with sliding active state)
- [ ] **DS-10**: Build Alert component (4 tones with icon, title, body)
- [ ] **DS-11**: Build Modal component (backdrop, centered card, header/body/footer, configurable width)
- [ ] **DS-12**: Build Avatar component (initials from name, deterministic colour, 4 sizes, AvatarStack with overflow)
- [ ] **DS-13**: Build Table component (header/body/row/cell, hover states, sortable, pagination footer)
- [ ] **DS-14**: Build form controls (Input with icon, Select, Textarea, Checkbox, Radio, Switch)
- [ ] **DS-15**: Build PageHeader component (breadcrumbs, title, subtitle, action buttons)
- [ ] **DS-16**: Build SectionNav horizontal pill strip component
- [ ] **DS-17**: Build Empty state component (icon, title, body, optional action)
- [ ] **DS-18**: Build Toast notification component (colour dot, text, tone)
- [ ] **DS-19**: Build Skeleton shimmer loading component
- [ ] **DS-20**: Build 38+ stroke SVG icon set matching design handoff (16px on 24x24 viewBox, strokeWidth 1.75)

### App Shell

- [ ] **SHELL-01**: Build collapsible sidebar (64px collapsed, 232px expanded on hover, 200ms transition)
- [ ] **SHELL-02**: Implement sidebar navigation groups (Primary, Operations, Staff Ops, Finance, Settings) with correct icons and active indicator
- [ ] **SHELL-03**: Build sticky topbar (52px height, search bar, notification bell with dot, "New" button)
- [ ] **SHELL-04**: Implement sidebar user footer (avatar, name, role)
- [ ] **SHELL-05**: Replace AuthenticatedLayout with new AppShell (sidebar + topbar + page area)
- [ ] **SHELL-06**: Maintain backward compatibility — existing pages render correctly in new shell during migration

### Existing Screen Migrations

- [ ] **MIG-01**: Redesign Dashboard (revenue chart, stat grid, today card, upcoming events, activity feed, mini metrics)
- [ ] **MIG-02**: Redesign Customers page (CRM table, labels, bulk actions, tabs, search/filters)
- [ ] **MIG-03**: Redesign Employees page (master-detail layout, table + detail panel)
- [ ] **MIG-04**: Redesign Private Bookings page (table, deposit tracking, run sheet card)
- [ ] **MIG-05**: Redesign Parking page (table + lot map sidebar + pricing card)
- [ ] **MIG-06**: Redesign Menu Management page (section sidebar + dish table, allergens, availability toggles)
- [ ] **MIG-07**: Redesign Table Bookings (timeline swimlane, floor plan, list view, FOH/BOH/Reports/Settings sub-pages)
- [ ] **MIG-08**: Redesign Rota (weekly grid, Leave/Timeclock/Labour Costs/Payroll/Templates sub-pages)
- [ ] **MIG-09**: Redesign Invoices page (table with tabs, client filter, status badges)
- [ ] **MIG-10**: Redesign Quotes page (table, status tracking)
- [ ] **MIG-11**: Redesign Receipts page (upload card + table, OCR description, tabs)
- [ ] **MIG-12**: Redesign Mileage page (trips/destinations/rates sub-pages)
- [ ] **MIG-13**: Redesign Expenses page (table + category breakdown sidebar with budget progress bars)
- [ ] **MIG-14**: Redesign MGD page (machines table, quarterly readings, return history, HMRC registration)
- [ ] **MIG-15**: Redesign Messages page (3-panel layout: conversation list + thread + contact sidebar)
- [ ] **MIG-16**: Redesign Users page (user table, roles/permissions matrix)
- [ ] **MIG-17**: Redesign Profile page (personal details, security, notifications, sidebar)
- [ ] **MIG-18**: Redesign Settings hub (general toggles, settings groups, sub-page routing)
- [ ] **MIG-19**: Redesign Login page (auth card, email/password, 2FA, Microsoft SSO)
- [ ] **MIG-20**: Redesign Onboarding wizard (6-step flow, sidebar step rail)
- [ ] **MIG-21**: Redesign Staff Portal (clock-in card, shifts, leave, stats)
- [ ] **MIG-22**: Redesign Timeclock Kiosk (full-screen dark mode, staff grid, large clock)
- [ ] **MIG-23**: Redesign Public Booking (hero banner, 3-step wizard, time slots)
- [ ] **MIG-24**: Redesign Public Parking form
- [ ] **MIG-25**: Redesign Booking Confirmation (success state, QR ticket stub)
- [ ] **MIG-26**: Redesign Privacy page (prose layout)
- [ ] **MIG-27**: Redesign Error page (error card with reference code)
- [ ] **MIG-28**: Redesign Unauthorised page (access denied with attempted path)

### New Sections (UI on existing backends)

- [ ] **NEW-01**: Build Events section UI (list view with table, tabs, search/filters, bulk actions, pagination)
- [ ] **NEW-02**: Build Events calendar view
- [ ] **NEW-03**: Build Events board/kanban view
- [ ] **NEW-04**: Build Cashing Up section UI (daily entry form, week-at-a-glance table, category breakdown tiles)
- [ ] **NEW-05**: Build Cashing Up sub-pages (Weekly, Insights, Import)
- [ ] **NEW-06**: Build OJ Projects section UI (Overview, Projects table with budget progress, Clients, Work Types, Time Entries)
- [ ] **NEW-07**: Build Short Links section UI (table with copy button, click analytics, search)

### New Section — Performers (needs backend)

- [ ] **PERF-01**: Design and create performers schema migration (upgrade `performer_submissions`, add genre/fee/rating columns, create `performer_gigs` and `performer_contacts` tables)
- [ ] **PERF-02**: Build Performers server actions (CRUD, booking, rating)
- [ ] **PERF-03**: Build Performers UI (table with genre badges, fee, rating stars, gig count, booking action)
- [ ] **PERF-04**: Add performer FK to events table and wire up event-performer relationship

### Special Modes

- [ ] **MODE-01**: Build FOH-only chromeless mode (no sidebar, locked to table management screen with clock-in band)
- [ ] **MODE-02**: Build Design System documentation page (live component previews, colour swatches, typography scale, spacing, all controls)

### Cleanup

- [ ] **CLEAN-01**: Remove legacy `ui/` components after all pages migrated
- [ ] **CLEAN-02**: Remove `ui-v2/` components after all pages migrated
- [ ] **CLEAN-03**: Remove `tailwind.config.js` after v4 migration complete
- [ ] **CLEAN-04**: Update CLAUDE.md to reflect new design system patterns

## v2 Requirements

### Theming

- **THEME-01**: Dark mode support (full dark theme as specified in design handoff)
- **THEME-02**: Density system (comfortable and spacious presets)
- **THEME-03**: Brand colour switching (5 green variants)

### Enhanced Views

- **VIEW-01**: Events calendar view with drag-and-drop
- **VIEW-02**: Table bookings floor plan editor (editable table positions)
- **VIEW-03**: Global search across all sections

### Real-time

- **RT-01**: Real-time notification system
- **RT-02**: Live dashboard updates

## Out of Scope

| Feature | Reason |
|---------|--------|
| TweaksPanel | Prototype tooling only, not for production |
| Mobile native app | Web-first, mobile responsive is sufficient |
| Database schema redesign | Only new tables for Performers; existing schema unchanged |
| Auth system changes | Existing Supabase Auth + RBAC stays as-is |
| Real-time WebSocket features | Standard request/response sufficient for v1 |
| Density system | Ship compact only; density is polish |
| Brand colour switching | Fixed to Bottle Green for v1 |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| DS-01 | Phase 1 | Complete |
| DS-02 | Phase 1 | Complete |
| DS-03 | Phase 1 | Complete |
| DS-04 | Phase 1 | Pending |
| DS-05 | Phase 1 | Pending |
| DS-06 | Phase 1 | Pending |
| DS-07 | Phase 1 | Pending |
| DS-08 | Phase 1 | Pending |
| DS-09 | Phase 1 | Pending |
| DS-10 | Phase 1 | Pending |
| DS-11 | Phase 1 | Pending |
| DS-12 | Phase 1 | Pending |
| DS-13 | Phase 1 | Pending |
| DS-14 | Phase 1 | Pending |
| DS-15 | Phase 1 | Pending |
| DS-16 | Phase 1 | Pending |
| DS-17 | Phase 1 | Pending |
| DS-18 | Phase 1 | Pending |
| DS-19 | Phase 1 | Pending |
| DS-20 | Phase 1 | Pending |
| SHELL-01 | Phase 1 | Pending |
| SHELL-02 | Phase 1 | Pending |
| SHELL-03 | Phase 1 | Pending |
| SHELL-04 | Phase 1 | Pending |
| SHELL-05 | Phase 1 | Pending |
| SHELL-06 | Phase 1 | Pending |
| MIG-01 | Phase 2 | Pending |
| MIG-02 | Phase 2 | Pending |
| MIG-03 | Phase 2 | Pending |
| MIG-04 | Phase 2 | Pending |
| MIG-05 | Phase 2 | Pending |
| MIG-06 | Phase 2 | Pending |
| MIG-07 | Phase 2 | Pending |
| MIG-08 | Phase 2 | Pending |
| MIG-09 | Phase 2 | Pending |
| MIG-10 | Phase 2 | Pending |
| MIG-11 | Phase 2 | Pending |
| MIG-12 | Phase 2 | Pending |
| MIG-13 | Phase 2 | Pending |
| MIG-14 | Phase 2 | Pending |
| MIG-15 | Phase 2 | Pending |
| MIG-16 | Phase 2 | Pending |
| MIG-17 | Phase 2 | Pending |
| MIG-18 | Phase 2 | Pending |
| MIG-19 | Phase 2 | Pending |
| MIG-20 | Phase 2 | Pending |
| MIG-21 | Phase 2 | Pending |
| MIG-22 | Phase 2 | Pending |
| MIG-23 | Phase 2 | Pending |
| MIG-24 | Phase 2 | Pending |
| MIG-25 | Phase 2 | Pending |
| MIG-26 | Phase 2 | Pending |
| MIG-27 | Phase 2 | Pending |
| MIG-28 | Phase 2 | Pending |
| NEW-01 | Phase 3 | Pending |
| NEW-02 | Phase 3 | Pending |
| NEW-03 | Phase 3 | Pending |
| NEW-04 | Phase 3 | Pending |
| NEW-05 | Phase 3 | Pending |
| NEW-06 | Phase 3 | Pending |
| NEW-07 | Phase 3 | Pending |
| PERF-01 | Phase 3 | Pending |
| PERF-02 | Phase 3 | Pending |
| PERF-03 | Phase 3 | Pending |
| PERF-04 | Phase 3 | Pending |
| MODE-02 | Phase 3 | Pending |
| MODE-01 | Phase 4 | Pending |
| CLEAN-01 | Phase 4 | Pending |
| CLEAN-02 | Phase 4 | Pending |
| CLEAN-03 | Phase 4 | Pending |
| CLEAN-04 | Phase 4 | Pending |

**Coverage:**
- v1 requirements: 71 total
- Mapped to phases: 71
- Unmapped: 0

---
*Requirements defined: 2026-05-18*
*Last updated: 2026-05-18 after roadmap creation -- all 71 requirements mapped to 4 phases*
