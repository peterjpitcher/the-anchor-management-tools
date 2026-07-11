# Booking/parking/recruitment tokens

Audited at 375px width against the standard mobile rubric (no horizontal body scroll, tap targets, readable text, usable forms, wide-content handling, modals, reachable primary actions, media scaling).

Central mobile handling confirmed and NOT re-reported per-route:
- `src/app/globals.css` `@media (max-width: 820px)` block enforces `button:not(.ds-sidebar button), a[role="button"], [role="button"], .touch-target { min-height: 44px; min-width: 44px; }` — this wins over any local `min-h-10`/`py-2` utility classes on plain `<button>` elements (higher specificity via the `:not()` pseudo-class), so tap-target sizing on every button in this tier is already handled. Confirmed this beats Tailwind's `.min-h-10` (40px) and `Button` `size="md"` (`--spacing-btn-h: 42px` on mobile) — actual computed min-height is 44px.
- `src/app/globals.css` also sets `html, body { max-width: 100vw; overflow-x: hidden }` at the same breakpoint, and `input, select, textarea { font-size: 16px !important }` (prevents iOS auto-zoom).
- The `.public`/`.public__*` design-system classes (used by `/parking/guest/[id]` and `/parking/payment-error`) have a dedicated, thorough mobile layer (`globals.css:1324-1430`): hero padding/typography scale down, `.public__assurance` 3-col grid collapses to `1fr !important`, `.public__footer` stacks, `.public__summary` becomes a safe-area-aware sticky bar. This is a mature, purpose-built responsive system — not a page-level concern.
- Root `viewport` in `src/app/layout.tsx` sets `maximumScale: 5, userScalable: true` — pinch-zoom is never blocked app-wide.

## /booking-confirmation/[token]

Live file: `src/app/booking-confirmation/[token]/page.tsx`

This route is a pure server-side `redirect('https://www.the-anchor.pub/whats-on')` — it renders no JSX at all (no `<html>`/body ever reaches the client on this origin). Nothing to evaluate against the mobile rubric.

PASS (no mobile issues found) — trivial redirect, no rendered UI.

## /booking-portal/[token]

Live files:
- `src/app/booking-portal/[token]/page.tsx` (server, main render tree)
- `src/app/booking-portal/[token]/PayPalCaptureClient.tsx` (client, capture-on-return banner)
- `src/app/booking-portal/[token]/FreshPayPalLinkClient.tsx` (client, "Pay deposit via PayPal" button)
- `src/app/booking-portal/layout.tsx` (trivial wrapper, no chrome)

- [L] item#5 — `b.customer_requests` (free text from the customer/staff, rendered via `DescriptionItem` → `<dd className="mt-1 text-sm text-gray-900">{value}</dd>`) has no `break-words`/`overflow-wrap` guard and no global default exists in `globals.css`. A single long unbroken token (e.g. a pasted URL or reference with no spaces) would overflow the `max-w-2xl` card. Page-level `overflow-x:hidden` on `html body` (mobile media block) stops it from causing a body scrollbar, but the overflowing tail is simply clipped off-screen rather than wrapping — content becomes unreadable rather than the page breaking. — `src/app/booking-portal/[token]/page.tsx:118-126,357`

Everything else checked clean: single-column `grid-cols-1 sm:grid-cols-2` details grid (`page.tsx:242`), header title/badge row uses `flex-wrap` so it drops to two lines instead of overflowing (`page.tsx:212-224`), `FreshPayPalLinkClient` button has explicit `min-h-10` but the global 44px button rule wins on mobile (`FreshPayPalLinkClient.tsx:53`), footer contact block wraps normally, `next/image` logo uses `w-full h-auto` (scales).

REDESIGN: no — layout is already a simple mobile-first single-column card stack; only a text-overflow edge case on free-text input.

## /booking-success/[id]

Live file: `src/app/booking-success/[id]/page.tsx`

Same as booking-confirmation — a pure server-side `redirect('https://www.the-anchor.pub/whats-on')` with no rendered JSX.

PASS (no mobile issues found) — trivial redirect, no rendered UI.

## /parking/guest/[id]

Live files:
- `src/app/parking/guest/[id]/page.tsx` (server, fetches booking, delegates to client)
- `src/app/parking/guest/[id]/_components/PublicParkingClient.tsx` (client, full render tree)
- `src/app/parking/guest/[id]/paymentNotice.ts` (pure logic, no UI)

Note: `src/app/(authenticated)/parking/_components/ParkingClient.tsx` is a **different**, staff-facing component for an unrelated authenticated route — not a dead duplicate of this file, correctly not audited here.

- [L] item#5 — `booking.notes` (free text, staff-entered) rendered with `whitespace-pre-wrap` but no `break-words`/`overflow-wrap` guard, same gap as booking-portal above — a long unbroken token would be clipped by the page-level `overflow-x:hidden` rather than wrapping inside the card. — `src/app/parking/guest/[id]/_components/PublicParkingClient.tsx:111-116`

Everything else checked clean: `dl` detail grid is `grid gap-4 sm:grid-cols-2` (1 col at 375px, `PublicParkingClient.tsx:92`), the 3-item `.public__assurance` row collapses to 1 column via the shared mobile CSS (`globals.css:1284`), footer/link row is `flex-col sm:flex-row` (`PublicParkingClient.tsx:118`), payment retry button and other buttons get the global 44px min tap target, icons (`truck`/`check`/`bell`/`clock`) are decorative inside labelled rows, not icon-only tap targets.

REDESIGN: no — already a clean single-column card layout built on the shared `.public` system.

## /parking/payment-error

Live file: `src/app/parking/payment-error/page.tsx`

PASS (no mobile issues found). Single `.public__card` with heading, body text, optional booking-ID line (short, fixed-length, `font-mono`), and a plain link — everything wraps normally, no grids/tables/fixed widths, fully covered by the shared `.public` mobile layer.

REDESIGN: no.

## /recruitment/book/[token]

Live files:
- `src/app/recruitment/book/[token]/page.tsx` (server, fetches token preview)
- `src/app/recruitment/book/[token]/RecruitmentBookingClient.tsx` (client, full render tree — confirmed this is the only client component for this route, no dead duplicate found)

PASS (no mobile issues found).

- Single-column layout throughout (`max-w-2xl` main, `space-y-5` sections) — no grids, no tables.
- Slot picker uses full-row `<label>` wrapping the `<input type="radio">` + text (`RecruitmentBookingClient.tsx:202-214`), so the entire `p-3` row is the tap target, not just the small radio control — good pattern, no small-hit-area problem.
- Action buttons (Cancel/Reschedule/Book) use the shared `Button` from `@/ds`, sit in a `flex flex-wrap gap-2` row that wraps rather than overflowing (`RecruitmentBookingClient.tsx:186-193`), and inherit the 44px mobile tap-target floor.
- Cloudflare Turnstile widget renders into its own bordered card, not a fixed-width iframe wrapper that would force horizontal scroll.
- All text is short/structured (role title, date/time strings, location) — no free-text overflow risk like the two routes above.

REDESIGN: no.

## /m/[token]/charge-request

Live files:
- `src/app/m/[token]/charge-request/page.tsx` (server, full render tree)
- `src/components/features/shared/GuestPageShell.tsx` (shared wrapper — logo + centred `max-w-xl` column, used by multiple guest-token routes)
- `src/components/features/shared/GuestSubmitButton.tsx` (shared submit button — self-disabling on submit; sizing comes entirely from the caller's `className`, but the global mobile 44px `<button>` rule still applies since it's a plain `<button>`)
- `src/app/m/[token]/charge-request/action/route.ts` is a POST-only route handler (no UI), correctly excluded

PASS (no mobile issues found).

- Both `approved_amount` and `confirm_amount` inputs are `w-full` with `type="number"` and correctly associated `<label htmlFor>` (`page.tsx:217-231, 233-248`) — full-width, correct keyboard, visible labels.
- Checkbox confirmation row wraps the checkbox and its text inside one `<label>`, so the whole row (not just the 16px box) is clickable (`page.tsx:251-260`).
- The two forms (Approve / Waive) are separate block-level `<form>` elements stacked with `mt-3`, not a side-by-side pair that needs a `sm:` breakpoint to stack — no risk of unwanted side-by-side squeeze at 375px.
- Detail card lines (`Type`, `Amount`, `Booking`, `Time`, `Table`, `Guest`, `Party size`) are short, structured strings — no free-text overflow risk.
- Status/warning banners are simple full-width text blocks with no fixed widths.

REDESIGN: no.
