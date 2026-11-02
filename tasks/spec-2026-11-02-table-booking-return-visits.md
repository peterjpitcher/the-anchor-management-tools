# Table booking return visits: discovery and spec

Date: 2026-11-02 (v2, same day: owner decisions 1 to 6 recorded, best-practice research and voucher discovery added)
Status: DISCOVERY AND SPEC ONLY. No code, no migration, nothing sent. Every decision is made (section 11). The build waits only for the email voucher card design (brief in `docs/design/brief-return-visit-voucher-email.md`).
Scope: every table-booking diner, not only Sundays (owner decision 1). Event nights already have their own promo machinery and are out of scope.
Sources: live production database (project `tfcasgxopxegwrabvwat`, read-only queries on 2 November 2026), this repo at `cdbe8b676`, the website repo `OJ-The-Anchor.pub` (`docs/SSOT.md` sections 1 and 4, `app/book-table/page.tsx`), and the published guidance listed in section 5.

---

## 1. Summary and recommendation

We have the data, the consent basis, the sending pipeline and a voucher ledger. What is missing is any logic that looks at table bookings and acts on them, and any way to put a voucher in an email. Today the only guest marketing is a monthly round-up email, and the only "win-back" tool is a staff-triggered text that uses a wrong "last booked" date and a consent flag almost nobody has.

The data says the problem is not "regulars who have lapsed". It is "almost nobody comes back at all, or we cannot see them when they do":

- 713 customers have a past table visit. 30 have two or more. 13 have three or more.
- When people do come back they come back fast: half within 3 weeks, three quarters within 45 days, all but one within 90 days (section 2.6). Someone who has not rebooked by day 45 is already past the point where most natural returns happen; by day 90 they are, on today's evidence, gone.
- A third of Sunday bookings are walk-ins recorded against placeholder customers with no contact details, so a walk-in regular is invisible.

**Recommendation.** An automatic two-step "come back" sequence by email, run inside the existing guest marketing pipeline, to every identifiable diner (including no-shows) who has not booked again:

| Touch | When | Offer | Stops if |
|---|---|---|---|
| 1 | 45 days after the last booking, no booking since | 10% voucher, valid 30 days, digital | they book, visit or redeem |
| 2 | 45 days after touch 1 (so day 90), still nothing | 25% voucher, valid 30 days, digital | they book, visit or redeem |
| after that | nothing further; they stay in the monthly round-ups | | |

Vouchers are real rows in the existing voucher ledger, numbered, expiring and redeemed exactly as the printed ones are, with two new percentage types added as data. The email carries the voucher; there is no printed card. Redemption at the bar is the hard measure of success, alongside booking attribution and a one-in-five holdout that receives nothing so the lift can be read honestly.

Sunday is still the lead message (it has the headroom: typically 25 to 40 covers booked against 57 seats), but the audience and the vouchers cover every day. Email only: phone-only guests are left out (decision 3). Then, once the sequence is running, widen the base of people we can reach (walk-in capture, a thank-you to repeat visitors) and retire or fix the broken win-back text.

Honest expectation at today's volumes: roughly 40 to 60 people enter the sequence each month, published win-back benchmarks for lapsed lists sit around 5% to 12%, so a handful of recovered tables a month, each costing only the discount actually redeemed. The value is in making it run unattended and compound as the reachable base grows.

---

## 2. What the data says (production, 2 November 2026)

All figures are from read-only queries. "Visit" means a table booking dated before today with status `completed`, `confirmed`, `visited_waiting_for_review` or `review_clicked`. Cancelled and no-show bookings are excluded. Nothing marks a no-show automatically, so a past `confirmed` booking is treated as a visit.

### 2.1 Volume and repeat rate

| Measure | Value |
|---|---|
| Table bookings, last 12 months (not cancelled) | 781 |
| Of which Sunday | 253 bookings, 827 covers, 247 distinct customers |
| Typical Sunday, last 16 weeks | 4 to 15 bookings, 8 to 43 covers; capacity 12 tables, 57 seats |
| Sunday arrival times | peak 13:00 (51) and 13:30 (26); long tail to 17:30 |
| Customers with any past visit | 713 (300 are walk-in placeholders) |
| Customers with 2+ visits | 30 (4% of 713, 7% of the 418 identifiable) |
| Customers with 3+ visits | 13 |
| Customers who have booked a Sunday | 241 |
| Customers who have booked 2+ Sundays | 5 |
| Duplicate customer rows by phone or email | 0 (the low repeat rate is real, not a matching fault) |

Booking source, last 12 months: brand_site 431, walk-in 333, admin 126, website 25, phone 12, sms_reply 11.

Sunday bookings by source, last 12 months: brand_site 117 (91 with an email), walk-in 83 (81 placeholder customers, 0 emails), admin 28 (4 emails), website 9, phone 1.

### 2.2 Recency of identifiable visitors (713 customers, by last visit)

| Last visit | Customers | 2+ visits | Has email | SMS opt-in | Marketing SMS opt-in |
|---|---|---|---|---|---|
| 0 to 6 weeks | 97 | 4 | 32 | 40 | 1 |
| 6 to 13 weeks | 169 | 4 | 68 | 89 | 5 |
| 13 to 26 weeks | 232 | 16 | 95 | 151 | 15 |
| 26 to 52 weeks | 176 | 4 | 46 | 81 | 19 |
| Over 52 weeks | 39 | 2 | 5 | 17 | 18 |

### 2.3 Who we can actually reach among Sunday visitors (last 12 months, placeholders excluded)

| Measure | Value |
|---|---|
| Identifiable Sunday visitors | 151 |
| With an email address | 100 |
| Of those, unsubscribed from guest emails | 27 (plus 2 opted out on their profile, 1 by direct message) |
| Of those, legacy consent only (migrated, never asked) | 53 |
| Of those, explicit marketing email opt-in | 4 (table booking), 2 (email capture link), 1 (event), 1 (profile) |
| Already in the monthly round-up recipient pool | 100 of 100 |
| SMS opt-in but no email (phone only) | 50 |
| `marketing_email_opt_in = true` on the customer row | 3 |

The `marketing_email_opt_in` column is nearly empty (18 of 1,305 customers). It is not the gate the guest pipeline uses (section 3.1), so it is not the blocker it looks like.

### 2.4 How the existing guest emails perform

Monthly "Welcome to <month>, guests" round-ups and event invitations, audience type `customer`, about 250 to 268 recipients each:

| Campaign | Sent | Opened | Clicked |
|---|---|---|---|
| Welcome to September 2026 | 252 | 117 | 4 |
| Welcome to October 2026 | 260 | 116 | 5 |
| Welcome to November 2026 | 267 | 110 | 3 |
| Tinsel & Tipples introduction (5 Oct) | 259 | 123 | 7 |
| Tinsel & Tipples November invitation (2 Nov) | 268 | 48 (same day) | 2 |

Roughly 45% open, 1% to 3% click. `marketing_conversions` has 0 rows: nothing ties a table booking back to an email. The website does send attribution (`booking_source`, `utm_*`) and the API stores it in `analytics_events.metadata` on `table_booking_created` (26 of 187 bookings in 90 days carried a `utm_source`; none from email yet).

### 2.5 Other signals

- Review follow-up (template `table_review_followup`): 357 sent in 12 months, 88 clicked (25%). It only goes to first-time visitors who were marked seated, so repeat visitors never hear from us after a visit.
- Email capture text (`email_capture_ask`): 115 sent since 21 August, 5 of those customers now have an email (4%).
- Pre-order data: 23 of 256 Sunday bookings in 12 months have menu items. Too thin to personalise on favourite dish.
- `celebration_type` is populated on 5 bookings ever. No birthday or occasion data worth using.
- Customers with a no-show on record: 32 (none with more than one).


### 2.6 How fast people come back (added in v2)

Gaps between consecutive visits for the customers who have visited more than once (69 gaps, same visit definition as above):

| Measure | Value |
|---|---|
| Median gap between visits | 21 days |
| Lower and upper quartile | 11 and 45 days |
| Gaps of 30 days or less | 47 of 69 |
| 31 to 60 days | 8 |
| 61 to 90 days | 10 |
| 91 to 180 days | 4 |
| Over 180 days | 0 |

Three quarters of natural returns have happened by day 45 and all but one by day 90. That sets the timing in section 7: a first touch at day 45 reaches people who are past their natural return window without paying a discount to people who were coming back anyway, and a second touch at day 90 is the last point at which there is anyone left to recover.

### 2.7 Voucher ledger today (live, 2 November 2026)

| Measure | Value |
|---|---|
| Voucher types | 9, all fixed value or a named item; one percentage type (`roast-20-six`, 20% off Sunday roasts, 23 September 2026) whose 20% exists only in the printed wording |
| Vouchers ever generated | 61 in 7 printed batches (`AN-YYMM-NNNN`, monthly counter) |
| Status | 41 generated (unissued), 8 redeemed, 7 expired, 4 issued, 1 cancelled |
| Validity chosen at hand-out | 30 days on 15 of 20, otherwise 60 or 90 (staff pick from 30, 60, 90; 30 is the default) |
| Redeemed within validity | 8 of 15 that reached expiry or redemption |
| Reminders sent | 13 (7 and 3 days before expiry; 9 by SMS, 4 by email) |
| Vouchers linked to a customer | 17 of 20 issued |

---

## 3. What exists today (reuse map)

### 3.1 Guest marketing email pipeline (reuse this)

- Tables: `marketing_campaigns` (`audience_type` `business` or `customer`, `audience` jsonb, `status`, `scheduled_for`, `utm_campaign`, `ignores_frequency_cap`, `event_id`), `marketing_campaign_recipients` (one of `contact_id` or `customer_id`, `status`, `skip_reason`, `email_message_id`), `marketing_settings` (send window 09:00 to 21:00, `frequency_cap_days` 4 in production, `batch_size` 25, `customer_send_days` all seven), `marketing_do_not_contact`, `email_suppressions`, `email_unsubscribe_tokens`.
- Audience resolution: `promote_due_marketing_campaigns` (`supabase/migrations/20260815140100_marketing_customer_rpcs.sql`, lines 42 to 60). A customer qualifies when they have an email, `marketing_email_opted_out_at IS NULL`, `email_status <> 'bounced'`, and either `marketing_email_opt_in IS TRUE` or any row in `bookings` or `table_bookings` (soft opt-in). There is no customer-side segmentation: `audience.include_tags` and `exclude_tags` apply to business contacts only.
- Send: cron `/api/cron/marketing-campaigns` every 5 minutes (`vercel.json`), route `src/app/api/cron/marketing-campaigns/route.ts`: recover stale claims, promote due campaigns, `claim_marketing_recipients` (checks kill switch, send window, eligibility, unsubscribe, do-not-contact, frequency cap under a row lock), then `finalise_marketing_send` or `release_marketing_claim`. Resend idempotency key `marketing:<campaign_id>:<customer_id>`. Skip reasons include `already_booked` (customer already holds a booking for `event_id`).
- Content: block JSON validated by `src/lib/email/marketing/registry.ts`, rendered by `render.ts`, blocks in `blocks/` (including `offer_panel`). Service `src/services/marketing-campaigns.ts` (`createCampaign` line 343, `scheduleCampaign` line 645). `findVenueClosureClaims` guards hours copy at schedule time. Campaign UI at `/marketing/campaigns`.
- Tracking: Resend webhook writes `email_messages` (`marketing_campaign_id`, `marketing_recipient_id`, `opened_at`, `clicked_at`) and `email_link_clicks`; links are short links (`link_type 'marketing_email'`) carrying `utm_source=marketing_email`, `utm_medium=email`, `utm_content=<recipient id>`.
- Consent basis: website table bookings record `legal_basis 'soft_opt_in'` under notice `table_compact_v6` (`src/lib/consent/constants.ts` lines 118 to 126; `customer_consents` rows with source `public_table_booking`). PECR soft opt-in covers marketing of similar services to someone who made a booking and was told how to opt out. A "come back for a roast" email to a table-booking guest is squarely inside that, provided every message carries the unsubscribe link. The guest round-ups already rely on this basis.

### 3.2 Attribution (reuse this)

- Website `app/book-table/page.tsx` accepts `date`, `time`, `party_size` (1 to 20), `purpose=drinks`, `fixture_id`; the form also reads `source` and `bookingType`/`booking_type`. UTMs are packed into `page_source` (`lib/table-booking/page-source.ts`).
- This app's `POST /api/table-bookings` accepts the six bounded labels `booking_source`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `short_code` and stores them in `analytics_events.metadata` on `table_booking_created` (`src/app/api/table-bookings/route.ts` lines 71 to 90 and 1055 to 1070). Nothing writes `marketing_conversions` for table bookings.

### 3.3 Things that look reusable but are not

- **Win-back SMS** (`sendWinBackCampaign`, `src/app/actions/customers.ts` line 697; form `WinBackCampaign.tsx` on `/customers/insights`). Staff-triggered, 3, 6 or 12 months. It reads `customer_scores.last_booking_date`, which is the `created_at` of the newest booking of any kind and counts cancelled and no-show table bookings (`src/lib/analytics/engagement-scoring.ts` lines 231 to 237, 284 to 293). It requires `marketing_sms_opt_in = true`, which 58 of the 713 visitors have. It also texts diners, which the owner ruled out on 15 September 2026. Treat as broken; see Phase 3.
- **Customer labels.** "Regular" (5+ event attendances in 90 days), "At Risk" (3+ attendances, none in 60 days), "Event Booker", "Event Attendee" and "Frequent booker" all read event bookings, never table bookings (`apply_customer_labels_retroactively`, `supabase/migrations/20260216212500_fix_booking_logic.sql`; `engagement-scoring.ts`). `customer_category_stats` is event-only too. "Birthday Club" exists as a manual label with 0 members and there is no birthday column.
- **`customers.table_booking_count` and `last_table_booking_date`** were dropped on 27 October 2026 because they were wrong (`20261027232433_drop_customer_booking_counters.sql`). `get_email_capture_audience` (`20261027232415_customer_booking_counters_live.sql`) now computes last activity live from non-cancelled table bookings; its visit definition is the right starting point for the new audience function.
- **Vouchers** are printed folded cards handed out and redeemed at the bar. There is no digital issue-and-send path, no percentage type and no promo code anywhere. Section 6 covers what reusing the feature for a digital offer takes.
- **Event promo texts** (`src/lib/sms/cross-promo.ts`, regulars mode) read event `bookings` only and `sms_promo_context.event_id` is NOT NULL. Not a fit for diners and ruled out by the SMS rule anyway.
- **Sunday lunch flag.** `booking_type = 'sunday_lunch'` was retired on 1 July 2026 (`20260701000003_retire_sunday_preorders.sql`); the public API always sends `sunday_lunch: false`. Sunday is the day of week of `booking_date` (`isSundayDate()` in `src/lib/table-bookings/kitchen-pacing.ts` line 129), plus the 9 legacy `sunday_lunch` rows.

---

## 4. Gaps

1. No audience logic over table bookings anywhere: no "last visit", no "has not rebooked", no Sunday view. The one function that computes it (`get_email_capture_audience`) is built for a different purpose.
2. Guest email campaigns cannot target a subset of guests, and cannot recur: a campaign is one send to everyone eligible on a date.
3. No conversion measurement: attribution reaches `analytics_events` but nothing joins it back to a campaign or recipient, and `marketing_conversions` is unused for guests.
4. A third of Sunday bookings are placeholder walk-ins with no contact details, so the reachable base is about half of the people who actually come.
5. Repeat visitors get no post-visit contact at all (review ask is first visit only).
6. The existing win-back text is wrong on date, consent and channel.

---

## 5. What best practice says, and what our own data says (decision 2)

The published guidance is almost all vendor material and the numbers conflict, so the figures below are starting points to test, not facts. Where our own data disagrees with the guidance, our data wins.

| Topic | Published guidance | Our data | Used in this spec |
|---|---|---|---|
| First trigger | 30 to 60 days since last visit, or about 30 days past the guest's normal interval | normal interval 21 days (median), 75% back by day 45 | day 45 |
| Second touch and stop | a stronger offer at about 90 days, then stop; drop from the flow after no response | 97% of natural returns done by day 90 | day 90, then nothing |
| Number of touches | 2 to 3 | tiny base, each touch carries a discount | 2 |
| Offer ladder | no discount first, modest (10 to 15%) second, strongest last | owner decision: 10% then 25% | 10% then 25% |
| Stop condition | pause the moment they book or buy | we can see bookings and redemptions | re-check at selection and again at send time |
| Send day and time | restaurants: Thursday or Friday, late afternoon | guest round-ups open about 45% whatever the day | Thursday, with Wednesday as the fallback, promoted at 16:00 London inside the 09:00 to 21:00 window |
| Tone | easy to ignore without feeling judged | SSOT section 1 voice | no "we miss you" guilt; a plain invitation with the voucher |
| Expected result | 5% to 12% of a 60 to 90 day lapsed list; programme-level 12% to 20% | not yet measured | holdout group so we measure lift, not noise |
| Promotion rules (UK) | CAP Code 8.17: every significant condition, including the closing date and restrictions, must be in the material itself | | expiry date, what the voucher applies to, exclusions and "one per table" printed in the email, not behind a link |

Sources: [Purple, win-back campaigns for venues](https://engage.purple.ai/en-us/marketing-guides/win-back-campaigns-venues-bring-lapsed-guests-back); [Chowly, restaurant win-back emails](https://chowly.com/resources/blogs/restaurant-win-back-emails-recover-lapsed-customers/); [Welcome Back, lapsed restaurant customers](https://www.welcomeback.io/en/blog/how-to-win-back-lapsed-restaurant-customers); [Regulr, email retention for restaurants](https://regulr.ai/for/restaurants/email-retention); [Foodshot, restaurant email templates](https://foodshot.ai/blog/email-marketing-for-restaurants); [Flowium, win-back campaigns](https://flowium.com/blog/how-to-run-successful-win-back-campaigns); [GrowthSuite, re-engaging with discount offers](https://www.growthsuite.net/questions/how-do-i-re-engage-inactive-subscribers-with-discount-offers); [EightX, win-back rate benchmarks](https://eightx.co/blog/average-win-back-reactivation-rate-benchmarks); [Retainful, win-back automation](https://help.retainful.com/automations/use-cases/win-back); [ASA, CAP Code rule 8.17](https://www.asa.org.uk/type/capcode/code_rule/8.3.html); [ASA, significant conditions](https://www.asa.org.uk/news/not-all-conditions-are-created-equal-a-significant-insight-into-significant-conditions.html).

---

## 6. Voucher feature: discovery (decision 5)

Read-only review of the voucher feature (`supabase/migrations/20260802000001_voucher_foundation.sql`, `20260802000002_voucher_rpcs.sql`, `src/app/actions/vouchers.ts`, `src/lib/vouchers/`, `src/lib/voucher-card-template.ts`, `src/app/(authenticated)/vouchers/`, `src/app/api/foh/vouchers/`, spec `tasks/voucher-system-spec-2026-07-30.md`).

### 6.1 How a voucher lives today

1. **Generate.** `voucher_generate_batch` (SECURITY DEFINER, service_role only) creates up to 100 vouchers per batch in status `generated`, numbered `AN-YYMM-NNNN` from a monthly counter (hard cap 9,999 numbers a month across all types), snapshots the type definitions and the current terms version (`v2.0`) onto the batch, and records a `generated` event with source fixed to `management`. The batch is then rendered to a PDF of folded A5 cards (black ink, expiry and "won at" left as handwriting lines) into the private `vouchers` bucket; `pdf_status` becomes `ready`.
2. **Issue.** `voucher_issue` moves one voucher to `issued`. It requires the batch to be `ready`, an active employee (`issued_by` is a foreign key to `employees`), a `won_at_label`, an expiry date (staff pick 30, 60 or 90 days; 30 is the default; the server only refuses a date in the past) and optionally a customer. Attaching a customer schedules two reminders (7 and 3 days before expiry) by email if the customer has one, otherwise SMS.
3. **Redeem.** Staff type or scan the number on `/vouchers/foh`; `voucher_redeem` checks status `issued`, expiry against the London date, single use under a row lock and an idempotency key, writes `redeemed_*`, an optional transaction or booking reference, and a `redeemed` event. It does not check that the person redeeming is the customer on the voucher, and it does not record the amount of discount given.
4. **Expire.** `voucher_expire_due` runs at 02:00 London from `/api/cron/vouchers-lifecycle`.

Everything is guarded by `vouchers.manage` (generate, hand-out, ledger) or `vouchers.view` and `vouchers.edit` (floor screen). Types and terms are data rows changed only by migration; nothing in `src/` names a type id, so adding a type is a migration and a copy review, not code.

### 6.2 What is missing for a digital, emailed, percentage voucher

| Need | Today | Gap |
|---|---|---|
| A 10% type and a 25% type | 9 types; `roast-20-six` is the only percentage one and its 20% lives in the wording | two new `voucher_types` rows, following `roast-20-six` |
| Percentage recorded as data | no discount-kind or percent column; `value_pence` is mandatory and is a fixed liability estimate | `value_pence` on a percentage voucher is a guess, and cash-up (`cashup-day-money.ts`) and the overview total sum it as money |
| Issue without a person on the floor | `voucher_issue` needs an employee id and a `ready` printed batch | a system issue path: source `system`, no employee, digital batch marked ready with no PDF |
| Expiry set by the system | chosen by staff at hand-out | issue date plus 30 days, London date (the 30-day default the staff already use) |
| The voucher in an email | the only voucher email is the expiry reminder, which assumes a card and omits the number | a voucher card block in the marketing renderer with number, percentage, expiry and conditions, filled per recipient |
| Per-recipient content | marketing emails are identical for every recipient; only the unsubscribe link and `utm_content` are substituted | a merge stage (`merge_fields` on the recipient row) |
| Link from voucher to campaign | none: only `won_at_label`, `event_id` and the event source | `marketing_recipient_id` on `vouchers`, unique, so a retry can never issue twice |
| Reminder copy | "show the card at the bar", no number, SMS when no email | digital variant with the number; email only (SMS rule) |
| Who is redeeming | not checked | staff see the customer name on the voucher; ask for the name on the booking |
| Discount actually given | not captured | optional "discount given" amount at redemption, so cash-up uses real money |
| Public voucher page | none (`/g` and `/r` exist for other things) | not needed in Phase 1: the email is the voucher, the number is typed at the till as today |

Sequential numbers are guessable, so the number alone is not a secret. The exposure is small (staff see the customer's name and the voucher's status, the voucher is single use, and it is worth at most a percentage of one food bill) and is noted rather than fixed.

### 6.3 What "generated just like any other voucher" means in the build

Per recipient, at send time: generate a voucher in a digital batch for that day's run (one batch per campaign per day, note "Return visit email, touch 1, 12 November 2026"), issue it immediately to the customer with source `system`, `issued_by_name` "Return visit email", `won_at_label` "Come back offer, touch 1", expiry = London date of issue plus 30 days, then render the email with the number and expiry and send. If the send fails, cancel the voucher with the reason so no live voucher exists without an email. The voucher then behaves as every other: it appears on `/vouchers/all` and on the customer's record, its reminders schedule, it expires on the cron, and it is redeemed on the floor screen by number.

Design needed from the owner: one email voucher card (the block in section 9.2). The brief is `docs/design/brief-return-visit-voucher-email.md`. No printed design and no public page in Phase 1.

---

## 7. Recommendation in phases

### Phase 1: two-touch "come back" sequence with digital vouchers (build first)

**Who.** Identifiable customers (not placeholder, not merged) with a usable email (not opted out, not bounced, not suppressed, not do-not-contact, soft opt-in or explicit opt-in as the pipeline already requires). The anchor date is the booking date of their most recent table booking that was a visit (section 2 definition) **or a no-show** (decision 4: a no-show showed interest and is re-engaged, with the same copy; the email never mentions the missed booking). Exclude bookings with `is_venue_event`, drinks-only bookings (`booking_purpose = 'drinks'`) and Christmas-period bookings (`booking_period_code` for the Christmas period). Phone-only guests are out (decision 3).

**Touch 1.** Anchor date 45 or more days ago, no table booking dated after the anchor, no touch 1 in the last 365 days. At launch this picks up the backlog (anyone 45 to 180 days out); afterwards it is a steady 40 to 60 people a month. Carries a 10% voucher valid 30 days.

**Touch 2.** Touch 1 sent 45 or more days ago, still no table booking after the anchor, touch 1 voucher expired and unredeemed. Carries a 25% voucher valid 30 days. Nothing follows touch 2; the customer stays in the monthly round-ups. The sequence restarts only after a new visit, and no customer starts it more than once in 365 days.

**Holdout.** One in five of the customers eligible for touch 1 (chosen by a stable hash of the customer id) is skipped with reason `holdout` and receives neither touch. Their 30- and 90-day booking rate is the control the sent group is measured against. Without it a redemption count says nothing about how many would have come anyway. The owner can set the share to zero in the campaign settings once the lift is known.

**When.** A lifecycle campaign is promoted once a day at 16:00 London on its send days (Thursday first, Wednesday as fallback), sent by the same 5-minute cron under the same 4-day frequency cap (`ignores_frequency_cap = false`), so it never lands within four days of a round-up or event invitation. A customer never receives more than one lifecycle email in 30 days however the rules overlap.

**Closures, fail closed.** Do not issue a voucher when the kitchen is closed for more than 7 of the next 30 days (the kitchen closes after Sunday 20 December 2026 until Tuesday 12 January 2027, SSOT section 4), because a 30-day voucher would expire mostly unusable. Read closures from the app's hours and special-dates data, never from a list in code. If that lookup fails, send nothing and raise a cron alert.

**What it says.** Short, plain, SSOT section 1 voice (about them, not us; never cheeky; no guilt). Sunday-led, with the facts from SSOT section 4 only: Sundays from 1pm, kitchen to 6pm, last bookable arrival 5:30pm, walk-ins welcome, nothing to pre-order, kids roasts exist, the vegan Wellington sits in the roast list. Never quote a price, never name a pie as a roast, never say "today" or "tonight", never promise a Google review, never hang an exception off a day. First name only. One primary link: book a table. The voucher card shows the number, the percentage, "valid until <date>" and the conditions in full (CAP Code 8.17). Two campaigns (touch 1, touch 2), each approved by the owner in the campaign UI before it can send; `findVenueClosureClaims` runs at scheduling as it does today.

**The voucher.** Two new types as data rows: 10% off and 25% off (decision A: the food bill for the booked table in one transaction, drinks excluded, not valid with the Christmas menu or special-occasion menus, advance booking required, one voucher per table, not with any other offer). `requires_booking = true` like `roast-20-six`. Issued, reminded, expired and redeemed as section 6.3 describes.

**The link.** `https://www.the-anchor.pub/book-table?party_size=<last party size>&source=return_visit_email&utm_source=marketing_email&utm_medium=email&utm_campaign=<utm_campaign>&utm_content=<recipient id>`, wrapped in a `marketing_email` short link as campaigns already do. No `date` prefilled: a prefilled Sunday could land on a closed or special Sunday. Party size clamps to the website's 1 to 20.

**Skip at send time.** Re-check when the recipient is claimed: skip with reason `booked_since_selection` if the customer now holds a table booking after the anchor, plus the usual unsubscribe, suppression, do-not-contact and frequency-cap skips. A skipped recipient gets no voucher.

**Measure.** On the campaign page, per touch: sent, delivered, opened, clicked, vouchers issued, vouchers redeemed, bookings within 30 and 90 days (attributed: a `table_booking_created` analytics event whose `utm_content` is the recipient id; loose: any new table booking by that customer), and the same booking rates for the holdout group. Redemption is the hard conversion. Write a `marketing_conversions` row for the attributed case so the existing attribution report sees it.

### Phase 2: attribution closure (small, ship with or just after Phase 1)

- In `POST /api/table-bookings`, when `utm_source = 'marketing_email'` and `utm_content` parses as a recipient id, insert `marketing_conversions` (`conversion_type 'table_booking'`, `campaign_id`, `recipient_id`, `party_size`, `landing_path`, `utm_*`). Idempotent on booking id.
- Website: confirm `book-table` passes `source`, `utm_*` and `party_size` from the query string through to the API on the Sunday path as it does on the regular path, and that `source=return_visit_email` is an accepted `booking_source` label. Paired-repository rule: say so in the PR and check `lib/table-booking/page-source.ts`.
- Add "bookings in 30 days" to the campaign stats panel for every guest campaign, not only the lifecycle ones, so the round-ups get measured too.

### Phase 3: widen the reachable base and tidy (after Phase 1 has sent for a month)

1. **Walk-in capture (decision 6: in).** 81 of 83 Sunday walk-ins last year are placeholders. Give the FOH walk-in flow a one-tap "add a mobile or email" with the `table_compact_v6` notice so a walk-in can be contacted later. The single biggest lever on audience size; needs staff buy-in.
2. **Thank repeat visitors.** Extend the post-visit flow so a second or later visit gets a short thank-you email (no review ask, no voucher; review stays once per customer). Cheap, uses the existing cron, and is the natural place to later insert "book your next Sunday".
3. **Retire or fix the win-back text.** Remove the control from `/customers/insights` or point it at the new visit function and restrict it to the SMS rule. Fix `customer_scores.last_booking_date` to use visit date and exclude cancelled bookings, since it also feeds the "dormant" insight.
4. **Email capture ask.** 4% conversion; park it or fold it into walk-in capture.
5. **Regulars rule.** Add "3+ visits, none in 60 days" as a further audience rule with "we've missed you" copy and no voucher. Not before: there are 13 such people today.

---

## 8. Deliberately not recommended now

- **Texting diners.** Owner rule, 15 September 2026: SMS is for regulars about the kind of night they already go to; new people and diners get email. The 50 phone-only Sunday visitors stay unreached (decision 3). This also means voucher reminders for these vouchers go by email only.
- **A third touch.** On today's data nobody returns naturally after day 180 and almost nobody after day 90; a third discount would go to people who are gone, and each touch costs margin.
- **A printed or public-page voucher.** The email is the voucher in Phase 1. Revisit if staff find emails hard to read at the till.
- **Personalising on dish or occasion.** 23 bookings with items, 5 with an occasion. Nothing to work with.
- **A new channel, template table or sender.** Everything needed is in the guest pipeline and the voucher ledger.
- **Christmas.** Christmas bookings have their own period, deposit and comms; this sequence must not mention Christmas, must not anchor on Christmas-period bookings, and the vouchers are not valid against the Christmas menu.

---

## 9. Technical design for Phase 1

### 9.1 Database (one migration, through `prod-migrate`, applied before the code deploys)

- `marketing_campaigns`: add `kind text not null default 'one_off' check (kind in ('one_off','lifecycle'))`, `cooldown_days integer`, `send_days smallint[]` (nullable, overrides `customer_send_days`), `promote_at_local time` (16:00), `last_promoted_on date`, `holdout_percent smallint not null default 0`, and allow `audience.customer_filter` jsonb of shape `{ "rule": "table_return_visit", "touch": 1, "days_since_anchor_min": 45, "days_since_anchor_max": 180, "include_no_shows": true, "voucher_type_id": "return-10", "voucher_valid_days": 30, "previous_campaign_id": null }` (touch 2 carries `"touch": 2, "days_since_previous_touch_min": 45, "previous_campaign_id": <touch 1 id>`). A lifecycle campaign sits in a new status `active`, or reuses `scheduled` with `scheduled_for` null, whichever the state machine in `marketing-campaigns.ts` tolerates with the fewest edits.
- `marketing_campaign_recipients`: add `merge_fields jsonb` (`first_name`, `party_size`, `voucher_number`, `voucher_percent`, `voucher_expires_on`) and `voucher_id uuid`. New skip reasons `booked_since_selection` and `holdout`.
- New function `get_table_return_visit_audience(p_filter jsonb)` returning `customer_id, first_name, anchor_date, anchor_was_sunday, anchor_was_no_show, last_party_size, visit_count`. SECURITY DEFINER like its neighbours, executable by service_role only (anon fails closed; run `scripts/security/assert-anon-surface.ts` after). Anchor definition from section 7. All date maths in London (`(now() at time zone 'Europe/London')::date`), never `current_date` in UTC: the suite runs in both zones.
- `voucher_types`: insert `return-10` and `return-25` as data (display and cover titles, `hero` `{kind:'word', big:'10% off', sub:'...'}`, copy, `entitlement_html` with the conditions, `requires_booking true`, `alcohol false`, `value_pence` 600 and 1400 per section 11 B). Add `discount_kind text not null default 'fixed' check (discount_kind in ('fixed','percent'))` and `percent_off smallint` so the percentage is data, not wording.
- `voucher_batches`: add `digital boolean not null default false`; a digital batch is created `ready` with no PDF and the generate and ledger pages hide the download for it.
- `vouchers`: add `marketing_recipient_id uuid unique references marketing_campaign_recipients(id)` and `redeemed_value_pence integer`. Extend `voucher_generate_batch` with `p_source` (`management` or `system`) and `p_digital`, and `voucher_issue` to accept a null employee when `p_source = 'system'` (sets `issued_by_name` from a parameter, keeps the `vouchers_issued_fields` check satisfied). Extend `voucher_redeem` with `p_redeemed_value_pence`. Re-issue every GRANT a `CREATE OR REPLACE` touches in the same migration (anon-grant rule in CLAUDE.md; these are service_role only today and must stay so).
- New RPC `issue_lifecycle_voucher(p_recipient_id uuid, p_voucher_type_id text, p_valid_days int, p_london_today date)`: finds or creates today's digital batch for the campaign, generates one voucher, issues it to the recipient's customer with source `system`, writes `vouchers.marketing_recipient_id` and `recipients.voucher_id` and `merge_fields`, all in one transaction; a second call for the same recipient returns the existing voucher.
- `promote_due_marketing_campaigns`: for `kind = 'lifecycle'`, run once per London day on a send day after `promote_at_local` (guard on `last_promoted_on`), insert recipients from the audience function who have no recipient row for this campaign in the last `cooldown_days`, apply the holdout (hash of customer id modulo 100 below `holdout_percent` gets a recipient row with status `skipped`, reason `holdout`), and respect the one-lifecycle-email-per-30-days rule across lifecycle campaigns.
- `claim_marketing_recipients`: add the `booked_since_selection` skip for lifecycle campaigns.
- `voucher_reminders_recompute`: for a voucher with `marketing_recipient_id`, schedule the 3-day email reminder only (decision C).
- `marketing_conversions`: no schema change; `conversion_type 'table_booking'` is a new value only if a check constraint lists them.
- Regenerate `src/types/database.generated.ts` in the same change; `tests/guards/query-columns.test.ts` must stay green.

### 9.2 App

- `src/services/marketing-campaigns.ts`: create, validate (a lifecycle campaign needs `customer_filter`, `cooldown_days`, `send_days`, `audience_type = 'customer'`, and for a voucher touch an active `voucher_type_id`), pause and resume.
- `src/app/api/cron/marketing-campaigns/route.ts`: in the send loop, after a lifecycle recipient is claimed and before render, call `issue_lifecycle_voucher`; on a failed send call `voucher_cancel` with reason `email_failed` and release the claim as today. Add the closure gate before promotion for `table_return_visit` campaigns, reading closures from the hours service, failing closed with `reportCronFailure`.
- `src/lib/email/marketing/render.ts`: a merge stage for `{{first_name}}`, the booking link and the voucher fields from `merge_fields`, with a fixture render test that fails on `undefined`, `Invalid Date`, an empty first name (fall back to no name, never "Hi ,"), a missing voucher number or a missing link. Check first whether business campaigns already merge per contact; if so reuse that path.
- `src/lib/email/marketing/blocks/`: a `voucher_card` block (or `offer_panel` gaining `code`, `percent`, `valid_until` and `conditions` fields) with its byte-for-byte fidelity fixture, built from the owner's design; colours from `src/lib/brand/palette.ts` `GUEST`.
- `src/lib/vouchers/reminders.ts`: a digital variant of the reminder email including the number and "show this email at the bar"; channel forced to email for vouchers with `marketing_recipient_id`.
- `/vouchers/foh` `RedeemPanel`: an optional "discount given (£)" field shown for percentage vouchers, passed as `p_redeemed_value_pence`; `cashup-day-money.ts` and the overview total use `redeemed_value_pence` when present, else `value_pence`.
- `/vouchers/generate`, `/vouchers/all`, `/vouchers/[number]`: show a "Digital" badge, hide the PDF download for digital batches, show the campaign and touch on the voucher.
- `/marketing/campaigns`: a "Lifecycle" badge, the filter summary, pause and resume, holdout share, and the measurement panel from section 7.
- Two content JSON files under `src/lib/email/marketing/campaigns/` (touch 1, touch 2) seeded by a `scripts/one-off/create-*.ts` like the round-ups, created in `draft` and switched on by the owner in the UI. Scripts stay dry-run by default behind `RUN_<NAME>_MUTATION=true`.
- `src/app/api/table-bookings/route.ts`: Phase 2 conversion insert.

### 9.3 Tests (all green in `npm test` and `npm run test:utc`)

- Postgres harness (`scripts/testing/*-postgres.py`, `npm run test:pg`) for the audience function: anchor definition including no-shows, placeholder and merged exclusion, drinks-only, venue-event and Christmas-period exclusion, 45-day edge, touch 2 only after touch 1 plus 45 days with the voucher expired and unredeemed, 365-day re-entry, future booking exclusion, unsubscribe and bounce exclusion, Sunday detection across a BST boundary.
- Harness for promote: once per day, send-day guard, holdout is stable for a customer and hits the configured share, no duplicates, one lifecycle email per 30 days, merge fields present.
- Harness for `issue_lifecycle_voucher`: one voucher per recipient on retry, expiry = London date plus 30, status `issued` with source `system`, batch digital and ready, reminders email-only.
- Vitest: render both touches with fixtures (including a voucher card with every field); the closure gate with a closed kitchen and a failed lookup (sends nothing, alerts); `booked_since_selection`; failed send cancels the voucher; the conversion insert is idempotent; the stats panel joins correctly; cash-up prefers `redeemed_value_pence`; `SUSPEND_ALL_EMAIL` holds the queue and issues no voucher.
- Guards: `query-columns.test.ts`, `design-tokens.test.ts`, `status-map-docs.test.ts` (new skip reasons and voucher fields) stay green; `assert-anon-surface.ts` passes.

### 9.4 Rollout

1. Migration applied with owner go-ahead, then code deploy (never the other way round).
2. Both campaigns created in `draft`; owner reads the rendered emails on a real phone, checks a test voucher appears on `/vouchers/all` and redeems it on the floor screen.
3. First activation with `holdout_percent = 20`, the backlog capped by `batch_size` so roughly 25 go per cron run inside the window; watch the first day's `email_messages`, the voucher ledger and Resend events.
4. Touch 2 is switched on 45 days after touch 1 first sends (nothing is eligible before then anyway).
5. Review after 90 days against redemptions, attributed and loose bookings, and the holdout, before changing timings or offers. Change one thing at a time; content changes are new approved versions, not edits to a live campaign.

---

## 10. Acceptance criteria

- A customer whose last table booking was 50 days ago, has a usable email, no booking since and is not in the holdout receives exactly one touch 1 email on a send day, in the send window, not within 4 days of another guest email, with a 10% voucher valid 30 days from issue that appears on `/vouchers/all` and on their record.
- The same customer, 45 days after touch 1, with no booking since and the first voucher expired unredeemed, receives exactly one touch 2 email with a 25% voucher, and nothing further; they are not selected again until a new visit, and never within 365 days.
- A holdout customer is recorded with reason `holdout`, receives nothing, and appears in the campaign's holdout booking rate.
- A customer who books before the send is skipped with `booked_since_selection` and no voucher is issued; a failed send leaves no live voucher.
- A customer who unsubscribed, bounced, is on do-not-contact, is a placeholder, is phone-only, or whose only booking was drinks-only, a venue event or Christmas is never selected. A no-show is selected.
- No voucher is issued while the kitchen is closed for more than 7 of the next 30 days, and a failed closure lookup sends nothing and alerts.
- The voucher is redeemed on the floor screen by number exactly like a printed one, single use, refused after expiry; the discount given can be recorded and cash-up shows it.
- Every sent email appears on the customer's communications timeline, carries the unsubscribe link, states the expiry date and the conditions in the body, and shows in the campaign stats with opens, clicks, vouchers issued, vouchers redeemed and 30- and 90-day bookings.
- A booking made through the email's link produces one `marketing_conversions` row and one `analytics_events` row with the recipient id.
- Both test suites and the Postgres harness pass; `assert-anon-surface.ts` passes.

---

## 11. Owner decisions

Recorded 2 November 2026:

1. Audience: all table-booking diners, Sunday-led copy. Not Sunday-only.
2. Timing: set from best practice checked against our own data (section 5): touch 1 at day 45, touch 2 at day 90, then stop; once per 365 days; Thursday, Wednesday fallback, late afternoon.
3. Phone-only guests: left out.
4. No-shows: included; they showed interest.
5. Incentive: yes, through the existing voucher feature, 10% on touch 1 and 25% on touch 2, vouchers generated and expiring (30 days) like any other. Owner will supply the digital voucher design.
6. Walk-in capture: in, as Phase 3.

Voucher questions, answered 2 November 2026:

- A. Voucher scope: 10% and 25% off the food bill for the booked table, drinks excluded.
- B. Liability estimate: the owner assumes 70% gross profit on all products. `value_pence` is set from the ledger precedent (`roast-20-six` is valued at £20 for 20% off six roasts, so about £100 of roasts a table of six) and the live average party of 3.3 covers: food spend about £55 a table, so `return-10` = 600 and `return-25` = 1400 (rounded, internal estimates only, never shown to a guest). The real discount is recorded at redemption and replaces the estimate in cash-up. Reading the results: a 25% discount leaves 45% gross profit on a recovered table, so every redemption that the holdout shows to be a genuine extra visit is profitable.
- C. Reminders: 3 days before expiry only, by email.
- D. Holdout: one in five.

Design: the email voucher card brief is `docs/design/brief-return-visit-voucher-email.md`; the owner hands it to the designer and the build waits for the design.

---

## 12. Rules this work must honour

- Read-only until the owner says build; migration before code; `prod-migrate` for anything touching production; re-issue grants on `CREATE OR REPLACE`; regenerate generated types; `assert-anon-surface.ts` after the migration.
- London dates everywhere via `dateUtils` and `at time zone 'Europe/London'`; both test zones green.
- Fail closed: closure lookup, consent checks, kill switches (`SUSPEND_ALL_EMAIL`, `SUSPEND_ALL_COMMS`), and any voucher issue that cannot be matched to a sent email.
- No SMS to diners; voucher reminders for these vouchers go by email only.
- Customer copy from SSOT sections 1 and 4 only; no prices; the voucher's conditions and expiry in the email body (CAP Code 8.17).
- Scripts dry-run by default behind `RUN_<NAME>_MUTATION=true`.
- Check the paired website repository for the attribution change and say so in the PR.
- No em dashes anywhere.
