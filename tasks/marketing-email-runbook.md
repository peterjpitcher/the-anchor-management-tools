# Marketing email: runbook

How to author, schedule and change a marketing campaign without breaking one.

`marketing-email-b2b-as-built-2026-08-13.md` explains the architecture and why it is shaped
the way it is. Read that for the *why*. It predates guest campaigns, so anything below about
audiences, the frequency cap or rescheduling is not in it.

---

## The two audiences

`marketing_campaigns.audience_type` is not a label. It decides which table is read, which
eligibility rules apply, where an unsubscribe is recorded, and which days may send.

| | `business` | `customer` |
|---|---|---|
| Table | `business_contacts` | `customers` |
| Lawful basis | legitimate interest | consent **or** a prior booking |
| Eligible when | `eligibility_status='eligible'` and `marketing_status='subscribed'` | `marketing_email_opt_in` **OR** a row in `bookings` **OR** a row in `table_bookings` |
| Tag filters | yes, `include_tags` / `exclude_tags` | none, tags are a business-contact concept |
| Unsubscribe recorded on | `business_contacts.unsubscribe_campaign_id` | `customers.marketing_unsubscribe_campaign_id` |
| Frequency cap timestamp | `business_contacts.last_marketing_email_at` | `customers.marketing_last_email_at` |

`createCampaign` defaults to `business`. Pass `audienceType: 'customer'` for a guest campaign
or it will be born with the wrong rules and every count will be wrong. This has already caused
one real bug.

**The cap does not dedupe a human across the two lists.** Someone whose address is in both
tables gets both emails, because the timestamps live on different rows. Check before sending a
pair close together:

```sql
SELECT bc.email FROM business_contacts bc
JOIN customers c ON lower(btrim(c.email)) = bc.email
WHERE bc.eligibility_status = 'eligible' AND bc.marketing_status = 'subscribed';
```

---

## Authoring a campaign

1. **Write the content JSON** in `src/lib/email/marketing/campaigns/`. Blocks come from
   `BLOCK_REGISTRY`; a block's `sample` in `src/lib/email/marketing/blocks/<type>.ts` shows the
   exact data shape.
2. **Validate before it goes anywhere near the database.** `marketingContentSchema.safeParse`
   proves the shape, `renderCampaignHtml` proves it renders, `collectDestinationUrls` shows
   every link that will be tracked.
3. **Create it as a draft**, with the audience type:
   ```ts
   await createCampaign(
     { name, subject: content.title, preheader: content.preheader, content,
       audienceType: 'customer', utmCampaign: 'something-stable' },
     userId,
   )
   ```
4. **Let the owner read it in the UI** at `/marketing/campaigns/<id>`. The owner reviews in situ, not
   as pasted text, and reviews properly, so expect changes.
5. **Schedule it.** `scheduleCampaign(id, isoWithOffset, userId)` freezes the content hash,
   provisions the short links and records the approved count.

Always pass the schedule time **with an offset** (`2026-08-16T12:00:00+01:00`). British summer
time has caught this out before.

---

## Which block to reach for

The September 2026 handover added four blocks and corrected two. Reaching for the wrong one is
what produced the round-up the owner had to look at, so this is the short version.

| You want | Block | Not |
|---|---|---|
| A list of events with posters and a booking link each | `whats_on_media` | `whats_on_list`, which has no pictures |
| A list of events with no artwork | `whats_on_list` | |
| The ordinary trading week, bar and kitchen | `opening_hours_week` | `hours_table`, which is kitchen services only |
| Dated exceptions, Christmas or a bank holiday run | `opening_hours_dates` | `opening_hours_week`, which repeats a week and cannot say "closed on the 25th" |
| Two or three things, each bookable | `grid_cards_linked` | `two_up_cards`, which carries no link |
| Two things of equal weight, no call to action | `two_up_cards` | |
| One picture beside one paragraph | `media_row` | |

Three rules that apply to all of the picture blocks:

- **The caller sets the image `width` and `height`, and `width` is fixed by the design.**
  180 in `whats_on_media`, 240 in `media_row`, 258 in `two_up_cards` and in a row of two
  `grid_cards_linked`, 166 in a row of three. The schema rejects anything else, because the
  markup repeats the width in its own style: an image declared at a width the row cannot hold
  draws at one size and reserves space at another. That was the bug in the first
  `media_row` and `two_up_cards`, which hardcoded 240 x 200 and 260 x 180 and squashed every
  square poster.
- **`height` comes from the artwork's own ratio.** Ours are 1:1 (1254 x 1254), 16:9
  (1672 x 941) and 2.33:1 (1916 x 821). At 258 wide those are 258, 145 and 111. Take the real
  dimensions from the file rather than assuming, and round to a whole pixel.
- **An empty `src` renders the designer's local placeholder** (`img/slot-1x1.png`), which is a
  relative path and cannot resolve in an inbox. It exists so the fidelity fixtures hold. Never
  schedule a campaign with one in it; `blocks.variants.test.ts` guards the block, not your
  content.

`opening_hours_week` wants exactly seven rows and each row picks exactly one kitchen state:
`kitchen` for one service, `lunch` and `dinner` together for two, or `closed: true`. Bar hours
are door times, never the kitchen's. Read them from the published `business_hours` version and
then check `special_hours` for every date the email covers, because an override always wins.

### Mobile

One breakpoint at 620px and three classes, all of them already in the shell. There is no new
CSS and there should not be any: several clients drop the `<style>` block entirely, so the
email has to read correctly from inline styles alone.

- **`.gutter`** on an outer cell turns its 32px side padding into 20px on a phone. Put it on
  every cell whose content is left-aligned, or the block gets a ragged left edge: a heading
  at 20px above a paragraph at 32px is visible and it is the fault the owner spots. Centred
  content does not need it, which is why the mastheads, the closing panel and the footers do
  not carry it.
- **`.stack`** turns a column into a full-width block. It goes on image cells, text cells,
  card cells, the gutter cell between cards, and on the card's own inner `<table>` so it
  lifts its `max-width` and fills the stacked column.
- Pictures in the picture blocks are `width:100%;max-width:100%;height:auto` in CSS. The
  `width` and `height` attributes stay: they are the Outlook contract and set the desktop
  size. Never remove them to make an image fluid.

The two hours blocks carry no `.stack` on purpose. They were redrawn as two columns, a day
against one details cell of labelled lines, so they fit a 375px screen without stacking;
stacking them would turn one legible week into fourteen fragments. Every time in them is
`white-space:nowrap`, so a time can never break in half.

`mobileGutter.test.ts` guards all of this, and the rule is now absolute: every left-aligned
32px cell in all 35 blocks carries the class, with no allow-list and no exceptions. The
October 2026 pass finished the job, including the seven blocks that are read from
`anchor-christmas-and-lunch.html` rather than from the library.

One cell is ours rather than the designer's. `note_bar` has no BLOCK markers of its own: it
is bundled inside `pull_quote` in the library file and split out by
`scripts/one-off/extract-email-blocks.ts`, so from the designer's side it is invisible and
their pass could not reach it. Their handover asked us to apply the one attribute ourselves,
and the extractor does it in `splitPullQuote`, beside the reassembly proof, with an assertion
that fails loudly if a future re-export adds the class itself.

---

## How many emails an event gets, and when

Owner's rule, set 2026-09-08.

| Event type | Emails | When |
|---|---|---|
| Quiz, music bingo, cash bingo, karaoke, anything ordinary | one | seven days before, on the same weekday as the event |
| **Parties** (the Halloween party, New Year, anything of that size) | **two** | **a month before, then again a week before** |
| Monthly round-up | one a month | first days of the month, "Welcome to <month>" |

Time of day follows the event's own weekday: 09:00 London for a midweek send,
12:00 for a Friday or Saturday one. Always write the offset (`+01:00` or `+00:00`),
because British summer time has caught this out before.

The month-before email is a save the date, not the same email sent twice. It sells the
night and asks people to put it in the diary; the week-before one carries the practical
detail. Sending the same copy twice reads as a mistake.

**The two-day frequency cap decides the actual date, not the calendar.** A month before
31 October is 1 October, which sits one day after another guest send and would be refused
by `scheduleCampaign`. The Halloween pair went out on 3 October and 24 October for exactly
that reason. Work out the slot you want, then check the neighbours before you promise it.

Clearing the cap is not the same as being safe. The cap is measured against
`customers.marketing_last_email_at` at claim time, not against `scheduled_for`, and a send
takes tens of minutes to drain. A slot three hours clear of the cap loses recipients silently
if the previous send stalls. Aim for a day of margin, not an hour.

### The monthly round-up

**It goes out on the first of the month**, owner's rule, 9 September 2026. Not "the first few
days": the first. That is what makes the two-day frequency cap a problem in some months and
not others, and why the round-up is exempt from it (see
`marketing_campaigns.ignores_frequency_cap`). Checked against the current schedule, only
October actually needs the exemption; 1 November and 1 December are already clear.

**It goes to both lists**, owner's rule, 9 September 2026. A campaign carries one
`audience_type`, so that means one campaign per list per month with the same content. The
only address on both lists today is the owner's own, so nobody else is double-sent, but
re-check that before each pair goes out: the frequency cap keys on the contact row, not the
email address, so it will not catch it for you.

**It wears the month.** `masthead_seasonal` with that month's artwork, from
`event-images/marketing/seasonal-masthead/NN-month.jpg`.

One a month, sent in the first days of the month, subject "Welcome to <month> at The Anchor".
It carries every event still to come that month (`whats_on_list`, up to eight), the opening
hours, whatever is genuinely new, and a line about what is coming next month.

**The hours panel is door times, not kitchen times.** People read it to answer "are you open
on Wednesday", so give all seven days from the published `business_hours` version in force,
and say plainly that those are the doors. Food times go in a `fact_strip` underneath, where
the label column is not a fixed 140px and "Food, Tuesday to Friday" fits. Getting this wrong
once made the whole panel read as kitchen hours.

**Check `special_hours` for every date the email covers**, and say so in the email when a day
differs. September 2026 had none; 31 October, 22 December to 1 January and the New Year run
all do. A month with a closure or a shortened day must not go out quoting the standard week. It is the only email that talks about the pub rather than one night.

Facts for it come from live sources every time: `business_hours` for the version in force,
`special_hours` for any dated override, `events` for the listings, and the website repo's
`docs/SSOT.md` for anything about food, dogs, parking or policy. **Do not quote menu prices.**
The SSOT forbids hardcoding them because they are live from the menu API.

---

## Checking the facts before you schedule

An email that is factually wrong reaches real people, and nobody catches it after the send.
Check each of these against a live source, not against the previous email in the series:

- **Kitchen and opening hours belong to the event's own weekday**, and `special_hours`
  overrides `business_hours` for a given date and always wins. The Halloween party email
  said the kitchen was open until 7pm because that is true of an ordinary Saturday; the
  dated row for 31 October closes it at 6pm and reopens for pizza at 9pm. Query
  `special_hours` for the event date every time, even when you are sure.
- **Seating language must match `events.booking_mode`.** Cash bingo and music bingo are
  communal, quiz nights are table seating, all at capacity 60. The category defaults encode
  this, so a new event inherits it.
- **Prices, prize values and Snowball projections come from the event row**, not from the
  last email of that series. A Snowball rolls over, so its figure and its number target
  change every time.
- **Every booking link must match `events.slug`.** A stale slug looks fine and lands nowhere.
- **Artwork in an email must be the `-email.jpg` derivative, never the original PNG.** The
  event posters are 3 to 5MB PNGs. The website never feels that, because next/image re-encodes
  and resizes them on the fly, but email has no such stage: whatever URL the campaign carries
  is what lands in the inbox. Supabase's transform endpoint does not rescue a PNG either,
  because PNG ignores the quality setting. `scripts/one-off/export-email-artwork-as-jpeg.ts`
  writes a JPEG beside each original at twice its render size, which came out 92% smaller
  across seventeen images (57.4MB to 4.4MB). Run it for any new artwork, and leave
  `events.*_image_url` pointing at the originals: the website wants those.
- **`hours_table` is the kitchen-services panel, and its cells are narrow.** For opening hours
  use `opening_hours_week` instead, which has three proper columns. If you do use it: the label column is a
  fixed 140px with 22px of left padding in 22px serif, leaving 118px, and the time cell has
  374px. Measure before you write: in the fallback fonts the clients actually use, "Saturday"
  is 88px and fits, "Tuesday to Friday" is 176px and wraps to two lines, and "Lunch, Tuesday
  to Friday" is 249px and wraps to three, with the time floating in the middle of them because
  that cell is vertically centred. Keep labels to three-letter day names and put everything
  else in the time, which comfortably takes both services:
  `Tue | 12pm-10pm, food 12pm-3pm, 4pm-9pm` measures 334px. The `time` field also caps at 40
  characters in the schema. The block markup is fidelity-tested against the designer's
  handover, so this is a content constraint, not a bug to fix in the block.

---

## Changing a campaign that is already scheduled

Scheduling freezes content on purpose, so `updateCampaign` refuses anything that is not a
draft. Put it back to draft, edit, and schedule again. Do not patch `content` in SQL: you would
skip revalidation, leave a stale content hash, and lose the link reprovisioning.

```ts
await supabase.from('marketing_campaigns')
  .update({ status: 'draft', scheduled_for: null, approved_recipient_count: null })
  .eq('id', id).eq('status', 'scheduled')

await updateCampaign(id, { content }, userId)
await scheduleCampaign(id, sameOrNewTime, userId)
```

Rescheduling re-runs every check, which is the point. Verify afterwards by reading the row
back, not by trusting the script's own output.

---

## Five things that bite

**1. The frequency cap can silently empty a whole campaign.** It locks the *contact row*, so it
applies across campaigns. Two sends to the same list inside the window and the second skips
every recipient and finishes as `completed` having reached nobody: no error, no alert.
`scheduleCampaign` now refuses a colliding slot and names the safe date. If you ever find
yourself wanting to bypass that guard, you are about to lose a campaign.

**2. The audience is live, the count is frozen.** `approved_recipient_count` is a record, not a
control. Recipients are chosen by `promote_due_marketing_campaigns()` at the moment the campaign
falls due, so anyone added or unsubscribed in between changes who receives it. The campaign page
shows "Will actually send to N" when the two disagree. This is deliberate: a contact added on
Saturday *should* get Monday's email.

**3. Some campaign JSONs are test fixtures, not content.** `christmas-and-lunch-2026.json` is
compared byte-for-byte against the designer's handover by `campaign.fidelity.test.ts`. Editing
it to make it current breaks the suite, and it has already been done once. Same for the block
`sample` values. **If a fidelity test fails, fix the code, never the fixture.**

**4. Send windows are open but the mechanism is still there.** `send_days`,
`customer_send_days` and the hour bounds are all wide open by owner decision (2026-08-15), so a
blocked send is *not* the window any more. Restoring a window is one `UPDATE` on
`marketing_settings`, not a migration.

**5. `sends_enabled` is the kill switch** and it is checked inside the claim RPC, so no code
path can route around it. If nothing is sending, check it first.

---

## Copy rules the owner has set

These came from real review rounds. Ignoring them means a rewrite.

- **Positive throughout.** He rejected a draft for accumulated negatives: "nobody hurrying
  you", "not changing", "kitchen is closed", "still putting it together". Individually fine,
  collectively they drag down an announcement.
- **Lead with the offer, not the operational change.** An email about new opening hours is an
  email about lunch.
- **Put the date in the body.** He read straight past it in the hero kicker.
- **Show all prices, not a "from" price.** The cheapest tier is rarely what people buy.
- **No exclusivity promises** ("never a shared sitting") even where the website says it. An
  email is a harder promise to keep.
- **The footer reason must be true for that audience.** Guests are on the list via consent *or*
  a booking, so do not tell them all they booked. Business contacts never booked at all. Keep
  the tone friendly: the owner rejected a version that "sounds like a legal nightmare".
- **Facts come from live sources**, the `business_hours` rows and the website's `docs/SSOT.md`,
  never from the designer handover, which is stale on capacity, pricing and hours.
- **The voice lives in the website repo's `docs/SSOT.md` §1, not here.** That is the source.
  What follows are the email-specific notes and the corrections the owner has actually made;
  when the two disagree, the SSOT wins and this is the stale copy. Read §1 before writing.
  The owner confirmed it on 11 September 2026 and added one rule in their own words: it's about
  them, not us. Every line is written from the reader's side. "Cheeky" is not part of it.
- **The checkable half is enforced.** `src/lib/copy/house-style.ts` encodes SSOT §1 and §14.
  Banned claims are errors and `scheduleCampaign` refuses them for every campaign, the
  cap-exempt monthly round-ups included (they skipped the check until 11 September 2026);
  voice issues are warnings and show in the campaign UI. `npx tsx scripts/audit-house-style.ts` runs the same rules over the
  menus, the events and every campaign, which is the part the SSOT could never reach: the
  errors that actually shipped were rows in the database, not copy.
- **Use contractions.** "We're", "you'll", "there's", "don't". The single fastest way to sound
  like a person. All three round-ups were rewritten once for warmth and still had zero
  contractions, which is how easy it is to miss.
- **Write from the reader's side, not ours.** Owner correction, 9 September 2026. He rejected
  "Three nights out before Christmas, the last of the Christmas sittings, and then the quiet
  stretch between the years when the bar is open and the kitchen has earned a rest." Every
  word of it is true and it is entirely about us: our nights, our sittings, our kitchen. What
  the owner wants is what the reader gets out of it. "December is finally here, which means we can
  officially stop pretending it's too early to get excited about Christmas. The lights are
  twinkling, the festive drinks are flowing and there's something about this time of year
  that makes even an ordinary evening feel a little more special."
  Three tests before a paragraph ships: does it describe something the reader will feel
  rather than something we will do; would it survive being read out loud in the bar; and is
  there a picture in it. An operational sentence with no picture in it belongs in a table,
  not in prose.
- **Excitement never reaches the facts.** Times, prices, dates and hours stay exactly as the
  records have them. Warm the sentence around a fact, never the fact.
- **Never hang an exception off a day.** "We are open from midday every day except Monday" is
  factually correct, and it reads as "we are shut on Mondays". We are not: we open at 4pm.
  Say what the day IS: "from midday Tuesday to Sunday and from 4pm on Mondays". The rule
  holds however true the exception is, because the ambiguity is in the grammar rather than in
  the facts, which is why checking the copy against the hours would not have caught it. This
  one is now enforced: `findVenueClosureClaims` warns in the campaign UI and
  `scheduleCampaign` refuses outright.
- **When the email carries an hours table, let it do the talking.** The sentence above was a
  paraphrase of a table sitting two blocks below it. Point at the table instead.

---

## Before you call it done

- `npm test` and `npm run lint` clean. The fidelity suites are the ones that matter.
- Read the campaign row back from the database: status, `scheduled_for` in London, recipient
  count, `content_hash IS NOT NULL`.
- Check no other campaign to the same audience sits inside the cap window.
- If code changed, confirm the deploy actually went green. A push is not a deploy.
