# Christmas dinner: one booking funnel (owner decisions, 10 November 2026)

Every sit-down Christmas dinner is a Christmas table booking (`booking_type = 'christmas'`), never a
private booking. This builds on the food link change (PR #321, `tasks/christmas-food-link/spec.md`):
the booking takes the table and the deposit only, and the organiser chooses food afterwards by link.

## Owner decisions

1. Buffets, drinks-only parties and private space or whole-pub hire stay private hire (no pre-order
   needed), at any size. Every other private hire standard stays the same (£250 deposit).
2. Sit-down Christmas dinner books online for 4 to 26 guests. More than 26 must call. This replaces
   D15 of the food link spec ("more than 20 only by staff").
3. Staff can book a Christmas dinner of up to 60 (setting `christmas_staff_max_party`). A party of 27
   or more is seated across tables that are not joined, with a warning to staff.
4. Someone who only wants prices, or wants to talk it through, sees the phone number
   (01753 682707, call or WhatsApp), the email address and the Christmas menu. No form.
5. Lead capture: name, email and phone are saved when the guest presses Continue on the details
   step. Nothing is held. If they do not finish, ONE follow-up email goes at 10:00 London the next
   morning, with a link that picks up where they left off. One follow-up per email address per
   season. An opt-out tick on the form stops it.
6. An unpaid deposit hold that lapses gets the "finish my booking" link inside the cancellation
   message it already gets, not a fourth message.
7. Staff see unfinished Christmas bookings on a "Christmas follow-ups" tab under table bookings, with
   the same permissions as the existing awaiting-confirmation call list (view to see, edit to mark
   called). No email to the owner.
8. The follow-up email wording below is approved and switches on at release.
9. Until brochure version 4 exists, the follow-up email and the front door link the Christmas page,
   not the PDF (the current PDF says 4 to 20, over 20 is private hire, 24 hours' notice, courses at
   booking: all stale).

## The funnel

Front door (Christmas page hero, sticky button, pop-up), three choices:

- Book Christmas dinner: `/book-table?christmas=1`
- Just after prices, or want to talk it through: phone (call or WhatsApp), email, Christmas menu
- Buffet, drinks-only party or private space: the private hire enquiry form

Booking form, Christmas mode, three steps:

1. Sitting: date, Lunch or Evening time, party size 4 to 26, at least 8 days ahead (the period's
   `min_notice_hours`). Over 26, or no free sitting: show the phone number.
2. Your details: name, email, phone, opt-out tick. Continue saves the lead (non-blocking: a failed
   lead save is logged and the guest carries on).
3. Deposit: summary and "Pay £X deposit" (£10 a head). Creates the booking and opens PayPal.

Then, as today: deposit paid, food link to the organiser, everyone chooses, choices lock at noon
7 days before.

Kitchen pacing is unchanged: online 21 to 26 is accepted only when the dining room is free and no
other food arrives within 15 minutes either side (the existing lone-party rule). Staff with manage
permission can override.

Seating today: only the five Dining Room tables join (4+4+6+6+6 = 26). 21-22 take four tables,
23-26 take all five. 27 or more has no joined table, so staff seat it across unjoined tables.

## API contract (management app, API key, scope `create:bookings`)

`POST /api/table-bookings/leads`

```json
{
  "lead_ref": "uuid minted by the website once per form session (idempotent upsert key)",
  "first_name": "Sam", "last_name": "Example",
  "email": "sam@example.com", "phone": "07700 900123", "default_country_code": "44",
  "booking_date": "2026-12-15", "booking_time": "12:00", "party_size": 12,
  "follow_up_opt_out": false,
  "purpose": "christmas"
}
```

Response `201 { "success": true, "data": { "lead_ref": "..." } }`; `400 { success: false, code:
"VALIDATION_ERROR", error }`. Calling again with the same `lead_ref` updates the row.

`POST /api/table-bookings` (existing) accepts an optional `lead_ref`; after a successful create the
lead is linked to the booking (`table_booking_id`). A failed link is logged, never fails the booking.

`POST /api/table-bookings/leads/resume`

```json
{ "token": "opaque token from the #resume= fragment" }
```

Response `200 { success: true, data: { first_name, last_name, email, phone (E.164), booking_date,
booking_time, party_size, purpose: "christmas" } }`; `404 { success: false, code:
"RESUME_LINK_INVALID" }` for an unknown or expired token. The token is 32 random bytes, base64url;
only its SHA-256 is stored; it stays valid until the end of the chosen date. Never personal data in
a URL: the token rides in the fragment (`/book-table?christmas=1#resume=<token>`), and the website
swaps it server side with its API key, then clears the fragment.

## Follow-up email (approved wording)

Subject: Your Christmas dinner at The Anchor

> Hi {first name},
>
> You started booking Christmas dinner for {number} on {weekday date}, but didn't get as far as
> the deposit, so we're not holding a table yet.
>
> If you'd still like to come, this link picks up where you left off, with your details filled
> in: **Finish my booking**
>
> The £10 a head deposit comes off your bill. Once it's paid, we'll send you a link for everyone
> to choose their food.
>
> Rather talk it through first? Call or WhatsApp us on 01753 682707, or see the menu on our
> Christmas page.
>
> {venue name and address, from the existing guest email footer}
>
> You're getting this one email because you started a booking with us. We won't send another.
> Unsubscribe

The weekday is computed with `src/lib/dateUtils.ts`, never written by hand.
