# Growth plan, management app changes (13 November 2026)

Branch `feat/growth-plan-app`, cut from `origin/main`. Local only: not pushed, no PR, nothing deployed, no migration written or applied. Items A to E come from the review of 13 November 2026, which the owner approved.

## Summary

| Item | Outcome | Migration |
|---|---|---|
| A. Private booking cancellation reason | Built. A reason from a fixed list is required on every staff cancellation. | None |
| B. Private hire enquiry form signals | Built. The funnel intake accepts the form, the daily summary lists it, and a quiet-form alert is added. | None |
| C. Deposit hold reminder | Already exists and covers email-first and text customers. Nothing changed. | None |
| D. "Tell me when the next one is on" | Built. New API endpoint; sign-ups join the email and text audiences. | None |
| E. `no_table` refusals on 28 October | Diagnosed. The cause was fixed on 29 October by an existing migration. Nothing changed. | None |

## A. Private booking cancellation reason

What existed: one server action, `cancelPrivateBooking` (`src/app/actions/privateBookingActions.ts`), is the only way staff cancel a private booking. The booking page's Change Status dialog called it with no reason, which the service stored as "Cancelled by staff". The list view called it with the fixed text "Cancelled from list view". The edit form and `updateBookingStatus` already refuse a cancellation and send staff to Change Status. The MCP bridge reaches the same action. There is no bulk cancel. The automatic paths (`private-bookings-expire-holds` cron, `expireBooking`) write "Deposit hold expired" and "Hold period expired (14 days)" and do not use the action.

What changed:

- `src/lib/private-bookings/cancellation-reasons.ts` (new): the owner's list (`date_unavailable`, `price`, `group_too_big`, `no_reply`, `chose_elsewhere`, `duplicate_or_test`, `other`), validation, and the stored format.
- `cancelPrivateBooking` now takes `{ code, note? }` as its second argument and refuses anything else before the service is called. "Other" needs a note; the note is optional otherwise, tidied and cut to 300 characters.
- `cancelBooking` in `src/services/private-bookings/mutations.ts` refuses a blank reason and no longer falls back to "Cancelled by staff".
- `src/components/private-bookings/CancellationReasonFields.tsx` (new) is shown in both dialogs: `PrivateBookingDetailClient.tsx` (Change Status) and `_components/PrivateBookingsClient.tsx` (list view). It shows whenever the dialog can cancel, including when the outcome preview failed.
- `src/lib/mcp/generated/actions.json` regenerated, because the action's parameters changed.

Storage: the existing `private_bookings.cancellation_reason` column, as `code` or `code: note`, the same shape table bookings use. No new column. `cancellation_channel` is how the cancellation arrived (SOP 14) and is unchanged.

Files left alone on purpose: the expire-holds cron and `expireBooking` keep their wording; older rows keep their free text.

Tests: `tests/actions/privateBookingActions.test.ts`, `tests/actions/privateBookingActionsSmsMeta.test.ts`, `tests/services/privateBookingCancelRefundOwed.test.ts`, `tests/lib/privateBookingCancellationReasons.test.ts`, `tests/components/privateBookingCancellationReasonFields.test.tsx`.

Assumptions:

- A confirmed booking that the customer cancels for their own reasons goes under "Other" with a note, because the owner's list has no entry for it.
- The stored value is the code, not the label, so a report can group by it. `privateBookingCancellationReasonLabel` turns it back into words.

## B. Private hire enquiry form signals

What existed: `POST /api/website/booking-funnel` records refusals and form signals in `booking_funnel_events`, with a closed field list. `BOOKING_FORMS` held only `event_booking`. The daily summary (`src/lib/booking-funnel/daily-summary.ts`, sent by `/api/cron/website-refusals-summary` at 08:00 UTC to the manager inbox) groups form lines by form. The table's CHECK on `route` already accepts any short code, so a new form name needs no schema change. The reports page and the weekly funnel loader read only availability and table-booking refusals, so a new form does not change their numbers.

What changed:

- `src/lib/booking-funnel/events.ts`: `BOOKING_FORMS` is now `['event_booking', 'private_hire_enquiry']`. Steps and reasons are unchanged.
- `src/lib/booking-funnel/daily-summary.ts`: label "Private hire enquiry form". A blocked private hire form with reason `network` (or any reason other than the ordinary ones) sends the daily summary, exactly as for the event form.
- `src/lib/booking-funnel/quiet-forms.ts` (new) and the cron route: the quiet-form alert.

The alert: over the seven London days ending yesterday, for form `private_hire_enquiry`, counted only for API keys that can make bookings: at least 2 `submit_pressed` and no `sent`, or at least 5 `started` and no `sent`. Opens are never counted towards either. One email to `manager@the-anchor.pub` (`MANAGER_ALERT_RECIPIENT`), claimed once per form per London day through the idempotency table. It runs before the daily summary and catches its own errors, so neither email can stop the other. If the count cannot be made or the email does not send, the run answers 502 and the run recorder emails `CRON_ALERT_EMAIL`; a failed send frees the claim so the next run retries.

Assumption: the alert goes out only when a new `started` or `submit_pressed` arrived on the last day counted. Without that, one bad afternoon would send the same email every morning for a week.

### Website contract for B

- Endpoint: `POST https://management.orangejelly.co.uk/api/website/booking-funnel`
- Auth: the website's API key in `X-API-Key` (or `Authorization: Bearer <key>`), with scope `write:ops_alerts`, which the key already holds for the event form.
- Body, JSON, no other fields allowed (an extra field is a 400):

```json
{ "type": "form", "form": "private_hire_enquiry", "step": "opened", "page": "/private-hire" }
```

| Field | Values |
|---|---|
| `type` | `"form"` |
| `form` | `"private_hire_enquiry"` |
| `step` | `"opened"`, `"started"`, `"submit_pressed"`, `"blocked"`, `"recovered"`, `"sent"` |
| `reason` | Optional. `"missing_fields"`, `"no_security_token"`, `"server_refused"`, `"network"`. Kept only on `blocked` and `recovered`. |
| `page` | Optional. A path with ids removed, up to 120 characters, no query string: `/private-hire`. Use it to tell the forms apart. |
| `held_seconds` | Integer 0 to 604800. Required on `recovered`, refused on every other step. |

- Answers: `202 { "success": true, "data": { "recorded": true } }`; `400 VALIDATION_ERROR` with the field names only; `429 RATE_LIMIT_EXCEEDED` (1,200 an hour per key); `503 RECORD_FAILED`.
- Send `sent` only when the enquiry API has answered with success. Send `started` on the visitor's first change to the form, once per visit, and `submit_pressed` on every press.

## C. Deposit hold reminder

Nothing changed. What exists:

- `/api/cron/private-booking-monitor` runs daily at 09:00 UTC (`vercel.json`). Pass 1 reminds draft bookings whose hold has not run out: `deposit_reminder_7day` when the hold ends in 4 to 7 London calendar days, `deposit_reminder_3day` at 2 to 3 days, `deposit_reminder_1day` at 1 day. Day 0 belongs to the expiry job. The text seen queued at 09:00 two days before expiry is the 3-day reminder.
- Channel: every reminder goes through `sendPrivateBookingMessage` (`src/lib/private-bookings/messenger.ts`). All three triggers are on the auto-send list (`src/lib/private-bookings/sms-approval.ts`), so the email goes first when the booking's contact email or the customer's email is usable, and the text goes only if there is no usable address or the email fails. A booking with no phone number is still reminded by email.
- Once only: `reserveCronSmsSend` writes `booking:trigger:hold expiry date` to `private_booking_send_idempotency`, so a reminder that went by email (and left no text queue row) is not sent again the next morning. Moving the hold date re-arms it.
- Safety: texts go through the SMS queue with its kill switches, hourly limits and quiet hours; emails go through `sendEmail`, which honours `SUSPEND_ALL_EMAIL` and `SUSPEND_ALL_COMMS`. 09:00 UTC is outside quiet hours all year.
- Who is not reminded, by design: a booking whose deposit staff have not confirmed (`deposit_confirmed_at` is null, owner decision of 11 September 2026: the guest has not been told a deposit or a deadline, and such a hold never expires by itself either); a paid or waived deposit; a date still to be confirmed; a £0 deposit.
- Expiry: `/api/cron/private-bookings-expire-holds` at 06:00 UTC cancels a lapsed hold and tells the guest, except a hire booked less than 14 days ahead or happening today or tomorrow, which goes to a manager instead (owner decision D26).
- Tests that already cover this: `tests/api/privateBookingMonitorEmailFirst.test.ts`, `privateBookingMonitorDepositReminderDays.test.ts`, `privateBookingMonitorIdempotency.test.ts`.

So the 140-guest enquiry was reminded if its deposit had been confirmed; if it had not, it could not have expired automatically. Which it was is a question for the booking's own record (the audit trail and `private_booking_send_idempotency` rows), which this work did not read.

## D. "Tell me when the next one is on"

What existed:

- `POST /api/event-waitlist` has answered 410 since 28 October 2026 (owner decision D11): the waiting list was removed and nobody had ever joined it.
- `event_interest_manual_recipients` is keyed by event, not category, and no code reads or writes it.
- `bookings.is_reminder_only` rows are left out of the promotion audience on purpose.
- Guest email campaigns pick every customer with an email who has not opted out, bounced or been suppressed and who either has `marketing_email_opt_in` or any booking (`promote_due_marketing_campaigns`).
- The event text invite picks its audience with `get_cross_promo_audience`, which needs past attendance, so somebody who has never been cannot be in it.
- There is no "new event announced" trigger. People hear about a new date when staff schedule a guest email campaign, and by text through the week-ahead invite in `/api/cron/event-guest-engagement`.
- `customer_consents` already allows `source = 'public_event_waitlist'` and `related_entity_type = 'event_waitlist'`, and no code has written either since the waiting list went.

What was built: no new table and no migration. A sign-up is a marketing consent row in `customer_consents`, written through `ConsentService.recordConsent`, with source `public_event_waitlist`, related entity `event_waitlist` whose id is the event category id, and metadata `{ kind: 'next_date_interest', event_category_id, event_category_slug }`.

- `src/app/api/event-interest/route.ts` (new): the endpoint.
- `src/lib/events/next-date-interest-signup.ts` (new): finds or makes the customer and writes the consent.
- `src/lib/events/next-date-interest.ts` (new): the constants and `loadCategoryInterestAudience`, the read the invite uses.
- `src/lib/sms/cross-promo.ts`: `sendCrossPromoForEvent` joins the category's sign-ups to the audience, ahead of past guests, within the per-event recipient limit.
- `docs/architecture/routes.md`, `docs/agent-reference.md`: the new route listed.

Reach:

- Email: recording the email opt-in sets `customers.marketing_email_opt_in`, which is what the guest campaigns read. No change to campaign code.
- Text: the invite adds sign-ups for the event's category who can still be texted (texts on, marketing flag on, no opt-out, a mobile on record), are not booked for the event and have not been texted about it. They then pass the same checks as anyone: the email-instead rule and the text limits. A second run sends nothing. If the sign-ups cannot be read, the invite goes to past guests as before.
- Sign-ups join only in the modes whose text limits are counted in code (`regulars`, `regulars_no_email`, `last_push`, `intro_no_email`). The older 7-day intro, whose only limit is inside the SQL function, leaves them out.

Rules worth knowing:

- Nothing is sent at sign-up.
- A repeat sign-up writes nothing and answers `already_registered: true`.
- Someone who has opted out of marketing on a channel is never opted back in from this form (owner decision D31). If no channel can be registered the answer is 409 with a message to call.
- A typed email is registered only when it is the address on the customer's record. A matched customer's email is never overwritten from a public form (BK-077), so when a mobile matches an existing customer with a different or no email, only texts are registered.
- A landline or non-UK number cannot be texted: with an email it becomes an email sign-up, without one it is refused.
- An email-only sign-up creates a customer with no phone number.

### Website contract for D

- Endpoint: `POST https://management.orangejelly.co.uk/api/event-interest`
- Auth: the website's API key in `X-API-Key` (or `Authorization: Bearer <key>`), scope `create:bookings`. No Idempotency-Key header is needed. The website runs its own Turnstile check first; never forward the token.
- Body, JSON, no other fields allowed:

| Field | Required | Notes |
|---|---|---|
| `event_category_id` | One of these two | UUID of the event category |
| `event_category_slug` | One of these two | For example `quiz-night`. If both are sent they must agree. |
| `first_name` | Yes | 1 to 100 characters |
| `phone` | One of phone or email | Any UK format; stored as E.164 |
| `email` | One of phone or email | |
| `default_country_code` | No | Digits, as on the booking routes |
| `marketing_sms_opt_in` | `true` whenever `phone` is sent | The visitor ticked the text wording |
| `marketing_email_opt_in` | `true` whenever `email` is sent | The visitor ticked the email wording |
| `consent_text_version` | No | The website's consent version string, for example `guest-comms-consent-v6` |
| `source_url` | No | The page address; click ids are stripped |

- Wording the page must show beside each tick, word for word (these are what is stored, from `src/lib/consent/constants.ts`):
  - Mobile: "Text me the latest from The Anchor: quiz nights and bingo, new menus, offers, and any changes."
  - Email: "Email me the latest from The Anchor: quiz nights and bingo, new menus, offers, and any changes."
- Success: `201` for a new sign-up, `200` for a repeat:

```json
{ "success": true, "data": { "registered": true, "already_registered": false, "channels": ["sms"], "event_category": { "id": "...", "slug": "quiz-night", "name": "Quiz Night" } } }
```

  `channels` says what was registered: `sms`, `email` or both. If the visitor gave both and only one comes back, the other was not registered (see the rules above).
- Errors, all `{ "success": false, "error": { "code", "message" } }`, with a message fit to show:

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Bad or unknown field (`details.fields` names them), or no category |
| 400 | `CONTACT_REQUIRED` | Neither phone nor email |
| 400 | `CONSENT_REQUIRED` | A contact was sent without its tick |
| 400 | `INVALID_PHONE`, `INVALID_EMAIL` | |
| 400 | `EMAIL_REQUIRED_FOR_NON_MOBILE` | Landline or non-UK number and no email |
| 404 | `NOT_FOUND` | Unknown or switched-off category |
| 409 | `CONTACT_OPTED_OUT` | Every contact given has opted out of marketing; the message asks them to call |
| 429 | `RATE_LIMIT_EXCEEDED` | More than 10 an hour for one contact; has `Retry-After` |
| 503 | `CUSTOMER_RESOLUTION_FAILED`, `DATABASE_ERROR` | Our fault; nothing may be assumed kept; a retry is safe |

- What the page may promise: "we'll let you know when the next date is announced" by email when a campaign goes out, or by text about a week before the night. It must not promise an immediate message, because none is sent.

## E. `no_table` on 28 October 2026

Nothing changed. The cause is recorded in the repository: `supabase/migrations/20261029082723_event_table_skips_private_hire.sql` names this incident (four refusals on 28 October for the quiz on 4 November, 6 of 60 seats sold at the time).

- The Dining Room was privately hired that night, 18:00 to 23:00.
- A table-seated event books its table through the older `create_table_booking_v05`, which picked the smallest free table without asking whether a private hire held it. It chose a Dining Room table.
- The assignment trigger then refused it (`table_assignment_private_blocked`), and the catch-all in `create_event_table_reservation_v05` reported that as `no_table`.
- The pick is deterministic, so every retry failed the same way. Other tables were free all evening.
- The migration makes both table pickers skip tables a private hire has blocked. The booking that worked the next day fits the fix having been applied that morning.

Every condition that gives `no_table` for an event booking (table and mixed modes only; general and communal events never reserve a table):

1. No single bookable table with room for the party is free for the event's window, and no linked join of 2 to 8 free tables reaches the party size. "Free" leaves out tables with a live table booking, communal event seats, a private hire block or a staff block.
2. The table booking core answers blocked with no reason of its own, or returns no booking id.
3. The re-pick for the whole event window (15 minutes before the start to the end) finds no candidate.
4. Any other database error inside the reservation: the catch-all (`20261026135338_event_payment_confirm_communal_seats.sql`, about line 1095) turns every fault into `no_table`. This is the branch that fired here.
5. The service's compatibility call (`src/services/event-bookings.ts`, about lines 770 to 810), reached only if the booking RPC returns no table booking id, which current SQL always does.

Seat capacity (60, 49 online) is checked separately and first, so an event can have seats left and still no table.

A refused attempt leaves nothing behind: the table booking and the event booking are rolled back, the route answers 200 with `state: 'blocked'` and releases its idempotency claim, so the four presses were four identical failures, not one attempt blocking the next.

What the guest saw: "We could not find a table for your group at this event." with a call line under it (website `lib/guest-error-messages.ts` and `ManagementEventBookingForm.tsx`). It tells them to ring. It does not suggest a smaller group, which would not have helped here.

Not verified: that the 29 October migration is applied in production. This work had no database access. To check:

```sql
SELECT version, name FROM supabase_migrations.schema_migrations WHERE version = '20261029082723';
```

Open, for the owner to decide (not changed here): the catch-all still reports any fault as `no_table`, and has hidden four separate bugs this year. Giving it its own reason (for example `table_allocation_error`) and logging the real error needs a migration that replaces a SECURITY DEFINER function, read from production first, plus a website change to map the new reason.

## Things to check before the website goes live with D

The sign-up relies on two values the repository says `customer_consents` allows. Confirm production agrees (read only):

```sql
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid = 'public.customer_consents'::regclass
  AND conname IN ('customer_consents_source_check', 'customer_consents_related_entity_type_check');
```

`public_event_waitlist` must be in the first and `event_waitlist` in the second. If either is missing, a sign-up fails closed with a 503 and nothing is stored.
