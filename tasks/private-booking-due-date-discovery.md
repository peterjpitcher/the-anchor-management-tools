# Private-Booking Payment/Balance Due Date — Discovery Report (2026-07-08)

Trigger: Paula Campbell's message — contract says balance due by the **5th**, an earlier email said the **12th**. Discovery only; no fixes applied.

## Root cause of Paula's 5th-vs-12th — CONFIRMED against live prod data

Both dates came from the **same stored column, `private_bookings.balance_due_date`, read as-is — its value was rewritten between the two sends** by migration `20260705100000_pb_sop_due_dates_and_vat.sql` (the 7→14-day SOP change).

- **"The 12th"** — the "Booking Confirmed" (deposit received) email, sent **2026-07-04 16:17 UTC** (live `email_messages` row, body verbatim "Balance due date 12 July 2026"). It rendered the stored column at `src/lib/email/private-booking-emails.ts:195-197,212-213`, which was then **2026-07-12 = event_date (19 July) − 7 days**, set by the old trigger (`20251123120000_squashed.sql:40`).
- **"The 5th"** — contract v13, generated and emailed **2026-07-05 14:19 UTC**. Paula's row matched the backfill's equality guard (`balance_due_date = event−7`), so the migration rewrote it to `GREATEST(2026-07-05, 2026-07-05) = 2026-07-05` (`20260705100000:36-42`). The contract took the stored-column branch at `contract-template.ts:156-157` and printed "Sunday 5 July 2026" alongside the hardcoded "being 14 calendar days before the event" (:505). The 09:00 UTC reminder SMS that same day ("£120 balance due by 5 July 2026") proves the column had already flipped before the contract was generated.

Compounding factors, all confirmed live:
- Due date moved to "**due today**" mid-booking with **no corrective communication** (nothing re-emails on due-date change).
- **No audit row** (zero `field_name='balance_due_date'` rows table-wide despite `mutations.ts:1176` auditing staff edits — the migration bypassed the app).
- `hold_expiry` is coincidentally also 2026-07-12, so the booking-created SMS ("£100 deposit secures it by 12 July" — a *deposit* deadline) reinforced "the 12th" as a payment date.
- Amounts also inconsistent: the 4 July email said "Event balance due £100.00"; the 5 July SMS said "£120 balance" (`total_amount` column is 0.00; gross figures live on the `private_bookings_with_details` view).

### Paula's booking facts (prod, read-only)

`private_bookings.id = 11fd3680-95a4-4292-be2c-c90da3b1564e` — Paula Campbell, "Double Gender Reveal", event 2026-07-19 15:00–19:00, 30 guests, confirmed. `balance_due_date = 2026-07-05` (current), `hold_expiry = 2026-07-12`, deposit £100 paid 2026-07-04, balance unpaid (`final_payment_date` NULL), contract v13 emailed 2026-07-05 14:19 to paulac1988@hotmail.co.uk (contract regenerated up to v22 since, not re-sent).

## Blast radius — other affected bookings (prod query, 2026-07-08)

Future draft/confirmed bookings, balance unpaid, with anomalous due dates:

| Customer | Event | Status | balance_due_date | Anomaly |
|---|---|---|---|---|
| Jenny Lee | 2026-07-14 | confirmed | 2026-07-05 | Backfill-clamped to migration day; now past due; no contract sent |
| Miles Crook | 2026-07-17 | draft | 2026-07-07 | Past due (created inside 14-day window → clamped to creation day) |
| Tia Jones | 2026-07-18 | confirmed | 2026-07-05 | Backfill-clamped to migration day; now past due |
| Paula Campbell | 2026-07-19 | confirmed | 2026-07-05 | Backfilled; coincides with event−14; contract/email contradiction above |
| Kelsey De oliveira | 2026-08-02 | confirmed | 2026-06-23 | Stale — likely event rescheduled, due date never recomputed (event−14 would be 19 July) |

All five are past due today and **nothing chases past-due balances** — the balance-reminder cron only selects `balance_due_date >= today` (`private-booking-monitor/route.ts:747-755`), so none will get another reminder.

## 1. Every touchpoint and its exact date computation

### Customer-facing

| # | Touchpoint | Date shown | Exact source/formula | File:line |
|---|---|---|---|---|
| 1 | **Contract p.2 agreement clause** (HTML + PDF; staff route, contract page, and emailed PDF all use one template) | Balance due | Four-branch, computed **at generation time**: (a) date-TBD booking → literal "To be confirmed (date TBD)" — **takes priority over a stored date**; (b) stored `balance_due_date` non-null → formatted as-is via `formatDateFull`; (c) null + `event_date` set → **fallback `event_date − 14 days`** via raw `getTime() − 14*24*60*60*1000`; (d) else "To be confirmed" | `src/lib/contract-template.ts:152-162`, rendered :505/:509 |
| 2 | **Contract p.2 hardcoded assertion** | "being 14 calendar days before the event" | Static text appended to *whichever* branch produced the date — asserts 14 days even when the stored date isn't event−14 | `src/lib/contract-template.ts:505,509` |
| 3 | **Contract p.3 T&Cs** | "no later than 14 calendar days before the event" | Hardcoded policy text, no computed date | `src/lib/contract-template.ts:571` |
| 4 | **Contract p.1 deposit box** | Deposit status date only | `deposit_paid_date ? "paid <date>" : "due"` — **no deposit due DATE anywhere in the contract** | `src/lib/contract-template.ts:182,192` |
| 5 | **Contract cover email** | None | Body has event date + deposit amount only; the due date lives solely in the attached PDF (generated at send time) | `src/lib/email/private-booking-emails.ts:692-708`; send path `src/app/actions/privateBookingActions.ts:2764-2839` |
| 6 | **"Booking Confirmed" email** (deposit received) — "Balance due date" + "Final guest numbers due" rows | Stored `balance_due_date` read as-is, **frozen at send time**; both rows render the same value; rows omitted entirely when null | `src/lib/email/private-booking-emails.ts:195-197,212-213`; row fetched `src/services/private-bookings/payments.ts:345-349` |
| 7 | **Provisional Booking Hold email** | None rendered | References "the hold expiry date we've given you" but never renders `hold_expiry`; deposit/balance shown as amounts only. Also mis-fires for £0/waived-deposit auto-confirms | `src/lib/email/private-booking-emails.ts:115-121`; triggers `mutations.ts:1414`, `payments.ts:277` |
| 8 | **Deposit payment-link email** | None | Select doesn't even include `balance_due_date`; "payable nearer the time" | `privateBookingActions.ts:2430-2434`; `private-booking-emails.ts:419` |
| 9 | **Customer booking portal** — "Due by" line | Stored `balance_due_date` as-is from `private_bookings_with_details` view; **null → line silently omitted** | `src/app/booking-portal/[token]/page.tsx:143,325-327` |
| 10 | **SMS: booking-created** (deposit deadline) | `hold_expiry` frozen at creation; **null fallback → renders TODAY** (`new Date()`); day+month, **no year** | `src/services/private-bookings/mutations.ts:85-91`; template `messages.ts:22-31` |
| 11 | **SMS: deposit/hold reminders** (drafts) | Keyed to `hold_expiry` (`ceil((hold_expiry − now)/day)`, windows 4-7 / 2-3 / 1); message shows event date + relative "expires in N days" only. **Not feature-flag gated** | `src/app/api/cron/private-booking-monitor/route.ts:505-507,518,590,660` |
| 12 | **SMS: hold-extended** | New expiry = current-or-now + staff-chosen 7/14/30 days, then **silently capped at `balanceDueMoment(event_date)` (event−14)** or event start | `mutations.ts:2097-2113,2135`; cap helper `types.ts:80-84` |
| 13 | **SMS: balance reminders** (due−7..3, due−2, due−1, due−0) | Stored `balance_due_date` read live at cron run via view; dated messages only at due−7..3 and due−2; due−1/due−0 say "tomorrow"/"today" with no date. Never chases past-due (`.gte` today). **Gated by `PRIVATE_BOOKING_UPCOMING_EVENT_SMS_ENABLED`** | `route.ts:747-755,781,794,802-832`; templates `messages.ts:85-125`; flag `route.ts:45-48,733` |

### Staff-facing

| # | Touchpoint | Date shown | Formula | File:line |
|---|---|---|---|---|
| 14 | **Detail page warning banner + Payment summary "Due by"** | Stored column as-is (base table, `select('*')`), null → hidden | `PrivateBookingDetailClient.tsx:2532-2536,3091-3095`; `queries.ts:311-316` |
| 15 | **Messages page "Balance Reminder" template** | Stored column via view; **null → empty string, broken sentence** ("…settle by to keep…"); amount = full gross total ignoring part-payments | `PrivateBookingMessagesClient.tsx:55-59,188-189,195` |
| 16 | **Dashboard "Balances Due Soon" chip + calendar pins** | Stored column, `status='confirmed'` **only**, window today..today+14 (display window, coincidentally 14); tooltip prints raw ISO `event_date` | `dashboard-data.ts:1039-1046`; `dashboard/page.tsx:247-253`; `adapters.ts:166-209`; `VenueCalendar.tsx:252-273` |
| 17 | **Communications tab scheduled-SMS preview** | Recomputed live from stored column, same windows as cron; but deposit-preview windows wider than cron (4-10/2-3/0-1 vs 4-7/2-3/1) and amount formula differs (gross−payments vs view `balance_remaining`) | `scheduled-sms.ts:230-290,134,161,187,222-228` |
| 18 | **Weekly digest email** (Monday cron) | Stored column via view, raw string compares; "Balance due: £X by **raw ISO string**" only when due within run-date..+6; overdue = amount only; drops out entirely once `event_date < today`. Also renders hold expiry **in UTC** (`getUTC*`) | `weekly-digest-classifier.ts:101,123-131,154,169-176`; `weekly-summary/route.ts:90-94,175`; render `manager-notifications.ts:238-243` |
| 19 | **"New private booking enquiry" manager email** | `hold_expiry` London-formatted, "Unknown" when null — **the only email anywhere stating the deposit deadline; the customer never gets it in writing** | `manager-notifications.ts:90-104,169,197` |
| 20 | **New booking form** | `balance_due_date` input blank ("leave blank to auto-calculate"); **"Deposit Due Date" field is actually `hold_expiry`**, pre-filled today+14 | `new/page.tsx:396-403,119-121,385-393`; mapping `privateBookingActions.ts:237-238` |
| 21 | **Edit booking form** | Free date input, defaultValue = stored value, disabled when TBD; no validation vs event−14; clearing it submits `''` → **fails the whole UPDATE** (no ''→null normalisation) | `edit/page.tsx:356-362`; `privateBookingActions.ts:430`; `mutations.ts:987-988,1010-1012` |

### Write path (what the stored column IS)

| Writer | Formula | File:line |
|---|---|---|
| App default at create | staff value wins; else `event_date − 14` (`BALANCE_DUE_DAYS_BEFORE_EVENT=14`); **TODAY if created inside the 14-day window**; skipped for TBD | `mutations.ts:619-631`; `types.ts:77-84` |
| DB trigger (current, since 2026-07-05) | fills `event_date − INTERVAL '14 days'` **only when NULL**; NULLs when `date_tbd`; fires on INSERT + UPDATE OF event_date; no today-clamp | `supabase/migrations/20260705100000_pb_sop_due_dates_and_vat.sql:12-28` |
| DB trigger (legacy, until 2026-07-05) | `event_date − INTERVAL '7 days'` | `20251123120000_squashed.sql:35-44` (:40); kept at 7 in `20260629000000_add_date_tbd_column.sql:21` |
| **One-off backfill 2026-07-05** | `GREATEST(event−14, CURRENT_DATE)` where stored value exactly equalled event−7, draft/confirmed, future, non-TBD | `20260705100000:36-42` |
| TBD toggles | only paths that null/reset the column | `mutations.ts:1053-1071` |
| Dormant view `private_booking_sms_reminders` | third offset (`balance_due_date − 3 days`, event−14, event−1); **no consumer** | `squashed.sql:3052-3077` (:3068) |

## 3. Other latent mismatches (pairs that can still disagree)

1. **Frozen vs live, generally**: confirmation email (frozen at send, #6) vs contract/portal/SMS/digest (live column) — any later change to the column (staff edit `edit/page.tsx:361`, TBD round-trip, future migration) splits them. No re-notification path exists.
2. **Contract null-fallback vs everything else**: null column → contract invents event−14 at generation time (`contract-template.ts:158-161`, never written back); portal/detail page show *no* date; messages-template SMS shows a *broken sentence*; crons/digest are *silent*. Same booking, four different stories.
3. **Contract vs itself**: stored date ≠ event−14 → p.2 date contradicts p.2's "being 14 calendar days" assertion (:505/:509) and p.3's hardcoded T&Cs (:571).
4. **TBD precedence**: a stale TBD marker (column or legacy `DATE_TBD_NOTE` in `internal_notes`, `tbd-detection.ts`) makes the contract print "To be confirmed" while surfaces reading the column directly still show a set date (`contract-template.ts:154-156`).
5. **Event-date reschedule**: trigger only fills NULLs and app never recomputes, so moving `event_date` leaves a stale due date on every surface (see Kelsey De oliveira above); confirmed bookings also keep stale `hold_expiry` (`mutations.ts:910-917` drafts only). Conversely any staff edit to a null-date booking silently stamps event−14 (trigger fires because `event_date` is always in the payload, `mutations.ts:992`).
6. **Un-backfilled 7-day rows**: the backfill's equality/status/future guards mean old event−7 dates still exist for other-status, past, or staff-touched bookings — anything regenerated for them now contradicts the "14 days" contract text.
7. **Deposit deadline vs balance deadline**: `hold_expiry` (booking-created SMS #10, hold reminders #11, manager email #19) vs `balance_due_date` — two deadlines, customer only ever gets one in writing (staff email is London-formatted; the digest chip shows it in **UTC**, up to 1h off).
8. **Hold-extension cap**: staff choose +30 days, SMS quotes a date silently capped at event−14 (`mutations.ts:2104-2113`) — quoted extension ≠ granted extension.
9. **Reminders never re-arm**: dedup keys on `booking_id + trigger_type` only (`route.ts:835-854`), so after a due-date correction the customer never gets an SMS with the new date; past-due is never chased and the digest loses overdue rows once `event_date < today` (`weekly-summary route.ts:175`).
10. **Amount disagreements riding alongside the date**: messages-template SMS quotes full gross (#15); preview uses gross−payments vs cron `balance_remaining` (#17); Paula's own comms said £100 then £120.
11. **Three parallel 14-day formulas**: TS constant (`types.ts:77`), PL/pgSQL trigger (`20260705100000:24`, no today-clamp — can stamp a past date), and the contract's raw-epoch fallback — plus the dormant due−3 view (`squashed.sql:3068`) — must all be changed together or they diverge again.
12. **Feature-flag asymmetry**: balance SMS gated by `PRIVATE_BOOKING_UPCOMING_EVENT_SMS_ENABLED` while deposit reminders always send — customers may hear about the deposit deadline but never the balance one, leaving the contract's date uncorroborated. (Paula did receive a 14-day balance SMS on 5 July, so the flag appears ON in prod — verify in Vercel.)
13. **Format inconsistencies**: customer "12 July 2026" vs digest raw ISO "2026-07-12" vs no-year booking-created SMS vs raw ISO event date in calendar tooltip/PayPal description.

## 4. What a fix would need to touch (discovery-level, no code yet)

1. **Single source of truth**: one server-side resolver (e.g. in `src/services/private-bookings/`) that every renderer calls — kill the contract's private fallback (`contract-template.ts:158-161`), the TS-constant/trigger duplication, and decide the null semantics once (compute-and-persist vs display-nothing).
2. **Contract template**: make the "being 14 calendar days" text conditional (or drop it) so it can't assert a false relationship (:505/:509/:571); fix TBD-over-stored precedence (:154-156); decide whether the contract may ever print a date that isn't in the DB.
3. **Write-path integrity**: recompute (or force staff confirmation of) `balance_due_date` on event-date change; fix the `''`-clear dead end on the edit form (`mutations.ts:987-1012`); audit every change to the column including migrations; rename/split the "Deposit Due Date"→`hold_expiry` form field (`new/page.tsx:385-393`).
4. **Change notification**: when the due date moves after any customer comm referenced it, trigger a corrective email/SMS (needs a "last communicated date" record — the `email_messages`/`private_booking_sms_queue` rows already exist to diff against).
5. **Reminder plumbing**: re-arm dedup on due-date change (key on date, `route.ts:835-868`); decide overdue-chasing policy; confirm `PRIVATE_BOOKING_UPCOMING_EVENT_SMS_ENABLED` in Vercel; fix the messages-template empty-string sentence and gross-amount bug (`PrivateBookingMessagesClient.tsx:188-195`).
6. **Migration hygiene**: any future policy-date migration must either exclude bookings with already-sent comms or queue corrective notifications; drop or fix the dormant `private_booking_sms_reminders` view; never move a stored date *earlier* than dates already communicated (Paula's went from 12th to "due today").
7. **Immediate data remediation**: the five bookings in the blast-radius table above all have past-due dates and will never be chased by the cron — each needs a staff decision (new due date + corrective comm).
8. **Cosmetics** (low priority): consistent date formatting (digest raw ISO, UTC hold expiry, no-year SMS, raw ISO tooltips).
