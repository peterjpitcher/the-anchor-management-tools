# Event Marketing Links — Tiered On-Demand Redesign

**Date:** 2026-03-17
**Status:** Approved

---

## Problem

The current marketing links feature generates all 9 channels for every event, but most channels are only used for specific events or campaigns. This creates noise. Additionally, Meta Ads (paid social) is missing as a channel type, despite being used regularly.

---

## Goals

1. Add Meta Ads as a new always-on channel.
2. Distinguish always-on channels (generated for every event) from on-demand channels (generated only when needed).
3. Allow individual on-demand channels to be generated with a single button click.
4. Keep always-on links as the default view — clean and ready without manual action.

---

## Channel Tiers

The tables below show the full set of channels with their final config values. **Existing channels keep their current UTM values unchanged** — the only modification to existing entries is adding the `tier` property. Do not change any existing `utmSource`, `utmMedium`, or `utmContent` values.

### Always-on (auto-generated for every event)

| Channel | Key | `utmSource` | `utmMedium` | `utmContent` | `shortCodePrefix` |
|---|---|---|---|---|---|
| Facebook | `facebook` | `facebook` | `social` | `facebook_main` | `fb` |
| Instagram / lnk.bio | `lnk_bio` | `instagram` | `lnk.bio` | `instagram_bio` | `ig` |
| Google Business Profile | `google_business_profile` | `google` | `business_profile` | `google_post` | `gp` |
| Meta Ads *(new)* | `meta_ads` | `facebook` | `paid_social` | `meta_ads_main` | `ma` |

### On-demand digital (generated individually when needed)

| Channel | Key | `utmSource` | `utmMedium` | `utmContent` | `shortCodePrefix` |
|---|---|---|---|---|---|
| Newsletter | `newsletter` | `newsletter` | `email` | `newsletter_primary` | `nl` |
| SMS | `sms` | `sms` | `messaging` | `sms_blast` | `sm` |
| WhatsApp | `whatsapp` | `whatsapp` | `messaging` | `whatsapp_group` | `wa` |

### On-demand print (generated individually when needed)

| Channel | Key | `utmSource` | `utmMedium` | `utmContent` | `shortCodePrefix` |
|---|---|---|---|---|---|
| Poster QR | `poster` | `poster` | `print` | `poster_qr` | `po` |
| Table Talker QR | `table_talker` | `table_talker` | `print` | `table_talker_qr` | `tt` |
| Bar Strut QR | `bar_strut` | `bar_strut` | `print` | `bar_strut_qr` | `bs` |

---

## Data Model Changes

### `src/lib/event-marketing-links.ts`

**1. Add `'meta_ads'` to the `EventMarketingChannelKey` union type.**

**2. Add `tier` to the `EventMarketingChannelConfig` interface:**

```typescript
tier: 'always_on' | 'on_demand';
```

**3. Add `tier` to every existing channel entry** (values per the tables above).

**4. Add the new `meta_ads` entry** to `EVENT_MARKETING_CHANNELS`:

```typescript
{
  key: 'meta_ads',
  label: 'Meta Ads',
  type: 'digital',
  tier: 'always_on',
  description: 'Paid social — paste as the destination URL in Meta Ads Manager',
  utmSource: 'facebook',
  utmMedium: 'paid_social',
  utmContent: 'meta_ads_main',
  shortCodePrefix: 'ma',
},
```

No database schema changes required — `short_links` table is unchanged.

---

## Server Actions (`src/app/actions/event-marketing-links.ts`)

### `generateEventMarketingLinks(eventId)` — modified

- Generates/upserts **always-on channels only** (the 4 channels where `tier === 'always_on'`).
- Permission check and return shape unchanged.

### `regenerateEventMarketingLinks(eventId)` — unchanged

Remains a thin alias for `generateEventMarketingLinks`. After this change, both generate always-on channels only.

### `generateSingleMarketingLink(eventId, channel)` — new (add to this file)

```typescript
export async function generateSingleMarketingLink(
  eventId: string,
  channel: EventMarketingChannelKey
): Promise<{ success?: boolean; error?: string; link?: EventMarketingLink }>
```

- Requires `events:manage` permission (same pattern as existing actions).
- Validates that `channel` is `tier === 'on_demand'`. If an always-on channel key is passed, return `{ error: 'This channel is generated automatically' }`.
- Calls `EventMarketingService.generateSingleLink(eventId, channel)`.
- Returns `{ success: true, link }` on success.

### `getEventMarketingLinks(eventId)` — unchanged

Returns all existing links for the event regardless of tier. No change.

---

## Service Layer (`src/services/event-marketing.ts`)

### `generateLinks(eventId)` — modified

Filter the channel list to `tier === 'always_on'` before the generation loop. The final `getLinks(eventId)` call at the end is **unchanged** — it continues to return all short links for the event across all tiers, so any previously generated on-demand links are included in the response. On-demand links already in the database are untouched by this method.

### `generateSingleLink(eventId, channel)` — new

```
1. Look up the channel config from EVENT_MARKETING_CHANNEL_MAP.
2. Fetch the event (id, slug, name, date) from the database.
3. Build the link payload using the existing buildEventMarketingLinkPayload().
4. Upsert the short link using the same retry-on-collision loop already in generateLinks()
   (attempts 0..maxAttempts, buildShortCode with incrementing attempt index on collision).
5. If the channel type is 'print', generate a QR code inline:
     const qrCode = await QRCode.toDataURL(shortUrl, { margin: 1, scale: 8 })
6. Return the single EventMarketingLink object (same shape as getLinks() returns).
```

Do **not** call `getLinks()` — construct and return the single link directly to avoid fetching all links unnecessarily.

---

## Page Component (`src/app/(authenticated)/events/[id]/page.tsx`)

### Auto-generate always-on links on page load

After fetching marketing links, check whether all 4 always-on channels are present. If any are missing, call `generateEventMarketingLinks(eventId)` and re-fetch:

```typescript
const alwaysOnKeys = EVENT_MARKETING_CHANNELS
  .filter(c => c.tier === 'always_on')
  .map(c => c.key)

const existingKeys = marketingLinks.map(l => l.channel)
const missingAlwaysOn = alwaysOnKeys.some(k => !existingKeys.includes(k))

if (missingAlwaysOn) {
  await generateEventMarketingLinks(eventId)
  marketingLinks = await getEventMarketingLinks(eventId) // re-fetch
}
```

This keeps auto-generation server-side and avoids a client-side useEffect for this case. Note: `'use server'` functions are callable from server components in Next.js App Router — the existing page already calls `getEventMarketingLinks(eventId)` this way.

---

## UI — `EventMarketingLinksCard`

### Component props

`EventMarketingLinksCard` already has `'use client'` — no change needed. The component:
- Imports `EVENT_MARKETING_CHANNELS` directly from `src/lib/event-marketing-links.ts`.
- Imports `generateSingleMarketingLink` directly from `src/app/actions/event-marketing-links`.
- Derives ghost cards by filtering `EVENT_MARKETING_CHANNELS` to on-demand channels whose key is absent from the `links` prop array.

### Per-channel loading state (new)

```typescript
const [generatingChannels, setGeneratingChannels] = useState<Set<EventMarketingChannelKey>>(new Set())
```

On Generate click: add channel key → call action → remove channel key (success or error).

### Section headings

| Section | Heading |
|---|---|
| Always-on digital | `Digital channels` (unchanged) |
| On-demand digital | `Optional digital channels` |
| Print assets | `Print assets` (unchanged) |

### Three sections

**1. Digital channels** (top) — Facebook, Lnk.bio, GBP, Meta Ads. Always populated. Shown as today.

**2. Optional digital channels** (middle) — Newsletter, SMS, WhatsApp. If link exists: shown as today. If not: ghost card.

**3. Print assets** (bottom) — Poster, Table Talker, Bar Strut. If link exists: QR code + download button as today. If not: ghost card.

### "Refresh links" button

Re-generates always-on channels only. Label and behaviour otherwise unchanged.

### Ghost card design

- Background: `bg-muted/40`, border: dashed.
- Channel label at full opacity.
- `description` from channel config at reduced opacity below the label.
- "Generate" button (secondary variant) right-aligned.
- When channel key is in `generatingChannels`: spinner replaces button, button disabled.

### Permissions

Users with only `events:view` permission can see ghost cards but cannot generate links (the server action will return a permission error). Ghost card Generate buttons are not hidden from viewers — the server-side permission check is the authoritative gate.

---

## Error Handling

- On success: ghost card transitions to live link card; `toast.success('Link generated')`.
- On error: toast with the server action's error message; ghost card restores to idle state.

---

## Out of Scope

- Removing/deleting on-demand links once generated.
- Bulk "generate all on-demand" option.
- Any changes to QR code generation quality or format.
- Changes to the `EventPromotionContentCard` AI content generator.
