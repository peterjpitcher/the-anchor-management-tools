# UI component standardisation audit

Date: 15 July 2026

Status: baseline audit captured before implementation. Batch 1 progress is tracked in `tasks/todo.md`.

## Outcome

The application already has a useful design system under `src/ds`, but the migration to it is incomplete. The main problem is not that every area needs a new design. It is that old compatibility components, raw HTML controls, local variants and copied domain components remain active beside the newer components.

The correct goal is:

- the fewest **interaction patterns**, not the fewest React functions;
- one public component for each distinct job;
- route-specific components only for real business behaviour;
- mobile behaviour built into shared components rather than repaired page by page;
- automated rules that stop old patterns returning.

Trying to reduce the literal React component count too aggressively would create larger files such as the current recruitment client and make the app harder to maintain. The target should be fewer public patterns with sensibly-sized domain components.

## Scope and evidence

At the time of the baseline audit, the tracked source contained:

- 159 page routes, including 121 authenticated routes;
- 514 production TSX files;
- 690 detected component functions/classes (671 after implementation batches 1 and 2);
- 300 production TSX files importing the design system;
- 84 directly exported design-system component declarations;
- 20 exported compatibility components that are explicitly deprecated;
- 136 compatibility-component imports across 86 source files.

The live component index is in `tasks/ui-component-index.csv`. Every current component has a final decision in `tasks/ui-component-consolidation-register.csv`. The per-section baseline measurements are in `tasks/ui-section-matrix.csv`.

The audit combined:

- the live OJ Projects desktop screens supplied with the request;
- the complete route and navigation map;
- the current design-system source;
- every tracked production TSX file;
- import, component, raw-control, table, modal, colour and mobile-pattern scans;
- production import tracing to identify copied and test-only components.

The signed-in production UI was checked in Chrome at 320, 375, 768 and 1280px. There was no body-level horizontal overflow, but Overview, Projects, Clients and Work Types still relied on horizontally scrolling tables on phones; Entries already used mobile cards. These checks confirm the live baseline. The local card-list replacements still need a final browser check after deployment.

## Component index summary

| Layer | Detected components | Intended treatment |
|---|---:|---|
| Route entries | 193 | Keep as Next.js route boundaries, not reusable UI |
| Route-local components | 267 | Keep only when they contain domain-specific behaviour |
| Shared domain components | 118 | Consolidate repeated business patterns here |
| DS primitives | 39 | Keep a smaller canonical public set |
| DS composites | 27 | Merge overlapping page, table and navigation patterns |
| DS shell | 10 | Keep; strengthen mobile and remove dead controls |
| DS compatibility | 16 | Migrate consumers and delete |
| DS icon component | 1 | Make this the standard icon entry point |

## Highest-leverage components

These import counts show where improving one component will benefit the most screens.

| Component | Files importing it | Enhancement leverage |
|---|---:|---|
| Button | 175 | Action hierarchy, loading, disabled state and mobile touch targets |
| Card | 132 | Standard spacing, headers and interactive-card accessibility |
| Input | 106 | Labels, errors, sizing and mobile input behaviour |
| Badge | 97 | All status and category presentation |
| Alert | 93 | Inline errors, warnings and empty/error separation |
| toast | 89 | Consistent mutation feedback |
| Select | 78 | Form spacing, errors and mobile controls |
| PageLayout | 74 | Page headings, actions, navigation, loading and responsive layout |
| Textarea | 57 | Form spacing, errors and mobile sizing |
| ConfirmDialog | 45 | Every destructive or high-impact action |
| Modal | 44 | Focus, mobile sheets and form action placement |
| Checkbox | 34 | Selection, forms and accessibility |
| Table | 29 | Simple tabular display and contained scrolling |
| DataTable | 20 | Sorting, selection, responsive cards and list behaviour |
| IconButton | 15 | Repeated table actions and mobile action density |

## Confirmed fragmentation

### 1. The compatibility layer is still part of the public API

`src/ds/index.ts` exports all compatibility components. They are explicitly marked as temporary, but remain easy to import.

Current live usage includes:

- `FormGroup`: 49 files;
- `EmptyState`: 30 files;
- `ModalActions`: 13 files;
- `Form`: 7 files;
- `StatGroup`: 5 files;
- `TabNav`, `SortableHeader`, `DrawerActions`, `FormSection`, `FilterPanel`, `CardTitle` and `CardDescription`: 3 files each.

This means enhancements to `Field`, `Empty`, `Modal`, `Stat`, `Tabs` or `DataTable` do not reach every screen.

Decision: stop exporting `compat` from the public barrel after its consumers have been migrated. Add a restricted-import rule immediately so no new compatibility usage is introduced.

### 2. Two page-shell patterns

`PageLayout` is used by 74 files and `PageHeader` by 30 files. `PageLayout` also contains its own separate mobile and desktop headings, raw buttons and hardcoded grey colours.

Decision: `PageLayout` becomes the only route-facing page shell. It should internally compose a tokenised `PageHeader`, `SectionNav`, toolbar and page-state area. `PageHeader` can remain an internal building block but should no longer be selected independently by pages.

### 3. Three list/table approaches plus raw tables

Current use:

- `DataTable` appears in 20 files;
- only 8 files provide a deliberate `renderMobileCard`;
- the compound `Table` appears in 31 files;
- raw `<table>` appears in 28 files;
- `Pagination` and `TablePagination` both remain public.

The simple `Table` forces a 560px minimum width and horizontal scroll. `DataTable` can make mobile cards, but switches using `window.innerWidth`, which creates a client-only layout decision and can flash the wrong layout during hydration.

Decision:

- use `DataTable` for searchable, sortable, selectable or actionable entity lists;
- give `DataTable` a good automatic mobile-card layout, with custom cards only when necessary;
- use `Table` only for small read-only matrices and report data;
- make sortable `TableHead` render a real button with `aria-sort` and keyboard support;
- keep only `Pagination`; remove `TablePagination` after migration;
- forbid raw tables outside approved report/chart components.

### 4. Forms have three field patterns

The application uses `FormGroup` in 49 files, `Field` in 12, and label/error props directly on `Input`, `Select` and `Textarea`. There are no current production uses of React Hook Form even though the project standard names it, and only four source files contain an unsaved-change guard.

Decision:

- `Field` owns label, hint, required state, error text and ARIA links;
- `Input`, `Select`, `Textarea`, `Checkbox`, `Radio`, `Switch`, `DateTimePicker` and `FileUpload` own only the control itself;
- one documented form-state pattern is used for both client forms and server-action forms;
- large forms get a shared dirty-state guard;
- remove `FormGroup` and the duplicated field chrome from individual controls after migration.

### 5. Actions are composed locally

The supplied OJ Projects screens show the result clearly: Clients renders text ghost buttons while Work Types and Overview render icon buttons. Both are valid components, but no shared row-action policy exists.

Decision: add one `RowActions` composite.

- one or two common actions: icon buttons with tooltip and accessible label;
- three or more actions: a single actions dropdown;
- destructive action last, visually separated, always confirmed;
- row action area never wraps vertically on desktop;
- mobile action menu uses a 44px target;
- page-level primary actions remain labelled `Button` components.

Local `SubmitButton` wrappers should normally be replaced by `Button loading={...}`. Eight different local components currently use the name `SubmitButton`.

### 6. Overlays are only partly standardised

There are 38 named Modal/Dialog components. The shared `Modal`, `Drawer` and `ConfirmDialog` are good foundations, but there are still 26 hand-built `fixed inset-0` overlays in 19 files and native `confirm()` calls in 17 files.

Decision:

- normal editing: `Modal`;
- supporting detail without navigation: `Drawer`;
- destructive/high-impact confirmation: `ConfirmDialog`;
- no route-local focus trap, backdrop or Escape handling;
- no native `confirm()` or `alert()`.

### 7. Feedback has two toast systems

The DS toast wrapper is imported in 89 files, while 55 files still import `react-hot-toast` directly.

Decision: only import `toast` from `@/ds`. Add an ESLint restricted import for `react-hot-toast` outside the DS implementation.

### 8. Icons have three sources

Current production files include:

- 96 files importing Heroicons;
- 31 files importing Lucide;
- 31 files importing the DS icon module;
- 15 hand-written SVG instances in application/shared components.

Decision: application code uses `Icon` from the DS. Add missing icons to the DS registry. Allow direct icon-library imports only inside `src/ds/icons` and specialised visualisations.

### 9. Colours bypass semantic tokens

The automated scan found 5,327 hardcoded Tailwind colour utilities across 257 files. Some are valid chart palettes or user-visible status distinctions, but most page chrome should use semantic tokens such as `text-text`, `bg-surface`, `border-border`, `text-danger` and `bg-warning-soft`.

Decision: migrate shared components first, then pages. Document chart/data-series palettes as the only common exception. Add a lint check for new hardcoded UI colours after the baseline is reduced.

### 10. Mobile behaviour is partly global rather than component-owned

`globals.css` currently attempts to repair the whole app using broad selectors:

- all buttons/roles get global minimum sizes;
- all medium/large grids are forced to one column with `!important`;
- all tables are forced to 560px minimum width;
- body and main overflow are hidden.

These rules hide overflow symptoms and can override deliberate component layouts. They cannot make a dense table, toolbar or action group genuinely usable on a phone.

Decision: move mobile behaviour into `PageLayout`, `DataTable`, `Modal`, `Drawer`, `RowActions`, filter toolbars and form components. Remove broad global repairs once consumers are migrated.

## Confirmed duplicate or stale implementations

| Duplication | Evidence | Required action |
|---|---|---|
| Invoice list client | The live page imports `_components/InvoicesClient`, while tests import the older root `InvoicesClient` | Move tests to the live component and delete the stale file |
| User list client | The live page imports `_components/UsersClient`, while tests import `users/components/UserList` | Move tests to the live component and delete the stale file |
| Refund dialog | Parking and invoices each contain a `RefundDialog` with diverged behaviour and styles | Merge the best behaviour into one shared finance refund dialog |
| Refund history | Parking and invoices contain separate `RefundHistoryTable` copies | Keep one shared, tokenised, responsive history component |
| Private-booking item editors | `AddItemModal` and `EditItemModal` exist both inside the booking detail client and the items page | Extract one shared item editor and use it in both surfaces |
| Star rating | Feedback inbox defines one while a shared `StarRating` exists | Use the shared component |
| Status/detail helpers | Multiple local `StatusBadge`, `DetailItem`, `DetailRow`, pill and chip components | Use shared Badge/description-list patterns with domain status maps |
| Loading routes | Ten separate loading components exist | Keep route files as required by Next.js, but make every one render `PageLoading` |

## Target public component set

The precise export count should follow use, but the design system can move from roughly 75 top-level component exports toward about 50 stable public component families.

### Keep and strengthen

- Shell: `AppShell` and its internal desktop/mobile navigation pieces.
- Layout: `PageLayout`, `Section`, `Card`.
- Navigation: `SectionNav`, `Tabs`, `Segmented`, `Pagination`, `Stepper`.
- Actions: `Button`, `IconButton`, `LinkButton`, `RowActions`, `Dropdown`, `ConfirmDialog`.
- Forms: `Field`, `Input`, `Textarea`, `Select`, `Checkbox`, `Radio`, `Switch`, `SearchInput`, `DateTimePicker`, `FileUpload`.
- Data/display: `DataTable`, limited `Table`, `Badge`, `Stat`, `ProgressBar`, `Avatar`.
- Feedback/state: `Alert`, `Empty`, `Spinner`, `PageLoading`, `toast`, `Tooltip`.
- Overlays/disclosure: `Modal`, `Drawer`, `Popover`, `Accordion`.
- Visualisation: chart components that provide real shared behaviour.

### Merge or remove from the public API

| Current component(s) | Target |
|---|---|
| `PageHeader` + separate `PageLayout` header logic | `PageLayout` public; `PageHeader` internal |
| `EmptyState` + `Empty` | `Empty` |
| `TabNav` + `Tabs` + `SectionNav` | `Tabs` for state, `SectionNav` for routes |
| `TablePagination` + `Pagination` | `Pagination` |
| `FormGroup` + label/error props on controls + `Field` | `Field` + controls |
| `ModalActions` + `DrawerActions` + `FormActions` | one responsive action-bar treatment, preferably overlay footer composition |
| `ConfirmModal` + native confirm + `ConfirmDialog` | `ConfirmDialog` |
| `StatGroup` | normal responsive grid containing `Stat` |
| `FilterPanel` | `PageLayout.toolbar` composed from standard controls |
| `CardTitle` / `CardDescription` | `CardHeader` |
| `BackButton` | `PageLayout.backButton` or `LinkButton` |
| `SortableHeader` | `DataTable` sorting or accessible `TableHead` |
| `RadioGroup` compatibility wrapper | fieldset composed from `Radio` |
| `Toggle` | `Switch` |

## Standard interaction rules

### Pages

- Every authenticated route uses `PageLayout`.
- One title, optional subtitle, optional breadcrumbs, one primary action area.
- Section navigation always uses `SectionNav`.
- Loading, error and empty are separate states.
- Route-level loading files use `PageLoading`.

### Tables and lists

- Entity management lists use `DataTable`.
- The mobile presentation is part of the table contract, not a later page fix.
- The first column is the primary mobile label; secondary columns become labelled rows.
- Actions use `RowActions`.
- Long data is allowed to wrap or truncate with an accessible full-value affordance.
- Raw horizontal scrolling is reserved for true matrices and financial reports.

### Forms

- All fields use `Field` and a DS control.
- Required, invalid, hint and error states work with keyboard and screen readers.
- Async submission disables the action and shows loading.
- Server errors appear inline or in `Alert`; success uses the DS toast.
- Large forms warn before discarding changes.
- Modal forms have a mobile-safe sticky footer.

### Mobile

- Supported review widths: 360, 390, 768 and 1024px, plus desktop 1440px.
- Touch targets are at least 44px without relying on a global selector.
- Inputs render at 16px on phones to avoid browser zoom.
- No horizontal body overflow.
- Filters stack; three or more filters move into a filter drawer on small screens.
- Tables become cards/lists unless the information is genuinely tabular.
- Modals become full-width bottom sheets or full-screen where necessary.
- Tabs scroll horizontally and retain keyboard behaviour.
- Bottom navigation respects safe-area insets.
- Content is not hidden merely to make a layout fit; mobile keeps the required information and actions.

## Section priorities

The detailed numeric matrix is in `tasks/ui-section-matrix.csv`.

| Priority | Sections | Main reason |
|---|---|---|
| Foundation | Design system, shared components, app shell | Changes here propagate to the whole application |
| High | Recruitment | 78 raw controls, 8 table surfaces and a very large single client component |
| High | Rota | 88 raw controls, 7 hand-built modals, 13 direct toast files and heavy hardcoded styling |
| High | Table Bookings | 77 raw controls, weak shared mobile list behaviour and heavy hardcoded styling |
| High | Private Bookings | 38 raw controls, 13 compatibility imports, copied item editors and heavy styling divergence |
| High | Receipts | 27 raw controls, 6 table surfaces, 7 direct toast files and many local display components |
| High | Settings | 36 raw controls, 24 compatibility imports, 9 table surfaces and 10 direct toast files |
| High | Menu Management | 21 compatibility imports, 8 table surfaces and little explicit mobile list adaptation |
| Medium | Invoices | Strong DS use, but duplicate clients, 13 compatibility imports and 10 table surfaces |
| Medium | Customers | Good new list structure, but old styles and mixed page shells remain |
| Medium | Employees | Shared domain components exist, but local modals and old form patterns remain |
| Medium | Expenses | 18 raw controls, a hand-built modal and no explicit mobile list treatment |
| Medium | Mileage | Four table surfaces and continued hardcoded styling |
| Medium | Roles / Users | Test-only old clients, native confirmation and missing mobile table patterns |
| Medium | OJ Projects | No raw controls or compatibility imports, but eight table surfaces and inconsistent row actions |
| Medium | Cashing Up / MGD | Mostly DS-based, but tables lack deliberate mobile representations |
| Low-to-medium | Parking, Quotes, Short Links | Already closer to the target; use as early migration proving grounds |
| Low | Dashboard, Messages, Feedback, Profile | Mostly shared patterns; fix shell/page consistency and any remaining local controls |
| Separate wave | Onboarding, staff portal, kiosks and public guest flows | Different chrome and audience, but should share the same controls, feedback and mobile rules |

## Implementation plan

### Phase 0 — freeze new variation

1. Keep the generated component and section indexes in the repository.
2. Document the target component rules beside the DS.
3. Add warnings/restricted imports for:
   - `@/ds/compat` and compatibility names;
   - direct `react-hot-toast` imports;
   - `window.confirm`, `confirm` and `alert`;
   - direct Heroicons/Lucide imports outside the DS icon registry;
   - hand-built overlay backdrops;
   - new raw tables and form controls outside approved exceptions.

### Phase 1 — harden the shared foundations

1. Tokenise `PageLayout`, `DataTable`, `Pagination`, `SectionNav` and remaining DS internals.
2. Refactor `PageLayout` to compose the single page-header implementation.
3. Make `DataTable` responsive without a `window.innerWidth` layout flash.
4. Make simple sortable tables keyboard accessible.
5. Consolidate pagination.
6. Add `RowActions` and document its rules.
7. Standardise modal/drawer mobile footers.
8. Remove dead mobile shell search/notification controls until they have a real destination, or implement them.
9. Expand `/settings/design-system` so every public component, state and mobile mode is visible.

### Phase 2 — migrate low-risk proving sections

1. OJ Projects: standardise all row actions and give all eight table surfaces mobile behaviour.
2. Parking: move row actions, refund components and tables to the standard.
3. Quotes and Short Links: finish mobile list and action-menu adoption.
4. Dashboard, Feedback and Profile: move to the single page shell and state components.

This phase validates the components before the larger sections are touched.

### Phase 3 — migrate finance and people sections

1. Invoices: switch tests to the live client, remove the stale client, consolidate refunds and tables.
2. Customers and Employees: migrate field patterns, local modals, statuses and page shells.
3. Expenses, Mileage, Cashing Up and MGD: replace raw controls, confirmations and tables.
4. Roles and Users: remove stale test-only clients and use the standard table/actions/confirmation patterns.

### Phase 4 — migrate the largest operational sections

Split these into small feature-safe pull requests rather than one visual rewrite:

1. Recruitment: break the large client into domain panels while reusing standard controls.
2. Rota: migrate one modal/list workflow at a time.
3. Table Bookings: migrate FOH, BOH, detail and reports separately.
4. Private Bookings: extract shared item editors first, then migrate detail, settings and workflow panels.
5. Receipts: migrate list/card, rules, vendors and reporting separately.
6. Settings and Menu Management: migrate one settings/tool group per pull request.

### Phase 5 — public and staff surfaces

Apply the same controls and feedback patterns while preserving their separate branding/chrome:

- onboarding;
- staff portal;
- timeclock/event kiosks;
- booking, payment, feedback and parking guest flows.

### Phase 6 — remove the old system

1. Remove all compatibility exports and delete `src/ds/compat`.
2. Remove duplicate refund, invoice, user and private-booking components.
3. Remove deprecated props from canonical components.
4. Remove broad global mobile repair rules that are no longer needed.
5. Change lint warnings to errors.

## Verification for every migration unit

- desktop checks at 1440px;
- mobile checks at 360px and 390px;
- tablet checks at 768px and 1024px;
- keyboard-only navigation;
- focus, Escape and focus-return checks for overlays;
- loading, empty, error, success and destructive-action states;
- permission-based action visibility;
- no horizontal page overflow;
- `npm run lint`;
- `npx tsc --noEmit`;
- relevant focused tests;
- `npm test` at the end of each wave;
- `npm run build` before merging each wave.

## Completion criteria

The standardisation is complete when:

- there are no compatibility-component consumers;
- there are no direct `react-hot-toast` imports;
- there are no native confirmation dialogs;
- there are no route-local hand-built modal backdrops;
- all entity lists use `DataTable` or an explicitly approved simple/report table;
- every table/list has a tested mobile presentation;
- all repeated row actions use `RowActions`;
- all page routes use the standard page shell;
- all standard form fields use the same label/error contract;
- page chrome uses semantic colour tokens;
- duplicate/stale components and their stale tests are removed;
- the design-system catalogue covers every public component and state;
- the component-index job detects new duplicates and forbidden patterns in CI;
- the 360/390/768/1024/1440 visual suite passes without unintended differences.

## Recommended first implementation slice

Do not start with a whole-app visual rewrite. The safest first slice is:

1. add the guardrails;
2. harden `PageLayout`, `DataTable`, `Pagination`, `RowActions`, `Field`, `Modal` and `ConfirmDialog`;
3. migrate OJ Projects completely as the proving section;
4. visually approve desktop and mobile;
5. then roll the same patterns through the remaining waves.

This gives the fastest proof that a shared enhancement really does improve every instance before the high-risk operational areas are changed.
