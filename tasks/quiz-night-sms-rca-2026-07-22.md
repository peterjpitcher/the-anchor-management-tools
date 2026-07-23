# Quiz Night 22 July 2026: why the "book seats" texts did not go out

Root cause analysis, written 22 July 2026. All figures come from live production queries and the
deployed code on `main`. Read only, nothing was changed.

---

## The answer in one paragraph

The invite system blocks any customer who has had **any** promotional text in the previous **7 days**,
no matter which event it was for. Music Bingo's invites went out on 10 July. Quiz Night's invites were
sent on 15 July, only 5 days later. So almost everyone who was invited to Music Bingo was still inside
that 7 day blackout and was silently skipped. Quiz Night reached **3 people instead of 13**. Because each
event gets exactly one invite day and never retries, those 10 people were never contacted about Quiz
Night at all, not on 15 July and not at any point before the event.

The venue runs events roughly every 5 to 7 days. The blackout is 7 days. That means, structurally, every
second event cannibalises the next one's audience.

---

## The numbers

Reconstructed by replaying the live database function `get_cross_promo_audience` against production at
the exact moment each invite run fired. The model reproduces the Cash Bingo run exactly (7 predicted,
7 actually sent), so it is trustworthy.

| Event | Invite run | Reachable and not already booked | Blocked by the 7 day blackout | Actually invited |
|---|---|---|---|---|
| Music Bingo, 17 Jul (the one that worked) | 9 Jul 23:00 UTC | 13 | 0 | 12 |
| **Quiz Night, 22 Jul (the failure)** | **14 Jul 23:01 UTC** | **14** | **10** | **3** |
| Cash Bingo, 29 Jul (already run) | 21 Jul 23:00 UTC | 15 | 8 | 7 |

Quiz Night detail:

- 3 invited: Mandy Jones, Colin Saterlay, Claire Honey. They were the only three with no promo text in
  the previous 7 days.
- 10 blocked by the blackout: Stephanie Wills, Caz Westnott, Lorraine, Luke Phillips, Margaret Parsons,
  Adam Brassington, Amrit, Lauren Harding, Lou Kitchener, Rupi. Every one of them was blocked by a
  Music Bingo promo row dated 9 July.
- 1 correctly excluded: Penny Gibbons had already booked Quiz Night on 4 June.
- 1 edge case: Julie Linnett was not opted in to marketing texts until she booked on 15 July at 12:45,
  after the run. She was not eligible at the time.

So **13 people should have been invited, 3 were**. That is a 77 percent loss.

The same starvation then carried into the day before reminder. The 21 July "Quiz Night is tomorrow"
text can only go to people who received the 15 July invite, so it also reached exactly those same 3.
Music Bingo, by comparison, sent 12 invites and then 11 reminders.

### The wider ceiling (important context)

Even with the blackout removed, this programme is small:

- 967 customers on file
- 353 have full consent (marketing SMS opt in, SMS opt in, active status, valid mobile)
- **70** of those have ever booked and attended a ticketed event
- **21** have attended one in the last 90 days

The invite audience is built **only** from past event bookings. Table bookings, walk in visits and
general custom are not used. So a regular who drinks in the pub every week but has never booked a seat
at a quiz or bingo night will never receive one of these invites, no matter what we change about the
blackout. If some of the people who complained fall into that group, the blackout fix alone will not
reach them.

---

## Primary root cause

**A global, event agnostic 7 day promotional blackout per customer, colliding with a weekly event
calendar.**

The database function `public.get_cross_promo_audience` contains this rule, twice (once for the
category audience and once for the general audience):

```
NOT EXISTS (
  SELECT 1 FROM sms_promo_context spc
  WHERE spc.customer_id = c.id
    AND spc.created_at > (NOW() - (p_frequency_cap_days * INTERVAL '1 day'))
)
```

There is no event filter and no category filter on it. Any promo text about any event silences the
customer for the next 7 days. The value 7 comes from `src/lib/sms/cross-promo.ts:21`
(`EVENT_PROMO_FREQUENCY_CAP_DAYS`, default 7) and is passed in at `src/lib/sms/cross-promo.ts:315`.
Source of the SQL: `supabase/migrations/20260615000003_rework_event_promo_sms_policy.sql`, lines 137
and 175. I confirmed the deployed function in production matches the migration exactly.

This is the only variable that separates the event that worked from the event that failed. Music Bingo's
invite run on 9 July was 10 days after the previous promo batch (29 June), so the blackout was empty and
it lost nobody. Quiz Night's run was 5 days after Music Bingo's, so it lost 10 of 13.

---

## Contributing causes, ranked by how much volume they explain

**1. One invite day per event, with no retry (explains why the loss was permanent, not just delayed)**

`loadUpcomingEventsForPromo` in `src/app/api/cron/event-guest-engagement/route.ts:1840` and `:1848` uses
an exact date match, `.eq('date', introDate)` where `introDate` is today plus 7 days. Each event
therefore has exactly one calendar day on which it can ever send an invite. Quiz Night's was 15 July.
Without this, the blackout would only have delayed the invite; with it, the invite was lost for good.

Honest caveat: fixing this alone would have recovered only about **1 extra person**, because the day
after invites, Music Bingo's own reminder texts (16 July) wrote fresh blackout rows for 11 of the 12,
extending their blackout past the Quiz Night date. It is a real robustness gap but it is not where the
volume is.

**2. Reminder texts re-arm the blackout for the next event**

The day before reminder also writes a `sms_promo_context` row (`src/lib/sms/cross-promo.ts` around line
558). So each event fires two blackout triggers, not one. This is exactly what hit Cash Bingo: 6 of the
8 customers blocked from its 22 July invite were blocked by Music Bingo's **reminder** on 15 July, not
its invite. It roughly doubles the collision rate.

**3. The day before reminder can only re-contact the invite cohort**

`get_follow_up_recipients` reads only from `promo_sequence`, which is written when an invite is
successfully sent. So a starved invite guarantees a starved reminder, with no second chance. Worth
about 1 extra recipient if fixed on its own, but it means every invite failure is automatically doubled.

**4. The audience is built only from past event bookers, with tight recency windows**

Category audience: attended the same category in the last 90 days. General audience: attended anything
in the last 42 days. That is what caps the whole programme at roughly 13 to 15 people per event out of
353 consented customers. It is not what made Quiz Night different from Music Bingo (Quiz Night actually
had the larger pool), but it is the reason the absolute numbers are so small and why many "regulars"
never hear from us.

**5. The marketing consent gate**

Both audiences require `marketing_sms_opt_in = TRUE`. Three to five otherwise contactable people are
excluded per run by this. It is working as designed and should not be changed. It is symmetric across
both events, so it is not a cause of this incident, just a ceiling on reach.

### Things checked and ruled out

These were investigated and are **not** causes. Do not chase them.

- The cron job is healthy and ran on time on every relevant day.
- No cap or budget was ever close to being hit (peak was 12 sends in an hour against a limit of 30).
- The 22 July 08:00 batch that went to Cash Bingo customers was correct behaviour. 22 July was Cash
  Bingo's invite day (7 days before 29 July). Quiz Night had no scheduled touch that day.
- No bulk opt out, deactivation or consent wipe happened.
- No promo text failed to deliver. Every "Reply with seats" message sent since 1 July is marked
  delivered.
- Phone number formatting problems exist for about 24 customers, but none of them were in the Quiz
  Night audience.

---

## Is this a new regression?

**Partly yes.** Commit `b3011ed4` "Tighten promotional SMS policy", 7 June 2026 20:15, on `main`, made
two changes that set this up:

1. Replaced a rolling 14 day lookahead window (`.gte('date', today).lte('date', today+14)`) with the
   single exact day match `.eq('date', introDate)`. Before this change, an event that was starved on one
   day got roughly 14 further daily attempts to catch people as they came out of blackout. After it,
   there is exactly one attempt.
2. Narrowed the audience recency windows from 6 months and 3 months down to 90 days and 42 days.

The 7 day blackout itself is older; `b3011ed4` only moved it from a hardcoded value into an environment
variable.

**Why it only surfaced now:** the fault needs two promo enabled events fewer than 7 days apart. The
previous pairing was Cash Bingo on 1 July and Music Bingo on 17 July, 16 days apart, so nothing was
suppressed. Music Bingo 17 July and Quiz Night 22 July, 5 days apart, is the first tight pairing since
the June change. So the bug has been live for 6 weeks and 22 July was the first event to hit it.

---

## Will it happen again?

**Yes, and it has already happened once more.**

- **Cash Bingo, Wed 29 July.** Its invite already went out on 22 July to 7 people. 8 more were blocked.
  Its reminder on 28 July will reach the same 7 and no one else. Nothing can be done for this event now
  short of a manual send.
- **Music Bingo, Fri 14 August** (invite day 7 August). This one should be fine. The gap back to the
  Cash Bingo cycle is large enough that the blackout will have cleared.
- **Quiz Night, Wed 19 August** (invite day 12 August). **This will fail the same way.** 12 August is
  5 days after Music Bingo's 7 August invite run, exactly the same collision as 22 July.
- **Only Fools and Horses Quiz, Fri 25 September** (invite day 18 September), colliding with Quiz Night
  16 September's reminder on 15 September. Same pattern.
- **Cash Bingo, Wed 30 September** (invite day 23 September), colliding with the 18 September invite run.

In short: any event whose invite day falls within 7 days of the previous event's invite **or** reminder
will be starved. On the current calendar that is most of them.

Two separate calendar problems will also silently stop invites entirely:

- Four future Music Bingo events (11 Sep, 16 Oct, 13 Nov, 11 Dec) have **no category set**. The invite
  query requires a category, so these will get no invites at all.
- Every future event is still marked **draft**. The invite query requires status `scheduled`. If an
  event is still draft on its invite day, it gets no invite ever. Quiz Night on 19 August must be set
  to scheduled before 12 August.

---

## Proposed fixes, ranked by impact per effort

Nothing below has been implemented.

### 1. Shorten the blackout (highest impact, near zero effort)

- **Where:** environment variable `EVENT_PROMO_FREQUENCY_CAP_DAYS` in Vercel. Read at
  `src/lib/sms/cross-promo.ts:21`, default 7.
- **Change:** set it to `4`.
- **Why it works:** the collisions are all at 5 or 6 day gaps. Anything of 5 or less would have let all
  13 Quiz Night customers through. 4 gives a small safety margin.
- **Risk:** low but real. A customer in every audience could then receive up to about 4 promo texts in
  a fortnight during a busy run of events. That is a policy call for the owner, not a technical one.
- **Effort:** minutes. No deploy, no code change, takes effect on the next cron run.
- **Reversible:** immediately, by changing the value back.

### 2. Let each event retry its invite every day from 7 days out down to 2 days out

- **Where:** `loadUpcomingEventsForPromo`, `src/app/api/cron/event-guest-engagement/route.ts:1837` to
  `:1858`.
- **Change:** replace `.eq('date', introDate)` with a range, from today plus 2 through today plus 7.
- **Why it is safe:** the database function already refuses to send a second invite to the same person
  for the same event, so nobody can be double texted. It only picks up people whose blackout has since
  expired.
- **Risk:** low. It slightly increases how many events each run considers, which is well within the
  existing budget of 30 sends per run.
- **Effort:** small, roughly a one line change plus a test.

### 3. Replace the blunt blackout with a count based limit

- **Where:** new migration recreating `public.get_cross_promo_audience` (current source:
  `supabase/migrations/20260615000003_rework_event_promo_sms_policy.sql`).
- **Change:** instead of "no promo in the last N days", use "no more than 2 promo texts in the last 14
  days". This lets each event's own two touches land without one event locking out the next.
- **Why:** it expresses the actual policy the owner cares about, which is total volume per customer, not
  minimum spacing.
- **Risk:** medium. It is a production database function used by a live cron. Needs the usual migration
  review and should be shipped after fix 1 has proved the direction is right.
- **Effort:** medium, half a day including testing.

### 4. Let the day before reminder re-query the audience

- **Where:** `processFollowUps` in `src/app/api/cron/event-guest-engagement/route.ts:1887` onwards, and
  the database function `get_follow_up_recipients`.
- **Change:** allow the reminder stage to include people who are eligible now, not only people who
  received the invite.
- **Why:** it removes the "one bad day dooms the whole campaign" property.
- **Risk:** medium. It changes who receives a "tomorrow" text, so it needs care to avoid texting someone
  about an event they have never heard of, one day before it.
- **Effort:** medium.

### 5. Alert when an audience collapses

- **Where:** `sendCrossPromoForEvent` in `src/lib/sms/cross-promo.ts` around line 330. Today it only
  logs when the audience is completely empty, so "3 out of a possible 13" looked healthy.
- **Change:** log and alert when the number blocked by the blackout exceeds, say, half the pool.
- **Why:** this failure was invisible for a week. The cron reported success.
- **Risk:** none, it is observability only.
- **Effort:** small.

### 6. Widen the audience beyond past event bookers (bigger piece of work)

- **Where:** `get_cross_promo_audience`, the `valid_attendance` block.
- **Change:** include recent table booking customers, and optionally anyone with recent contact, not just
  people who have booked an event seat.
- **Why:** this is the only change that reaches the "regulars who drink here but have never booked a
  quiz" group. Today the theoretical maximum audience is about 21 people.
- **Risk:** high on volume and on tone. It changes who gets marketed to, so it needs the owner's explicit
  sign off first.
- **Effort:** large. Treat as a separate project, not part of this fix.

**Recommended order:** 1 now, then 2 and 5 together in one small change, then 3, then 4. Treat 6 as a
separate decision.

---

## What the owner needs to decide or do

1. **Set the environment variable.** In Vercel, set `EVENT_PROMO_FREQUENCY_CAP_DAYS` to `4` on the
   production project. Recommended, because it is the single change that would have prevented this and
   it can be undone instantly.
2. **Confirm the messaging policy.** How often is it acceptable to text the same customer about events?
   The current answer, baked into the code, is once every 7 days maximum. My recommendation is a
   maximum of 2 promotional texts per customer per fortnight, which is what fix 3 would enforce.
3. **Decide about Cash Bingo on 29 July.** Its invites have already gone out to only 7 people and 8 more
   were blocked. If you want those 8 contacted, it has to be a manual send. Tell me and I will prepare
   the list, but I will not send anything without a clear yes.
4. **Set the future events to scheduled in good time.** Every event after 29 July is still draft.
   An event that is still draft on its invite day gets no invite, ever. Quiz Night on 19 August needs to
   be scheduled before 12 August.
5. **Set a category on the four Music Bingo events** dated 11 Sep, 16 Oct, 13 Nov and 11 Dec. Without a
   category they are skipped by the invite system entirely.
6. **Decide on widening the audience** (fix 6). Today only 70 of 967 customers have ever booked an event
   seat, and only 21 in the last 90 days. If the complaint came from people outside that group, no
   amount of blackout tuning will reach them.
