# Christmas dinner: book the table, then choose the food by link

Version 2, 6 November 2026. Version 1 (the proposal, same day) is replaced by this one, which records the owner's answers and the technical design. Discovery evidence: `findings-appendix.md` in this folder.

Repos: website `OJ-The-Anchor.pub` (branch `feat/christmas-deposit-first`), management app `OJ-AnchorManagementTools` (branch `feat/christmas-food-link`). The management app ships first because the website sends it a new shape.

## 1. Owner decisions, 6 November 2026

| # | Decision |
|---|---|
| D1 | A Christmas booking takes the table and the £10 a head booking charge only. Nobody chooses courses or dishes when booking. |
| D2 | Online Christmas booking needs at least **8 days' notice**, so the organiser has time to send the choices before the cutoff. Inside that, the website asks them to phone. Staff can still book any date in the management app. The notice is the Christmas period's `min_notice_hours` (192), which the owner can change in the management app's booking period settings. |
| D3 | After the deposit is paid, the organiser gets an email thanking them for the booking and the deposit, with a link to the food page. |
| D4 | The food page has a line per guest. Every guest, on 1, 2 or 3 courses, needs **a name, their allergies, their number of courses and their dishes**. 1 course is a main; 2 courses a main plus a starter or a dessert; 3 courses all three. |
| D5 | On any line the organiser can type that guest's email address, and we email that guest their own link. The guest fills in only their own line, and it appears on the organiser's page, marked as done by them. |
| D6 | Organiser reminders while anything is missing: 21, 14 and 10 days before by email; the day before the cutoff and 9am on cutoff day by email and text. They stop once everything is in. |
| D7 | If choices are still missing the day before the cutoff, the owner gets an email listing those bookings and who to phone. |
| D8 | Choices close at noon, 7 days before the booking (unchanged). The organiser and guests can't change them after that; staff can. |
| D9 | Groups: we always try to seat groups in the dining room, and smaller groups may share it. Groups of 20 or more get the dining room set up as a private dining experience. |
| D10 | Festive buffet prices exclude VAT, which is added in the contract. |
| D11 | Tables finish at normal closing time. Anyone wanting to stay later talks to us first, so we can check what our licence allows. |
| D12 | £10 a head booking charge, refunded in full if the booking is cancelled 7 or more days before; not refunded inside 7 days. (Matches the existing rule, unchanged.) |
| D13 | Fix the problems found on the payment path. |
| D14 | The shared front-of-house login can view the booking's one-pager on screen only, with no print or download. Managers can download it. |
| D15 | Every sit-down Christmas booking uses the food page, whatever its size. More than 20 guests can only be booked by staff in the management app, never on the website. |
| D16 | The vegan Wellington's 1 course price follows the roast: Sunday roast price plus £7, the same as turkey (16 to 23), pork (17 to 24) and beef (18 to 25). The roast Wellington is 17 on the live `/sunday-roast` page, so the Christmas 1 course Wellington is **£24**. |

Assumptions recorded for the PRs:
- **A1.** Kids mains are 1 course only, as the SSOT already says.
- **A2.** A staff Christmas booking of more than 20 takes the same £10 a head charge. Staff can waive it with the existing waiver.
- **A3.** The staff limit for a Christmas booking is 60 guests: the seated Christmas capacity on the page, held as the setting `christmas_staff_max_party`.
- **A4.** A guest's email address is used only for their food link and one reminder, and is cleared after the booking.
- **A5.** "9am on cutoff day" runs from a 09:00 UTC cron, which is 9am London throughout the Christmas window (GMT).

## 2. The journey

1. **Book** on the website (4 to 20 guests, at least 8 days ahead): date, time, number of guests, the organiser's name, mobile and email (email required for Christmas), then pay £10 a head. Groups over 20, or dates inside 8 days, are asked to phone.
2. **Deposit paid:** the confirmation screen, an email and (if there is no email) a text thank the organiser and lead with "Choose everyone's food", showing the deadline.
3. **Food page** (the booking's own link, valid until 48 hours after the sitting):
   - **Top:** deadline, progress ("5 of 8 guests done") and a menu panel. The panel shows each tier's price for that day (Tuesday to Thursday or Friday to Sunday), what's included and every dish with its description and allergens.
   - **A line per guest:** name; allergies ("No allergies" or details); number of courses; dishes for that tier (kids mains only on 1 course); other dietary needs; extras.
   - **Each line can also send a link:** "Send them a link to choose" takes an email, and shows "Waiting for Sam" until they're done, then "Chosen by Sam".
   - **Other features:** save part-way at any time, email me a copy, and change numbers.
4. **Guest link:** shows only that guest's line, with the same menu panel. Saving updates the organiser's page. It closes at the deadline.
5. **Reminders:** organiser reminders per D6, guest reminders once on the day before the cutoff, and the owner's call list per D7.
6. **Cutoff:** at noon, 7 days before, choices lock. The kitchen order email goes out as now, listing anything still missing. Staff can still edit.
7. **On the day:** the one-pager per booking for the kitchen and the floor.

## 3. Management app design

### 3.1 Migration (one file, additive, backwards compatible)

- `booking_preorder_covers` gains:
  - `has_allergies boolean` (null means not answered yet);
  - `allergy_detail text` (up to 300 characters, required in the app when `has_allergies` is true);
  - `invite_email text` (up to 254 characters);
  - `invite_sent_at` and `invite_reminded_at` (timestamptz);
  - `last_saved_by text` (`organiser`, `guest` or `staff`) and `last_saved_at timestamptz`.
- `booking_period_menu_items` gains `is_child_option boolean NOT NULL DEFAULT false`. Data step: true for the three Kids Christmas Dinner mains of `christmas-2026`.
- `guest_tokens` gains `preorder_cover_id uuid REFERENCES booking_preorder_covers(id) ON DELETE CASCADE`, and `action_type` accepts `preorder_guest`.
- `booking_preorder_reminders`:
  - gains `cover_id uuid` (nullable, cascade);
  - its kind check accepts the new kinds: `booker_21d`, `booker_14d`, `booker_10d`, `booker_day_before`, `booker_cutoff_morning`, `manager_day_before`, `guest_invite`, `guest_reminder`;
  - uniqueness becomes one row per booking, kind and cover. The old kinds stay valid for history.
- **Trigger `assert_christmas_course_snapshot_v01`, rewritten:**
  - seat values 0 to 3, where 0 means "not chosen yet";
  - an accepted Christmas booking inserted with no list gets zeros for every seat;
  - a list shorter than the party is padded with zeros, and a longer one is still refused;
  - `booking_period_requires_preorder` is true for every Christmas booking with a list, because every guest now chooses;
  - the deadline guard is skipped when `current_setting('anchor.christmas_staff_override', true) = 'on'`;
  - on a tier change, starters and desserts beyond what the new tier allows are deleted (none on 0 or 1), and kids mains on a seat moving to 2 or 3 courses are deleted.
- **Trigger `assert_christmas_preorder_selection_v01`, rewritten:**
  - a main is allowed on any tier;
  - a starter or dessert is refused on tier 0 or 1;
  - a child-option main is refused on tier 2 or 3.
- **New `set_christmas_seat_course_v01(p_table_booking_id uuid, p_ordinal int, p_course_count int, p_staff_override boolean DEFAULT false) RETURNS jsonb`:**
  - SECURITY DEFINER, `search_path` pinned, EXECUTE for `service_role` only;
  - updates one seat atomically (`christmas_course_counts[p_ordinal] = p_course_count`), so an organiser and a guest saving different seats never overwrite each other;
  - sets the override config locally when `p_staff_override` is true.
- `change_christmas_party_v01`: guests joining get tier 0, so the organiser adds people and their courses are chosen later.
- `create_table_booking_staff_v06`: when the guest accepted a Christmas period, the party limit is the larger of `table_booking_max_party_online` and `christmas_staff_max_party` (default 60). The public entry point keeps 20.
- Data:
  - `christmas-2026` gets `min_notice_hours` 192, `max_party_size` 60 and `guest_blurb` "Our festive set menu, 10 November to 20 December. Book your table now and we'll email you a link to choose everyone's food.";
  - setting `christmas_staff_max_party` = 60;
  - `messaging_flags` gets `table_deposit_hold_reminder` and `table_preorder_choices_copy` set true;
  - a 1 course menu dish "Christmas Dinner, Vegetable Wellington" at 24 on the `christmas` menu, beside the other 1 course mains, with SSOT §7 wording (vegan, vegan trimmings and gravy, no Yorkshire pudding, no pigs in blankets).
- Rollback file in `supabase/rollbacks/`. Regenerate `src/types/database.generated.ts`. Run `assert-anon-surface.ts` after applying.

### 3.2 The pre-order model (`src/types/preorders.ts`, `src/lib/table-bookings/preorder.ts`)

- **A seat is complete when it has all of these:**
  - a tier of 1 to 3;
  - a non-empty name;
  - `has_allergies` answered, with detail when true;
  - a main;
  - on 2 courses, exactly one of a starter or a dessert;
  - on 3 courses, both.
- A booking with no list keeps the old main-only rule, for old records. Add-ons never count.
- `describeCoverMissingCourses` names what is missing in plain words ("a name, their allergies and a main").
- `savePreorderCover` saves the new fields and records who saved. It sets the tier through the RPC, and a staff save passes the override.
- `decidePreorderChases` becomes the D6 and D7 ladder:
  - each stage is due on its day (organiser stages at the noon run; the cutoff-morning stage at the 09:00 run on cutoff day);
  - a stage is skipped if the booking was made after its due time;
  - nothing goes to the organiser once the form has locked or the order is complete;
  - `manager_day_before` goes at the noon run on the day before the cutoff, if anything is missing.

### 3.3 Guest-facing pages

- `/g/<token>/table-manage`: the food section is rebuilt per section 2, step 3. The numbers form works for a booking with zeros.
- New `/g/<token>/christmas-choice`, for a `preorder_guest` token: one seat only, same menu panel, saves through the same function as `last_saved_by = 'guest'`. Locked after the cutoff. It never shows other guests or lets the guest cancel or change the booking.
- Invites: a token scoped to the cover, expiring at the cutoff, sent by email only. The email says the organiser asked us to send it and that we won't email about anything else.

### 3.4 Messages

- **Deposit received:** a Christmas version per D3, with the food link and the deadline. Email first, text if there is no usable email.
- **Organiser reminders:**
  - D6 ladder, each naming the guests still missing and the deadline;
  - the text versions carry the short link and the deadline.
- **Owner's call list:** the day before the cutoff (D7), sent to manager@the-anchor.pub with booking reference, time, party size, organiser name and phone, and what each line needs.
- **Guest messages:** the invite, and one reminder on the day before the cutoff.
- **Choices copy:**
  - on request from the food page;
  - automatically at the cutoff (flag switched on).
- **Crons in `vercel.json`:** keep `0 12 * * *` and add `0 9 * * *` for the cutoff-morning stage.

### 3.5 Staff side

- Booking detail:
  - **Send food link** (email, or text if there is no email) and **Copy link**;
  - the seat editor gains the new fields;
  - staff edits pass the override, so they work after the cutoff.
- One-pager per booking at `/table-bookings/<id>/sheet`:
  - **Header:** day, date, time, reference, organiser and mobile, tables, guests, deposit paid to take off the bill, choices status.
  - **Allergy box:** in red, first, covering the booking allergy and every guest's allergy.
  - **Kitchen tally:** tiers and dishes per course, with "not chosen" counted.
  - **Guest table:** a row per guest with seat, name, courses, starter, main, dessert, extras, allergies, dietary needs.
  - **Access:** front-of-house and BOH roles can view it. Only BOH or manager permission sees **Download PDF**, from a new per-booking route reusing `generatePDFFromHTML`.
- The day PDF prints a food page even before any choice is made, listing the seats as not chosen.
- A guest's allergy raises the booking's allergy flag on the FOH timeline, the BOH list and the sheets.
- FOH create: a Christmas booking can be up to 60 guests for staff.

### 3.6 Booking API and payment path

- `POST /api/table-bookings`, for an accepted Christmas booking:
  - email is required;
  - course counts are no longer needed, though old payloads are still accepted.
- Guest-ready error codes, each with a message that gives the phone number:
  - `CHRISTMAS_NOTICE`: inside the notice;
  - `CHRISTMAS_PARTY_TOO_SMALL`;
  - `CHRISTMAS_PARTY_TOO_LARGE`;
  - `CHRISTMAS_NOT_AVAILABLE`: a Monday, kitchen closed or outside the window;
  - `CHRISTMAS_EMAIL_REQUIRED`.
- Payment fixes:
  - the success panel names the channel the confirmation actually went by;
  - moving a deposit hold later extends its payment link;
  - Christmas-specific wording on the payment page.

## 4. Website design

- `/book-table` form:
  - Christmas asks for no courses;
  - the Christmas question is pre-answered when the URL carries `christmas=1`;
  - one line explains the food link and the deadline, worked out from the date;
  - the summary says "Christmas dinner";
  - the "No deposit for tables of 14 or fewer" badge is hidden for Christmas;
  - dates inside the period's notice show the phone message instead of the course picker;
  - email is required;
  - the Christmas error codes show their messages;
  - the PayPal error line gives the phone number;
  - dates are formatted in London time;
  - after payment, the confirmation says the food link is in their email, with the deadline.
- Quick-book: in the Christmas window it routes Christmas dinner to `/book-table?christmas=1`.
- Proxy `app/api/table-bookings`: requires email for Christmas, and stops sending course counts and dishes.
- `/christmas-parties`:
  - **Drawer:** the course question and the fixed sitting times go; the handoff carries `christmas=1&source=christmas-parties`, and checks Mondays, the minimum of 4, more than 20 (phone or enquiry) and the 8-day notice.
  - **Copy to rewrite:** one true booking process; room wording per D9; finish time per D11; buffets plus VAT per D10; the Wellington's trimmings; allergy wording from SSOT §16; the under-18s 9pm line; the noon deadline; the 20 December and after-season states.
  - **Schema:** fixed to match.
- Sitewide Christmas copy fixed to match: blog posts, the homepage band, the pop-up, `/corporate-events`, header promo dates.
- `docs/SSOT.md` §7 and `SSOT.json`: D1 to D16, then run the drift guard.

## 5. Ship order

1. **Management app:** PR with the migration packet. Apply the migration through `prod-migrate`, then merge, deploy and verify. Old website payloads still work.
2. **Website:** PR, merge, deploy, verify on www.
3. **Live checks:**
   - the periods payload shows 192 hours and the new wording;
   - the menu API shows the Wellington at 24;
   - a Christmas date 3 days out on the website shows the phone message;
   - the food page, guest page and one-pager render for a seeded booking in a local preview.
4. **Owner test still needed:** a real paid booking with real messages, because no tool here can pay.
