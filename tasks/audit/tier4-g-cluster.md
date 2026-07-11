# Guest-token cluster /g

Audit scope: 8 public, unauthenticated guest-token routes under `/g/[token]/...`.
All routes share the `GuestPageShell` wrapper (`src/components/features/shared/GuestPageShell.tsx`) — checked
once below since it is a shared component, not repeated per-route.

Shared shell checked: `src/components/features/shared/GuestPageShell.tsx` — `min-h-screen bg-sidebar px-4 py-12 sm:py-20`,
inner `mx-auto w-full max-w-xl` (or override), logo `mx-auto mb-8 w-52 sm:w-64` with `h-auto w-full` on the `<Image>`.
No fixed pixel widths, no horizontal-scroll risk, media scales correctly. No issues found in the shell itself.

---

## /g/[token]/card-capture

Live file: `src/app/g/[token]/card-capture/page.tsx` (static page, no client component, no imports beyond React).

PASS (no mobile issues found)

Notes: static "no action needed" notice, single card, `max-w-md w-full p-6/p-8`, all text stacks naturally. No form, no buttons, no wide content.

REDESIGN: no — trivial static content.

---

## /g/[token]/event-payment

Live files:
- `src/app/g/[token]/event-payment/page.tsx`
- `src/app/g/[token]/event-payment/EventPayPalPaymentClient.tsx` (client component rendering PayPal buttons)
- Shared: `src/components/features/shared/GuestPageShell.tsx`

Issues:
- [L] item#1 — "Try again" and PayPal error-recovery link/button use inline text (`ml-2 underline`, no padding) — likely under the 44px tap-target guidance, but they are secondary/rare-path recovery controls, not primary actions — `src/app/g/[token]/event-payment/EventPayPalPaymentClient.tsx:56-65`.
- [L] item#2 — PayPal `PayPalButtons` render is entirely controlled by the PayPal SDK/iframe; its internal tap-target sizing and text scaling are outside this app's control and can't be fixed here — `src/app/g/[token]/event-payment/EventPayPalPaymentClient.tsx:77-134`. Flagging as informational only.

REDESIGN: no — single-column card, all text wraps normally, no tables/grids, no fixed widths.

---

## /g/[token]/manage-booking

Live file: `src/app/g/[token]/manage-booking/page.tsx` (server-rendered, plain `<form method="post">`, no client component).

Issues:
- [M] item#1 — "Update seats" submit button uses `px-4 py-2 text-sm` (≈36px total height: 20px line-height + 16px vertical padding), below the 44px minimum tap-target guidance. It is a `w-full` button so width/reachability is fine, only the height is short — `src/app/g/[token]/manage-booking/page.tsx:239-244`.
- [L] item#2 — Seat `<input type="number">` has no explicit `inputMode`/inputmode hint; browsers usually infer the numeric keypad correctly from `type="number"` so this is low-impact, noting for completeness — `src/app/g/[token]/manage-booking/page.tsx:230-238`.

REDESIGN: no — single stacked form, one input, one button, no side-by-side fields, no tables.

---

## /g/[token]/private-feedback

Live file: `src/app/g/[token]/private-feedback/page.tsx` (server-rendered form, no client component).

Issues:
- [M] item#1 — "Submit feedback" button uses `px-4 py-2 text-sm` (≈36px height), below the 44px tap-target guidance, and it is NOT `w-full` (sizes to text only), so on a 375px screen it renders as a small ~150px-wide, ~36px-tall target sitting on its own — `src/app/g/[token]/private-feedback/page.tsx:218-223`.
- Note (not a finding) — Food/Service rating `<select>` pair is correctly stacked at base via `grid gap-4 md:grid-cols-2` (only splits into two columns at the 768px `md` breakpoint, well above the 375px audit width). Called out for completeness since side-by-side selects are a common mobile trap and this route gets it right — `src/app/g/[token]/private-feedback/page.tsx:177-202`.

REDESIGN: no — form is single-column at 375px, full-width `<select>`/`<textarea>` inputs, visible labels throughout.

---

## /g/[token]/sunday-preorder

Live file: `src/app/g/[token]/sunday-preorder/page.tsx` (static page — pre-order flow has been retired, page now only shows a "no longer required" notice).

PASS (no mobile issues found)

Notes: single static card, no form, no interactive elements at all.

REDESIGN: no — trivial static content.

---

## /g/[token]/table-manage

Live files:
- `src/app/g/[token]/table-manage/page.tsx`
- `src/components/features/shared/GuestSubmitButton.tsx` (client component — disables self + spinner on submit)
- `src/components/features/shared/GuestCancelBooking.tsx` (server component — two-step cancel confirmation)

Issues:
- [L] item#1 — "Save changes" (`GuestSubmitButton`) and the three `GuestCancelBooking` links use `px-4 py-2.5 text-sm` (≈40px height: 20px line-height + 20px vertical padding) — a little under the 44px guidance but close enough that it's a minor nit rather than a real usability problem — `src/app/g/[token]/table-manage/page.tsx:207-212`, `src/components/features/shared/GuestCancelBooking.tsx:22,44,50`.
- Party size `<input type="number">` and notes `<textarea>` are both `w-full`, labelled, and stack correctly — no issues.
- Cancel-confirmation buttons correctly go `flex flex-col gap-2 sm:flex-row` (stacked on mobile, side-by-side only at `sm`+) with `w-full sm:w-auto` — verified CORRECT pattern, not a finding — `src/components/features/shared/GuestCancelBooking.tsx:40-54`.

REDESIGN: no — single-column stacked form + confirmation panel, no tables/grids.

---

## /g/[token]/table-payment

Live files:
- `src/app/g/[token]/table-payment/page.tsx` (server component; also defines an inline `'use server'` capture action)
- `src/app/g/[token]/table-payment/TablePaymentClient.tsx` (client component rendering PayPal buttons)

Issues:
- [L] item#1 — Same as event-payment: the inline "Try again" recovery link (`ml-2 underline`, no padding) is a small tap target, but it's a rare error-recovery path, not the primary CTA — `src/app/g/[token]/table-payment/TablePaymentClient.tsx:102-111`.
- [L] item#2 — PayPal `PayPalButtons` sizing/tap-targets are controlled by the PayPal SDK iframe, outside this app's control — `src/app/g/[token]/table-payment/TablePaymentClient.tsx:123-151`.

REDESIGN: no — single-column card, all copy stacks, no wide content.

---

## /g/[token]/waitlist-offer

Live file: `src/app/g/[token]/waitlist-offer/page.tsx` (server-rendered, plain `<form method="post">`, no client component).

Issues:
- [M] item#1 — "Confirm seats" submit button uses `px-4 py-2 text-sm` (≈36px height), below the 44px tap-target guidance. It is `w-full` so width is fine, only height is short — `src/app/g/[token]/waitlist-offer/page.tsx:247-252`.

REDESIGN: no — single-column card, one button, no tables/grids, no fixed widths.

---

## Summary of recurring pattern

Three routes (manage-booking, private-feedback, waitlist-offer) use a bare `<button>` with `px-4 py-2` (≈36px tall) for their primary submit action instead of the slightly taller `py-2.5` (≈40px) used by table-manage/GuestCancelBooking, or a proper `Button` primitive from `@/ds` sized to 44px. This is NOT a shared component — each page hand-rolls its own button classes inline (guest-token pages predate/bypass the `@/ds` design system, likely intentionally to keep the public-facing bundle small and framework-free). Because it's duplicated page-local markup rather than one shared component, it is not classified as a systemic `src/ds` issue, but the same ~36-40px pattern repeats across 5 of the 8 routes and would be worth fixing in one pass if the team wants consistent 44px tap targets on all guest-facing primary actions.
