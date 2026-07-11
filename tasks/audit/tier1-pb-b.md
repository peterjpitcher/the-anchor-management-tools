# Private bookings (sub + settings)

Audited at 375px width against the tier1 mobile rubric. Nav shell (MobileChrome/Sidebar) and the ds `Modal` bottom-sheet behaviour are already handled centrally and are not re-reported here.

---

## /private-bookings/[id]/communications

Live files:
- `src/app/(authenticated)/private-bookings/[id]/communications/page.tsx`
- `src/components/private-bookings/CommunicationsTabServer.tsx`
- `src/components/private-bookings/CommunicationsTab.tsx`

PASS (no mobile issues found)

Notes: history/scheduled list rows use `flex flex-wrap` and `whitespace-pre-wrap`, no fixed widths, no tables. The 5-item sub-nav (Overview/Items/Messages/Communications/Contract) is rendered via the shared `PageLayout` → `HeaderNav` → `SectionNav` (`src/ds/composites/SectionNav.tsx`), which already scrolls horizontally in its own container (`overflow-x-auto`) — see systemic note below.

REDESIGN: no

---

## /private-bookings/[id]/contract

Live file: `src/app/(authenticated)/private-bookings/[id]/contract/page.tsx`

This route is a pure server redirect (`redirect(/api/private-bookings/contract?bookingId=...)`) to a PDF-generating API route. No JSX is rendered by this route itself, so there is no client-side mobile surface to audit.

PASS (no mobile issues found)

REDESIGN: no

---

## /private-bookings/[id]/messages

Live files:
- `src/app/(authenticated)/private-bookings/[id]/messages/page.tsx`
- `src/app/(authenticated)/private-bookings/[id]/messages/PrivateBookingMessagesClient.tsx` (confirmed live — no dead duplicate exists for this route)

Issues:
- [L] item#1 — Template-picker buttons in `FormGroup label="Choose a template"` use `grid grid-cols-1 md:grid-cols-2 gap-3` (fine, stacks at 375px) but each button's only sizing is `p-4` with a heading + description; no issue in practice — noted only because it borders the "grid with fixed column counts" watch-signal, confirmed safe on inspection. — `PrivateBookingMessagesClient.tsx:315`

PASS otherwise — main layout is `grid grid-cols-1 lg:grid-cols-3` (stacks fully below `lg`), message-history cards use `flex flex-wrap`, and the SMS delivery/booking-summary sidebar cards stack correctly.

REDESIGN: no

---

## /private-bookings/settings

Live file: `src/app/(authenticated)/private-bookings/settings/page.tsx`

PASS (no mobile issues found)

Notes: `grid grid-cols-1 md:grid-cols-2 gap-4` of `Card`s collapses to a single column at 375px; each card's `LinkButton` is full-height text, no fixed widths.

REDESIGN: no

---

## /private-bookings/settings/catering

Live files:
- `src/app/(authenticated)/private-bookings/settings/catering/page.tsx`
- `src/components/features/catering/CateringManager.tsx`
- `src/components/features/catering/CateringPackageModal.tsx`

PASS (no mobile issues found)

Notes: package listing uses the shared `DataTable` (`src/ds/composites/DataTable.tsx`) with `hideOnMobile` on the Price/Min-Guests columns. Below its `mobileBreakpoint` (821px) `DataTable` switches to a stacked-card renderer (primary column as a card header, remaining columns as a `dl` of label/value rows) rather than a scrolling table — this is the correct "redesign to cards" pattern and already solves the wide-table problem for every consumer of `DataTable`, including this page. `CateringPackageModal` form fields use `grid grid-cols-1 md:grid-cols-2` (stacks correctly).

REDESIGN: no

---

## /private-bookings/settings/spaces

Live file: `src/app/(authenticated)/private-bookings/settings/spaces/page.tsx` (renders `VenueSpaceDeleteButton`)

Issues:
- [M] item#2 — "Add New Space" and each existing-space edit form use `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-7 gap-4` for Name/Seated/Standing/Rate/Status + submit button. This collapses to a single column below `md` (768px) so it is usable at 375px, but every field (7 across on desktop) stacks as 7 full-width rows per space on mobile — with N existing spaces this makes the "Existing Spaces" section a long vertical form-per-space list. Not a hard failure (all fields reachable, labelled, full-width) but a poor mobile experience for what is fundamentally a settings table; flagging as a redesign candidate rather than a blocking bug. — `spaces/page.tsx:187`, `spaces/page.tsx:322`
- [H] item#3 — Delete-space button is a bare `<button type="submit">` wrapping only a `TrashIcon className="h-5 w-5"` (20px), no padding classes and no `aria-label`. Tap target is ~20×20px, well under the 44px minimum, and screen readers announce it only as an unlabelled button. — `src/components/features/private-bookings/VenueSpaceDeleteButton.tsx:15-25`

REDESIGN: yes — the add/edit space forms (7-wide desktop grid collapsing to a long stack of individual-field rows per existing space) would read much better as mobile cards (space name + capacity/rate summary, "Edit" opening a modal) rather than an always-expanded inline edit form per row.

---

## /private-bookings/settings/vendors

Live file: `src/app/(authenticated)/private-bookings/settings/vendors/page.tsx` (renders `VendorDeleteButton`)

Issues:
- [M] item#4 — Same pattern as spaces: "Add New Vendor" form (`grid-cols-1 md:grid-cols-2 lg:grid-cols-3` / `lg:grid-cols-4` / `grid-cols-2`) and each existing vendor's edit form stack to full-width single-column rows at 375px — usable but a long per-vendor inline-edit form rather than a compact card. — `vendors/page.tsx:208`, `vendors/page.tsx:340`
- [H] item#5 — Delete-vendor button is a bare `<button type="submit">` wrapping only `TrashIcon className="h-5 w-5"` (20px), no padding, no `aria-label`. Same tap-target/accessibility issue as item#3. — `src/components/features/invoices/VendorDeleteButton.tsx:15-25`

REDESIGN: yes — same reasoning as Spaces: vendors grouped by type, each rendered as an always-open inline edit form, would work better as mobile cards with an edit action that opens a modal/drawer.

---

## /private-booking/[id]

This route re-exports the plural route's page (`export { default } from '../../private-bookings/[id]/page'`), so it renders the identical component tree.

Live files:
- `src/app/(authenticated)/private-bookings/[id]/page.tsx`
- `src/app/(authenticated)/private-bookings/PrivateBookingDetailServer.tsx`
- `src/app/(authenticated)/private-bookings/[id]/PrivateBookingDetailClient.tsx` (3,376 lines — main render tree)
- `src/app/(authenticated)/private-bookings/[id]/PaymentHistoryTable.tsx`
- `src/components/private-bookings/WorkflowPanels.tsx` (WorkflowStatusPanel, RecordLockBanner, RecordLockControl, WaiverRiskPanel, SuppliersPanel, DeductionsPanel, ComplaintsPanel)
- `src/components/features/invoices/RefundDialog.tsx`
- `src/components/features/invoices/RefundHistoryTable.tsx`

Issues:
- [H] item#6 — `RefundHistoryTable` renders a raw 6-column `<table>` (Date / Amount / Method / Status / Reason / Reference) wrapped only in `<div className="overflow-hidden rounded-md border ...">` — **not** `overflow-x-auto`. At 375px the table (min-w-full, 6 columns each with `px-3 py-2` padding) is wider than the viewport; because the wrapper uses `overflow-hidden` rather than a scrolling container, the excess content is clipped rather than reachable by scroll. The rightmost columns (Reason, Reference) become genuinely inaccessible on mobile — no scroll, no card fallback. This table renders inside the sidebar "Financial Summary" card whenever a deposit has been paid. — `src/components/features/invoices/RefundHistoryTable.tsx:98-99` (wrapper/table), rubric #5 and #1 violation.
- [H] item#7 — Edit/Delete icons on each booking item row (`SortableBookingItem`) are bare `<button>` elements with only `h-4 w-4` icons (16px) and no padding — tap target ~16×16px. Has a `title` attribute but no `aria-label`. — `PrivateBookingDetailClient.tsx:478-493`
- [H] item#8 — "Edit deposit amount" button is a bare `<button>` with only a `PencilIcon className="h-3.5 w-3.5"` (14px), no padding classes (`className="text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-1 focus:ring-gray-400 rounded"`), tap target ~14×14px even though it does have `aria-label="Edit deposit amount"`. — `PrivateBookingDetailClient.tsx:2970-2982`
- [H] item#9 — Payment-history row edit/delete icon buttons are bare `<button>` elements with `h-3.5 w-3.5` (14px) icons and no padding classes; `aria-label` is present but tap target is ~14×14px. — `PaymentHistoryTable.tsx:249-270`
- [L] item#10 — Payment-history rows use `text-xs` (12px) throughout and lay out date/type/method on the left and amount+2 icon buttons on the right in a single `flex items-center justify-between` row with no `flex-wrap`. With a long date/type/method string (e.g. "11 October 2026 — Balance · Invoice") plus a 4+ digit amount and two action buttons, this is tight at 375px; it currently fits but has no wrap fallback if strings grow (e.g. "Deposit" + "PayPal"). — `PaymentHistoryTable.tsx:233-244`
- [M] item#11 — Drag-handle button for reordering booking items is `h-5 w-5` (20px) with no padding (`className="mt-1 text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing"`), below the 44px target — mitigated somewhat by being a secondary/optional interaction (items can still be edited without reordering) and by having a correct `aria-label`. — `PrivateBookingDetailClient.tsx:429-437`

PASS elsewhere: the main `grid grid-cols-1 gap-8 lg:grid-cols-3` layout, all modal forms (`grid grid-cols-1 sm:grid-cols-2`), the item-type/discount-type picker grids (`grid-cols-2 sm:grid-cols-4`, `grid-cols-2`), `headerActions` (Share Link / Update Status / Edit Booking) wrap correctly on mobile via `PageLayout`'s built-in `flex-wrap` nav-row fallback, and all `Modal`s that need full mobile height pass `mobileFullscreen`.

REDESIGN: no — the page itself is a well-stacked single-column layout on mobile; the failures are isolated components (one raw table, several undersized icon buttons), not a structural mobile-card redesign need.

---

## /private-booking/[id]/edit

This route re-exports the plural route's page (`export { default } from '../../../private-bookings/[id]/edit/page'`), rendering the identical component tree.

Live files:
- `src/app/(authenticated)/private-bookings/[id]/edit/page.tsx`
- `src/components/features/customers/CustomerSearchInput.tsx`
- `src/components/private-bookings/EventDetailsRiskSection.tsx`

PASS (no mobile issues found)

Notes: all form sections use `grid grid-cols-1 sm:grid-cols-2` / `sm:grid-cols-3` (stacks correctly at 375px), `CustomerSearchInput` already has a `min-w-[44px]` tap target on its inline clear/status control and responsive `text-xs sm:text-sm` sizing with `truncate`/`max-w-[200px]` for long emails, and the Cancel/Save action row (`flex justify-end space-x-3`) is two short text buttons that fit comfortably at 375px.

REDESIGN: no

---

# Summary of cross-route findings

**Systemic (shared `src/ds/*` component):**
- `src/ds/composites/SectionNav.tsx` (used via `PageLayout`'s `navItems` on every route in this section) renders tabs at `h-9` (36px) — under the 44px tap-target minimum. It already scrolls horizontally inside its own container (`overflow-x-auto`) so it does not break the page, but the tap-target height itself is a systemic shortfall shared by every route that passes `navItems` to `PageLayout`. Not blocking, and out of scope to fix per-route since it's a shared component.

**Not systemic but repeated pattern (page/feature-level, not `src/ds`):** bare icon-only `<button>` elements with `h-3.5`–`h-5` icons and no padding appear repeatedly across this section's live files: `VenueSpaceDeleteButton.tsx`, `VendorDeleteButton.tsx`, `PrivateBookingDetailClient.tsx` (×3 spots), `PaymentHistoryTable.tsx`. These are each hand-rolled `<button>`s, not the shared `Button` component (which does have adequate padding at `size="sm"`), so this is a recurring authoring habit rather than a single component to fix.

**Genuine table/overflow failure:** `RefundHistoryTable.tsx` (`src/components/features/invoices/`) uses `overflow-hidden` instead of `overflow-x-auto` on its 6-column table wrapper, actively clipping the Reason/Reference columns on mobile with no way to reach them. This component is shared across `private_booking` / `table_booking` / `parking` refund history call sites, so a fix here benefits more than this section, but it lives outside `src/ds`.
