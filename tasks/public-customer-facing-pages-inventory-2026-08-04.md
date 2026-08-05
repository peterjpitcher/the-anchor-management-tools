# Customer-facing pages inventory (AMS)

Date: 2026-08-04
Repo: OJ-AnchorManagementTools (`management.orangejelly.co.uk`)
Purpose: brief for a designer. Every page below is reachable by a member of the public with no login.

## Scope boundary, read this first

This app is **not** the public website. `www.the-anchor.pub` is a separate repo and holds
the browse-and-book journey (what's on, book a table, menus). AMS holds the pages a guest
lands on **after** we send them a link by SMS or email: pay, manage, confirm, feedback.

So the designer is styling **transactional guest pages**, not marketing pages. They still
need to look and feel like The Anchor.

## Current state of the design

There are three unrelated visual treatments across these pages. This is the main problem
to fix:

| Treatment | Where it lives | Used by |
|---|---|---|
| `GuestPageShell` (logo on dark `bg-sidebar`, white card) | `src/components/features/shared/GuestPageShell.tsx` | all `/g/*`, `/m/*`, `/feedback/*` pages |
| `public__*` CSS classes (hero band, cards) | `src/app/globals.css`, approx. lines 552 to 700 | `/parking/*`, `/privacy`, `/error` |
| Bespoke, no shared shell | inline in the page | `/booking-portal/[token]` |

A single guest design system replacing all three is the natural output of this work.

---

## TIER 1: live customer-facing pages (design these)

15 pages. All are one-off token links except `/feedback`, `/privacy` and `/error`.

### Table bookings

**1. `/g/[token]/table-payment`: Pay your table deposit**
How they arrive: SMS deposit link after booking a table for 10 or more, or a link sent by
staff from the BOH screen.
States to design: complete your deposit payment (PayPal buttons), deposit received,
payment link unavailable (3 reasons), payment unavailable (2 reasons), blocked.
Files: `src/app/g/[token]/table-payment/page.tsx`, `TablePaymentClient.tsx`

**2. `/g/[token]/table-manage`: Manage your table booking**
How they arrive: SMS confirmation, and pre-order chase reminders.
Content: booking summary, seasonal pre-order picker (per-seat mains and add-ons), cancel booking.
States: manage table booking, manage booking unavailable (2 reasons), pre-order open vs past cutoff.
Files: `src/app/g/[token]/table-manage/page.tsx`, `PreorderSection.tsx`

**3. `/m/[token]/charge-request`: Approve a charge**
How they arrive: SMS when we need the guest to approve a no-show or amendment charge.
States: approval request, already actioned.
Files: `src/app/m/[token]/charge-request/page.tsx`

### Events

**4. `/g/[token]/event-payment`: Pay for event tickets**
How they arrive: SMS or email payment link for a ticketed event.
States: complete your payment, payment received, payment link unavailable (3 reasons).
Files: `src/app/g/[token]/event-payment/page.tsx`, `EventPayPalPaymentClient.tsx`

**5. `/g/[token]/manage-booking`: Manage your event booking**
How they arrive: guest engagement SMS before the event.
States: manage your booking, manage booking unavailable (2 reasons).
Files: `src/app/g/[token]/manage-booking/page.tsx`

**6. `/g/[token]/waitlist-offer`: Confirm your waitlist seats**
How they arrive: SMS when seats free up. Time-limited offer.
States: confirm your waitlist offer, seats confirmed, offer confirmed, offer unavailable (3 reasons).
Files: `src/app/g/[token]/waitlist-offer/page.tsx`

### Private bookings (parties, functions)

**7. `/booking-portal/[token]`: Private booking payment portal**
How they arrive: email or SMS from the private bookings team to pay a deposit or balance.
The highest-value page here, and currently the least designed.
Content: booking summary, amounts due, PayPal capture, expired link refresh.
States: link not valid, booking not found, plus the main portal with several money sections.
Files: `src/app/booking-portal/[token]/page.tsx`, `PayPalCaptureClient.tsx`, `FreshPayPalLinkClient.tsx`

**8. `/g/[token]/private-feedback`: Private booking feedback**
How they arrive: follow-up message after the event.
States: feedback form, thanks for your feedback, feedback unavailable (2 reasons).
Files: `src/app/g/[token]/private-feedback/page.tsx`

### Guest parking

**9. `/parking/guest/[id]`: Guest parking booking and payment**
How they arrive: link given when booking a parking space.
Content: parking hero, booking details, payment status, retry payment.
Payment notice states: success, cancelled, expired, not found, missing parameters.
Files: `src/app/parking/guest/[id]/page.tsx`, `_components/PublicParkingClient.tsx`

**10. `/parking/payment-error`: Parking payment problem**
States: payment link incomplete, payment could not be matched, generic parking payment issue.
Files: `src/app/parking/payment-error/page.tsx`

### Review and feedback funnel

**11. `/feedback`: How was your visit?**
How they arrive: the protected `feedback` short link, used in every review-request SMS.
Two buttons: "I enjoyed my visit" (out to Google reviews) and "It could have been better"
(in to our private form). This is the highest-traffic public page in the app.
Files: `src/app/(feedback)/feedback/page.tsx`

**12. `/feedback/tell-us`: Tell us about your visit**
Private feedback form: rating, comments, optional name, email, phone, contact consent.
Files: `src/app/(feedback)/feedback/tell-us/page.tsx`, `TellUsClient.tsx`

**13. `/feedback/thanks`: Thank you**
Files: `src/app/(feedback)/feedback/thanks/page.tsx`

### Shared

**14. `/privacy`: Privacy policy**
Long-form legal content, 10 or more numbered sections. Needs a readable prose layout.
Files: `src/app/privacy/page.tsx`

**15. `/error`: Friendly error page**
Every broken or expired link lands here. Several messages keyed by an error code
(reset timed out, link incomplete, link already used, too many attempts, rate limited).
Files: `src/app/error/page.tsx`, `_components/ErrorClient.tsx`

---

## TIER 2: do NOT design these (retired or redirect only)

These URLs still resolve but hold no real page. Listed so nobody wastes design time.

| Route | What it actually does |
|---|---|
| `/table-booking` | 302 to `the-anchor.pub/book-table` |
| `/table-booking/success` | 302 to `the-anchor.pub/book-table` |
| `/table-booking/[reference]` | 302 to `the-anchor.pub/whats-on` |
| `/table-booking/[reference]/payment` | 302 to `the-anchor.pub/whats-on` |
| `/booking-confirmation/[token]` | 302 to `the-anchor.pub/whats-on` |
| `/booking-success/[id]` | 302 to `the-anchor.pub/whats-on` |
| `/g/[token]/card-capture` | static "No action needed", card holds were retired |
| `/g/[token]/sunday-preorder` | static "Sunday pre-orders are no longer required" |

---

## TIER 3: public but not customers (your call whether in scope)

No login needed, but the audience is staff, employees or job candidates rather than guests.
Worth including if the goal is "everything an outsider sees", worth excluding if the goal is
purely guest-facing.

| Route | Audience |
|---|---|
| `/auth/login`, `/login` | staff sign-in |
| `/auth/recover`, `/auth/reset`, `/auth/reset-password` | staff password reset |
| `/unauthorized` | staff, permission denied |
| `/recruitment/book/[token]` | job candidate picking an interview or trial slot |
| `/onboarding/[token]`, `/onboarding/success` | new employee onboarding form |
| `/timeclock` | staff clock-in kiosk on the FOH iPad, needs 44px touch targets |
| `/portal`, `/portal/shifts`, `/portal/leave`, `/portal/leave/new` | employee self-service |
| `/events/[id]/check-in` | staff kiosk, requires `events:manage`, not truly public |

---

## Adjacent guest-facing surfaces (not pages, flag if you want them covered)

The designer may want these in the same brand pass, since guests see them alongside the pages:

- Private booking **contract PDF** and event sheet (`src/lib/pdf-generator.ts`, `src/lib/private-bookings/`)
- **Invoice** and **quote** PDFs (`src/lib/invoices/`)
- Customer **email** templates (`src/lib/email/`)
- Customer **SMS** copy (`src/lib/sms/`), plain text, so no design work, but the tone should match

---

## Practical notes for the designer brief

1. **Mobile first, hard.** Almost every visit arrives from an SMS link on a phone. Design
   375px first, desktop second.
2. **Every page needs its error and expired states designed**, not just the happy path.
   Token links expire and get reused constantly, so the "unavailable" screens are seen often.
   The state lists above are taken from the live code.
3. **Payment pages embed PayPal buttons**, which come with fixed PayPal styling. The
   surrounding card has to sit comfortably next to a button we cannot restyle.
4. **No navigation.** These pages are dead ends by design. There is no sidebar, no menu and
   no way back into the app. Branding is the logo only.
5. Deliverable that suits the codebase best: one guest design system (shell, card, headings,
   buttons, status and notice blocks, form fields) plus per-page layouts, so
   `GuestPageShell` and the `public__*` CSS can both be replaced with one thing.
