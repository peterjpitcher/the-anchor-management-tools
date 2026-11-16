# Playbook: event to-dos

Written 16 November 2026 with Peter. How the to-dos on the Events to-do list (`/events/todo`) get done, who does each one, and how to tick them off. It is for Claude or any agent working through the `anchor-management` MCP server. **Nothing here runs on a timer: do a task only when Peter asks for it.**

## Who does what

Every event gets the same seven tasks (`EVENT_CHECKLIST_DEFINITIONS` in `src/lib/event-checklist.ts`). Six fall due 56 days before the event and the WhatsApp reminder 3 days before.

| Task (key) | Who | How |
|---|---|---|
| Update All Event Details and Publish (`write_event_brief`) | Claude | Check the event record and the live page, fix what is wrong. Part 1. |
| Create Facebook Event (`create_facebook_event`) | Claude | Wording from the app, posted in Peter's Chrome after his yes. Part 2. |
| Add GBP Event Post (`add_google_business_post`) | Claude | Wording from the app, posted in Peter's Chrome after his yes. Part 3. |
| Schedule Event Email (`schedule_event_email`) | Claude | Marketing email campaign in the app, scheduled after his yes. Part 4. |
| Schedule Social Posts (`schedule_social_content`) | **Peter** | CheersAI. Claude does not do this. Part 5. |
| Scheduled Stories (`schedule_stories`) | **Peter** | CheersAI. Claude does not do this. Part 5. |
| WhatsApp Reminder, 3 days before (`send_whatsapp_reminder`) | **Peter** | His own WhatsApp. Claude does not draft or send it. Part 5. |

"Design Printed Materials" (`design_table_talkers`) was taken off the list on 16 November 2026: the print files are done once the event artwork is uploaded (Peter). Old ticks under that key are ignored.

## Before any task

1. **See what is outstanding.** `event-checklist.getChecklistTodos` lists overdue and due-today tasks for every upcoming event; `event-checklist.getEventChecklist(eventId)` shows one event's seven tasks with their state.
2. **Check whether it is already done.** The list has lagged behind reality: on 16 November 2026 the emails, posts and stories for Sleigh My Name and Christmas Jackpot were all scheduled while the list showed them overdue. Use the "Is it already done?" check in each part below before doing any work.
3. **Read the rules for customer copy.** The voice is section 1 of the website repository's `docs/SSOT.md` (written about the guest, "you", never cheeky). Read this repository's `tasks/lessons.md`. No em dashes. Never invent a price, time or date: take them from the event record.
4. **Work out every weekday from its date in code** (for example `python3 -c "import datetime; print(datetime.date(2026,12,16).strftime('%A'))"`) and write the date beside it.
5. **Get one approval for the whole request.** Anything that is published or sent (a Facebook event, a Google post, a scheduled email) needs Peter's yes on the exact wording first. Gather everything for the request, show it in one message, numbered, and act on his answer. A yes covers only what he was shown.

## Ticking a task off

Tick a task only once it is done and checked, and tick it as soon as it is (Peter: "if you do a task, you need to tick it off"). Also tick a task you can prove is already done.

```
run_action  event-checklist.toggleEventChecklistTask  ["<event id>", "<task key>", true]
```

Then run `event-checklist.getEventChecklist(eventId)` and confirm the task shows `completed`. Untick with `false` if something was ticked by mistake. For Peter's three tasks, tick only when the CheersAI check in Part 5 shows the content is scheduled, or when Peter says he has done it.

## Part 1: Update All Event Details and Publish (`write_event_brief`)

The goal is an event record that is complete and correct, and a live page on the website that matches it.

**Read the record:** `events.getEventById(eventId)`, plus `event-marketing-links.getEventMarketingLinks(eventId)`.

**Check each of these, and list every problem found:**

- **Basics:** name, date and its weekday, start time, end time, doors time, price, payment mode, any online discount (`online_discount_type`, `online_discount_value`, `online_discount_ends_at`), capacity, booking mode and category. The category matters: promo texts silently skip an event without one.
- **Open for bookings:** `event_status` is `scheduled`, and `bookings_enabled` and `booking_open` are both true.
- **Words:** short description, long description, highlights, brief, meta title and meta description all name this event, its date, its weekday and its price, and nothing from the event it was copied from. Search the text for the dates and names of earlier events. ("Snowball" in a Cash Bingo description is the name of a bingo game, not a leftover from Snowball Showdown.) Check the wording against the SSOT voice.
- **Artwork:** the hero (square), landscape, story and poster images are present and branded (their storage path contains `/branded/`), with alt text.
- **Links:** marketing links exist. If there are none, run `event-marketing-links.generateEventMarketingLinks(eventId)`.
- **Live page:** fetch `https://www.the-anchor.pub/events/<slug>` and check that it loads, shows the right date, weekday, time and price, and that the booking button works. The website takes a while to catch up after a change, so check again later if it does not show yet.

**Fix:** show Peter the list of corrections as the exact new wording and values. On his yes, make them on the event's edit page in the app (`https://management.orangejelly.co.uk/events/<id>`). Do not use `events.updateEvent` through MCP unless `describe_action` shows that fields left out of the form are kept and not blanked. Then re-read the record and re-fetch the live page.

**Tick** `write_event_brief` once the record and the live page both check out.

## Part 2: Create Facebook Event (`create_facebook_event`)

There is no Facebook connection for this, so it is done in Peter's own Chrome (the `claude-in-chrome` tools), where he is signed in.

**Is it already done?** Search The Anchor's Facebook Page events for the event's name and date. If an event is already there, check its details, report the link and tick.

1. **Wording:** run `event-content.generateEventPromotionContent({ eventId, contentType: 'facebook_event', ctaUrl })`, with `ctaUrl` set to the event's `facebook` marketing link. It writes nothing to the event. Edit the result to the SSOT voice: one or two emojis at most, because this is a social post.
2. **Show Peter:** event name, date and weekday, start and end times (London time, as on the event record), description, ticket link and cover image (the landscape artwork). Wait for his yes.
3. **Post it** as The Anchor's Page: create an in-person event at The Anchor with the approved name, times, description and ticket link, add the cover image and publish. Change no Page settings and invite nobody.
4. **Check:** open the published event and confirm the date, weekday, times and link. Give Peter the event's URL.
5. **Tick** `create_facebook_event`.

## Part 3: Add GBP Event Post (`add_google_business_post`)

Google has not yet approved API access to the Business Profile (reapplication reminder on 24 November 2026), so this is also done in Peter's Chrome, on The Anchor's Business Profile.

**Is it already done?** Look at the profile's Updates for an event post with this name and date. If one is there, check it, report it and tick.

1. **Wording:** run `event-content.generateEventPromotionContent({ eventId, contentType: 'google_business_profile_event', ctaUrl })`, with `ctaUrl` set to the event's `google_business_profile` marketing link. **No emojis**: a listing reads as web copy.
2. **Show Peter:** title, start and end date and time, details text, button and link, and photo (the landscape artwork). Keep to the limits the form shows. Wait for his yes.
3. **Post it:** add an update of the Event type with the approved title, dates, times, photo and details, and a Book button pointing at the link. Change nothing else on the profile.
4. **Check:** confirm the post appears among the profile's updates with the right dates.
5. **Tick** `add_google_business_post`.

## Part 4: Schedule Event Email (`schedule_event_email`)

Each event gets one guest email, sent 7 days before the event. It goes through the app's marketing campaigns, which check content, banned claims, closure claims and the sending cap, and leave out guests who have already booked.

**Is it already done?** Run `marketing-campaigns.listMarketingCampaigns({})` and look for a campaign whose `event_id` is this event, or whose name starts with the event's name. If it is `scheduled` or `completed`, tick. The full list is large: search the result rather than reading it.

1. **Content:** start from the nearest earlier event of the same kind in `src/lib/email/marketing/campaigns/<event>-<year>-guests.json` (for example `christmas-jackpot-cash-bingo-2026-guests.json` for a Cash Bingo night). Rewrite it for this event: name, date and weekday, times, price (the online price and the door price where they differ) and image. Link only to `https://www.the-anchor.pub/events/<slug>`: one event link is how the app knows which event the email promotes and skips guests who have booked.
2. **Names, following the existing pattern:**
   - campaign: `<Event name> - guests - <D Mon YYYY>`
   - subject: `<Event name> on <Weekday D Month>`
   - preheader: one line with the price and what the night is
   - `utmCampaign`: `<event-name-slug>-<YYYY-MM-DD>`
3. **Draft:** `marketing-campaigns.lintMarketingCampaignContent(content)`, then `marketing-campaigns.createMarketingCampaign({ name, subject, preheader, content, utmCampaign })`. A draft sends nothing.
4. **Test:** `marketing-campaigns.sendMarketingTestEmail(id)` sends it to Peter's own address only.
5. **Show Peter** the subject, preheader and send time, and point him at the test email. Wait for his yes.
6. **Schedule:** `marketing-campaigns.scheduleMarketingCampaign(id, { scheduledFor })`. Send 7 days before the event, on the same weekday: **09:00 London for a midweek event, 12:00 London for a Friday or Saturday one** (the pattern every event email has used; for a Sunday event, ask Peter). Write the offset out: `+00:00` from the last Sunday of October to the last Sunday of March, `+01:00` in British Summer Time. Example: Christmas Jackpot, Wednesday 16 December 2026, is `2026-12-09T09:00:00+00:00`.
7. **Check:** `marketing-campaigns.getMarketingCampaign(id)` shows `scheduled` at the right time.
8. **Tick** `schedule_event_email`.

The live campaign is the source of truth. Committing the JSON to the repository keeps a record but is optional. To change an email that is already scheduled, see "Changing a scheduled email" below.

## Part 5: Peter's tasks (social posts, stories, WhatsApp)

Peter does these himself (16 November 2026). Claude does not create, edit, approve or schedule anything in CheersAI, and does not draft or send WhatsApp messages unless he asks.

**Checking social posts and stories** (read only, CheersAI's Supabase project `nbkjciurhvkfpcpatbnt`):

```sql
select c.name, ci.platform, ci.placement, ci.status, count(*) as posts,
       min(ci.scheduled_for)::date as first_post, max(ci.scheduled_for)::date as last_post
from campaigns c
join content_items ci on ci.campaign_id = c.id
where c.name ilike '%<part of the event name>%'
group by 1, 2, 3, 4
order by 1, 2, 3;
```

`placement = 'feed'` rows are the posts and `placement = 'story'` rows are the stories. A task counts as done when Facebook and Instagram both have `scheduled` or `posted` rows for that placement. If they do, tick `schedule_social_content` and `schedule_stories`. If not, tell Peter what is missing.

**WhatsApp reminder:** tick `send_whatsapp_reminder` only when Peter says he has sent it.

## Changing a scheduled email

The app edits drafts only. To change a campaign that is scheduled but has not started, follow the steps in the auto-memory note `reference_edit_scheduled_campaign.md`: move it back to draft (a data fix that needs Peter's yes on the exact statement), `updateMarketingCampaign`, then `scheduleMarketingCampaign` again so every check reruns.

## Reporting back

End with the response contract's status block. For each event, give:

- each task done, with its proof (the Facebook event URL, a description of the Google post, the campaign name, id and send time);
- each task ticked;
- anything left for Peter, such as his CheersAI and WhatsApp tasks.
