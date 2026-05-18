# Phase 3: New Sections - Context

**Gathered:** 2026-05-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Build 5 new sections as UI on existing backends (Events, Cashing Up, OJ Projects, Short Links) plus an internal Design System documentation page. Performers section has been removed entirely from scope (nav, pages, actions, schema — all dropped). All sections use ds/ components exclusively. No new backend/schema work required — all server actions and services already exist in production.

</domain>

<decisions>
## Implementation Decisions

### Performers — REMOVED
- **D-01:** Performers section removed entirely from the project. Remove from sidebar navigation, delete the route at `src/app/(authenticated)/performers/`, and do not build PERF-01 through PERF-04. The existing `performer_submissions` action file can remain but is not wired to any UI.

### Events Section
- **D-02:** Three views (List, Calendar, Board) — Claude decides the view-switching pattern (Segmented control vs SectionNav) based on the design handoff
- **D-03:** Board/kanban columns use lifecycle stages: Idea → Planned → Confirmed → Promoted → Completed → Cancelled
- **D-04:** Board view is read-only — no drag-and-drop. Click an event card to open it; change status in the detail/edit drawer
- **D-05:** Calendar view shows mini event cards (name + time + category badge) per cell, not just dots
- **D-06:** Create/edit events via modal/drawer flow over the list — not separate routes. Flatten existing /events/new and /events/[id]/edit into drawer-based patterns
- **D-07:** Event checklists appear both inside the event detail drawer AND as a separate cross-event todo overview page (/events/todo)
- **D-08:** Full filter panel on list view: category, date range, status, and search by name
- **D-09:** Wire up existing AI content generation (SEO + promotion) and image upload actions in the event drawer
- **D-10:** Existing event server actions, EventService, and category/checklist/content/image sub-actions are all preserved — UI-only rebuild

### Cashing Up Section
- **D-11:** All 5 sub-pages redesigned: Dashboard, Daily, Weekly, Insights, Import
- **D-12:** Follow the cashing-up.jsx design handoff exactly for layout, including the daily entry form — new layout and grouping as designed, not just a reskin
- **D-13:** Existing CashingUpService and all server actions preserved — UI-only rebuild

### OJ Projects Section
- **D-14:** Full redesign of all sub-sections: Overview, Projects (with budget progress), Entries (time tracking), Clients, Work Types
- **D-15:** Follow the projects.jsx design handoff exactly
- **D-16:** Existing backend is comprehensive (entries, projects, work-types, clients, recurring charges, vendor settings, client statements/balances) — UI-only rebuild

### Short Links Section
- **D-17:** Redesign per the short-links.jsx design handoff — not just a reskin
- **D-18:** Existing modals (create/edit, analytics), insights sub-page with campaign/channel charts, and ShortLinkService all preserved — UI-only rebuild

### Design System Page
- **D-19:** Full design system documentation: colour palette swatches, typography scale, spacing, icons grid, AND all component examples
- **D-20:** Single scrollable page with anchor links — not SectionNav sub-routes
- **D-21:** NOT linked from the sidebar navigation — accessible via the /settings page instead
- **D-22:** Claude decides interactivity level (static showcase vs interactive playground) based on effort vs value for an internal tool

### Claude's Discretion
- Events view-switching pattern (Segmented control vs SectionNav tabs)
- Section build ordering and plan grouping within the 4-plan structure
- Design System page interactivity level
- Responsive breakpoint handling per section
- Loading/error/empty state design per section
- Component API choices for any new ds/ components needed

### Folded Todos
None — no pending todos matched this phase.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Design Handoff (Phase 3 screens)
- `/Users/peterpitcher/Library/Mobile Documents/com~apple~CloudDocs/Downloads/ams/project/screens/events.jsx` — Events section design (list, calendar, board views)
- `/Users/peterpitcher/Library/Mobile Documents/com~apple~CloudDocs/Downloads/ams/project/screens/cashing-up.jsx` — Cashing Up section design (dashboard, daily, weekly, insights, import)
- `/Users/peterpitcher/Library/Mobile Documents/com~apple~CloudDocs/Downloads/ams/project/screens/projects.jsx` — OJ Projects section design (overview, projects, entries, clients, work types)
- `/Users/peterpitcher/Library/Mobile Documents/com~apple~CloudDocs/Downloads/ams/project/screens/short-links.jsx` — Short Links section design (table, analytics, insights)

### Design Handoff (shared)
- `/Users/peterpitcher/Library/Mobile Documents/com~apple~CloudDocs/Downloads/ams/project/ui.jsx` — Component definitions and specs
- `/Users/peterpitcher/Library/Mobile Documents/com~apple~CloudDocs/Downloads/ams/project/styles.css` — Design tokens, colours, spacing, typography

### Phase 1 & 2 artifacts
- `.planning/phases/01-design-system-app-shell/01-CONTEXT.md` — Phase 1 decisions (ds/ structure, icons, Tailwind v4)
- `.planning/phases/02-screen-migrations/02-CONTEXT.md` — Phase 2 decisions (migration approach, gap fill strategy, chart patterns)
- `src/ds/index.ts` — ds/ barrel export (source of truth for available components)

### Project requirements
- `.planning/REQUIREMENTS.md` — NEW-01 through NEW-07, MODE-02 requirement definitions
- `.planning/ROADMAP.md` — Phase 3 success criteria and plan structure

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets (from Phase 1 & 2)
- Full ds/ component library: 20+ primitives, 7+ composites, 47 icons, AppShell
- Chart composite wrapping Recharts with ds/ tokens
- Drawer, ConfirmDialog, Dropdown, Popover, Tooltip — all built in Phase 2
- DataTable, FilterPanel, SearchInput, DateTimePicker, FileUpload — gap-filled in Phase 2

### Existing Backends (no changes needed)
- **Events:** `src/app/actions/events.ts` + 5 sub-action files (categories, checklist, content, images, marketing-links), `src/services/events.ts` + 3 sub-services
- **Cashing Up:** `src/app/actions/cashing-up.ts`, `cashing-up-import.ts`, `daily-summary.ts`, `src/services/cashing-up.service.ts`
- **OJ Projects:** `src/app/actions/oj-projects/` directory (entries, projects, work-types, clients, recurring charges, vendor settings, client statements/balances) with tests
- **Short Links:** `src/app/actions/short-links.ts`, `src/services/short-links.ts`

### Existing Routes (to be rebuilt)
- Events: `src/app/(authenticated)/events/` — page.tsx + new/ + [id]/ + [id]/edit/ + todo/
- Cashing Up: `src/app/(authenticated)/cashing-up/` — dashboard/ + daily/ + weekly/ + insights/ + import/
- OJ Projects: `src/app/(authenticated)/oj-projects/` — page.tsx + clients/ + entries/ + work-types/ + projects/ + projects/[id]/
- Short Links: `src/app/(authenticated)/short-links/` — page.tsx + insights/ (with AllLinksTab, CampaignsTab, chart components)

### Integration Points
- Sidebar navigation in `src/ds/shell/SidebarNav.tsx` — remove Performers, keep all others
- Settings page — add Design System link
- @dnd-kit already in project (but NOT used for Events board — decision D-04)

</code_context>

<specifics>
## Specific Ideas

- Events board uses lifecycle stages (Idea → Planned → Confirmed → Promoted → Completed → Cancelled) — not simple time-based grouping
- Calendar view shows mini event cards with name, time, and category badge — not just colour dots
- Event create/edit is drawer-based (modal over list), not separate page routes — this is a pattern change from the existing nested routes
- Cashing Up daily form follows the design handoff layout exactly — not just a component swap
- Design System page lives under /settings, not in the main sidebar — it's a developer/admin reference, not a daily-use section

</specifics>

<deferred>
## Deferred Ideas

- Performers section — removed from project entirely (user decision, not deferred)
- Event drag-and-drop on board view — could add in future if workflow demands it
- Dark mode for Design System page — deferred to v2 theming phase

</deferred>

---

*Phase: 03-new-sections*
*Context gathered: 2026-05-18*
