# Event Marketing Links Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Meta Ads as a new always-on channel, introduce a `tier` system distinguishing always-on from on-demand channels, and update the UI to show ghost cards with individual Generate buttons for on-demand channels.

**Architecture:** Extend the channel config with a `tier` field, modify `generateLinks()` to only process always-on channels, add a new `generateSingleLink()` service method and `generateSingleMarketingLink()` server action, update the page to auto-generate missing always-on links server-side, and rework `EventMarketingLinksCard` into three sections with ghost cards for ungenererated on-demand channels.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Tailwind CSS v4, Supabase (admin client), `qrcode` npm package, Vitest

---

## File Map

| File | Change |
|---|---|
| `src/lib/event-marketing-links.ts` | Add `tier` to union, interface, and all 9 channel entries; add `meta_ads` entry |
| `src/services/event-marketing.ts` | Filter `generateLinks()` to always-on; add `generateSingleLink()` |
| `src/app/actions/event-marketing-links.ts` | Add `generateSingleMarketingLink()` action |
| `src/app/(authenticated)/events/[id]/page.tsx` | Auto-generate missing always-on links server-side |
| `src/components/features/events/EventMarketingLinksCard.tsx` | Three-section layout with ghost cards and per-channel generate |
| `src/services/event-marketing.test.ts` | New test file covering both service methods |

---

## Task 1: Extend the channel config

**Files:**
- Modify: `src/lib/event-marketing-links.ts`

- [ ] **Step 1: Add `'meta_ads'` to the `EventMarketingChannelKey` union**

In `src/lib/event-marketing-links.ts`, update the union type:

```typescript
export type EventMarketingChannelKey =
  | 'facebook'
  | 'lnk_bio'
  | 'google_business_profile'
  | 'newsletter'
  | 'sms'
  | 'whatsapp'
  | 'poster'
  | 'table_talker'
  | 'bar_strut'
  | 'meta_ads'
```

- [ ] **Step 2: Add `tier` to `EventMarketingChannelConfig`**

```typescript
export interface EventMarketingChannelConfig {
  key: EventMarketingChannelKey
  label: string
  type: EventMarketingChannelType
  tier: 'always_on' | 'on_demand'   // ← add this line
  description?: string
  utmSource: string
  utmMedium: string
  utmContent?: string
  shortCodePrefix: string
}
```

- [ ] **Step 3: Add `tier` to every existing channel entry**

Add `tier: 'always_on'` to: `facebook`, `lnk_bio`, `google_business_profile`.
Add `tier: 'on_demand'` to: `newsletter`, `sms`, `whatsapp`, `poster`, `table_talker`, `bar_strut`.

Do NOT change any other fields on existing entries.

- [ ] **Step 4: Add the `meta_ads` entry** at position 4 (after `google_business_profile`, before `newsletter`):

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

- [ ] **Step 5: Verify TypeScript compiles with no errors**

```bash
cd /Users/peterpitcher/Cursor/OJ-AnchorManagementTools
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors related to `event-marketing-links.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/event-marketing-links.ts
git commit -m "feat: add tier to channel config and add meta_ads channel"
```

---

## Task 2: Write tests for the service layer

**Files:**
- Create: `src/services/event-marketing.test.ts`

- [ ] **Step 1: Write failing tests for `generateLinks` (always-on only)**

Create `src/services/event-marketing.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock admin client
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

// Mock qrcode
vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,mock') },
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { EventMarketingService } from './event-marketing'
import { EVENT_MARKETING_CHANNELS } from '@/lib/event-marketing-links'

const mockEvent = {
  id: 'evt-123456',
  slug: 'test-event',
  name: 'Test Event',
  date: '2026-04-01',
}

function makeSupabaseMock(overrides: Record<string, unknown> = {}) {
  const chainable = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: mockEvent, error: null }),
    contains: vi.fn().mockResolvedValue({ data: [], error: null }),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    from: vi.fn().mockReturnThis(),
    ...overrides,
  }
  chainable.from = vi.fn().mockReturnValue(chainable)
  return chainable
}

describe('EventMarketingService.generateLinks', () => {
  beforeEach(() => vi.clearAllMocks())

  it('meta_ads channel has correct UTM config', () => {
    const metaAds = EVENT_MARKETING_CHANNELS.find(c => c.key === 'meta_ads')
    expect(metaAds).toBeDefined()
    expect(metaAds!.utmSource).toBe('facebook')
    expect(metaAds!.utmMedium).toBe('paid_social')
    expect(metaAds!.utmContent).toBe('meta_ads_main')
    expect(metaAds!.shortCodePrefix).toBe('ma')
    expect(metaAds!.tier).toBe('always_on')
  })

  it('only upserts always_on channels — does not touch on_demand channels', async () => {
    // Track which channels are inserted
    const insertedChannels: string[] = []

    const supabaseMock = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: mockEvent, error: null }),
      contains: vi.fn().mockResolvedValue({ data: [], error: null }), // no existing links
      insert: vi.fn().mockImplementation((_row: any) => {
        insertedChannels.push(_row?.metadata?.channel ?? _row?.short_code)
        return {
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { id: 'sl-x', short_code: 'xx123456', destination_url: 'https://x', metadata: {}, updated_at: null },
            error: null,
          }),
        }
      }),
      update: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    }
    vi.mocked(createAdminClient).mockReturnValue(supabaseMock as any)

    await EventMarketingService.generateLinks(mockEvent.id)

    const alwaysOnKeys = EVENT_MARKETING_CHANNELS.filter(c => c.tier === 'always_on').map(c => c.key)
    const onDemandKeys = EVENT_MARKETING_CHANNELS.filter(c => c.tier === 'on_demand').map(c => c.key)

    // Should have attempted to insert exactly the always-on channels
    expect(supabaseMock.insert).toHaveBeenCalledTimes(alwaysOnKeys.length)
    // Should NOT have inserted any on-demand channels
    onDemandKeys.forEach(key => {
      expect(supabaseMock.insert).not.toHaveBeenCalledWith(
        expect.objectContaining({ metadata: expect.objectContaining({ channel: key }) })
      )
    })
  })
})

describe('EventMarketingService.generateSingleLink', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns a link for a valid on_demand channel', async () => {
    const supabaseMock = makeSupabaseMock({
      single: vi.fn()
        .mockResolvedValueOnce({ data: mockEvent, error: null })  // event fetch
        .mockResolvedValueOnce({                                    // insert
          data: {
            id: 'sl-1',
            short_code: 'nl123456',
            destination_url: 'https://www.the-anchor.pub/events/test-event?utm_source=newsletter',
            metadata: { event_id: mockEvent.id, channel: 'newsletter', utm: {} },
            updated_at: null,
          },
          error: null,
        }),
    })
    vi.mocked(createAdminClient).mockReturnValue(supabaseMock as any)

    const result = await EventMarketingService.generateSingleLink(mockEvent.id, 'newsletter')

    expect(result.channel).toBe('newsletter')
    expect(result.shortCode).toMatch(/^nl/)
    expect(result.type).toBe('digital')
    expect(result.qrCode).toBeUndefined()  // digital — no QR
  })

  it('includes qrCode for print channels', async () => {
    const supabaseMock = makeSupabaseMock({
      single: vi.fn()
        .mockResolvedValueOnce({ data: mockEvent, error: null })
        .mockResolvedValueOnce({
          data: {
            id: 'sl-2',
            short_code: 'po123456',
            destination_url: 'https://www.the-anchor.pub/events/test-event?utm_source=poster',
            metadata: { event_id: mockEvent.id, channel: 'poster', utm: {} },
            updated_at: null,
          },
          error: null,
        }),
    })
    vi.mocked(createAdminClient).mockReturnValue(supabaseMock as any)

    const result = await EventMarketingService.generateSingleLink(mockEvent.id, 'poster')

    expect(result.channel).toBe('poster')
    expect(result.type).toBe('print')
    expect(result.qrCode).toBe('data:image/png;base64,mock')
  })

  it('throws if channel key does not exist in config', async () => {
    const supabaseMock = makeSupabaseMock()
    vi.mocked(createAdminClient).mockReturnValue(supabaseMock as any)

    await expect(
      EventMarketingService.generateSingleLink(mockEvent.id, 'unknown_channel' as any)
    ).rejects.toThrow()
  })

  it('throws if event is not found', async () => {
    const supabaseMock = makeSupabaseMock({
      single: vi.fn().mockResolvedValueOnce({ data: null, error: { message: 'not found' } }),
    })
    vi.mocked(createAdminClient).mockReturnValue(supabaseMock as any)

    await expect(
      EventMarketingService.generateSingleLink(mockEvent.id, 'newsletter')
    ).rejects.toThrow('Event not found')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail correctly**

```bash
cd /Users/peterpitcher/Cursor/OJ-AnchorManagementTools
npx vitest run src/services/event-marketing.test.ts 2>&1 | tail -20
```

Expected: config tests pass (tier/meta_ads already added in Task 1), `generateSingleLink` tests fail with "not a function".

---

## Task 3: Update the service layer

**Files:**
- Modify: `src/services/event-marketing.ts`

- [ ] **Step 1: Filter `generateLinks` to always-on channels only**

In `EventMarketingService.generateLinks`, find this line (line 134):
```typescript
for (const channel of EVENT_MARKETING_CHANNELS) {
```

Replace with:
```typescript
const alwaysOnChannels = EVENT_MARKETING_CHANNELS.filter(c => c.tier === 'always_on')
for (const channel of alwaysOnChannels) {
```

The `getLinks()` call at the end of `generateLinks` is unchanged — it still returns all tiers from the database.

- [ ] **Step 2: Add `generateSingleLink` to `EventMarketingService`**

Add after the closing brace of `getLinks`:

```typescript
static async generateSingleLink(
  eventId: string,
  channel: EventMarketingChannelKey
): Promise<EventMarketingLink> {
  const channelConfig = EVENT_MARKETING_CHANNEL_MAP.get(channel)
  if (!channelConfig) {
    throw new Error(`Unknown channel: ${channel}`)
  }

  const supabase = createAdminClient()

  const { data: event, error: eventError } = await supabase
    .from('events')
    .select('id, slug, name, date')
    .eq('id', eventId)
    .single()

  if (eventError || !event) {
    throw new Error('Event not found for marketing link generation')
  }

  if (!event.slug) {
    throw new Error('Event is missing a slug for marketing link generation')
  }

  const payload = buildEventMarketingLinkPayload(event, channelConfig)
  const metadata = buildMetadata(payload, event)

  const inserted = await insertShortLinkWithRetries(event, payload, metadata)
  const shortUrl = buildShortUrl(inserted.short_code)

  const link: EventMarketingLink = {
    id: inserted.id,
    channel: channelConfig.key,
    label: channelConfig.label,
    type: channelConfig.type,
    description: channelConfig.description,
    shortCode: inserted.short_code,
    shortUrl,
    destinationUrl: inserted.destination_url,
    utm: inserted.metadata?.utm || {},
    updatedAt: inserted.updated_at || undefined,
  }

  if (channelConfig.type === 'print') {
    try {
      link.qrCode = await QRCode.toDataURL(shortUrl, { margin: 1, scale: 8 })
    } catch (err) {
      console.error('Failed to generate QR for single link', channel, err)
    }
  }

  return link
}
```

- [ ] **Step 3: Run tests**

```bash
npx vitest run src/services/event-marketing.test.ts 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 4: Run typecheck**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/services/event-marketing.ts src/services/event-marketing.test.ts
git commit -m "feat: filter generateLinks to always-on channels; add generateSingleLink"
```

---

## Task 4: Add the `generateSingleMarketingLink` server action

**Files:**
- Modify: `src/app/actions/event-marketing-links.ts`

- [ ] **Step 1: Add the new action**

Append to `src/app/actions/event-marketing-links.ts`:

```typescript
export async function generateSingleMarketingLink(
  eventId: string,
  channel: EventMarketingChannelKey
): Promise<{ success?: boolean; error?: string; link?: EventMarketingLink }> {
  try {
    const canManageEvents = await checkUserPermission('events', 'manage')
    if (!canManageEvents) {
      return { error: 'Insufficient permissions to manage marketing links' }
    }

    const channelConfig = EVENT_MARKETING_CHANNELS.find(c => c.key === channel)
    if (!channelConfig || channelConfig.tier !== 'on_demand') {
      return { error: 'This channel is generated automatically' }
    }

    const link = await EventMarketingService.generateSingleLink(eventId, channel)
    return { success: true, link }
  } catch (error: any) {
    console.error('Unexpected error generating single marketing link', error)
    return { error: error.message || 'Unexpected error generating link' }
  }
}
```

Also add the required imports at the top if not already present:
```typescript
import { EVENT_MARKETING_CHANNELS, type EventMarketingChannelKey } from '@/lib/event-marketing-links'
```

- [ ] **Step 2: Run typecheck**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/actions/event-marketing-links.ts
git commit -m "feat: add generateSingleMarketingLink server action"
```

---

## Task 5: Auto-generate always-on links in the page component

**Files:**
- Modify: `src/app/(authenticated)/events/[id]/page.tsx`

- [ ] **Step 1: Import what's needed**

Add these imports at the top of the page file (alongside existing imports):

```typescript
import { generateEventMarketingLinks } from '@/app/actions/event-marketing-links'
import { EVENT_MARKETING_CHANNELS } from '@/lib/event-marketing-links'
```

- [ ] **Step 2: Add auto-generate logic after the parallel fetch**

The existing code at ~line 67 is:
```typescript
const marketingLinks = marketingLinksResult.success ? (marketingLinksResult.links || []) : []
```

Replace that `const` assignment with `let` and add the auto-generate check immediately after:

```typescript
let marketingLinks: EventMarketingLink[] = marketingLinksResult.success
  ? (marketingLinksResult.links || [])
  : []

const alwaysOnKeys = EVENT_MARKETING_CHANNELS
  .filter(c => c.tier === 'always_on')
  .map(c => c.key)

const existingKeys = marketingLinks.map(l => l.channel)
const missingAlwaysOn = alwaysOnKeys.some(k => !existingKeys.includes(k))

if (missingAlwaysOn) {
  await generateEventMarketingLinks(eventId)
  const refreshed = await getEventMarketingLinks(eventId)
  marketingLinks = refreshed.success ? (refreshed.links || []) : marketingLinks
}
```

Then pass `marketingLinks` (not `marketingLinksResult.links`) to the client component. Also add the `EventMarketingLink` type import if not already present — it's exported from `@/app/actions/event-marketing-links`.

- [ ] **Step 3: Run typecheck**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/(authenticated)/events/[id]/page.tsx
git commit -m "feat: auto-generate missing always-on marketing links on page load"
```

---

## Task 6: Rebuild `EventMarketingLinksCard` with three sections and ghost cards

**Files:**
- Modify: `src/components/features/events/EventMarketingLinksCard.tsx`

This is the largest task. Replace the component body while keeping the same props interface and all existing helper functions (`handleCopy`, `handleDownloadQr`).

- [ ] **Step 1: Add new imports at the top of the component file**

Add alongside existing imports:

```typescript
import { useState, useCallback } from 'react'
import { generateSingleMarketingLink } from '@/app/actions/event-marketing-links'
import { EVENT_MARKETING_CHANNELS, type EventMarketingChannelKey } from '@/lib/event-marketing-links'
```

- [ ] **Step 2: Update the props interface first** (before adding state/handlers that reference the new props)

```typescript
interface EventMarketingLinksCardProps {
  eventId: string                               // ← new
  links: EventMarketingLink[]
  loading?: boolean
  error?: string | null
  onRegenerate?: () => Promise<void>
  onLinkGenerated: (link: EventMarketingLink) => void  // ← new
}
```

- [ ] **Step 3: Add per-channel loading state and derived values**

Inside the component function, replace the `useMemo` calls and add new state:

```typescript
// Replace existing useMemos:
const alwaysOnLinks = useMemo(
  () => links.filter(l => {
    const cfg = EVENT_MARKETING_CHANNELS.find(c => c.key === l.channel)
    return cfg?.tier === 'always_on'
  }),
  [links]
)

const onDemandDigitalLinks = useMemo(
  () => links.filter(l => {
    const cfg = EVENT_MARKETING_CHANNELS.find(c => c.key === l.channel)
    return cfg?.tier === 'on_demand' && cfg?.type === 'digital'
  }),
  [links]
)

const printLinks = useMemo(
  () => links.filter(l => {
    const cfg = EVENT_MARKETING_CHANNELS.find(c => c.key === l.channel)
    return cfg?.type === 'print'
  }),
  [links]
)

// Channels whose links haven't been generated yet:
const missingOnDemandDigital = useMemo(
  () => EVENT_MARKETING_CHANNELS.filter(
    c => c.tier === 'on_demand' && c.type === 'digital' && !links.some(l => l.channel === c.key)
  ),
  [links]
)

const missingPrint = useMemo(
  () => EVENT_MARKETING_CHANNELS.filter(
    c => c.type === 'print' && !links.some(l => l.channel === c.key)
  ),
  [links]
)

// Per-channel loading state:
const [generatingChannels, setGeneratingChannels] = useState<Set<EventMarketingChannelKey>>(new Set())
```

- [ ] **Step 4: Add the `handleGenerate` function**

Add inside the component, after the state declarations:

```typescript
const handleGenerate = useCallback(async (channel: EventMarketingChannelKey) => {
  setGeneratingChannels(prev => new Set(prev).add(channel))
  try {
    const result = await generateSingleMarketingLink(eventId, channel)
    if (result.success && result.link) {
      onLinkGenerated(result.link)
      toast.success(`${result.link.label} link generated`)
    } else {
      toast.error(result.error ?? 'Failed to generate link')
    }
  } catch {
    toast.error('Failed to generate link')
  } finally {
    setGeneratingChannels(prev => {
      const next = new Set(prev)
      next.delete(channel)
      return next
    })
  }
}, [eventId, onLinkGenerated])
```

- [ ] **Step 5: Update the parent (`EventDetailClient.tsx`) to pass the new props**

Find where `EventMarketingLinksCard` is rendered in `EventDetailClient.tsx`. Add:
- `eventId={event.id}` prop
- `onLinkGenerated` callback that adds the new link to the local links state:

```typescript
// In EventDetailClient, where links state is managed, add:
const handleLinkGenerated = useCallback((link: EventMarketingLink) => {
  setMarketingLinks(prev => [...prev, link])
}, [])

// On the component:
<EventMarketingLinksCard
  eventId={event.id}
  links={marketingLinks}
  loading={marketingLoading}
  error={marketingError}
  onRegenerate={handleRegenerate}
  onLinkGenerated={handleLinkGenerated}
/>
```

- [ ] **Step 6: Add a ghost card renderer**

Add a small helper inside the component file (not exported):

```typescript
function GhostCard({
  channelKey,
  label,
  description,
  isGenerating,
  onGenerate,
}: {
  channelKey: EventMarketingChannelKey
  label: string
  description?: string
  isGenerating: boolean
  onGenerate: () => void
}) {
  return (
    <div className="rounded-lg border border-dashed border-gray-300 bg-muted/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-gray-900">{label}</p>
          {description && (
            <p className="text-xs text-gray-500">{description}</p>
          )}
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={onGenerate}
          disabled={isGenerating}
          leftIcon={isGenerating ? <Spinner className="h-4 w-4" /> : undefined}
        >
          {isGenerating ? 'Generating…' : 'Generate'}
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 7: Replace the JSX render body with three sections**

Replace the `<div className="space-y-8">` block with:

```tsx
<div className="space-y-8">
  {/* Section 1: Always-on digital */}
  <section>
    <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Digital channels</h3>
    <div className="mt-3 space-y-3">
      {alwaysOnLinks.map((link) => (
        <DigitalLinkCard key={link.id} link={link} onCopy={handleCopy} />
      ))}
    </div>
  </section>

  {/* Section 2: On-demand digital */}
  <section>
    <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Optional digital channels</h3>
    <div className="mt-3 space-y-3">
      {onDemandDigitalLinks.map((link) => (
        <DigitalLinkCard key={link.id} link={link} onCopy={handleCopy} />
      ))}
      {missingOnDemandDigital.map((cfg) => (
        <GhostCard
          key={cfg.key}
          channelKey={cfg.key}
          label={cfg.label}
          description={cfg.description}
          isGenerating={generatingChannels.has(cfg.key)}
          onGenerate={() => handleGenerate(cfg.key)}
        />
      ))}
    </div>
  </section>

  {/* Section 3: Print assets */}
  <section>
    <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Print assets</h3>
    <div className="mt-3 grid gap-4 sm:grid-cols-2">
      {printLinks.map((link) => (
        <PrintLinkCard key={link.id} link={link} onCopy={handleCopy} onDownload={handleDownloadQr} />
      ))}
      {missingPrint.map((cfg) => (
        <GhostCard
          key={cfg.key}
          channelKey={cfg.key}
          label={cfg.label}
          description={cfg.description}
          isGenerating={generatingChannels.has(cfg.key)}
          onGenerate={() => handleGenerate(cfg.key)}
        />
      ))}
    </div>
  </section>
</div>
```

- [ ] **Step 8: Extract `DigitalLinkCard` and `PrintLinkCard` as local components**

Move the existing JSX for individual digital and print link cards into small sub-components within the same file. This keeps the main component readable.

```typescript
// Digital link card (extracted from existing JSX):
function DigitalLinkCard({
  link,
  onCopy,
}: {
  link: EventMarketingLink
  onCopy: (value: string, label: string) => void
}) {
  return (
    <div className="rounded-lg border border-gray-200 p-4">
      {/* ... paste existing digital link JSX here ... */}
    </div>
  )
}

// Print link card (extracted from existing JSX):
function PrintLinkCard({
  link,
  onCopy,
  onDownload,
}: {
  link: EventMarketingLink
  onCopy: (value: string, label: string) => void
  onDownload: (link: EventMarketingLink) => void
}) {
  return (
    <div className="flex flex-col justify-between rounded-lg border border-gray-200 p-4">
      {/* ... paste existing print link JSX here ... */}
    </div>
  )
}
```

- [ ] **Step 9: Remove the `links.length === 0` empty state**

Now that ghost cards are always shown for on-demand channels, an "all empty" state should not occur for a properly set-up event. Replace the empty state guard with a check that only shows the spinner/error if loading/errored:

```tsx
{loading ? (
  <div className="flex items-center justify-center py-12">
    <Spinner className="text-gray-400" />
  </div>
) : error ? (
  <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
    {error}
  </div>
) : (
  <div className="space-y-8">
    {/* three sections */}
  </div>
)}
```

- [ ] **Step 10: Run typecheck**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 11: Commit**

```bash
git add src/components/features/events/EventMarketingLinksCard.tsx
git add src/app/(authenticated)/events/[id]/EventDetailClient.tsx
git commit -m "feat: three-section marketing links card with ghost cards for on-demand channels"
```

---

## Task 7: Final verification

- [ ] **Step 1: Run full test suite**

```bash
npx vitest run 2>&1 | tail -20
```

Expected: all tests pass, including new `event-marketing.test.ts`.

- [ ] **Step 2: Run lint**

```bash
npm run lint 2>&1 | tail -20
```

Expected: zero warnings.

- [ ] **Step 3: Run build**

```bash
npm run build 2>&1 | tail -20
```

Expected: successful build, no type errors.

- [ ] **Step 4: Smoke test checklist** (manual, in dev server)

```bash
npm run dev
```

Open an event detail page. Verify:
- [ ] Four always-on links (Facebook, Lnk.bio, GBP, Meta Ads) appear in "Digital channels" section
- [ ] "Optional digital channels" section shows ghost cards for Newsletter, SMS, WhatsApp
- [ ] "Print assets" section shows ghost cards for Poster, Table Talker, Bar Strut
- [ ] Clicking "Generate" on a ghost card shows spinner, then replaces with live link
- [ ] "Refresh links" button still works and does not wipe on-demand links
- [ ] New event (no links in DB) auto-generates the 4 always-on links on first page load

- [ ] **Step 5: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: address issues found during smoke testing"
```
