# UI and UX standards

The staff app takes its look from design tokens and the design-system barrel. Three places hold the truth:

- **Tokens:** the `@theme static` block in `src/app/globals.css`. Tailwind 4 turns each token into utilities (`--color-text-muted` becomes `text-text-muted`) and `@theme static` puts every token on `:root`, so `var(--color-...)` always works.
- **Components:** `@/ds` (`src/ds`: primitives, composites, shell, icons, tokens).
- **Reference page:** `/settings/design-system` shows every token, read live from the stylesheet, and the real components.

The guard `tests/guards/design-tokens.test.ts` fails the test run when a change adds a raw value (see "The guard" below).

## Components

- Build from `@/ds` before writing markup. `src/ds/compat` wraps older component shapes; new code uses the primitives and composites directly.
- **Page chrome:** `PageLayout` or `PageHeader`. Both give the same warm `bg-bg` page and the same title. The FOH kiosk uses `PageLayout headerVariant="dark"`.
- **Tables:** `Table` (small uppercase muted headers on `bg-surface-2`). `DataTable` draws the same look.
- **Navigation:** `Tabs` for in-page tabs (brand underline), `SectionNav` for sub-pages of a section (folder tabs, active tab filled with `bg-primary`), `Segmented` for switching views of the same data.
- **Labels:** the `Field` style (12px, uppercase, `tracking-wider`, `text-text-muted`). The labels built into `Input`, `Select` and `Textarea` match it.
- **Buttons and links:** `Button` and `LinkButton`. One brand green for buttons, tabs, sub-navigation and links.
- **Status:** `Badge` and `Alert` with a tone. Each status has one map, used everywhere it shows:
  - table bookings: `TABLE_BOOKING_STATUS_TONE` in `src/lib/table-bookings/ui.ts` (booked primary, seated success, pending payment warning, no-show danger; cancelled, left and completed neutral)
  - vouchers: `VOUCHER_STATUS_TONES` in `src/app/(authenticated)/vouchers/_shared/voucher-ui.tsx` (issued info, redeemed success)
  - private bookings: `privateBookingStatusTone` and `privateBookingPaymentTone` in `src/app/(authenticated)/private-bookings/_shared/status-ui.ts` (confirmed primary, draft warning because it is a hold waiting for its deposit, completed and cancelled neutral; overdue money is the only red)
  - events and event bookings: `eventStatusTone` and `eventBookingStatusTone` in `src/app/(authenticated)/events/_shared/status-ui.ts` (bookings follow the table booking colours)
  - invoices and quotes: `invoiceStatusTone` and `quoteStatusTone` in `src/lib/invoices/status-ui.ts`, which the invoice and quote PDFs use too
  - rota shifts, holidays, departments, day notes and the hours report: `ROTA_SHIFT_STATUS_CLASSES`, `ROTA_HOLIDAY_CLASSES`, `rotaDepartmentClasses` (one department to category map, also used by the printed rota) and `ROTA_HOURS_SERIES_COLOURS` in `src/lib/rota/status-ui.ts`. A shift's own colour comes from `resolveShiftColour` in `src/lib/rota/shift-template-colours.ts`, on screen and on paper.
- **Toasts:** `react-hot-toast`, styled to match the DS toast. One `Toaster` per layout, never one per page.
- **Icons:** the DS `Icon` where the icon exists. Heroicons and Lucide appear in older screens.
- **Forms:** DS fields with Zod validation in the server action. There is no form library.

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
