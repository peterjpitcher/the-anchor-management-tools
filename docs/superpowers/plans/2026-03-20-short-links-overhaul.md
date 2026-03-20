# Short Links Overhaul — Implementation Plan (Phases 1-3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate short link domain to `l.the-anchor.pub`, fix all reliability/performance issues, and add UTM variant link generation with parent/child grouping.

**Architecture:** The short link system is a redirect service backed by Supabase. The redirect handler (`/api/redirect/[code]`) resolves short codes, tracks clicks, and 302-redirects. The management UI lives at `/(authenticated)/short-links/`. This plan fixes the core infrastructure first (domain, reliability, performance), then layers on the UTM variant feature which adds a parent/child link hierarchy with channel-specific UTM baking.

**Tech Stack:** Next.js 15 App Router, Supabase (PostgreSQL + Realtime), TypeScript, Tailwind CSS, Vercel (`waitUntil`), `qrcode` library.

**Spec:** `docs/superpowers/specs/2026-03-20-short-links-overhaul-design.md`

---

## File Map

### Files to Create
| Path | Responsibility |
|------|---------------|
| `src/types/short-links.ts` | Shared `ShortLink` type derived from DB types |
| `src/lib/short-links/channels.ts` | UTM channel config (digital + print touchpoints) |
| `src/lib/short-links/utm.ts` | UTM URL builder + slugify helper |
| `src/app/(authenticated)/short-links/components/UtmDropdown.tsx` | Share/Print dropdown for generating UTM variants |
| `supabase/migrations/YYYYMMDD_add_parent_link_id.sql` | Add `parent_link_id` column + index |
| `src/tests/lib/short-links/utm.test.ts` | Tests for UTM URL builder |
| `src/tests/lib/short-links/channels.test.ts` | Tests for channel config |
| `src/tests/services/short-links-variants.test.ts` | Tests for variant creation |

### Files to Modify
| Path | Changes |
|------|---------|
| `src/lib/short-links/base-url.ts` | Change default domain to `l.the-anchor.pub` |
| `src/app/api/redirect/[code]/route.ts` | `waitUntil` for click tracking, singleton client, remove dead flag |
| `src/services/short-links.ts` | Remove `resolveShortLink`, add `getOrCreateUtmVariant`, add pagination, add `event_checkin` type |
| `src/app/actions/short-links.ts` | Remove `resolveShortLink` action, add `getOrCreateUtmVariant` action |
| `src/app/(authenticated)/short-links/ShortLinksClient.tsx` | Use shared types, ConfirmDialog, dateUtils, grouped display, Share/Print buttons |
| `src/app/(authenticated)/short-links/components/ShortLinkFormModal.tsx` | Use shared types, fix expiry, fix `allowedLinkTypes`, add `event_checkin` |
| `src/app/(authenticated)/short-links/components/ShortLinkAnalyticsModal.tsx` | Use shared types, remove redundant API call, use dateUtils |
| `src/app/(authenticated)/short-links/insights/InsightsClient.tsx` | Update subtitle, debounce fetching |
| `src/hooks/useShortLinkClickToasts.ts` | Add click_count delta guard |
| `vercel.json` | Add `l.the-anchor.pub` rewrite rules |
| `src/services/event-marketing.ts` | Update hardcoded `SHORT_LINK_BASE_URL` to use `buildShortLinkUrl` |

---

## Phase 1: Domain Migration + Critical Fixes

### Task 1: Extract shared `ShortLink` type

**Files:**
- Create: `src/types/short-links.ts`
- Modify: `src/app/(authenticated)/short-links/ShortLinksClient.tsx`
- Modify: `src/app/(authenticated)/short-links/components/ShortLinkFormModal.tsx`
- Modify: `src/app/(authenticated)/short-links/components/ShortLinkAnalyticsModal.tsx`

- [ ] **Step 1: Create `src/types/short-links.ts`**

```typescript
import type { Database } from '@/types/database'

type ShortLinkRow = Database['public']['Tables']['short_links']['Row']

/** Short link as returned by getShortLinks — a subset of the full row */
export interface ShortLink {
  id: string
  name: ShortLinkRow['name']
  short_code: string
  destination_url: string
  link_type: string
  click_count: number
  created_at: string
  expires_at: string | null
  last_clicked_at: string | null
  // parent_link_id added in Task 11 migration — do not add here until then
}
```

- [ ] **Step 2: Replace inline interfaces in all three component files**

In each of `ShortLinksClient.tsx`, `ShortLinkFormModal.tsx`, `ShortLinkAnalyticsModal.tsx`:
- Remove the local `interface ShortLink { ... }` block
- Add `import type { ShortLink } from '@/types/short-links'` at the top

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: Clean build, no type errors.

- [ ] **Step 4: Commit**

```
feat: extract shared ShortLink type to src/types/short-links.ts
```

---

### Task 2: Domain migration — change base URL

**Files:**
- Modify: `src/lib/short-links/base-url.ts`
- Modify: `vercel.json`
- Modify: `src/app/(authenticated)/short-links/ShortLinksClient.tsx`
- Modify: `src/app/(authenticated)/short-links/insights/InsightsClient.tsx`
- Modify: `src/services/event-marketing.ts`

- [ ] **Step 1: Update default base URL**

In `src/lib/short-links/base-url.ts`, change:
```typescript
return (process.env.NEXT_PUBLIC_SHORT_LINK_BASE_URL || 'https://vip-club.uk').replace(/\/$/, '')
```
to:
```typescript
return (process.env.NEXT_PUBLIC_SHORT_LINK_BASE_URL || 'https://l.the-anchor.pub').replace(/\/$/, '')
```

- [ ] **Step 2: Add `l.the-anchor.pub` rewrite rules to `vercel.json`**

Add a rewrite rule for the new domain alongside the existing `vip-club.uk` ones. Keep `vip-club.uk` rules intact for backward compat. The new rule should match the existing pattern:

```json
{
  "source": "/:code",
  "destination": "/api/redirect/:code",
  "has": [{ "type": "host", "value": "l.the-anchor.pub" }]
}
```

- [ ] **Step 3: Update UI subtitle text**

In `ShortLinksClient.tsx` change subtitle:
```
"Create and manage vip-club.uk short links"
```
to:
```
"Create and manage l.the-anchor.pub short links"
```

In `InsightsClient.tsx` change subtitle:
```
"Track click performance and trends for vip-club.uk short links"
```
to:
```
"Track click performance and trends for l.the-anchor.pub short links"
```

- [ ] **Step 4: Fix hardcoded base URL in event-marketing.ts**

In `src/services/event-marketing.ts`, replace:
```typescript
const SHORT_LINK_BASE_URL = process.env.NEXT_PUBLIC_SHORT_LINK_BASE_URL || 'https://vip-club.uk';
```
and the `buildShortUrl` function with:
```typescript
import { buildShortLinkUrl } from '@/lib/short-links/base-url';
```
Then replace all calls to `buildShortUrl(shortCode)` with `buildShortLinkUrl(shortCode)`.

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 6: Commit**

```
feat: migrate short link domain from vip-club.uk to l.the-anchor.pub
```

---

### Task 3: Non-blocking click tracking with `waitUntil`

**Files:**
- Modify: `src/app/api/redirect/[code]/route.ts`

- [ ] **Step 1: Install `@vercel/functions` if not present**

Run: `npm ls @vercel/functions` — if not found, run `npm install @vercel/functions`.

- [ ] **Step 2: Import `waitUntil` and `createAdminClient`**

At the top of `route.ts`, add:
```typescript
import { waitUntil } from '@vercel/functions'
import { createAdminClient } from '@/lib/supabase/admin'
```

Remove the inline `createClient` import from `@supabase/supabase-js` and the per-request `createClient(supabaseUrl, supabaseServiceKey)` call. Replace with `const supabase = createAdminClient()`.

- [ ] **Step 3: Remove the `loggedMissingAliasTable` flag**

Delete the `let loggedMissingAliasTable = false` declaration and the `if (!loggedMissingAliasTable)` guard inside the alias error handler. Just log the warning unconditionally.

- [ ] **Step 4: Move click tracking into `waitUntil`**

Restructure the end of the `GET` handler. The redirect response is sent immediately. Click tracking fires in the background:

```typescript
// Build redirect response FIRST
const response = NextResponse.redirect(redirectDestinationUrl)

// Fire click tracking in background — does NOT block the redirect
waitUntil((async () => {
  try {
    const userAgent = request.headers.get('user-agent')
    const { deviceType, browser, os } = parseUserAgent(userAgent)
    const utmParams = parseQueryParams(request.url)
    const ipAddress = extractClientIp(request)

    const { error: clickInsertError } = await supabase
      .from('short_link_clicks')
      .insert({
        short_link_id: resolvedLink.id,
        user_agent: userAgent,
        referrer: request.headers.get('referer'),
        ip_address: ipAddress,
        country: getCountryFromHeaders(request.headers),
        city: getCityFromHeaders(request.headers),
        region: getRegionFromHeaders(request.headers),
        device_type: deviceType,
        browser,
        os,
        utm_source: utmParams.utm_source,
        utm_medium: utmParams.utm_medium,
        utm_campaign: utmParams.utm_campaign,
        metadata: resolvedViaAlias ? { alias_code: shortCode } : {}
      })
    if (clickInsertError) throw clickInsertError

    if (deviceType !== 'bot') {
      await supabase.rpc('increment_short_link_clicks', {
        p_short_link_id: resolvedLink.id
      })
    }
  } catch (err) {
    console.error('Error tracking click:', err)
  }
})())

return response
```

**Critical**: Table payment recovery logic (the `if (tablePaymentLink)` block) must remain BEFORE the redirect response — it modifies `redirectDestinationUrl`. Do not move it into `waitUntil`.

- [ ] **Step 5: Remove Supabase env var checks**

Since `createAdminClient()` handles its own config, remove the explicit `supabaseUrl`/`supabaseServiceKey` checks and the `MISSING_RELATION_CODE` constant if no longer needed.

- [ ] **Step 6: Verify build**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 7: Commit**

```
perf: non-blocking click tracking via waitUntil in redirect route
```

---

### Task 4: Remove dead `resolveShortLink` method

**Files:**
- Modify: `src/services/short-links.ts`
- Modify: `src/app/actions/short-links.ts`

- [ ] **Step 1: Remove `resolveShortLink` from service**

In `src/services/short-links.ts`, delete the `resolveShortLink` method (lines ~265-335) and the `ResolveShortLinkSchema` export.

- [ ] **Step 2: Remove `resolveShortLink` from actions**

In `src/app/actions/short-links.ts`, remove:
- The `ResolveShortLinkSchema` import
- The `resolveShortLink` server action function

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: Clean build. If anything fails, it means there IS a consumer — find and fix it.

- [ ] **Step 4: Commit**

```
refactor: remove dead resolveShortLink method and action
```

---

### Task 5: Replace `confirm()` with `DeleteConfirmDialog`

**Files:**
- Modify: `src/app/(authenticated)/short-links/ShortLinksClient.tsx`

- [ ] **Step 1: Add imports and state**

Add:
```typescript
import { DeleteConfirmDialog } from '@/components/ui-v2/overlay/ConfirmDialog'
```

Add state:
```typescript
const [deleteTarget, setDeleteTarget] = useState<ShortLink | null>(null)
```

- [ ] **Step 2: Replace `handleDelete` function**

Replace the existing `handleDelete` with:
```typescript
const handleDeleteClick = (link: ShortLink) => {
  setDeleteTarget(link)
}

const handleDeleteConfirm = async () => {
  if (!deleteTarget) return
  try {
    const result = await deleteShortLink(deleteTarget.id)
    if (!result || 'error' in result) {
      toast.error(result?.error || 'Failed to delete short link')
      return
    }
    toast.success('Short link deleted')
    setDeleteTarget(null)
    await refreshLinks()
  } catch (error) {
    console.error('Failed to delete short link', error)
    toast.error('Failed to delete short link')
  }
}
```

- [ ] **Step 3: Update the delete button onClick**

Change `onClick={() => handleDelete(link.id)}` to `onClick={() => handleDeleteClick(link)}` in both the desktop column and the mobile card.

- [ ] **Step 4: Add the dialog to JSX**

Before the closing `</PageLayout>`, add:
```tsx
<DeleteConfirmDialog
  open={!!deleteTarget}
  onClose={() => setDeleteTarget(null)}
  onDelete={handleDeleteConfirm}
  itemName={deleteTarget ? buildShortLinkUrl(deleteTarget.short_code) : ''}
  itemType="Short Link"
/>
```

- [ ] **Step 5: Verify build**

Run: `npm run build`

- [ ] **Step 6: Commit**

```
fix: replace browser confirm() with DeleteConfirmDialog for short link deletion
```

---

### Task 6: Use `dateUtils` for display dates

**Files:**
- Modify: `src/app/(authenticated)/short-links/ShortLinksClient.tsx`
- Modify: `src/app/(authenticated)/short-links/components/ShortLinkAnalyticsModal.tsx`

- [ ] **Step 1: Fix ShortLinksClient.tsx**

Add import:
```typescript
import { formatDate } from '@/lib/dateUtils'
```

In the `created_at` column cell, replace:
```typescript
cell: (link) => new Date(link.created_at).toLocaleDateString(),
```
with:
```typescript
cell: (link) => formatDate(link.created_at),
```

Also replace the same pattern in the mobile card.

- [ ] **Step 2: Fix ShortLinkAnalyticsModal.tsx**

Add import:
```typescript
import { formatDateTime } from '@/lib/dateUtils'
```

Replace:
```typescript
{analytics.last_clicked_at
  ? new Date(analytics.last_clicked_at).toLocaleString()
  : 'Never'}
```
with:
```typescript
{analytics.last_clicked_at
  ? formatDateTime(analytics.last_clicked_at)
  : 'Never'}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`

- [ ] **Step 4: Commit**

```
fix: use dateUtils for date formatting in short links UI
```

---

### Task 7: Fix ShortLinkFormModal issues

**Files:**
- Modify: `src/app/(authenticated)/short-links/components/ShortLinkFormModal.tsx`
- Modify: `src/services/short-links.ts`

- [ ] **Step 1: Move `allowedLinkTypes` to module level**

Move the `allowedLinkTypes` set outside the component, at the module level:
```typescript
const ALLOWED_LINK_TYPES = new Set([
  'custom',
  'booking_confirmation',
  'event_checkin',
  'loyalty_portal',
  'promotion',
  'reward_redemption',
])
```

Update the reference in the `useEffect` from `allowedLinkTypes` to `ALLOWED_LINK_TYPES`.

- [ ] **Step 2: Add `event_checkin` to schema**

In `src/services/short-links.ts`, update the `CreateShortLinkSchema` `link_type` enum:
```typescript
link_type: z.enum(['loyalty_portal', 'promotion', 'reward_redemption', 'custom', 'booking_confirmation', 'event_checkin']),
```

- [ ] **Step 3: Add `event_checkin` to form dropdown**

In `ShortLinkFormModal.tsx`, add to the `<Select>` options:
```tsx
<option value="event_checkin">Event Check-in</option>
```

- [ ] **Step 4: Replace expiry presets with date/time input**

Replace the expiry `<Select>` with a date/time input and a "No expiry" toggle:
```tsx
<FormGroup label="Expires">
  <div className="flex items-center gap-3">
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={hasExpiry}
        onChange={(e) => {
          setHasExpiry(e.target.checked)
          if (!e.target.checked) setExpiryValue('')
        }}
      />
      Set expiry date
    </label>
  </div>
  {hasExpiry && (
    <Input
      type="datetime-local"
      value={expiryValue}
      onChange={(e) => setExpiryValue(e.target.value)}
      className="mt-2"
    />
  )}
</FormGroup>
```

Add state:
```typescript
const [hasExpiry, setHasExpiry] = useState(false)
const [expiryValue, setExpiryValue] = useState('')
```

In the `useEffect` for edit mode, populate from the actual `expires_at`:
```typescript
if (link.expires_at) {
  setHasExpiry(true)
  // Format as datetime-local value
  const d = new Date(link.expires_at)
  setExpiryValue(d.toISOString().slice(0, 16))
} else {
  setHasExpiry(false)
  setExpiryValue('')
}
```

In `handleSubmit`, replace the preset logic with:
```typescript
const expiresAt = hasExpiry && expiryValue ? new Date(expiryValue).toISOString() : undefined
```

Remove the old `expiresIn` state entirely.

- [ ] **Step 5: Verify build**

Run: `npm run build`

- [ ] **Step 6: Commit**

```
fix: fix form modal — module-level link types, event_checkin type, precise expiry date picker
```

---

### Task 8: Eliminate redundant analytics API call

**Files:**
- Modify: `src/app/(authenticated)/short-links/components/ShortLinkAnalyticsModal.tsx`

- [ ] **Step 1: Remove the detail API call**

In `loadAnalytics`, remove the `getShortLinkAnalytics(link.short_code)` call from the `Promise.all`. Use the `link` prop's `click_count` and `last_clicked_at` directly.

Replace:
```typescript
const [detailResult, summaryResult] = await Promise.all([
  getShortLinkAnalytics(link.short_code),
  getShortLinkAnalyticsSummary(link.short_code, 30)
])
```
with:
```typescript
const summaryResult = await getShortLinkAnalyticsSummary(link.short_code, 30)
```

Restructure the `setAnalytics` call to use the `link` prop directly for the values that came from `detailData`:
```typescript
setAnalytics({
  click_count: link.click_count,
  last_clicked_at: link.last_clicked_at,
  demographics,
  chartData: enhancedData.map((day: any) => ({
    date: day.click_date,
    value: day.total_clicks ?? 0
  }))
})
```

Remove the `getShortLinkAnalytics` import.

- [ ] **Step 2: Verify build**

Run: `npm run build`

- [ ] **Step 3: Commit**

```
perf: remove redundant analytics detail API call — use props from parent
```

---

## Phase 2: Performance

### Task 9: Debounce insights page data fetching

**Files:**
- Modify: `src/app/(authenticated)/short-links/insights/InsightsClient.tsx`

- [ ] **Step 1: Add a debounce mechanism**

Add a `useRef` for the debounce timer:
```typescript
const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
```

Wrap the `useEffect` that calls `loadVolumeData` with a debounce:
```typescript
useEffect(() => {
  if (debounceRef.current) clearTimeout(debounceRef.current)
  debounceRef.current = setTimeout(() => {
    void loadVolumeData()
  }, 300)
  return () => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
  }
}, [loadVolumeData])
```

- [ ] **Step 2: Verify build**

Run: `npm run build`

- [ ] **Step 3: Commit**

```
perf: debounce insights page data fetching (300ms)
```

---

### Task 10: Scope Realtime subscription

**Files:**
- Modify: `src/hooks/useShortLinkClickToasts.ts`

- [ ] **Step 1: Add a delta guard**

The existing handler already computes `delta`. Ensure no toast fires for non-click updates by verifying the guard `if (delta > 0)` is the ONLY path to `toast.success()`. Currently it is — but the handler fires on every UPDATE (including name edits). The payload parse still runs unnecessarily.

Add an early return before the delta computation:
```typescript
const updated = payload.new
if (!updated?.id) return

const nextCount = updated.click_count ?? 0
const previousCount = clickCountsRef.current.get(updated.id) ?? 0

// Skip if click_count hasn't changed (e.g. name edit, metadata update)
if (nextCount === previousCount) {
  return
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`

- [ ] **Step 3: Commit**

```
perf: skip Realtime toast for non-click short link updates
```

---

### Task 11: Paginate short links list

**Files:**
- Modify: `src/services/short-links.ts`
- Modify: `src/app/actions/short-links.ts`
- Modify: `src/app/(authenticated)/short-links/page.tsx`
- Modify: `src/app/(authenticated)/short-links/ShortLinksClient.tsx`

- [ ] **Step 1: Add paginated query to service**

In `ShortLinkService`, modify `getShortLinks` to accept pagination params and return total count:

```typescript
static async getShortLinks(page: number = 1, pageSize: number = 50): Promise<{
  data: any[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const supabase = await createClient()
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  const { data, error, count } = await supabase
    .from('short_links')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to)

  if (error) throw new Error('Failed to load short links')
  return { data: data || [], total: count || 0, page, pageSize }
}
```

- [ ] **Step 2: Update server action**

Update `getShortLinks` action to pass page params:
```typescript
export async function getShortLinks(page: number = 1, pageSize: number = 50) {
  // ... permission check ...
  const result = await ShortLinkService.getShortLinks(page, pageSize)
  return { success: true, ...result }
}
```

- [ ] **Step 3: Add pagination controls to ShortLinksClient**

Add page state and navigation controls (Previous / Next buttons, page indicator showing "Page X of Y", total count). When page changes, call `refreshLinks(newPage)`.

- [ ] **Step 4: Verify build**

Run: `npm run build`

- [ ] **Step 5: Commit**

```
perf: add server-side pagination to short links list (50 per page)
```

---

## Phase 3: UTM Variant Links

### Task 12: Database migration — add `parent_link_id`

**Files:**
- Create: `supabase/migrations/YYYYMMDD_add_parent_link_id.sql`

- [ ] **Step 1: Create migration file**

Use today's date in the filename. Content:
```sql
-- Add parent_link_id to support UTM variant grouping
ALTER TABLE short_links
  ADD COLUMN parent_link_id UUID REFERENCES short_links(id) ON DELETE CASCADE;

-- Partial index — only variants have a parent
CREATE INDEX idx_short_links_parent
  ON short_links (parent_link_id)
  WHERE parent_link_id IS NOT NULL;

-- Comment
COMMENT ON COLUMN short_links.parent_link_id IS
  'If set, this link is a UTM variant of the parent link. NULL = standalone/parent link.';
```

- [ ] **Step 2: Apply migration locally**

Run: `npx supabase db push`
Expected: Migration applies without error.

- [ ] **Step 3: Regenerate types**

Run: `npx supabase gen types typescript --local > src/types/database.ts` (or the project's equivalent type-gen command).

- [ ] **Step 4: Update `ShortLink` type**

In `src/types/short-links.ts`, add `parent_link_id` now that the migration has been applied and types regenerated:
```typescript
export interface ShortLink {
  // ... existing fields ...
  parent_link_id: string | null
}
```

- [ ] **Step 5: Commit**

```
feat: add parent_link_id column for UTM variant link grouping
```

---

### Task 13: UTM channel config and URL builder

**Files:**
- Create: `src/lib/short-links/channels.ts`
- Create: `src/lib/short-links/utm.ts`
- Create: `src/tests/lib/short-links/utm.test.ts`

- [ ] **Step 1: Create channel config**

`src/lib/short-links/channels.ts`:
```typescript
export type ChannelType = 'digital' | 'print'

export interface ShortLinkChannel {
  key: string
  label: string
  type: ChannelType
  utmSource: string
  utmMedium: string
  utmContent: string
}

export const DIGITAL_CHANNELS: ShortLinkChannel[] = [
  { key: 'facebook', label: 'Facebook', type: 'digital', utmSource: 'facebook', utmMedium: 'social', utmContent: 'facebook_main' },
  { key: 'lnk_bio', label: 'Lnk.bio', type: 'digital', utmSource: 'instagram', utmMedium: 'lnk.bio', utmContent: 'instagram_bio' },
  { key: 'google_business', label: 'Google Business', type: 'digital', utmSource: 'google', utmMedium: 'business_profile', utmContent: 'google_post' },
  { key: 'meta_ads', label: 'Meta Ads', type: 'digital', utmSource: 'facebook', utmMedium: 'paid_social', utmContent: 'meta_ads_main' },
  { key: 'newsletter', label: 'Newsletter', type: 'digital', utmSource: 'newsletter', utmMedium: 'email', utmContent: 'newsletter_primary' },
  { key: 'sms', label: 'SMS', type: 'digital', utmSource: 'sms', utmMedium: 'messaging', utmContent: 'sms_blast' },
  { key: 'whatsapp', label: 'WhatsApp', type: 'digital', utmSource: 'whatsapp', utmMedium: 'messaging', utmContent: 'whatsapp_group' },
]

export const PRINT_CHANNELS: ShortLinkChannel[] = [
  { key: 'poster', label: 'Poster', type: 'print', utmSource: 'poster', utmMedium: 'print', utmContent: 'poster_qr' },
  { key: 'table_talker', label: 'Table Talker', type: 'print', utmSource: 'table_talker', utmMedium: 'print', utmContent: 'table_talker_qr' },
  { key: 'bar_strut', label: 'Bar Strut', type: 'print', utmSource: 'bar_strut', utmMedium: 'print', utmContent: 'bar_strut_qr' },
  { key: 'flyer', label: 'Flyer', type: 'print', utmSource: 'flyer', utmMedium: 'print', utmContent: 'flyer_qr' },
  { key: 'menu_insert', label: 'Menu Insert', type: 'print', utmSource: 'menu_insert', utmMedium: 'print', utmContent: 'menu_insert_qr' },
]

export const ALL_CHANNELS: ShortLinkChannel[] = [...DIGITAL_CHANNELS, ...PRINT_CHANNELS]

export const CHANNEL_MAP = new Map(ALL_CHANNELS.map((c) => [c.key, c]))
```

- [ ] **Step 2: Create UTM URL builder**

`src/lib/short-links/utm.ts`:
```typescript
import type { ShortLinkChannel } from './channels'

/** Slugify a link name for use as utm_campaign */
export function slugifyCampaign(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 100)
}

/** Append UTM params to a destination URL */
export function buildUtmUrl(
  destinationUrl: string,
  channel: ShortLinkChannel,
  campaignName: string
): string {
  const url = new URL(destinationUrl)
  const campaign = slugifyCampaign(campaignName)

  url.searchParams.set('utm_source', channel.utmSource)
  url.searchParams.set('utm_medium', channel.utmMedium)
  url.searchParams.set('utm_campaign', campaign)
  url.searchParams.set('utm_content', channel.utmContent)

  return url.toString()
}

/** Build variant display name: "Parent Name — Channel Label" */
export function buildVariantName(parentName: string, channelLabel: string): string {
  return `${parentName} \u2014 ${channelLabel}`
}
```

- [ ] **Step 3: Write tests**

`src/tests/lib/short-links/utm.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import { slugifyCampaign, buildUtmUrl, buildVariantName } from '@/lib/short-links/utm'

describe('slugifyCampaign', () => {
  it('should convert spaces and special chars to underscores', () => {
    expect(slugifyCampaign('Easter Sunday Lunch')).toBe('easter_sunday_lunch')
  })

  it('should strip leading/trailing underscores', () => {
    expect(slugifyCampaign('  --Hello World--  ')).toBe('hello_world')
  })

  it('should truncate to 100 chars', () => {
    const long = 'a'.repeat(150)
    expect(slugifyCampaign(long).length).toBe(100)
  })
})

describe('buildUtmUrl', () => {
  it('should append UTM params to destination', () => {
    const channel = { key: 'facebook', label: 'Facebook', type: 'digital' as const, utmSource: 'facebook', utmMedium: 'social', utmContent: 'facebook_main' }
    const result = buildUtmUrl('https://www.the-anchor.pub/events/easter', channel, 'Easter Lunch')
    const url = new URL(result)
    expect(url.searchParams.get('utm_source')).toBe('facebook')
    expect(url.searchParams.get('utm_medium')).toBe('social')
    expect(url.searchParams.get('utm_campaign')).toBe('easter_lunch')
    expect(url.searchParams.get('utm_content')).toBe('facebook_main')
  })

  it('should preserve existing query params', () => {
    const channel = { key: 'sms', label: 'SMS', type: 'digital' as const, utmSource: 'sms', utmMedium: 'messaging', utmContent: 'sms_blast' }
    const result = buildUtmUrl('https://example.com?foo=bar', channel, 'Test')
    const url = new URL(result)
    expect(url.searchParams.get('foo')).toBe('bar')
    expect(url.searchParams.get('utm_source')).toBe('sms')
  })
})

describe('buildVariantName', () => {
  it('should join parent name and channel with em-dash', () => {
    expect(buildVariantName('Easter Lunch', 'Facebook')).toBe('Easter Lunch \u2014 Facebook')
  })
})
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/tests/lib/short-links/utm.test.ts`
Expected: All pass.

- [ ] **Step 5: Commit**

```
feat: add UTM channel config and URL builder with tests
```

---

### Task 14: Server action — `getOrCreateUtmVariant`

**Files:**
- Modify: `src/services/short-links.ts`
- Modify: `src/app/actions/short-links.ts`

- [ ] **Step 1: Add `getOrCreateUtmVariant` to service**

In `src/services/short-links.ts`, add a new method to `ShortLinkService`:
```typescript
static async getOrCreateUtmVariant(
  parentId: string,
  channelKey: string
): Promise<{ id: string; short_code: string; full_url: string; already_exists: boolean }> {
  const { CHANNEL_MAP } = await import('@/lib/short-links/channels')
  const { buildUtmUrl, buildVariantName } = await import('@/lib/short-links/utm')

  const channel = CHANNEL_MAP.get(channelKey)
  if (!channel) throw new Error(`Unknown channel: ${channelKey}`)

  const supabase = await createClient()

  // Fetch parent link
  const { data: parent, error: parentError } = await supabase
    .from('short_links')
    .select('id, name, destination_url, link_type, expires_at')
    .eq('id', parentId)
    .single()

  if (parentError || !parent) throw new Error('Parent link not found')

  const utmDestination = buildUtmUrl(parent.destination_url, channel, parent.name || parent.id)
  const variantName = buildVariantName(parent.name || `/${parent.id.slice(0, 6)}`, channel.label)

  // Check for existing variant by channel (more robust than URL matching — survives UTM config changes)
  const { data: existing } = await supabase
    .from('short_links')
    .select('id, short_code')
    .eq('parent_link_id', parentId)
    .contains('metadata', { channel: channelKey })
    .maybeSingle()

  if (existing) {
    return {
      id: existing.id,
      short_code: existing.short_code,
      full_url: buildShortLinkUrl(existing.short_code),
      already_exists: true,
    }
  }

  // Create new variant via RPC
  const { data: result, error: createError } = await supabase
    .rpc('create_short_link', {
      p_destination_url: utmDestination,
      p_link_type: parent.link_type,
      p_metadata: { channel: channelKey, parent_link_id: parentId, utm_variant: true },
      p_expires_at: parent.expires_at || null,
      p_custom_code: null,
    })
    .single()

  if (createError) throw new Error(createError.message || 'Failed to create variant')

  const shortCode = (result as any).short_code as string

  // Set parent_link_id and name on the new variant
  await supabase
    .from('short_links')
    .update({ parent_link_id: parentId, name: variantName })
    .eq('short_code', shortCode)

  // Fetch the created link's ID
  const { data: created } = await supabase
    .from('short_links')
    .select('id')
    .eq('short_code', shortCode)
    .single()

  return {
    id: created?.id || '',
    short_code: shortCode,
    full_url: buildShortLinkUrl(shortCode),
    already_exists: false,
  }
}
```

- [ ] **Step 2: Add server action wrapper**

In `src/app/actions/short-links.ts`:
```typescript
export async function getOrCreateUtmVariant(parentId: string, channelKey: string) {
  try {
    const supabase = await createClient()
    const [{ data: { user } }, canManage] = await Promise.all([
      supabase.auth.getUser(),
      checkUserPermission('short_links', 'manage'),
    ])
    if (!user) return { error: 'Authentication required' }
    if (!canManage) return { error: 'You do not have permission to manage short links' }

    const result = await ShortLinkService.getOrCreateUtmVariant(parentId, channelKey)

    if (!result.already_exists) {
      await logAuditEvent({
        operation_type: 'create',
        resource_type: 'short_link',
        resource_id: result.id,
        operation_status: 'success',
        user_id: user.id,
        additional_info: {
          short_code: result.short_code,
          channel: channelKey,
          parent_link_id: parentId,
          type: 'utm_variant',
        },
      })
    }

    revalidatePath('/short-links')
    return { success: true, data: result }
  } catch (error: any) {
    console.error('UTM variant creation error:', error)
    return { error: error.message || 'Failed to create UTM variant' }
  }
}
```

- [ ] **Step 3: Update `getShortLinks` to include `parent_link_id`**

In `ShortLinkService.getShortLinks()`, the existing `select('*')` already includes all columns. Verify `parent_link_id` is in the response after the migration is applied.

- [ ] **Step 4: Verify build**

Run: `npm run build`

- [ ] **Step 5: Commit**

```
feat: add getOrCreateUtmVariant server action for UTM variant links
```

---

### Task 15: UTM Dropdown component

**Files:**
- Create: `src/app/(authenticated)/short-links/components/UtmDropdown.tsx`

- [ ] **Step 1: Create the dropdown component**

```tsx
'use client'

import { useState, useRef, useEffect } from 'react'
import {
  ShareIcon,
  PrinterIcon,
  ClipboardDocumentIcon,
} from '@heroicons/react/24/outline'
import { IconButton } from '@/components/ui-v2/forms/Button'
import { DIGITAL_CHANNELS, PRINT_CHANNELS, type ShortLinkChannel } from '@/lib/short-links/channels'
import { getOrCreateUtmVariant } from '@/app/actions/short-links'
import { buildShortLinkUrl } from '@/lib/short-links/base-url'
import toast from 'react-hot-toast'

interface Props {
  parentId: string
  parentShortCode: string
}

function ChannelDropdown({
  channels,
  parentId,
  onClose,
  mode,
}: {
  channels: ShortLinkChannel[]
  parentId: string
  onClose: () => void
  mode: 'copy' | 'qr'
}) {
  const [loading, setLoading] = useState<string | null>(null)

  const handleChannelClick = async (channel: ShortLinkChannel) => {
    setLoading(channel.key)
    try {
      const result = await getOrCreateUtmVariant(parentId, channel.key)
      if (!result || 'error' in result) {
        toast.error(result?.error || 'Failed to create variant')
        return
      }

      const fullUrl = result.data?.full_url || buildShortLinkUrl(result.data?.short_code || '')

      if (mode === 'copy') {
        await navigator.clipboard.writeText(fullUrl)
        toast.success(`${channel.label} link copied!`)
      } else {
        // Download QR code
        const QRCode = await import('qrcode')
        const dataUrl = await QRCode.toDataURL(fullUrl, { margin: 1, width: 400 })
        const link = document.createElement('a')
        link.href = dataUrl
        link.download = `qr-${result.data?.short_code}-${channel.key}.png`
        link.click()
        toast.success(`${channel.label} QR code downloaded!`)
      }

      onClose()
    } catch (error) {
      console.error('Channel variant error:', error)
      toast.error('Something went wrong')
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="absolute right-0 top-full z-50 mt-1 w-48 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
      {channels.map((channel) => (
        <button
          key={channel.key}
          type="button"
          disabled={!!loading}
          onClick={() => handleChannelClick(channel)}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50 disabled:opacity-50"
        >
          {loading === channel.key ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
          ) : (
            <ClipboardDocumentIcon className="h-4 w-4 text-gray-400" />
          )}
          {channel.label}
        </button>
      ))}
    </div>
  )
}

export function UtmDropdown({ parentId, parentShortCode }: Props) {
  const [openMenu, setOpenMenu] = useState<'share' | 'print' | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpenMenu(null)
      }
    }
    if (openMenu) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [openMenu])

  return (
    <div ref={containerRef} className="relative flex items-center gap-1">
      <div className="relative">
        <IconButton
          size="sm"
          variant="secondary"
          onClick={() => setOpenMenu(openMenu === 'share' ? null : 'share')}
          title="Share (digital channels)"
        >
          <ShareIcon className="h-4 w-4 text-gray-600" />
        </IconButton>
        {openMenu === 'share' && (
          <ChannelDropdown
            channels={DIGITAL_CHANNELS}
            parentId={parentId}
            onClose={() => setOpenMenu(null)}
            mode="copy"
          />
        )}
      </div>

      <div className="relative">
        <IconButton
          size="sm"
          variant="secondary"
          onClick={() => setOpenMenu(openMenu === 'print' ? null : 'print')}
          title="Print (QR channels)"
        >
          <PrinterIcon className="h-4 w-4 text-gray-600" />
        </IconButton>
        {openMenu === 'print' && (
          <ChannelDropdown
            channels={PRINT_CHANNELS}
            parentId={parentId}
            onClose={() => setOpenMenu(null)}
            mode="qr"
          />
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`

- [ ] **Step 3: Commit**

```
feat: add UtmDropdown component for Share/Print channel variant creation
```

---

### Task 16: Grouped parent/variant table display

**Files:**
- Modify: `src/app/(authenticated)/short-links/ShortLinksClient.tsx`

- [ ] **Step 1: Add grouping logic**

In `ShortLinksClient.tsx`, add a grouping function and state for expanded parents:

```typescript
import { UtmDropdown } from './components/UtmDropdown'

const [expandedParents, setExpandedParents] = useState<Set<string>>(new Set())

const toggleExpanded = (parentId: string) => {
  setExpandedParents((prev) => {
    const next = new Set(prev)
    if (next.has(parentId)) next.delete(parentId)
    else next.add(parentId)
    return next
  })
}

// Group links: parents first, then variants nested under them
const groupedLinks = useMemo(() => {
  const parents = links.filter((l) => !l.parent_link_id)
  const variantsByParent = new Map<string, ShortLink[]>()

  for (const link of links) {
    if (link.parent_link_id) {
      const existing = variantsByParent.get(link.parent_link_id) || []
      existing.push(link)
      variantsByParent.set(link.parent_link_id, existing)
    }
  }

  return { parents, variantsByParent }
}, [links])
```

Add `useMemo` to imports if not already there.

- [ ] **Step 2: Add expand chevron and Share/Print buttons to parent rows**

In the actions column, for parent links (links with no `parent_link_id`), add the UtmDropdown and an expand chevron if variants exist:

```tsx
{canManage && !link.parent_link_id && (
  <UtmDropdown parentId={link.id} parentShortCode={link.short_code} />
)}
```

Add a chevron button that shows the variant count and toggles expansion.

- [ ] **Step 3: Render variants using DataTable's cell renderers**

Do NOT create a separate VariantRow component with raw `<tr>` — DataTable manages its own row rendering. Instead, use the flat display list approach and adjust cell renderers to detect and style variant rows via the `isVariant` flag.

In each column's `cell` renderer, check for `isVariant` and adjust styling:
- **Name column**: For variants, show indented with arrow prefix and channel badge extracted from the name (text after em-dash)
- **Short Link column**: Same rendering, but with slightly muted text for variants
- **Actions column**: Hide Share/Print/Edit/Delete for variants (they are managed via the parent)
- **Row styling**: Use DataTable's `rowClassName` prop (if available) or conditional classes in cells to give variants a `bg-gray-50/50` background

The simplest approach: flatten the grouped data into a display list:
```typescript
const displayLinks = useMemo(() => {
  const result: Array<ShortLink & { isVariant?: boolean }> = []
  for (const parent of groupedLinks.parents) {
    result.push(parent)
    if (expandedParents.has(parent.id)) {
      const variants = groupedLinks.variantsByParent.get(parent.id) || []
      for (const v of variants) {
        result.push({ ...v, isVariant: true })
      }
    }
  }
  // Also include standalone links (orphan variants without a parent in view)
  return result
}, [groupedLinks, expandedParents])
```

Pass `displayLinks` to the DataTable and adjust the row rendering to indent variants.

- [ ] **Step 5: Verify build**

Run: `npm run build`

- [ ] **Step 6: Commit**

```
feat: add parent/variant grouped display with expand/collapse in short links table
```

---

### Task 17: End-to-end verification

- [ ] **Step 1: Run full verification pipeline**

```bash
npm run lint && npx tsc --noEmit && npm test && npm run build
```

All must pass.

- [ ] **Step 2: Manual smoke test**

Start dev server (`npm run dev`) and verify:
1. Short links page loads with new subtitle
2. Creating a link works
3. Share dropdown appears, clicking a channel copies a short URL
4. Print dropdown appears, clicking a channel downloads a QR PNG
5. Variants appear grouped under parent when expanded
6. Delete uses ConfirmDialog (not browser confirm)
7. Dates show in London format
8. Expiry uses a date/time picker
9. Insights page loads and debounces control changes

- [ ] **Step 3: Final commit if any fixes needed**

```
fix: address smoke test findings
```

---

## Summary

| Phase | Tasks | Key Deliverables |
|-------|-------|-----------------|
| 1 | Tasks 1-8 | Domain migration, `waitUntil`, dead code removal, form fixes, shared types |
| 2 | Tasks 9-11 | Debounced insights, scoped Realtime, pagination |
| 3 | Tasks 12-17 | DB migration, UTM channels, variant creation, grouped table display |

**Total: 17 tasks, ~55 discrete steps.**
