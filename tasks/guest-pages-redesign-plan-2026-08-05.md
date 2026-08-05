# Implementation plan: guest pages redesign

Date: 2026-08-05
Spec: [guest-pages-redesign-spec-2026-08-05.md](guest-pages-redesign-spec-2026-08-05.md) (v2)
Visual source of truth: `docs/design/guest-pages-2026-08/HANDOFF.md` (vendored, in-repo)
Prototype: `docs/design/guest-pages-2026-08/prototype.html`

## Rules for every work stream

1. **Read the spec v2 and `docs/design/guest-pages-2026-08/HANDOFF.md` before writing code.**
   The handoff has every exact colour, size and spacing value. The spec has the corrections
   that override it. Where they disagree, **the spec wins** (notably the CTA colour, the
   booking-portal CTA copy, the parking notes block, and `/error` being out of scope).
2. **Copy is verbatim** except the approved list in the spec. Do not rewrite guest-facing text.
3. **No em dashes** anywhere, including code comments and commit messages. A hook enforces it.
4. **Behaviour does not change.** No server action, route handler, PayPal call, token check,
   audit log or validation rule is altered. Server-rendered forms stay server-rendered.
5. **Accessibility must not regress.** Every `role`, `aria-live`, `aria-describedby`,
   `aria-invalid`, `aria-expanded` and `sr-only` present before must be present after.
6. **Do not touch** `src/app/m/[token]/charge-request/`, `src/app/g/[token]/sunday-preorder/`,
   `src/app/g/[token]/card-capture/`, `src/app/error/`, or
   `src/components/features/shared/GuestPageShell.tsx` / `GuestSubmitButton.tsx` internals.
7. **Route streams must not edit** `src/app/globals.css` or any file in
   `src/components/features/guest/`. If a primitive is wrong, report it, do not patch it.
8. Verify with `npm run lint`, `npx tsc --noEmit`, `npm test`. Node 20 (`nvm use`).

---

## Stream 0: parking internal-notes leak (P0, blocks nothing but ships first)

**Files:** `src/app/parking/guest/[id]/page.tsx`,
`src/app/parking/guest/[id]/_components/PublicParkingClient.tsx`, plus a new test.

1. Replace `.select('*')` at `page.tsx:22` with an explicit allow-list:
   `id, reference, status, payment_status, start_at, end_at, calculated_price, override_price,
   vehicle_registration, vehicle_make, vehicle_model, customer_first_name, customer_last_name`.
   Keep any additional column the component genuinely reads; `notes` must not be included.
2. Delete the `booking.notes` block at `PublicParkingClient.tsx:111-115` and any now-unused type
   field.
3. Add `tests/api/parkingGuestPublicProjection.test.ts` asserting the selected column list
   excludes `notes` and that the renderer has no notes branch.
4. No visual change beyond the removed block.

**Exit:** lint, typecheck, tests green. This is its own commit.

---

## Stream 1: foundation (everything else depends on this)

**Files:** `src/app/globals.css`, new `src/lib/fonts/guest.ts`, new
`src/lib/guest-contact.ts`, new `src/components/features/guest/*`, new
`src/app/(dev)/guest-preview/*`, new tests under `tests/components/guest/`.

### 1a. Tokens
Add the namespaced palette, guest semantic layer, radii and shadows from the spec's
"Tokens" section to the existing `@theme` block in `globals.css`. Do not modify any existing
token. Do not import the bundle's `colors.css`.

### 1b. Fonts
Create `src/lib/fonts/guest.ts` exporting `DM_Serif_Display` (400), `Outfit`
(400/500/600/700) and `Clicker_Script` (400) via `next/font/google` with the runtime variable
names `--font-dm-serif-runtime`, `--font-outfit-runtime`, `--font-clicker-runtime`, and a
combined `guestFontClassName` string. Alias them in `@theme` as `--font-anchor-display`,
`--font-anchor-body`, `--font-anchor-script`. **Do not register these in the root layout.**

### 1c. CSS isolation
Add one clearly fenced block in `globals.css` containing every guest element rule, scoped
under `.guest-theme`: `:focus-visible` (3px `#8b6914` outline, 2px offset, 6px radius),
checkbox/radio `accent-color`, and the `prefers-reduced-motion` transform disable. No bare
element or `:focus-visible` selector at document level.

### 1d. Contact source
Create `src/lib/guest-contact.ts` deriving from `COMPANY_DETAILS`: display phone
`01753 682707`, `tel:+441753682707`, `manager@the-anchor.pub`, `https://www.the-anchor.pub`,
and the full address string. Components import from here, never literals.

### 1e. The 11 primitives
Build every component in `src/components/features/guest/` to the typed contracts in the
spec's "Component contracts" section, styled to the handoff's values, with the spec's C1
(CTA `#8b6914`), C2 (20px checkboxes) and C3 (`fullWidth` prop) corrections applied.

`GuestShell` owns the only `<main>`, applies `guest-theme` and the font variable classes,
renders the brand bar with `/guest/anchor-logo-white.png`, and renders every footer link with
`referrerPolicy="no-referrer"`.

### 1f. Fixture harness
`src/app/(dev)/guest-preview/page.tsx` rendering every primitive and every variant from
synthetic fixtures. It must call `notFound()` when `process.env.NODE_ENV === 'production'`.
Committed, not deleted.

### 1g. Tests
One render test per primitive under `tests/components/guest/`. Plus: `GuestShell` renders
exactly one `<main>` and a `no-referrer` footer; `GuestButton as="a"` never nests interactive
elements; `GuestBadge` maps unrecognised statuses to `outline` with humanised text preserved.

**Exit:** lint, typecheck, tests green, plus a before/after screenshot of one authenticated
staff page proving the tokens and focus rules did not leak.

---

## Stream 2: feedback trio and StarRating

**Files:** `src/app/(feedback)/feedback/page.tsx`, `feedback/tell-us/page.tsx`,
`feedback/tell-us/TellUsClient.tsx`, `feedback/thanks/page.tsx`,
`src/components/features/feedback/StarRating.tsx`.
**Reference:** HANDOFF.md screens 10, 11, 12 and the `StarRating` note.

Move all three onto `GuestShell`. `/feedback` and `/feedback/thanks` use the centred body
padding overrides and the Clicker Script accent line. `tell-us` keeps the honeypot,
`crypto.randomUUID()` idempotency key, `EMAIL_PATTERN` check, consent-required-if-details rule
and disabled-until-rated submit. Inline errors become a `problem` `GuestAlert`. `StarRating`
changes visuals only: 44px targets, 30px filled Lucide stars, `#8b6914` active,
`#d2c9b4` inactive. All keyboard and ARIA behaviour preserved.

---

## Stream 3: table-payment (establishes the payment and blocked patterns)

**Files:** `src/app/g/[token]/table-payment/page.tsx`, `TablePaymentClient.tsx`.
**Reference:** HANDOFF.md screen 1.

Implement the idle, success and blocked states. Apply the spec's F11 resolution: extract a
client-safe presentation component receiving both idle and success content, owning everything
below `GuestShell`, so client capture success can replace the page chrome. No change to any
server action, capture call, amount check or audit log. `PayPalButtons` keeps
`style={{ layout: 'vertical', shape: 'rect' }}` untouched.

Build `GuestBlockedState` usage here first: it is reused by streams 4, 5 and 6.

Add tests for server-completed and client-completed success.

---

## Stream 4: remaining payment and management pages

**Files:** `src/app/g/[token]/event-payment/page.tsx`, `EventPayPalPaymentClient.tsx`,
`waitlist-offer/page.tsx`, `manage-booking/page.tsx`, `private-feedback/page.tsx`.
**Reference:** HANDOFF.md screens 3, 4, 5, 7.

All four reuse `GuestBlockedState` for their unavailable states. Cover every state in the
spec's route-state matrix, including `manual_review` and the event fallback refresh.

---

## Stream 5: table-manage

**Files:** `src/app/g/[token]/table-manage/page.tsx`, `PreorderSection.tsx`,
`src/components/features/shared/GuestCancelBooking.tsx`.
**Reference:** HANDOFF.md screen 2. The longest screen in the handoff; follow its ordering
exactly.

Add the F28 degraded state: when `loadBookerPreorderView` throws, render a `problem`
`GuestAlert` saying food choices could not be loaded with a call action, keeping booking
management and cancel working.

Add-ons stay tick-boxes. Keep the `seat_N_addons_present` hidden marker, the
`aria-describedby` link from each seat's add-on fieldset to the shared note, the
`aria-live="polite"` totals, `?confirmCancel=1` URL state, and the no-reason cancel GET link.
`tests/components/GuestCancelBooking.test.tsx` must still pass unmodified.

---

## Stream 6: booking-portal

**Files:** `src/app/booking-portal/[token]/page.tsx`, `PayPalCaptureClient.tsx`,
`FreshPayPalLinkClient.tsx`, `src/app/booking-portal/layout.tsx`.
**Reference:** HANDOFF.md screen 6.

Move onto `GuestShell`. **The deposit CTA keeps its existing copy "Pay deposit via PayPal"**,
per spec F13. Do not pass an amount into `FreshPayPalLinkClient`. Keep `autoStart`, order
creation and the redirect flow exactly as they are. Map the capture and fresh-link states onto
`GuestAlert`. `InvalidToken` and `BookingNotFound` become `GuestBlockedState` with their
existing copy.

---

## Stream 7: parking and privacy

**Files:** `src/app/parking/guest/[id]/page.tsx`,
`_components/PublicParkingClient.tsx`, `src/app/parking/payment-error/page.tsx`,
`src/app/parking/not-found.tsx`, `src/app/privacy/page.tsx`.
**Reference:** HANDOFF.md screens 8, 9, 13.

Move all four off `.public__*` onto `GuestShell`. **There is no notes block**, stream 0
removed it and the handoff's instruction to render one is void. Parking status and payment
status render as `GuestBadge`. The retry submit sits inside the `GuestAlert` when
`canRetryPayment`. The parking not-found boundary uses `GuestBlockedState`.

`/privacy` keeps all 15 sections verbatim, including the Staines address and
`privacy@theanchorpub.co.uk`, and gets the deep-green hero.

---

## Stream 8: cleanup and verification (last, sequential)

1. `grep -rn "public__" src` and confirm only `globals.css` remains, then delete that block.
2. Full pipeline: lint, typecheck, test, build on Node 20.
3. Screenshot every route state from the fixture harness at 320, 390, 640 and 1024px, save
   under `docs/design/guest-pages-2026-08/baselines/`.
4. Accessibility pass: keyboard through every form, gold focus ring visible on cream and
   white, no touch target under 44px, and a diff check that no ARIA attribute was lost.
5. `git diff` every modified file to catch scope stray from parallel work.

---

## Dependency order

```
Stream 0  (independent, ship first)
Stream 1  (foundation, blocks 2-7)
   ├── Stream 2  (feedback)
   ├── Stream 3  (table-payment, builds GuestBlockedState usage)
   │      ├── Stream 4  (other payment pages)
   │      ├── Stream 5  (table-manage)
   │      ├── Stream 6  (booking-portal)
   │      └── Stream 7  (parking + privacy)
Stream 8  (cleanup, after all)
```
