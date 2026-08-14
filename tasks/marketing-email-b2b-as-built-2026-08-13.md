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
| Opens look implausibly high | Apple Mail Privacy Protection and Gmail's image proxy fetch the tracking pixel whether or not a human looked. Treat opens as approximate and judge engagement on clicks |
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

## Open tracking, and the domain it depends on

Enabled on 2026-08-14 at the owner's instruction, after checking the actual state rather than
assuming it. The sending domain `auth.orangejelly.co.uk` already had CLICK tracking switched
on and verified, so links in every email from it were already being rewritten. Only OPEN
tracking was off; it is now on.

Know what that means before changing it back or forward:

- That domain also carries transactional and authentication email. In the ninety days to
  2026-08-14, 937 of 1,108 outbound emails went through it, booking confirmations included.
  Anything toggled here affects all of them, because Resend configures tracking per DOMAIN,
  not per message.
- Opens are a weak signal. Apple Mail Privacy Protection and Gmail's image proxy fetch the
  pixel whether or not anybody looked, so open rates run high. Clicks are the honest number,
  which is why the first-party short-link measurement below is kept as well.

To separate marketing reputation and tracking from transactional mail later, verify a
dedicated subdomain (for example `news.the-anchor.pub`) in Resend and point
`MARKETING_EMAIL_FROM_ADDRESS` at it. No code or schema changes: a DNS job and one variable.

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

## Deliberate deviations from the handover

What we send differs from the designer's file in exactly two places. Both are applied to the
**fixture** before the byte-for-byte comparison, in `__tests__/goldContrast.ts` and in the
footer override in `campaign.fidelity.test.ts`, so each change is explicitly permitted and any
third difference still fails the test. Do not widen those substitutions to make a failure go
away, and do not "fix" either of these back.

### 1. White text on gold, with a darker gold behind it

The owner asked for white text on any gold background. The handover says the opposite in as
many words, that charcoal on gold is deliberate because "white on gold fails contrast", and on
the golds the designer used that is measurably correct:

| gold | white text | charcoal text |
|---|---|---|
| `#a57626` (button and deadline-bar fill) | 4.02:1, large text only | 4.33:1, large text only |
| `#c9a020` (bright gold on the dark panels) | **2.46:1, fails** | 7.07:1, passes |
| `#8b6914` (Gold dark, already in the palette) | **5.09:1, passes AA** | 3.42:1 |

The instruction can only be met legibly by darkening the fill, so every gold surface that
carries text now uses `#8b6914` with `#ffffff`. `#8b6914` is not a new colour: the handover
already documents it as the gold that passes AA, and it is what the gold kicker text on cream
has always been. Five surfaces changed:

| Block | Surface | Fill before | Fill after | Text before | Text after |
|---|---|---|---|---|---|
| `deadline_bar` | the whole strip, and its inline link | `#a57626` | `#8b6914` | `#1a1a1a` | `#ffffff` |
| `hero_image` | primary button | `#a57626` | `#8b6914` | `#1a1a1a` | `#ffffff` |
| `text_block` | primary button | `#a57626` | `#8b6914` | `#1a1a1a` | `#ffffff` |
| `hero_framed` | button on the green field | `#c9a020` | `#8b6914` | `#1a1a1a` | `#ffffff` |
| `closing_panel_dark` | button on the dark panel | `#c9a020` | `#8b6914` | `#1a1a1a` | `#ffffff` |

The deadline bar's link keeps its underline, because on a solid fill the underline is the only
thing still marking it as a link once it is the same colour as the sentence around it.

Gold used as anything other than a fill behind text is untouched and must stay that way: the
3px card top borders, the dashed offer rule, the left rule on `note_bar`, the hairlines, the
star glyphs in `review`, the bullet glyphs, the gold kicker text on cream, and the `#c9a020`
script lines, ticks and links on the dark panels. None of those is text on gold, and several
of them fail if moved.

`findCharcoalOnGold` in the same helper enforces this from the other direction: it fails the
suite if any gold fill reappears in one of the designer's lighter golds, or if charcoal shows
up on a gold fill again. That is what stops a future edit quietly undoing this.

### 2. Footer reason-for-contact copy

The designer's footer line claims every recipient enquired about a booking with us. Most of a
prospecting list has not, so the shipped copy says more than the original. The fidelity test
compares using the designer's own value, which lets the shipped wording move independently
without weakening the check that the renderer reproduces the markup.

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
