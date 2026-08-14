# B2B marketing email: as built

Date: 2026-08-13
Supersedes: `marketing-email-b2b-implementation-plan-2026-08-13.md` (the pre-review plan)
Companion: `marketing-email-b2b-review-resolution-2026-08-13.md` (how each review finding was answered)

This describes the system that exists, how to use it, and what to do when it misbehaves.

## The shape of it

Marketing email for business contacts, kept entirely separate from the consumer `customers`
table. Campaign content is block JSON authored outside the UI. A cron sends in small batches
through the existing `sendEmail` service with Resend forced. Engagement comes back through the
existing Resend webhook onto `email_messages`, which the campaign stats join against.

```
content JSON (authored by Claude)
   |
   v
marketing_campaigns  --schedule-->  status=scheduled, content frozen, hash stored
   |
   | cron every 5 min: promote_due_marketing_campaigns()
   v
marketing_campaign_recipients  (audience snapshot, one row per contact)
   |
   | cron: claim_marketing_recipients() locks the CONTACT row
   v
renderMarketingEmail() --> sendEmail(provider: resend) --> finalise_marketing_send()
   |
   v
email_messages  <-- Resend webhook --> delivered/opened/clicked/bounced/complained
```

## Safety properties, and what enforces each

These are the things that must not break. Each is enforced in the database rather than in
application code, so a future code path cannot route around them.

| Property | Enforced by |
|---|---|
| Nothing sends while the kill switch is off | `claim_marketing_recipients` returns zero rows unless `marketing_settings.sends_enabled` |
| Nothing sends outside the send window | `marketing_send_window_open()`, checked in both promote and claim |
| No contact gets two marketing emails inside the cap | Contact row locked `FOR UPDATE SKIP LOCKED` and `marketing_reserved_until` set, inside the claim transaction |
| Nobody who objected is ever contacted again | `marketing_do_not_contact`, checked at import, snapshot and claim; survives erasure |
| Nobody is sent to before a human approves them | `eligibility_status` defaults to `pending_review`; CHECK forces basis and reviewer before `eligible` |
| An unsubscribe never blocks booking confirmations | The unsubscribe route is forbidden from writing `email_suppressions` |
| A send is never duplicated | Resend idempotency key per campaign+contact, plus lease recovery that finishes rather than resends when a log row exists |
| A suppression-list outage cannot cause a bad send | `suppressionMode: 'fail_closed'` on marketing sends only |

## Authoring and sending a campaign

1. **Write the content.** A JSON file matching `marketingContentSchema`: `title`, `preheader`,
   and an ordered `blocks` array. `src/lib/email/marketing/campaigns/christmas-and-lunch-2026.json`
   is a complete worked example (the finished Christmas email, 14 blocks). The 26 available
   blocks and their slots are in `src/lib/email/marketing/registry.ts`; the design intent for
   each is in `docs/design/email-handover/README.md`.
2. **Create the campaign** in `/marketing/campaigns/new`: name, subject, preheader, paste the
   JSON, pick audience tags, check the live recipient count.
3. **Test send** to yourself from the campaign detail page. Check it in Outlook on Windows,
   Gmail web, Gmail Android, Apple Mail iOS in dark mode, and Outlook.com. That matrix is the
   designer's and it matters: Outlook is the one that breaks things.
4. **Schedule.** Scheduling freezes the campaign: content, subject, audience and UTM can no
   longer change. Editing means going back to a draft.
5. The cron promotes it when due and inside the send window, snapshots the audience, and sends
   in batches of 25 every five minutes.

## Running it day to day

**The kill switch** is `/marketing/settings`. Turning it off stops all campaign sending within
one batch. It ships OFF and must be turned on deliberately.

**Pause** on a single campaign stops that campaign only. The guarantee: after a pause commits,
at most the already-claimed batch can still go out, because claiming re-reads campaign status
inside the locking function.

**Eligibility review** is the gate on the contact list. A contact sitting at `pending_review`
is invisible to every audience. The Contacts page shows how many are waiting.

### When something looks wrong

| Symptom | Where to look |
|---|---|
| Campaign scheduled but nothing sending | Kill switch off, outside the send window, or `RESEND_API_KEY` / `MARKETING_EMAIL_FROM_ADDRESS` unset. The cron response says which |
| Recipients stuck `skipped` | `skip_reason` on the row: `not_eligible`, `unsubscribed`, `do_not_contact`, `frequency_cap`, `suppressed`, `campaign_cancelled` |
| Rows in `needs_review` | The provider accepted the email but the local log row was not written, or a lease expired past the provider's 24-hour idempotency window. These are deliberately NOT retried automatically, because retrying could send a second copy. Decide per row |
| Stats look low | Open tracking is off by design (see below). Delivered and clicked are real; opened will be zero |
| A bounce did not update a contact | Check `email_webhook_unmatched` for parked events |

## How engagement and conversion are measured

The chain from an email to a booking is first-party end to end, and most of it already
existed before this feature.

```
email link
  -> l.the-anchor.pub short link  (one per campaign destination, utm_source/medium/campaign
     baked into the destination, utm_content=<recipient id> added per recipient)
  -> redirect handler             writes short_link_clicks, now including utm_content
  -> the-anchor.pub               captures utm_* and short_code into first-party storage
  -> booking or enquiry           website forwards the attribution to AMS
  -> analytics_events.metadata    carries utm_campaign, utm_content, short_code
```

So:

- **Clicks per campaign** come from `short_link_clicks` joined through `short_links.metadata`.
- **Clicks per contact** come from `short_link_clicks.utm_content`, which holds the
  `marketing_campaign_recipients` id. The redirect already forwarded that value to the
  website; it simply was not being stored on the click until now.
- **Conversions** come from `analytics_events` where `metadata->>'utm_campaign'` matches the
  campaign. That path was already live: real bookings carry it today.

Bots are excluded from click counts (`device_type <> 'bot'`).

## Open tracking is deliberately off

Resend configures open and click tracking per domain, and marketing sends from
`noreply@auth.orangejelly.co.uk`, which also carries transactional and authentication email.
Enabling tracking there would have changed the behaviour of that mail too, including rewriting
links in authentication emails. So the feature does not depend on it. Clicks are measured with
our own short links instead.

This is not a theoretical risk. In the ninety days to 2026-08-14, 937 of 1,108 outbound
emails went through Resend on that domain, including booking confirmations. Turning tracking
on would have started rewriting links inside all of them.

To get open tracking later, set up a dedicated marketing subdomain (for example
`news.the-anchor.pub`), verify it in Resend with tracking enabled, and point
`MARKETING_EMAIL_FROM_ADDRESS` at it. Nothing else needs to change: no code, no schema. It is
a DNS job plus one environment variable.

## Rendering, and why the fidelity tests are strict

The designer's handover is production email markup: nested tables, inlined styles, MSO
conditionals. It is not a design to reinterpret, it is the artefact to preserve. So rendering
is split in two:

- `renderCampaignHtml` is pure. Same content in, same bytes out. `campaign.fidelity.test.ts`
  asserts it reproduces the designer's 21KB file **byte for byte** from 14 independent block
  modules through the shell.
- `applyDeliveryTransforms` then makes it sendable (unsubscribe URL, short links, UTM). Those
  changes are asserted separately as an allow-listed diff.

If a fidelity test fails, something was reformatted. Do not update the fixture to match the
code; fix the code, or re-run the extraction script if the designer genuinely shipped new files.

Two things to know about the handover itself:

1. The library file wraps each block in its own 600px table so blocks preview standalone; the
   campaign file puts every block as a `<tr>` inside one table. That is an inconsistency in the
   handover, not a decision. The composer strips the preview wrapper, and the strip is proven
   lossless.
2. `lib_pull_quote.html` contains the `note_bar` strip bundled inside it, which is why
   `note_bar` appears in the catalogue with no fixture of its own. Ask the designer to split
   them; until then a `pull_quote` carries placeholder notice copy and should not be used.

## Live state as at 2026-08-13

Deployed to production (main `b6d3a86c`, then `67c60a98`). The feature is live and inert:

| | |
|---|---|
| Kill switch (`marketing_settings.sends_enabled`) | **off** |
| `MARKETING_EMAIL_FROM_ADDRESS` in Vercel | **not set**, so the cron returns `not_configured` and does nothing |
| Contacts loaded | 160, **all `pending_review`**, 5 flagged as free-mail for review |
| Contacts eligible to receive anything | **0** |
| Campaigns | 0 |

Three independent things therefore have to change before a single email can go out:
the address must be configured, contacts must be marked eligible by a person, and the
kill switch must be turned on. That is deliberate.

Verified in production after deploy: `/marketing`, `/marketing/contacts` and
`/marketing/settings` redirect to login; `/api/cron/marketing-campaigns` returns 401 without
the cron secret; `/api/unsubscribe` serves its confirmation page. `anon` and `authenticated`
hold no privileges on any new table or function.

To undo the contact import: `DELETE FROM business_contacts;` (nothing references them yet).

## Known gaps

- **Concurrency is not proven in CI.** Row locking, `SKIP LOCKED`, the cross-campaign frequency
  race, RLS enforcement and crash-and-restart around the provider call cannot be tested here:
  this repository mocks Supabase and has no integration database. The logic is in SQL so the
  database enforces it, but that is an argument, not a test.
- **Short-link provisioning is not wired.** `link_map` exists and the renderer consumes it, but
  campaigns currently schedule with an empty map, so links are UTM-tagged rather than shortened.
  Clicks are still measured by Resend; only the short-link view is missing.
- `note_bar` is unavailable pending the designer re-export.
- The two campaign photographs are not hosted, so the Christmas email renders its placeholder
  panels.
