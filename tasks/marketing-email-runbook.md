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
