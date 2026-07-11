# Invoices

Audited at 375px width against the mobile rubric (no horizontal body scroll, ≥44px tap targets,
readable text, usable/stacking forms, wide-content handling, modal/drawer fit, reachable primary
actions, scaling media).

Centrally-handled and NOT re-flagged per route below:
- Nav shell (`MobileChrome`/bottom nav/sidebar) and the `ds` `Modal` (bottom sheet on mobile).
- `src/ds/composites/Table.tsx` — wraps in its own `-mx-4 overflow-x-auto ... min-w-[560px] sm:min-w-0` container. Safe to use anywhere.
- `src/ds/composites/DataTable.tsx` — auto-switches to a stacked card list below 821px (`mobileBreakpoint`), with or without a custom `renderMobileCard`. Only flagged where the *default* auto-generated mobile card is put under real strain by its columns (see Recurring list below).
- Global mobile safety net in `src/app/globals.css` (`@media (max-width: 820px)`): forces `button` elements (except sidebar buttons) to `min-height/min-width: 44px`, bumps `--spacing-input-h`/`--spacing-btn-h*` up, forces 16px input font-size (no iOS zoom), and collapses any class containing `md:grid-cols`/`lg:grid-cols`/`xl:grid-cols` to a single column. This is why most icon-only `<button>` elements across this section are fine even when their Tailwind classes alone would render them at 32–34px — **note it does NOT catch bare `grid-cols-N` classes with no responsive prefix**, which is the root cause of two findings below.
- `src/ds/composites/Card.tsx` renders with `overflow-hidden`, which matters below: any content that doesn't fit its container is *clipped*, not spilled into a page-level horizontal scrollbar.

---

## /invoices

Live file: `src/app/(authenticated)/invoices/page.tsx` → `src/app/(authenticated)/invoices/_components/InvoicesClient.tsx` (renders `src/app/(authenticated)/invoices/MobileInvoiceCard.tsx` for the mobile list).
Dead duplicates confirmed NOT rendered: `src/app/(authenticated)/invoices/InvoicesClient.tsx` (top-level, unused).

- [H] item#1 — The "Start date"/"End date" export filter row uses two fixed `w-40` (160px) `Input type="date"` fields side by side with no responsive stacking. At 375px the available row width inside the Card's `px-4` date-range bar is ~309px, but the two 160px inputs + `gap-3` need ~332px — a ~23px overflow. Because the ancestor `Card` has `overflow-hidden`, the right edge of the "End date" field (including its native date-picker affordance) is clipped/inaccessible. — `src/app/(authenticated)/invoices/_components/InvoicesClient.tsx:372-390`
- [L] item#2 — The "Clear search" icon button inside `SearchInput` is absolutely positioned (`absolute right-2.5 ... p-0.5`) with no reserved padding in the input for it. The global mobile CSS boosts it to 44×44px (all `<button>`s do), which can make it crowd/overlap the field's right edge on a 375px screen. Systemic, low severity, cosmetic only. — `src/ds/primitives/SearchInput.tsx:88-96`
- Desktop `<Table>` is correctly hidden on mobile (`hidden sm:block`) in favour of `MobileInvoiceCard` (`sm:hidden`) — good pattern, not flagged.
- `MobileInvoiceCard`'s download icon button is `h-8 w-8` (32px) in its own class, but it's a real `<button>` so the global 44px min-height/min-width rule fixes it up automatically — not flagged.

REDESIGN: no — the page itself already has a proper mobile card list; item#1 is a fixed-width-input bug, not a structural redesign need.

---

## /invoices/new

Live file: `src/app/(authenticated)/invoices/new/page.tsx` (renders inline, no separate client component).

- PASS (no mobile issues found) — Invoice-detail fields use `grid-cols-1 md:grid-cols-2`; the line-item row correctly uses `grid-cols-1 lg:grid-cols-12` (stacks to one column below `lg`); the sticky footer Cancel/Create buttons use `flex-col sm:flex-row` + `w-full sm:w-auto`; the "Add from Catalog" modal list scrolls internally (`max-h-96 overflow-y-auto`); the remove-line-item button has `aria-label="Remove line item"`.

REDESIGN: no.

---

## /invoices/catalog

Live file: `src/app/(authenticated)/invoices/catalog/page.tsx` (renders inline).

- PASS (no mobile issues found) — Uses `DataTable` with a purpose-built `renderMobileCard` that preserves both Edit and Delete actions. Modal form fields use `grid-cols-1 sm:grid-cols-2`. `PageLayout`'s `headerActions` ("Add Item") surfaces correctly in the mobile nav row (`showMobileHeaderActionsInNavRow`, `md:hidden`, `flex-wrap`).

REDESIGN: no.

---

## /invoices/export

Live file: `src/app/(authenticated)/invoices/export/page.tsx` (renders inline).

- [L] item#3 — Start Date / End Date fields use a bare `grid grid-cols-2 gap-4` with no responsive single-column base (compare `grid-cols-1 md:grid-cols-2` used on every other form in this section, e.g. vendors/catalog/recurring). Each `Input` is `w-full` inside its grid cell so nothing actually overflows at 375px (~150px per date field, which native date inputs render fine in), but it's the one form in the section that doesn't follow the stack-on-mobile convention and is needlessly cramped. — `src/app/(authenticated)/invoices/export/page.tsx:181-205`

REDESIGN: no — cosmetic inconsistency only, not a break.

---

## /invoices/vendors

Live file: `src/app/(authenticated)/invoices/vendors/page.tsx` (renders inline).

- [H] item#4 — The desktop `DataTable` "Actions" column has three actions per vendor: **Contacts** (`leftIcon={<Users/>}`, opens the contact-management modal), Edit, Delete. The custom `renderMobileCard` (used automatically below 821px) only re-implements Edit and Delete — the **Contacts** button is missing entirely. Since the mobile card has no `onRowClick`/`clickableRows` fallback either, "Manage vendor contacts" (explicitly called out in the form's own info banner: *"Manage people and email recipients via the Contacts button above"*) is completely unreachable on mobile. — desktop actions: `src/app/(authenticated)/invoices/vendors/page.tsx:421-454`; mobile card (missing action): `src/app/(authenticated)/invoices/vendors/page.tsx:456-494`
- Vendor form modal and the Contacts sub-modal both use `grid-cols-1 md:grid-cols-2` correctly; the contact list row (`flex items-center justify-between gap-4` with `min-w-0` name/email and `shrink-0` action buttons) stacks/truncates safely.

REDESIGN: yes — the mobile vendor card needs an extra action affordance (e.g. a "Contacts" button, or making the whole card tappable to open contacts) to restore feature parity; not fixable with a scroll wrapper.

---

## /invoices/recurring

Live file: `src/app/(authenticated)/invoices/recurring/page.tsx` (renders inline).

- [M] item#5 — `DataTable` is used **without** a `renderMobileCard` (unlike catalog/vendors in the same section), so it falls back to the generic auto-card: first column ("Vendor") becomes the card header, the rest become label/value rows via a `dl`. The "Actions" row's value cell renders four icon-only buttons (Toggle status, Generate now, View, Delete) in a non-wrapping `flex justify-end gap-2`. At 375px this computes to roughly 200px of buttons vs. ~212px of available space next to the "Actions" label — it likely still fits, but with almost no margin, and any overflow is clipped by the Card's `overflow-hidden`, silently hiding the rightmost action (Delete). — `src/app/(authenticated)/invoices/recurring/page.tsx:237-360` (columns), esp. `290-357` (actions cell)

REDESIGN: yes — should get its own `renderMobileCard` (as catalog/vendors already do) rather than relying on the generic fallback for a 4-icon action row.

---

## /invoices/recurring/new

Live file: `src/app/(authenticated)/invoices/recurring/new/page.tsx` (renders inline).

- [M] item#6 — The "Remove line item" button has no `aria-label` (and, unlike `/invoices/new`'s equivalent button, no discernible accessible name at all — it's icon-only with just a `Trash2` glyph). Screen-reader/VoiceOver users on mobile get an unlabelled control. — `src/app/(authenticated)/invoices/recurring/new/page.tsx:426-436`
- [L] item#7 — Bottom "Actions" row (`flex justify-end gap-4`, Cancel + "Create Recurring Invoice") doesn't use the `flex-col sm:flex-row` + `w-full sm:w-auto` stacking pattern used on `/invoices/new` and `/invoices/[id]/edit`. At 375px it fits (~317px of ~343px available) but with little safety margin given `whitespace-nowrap` on Button text — inconsistent and fragile if the label ever grows. — `src/app/(authenticated)/invoices/recurring/new/page.tsx:519-534`
- Line-item grid correctly uses `grid-cols-1 md:grid-cols-6`; catalog-select + "manage catalog" icon button row (`flex gap-2`) is fine.

REDESIGN: no.

---

## /invoices/recurring/[id]

Live file: `src/app/(authenticated)/invoices/recurring/[id]/page.tsx` (renders inline).

- PASS (no mobile issues found) — `PageLayout` header actions (`flex flex-wrap items-center gap-2`) wrap correctly. The Line Items `DataTable` has no action buttons (read-only display), so its default auto-generated mobile card (no custom `renderMobileCard`) is just plain label/value rows — safe. All detail grids use `grid-cols-1 md:grid-cols-2` / `sm:grid-cols-2`.

REDESIGN: no.

---

## /invoices/recurring/[id]/edit

Live file: `src/app/(authenticated)/invoices/recurring/[id]/edit/page.tsx` (renders inline).

- [M] item#8 — Same issue as item#6: the "Remove line item" button has no `aria-label` (and isn't even marked `iconOnly`, unlike its sibling on the "new" form). — `src/app/(authenticated)/invoices/recurring/[id]/edit/page.tsx:457-467`
- [L] item#9 — The remove button sits in `<div className="flex items-start gap-4">` next to a `flex-1` field grid that becomes a tall single-column stack of 7 controls on mobile (Catalog Item, Description, Quantity, Unit Price, Discount, VAT Rate, Subtotal). With `items-start`, the delete button stays pinned near the top of that tall stack rather than being reachable/associated with the row as a whole — awkward but not broken. — `src/app/(authenticated)/invoices/recurring/[id]/edit/page.tsx:368-469`
- [L] item#10 — Same bottom Actions-row inconsistency as item#7 (`flex justify-end gap-4`, no mobile stacking). — `src/app/(authenticated)/invoices/recurring/[id]/edit/page.tsx:526-541`

REDESIGN: no.

---

## /invoices/[id]

Live file: `src/app/(authenticated)/invoices/[id]/page.tsx` → `src/app/(authenticated)/invoices/[id]/InvoiceDetailClient.tsx`.

- [L] item#11 — The "Reissue OJ Invoice" preview modal's three helper tables (`EntryPreviewTable`, `RecurringPreviewTable`, `LineItemsPreviewTable`) are raw `<table>` elements with cells like `min-w-[180px]`/`min-w-[220px]`/`min-w-[260px]`, wrapped only in `overflow-x-auto` — no card fallback (unlike the main Line Items table just above, which has a proper `renderMobileCard`). This is a valid strategy per rubric (contained scroll, not page-level), but it's the one place in this route relying solely on horizontal scroll for genuinely wide content, and it's inside a `size="xl"` modal already competing for space on a small screen. Low priority: infrequent admin/finance action. — `src/app/(authenticated)/invoices/[id]/InvoiceDetailClient.tsx:108-231`
- `headerActions` (`flex flex-wrap items-center gap-2`, up to 8 conditional buttons) wraps correctly. Main Line Items `DataTable` has a proper `renderMobileCard`. All detail grids stack via `grid-cols-1 sm:grid-cols-2` / `lg:grid-cols-3`. Sidebar action buttons use `fullWidth`. Payment history rows use `flex-col sm:flex-row`.

REDESIGN: no.

---

## /invoices/[id]/edit

Live file: `src/app/(authenticated)/invoices/[id]/edit/page.tsx` (renders inline).

- [H] item#12 — The per-line-item field row uses a **bare `grid grid-cols-12 items-start gap-2`** with no responsive prefix at all (contrast with `/invoices/new`'s equivalent row, which correctly uses `grid-cols-1 lg:grid-cols-12`). Seven controls are packed into it: Description (`col-span-4`), Quantity (`col-span-1`), Unit Price (`col-span-2`), Discount % (`col-span-1`), VAT % (`col-span-1`), computed line total text (`col-span-2`), Delete button (`col-span-1`). At 375px, with the Card's `p-6` padding, available content width is ~295px; spread across 12 columns with `gap-2` (11×8px=88px), each column unit is ~17px. The `Input` fields are `w-full` so they don't overflow — they just render at unusably narrow widths (a handful of pixels for Quantity/Discount/VAT). The Delete button, however, has an explicit `min-width: 44px` forced by the global mobile CSS, which its ~17-25px grid column cannot satisfy without either forcing the grid wider than its container (clipped by the Card's `overflow-hidden`) or compressing sibling columns even further. Either failure mode is a genuine mobile break: illegible/untappable number inputs and a delete control that is clipped or overlapping. This directly matches the audit's watch-signal: "grid with fixed column counts and no sm:/base single-column." — `src/app/(authenticated)/invoices/[id]/edit/page.tsx:349-414`
- The "catalog select + manage-catalog icon button" row above it (`flex gap-2`) is fine (Select is flexible, button is fixed).
- Bottom Actions row correctly uses `flex-col justify-end gap-3 sm:flex-row`.

REDESIGN: yes — the line-item editor row needs the same `grid-cols-1 lg:grid-cols-12` (or an explicit mobile card) treatment already used on `/invoices/new`; this is the single clearest regression in the section.

---

## /invoices/[id]/payment

Live file: `src/app/(authenticated)/invoices/[id]/payment/page.tsx` (renders inline).

- PASS (no mobile issues found) — Payment summary stat grid uses `grid-cols-1 sm:grid-cols-3`; all form fields are single-column (`space-y-4`, no side-by-side inputs); Actions row uses `flex-col justify-end gap-3 sm:flex-row`.

REDESIGN: no.

---

# Summary

| Severity | Count |
|---|---|
| High | 3 |
| Medium | 3 |
| Low | 6 |

High-severity items (all genuine mobile breaks, not just cosmetic):
1. `/invoices` — export date-range inputs overflow/clip (item#1)
2. `/invoices/vendors` — "Manage contacts" action missing entirely from the mobile card (item#4)
3. `/invoices/[id]/edit` — rigid `grid-cols-12` line-item row with no mobile stacking (item#12)

Systemic (rooted in a shared `src/ds/*` file, fix once):
- `src/ds/primitives/SearchInput.tsx` — Clear-search button has no reserved space, can crowd the input edge once the global 44px min-tap-target CSS applies to it (item#2, Low).

Everything else is page-level: two accessibility gaps (missing `aria-label` on icon-only remove-line-item buttons in the two recurring-invoice forms), one under-provisioned `DataTable` mobile card (recurring list actions column), and a few Low-severity inconsistencies where a page doesn't follow the stacking convention used elsewhere in the same section.
