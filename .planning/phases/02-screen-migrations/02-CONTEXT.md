# Phase 2: Screen Migrations - Context

**Gathered:** 2026-05-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Migrate all 28 existing screens to use ds/ components exclusively — matching the design handoff pixel-perfectly for key screens and faithfully for the rest. Every page imports from `@/ds/` only; no `@/components/ui-v2/` imports remain in migrated pages. All existing functionality (CRUD, search, filters, pagination, exports, payment flows) works identically to before migration.

</domain>

<decisions>
## Implementation Decisions

### Component Gap Strategy
- **D-01:** Build ALL missing ds/ components before migrating screens. Every ui-v2 import must have a ds/ equivalent. This includes: DataTable, FilterPanel, SearchInput, DateTimePicker, FileUpload, Toggle, Drawer, Tooltip, Popover, ConfirmDialog, Dropdown, Menu, Spinner, ProgressBar, Accordion, Calendar, Stepper, and any others discovered during planning.
- **D-02:** Layout approach: match what the design handoff shows. If the handoff uses specific layout patterns, build ds/ components for them. If it just shows cards and sections, use Card + raw Tailwind. No unnecessary abstractions.
- **D-03:** Legacy ui/ imports (5 files in mileage/expenses/mgd) are NOT cleaned up in Phase 2. That stays in Phase 4 scope.

### Design Fidelity
- **D-04:** Pixel-perfect for key high-traffic screens: Dashboard, Customers, Employees, Private Bookings, Table Bookings. Faithful to structure and tokens for remaining screens — layout matches handoff, correct ds/ components used, but exact pixel measurements not enforced.
- **D-05:** ALL sub-pages get migrated. Every tab/sub-page in every screen (Rota's 6 tabs, Mileage's 3, Table Bookings' 4, etc.) is fully migrated to ds/ components.
- **D-06:** Charts: use Recharts library, wrapped with ds/ tokens for consistent styling (brand colours, typography). Dashboard revenue chart and any other data visualisations use this approach.

### Migration Approach
- **D-07:** Rewrite page files entirely. Fresh page.tsx and *Client.tsx files matching the design handoff. Port server actions and data fetching from old code. Clean slate per screen.
- **D-08:** Interactions: where the design handoff shows specific interaction patterns, match them. Where the handoff doesn't specify (or shows a static mockup), preserve existing behaviour.
- **D-09:** Integration code (payment flows, file exports, email triggers, API calls) stays functionally identical. Light refactoring of the UI layer around integrations is acceptable if it improves code quality, but no changes to actual server actions or API calls.

### Claude's Discretion
- Migration ordering within each plan batch
- Exact component API signatures for new ds/ components
- Whether to use Headless UI for complex widgets (Drawer, Popover, Dropdown) or build from scratch
- Responsive breakpoint handling per screen
- Loading/error state design per screen

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Design Handoff (screen designs)
- `/Users/peterpitcher/Library/Mobile Documents/com~apple~CloudDocs/Downloads/ams/project/AMS Redesign.html` — Primary design file, all 34 screen layouts
- `/Users/peterpitcher/Library/Mobile Documents/com~apple~CloudDocs/Downloads/ams/project/ui.jsx` — All component definitions and specs
- `/Users/peterpitcher/Library/Mobile Documents/com~apple~CloudDocs/Downloads/ams/project/styles.css` — Design tokens, colours, spacing, typography
- `/Users/peterpitcher/Library/Mobile Documents/com~apple~CloudDocs/Downloads/ams/project/dashboard.jsx` — Dashboard screen design
- `/Users/peterpitcher/Library/Mobile Documents/com~apple~CloudDocs/Downloads/ams/project/customers.jsx` — Customers screen design
- `/Users/peterpitcher/Library/Mobile Documents/com~apple~CloudDocs/Downloads/ams/project/employees.jsx` — Employees screen design
- `/Users/peterpitcher/Library/Mobile Documents/com~apple~CloudDocs/Downloads/ams/project/private-bookings.jsx` — Private Bookings screen design
- `/Users/peterpitcher/Library/Mobile Documents/com~apple~CloudDocs/Downloads/ams/project/tables.jsx` — Table Bookings screen design
- `/Users/peterpitcher/Library/Mobile Documents/com~apple~CloudDocs/Downloads/ams/project/parking.jsx` — Parking screen design
- `/Users/peterpitcher/Library/Mobile Documents/com~apple~CloudDocs/Downloads/ams/project/menu.jsx` — Menu Management screen design
- `/Users/peterpitcher/Library/Mobile Documents/com~apple~CloudDocs/Downloads/ams/project/rota.jsx` — Rota screen design
- `/Users/peterpitcher/Library/Mobile Documents/com~apple~CloudDocs/Downloads/ams/project/invoices.jsx` — Invoices screen design
- `/Users/peterpitcher/Library/Mobile Documents/com~apple~CloudDocs/Downloads/ams/project/quotes.jsx` — Quotes screen design
- `/Users/peterpitcher/Library/Mobile Documents/com~apple~CloudDocs/Downloads/ams/project/receipts.jsx` — Receipts screen design
- `/Users/peterpitcher/Library/Mobile Documents/com~apple~CloudDocs/Downloads/ams/project/mileage.jsx` — Mileage screen design
- `/Users/peterpitcher/Library/Mobile Documents/com~apple~CloudDocs/Downloads/ams/project/expenses.jsx` — Expenses screen design
- `/Users/peterpitcher/Library/Mobile Documents/com~apple~CloudDocs/Downloads/ams/project/mgd.jsx` — MGD screen design
- `/Users/peterpitcher/Library/Mobile Documents/com~apple~CloudDocs/Downloads/ams/project/messages.jsx` — Messages screen design
- `/Users/peterpitcher/Library/Mobile Documents/com~apple~CloudDocs/Downloads/ams/project/users.jsx` — Users screen design
- `/Users/peterpitcher/Library/Mobile Documents/com~apple~CloudDocs/Downloads/ams/project/profile.jsx` — Profile screen design
- `/Users/peterpitcher/Library/Mobile Documents/com~apple~CloudDocs/Downloads/ams/project/settings.jsx` — Settings screen design
- `/Users/peterpitcher/Library/Mobile Documents/com~apple~CloudDocs/Downloads/ams/project/login.jsx` — Login screen design
- `/Users/peterpitcher/Library/Mobile Documents/com~apple~CloudDocs/Downloads/ams/project/onboarding.jsx` — Onboarding screen design
- `/Users/peterpitcher/Library/Mobile Documents/com~apple~CloudDocs/Downloads/ams/project/staff-portal.jsx` — Staff Portal screen design
- `/Users/peterpitcher/Library/Mobile Documents/com~apple~CloudDocs/Downloads/ams/project/timeclock.jsx` — Timeclock Kiosk screen design
- `/Users/peterpitcher/Library/Mobile Documents/com~apple~CloudDocs/Downloads/ams/project/public-booking.jsx` — Public Booking screen design
- `/Users/peterpitcher/Library/Mobile Documents/com~apple~CloudDocs/Downloads/ams/project/public-parking.jsx` — Public Parking screen design
- `/Users/peterpitcher/Library/Mobile Documents/com~apple~CloudDocs/Downloads/ams/project/booking-confirmation.jsx` — Booking Confirmation screen design
- `/Users/peterpitcher/Library/Mobile Documents/com~apple~CloudDocs/Downloads/ams/project/error.jsx` — Error screen design
- `/Users/peterpitcher/Library/Mobile Documents/com~apple~CloudDocs/Downloads/ams/project/unauthorized.jsx` — Unauthorised screen design

### Phase 1 artifacts
- `.planning/phases/01-design-system-app-shell/01-CONTEXT.md` — Phase 1 decisions (component structure, icon strategy, TW4 approach)
- `src/ds/index.ts` — ds/ barrel export (source of truth for available components)

### Project requirements
- `.planning/REQUIREMENTS.md` — MIG-01 through MIG-28 requirement definitions
- `.planning/ROADMAP.md` — Phase 2 success criteria and plan structure

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets (from Phase 1)
- 15 primitives: Button, Badge, Avatar, AvatarStack, Alert, Modal, Skeleton, Empty, Toast, Stat, Input, Select, Textarea, Checkbox, Radio, Switch
- 6 composites: Card, PageHeader, SectionNav, Tabs, Segmented, Table
- 47 icons via Icon component
- AppShell with Sidebar + Topbar (already deployed)
- Design tokens via @theme in globals.css + tokens/index.ts for JS

### Established Patterns
- Server Components for page-level data fetching, Client Components for interactivity
- Server actions in `src/app/actions/` — one file per domain
- `fromDb<T>()` not used; manual field-by-field mapping in queries
- Permission checks via `checkUserPermission()` in every action
- Audit logging via `logAuditEvent()` on every mutation

### Integration Points
- 200 files import from `@/components/ui-v2` — these are the migration targets
- 5 files import from legacy `@/components/ui/` — deferred to Phase 4
- PageLayout (112 uses), Card (107), Button (99) are the most common imports
- Top ui-v2 components by usage: PageLayout, Card, Button, Input, Alert, Badge, toast, Select, FormGroup, Section, EmptyState

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches. User trusts Claude's recommendation on ordering and batching.

</specifics>

<deferred>
## Deferred Ideas

- Legacy ui/ cleanup (5 files in mileage/expenses/mgd) — Phase 4 scope
- Dark mode theming of migrated screens — v2 scope
- Density system (comfortable/spacious) — v2 scope

</deferred>

---

*Phase: 02-screen-migrations*
*Context gathered: 2026-05-18*
