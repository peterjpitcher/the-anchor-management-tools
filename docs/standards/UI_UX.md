# UI and UX standards

The staff app takes its look from design tokens and the design-system barrel. Three places hold the truth:

- **Tokens:** the `@theme static` block in `src/app/globals.css`. Tailwind 4 turns each token into utilities (`--color-text-muted` becomes `text-text-muted`) and `@theme static` puts every token on `:root`, so `var(--color-...)` always works.
- **Components:** `@/ds` (`src/ds`: primitives, composites, shell, icons, tokens).
- **Reference page:** `/settings/design-system` shows every token, read live from the stylesheet, and the real components.

The guard `tests/guards/design-tokens.test.ts` fails the test run when a change adds a raw value (see "The guard" below).

## Page contract

Every staff page is built the same way. Consistency is the point: a page that looks slightly different from its neighbours is a bug. Rules marked **(guard)** are enforced by `tests/guards/page-contract.test.ts`.

### The one exception

The FOH manager iPad kiosk (`/table-bookings/foh` signed in as the manager kiosk login, `PageLayout headerVariant="dark"`) and the FOH chromeless shell around it (`Topbar` in FOH mode, `FohClockBand`, `FohHeader`) stay exactly as they are. Staff use that screen all day and it deliberately stops them reaching anything else. Pages the kiosk can open (`/checklists`, `/vouchers/foh`) follow this contract but keep their "Back to the floor" button, because the kiosk has no other way back.

### Page chrome

- Every page renders `PageLayout` once, as its outermost element. **(guard)** `PageHeader` is retired.
- `title`: the section name on section pages ("Invoices", "Rota"), the record name on detail pages (the customer, the invoice number). The same title while loading, on error and when loaded: build one `layoutProps` object and spread it into every state. On a detail page with tabs, every tab shows the same title.
- Capitalisation on staff screens: Title Case for page, section, card and dialog titles, tab labels, back labels and button labels ("New Invoice", "Back to Roles", "Save Changes"). Sentence case for subtitles, descriptions, help text, messages and table cells. Field labels and table headers are uppercased by the components. Guest pages follow the website's voice rules instead.
- `subtitle`: optional, one short line, sentence case, no full stop. On a tab page it names the tab or says what the page is for.
- Never pass spacing classes to `PageLayout` (`className`, `headerClassName`, `contentClassName`) and never wrap it in padding, `max-w-*`, `mx-auto` or `min-h-screen`. **(guard)** The only `<main>` is the app shell's. **(guard)**
- Width: leave `containerSize` at `full`, except a page whose content is one form with no table (change password, a role, a maintenance item, a campaign, a simple settings form), which uses `containerSize="md"`.

### Navigation

- A section with more than one page has one nav constant in `<section>/_shared/nav.ts` (for example `FINANCE_NAV`, `EMPLOYEES_NAV`), passed as `navItems` on every page in that tab row. Never copy the array into a page. **(guard: no `SectionNav` outside `src/ds`)**
- The active tab comes from the path (longest matching prefix). A page that sits under a tab but is not itself in the list (a detail page) sets `active: true` on its parent tab.
- `Tabs` switch panels inside one page. `Segmented` switches the view of the same data (list or calendar, 7 or 30 days). Never use a nav component with `onSelect` to switch panels.
- A page shows at most one tab row.
- Back navigation: `backButton` on every page below its section's top level: detail pages and their tabs, new and edit pages, sub-areas with their own tab row (Private Bookings Settings), and the pages you drill into from Settings. It is labelled "Back to <Parent>" and points at the direct parent. No back button on a section's top-level pages, whether or not they have a tab row. No breadcrumbs anywhere. **(guard)**

### Header actions

- Page-level actions go in `headerActions`: `size="sm"`, secondary actions first, the primary action last. The main "New X" button is always here, never in the body.
- "Refresh", "Export" and view switchers are header actions too. Filters and search sit directly above the data they filter, in one `flex flex-wrap items-end gap-3` row.

### Body

- `PageLayout` spaces its children 24px apart (`space-y-6`). Pass blocks as direct children; do not add margins between them or wrap them in another stack.
- Panels are `Card`. A titled panel uses `CardHeader` (`title`, `subtitle`, `action`); its body is `CardBody`. Tables sit in `<Card padding="none">` or straight after a `CardHeader`. Never hand-build a panel from `bg-surface border rounded-* p-*`.
- A heading over a group of cards is `Section` (`title`, `description`, `actions`). A default `Section` adds no padding, so its cards line up with every other card. Do not pass `padding` to a default `Section`.
- Headings: page title `h1` (PageLayout), section title `h2` (Section, 16px semibold), card title `h3` (CardHeader, 14px semibold). No other heading styles in page code.
- Inside a card: `space-y-4` between blocks, `grid gap-4 sm:grid-cols-2` for side-by-side fields. Two-column page layouts use `gap-6`.
- Figures: `StatGrid` with `Stat` children. Never hand-build a stat tile.

### States

- Route loading: every section has a `loading.tsx` that renders `<PageLoading />`.
- A page still fetching on the client passes `loading` to `PageLayout` (header stays). A block still fetching renders `<PageLoading inline />`. No hand-made spinners, no "Loading..." text on its own.
- Nothing to show: `Empty` (`size="sm"` inside a table or card). A table's empty row is the table's `emptyMessage` or an `Empty`.
- Failure: the header stays and the page shows `Alert tone="danger"` (or `PageLayout error` with `onRetry`). A failed load is never shown as an empty list.

### Forms

- Labels come from `Field` or the `label` prop of `Input`, `Select` and `Textarea` (12px, uppercase, `tracking-wider`, muted). Never a raw `<label>` styled by hand.
- Every form ends with `FormFooter`: secondary first, primary last; right-aligned on desktop, full width with the primary on top on phones.
- Confirming a delete or another irreversible action is `ConfirmDialog`, never `confirm()`.

### Components

- Build from `@/ds` before writing markup. `src/ds/compat` is being removed; do not add uses.
- **Tables:** `Table` (small uppercase muted headers on `bg-surface-2`) or `DataTable` (sorting, empty row, pagination). One pager: `TablePagination`.
- **Buttons and links:** `Button`, `LinkButton`, `IconButton`. The primary colour is the Orange Jelly orange (`bg-primary`), used for buttons, the active tab, sub-navigation and links.
- **Menus and overlays:** `Dropdown`, `Popover`, `Modal`, `Drawer`, `ConfirmDialog`. Never a hand-built `fixed inset-0` overlay.
- **Status:** `Badge` and `Alert` with a `tone`. Each status has one map, used everywhere it shows:
  - table bookings: `TABLE_BOOKING_STATUS_TONE` in `src/lib/table-bookings/ui.ts` (booked primary, seated success, pending payment warning, no-show danger; cancelled, left and completed neutral)
  - vouchers: `VOUCHER_STATUS_TONES` in `src/app/(authenticated)/vouchers/_shared/voucher-ui.tsx` (issued info, redeemed success)
  - private bookings: `privateBookingStatusTone` and `privateBookingPaymentTone` in `src/app/(authenticated)/private-bookings/_shared/status-ui.ts` (confirmed primary, draft warning because it is a hold waiting for its deposit, completed and cancelled neutral; overdue money is the only red)
  - events and event bookings: `eventStatusTone` and `eventBookingStatusTone` in `src/app/(authenticated)/events/_shared/status-ui.ts` (bookings follow the table booking colours)
  - invoices and quotes: `invoiceStatusTone` and `quoteStatusTone` in `src/lib/invoices/status-ui.ts`, which the invoice and quote PDFs use too
  - rota shifts, holidays, departments, day notes and the hours report: `ROTA_SHIFT_STATUS_CLASSES`, `ROTA_HOLIDAY_CLASSES`, `rotaDepartmentClasses` (one department to category map, also used by the printed rota) and `ROTA_HOURS_SERIES_COLOURS` in `src/lib/rota/status-ui.ts`. A shift's own colour comes from `resolveShiftColour` in `src/lib/rota/shift-template-colours.ts`, on screen and on paper.
  - Any other status gets a named map in its domain's `status-ui` file and is listed here. Never pick a tone inline at the call site.
- **Toasts:** `toast` from `@/ds` for transient confirmations (`success`, `error`, `warning`, `info`). A lasting result of a form sits in an inline `Alert`. One `Toaster`, in the root layout.
- **Icons:** the DS `Icon` only. Add a missing glyph to `src/ds/icons/paths.tsx` rather than importing another icon set.
- **Forms:** DS fields with Zod validation in the server action. There is no form library.
- **Width checks in JavaScript:** `SHELL_MEDIA_QUERY` from `@/ds`, never a hard-coded 768px or 640px.

### Page template

```tsx
// src/app/(authenticated)/invoices/_shared/nav.ts
import type { HeaderNavItem } from '@/ds'
export const FINANCE_NAV: HeaderNavItem[] = [
  { label: 'Invoices', href: '/invoices' },
  { label: 'Quotes', href: '/quotes' },
]

// a list page
<PageLayout
  title="Invoices"
  subtitle="Money owed to Orange Jelly"
  navItems={FINANCE_NAV}
  headerActions={<LinkButton href="/invoices/new" size="sm">New Invoice</LinkButton>}
>
  <StatGrid columns={3}>...</StatGrid>
  <Card padding="none">
    <DataTable ... emptyMessage="No invoices yet" />
  </Card>
</PageLayout>

// a form page
<PageLayout title="New Role" backButton={{ label: 'Back to Roles', href: '/roles' }} containerSize="md">
  <Card>
    <CardHeader title="Role Details" />
    <CardBody className="space-y-4">
      <Input label="Name" ... />
    </CardBody>
  </Card>
  <FormFooter>
    <LinkButton href="/roles" variant="secondary">Cancel</LinkButton>
    <Button type="submit">Create Role</Button>
  </FormFooter>
</PageLayout>
```

## Tokens

| Need | Use |
|---|---|
| Page background | `bg-bg` |
| Card or panel | `bg-surface border border-border rounded-lg shadow-sm` (or DS `Card`) |
| Sunk panel, table header | `bg-surface-2` |
| Hover | `hover:bg-surface-hover` |
| Headings | `text-text-strong` |
| Body text | `text-text` |
| Secondary text, labels | `text-text-muted` |
| Hints | `text-text-soft` |
| Placeholders and icons (never text) | `text-text-subtle` |
| Primary action, link | `bg-primary text-primary-fg`, `text-primary` |
| Soft highlight | `bg-primary-soft text-primary-soft-fg` |
| Status message | `bg-success-soft text-success-fg border-success-border` (also `warning`, `danger`, `info`) |
| Status icon, dot or fill | `text-success`, `bg-success` (and the other three) |
| Fixed app categories (departments, dish groups, booking types) | `cat-1` to `cat-8`, each with `-soft` and `-fg` |
| Charts | `var(--color-chart-1)` to `var(--color-chart-6)`, or `fill-chart-1` |
| Avatars | `bg-avatar-1` to `bg-avatar-6` with white text |
| Text on dark surfaces | `text-on-dark`, `text-on-dark-muted`, `hover:bg-on-dark-hover`, `border-on-dark-border` |
| Dialog backdrop | `bg-overlay` |

- **Type:** `text-2xs` (10px, the minimum), `text-meta` (11px), `text-xs` (12px), `text-ui` (13px, table cells and dense controls), `text-sm` (14px, body), `text-base` and up.
- **Radius:** `rounded-sm` 6px, `rounded-default` 8px (buttons, fields), `rounded-md` 10px (not the Tailwind 6px), `rounded-lg` 14px (cards, dialogs), `rounded-xl` 20px, `rounded-pill`. `rounded-full` is for circles.
- **Shadows:** `shadow-xs` (buttons), `shadow-sm` (cards, tables), `shadow-default` (raised panels), `shadow-lg` (dialogs, drawers, menus, toasts), `shadow-ring` and `shadow-ring-inset` (focus).
- **Sizes:** `min-h-touch` (44px), `h-input-h`, `h-btn-h`, `h-btn-h-sm`, `h-btn-h-lg`, `py-cell-y`, `p-pad-card`.
- **Breakpoint:** `shell:` and `max-shell:` switch at 821px, where the app shell changes between phone and desktop.
- `cn()` in `src/lib/utils.ts` knows the custom token names, so `cn('text-ui', 'text-text-muted')` keeps both. A new token namespace must be registered there too.

## Rules

1. **Contrast.** Text on white needs at least 4.5:1: `text-text`, `text-text-muted`, `text-text-soft` or a status `-fg` colour. Base status colours are for icons, dots, fills and borders.
2. **Minimum size.** Nothing below `text-2xs` (10px) on a staff screen.
3. **Focus.** Controls: `focus-visible:outline-hidden focus-visible:shadow-ring`. Inside a container that clips (accordions, tab strips, table headers): `focus-visible:shadow-ring-inset`. Text fields: `focus:border-border-focus focus:shadow-ring`; in the error state `focus:border-danger` with the red halo the DS `Input` already applies. `outline-hidden` keeps focus visible in Windows high-contrast mode. Native radios keep the browser outline.
4. **Disabled.** `disabled:opacity-50`.
5. **Light theme only.** No dark-mode variants (dropped on 18 September 2026).
6. **Touch.** The FOH, BOH, timeclock and voucher screens are used on an iPad: targets at least 44px (`min-h-touch`) and text at least 10px. DS `Modal` and `Drawer` panels apply the 44px floor on touch screens.
7. **Guest pages.** Pages inside `GuestShell` (the `.guest-theme` class) use only the `anchor-*` and `guest-*` tokens and the `Guest*` components. Staff screens never use them.
8. **Emails and PDFs.** Mail clients and PDF renderers cannot read CSS variables, so their colours come from `src/lib/brand/palette.ts`, which a test pins to the tokens:
   - `STAFF` for Orange Jelly and staff documents: invoices, receipts, quotes, statements, contracts, staff emails, rota and hours PDFs.
   - `GUEST` for anything a guest receives about The Anchor: booking, event, table and voucher emails and the voucher card. The primary button is `GUEST.buttonBg` with `GUEST.buttonText`, as on the guest pages.
   - Black-ink print sheets (the table and event booking sheets) use the `STAFF` greys, which stay darker on paper.
   - `CHART_SERIES` and `CATEGORY` carry the chart and category colours for generated documents, such as the printed rota.
9. **Colours staff choose stay data.** Shift template colours, calendar note colours, customer labels and event categories are saved values, not tokens.
10. **Never build class names at runtime** (`bg-${tone}-soft` is never generated). Map each value to a whole class string, as the status maps do.

## Not allowed

The guard counts these in `src/`:

| Rule | What it catches | Use instead |
|---|---|---|
| `raw-palette` | Tailwind colours such as `bg-gray-100`, `text-blue-600`, `border-emerald-200` | the token for the meaning |
| `hex-colour` | `#rrggbb` anywhere outside `globals.css`, `src/lib/brand/palette.ts` and a short list of saved-colour files | a token, or the palette for emails and PDFs |
| `px-text-size` | `text-[13px]` and other pixel sizes | the type scale above |
| `bare-rounded` | `rounded` on its own (4px) | `rounded-sm` or larger |
| `off-scale-radius` | `rounded-2xl`, `rounded-3xl` | `rounded-xl` or `rounded-lg` |
| `off-scale-shadow` | `shadow` on its own, `shadow-md`, `shadow-xl`, `shadow-2xl` | the shadow scale above |
| `dark-variant` | `dark:` classes | nothing: light theme only |
| `legacy-hsl-var` | `hsl(var(--...))` from the old shadcn setup | token utilities |
| `raw-820-breakpoint` | hand-written 820px breakpoints | `shell:` or `max-shell:` |
| `sidebar-outside-shell` | sidebar tokens outside `src/ds/shell` | `Button variant="primary"` or the `on-dark` tokens |

## The guard

`tests/guards/design-tokens.test.ts` counts each rule in each file and compares the counts with `tests/guards/design-tokens.baseline.json`.

- **"adds no new raw values"** fails when any count rises. Fix the code; never raise the baseline to get a change through.
- **"has a baseline no looser than the code"** fails when a count fell and the baseline still holds the old number. Lower it with `UPDATE_DESIGN_TOKEN_BASELINE=1 npx vitest run tests/guards/design-tokens.test.ts` and commit the baseline with the change. The update refuses to raise any number.
- Comments are ignored. Bare `rounded` and `shadow` count only inside strings that read as class lists, so prose is safe.
