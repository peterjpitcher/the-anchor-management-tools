# Spec v2: Guest pages onto The Anchor design system

Date: 2026-08-05 (v2, after developer review)
Repo: OJ-AnchorManagementTools
Design handoff: vendored to `docs/design/guest-pages-2026-08/` (see D5)
Review: [guest-pages-redesign-spec-developer-review-2026-08-05.md](guest-pages-redesign-spec-developer-review-2026-08-05.md)
Inventory: [public-customer-facing-pages-inventory-2026-08-04.md](public-customer-facing-pages-inventory-2026-08-04.md)

## What this document is

The handoff README is the **visual source of truth**: every colour, size, weight and spacing
value is in it and is final. This spec does not repeat those values. It is the
**implementation contract**: corrected scope, typed component APIs, the route-state matrix,
and what was cut and why.

v2 resolves the 31 review findings. Where a finding needed an owner decision that would
otherwise block all work, the safe option was taken and recorded in **Deferred decisions**.

---

## Scope

**14 surfaces: 13 routes plus one Next.js not-found boundary.**

| # | Surface | Kind | Phase |
| --- | --- | --- | --- |
| 1 | `/feedback` | route | 1 |
| 2 | `/feedback/tell-us` | route | 1 |
| 3 | `/feedback/thanks` | route | 1 |
| 4 | `/g/[token]/table-payment` | route | 2 |
| 5 | `/g/[token]/event-payment` | route | 2 |
| 6 | `/g/[token]/waitlist-offer` | route | 2 |
| 7 | `/g/[token]/manage-booking` | route | 2 |
| 8 | `/g/[token]/private-feedback` | route | 2 |
| 9 | `/g/[token]/table-manage` | route | 3 |
| 10 | `/booking-portal/[token]` | route | 3 |
| 11 | `/parking/guest/[id]` | route | 4 |
| 12 | `/parking/payment-error` | route | 4 |
| 13 | `parking` not-found boundary | segment boundary, 404 at any `/parking/*` miss | 4 |
| 14 | `/privacy` | route | 4 |

Styling and layout only, with two deliberate exceptions recorded in **Approved copy and
behaviour changes** and **S1**.

### Out of scope, and why

| Surface | Reason |
| --- | --- |
| `/m/[token]/charge-request` | Manager tool. `charge-approvals.ts:280` emails it to `MANAGER_APPROVAL_EMAIL`. |
| `/error` | **Cut in v2 (review F02).** All five `FRIENDLY_MESSAGES` are password-reset or rate-limit. It is reached only from `src/app/auth/confirm/route.ts` and the onboarding throttle in `src/middleware.ts:138`. It is an auth surface. It keeps the `.auth` shell and its "Back to Dashboard" action, which is correct for its real audience. |
| `/g/[token]/sunday-preorder`, `/g/[token]/card-capture` | Retired stubs. Keep the legacy shell. |
| Parking signed-token access model | See D1. The data leak is fixed now; the access-model change is a separate ticket. |
| Destructive GET cancel path | See D2. Pre-existing, not introduced here. |
| Privacy policy legal facts | See D3. Copy unchanged. |

---

## Corrections to v1

| Ref | v1 said | v2 says |
| --- | --- | --- |
| F01 | 14 routes, then 15 | 14 surfaces: 13 routes + 1 boundary. Table above is authoritative. |
| F02 | `/error` in scope, "Back to Dashboard" is a bug | `/error` cut. It is an auth page and the action is correct. |
| F07 | 10 components | 11. `GuestBadge` added. |
| F08 | `--font-anchor-*` for both runtime and theme | Distinct names. Runtime `--font-dm-serif-runtime` etc, theme aliases to them. |
| F09 | Fonts in root layout | Guest-only font module, variables applied by `GuestShell`. |
| F10 | Namespaced colours give zero blast radius | Not sufficient. All guest element, focus and motion rules are scoped under `.guest-theme`. |
| F18 | "No component tests exist" | **Wrong.** A root `tests/` directory exists with `tests/components/GuestCancelBooking.test.tsx`, `tests/lib/parkingGuestPaymentNotice.test.ts`, `tests/lib/guestTokenThrottle.test.ts`, `tests/api/guestEventManageCancellation.test.ts`, `tests/api/guestWaitlistOfferConfirmRouteSmsGuards.test.ts` and more. v1 only searched `src/`. |
| F21 | 19 files | ~29 existing files, 11 new components, 1 new asset dir, plus tests. |
| F27 | Add 12px radius "only if defaults drift" | Add unconditionally. The theme has 6/8/10/14/20px, no 12px. `rounded-md` is 10px and would miss. |

---

## S1: Parking internal-notes exposure (P0, fix first)

**Confirmed live data leak, independent of this redesign.**

`src/app/(authenticated)/parking/_components/ParkingClient.tsx:912` and `:963` label the
`parking_bookings.notes` field **"Internal notes"** in the staff create and edit forms.
`src/app/parking/guest/[id]/page.tsx:22` selects `'*'` with the admin client and
`src/app/parking/guest/[id]/_components/PublicParkingClient.tsx:114` renders `booking.notes`
to the public.

**Fix, in Phase 0, ahead of any styling:**

1. Replace `.select('*')` with an explicit allow-list of exactly the columns the public page
   uses: `id, reference, status, payment_status, start_at, end_at, calculated_price,
   override_price, vehicle_registration, vehicle_make, vehicle_model, customer_first_name,
   customer_last_name`. `notes` is not in it.
2. Delete the notes block from `PublicParkingClient.tsx`. The handoff's "Notes block, when
   present, in a sunk box" instruction is void.
3. Add a test asserting the public projection cannot return `notes`.

This ships as its own commit so it can be deployed immediately, before the visual work.

---

## Design corrections

### C1: Primary CTA colour (review F05, P0)

The handoff's primary fill `#a57626` with white text is **4.02:1**. The specified label sizes
(14/16/18px semibold) are not WCAG large text, so they need 4.5:1. It fails.

**Resolution: primary button fill becomes `#8b6914` with white text (5.09:1).**
`#8b6914` is already the design system's designated "gold on light, AA safe" value, so this
stays inside the brand. Hover deepens to `#6f5410`. `#a57626` is retained everywhere it is
not carrying text: the accent rule on cards, active stars, and borders.

Record the measured contrast for default, hover, disabled and focus in the Phase 1 evidence.

### C2: Checkbox size conflict (review F17)

The handoff says 20px checkboxes globally but 18px on tell-us. **Resolution: 20px everywhere**,
label rows at `min-height: 44px`. The 18px was an inconsistency, not an intent.

### C3: One primary action per **form**, not per page (review F15)

`table-manage` legitimately has two independent forms ("Save changes", "Save food choices")
plus a destructive confirm. The rule is now: one `primary` per task card or form.
`GuestButton` gains an explicit `fullWidth` prop rather than an implicit breakpoint rule;
`/feedback` and blocked states pass `fullWidth` at all widths.

---

## Token, font and CSS isolation

Everything lands in `src/app/globals.css`, a new `src/lib/fonts/guest.ts`, and `GuestShell`.

### Tokens (review F2, F27)

Do **not** import `design_system/tokens/colors.css`. It defines `--bg`, `--surface`, `--text`,
`--border`, `--accent`, `--link`, which collide with the app's `@theme` block
(`globals.css:22-32`) and its shadcn HSL set (`globals.css:1205+`). Importing it restyles the
whole staff app.

Add to the existing `@theme` block, namespaced:

- Raw palette: `--color-anchor-green: #005131`, `--color-anchor-green-deep: #0c1d11`,
  `--color-anchor-green-light: #006b45`, `--color-anchor-gold: #a57626`,
  `--color-anchor-gold-dark: #8b6914`, `--color-anchor-gold-bright: #c9a020`,
  `--color-anchor-cream: #faf8f3`, `--color-anchor-cream-text: #f0e6c6`,
  `--color-anchor-charcoal: #1a1a1a`, `--color-anchor-grey-500: #6f6a61`,
  `--color-anchor-sand: #f5e6d3`, `--color-anchor-success: #006b45`,
  `--color-anchor-danger: #b1372f`
- Guest semantic layer: `--color-guest-bg: #faf8f3`, `--color-guest-surface: #ffffff`,
  `--color-guest-sunk: #f2ede3`, `--color-guest-border: #e2dccf`,
  `--color-guest-border-strong: #d2c9b4`, `--color-guest-text: #1a1a1a`,
  `--color-guest-text-strong: #005131`, `--color-guest-text-muted: #6f6a61`,
  `--color-guest-accent-text: #8b6914`
- Radii, unconditional: `--radius-guest-field: 6px`, `--radius-guest-card: 12px`
- Shadows: `--shadow-guest-card: 0 2px 8px rgba(26,26,26,0.06)`,
  `--shadow-guest-gold: 0 6px 24px rgba(139,105,20,0.28)`

No `.theme-dark` port. These pages ship light only.

### Fonts (review F8, F9)

Runtime and theme variables must have **different names**, or the theme alias references
itself and resolves to nothing.

`src/lib/fonts/guest.ts`:
```
DM_Serif_Display  weight 400        -> variable: '--font-dm-serif-runtime'
Outfit            weights 400,500,600,700 -> variable: '--font-outfit-runtime'
Clicker_Script    weight 400        -> variable: '--font-clicker-runtime'
```
Then in `@theme`: `--font-anchor-display: var(--font-dm-serif-runtime)` and so on, giving
`font-anchor-display` / `font-anchor-body` / `font-anchor-script` utilities.

**These are not registered in the root layout.** `GuestShell` applies the three variable
classes to its own wrapper, so staff routes never download them. Keep the app's existing
`--font-mono` (JetBrains Mono) for references and registrations.

### CSS isolation (review F10)

`GuestShell` renders `className="guest-theme"` on its outermost element. Every guest element,
`:focus-visible`, checkbox accent and `prefers-reduced-motion` rule is written as
`.guest-theme :focus-visible { ... }` and lives in a clearly fenced block in `globals.css`.
No bare element or `:focus-visible` selector is added at document level.

Phase 1 evidence must include a before/after screenshot of one staff page proving no change.

### Referrer safety (review F23, P0)

`next.config.mjs:45` sets `Referrer-Policy: strict-origin-when-cross-origin`, which sends the
**full path** on same-origin navigation. The new footer's `/privacy` link would therefore copy
`/g/<token>/...` and `/booking-portal/<token>` into privacy-page logs.

Every footer link, and every in-app link rendered by a guest primitive, sets
`referrerPolicy="no-referrer"`. Add a test asserting the footer renders it.

---

## Component contracts

New directory `src/components/features/guest/`. Leaf primitives are hook-free and safe to
import from both server and client components. Only `GuestShell` renders `<main>`.

```ts
// GuestShell.tsx  (server)
type GuestShellProps = {
  children: React.ReactNode
  maxWidthClassName?: string      // default 'max-w-[560px]'; table-manage + private-feedback pass max-w-2xl
  bodyClassName?: string          // padding override for the two centred feedback pages
  centred?: boolean               // align-items + text-align centre
}
// Renders: <div class="guest-theme ...fontvars"> <header/> <main/> <footer/> </div>
// Owns the ONLY <main> on the page. Inner page roots must use <section>/<form>/<div>.

// GuestCard.tsx  (server)
type GuestCardProps = { children: React.ReactNode; variant?: 'plain' | 'accent'; className?: string }
// Exactly one accent per page.

// GuestButton.tsx  (server-safe)
type GuestButtonBase = {
  variant?: 'primary' | 'outline' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  fullWidth?: boolean
  children: React.ReactNode
  className?: string
}
type GuestButtonProps =
  | (GuestButtonBase & { as?: 'button'; type?: 'button' | 'submit'; disabled?: boolean; onClick?: () => void })
  | (GuestButtonBase & { as: 'a'; href: string; external?: boolean; referrerPolicy?: string })
  | (GuestButtonBase & { as: 'link'; href: string })
// Discriminated union, never an anchor inside a button.

// GuestAlert.tsx  (server)
type GuestAlertProps = {
  tone: 'success' | 'notice' | 'problem'
  title?: string
  children: React.ReactNode
  role?: 'alert' | 'status'       // default: problem -> 'alert', others -> 'status'
  live?: 'polite' | 'assertive' | 'off'
  icon?: LucideIcon               // default per tone
  action?: React.ReactNode        // e.g. the parking retry submit, rendered inside
}

// GuestBadge.tsx  (server)  [NEW in v2, review F07]
type GuestBadgeProps = { tone: 'success' | 'outstanding' | 'danger' | 'outline'; children: React.ReactNode; dot?: boolean }
// Dot is decorative (aria-hidden). Text carries the status.
// Mapping: Confirmed|Completed|Seated|Paid -> success; Awaiting deposit|Pending|Outstanding -> outstanding;
//          Cancelled|No show|Failed -> danger; anything unrecognised -> outline, humanised text preserved.

// GuestField.tsx  (server-safe)
type GuestFieldProps = {
  id: string                      // required, wires label + aria-describedby
  label: string
  hint?: string
  error?: string
  required?: boolean
  children: React.ReactNode       // the control; receives id, aria-describedby, aria-invalid via cloneElement-free composition
}

// GuestAmount.tsx    { label, value, sub?, size?: 'page' | 'inline' }
// DetailRow.tsx      { label, value, emphasis?: 'default' | 'deadline' }
// DetailGrid.tsx     { items: Array<{ label, value }> }   // 2 cols, 1 col under 380px
// TrustLine.tsx      { children?: string }                 // default 'Secure payment via PayPal'
// GuestBlockedState.tsx {
//   kicker, heading, lead, reason: string,
//   primaryAction: { label, href },  secondaryAction?: { label, href }
// }   // the shared unavailable/expired/throttled screen, used by 7 routes
```

Existing components: `GuestSubmitButton.tsx` and `GuestCancelBooking.tsx`.
**`GuestSubmitButton`'s API and default classes must not change** (review F22): it is also used
by the excluded `/m/[token]/charge-request`. In-scope callers pass new className values; the
component itself is untouched. `StarRating.tsx` changes visuals only, all ARIA and keyboard
handling preserved.

---

## Route-state matrix

Every state below needs a fixture and a check. Derived from the actual branches in code, not
from the handoff's per-page prose (review F12).

| Route | States |
| --- | --- |
| table-payment | idle/ready, cancelled banner, client `paying`, client `success`, client `error` + retry, server `payment_status=completed`, blocked (each `tablePaymentBlockedReasonMessage` reason), throttled, hold expired, PayPal order-create failure, order-id persistence failure, missing PayPal client id |
| event-payment | idle, `creating`, success, error, cancelled banner, blocked, throttled, `manual_review`, fallback refresh |
| waitlist-offer | offer open, `confirmed`, `pending_payment`, blocked (3 reasons), throttled, expired |
| manage-booking | default, action status success, `blocked`, `can_change_seats=false`, prepaid refund note, throttled |
| private-feedback | form, submitted, blocked (2 reasons), throttled, submit error |
| table-manage | default, status banners, pre-order open, pre-order past cutoff (read-only), incomplete warning, withdrawn item, per-seat save error, **pre-order load failure (F28, new alert)**, confirm-cancel, cancel without reason, throttled, blocked |
| booking-portal | valid, invalid token, booking not found, deposit due, paid in full, cancelled, capture `capturing`/`success`/`error`, fresh-link loading/error |
| parking guest | confirmed, awaiting payment, received, payment success/cancelled/expired/not-found/missing-params, retry available, refunded |
| parking payment-error | 3 `COPY` variants |
| parking not-found | single state |
| feedback trio | landing, form, validation error, submitting, thanks |
| privacy | single state |

**F28 addition:** `table-manage/page.tsx` currently catches a `loadBookerPreorderView` failure,
logs a warning and renders nothing. A guest arriving from a pre-order reminder sees no food
section and no reason. Add a `problem` `GuestAlert` explaining that food choices could not be
loaded, with a call action, while leaving booking management and cancel working.

---

## Approved copy and behaviour changes (review F06)

"Styling only" was too absolute. This is the complete list of permitted new or changed
strings. Everything else, including all business, legal and error copy, is verbatim.

1. Per-page kickers: `Table booking`, `Event tickets`, `Event booking`, `Waitlist`,
   `Private hire`, `Guest parking`, `The Anchor`.
2. Footer: address from `COMPANY_DETAILS`, phone, email, "The Anchor website", "Privacy".
3. `TrustLine`: "Secure payment via PayPal".
4. Badge labels, from existing status values via `humanizeStatus()` and `statusLabels`.
5. Feedback script lines: "Stanwell Moor Village", "Where everyone's welcome".
6. Blocked-state actions: "Call 01753 682707", "Back to The Anchor", "Back to book a table",
   "View upcoming events".
7. `GuestBlockedState` headings and leads, which restate existing messages.

**Not approved, reverted to existing copy:** the booking-portal CTA stays
**"Pay deposit via PayPal"** (review F13). `FreshPayPalLinkClient` receives no amount, and
threading one through would change its props and risk showing a figure that disagrees with the
server. The handoff's "Pay deposit of £250.00" is not implemented.

### Contact facts (review F26)

One source. Add `src/lib/guest-contact.ts` deriving from `COMPANY_DETAILS`, exporting a
display phone (`01753 682707`, matching all 10 current usages), a `tel:` URI
(`tel:+441753682707`), the email, and the website URL. No hand-copied literals in components.

---

## table-payment success-state boundary (review F11)

The server page owns the `h1` and greeting; `TablePaymentClient` owns `paymentState`. On
client capture success the client currently cannot replace the server-owned chrome, so the
handoff's whole-page success state is not reachable by restyling alone.

**Resolution:** extract a client-safe presentation component that receives both the idle and
the success content as props and owns everything below `GuestShell`. The server page still
computes both variants and still calls the same preview loader; no server action, capture
call, amount check or audit log changes. On success the client swaps to the success content
in place and does not refresh, matching current behaviour. Add a test covering both the
server-completed and client-completed success paths.

---

## Testing (review F18, F19)

### Existing tests that constrain this work
`tests/components/GuestCancelBooking.test.tsx`, `tests/lib/parkingGuestPaymentNotice.test.ts`,
`tests/lib/guestTokenThrottle.test.ts`, `tests/lib/table-bookings/*`,
`tests/api/guestEventManageCancellation.test.ts`,
`tests/api/guestWaitlistOfferConfirmRouteSmsGuards.test.ts`, plus the source-guard tests for
table payment and public parking. Run the full suite each phase; do not weaken an assertion to
make a restyle pass.

### New tests required
- One render test per new primitive, covering variants, and for `GuestButton` that `as="a"`
  never nests interactive elements.
- `GuestShell` renders exactly one `<main>` and a `no-referrer` footer.
- `GuestBadge` status-to-tone mapping including the unrecognised fallback.
- Parking public projection cannot return `notes` (S1).
- table-payment server-completed and client-completed success.
- table-manage pre-order load failure renders the new alert.

### Visual evidence (replaces v1's throwaway route)
A dev-and-test-only fixture harness at `src/app/(dev)/guest-preview/`, guarded by
`process.env.NODE_ENV !== 'production'` returning `notFound()` in production, rendering each
primitive and each route state from synthetic fixtures. It is **committed**, not deleted, so
later phases can re-run it. Screenshot at 320, 390, 640 and 1024px. Store approved shots under
`docs/design/guest-pages-2026-08/baselines/`.

---

## Phases

Phase 0 ships alone and immediately. Phases 1 to 4 are independently deployable.

- **Phase 0, security:** S1 parking notes fix, plus its test. No visual change.
- **Phase 1, foundation:** tokens, guest font module, `.guest-theme` scoping, all 11
  primitives, the fixture harness, then `/feedback`, `/feedback/tell-us`, `/feedback/thanks`,
  `StarRating`. Evidence: staff-page before/after proving no leak.
- **Phase 2, payments:** `table-payment` first (establishes the payment and blocked patterns
  and the F11 boundary), then `event-payment`, `waitlist-offer`, `manage-booking`,
  `private-feedback`.
- **Phase 3, the big two:** `table-manage` including the F28 degraded state, then
  `booking-portal`.
- **Phase 4, off the legacy shell:** `parking/guest`, `parking/payment-error`, parking
  not-found, `privacy`. Then delete the dead `.public__*` block once grep confirms no
  consumers, and run the accessibility pass.

### Per-phase exit gate (review F25)
`npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build` all clean on Node 20.
Fixture screenshots at all four widths captured and diffed. Keyboard pass on every form in the
phase. No `role`, `aria-live`, `aria-describedby`, `aria-invalid`, `aria-expanded` or
`sr-only` lost versus the previous commit. Contrast recorded for any new colour pairing.

---

## Deferred decisions

Recorded, not blocking. Each needs an owner answer but none stops delivery.

- **D1, parking access model.** S1 closes the notes leak now. The deeper issue stands: the URL
  is a raw booking ID acting as a long-lived bearer credential with no expiry or revocation,
  unlike every `/g/` route which uses signed expiring tokens. Recommend a follow-up ticket to
  move parking onto guest tokens. Not attempted here.
- **D2, destructive GET cancel.** `table-manage` keeps a GET link that cancels a booking, as a
  fallback for sandboxed frames without `allow-forms`. This is pre-existing and the redesign
  does not make it worse. Changing it is a behaviour change outside this scope. Flagged.
- **D3, privacy legal facts.** The page names The Anchor as controller at Staines TW19 6BJ with
  `privacy@theanchorpub.co.uk`, while `COMPANY_DETAILS` names Orange Jelly Limited at Stanwell
  Moor TW19 6AQ. Copy is unchanged here. Needs an owner or legal answer.
- **D4, footer opening hours.** Left out. No verified URL, and the design system forbids
  inventing facts.
- **D5, handoff versioning.** The bundle is vendored into `docs/design/guest-pages-2026-08/`
  (README, logo assets, prototype) so the build does not depend on an iCloud path. Confirm this
  is acceptable for repository storage.
- **D6, route metadata.** Most token pages inherit the root title "Management Tools". Static
  non-personal titles would be an improvement. Not in this delivery.
