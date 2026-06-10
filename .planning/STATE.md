---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: in-progress
stopped_at: Completed 04-02-PLAN.md
last_updated: "2026-05-19T07:24:01Z"
progress:
  total_phases: 4
  completed_phases: 4
  total_plans: 15
  completed_plans: 15
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-18)

**Core value:** Every staff member sees a consistent, modern, professional interface matching the design handoff pixel-perfectly.
**Current focus:** Phase 04 — modes-cleanup (next)

## Current Position

Phase: 04 (modes-cleanup) — COMPLETE
Current Plan: 2 of 2 (all complete)
Completed: 04-01 (FOH Chromeless Mode), 04-02 (UI Import Consolidation)

## Performance Metrics

**Velocity:**

- Total plans completed: 0
- Average duration: -
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**

- Last 5 plans: -
- Trend: -

*Updated after each plan completion*
| Phase 01 P01 | 8min | 2 tasks | 10 files |
| Phase 01 P02 | 5min | 2 tasks | 16 files |
| Phase 01 P03 | 5min | 2 tasks | 11 files |
| Phase 01 P04 | 8min | 3 tasks | 10 files |
| Phase 02-screen-migrations P01 | 128min | 3 tasks | 26 files |
| Phase 02-screen-migrations P04 | 7min | 2 tasks | 10 files |
| Phase 02-screen-migrations P02 | 17min | 3 tasks | 19 files |
| Phase 02-screen-migrations P03 | 45min | 2 tasks | 13 files |
| Phase 03-new-sections P02 | 12min | 2 tasks | 27 files |
| Phase 03-new-sections P01 | 12min | 2 tasks | 14 files |
| Phase 03-new-sections P03 | 18min | 2 tasks | 14 files |
| Phase 03-new-sections PP04 | 6min | 2 tasks | 7 files |
| Phase 04-modes-cleanup P01 | 10min | 2 tasks | 5 files |
| Phase 04-modes-cleanup P02 | 45min | 3 tasks | 333 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: Tailwind v4 migration is step 1 of Phase 1 -- everything depends on @theme tokens
- [Roadmap]: AppShell replaces AuthenticatedLayout as single pivot point -- swaps chrome for all pages at once
- [Roadmap]: Performers isolated in Phase 3 due to schema risk (new tables + FK changes)
- [Roadmap]: 5 of 6 new sections are UI-only work (backends already exist in production)
- [Roadmap]: MODE-02 (Design System page) grouped with Phase 3 new sections, not Phase 4
- [Phase 01]: Preserved legacy HSL CSS vars for backward compatibility during v3-to-v4 transition
- [Phase 01]: Manual Tailwind v4 migration after codemod partial failure -- @apply with responsive prefixes unsupported in v4
- [Phase 01]: @theme block in globals.css is canonical token source; @utility replaces @layer utilities @apply
- [Phase 01]: Button icon props accept ReactNode for decoupling from Icon component
- [Phase 01]: Form controls use button+ARIA roles instead of hidden native inputs for full style control
- [Phase 01]: Avatar uses static Tailwind bg-[#hex] classes for deterministic palette (6 colors, purge-safe)
- [Phase 01]: paths.tsx uses JSX fragments for multi-element SVG icons; Table is fully client-side due to sortable headers; 46 icons built exceeding 38 minimum
- [Phase 01]: CSS-only sidebar expand/collapse via :hover/:focus-within -- no JavaScript state needed
- [Phase 01]: Surgical AuthenticatedLayout swap preserving all auth/FOH/permission/modal logic intact
- [Phase 02-screen-migrations]: Keep toast utility from ui-v2 as acceptable migration exception; domain components (CustomerForm, DeleteBookingButton, etc.) preserved unchanged
- [Phase 02-screen-migrations]: Use _components/ subdirectory pattern for migrated client components; ds/ API differences documented (Tabs: activeTab/onTabChange, Select: options array, Empty: description, TablePagination: page/totalItems)
- [Phase 02-screen-migrations]: Settings hub embeds UsersContent, RolesContent, ProfileClient via SectionNav state-based rendering; ds/ Alert/Badge use 'tone' not 'variant', ConfirmDialog uses 'message' not 'description'
- [Phase 02-screen-migrations]: Table Bookings and Rota sub-pages use demo data for initial ds/ buildout; real data wiring happens when page.tsx switches to new client components
- [Phase 02-screen-migrations]: CardHeader requires title prop (not children), Badge has no size prop, ProgressBar value is 0-100 pct, Tabs uses tabs prop (not items)
- [Phase 02-screen-migrations]: Invoices/Quotes share FINANCE_SECTION_NAV constant; SectionNav in server page.tsx for static href nav; ReceiptsClient minimal migration (sub-components retain ui-v2); Toast exception preserved
- [Phase 03-new-sections]: Cashing Up uses shared layout.tsx with SectionNav — permission check once at layout level
- [Phase 03-new-sections]: Short Links uses SectionNav with Links/Insights navigation; old components/ directory fully deleted
- [Phase 03-new-sections]: Drawer-based CRUD replaces route-based /events/new and /events/[id]/edit per D-06; events/[id] redirects to /events
- [Phase 03-new-sections]: Board view is read-only (no drag-and-drop) per D-04; CalendarGrid uses weekStartsOn: 1 (Monday)
- [Phase 03-new-sections]: OJ Projects: Split SectionNav into OJProjectsNav client component for path-aware active state; derive clients from project vendor data
- [Phase 03-new-sections]: Design System page is a server component with static showcase and anchor navigation (per D-19, D-20, D-22); Performers route fully deleted per D-01
- [Phase 04-modes-cleanup]: FOH chromeless mode uses fohMode boolean prop threaded from AuthenticatedLayout through AppShell to Topbar; FohClockBand integrates with existing timeclock server actions; employee ID resolved via email_address match
- [Phase 04-modes-cleanup]: Backward-compat approach over mass consumer rewrite: ds/compat/ wrappers + deprecated compat props rather than editing 190+ files
- [Phase 04-modes-cleanup]: Toggle as separate compat wrapper bridging event-based onChange to Switch boolean API
- [Phase 04-modes-cleanup]: SidebarGroup/SidebarItem as real JSX components (not just types) for AppNavigation children-based API

### Pending Todos

None yet.

### Blockers/Concerns

- Tailwind v3-to-v4 migration is the critical first step -- dynamic class construction patterns must be audited
- ~~Three concurrent UI systems (ui/, ui-v2/, new ds/) is the top risk until Phase 4 cleanup completes~~ RESOLVED: ui/ and ui-v2/ deleted, single @/ds system
- AuthenticatedLayout.tsx is historically fragile (middleware was disabled after a Vercel incident)

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260519-ice | Restore events detail page with attendees, marketing links, promotion content, and full metadata display | 2026-05-19 | 95c18f0d | [260519-ice-restore-events-detail-page-with-attendee](./quick/260519-ice-restore-events-detail-page-with-attendee/) |
| 260610-bop | Delete dead unauthenticated RLS-bypassing phone-cleanup server actions (audit finding F5) | 2026-06-10 | 98dadb72 | [260610-bop-delete-dead-unauthenticated-fix-phone-nu](./quick/260610-bop-delete-dead-unauthenticated-fix-phone-nu/) |

## Session Continuity

Last activity: 2026-06-10 - Completed quick task 260610-bop: Delete dead unauthenticated phone-cleanup actions (audit F5)
Stopped at: Completed 04-02-PLAN.md — All phases complete
Resume file: .planning/ROADMAP.md
