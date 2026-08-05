# Handoff: Guest-facing pages on The Anchor design system

## Overview

The Anchor Management Tools app (`management.orangejelly.co.uk`, Next.js 15 / React 19 / TypeScript / Tailwind / Supabase) has 15 public, token-authenticated pages that guests reach from SMS and email links: deposit and ticket payments, booking self-service, waitlist offers, a private-hire payment portal, parking, a feedback funnel, a privacy policy and an error page.

Today those pages are unbranded default Tailwind: `bg-sidebar` page, white `rounded-xl` cards, `slate-900` / `gray-600` type, `bg-green-600` and `bg-blue-600` buttons. They do not look like the brand website.

This handoff restyles all of them onto **The Anchor design system** so a guest who lands on a payment link recognises the same pub they booked with. **Page copy, form fields, routes, validation and server behaviour are unchanged.** This is a styling and layout task only.

14 of the 15 pages are in scope. `/m/[token]/charge-request` is explicitly **out of scope** (it is a manager tool, not guest-facing) and should be left exactly as it is.

## About the design files

`Guest Pages (open me).html` in this bundle is a **design reference created in HTML** — a prototype showing the intended look, not production code to copy. It is fully self-contained: open it in any browser, offline, and it renders all 14 routes (18 frames, including 4 extra states) side by side as 390px-wide mobile frames on one canvas.

Your task is to **recreate these designs inside the existing Next.js app**, using its established patterns: server components where the current pages are server components, the existing server actions and route handlers, Tailwind for layout, and the existing `'use client'` boundaries. Do not port the HTML file itself, and do not introduce a new CSS framework or component library.

The prototype uses the design system's own CSS classes (`.anchor-btn`, `.anchor-card`, `.anchor-input`, `.anchor-badge`, `.anchor-kicker`, `.anchor-script`) and CSS custom properties. In the real app you have a choice — either is fine:

- **Option A (recommended):** copy the token stylesheets from `design_system/` in this bundle into the app (e.g. `src/styles/anchor/`), import them once in the root layout, and map the tokens into `tailwind.config` so you can write `bg-anchor-green`, `text-anchor-gold-dark`, etc.
- **Option B:** skip the stylesheets and hard-code the exact values from the **Design tokens** section below into `tailwind.config`.

Either way, build a small set of shared React components (see **Component plan**) rather than repeating utility strings across 14 pages.

## Fidelity

**High fidelity.** Every colour, font size, weight, radius, border, shadow and spacing value below is final and exact. Recreate it pixel-perfectly. Where a value is not stated, it did not change from the current implementation.

Design system source of truth: **The Anchor Design System**, bundled in `design_system/` here. Its rules that matter for this work:

- Never invent facts. No opening hours, prices, menus or amenities that are not already in the current code. Sample values in the prototype (`£30.00`, `TB-2419`, `Skoda Octavia`) are placeholders for real data.
- British English, no em dashes, sentence case, no emoji. Copy is verbatim from the existing code, so this is already satisfied — do not rewrite any copy.
- DM Serif Display is **single weight 400**. Never faux-bold it, never apply `font-bold` / `font-semibold` to a heading.
- Icons are **Lucide** (`lucide-react` is the site's set). Do not draw SVGs by hand.
- The logo is used **black or white only**, never recoloured, never with effects.
- **Max one signature motif per surface.** These pages use exactly one: the gold top-accent rule on the primary card. Do not also add `.anchor-frame` or film grain.

---

## The shared shell

Every one of the 14 pages uses the same three-part shell. Build this once and the rest of the work is mostly content.

Replace the current `src/components/features/shared/GuestPageShell.tsx` with this structure. Its current implementation (cream `bg-sidebar` page, a 208–256px centred `/logo.png`, `max-w-xl` column) is fully superseded.

### 1. Brand bar (top)

```
background:      #005131  (--anchor-green)
padding:         15px 20px
content:         white wordmark, centred, width 116px, height auto
border-bottom:   3px solid #a57626  (--anchor-gold)
```

Full-bleed at every breakpoint. The logo is `assets/anchor-logo-white.png` (934×421 transparent PNG) — see **Assets**.

### 2. Page body

```
background:      #faf8f3  (--bg, warm cream)
padding:         26px 18px 30px          (mobile)
layout:          flex column, gap 18px
max-width:       560px, centred          (>= 640px)
padding:         40px 24px 48px          (>= 640px)
```

Two pages override the body padding because they are short and centred: `/feedback` uses `40px 18px 44px` and `/feedback/thanks` uses `52px 18px 56px`, both with `align-items: center; text-align: center`.

### 3. Footer

```
background:      #0c1d11  (--anchor-green-deep)
padding:         22px 20px
layout:          flex column, gap 11px
```

Full-bleed at every breakpoint. Contents, in order:

| Element | Style |
| --- | --- |
| Address line | 12px / 1.6, `rgba(240,230,198,0.7)` |
| Phone link | 13px, weight 500, `#c9a020`, `href="tel:01753682707"` |
| Email link | 13px, weight 500, `#c9a020`, `href="mailto:manager@the-anchor.pub"` |
| Link row | `padding-top: 11px; border-top: 1px solid rgba(201,160,32,0.25)`, flex wrap, gap 16px, 12px links in `rgba(240,230,198,0.82)` |

Address text, taken verbatim from `src/lib/company-details.ts`:

> The Anchor, Horton Road, Stanwell Moor Village, Surrey TW19 6AQ

Link row: **The Anchor website** → `https://www.the-anchor.pub`, **Privacy** → `/privacy`.

> **Open question for the product owner:** the footer has no opening hours. I deliberately did not add them because I have no verified hours or a verified URL for them, and the design system forbids inventing facts. If you want an "Opening hours" link, get the real URL and add it to this link row.

### Page intro block

Every page opens with the same three-part block, first child of the page body, `flex column, gap 7px`:

| Part | Font | Size | Colour | Notes |
| --- | --- | --- | --- | --- |
| Kicker | Outfit 600 | 12px, `letter-spacing: 0.18em`, uppercase | `#8b6914` | Names the flow: `Table booking`, `Event tickets`, `Event booking`, `Waitlist`, `Private hire`, `Guest parking`, `The Anchor` |
| `h1` | DM Serif Display 400 | 29px mobile / 40px ≥640px, `line-height: 1.2`, `letter-spacing: -0.02em` | `#005131` | Existing page title, unchanged |
| Lead `p` | Outfit 400 | 15px / 1.6 | `#6f6a61` | Existing greeting line from `formatGuestGreeting()`, unchanged |

The kicker is new — it is the only added element in the whole redesign, and it carries no facts.

---

## Component plan

Build these in `src/components/features/guest/` and use them across all 14 pages.

### `GuestPageShell`
Brand bar + cream body + footer, per above. Props: `children`, optional `maxWidthClassName` (keep the existing prop so the two `max-w-2xl` callers still work).

### `GuestCard` / `GuestCard variant="accent"`
```
background:      #ffffff  (--surface)
border-radius:   12px
border:          1px solid #e2dccf
box-shadow:      0 2px 8px rgba(26,26,26,0.06)
overflow:        hidden
accent variant:  border-top: 3px solid #a57626
body padding:    20px
```
**Exactly one card per page carries `variant="accent"`** — the primary one (the thing the page exists to do). All other cards on the page are plain. This is the design system's one-motif-per-surface rule.

### `GuestAmount`
The large money statement. This is the page's primary trust signal.
```
label:   11px, letter-spacing 0.16em, uppercase, weight 600, #6f6a61
figure:  DM Serif Display 400, 48px mobile / 60px >=640px, line-height 0.95, #005131
sub:     15px / 1.55, #6f6a61 (optional)
gap:     5px
```
Used on: table-payment (`Deposit due now`), event-payment (`Total due`), parking guest (`Amount`), waitlist-offer (`We are holding` / `2 seats` at 42px). The booking portal uses a smaller inline variant: DM Serif Display 22px, `line-height: 1`, right-aligned.

### `DetailRow`
```
display:         flex; justify-content: space-between; gap: 16px
padding:         10px 0
border-top:      1px solid #e2dccf
label:           13px, #6f6a61
value:           14px, weight 600, #1a1a1a, text-align right
```
Rows stack with no wrapper border; the top border of each row draws the separators. **Deadline values get `#8b6914`** (hold expiry, offer expiry, balance due date) — a small, deliberate emphasis, not a full alert.

### `DetailGrid`
For the parking and booking-portal pages, which currently use `<dl>` grids. `display: grid; grid-template-columns: 1fr 1fr; gap: 15px`; each cell is `flex column, gap 3px` with an 11px `letter-spacing: 0.1em` uppercase 600 `#6f6a61` label over a 14px weight-600 value. Single column below 380px.

### `GuestAlert`
Three tones, `border-radius: 12px`, `padding: 13px 15px` (16px when it holds a button), `flex` with a 16–17px Lucide icon at `flex: none`.

| Tone | Border | Background | Icon + title | Body text | Lucide icon |
| --- | --- | --- | --- | --- | --- |
| `success` | `rgba(0,107,69,0.28)` | `rgba(0,107,69,0.07)` | `#006b45` | `#006b45` | `check-circle-2` |
| `notice` | `rgba(165,118,38,0.35)` | `rgba(165,118,38,0.10)` | `#8b6914` | `#1a1a1a` | `alert-triangle` or `clock` |
| `problem` | `rgba(177,55,47,0.30)` | `rgba(177,55,47,0.06)` | `#b1372f` | `#1a1a1a` | `alert-circle` |

Title, where present: 13px, weight 700. Body: 14px / 1.6.

This replaces every `border-green-200 bg-green-50 text-green-800` / `amber` / `red` / `blue` / `yellow` banner in the current code. Map the existing tones: `green` → `success`, `amber` / `yellow` / `blue` → `notice`, `red` → `problem`.

### `GuestButton`
Pill, Outfit 600, `border: 2px solid transparent`, `transition: transform .2s cubic-bezier(.16,1,.3,1), background .2s cubic-bezier(.4,0,.2,1), box-shadow .2s cubic-bezier(.4,0,.2,1)`.

| Size | min-height | padding | font-size |
| --- | --- | --- | --- |
| `sm` | 44px | 0 24px | 14px |
| `md` | 48px | 0 32px | 16px |
| `lg` | 56px | 0 48px | 18px |

| Variant | Default | Hover |
| --- | --- | --- |
| `primary` | `background: #a57626; color: #fff` | `background: #8b6914; box-shadow: 0 6px 24px rgba(165,118,38,0.28); transform: translateY(-2px)` |
| `outline` | `transparent; border-color: #005131; color: #005131` | `background: #005131; color: #faf8f3; transform: translateY(-2px)` |
| `ghost` | `transparent; color: #1a1a1a` | `background: rgba(0,0,0,0.06)` |
| `danger` | `transparent; border-color: rgba(177,55,47,0.45); color: #b1372f` | `background: rgba(177,55,47,0.06)` |

`:active { transform: translateY(0) }`. `:disabled { opacity: 0.5; cursor: not-allowed; transform: none }`.

Full width on mobile; auto width, left-aligned at ≥640px (matches the existing `sm:w-auto`).

**One `primary` action per page.** Every current `bg-green-600` and `bg-blue-600` submit button becomes `primary`; `border-slate-300` / `border-gray-300` secondaries become `outline`; the cancel-booking trigger becomes `danger`. Keep the existing `GuestSubmitButton` pending/loading wrapper — only its className changes.

### `GuestField`
Wraps label, optional hint, and control, `flex column, gap 8px`.
```
label:   14px, weight 600, #1a1a1a
hint:    12px / 1.55, #6f6a61
control: background #fff; border 1.5px solid #d2c9b4; border-radius 6px;
         padding 12px 16px; min-height 48px; font-size 16px; color #1a1a1a;
         line-height 1.4; width 100%
focus:   border-color #8b6914; box-shadow 0 0 0 4px rgba(139,105,20,0.12); outline none
invalid: border-color #b1372f
placeholder: #6f6a61
```
`font-size: 16px` on inputs is deliberate — it stops iOS Safari zooming on focus. Do not reduce it. Textareas add `resize: vertical` and a `min-height` (82px for the 3-row special-requirements box, 118–120px for the 5-row comment boxes).

### `TrustLine`
```
flex, centred, gap 7px, 12px, #6f6a61
6px circle in #006b45, then the text "Secure payment via PayPal"
```
Sits directly under the payment control on table-payment, event-payment, the booking-portal deposit and parking guest. The prototype exposes this as a toggle; ship it on by default.

### `StarRating` (restyle only)
`src/components/features/feedback/StarRating.tsx` keeps all its logic, keyboard handling and ARIA. Only the visuals change: 44×44px touch target per star, Lucide `star` at 30px with `fill: currentColor; stroke: none`, active `#a57626`, inactive `#d2c9b4`, gap 2px. Drop the `text-yellow-400` / `text-gray-300` and the `focus-visible:ring-blue-500`; focus uses the global gold ring below.

### Focus, checkboxes, motion

```
:focus-visible { outline: 3px solid #8b6914; outline-offset: 2px; border-radius: 6px }
checkbox / radio: 20px square, accent-color: #005131, enclosing label row min-height 44px
```

All transitions 150–400ms on `cubic-bezier(0.4, 0, 0.2, 1)` or `cubic-bezier(0.16, 1, 0.3, 1)`. No bounces, no infinite loops. Honour `prefers-reduced-motion: reduce` by disabling the transform on hover.

### PayPal

**Do not restyle the PayPal buttons.** `PayPalButtons` keeps `style={{ layout: 'vertical', shape: 'rect' }}` exactly as it is today in `TablePaymentClient.tsx`. The prototype shows a dashed placeholder where the SDK renders; in the app, the SDK output sits there unchanged. Surrounding chrome (the amount above, the trust line below) is ours; the button itself is PayPal's.

---

## Screens

Each entry gives the route, its source files, and what changes. Copy is unchanged everywhere.

### 1. `/g/[token]/table-payment` — Pay table deposit
`src/app/g/[token]/table-payment/page.tsx` · `TablePaymentClient.tsx`

Kicker `Table booking`, h1 "Complete your deposit payment". Accent card contains, top to bottom: `GuestAmount` labelled "Deposit due now"; `DetailRow`s for Booking reference, Covers, Hold expires (gold value); the PayPal SDK slot; `TrustLine`. Below the card, centred 14px `#6f6a61`: "Need help? Call 01753 682707." with the number as a gold `tel:` link.

The `showCancelledMessage` banner becomes a `notice` alert with the `clock` icon, placed above the card.

**Success state** (`payment_status === 'completed'`, and the client's `paymentState === 'success'`): h1 "Deposit received". Accent card holds a 32px `rgba(0,107,69,0.12)` circle with a Lucide `check` in `#006b45`, a `success` badge reading "Paid", then the two existing paragraphs at 15px / 1.65 and 14px / 1.6. Below the card, a full-width `outline` button "Back to The Anchor".

**Blocked state** (`state === 'blocked'`, throttled, or `preview.state !== 'ready'`): h1 "Payment link unavailable", lead "we could not open your payment link.", then a `problem` alert whose title is the mapped `tablePaymentBlockedReasonMessage(reason)` and whose body is "Please call 01753 682707 for help." Then a `primary` button "Call 01753 682707" (`tel:` link) and a `ghost` button "Back to book a table". **This is the shared pattern for every unavailable/expired/throttled state across all pages** — reuse it on event-payment, manage-booking, waitlist-offer, table-manage and private-feedback with only the h1, lead and reason text differing.

### 2. `/g/[token]/table-manage` — Manage table booking, incl. pre-orders
`src/app/g/[token]/table-manage/page.tsx` · `PreorderSection.tsx` · `preorder-data.ts` · `src/components/features/shared/GuestCancelBooking.tsx` · `GuestSubmitButton.tsx`

Longest page. Body gap 20px. Order:

1. Intro block, kicker `Table booking`, h1 "Manage table booking".
2. Status banners (`statusMessage()`, `preorderMessage()`) as `GuestAlert`s, tone-mapped as above.
3. **Accent card — booking summary.** Header row: left, an 11px uppercase "Booking" label over the reference in DM Serif Display 26px `#005131`; right, a status `anchor-badge` with a 7px dot, `margin-top: 4px`. `humanizeStatus()` maps to badge tone: Confirmed / Completed / Seated → `success`; Awaiting deposit → outstanding (`rgba(165,118,38,0.14)` on `#8b6914`); Cancelled / No show → danger (`rgba(177,55,47,0.12)` on `#b1372f`). Then `DetailRow`s for Time, Table, Party size. This replaces the current `bg-gray-50` block.
4. **Plain card — change form.** `GuestField` party size (`type="number"`, min 1, max 20) and `GuestField` special requirements with the existing three-sentence hint as the field hint (it must stay above the textarea — it is the lawful basis for collecting dietary data, not decoration). `primary` md submit "Save changes".
5. **Pre-order section.** Separated by `padding-top: 20px; border-top: 1px solid #d2c9b4`.
   - `h2` "Your food choices" in DM Serif Display 22px, then the 14px / 1.6 explanation.
   - The verbatim `PREORDER_ADDON_GUEST_NOTE` in a gold-bordered box: `border: 1px solid rgba(165,118,38,0.35); background: rgba(165,118,38,0.07); border-radius: 12px; padding: 13px 15px; font-size: 13px`. Keep its `id` so each seat's add-on fieldset can still point `aria-describedby` at it.
   - Cutoff line, 13px `#6f6a61`.
   - Incompleteness warning as a `notice` alert.
   - **One block per seat**, `border: 1px solid #e2dccf; border-radius: 12px; background: #fff; padding: 16px`, `flex column, gap 14px`. Title (`seatLabel()`) 14px weight 700 `#005131`. Then `GuestField`s: Name (optional), Starter (optional), Main, Dessert (optional) — courses in `PREORDER_COURSES` order, each skipped when its menu has no items, exactly as now.
   - **Add-ons stay tick-boxes, never a dropdown.** Nested fieldset: `border: 1px solid #e2dccf; border-radius: 6px; background: #f2ede3; padding: 12px 14px`, legend 13px weight 600. Each row is a label at `min-height: 44px`, `gap: 11px`, 14px text, with a 20px `accent-color: #005131` checkbox. Keep the `seat_N_addons_present` hidden marker. The `aria-live="polite"` saved-total line below stays, at 13px / 1.55 `#6f6a61`.
   - Dietary requirement `GuestField` last.
   - Withdrawn-item note per seat → `notice` alert. Per-seat save error → `problem` alert, and the seat's controls take `.anchor-input--invalid` (`border-color: #b1372f`).
   - Booking-wide add-on total and the allergy line: `border: 1px solid #e2dccf; background: #f2ede3; border-radius: 12px; padding: 13px 15px; font-size: 13px / 1.6`.
   - `primary` md submit "Save food choices".
   - Read-only variant (`cutoff.editable === false`) keeps the same seat-block shell with plain text rows instead of fields.
6. **Cancel.** `padding-top: 20px; border-top: 1px solid #d2c9b4`, a `danger` md full-width trigger "Cancel booking", then the 12px / 1.55 `#6f6a61` fee note. The confirm step keeps its URL-state behaviour and becomes a `problem`-toned panel: the seven `CANCELLATION_REASONS` radios at 44px rows, the detail textarea, a `primary`-shaped confirm in `#b1372f` ("Yes, cancel my booking"), an `outline` "No, keep my booking", and the "Cancel without giving a reason" GET link kept as a 12px underlined link. **That link must survive** — it is the fallback for sandboxed frames without `allow-forms`.

At ≥640px the seat fields go two-up in a 2-column grid; everything else keeps the single column.

### 3. `/g/[token]/event-payment` — Pay for event tickets
`src/app/g/[token]/event-payment/page.tsx` · `EventPayPalPaymentClient.tsx`

Kicker `Event tickets`, h1 "Complete your payment". Cancelled banner → `notice` with `clock`. Accent card: `GuestAmount` "Total due"; below the figure a 14px / 1.55 line "You are booking **2 seats** for **Quiz Night**." with the seat count and event name at weight 600 `#1a1a1a`; a Hold expires `DetailRow` with a gold value; the PayPal slot; `TrustLine`. Help line below.

**Success state** (`state === 'success'`): identical to table-payment's success card, h1 "Payment received", `outline` button "Back to The Anchor" → `https://www.the-anchor.pub/whats-on`.

**Blocked state:** shared pattern, secondary link "View upcoming events".

### 4. `/g/[token]/manage-booking` — Manage event booking
`src/app/g/[token]/manage-booking/page.tsx`

Kicker `Event booking`, h1 "Manage your booking". `actionStatusMessage()` → `success` alert; `state === 'blocked'` → `notice`. Accent card: an 11px uppercase "Event" label over the event name in DM Serif Display 26px `#005131`; `DetailRow`s for Event time, Current seats, Payment mode; then, when `payment_mode === 'prepaid'`, the refund-policy sentence in a sunk box (`border: 1px solid #e2dccf; background: #f2ede3; border-radius: 6px; padding: 12px 14px; 13px / 1.6`). Plain card below with the seats `GuestField` — its label keeps the current uppercase treatment (11px, `letter-spacing: 0.16em`, `#6f6a61`) — and a `primary` "Update seats". When `can_change_seats` is false, the "no longer be changed online" line goes in the sunk box instead. Help line last.

### 5. `/g/[token]/waitlist-offer` — Confirm waitlist seats
`src/app/g/[token]/waitlist-offer/page.tsx`

Kicker `Waitlist`, h1 "Confirm your waitlist offer". Accent card leads with the hold as the statement: 11px uppercase "We are holding", then "2 seats" in DM Serif Display **42px**, then "for **Live Music: The Wharf Band**" at 15px / 1.5. `DetailRow`s for Event time and Offer expires (gold value). Then the `paymentNote` at 14px / 1.6 `#6f6a61`, then a **`lg` primary** full-width "Confirm seats" — this is the one page where the CTA is `lg`, because confirming is the entire purpose. Help line below.

**Confirmed state** (`state === 'confirmed'`): success card, h1 "Seats confirmed", `success` badge "Confirmed". **Pending-payment state** (`state === 'pending_payment'`): same card, h1 "Offer confirmed", `notice` tone. Both get the `outline` "Back to The Anchor". **Blocked:** shared pattern, secondary link "View upcoming events".

### 6. `/booking-portal/[token]` — Private booking deposit and balance portal
`src/app/booking-portal/[token]/page.tsx` · `PayPalCaptureClient.tsx` · `FreshPayPalLinkClient.tsx`

Multi-card page, body gap 16px. Replaces the current bare `bg-gray-50` layout — it should now use `GuestPageShell` like every other page.

1. Intro: kicker `Private hire`, h1 `{event_type} — {customerName}`, and a row under it with the status badge plus "Your booking summary" at 14px `#6f6a61`. `statusLabels` map to badge tones: Confirmed → `success`, Pending Confirmation → outstanding, Completed → `success`, Cancelled → danger.
2. Cancelled notice, when present → `problem` alert.
3. **Plain card — Event details.** `h2` as a 12px `letter-spacing: 0.16em` uppercase 600 `#6f6a61` label in **Outfit, not DM Serif Display** (these are labels, not headings). `DetailGrid` with Date, Time, Guests, Event type via the existing `DescriptionItem` null-skipping.
4. **Accent card — Payment status.** Same Outfit label treatment. Then rows separated by `1px solid #e2dccf`, each `padding: 12px 0`: left, a 14px weight-600 name over a 12px `#6f6a61` sub; right, the money in DM Serif Display 22px `#005131` with a badge under it. Deposit / Total / Balance remaining exactly as now, including the `Not required` / `Paid` / `Outstanding` logic and the `Paid in full — thank you!` banner (→ `success` alert).
5. When a deposit is due, between the deposit row and the total row: a `primary` md full-width "Pay deposit of £250.00", the `TrustLine`, then the existing terms-and-conditions paragraph at 12px / 1.6 `#6f6a61` with its two links underlined in `#8b6914`. Keep `FreshPayPalLinkClient`'s `autoStart` behaviour.
6. **Plain card — Your requests**, when `customer_requests` is present.
7. Contact block: `border: 1px solid #e2dccf; background: #f2ede3; border-radius: 12px; padding: 18px`, centred, "Questions about your booking?" at 14px weight 700 `#005131` over the call/email line at 14px / 1.6 with gold links.

The two failure screens (`InvalidToken`, `BookingNotFound`) move to the shared blocked pattern, keeping their copy.

### 7. `/g/[token]/private-feedback` — Private booking feedback
`src/app/g/[token]/private-feedback/page.tsx`

Kicker `Private hire`, h1 "Private booking feedback". Booking summary in a sunk box (`border: 1px solid #e2dccf; background: #f2ede3; border-radius: 12px; padding: 16px`, `flex column, gap 9px`) with three space-between rows at 13px; the booking id in `--font-mono`. Accent card holds the form: three `GuestField` selects (Overall rating *, Food rating, Service rating) with `renderScoreOptions()` unchanged, a Comments textarea (`rows=5`, `maxLength=2000`, `min-height: 120px`), and a `primary` md "Submit feedback". Status banners → `success` / `problem`. **Submitted state:** success card, h1 "Thanks for your feedback".

### 8. `/parking/guest/[id]` — Guest parking booking and payment
`src/app/parking/guest/[id]/page.tsx` · `_components/PublicParkingClient.tsx` · `paymentNotice.ts`

Currently on the bespoke `.public` hero pattern; move it onto `GuestPageShell`. Kicker `Guest parking`, h1 "Parking booking {headingStatus}" (the existing confirmed / awaiting payment / received wording), lead from `formatGuestGreeting()`.

`paymentNotice` becomes a `GuestAlert` with `noticeClasses` tone-mapped (`success` → success, `warning`/`info` → notice, `error` → problem), title at 13px weight 700 and message at 14px / 1.6. When `canRetryPayment`, the retry form's submit sits **inside** the alert as a `primary` md full-width button ("Pay now" / "Try payment again"), with the `TrustLine` under it.

Accent card: `GuestAmount` "Amount", then a `DetailGrid` of all eight details. Parking status and payment status render as badges rather than plain text: paid → `success`, pending → outstanding, failed → danger, everything else → `anchor-badge--outline`. Registration and reference use `--font-mono`.

Notes block, when present, in a sunk box. The three assurance items (Secure booking, Confirmation, Support) become one sunk box, `flex column, gap 12px`, each row a 28px `rgba(0,81,49,0.1)` circle with a 15px Lucide icon in `#005131` (`check`, `bell`, `clock`) beside a 13px weight-600 title over a 12px `#6f6a61` sub. Help line last. The bespoke `.public__footer` is replaced by the shared footer.

### 9. `/parking/payment-error` — Parking payment problem
`src/app/parking/payment-error/page.tsx`

Kicker `Guest parking`, h1 from the `COPY` map. Accent card: a 36px `rgba(177,55,47,0.1)` circle with a 20px Lucide `alert-circle` in `#b1372f`, the body at 15px / 1.65, a Booking ID row in `--font-mono` above a `1px solid #e2dccf` top border, then the retry/call line at 14px / 1.6 with the phone number at weight 700 `#1a1a1a`. `outline` md "Return to The Anchor website".

### 10. `/feedback` — "How was your visit?" review funnel
`src/app/(feedback)/feedback/page.tsx`

The one page that leans on brand warmth. Body padding `40px 18px 44px`, centred, gap 26px. Intro is centred: **Clicker Script 30px `#8b6914`** reading "Stanwell Moor Village", then h1 "How was your visit with us?" at **32px**, then the 15px / 1.6 sub. No card. Two `lg` full-width buttons, gap 12px: `primary` "I enjoyed my visit" → `GOOGLE_REVIEW_URL`, `outline` "It could have been better" → `tellUsHref` (keep the `src` query passthrough).

The script line is the design system's locality voice and the only decorative flourish on any of these pages. Use it here and on `/feedback/thanks` only.

### 11. `/feedback/tell-us` — Private feedback form
`src/app/(feedback)/feedback/tell-us/page.tsx` · `TellUsClient.tsx`

Kicker `The Anchor` (matching the current `text-gray-400` eyebrow), h1 "We're sorry it wasn't quite right", lead at 15px / 1.65. Accent card, `flex column, gap 18px`: the rating group (15px weight-600 question over the restyled `StarRating`); the comments textarea (`rows=5`, `min-height: 118px`); then the contact disclosure — the toggle is a 14px weight-600 `#8b6914` underlined text button (`text-underline-offset: 3px`), replacing the `text-blue-600` link, and its expanded panel holds Name / Email / Phone `GuestField`s plus the consent checkbox row (18px box, `accent-color: #005131`, 13px / 1.55 label). `primary` md "Send feedback", full width on mobile.

Keep everything functional as-is: the off-screen honeypot, `crypto.randomUUID()` idempotency key, the `EMAIL_PATTERN` check, the consent-required-if-details-given rule, and the disabled-until-rated submit. Inline errors move from `text-red-600` to a `problem` alert. The submitting spinner keeps `animate-spin`, recoloured to `currentColor` on the gold button.

### 12. `/feedback/thanks` — Thank you
`src/app/(feedback)/feedback/thanks/page.tsx`

Body padding `52px 18px 56px`, centred, gap 20px. A 52px `rgba(0,107,69,0.12)` circle with a 28px Lucide `check` in `#006b45`; h1 "Thank you" at **34px**; the existing paragraph at 15px / 1.7 `#6f6a61`; then Clicker Script 28px `#8b6914` reading "Where everyone's welcome". No card.

### 13. `/privacy` — Privacy policy
`src/app/privacy/page.tsx`

The only page with a hero, because it is a document rather than a task. Under the brand bar: `background: #0c1d11; padding: 32px 20px`, `flex column, gap 8px` — an 11px `letter-spacing: 0.18em` uppercase `#c9a020` "The Anchor", h1 "Privacy Policy" at 34px in `#f0e6c6`, and the `Last updated` line at 14px `rgba(240,230,198,0.7)`.

Body: `padding: 28px 18px 34px`, `flex column, gap 22px`, one group per numbered section. `h2` in DM Serif Display **21px** `#005131`; body `p` at 15px / 1.7 `#1a1a1a`; `ul` at `padding-left: 20px`, `gap: 5px`, 15px / 1.6; sub-labels like "2.1 Information You Provide" at 14px weight 700 `#005131`. Contact blocks (Data Controller, ICO address, Contact Us) go in sunk boxes: `border: 1px solid #e2dccf; background: #f2ede3; border-radius: 12px; padding: 15px; 14px / 1.7`. All 15 sections keep their current text verbatim, including the `privacy@theanchorpub.co.uk` address and the Staines-upon-Thames TW19 6BJ controller address (note these differ from the footer's Stanwell Moor address — that is what the current page says, so leave it; flag it to the owner separately if it is wrong). The bespoke `.public__prose` and `.public__footer` are replaced by these rules and the shared footer.

### 14. `/error` — Friendly error page
`src/app/error/page.tsx` · `_components/ErrorClient.tsx`

Body padding `44px 18px 48px`, gap 22px. Centred intro: a 56px `rgba(177,55,47,0.1)` circle with a 28px Lucide `alert-circle` in `#b1372f`, h1 at 30px from `FRIENDLY_MESSAGES`, message at 15px / 1.7 `#6f6a61`. Then the `REF-{code}` block: `background: #f2ede3; border: 1px solid #e2dccf; border-radius: 12px; padding: 13px; font-family: var(--font-mono); font-size: 14px; color: #6f6a61`, centred. Then `lg` `primary` "Try again" and `lg` `outline` "Back to Dashboard", gap 10px. Then the 12px underlined `#6f6a61` "Contact support" mailto.

This page currently uses the internal `@/ds` `Icon` and `Button` and the `.auth` shell. Swap to `GuestPageShell` + `GuestButton` + `lucide-react`. All copy, including the `FRIENDLY_MESSAGES` map, is unchanged.

> **Worth raising with the owner:** guests hitting a broken link see a "Back to Dashboard" button pointing at an internal route they cannot use. The copy is unchanged here per instruction, but this is probably a real bug.

---

## Interactions and behaviour

Nothing behavioural changes. To be explicit about what must keep working:

- **Server-rendered forms stay server-rendered.** `table-manage`, `charge-request`, `private-feedback` and `waitlist-offer` post plain `<form method="post">` to their `action/` route handlers with no client JS. That is deliberate — it works on a weak signal in a car park. Do not convert them to client components or fetch calls.
- **URL state stays URL state.** `?confirmCancel=1` drives the cancel confirmation so the first click works before hydration. `?status=`, `?state=`, `?preorder=`, `?seat=`, `?reason=`, `?payment=` continue to drive banners and error highlighting.
- **The no-reason cancel GET link stays.** Sandboxed frames without `allow-forms` depend on it.
- **PayPal flows unchanged.** `TablePaymentClient`'s `idle → paying → success | error` machine, the `pointerEvents: none` guard while paying, the "Processing payment, please wait…" line (12px, centred, `#6f6a61`), `onCancel` returning to idle, and the "Try again" inline reset all stay. The server-side capture, amount-match checks and audit logging are untouched.
- **Throttling.** `checkGuestTokenThrottle` gates every token page; the throttled render uses the shared blocked pattern.
- **Accessibility must not regress.** Keep every `role="alert"` / `role="status"`, `aria-live="polite"` on the add-on totals, `aria-describedby` from add-on fieldsets to the one shared note, `aria-invalid` on failed seats, `aria-expanded` / `aria-controls` on the contact toggle, the `sr-only` labels, and `StarRating`'s arrow-key handling. Contrast: `#8b6914` is the AA-safe gold for text on cream — do not substitute `#a57626` in type.
- **Touch targets** never below 44px. Inputs are 48px.

## State management

No new state. The only client state in scope is what already exists: `TablePaymentClient`'s `paymentState` / `errorMessage`, `TellUsClient`'s form fields plus `showContact` / `submitting` / `error`, `StarRating`'s `hovered`, and `PayPalCaptureClient` / `FreshPayPalLinkClient`'s capture state. Everything else is server-rendered from `getTablePaymentPreviewByRawToken`, `getTableManagePreviewByRawToken`, `getEventPaymentPreviewByRawToken`, `getEventManagePreviewByRawToken`, `getWaitlistOfferPreviewByRawToken`, `getPrivateBookingFeedbackPreviewByRawToken`, `loadBookerPreorderView` and `verifyBookingToken`.

## Design tokens

Exact values, from `design_system/tokens/`. Semantic tokens are what you should build against; the raw `--anchor-*` palette is for cases where a brand colour must stay fixed.

### Colours — brand
| Token | Hex | Use |
| --- | --- | --- |
| `--anchor-green` | `#005131` | Primary brand green, brand bar, headings |
| `--anchor-green-dark` | `#003d25` | Pressed, deep panels |
| `--anchor-green-deep` | `#0c1d11` | Footer, privacy hero |
| `--anchor-green-light` | `#006b45` | Hover green, success text |
| `--anchor-gold` | `#a57626` | Gold **fills**: primary button, accent rule, active stars |
| `--anchor-gold-dark` | `#8b6914` | Gold **text** on light (AA 4.5:1). Kickers, links, deadlines |
| `--anchor-gold-bright` | `#c9a020` | Gold accents **on dark**: footer links, privacy hero kicker |
| `--anchor-charcoal` | `#1a1a1a` | Body ink |
| `--anchor-cream` | `#faf8f3` | Page background |
| `--anchor-cream-text` | `#f0e6c6` | Text on deep green |
| `--anchor-sand` | `#f5e6d3` | Warm tint for badges |
| `--anchor-grey-500` | `#6f6a61` | The one muted grey |
| `--anchor-success` | `#006b45` | |
| `--anchor-danger` | `#b1372f` | |

### Colours — semantic (light theme, what these pages use)
| Token | Value |
| --- | --- |
| `--bg` | `#faf8f3` |
| `--surface` | `#ffffff` |
| `--surface-sunk` | `#f2ede3` |
| `--text` | `#1a1a1a` |
| `--text-strong` | `#005131` |
| `--text-muted` | `#6f6a61` |
| `--accent` | `#005131` |
| `--accent-text` | `#8b6914` |
| `--border` | `#e2dccf` |
| `--border-strong` | `#d2c9b4` |
| `--border-gold` | `rgba(165,118,38,0.35)` |
| `--focus-ring` | `#8b6914` |
| `--link` | `#005131` |
| `--link-hover` | `#8b6914` |

A `.theme-dark` remap exists in `design_system/tokens/colors.css` (the live website's surface). These pages ship **light**; the prototype exposes a dark toggle only so you can see it. Building against the semantic tokens means a future dark switch is a one-class change.

### Typography
```
--font-display:  'DM Serif Display', 'Times New Roman', serif    /* 400 only, never bold */
--font-body:     'Outfit', system-ui, -apple-system, 'Segoe UI', sans-serif   /* 400-600 */
--font-script:   'Clicker Script', 'Brush Script MT', cursive     /* 400 only */
--font-mono:     ui-monospace, SFMono-Regular, Menlo, monospace
```
All three webfonts come from Google Fonts via `design_system/tokens/fonts.css`. In Next.js, prefer `next/font/google` for `DM_Serif_Display` (400), `Outfit` (400/500/600/700) and `Clicker_Script` (400).

Sizes used on these pages:

| Role | Font | Size | Weight | Line-height | Tracking |
| --- | --- | --- | --- | --- | --- |
| Page h1 | Display | 29px → 40px | 400 | 1.2 | −0.02em |
| Privacy / thanks h1 | Display | 34px | 400 | 1.2 | −0.02em |
| Feedback h1 | Display | 32px | 400 | 1.2 | −0.02em |
| Error h1 | Display | 30px | 400 | 1.2 | −0.02em |
| Money figure | Display | 48px → 60px | 400 | 0.95 | −0.02em |
| Waitlist seats | Display | 42px | 400 | 1 | −0.02em |
| Card reference / event name | Display | 26px | 400 | 1.1–1.15 | −0.02em |
| Section h2 | Display | 21–22px | 400 | 1.2 | −0.02em |
| Portal money | Display | 22px | 400 | 1 | −0.02em |
| Script accent | Script | 28–30px | 400 | 1 | — |
| Kicker | Body | 12px | 600 | 1 | 0.18em, uppercase |
| Detail-grid label | Body | 11px | 600 | 1 | 0.10em, uppercase |
| Money / card label | Body | 11px | 600 | 1 | 0.16em, uppercase |
| Card section label | Body | 12px | 600 | 1 | 0.16em, uppercase |
| Lead paragraph | Body | 15px | 400 | 1.6 | — |
| Prose paragraph | Body | 15px | 400 | 1.7 | — |
| Body / field label | Body | 14px | 400 / 600 | 1.6 | — |
| Detail value | Body | 14px | 600 | 1.4 | — |
| Detail label / small print | Body | 13px | 400 | 1.55–1.6 | — |
| Hint / footer / micro | Body | 12px | 400 | 1.55–1.6 | — |
| Input text | Body | 16px | 400 | 1.4 | — |

### Spacing (8px rhythm)
`4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 · 96` px → `--space-1` … `--space-9`.
Page body gap 18px (20px on table-manage, 16px on the booking portal). Card body padding 20px. Detail row padding 10px 0. Section separator `padding-top: 20px; border-top: 1px solid #d2c9b4`.

### Radii — four shapes only
```
--radius-xs:   3px    (dark-theme cards; unused here)
--radius-sm:   6px    (inputs, selects, textareas, nested fieldsets)
--radius-md:   12px   (content cards, alerts, sunk boxes)
--radius-pill: 999px  (buttons, badges)
```
Nothing in between. The 18px radius on the prototype's phone frames is the mock's bezel, not a page value — do not ship it.

### Controls
```
--control-h-sm: 44px   --control-h-md: 48px   --control-h-lg: 56px
```

### Shadows
```
--shadow-sm:   0 2px 8px rgba(26,26,26,0.06)     /* cards */
--shadow-md:   0 8px 20px rgba(26,26,26,0.08)
--shadow-lg:   0 10px 40px rgba(0,0,0,0.10)
--shadow-gold: 0 6px 24px rgba(165,118,38,0.28)  /* primary button hover */
```

### Motion
```
--ease-out:    cubic-bezier(0.16, 1, 0.3, 1)
--ease-in-out: cubic-bezier(0.4, 0, 0.2, 1)
--dur-fast: 0.15s   --dur: 0.2s   --dur-slow: 0.4s
```

## Assets

- **`assets/anchor-logo-white.png`** — 934×421 transparent PNG, the boxed ANCHOR wordmark. Used in the brand bar at 116px wide, `height: auto`. Replaces the current `/logo.png` in `GuestPageShell`. From the design system's `assets/logos/`.
- **`assets/anchor-logo-black.png`** — same wordmark in black, included for any light-background use. Not used by these 14 pages.
- **Never recolour, stretch, crop or add effects to either.** Black on light, white on dark green, nothing else.
- **Icons: `lucide-react`**, already a dependency of the website project and the design system's prescribed set. Glyphs used here: `check`, `check-circle-2`, `alert-circle`, `alert-triangle`, `clock`, `star`, `bell`. 2px stroke, no fills, inheriting `currentColor` from the parent — except the rating stars, which are filled (`fill: currentColor; stroke: none`).
- **No photography.** Deliberate: these pages are transactional and are opened on mobile data. Do not add hero images.
- **Fonts** from Google Fonts (see Typography).

## Files

In this bundle:

| Path | What it is |
| --- | --- |
| `Guest Pages (open me).html` | The design reference, self-contained. Open in a browser; all 18 frames on one canvas. |
| `assets/anchor-logo-white.png` | Brand bar logo. |
| `assets/anchor-logo-black.png` | Black wordmark, for completeness. |
| `design_system/tokens/*.css` | Colour, type, spacing, effects, font and base-element tokens. |
| `design_system/components.css` | The `.anchor-*` component classes the prototype composes. |
| `design_system/styles.css` | Single entry point that imports all of the above. |
| `design_system/README.md` | The full Anchor design system guide, including brand voice rules. |

In the target repo, the files to change:

| Route | Files |
| --- | --- |
| shared shell | `src/components/features/shared/GuestPageShell.tsx` |
| shared controls | `src/components/features/shared/GuestSubmitButton.tsx`, `GuestCancelBooking.tsx` |
| `/g/[token]/table-payment` | `src/app/g/[token]/table-payment/page.tsx`, `TablePaymentClient.tsx` |
| `/g/[token]/table-manage` | `src/app/g/[token]/table-manage/page.tsx`, `PreorderSection.tsx` |
| `/g/[token]/event-payment` | `src/app/g/[token]/event-payment/page.tsx`, `EventPayPalPaymentClient.tsx` |
| `/g/[token]/manage-booking` | `src/app/g/[token]/manage-booking/page.tsx` |
| `/g/[token]/waitlist-offer` | `src/app/g/[token]/waitlist-offer/page.tsx` |
| `/g/[token]/private-feedback` | `src/app/g/[token]/private-feedback/page.tsx` |
| `/booking-portal/[token]` | `src/app/booking-portal/[token]/page.tsx`, `PayPalCaptureClient.tsx`, `FreshPayPalLinkClient.tsx`, `../layout.tsx` |
| `/parking/guest/[id]` | `src/app/parking/guest/[id]/page.tsx`, `_components/PublicParkingClient.tsx` |
| `/parking/payment-error` | `src/app/parking/payment-error/page.tsx` |
| `/feedback` | `src/app/(feedback)/feedback/page.tsx` |
| `/feedback/tell-us` | `src/app/(feedback)/feedback/tell-us/page.tsx`, `TellUsClient.tsx` |
| `/feedback/thanks` | `src/app/(feedback)/feedback/thanks/page.tsx` |
| `/privacy` | `src/app/privacy/page.tsx` |
| `/error` | `src/app/error/page.tsx`, `_components/ErrorClient.tsx` |
| rating | `src/components/features/feedback/StarRating.tsx` |
| out of scope | `src/app/m/[token]/charge-request/page.tsx` — **do not touch** |

The `.public__*` classes used today by `/privacy`, `/parking/guest/[id]` and `/parking/payment-error` become dead once those three move to `GuestPageShell`. Check for other consumers before deleting them.

## Suggested order

1. Tokens and fonts into the app; `tailwind.config` extended.
2. `GuestPageShell` + the shared components. Verify on `/feedback/thanks`, the simplest page.
3. `/g/[token]/table-payment` end to end, including its success and blocked states — it establishes the payment pattern and the shared blocked pattern.
4. The remaining payment and management pages, which reuse those patterns.
5. `/g/[token]/table-manage` — biggest, most fiddly, most worth its own pass.
6. `/booking-portal/[token]`, then the parking pair off `.public`.
7. Feedback funnel, `/privacy`, `/error`.
8. Accessibility pass: keyboard through every form, check the gold focus ring is visible on cream and on white, confirm no touch target is under 44px, confirm no `role`/`aria-*` was lost.
