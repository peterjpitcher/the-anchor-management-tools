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
4. **Let the owner read it in the UI** at `/marketing/campaigns/<id>`. He reviews in situ, not
   as pasted text, and he does review properly, so expect changes.
5. **Schedule it.** `scheduleCampaign(id, isoWithOffset, userId)` freezes the content hash,
   provisions the short links and records the approved count.

Always pass the schedule time **with an offset** (`2026-08-16T12:00:00+01:00`). British summer
time has caught this out before.

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
- **`hours_table` labels must be eight characters or fewer.** The label column is a fixed
  140px with 22px of left padding, set in 22px serif, and the time cell beside it is
  vertically centred. A longer label wraps to two or three lines while the time floats in the
  middle of them, which reads as a broken panel. "Saturday" fits, "Tuesday to Friday" does not.
  Put the qualifier in the time instead: `Lunch | 12pm to 3pm, Tue to Fri`. The block markup is
  fidelity-tested against the designer's handover, so this is a content constraint, not a bug
  to fix in the block.

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
  the tone friendly: he rejected a version that "sounds like a legal nightmare".
- **Facts come from live sources**, the `business_hours` rows and the website's `docs/SSOT.md`,
  never from the designer handover, which is stale on capacity, pricing and hours.

---

## Before you call it done

- `npm test` and `npm run lint` clean. The fidelity suites are the ones that matter.
- Read the campaign row back from the database: status, `scheduled_for` in London, recipient
  count, `content_hash IS NOT NULL`.
- Check no other campaign to the same audience sits inside the cap window.
- If code changed, confirm the deploy actually went green. A push is not a deploy.
