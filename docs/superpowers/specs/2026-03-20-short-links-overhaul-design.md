# Short Links Overhaul — Design Spec

**Date**: 2026-03-20
**Status**: Reviewed
**Scope**: Domain migration, reliability fixes, performance optimisations, and feature improvements

---

## 1. Domain Migration: `vip-club.uk` to `l.the-anchor.pub`

### Strategy: Dual-Domain Transition (Option B)

Both domains resolve indefinitely. New links use `l.the-anchor.pub`. Old `vip-club.uk` links keep working with no changes.

### Changes Required

**`src/lib/short-links/base-url.ts`**
- Change default base URL from `https://vip-club.uk` to `https://l.the-anchor.pub`
- Keep `NEXT_PUBLIC_SHORT_LINK_BASE_URL` env var as an override

**`vercel.json`**
- Add rewrite rules for `l.the-anchor.pub`:
  - `/:code` -> `/api/redirect/:code`
- Keep existing `vip-club.uk` rewrites unchanged (dual-domain)

**`src/lib/short-links/routing.ts`**
- No code change needed — `isShortLinkHost()` already matches `normalized.endsWith('.the-anchor.pub')`, which covers `l.the-anchor.pub`
- Keep `vip-club.uk` in the check (backward compat)

**`src/app/(authenticated)/short-links/ShortLinksClient.tsx`**
- Update subtitle text from "vip-club.uk short links" to "l.the-anchor.pub short links"

**`src/app/(authenticated)/short-links/insights/InsightsClient.tsx`**
- Update subtitle text similarly

**DNS (user action)**
- CNAME `l.the-anchor.pub` -> `cname.vercel-dns.com`
- Add `l.the-anchor.pub` as a domain in the Vercel project settings

**No data migration needed** — existing links in the DB keep their short codes. The redirect handler resolves codes regardless of which domain they arrive from. Old `vip-club.uk` links continue working.

**Rollback plan**: If `l.the-anchor.pub` DNS propagation or Vercel domain verification fails, revert the default in `base-url.ts` back to `https://vip-club.uk`. No existing links are affected since both domains hit the same redirect handler.

---

## 2. Reliability & Correctness Fixes

### 2.1 Non-blocking click tracking in redirect route

**File**: `src/app/api/redirect/[code]/route.ts`
**Problem**: Click insert + counter increment are `await`ed before sending the redirect. Every visitor waits for two DB round-trips.
**Fix**: Use `waitUntil` from `@vercel/functions` to fire click tracking after the redirect response is sent. The redirect returns immediately; tracking completes in the background.

**Important**: Only click tracking (lines 385-423) moves into `waitUntil`. Table payment recovery logic (lines 341-383) must remain synchronous — it modifies the destination URL before the redirect is sent.

```typescript
import { waitUntil } from '@vercel/functions'

// Table payment recovery happens BEFORE the redirect (synchronous)
// ... existing recovery logic ...

// Send redirect immediately
const response = NextResponse.redirect(redirectDestinationUrl)

// Track click in background (fire-and-forget)
waitUntil((async () => {
  // insert click + increment counter
})())

return response
```

### 2.2 Reuse singleton Supabase client in redirect route

**File**: `src/app/api/redirect/[code]/route.ts`
**Problem**: `createClient(url, key)` called fresh per request.
**Fix**: Import and use the existing `createAdminClient()` singleton from `src/lib/supabase/admin.ts` instead of constructing a new client.

### 2.3 Fix `resolveShortLink` fire-and-forget pattern

**File**: `src/services/short-links.ts`
**Problem**: The `void (async () => { ... })()` pattern doesn't survive serverless function teardown. Also doesn't filter bots.
**Fix**: Remove this method and its server action wrapper. Audit confirmed: `resolveShortLink` is only referenced in `src/services/short-links.ts` (definition) and `src/app/actions/short-links.ts` (server action wrapper). No actual consumer calls either. The redirect route has its own inline resolution logic. Remove both the service method and the `resolveShortLink` server action.

### 2.4 Extract shared `ShortLink` type

**Problem**: Same interface copy-pasted in `ShortLinksClient.tsx`, `ShortLinkFormModal.tsx`, `ShortLinkAnalyticsModal.tsx`.
**Fix**: Define once in `src/types/short-links.ts`, extending from the auto-generated `Database['public']['Tables']['short_links']['Row']` type in `src/types/database.ts` to avoid drift. Import everywhere.

### 2.5 Add `event_checkin` to form link types

**File**: `src/services/short-links.ts` (schema) + `ShortLinkFormModal.tsx` (dropdown)
**Problem**: `event_checkin` is a valid link type used by the event marketing system but missing from the create/edit schema and form dropdown.
**Fix**: Add to `CreateShortLinkSchema` enum and form `<Select>` options.

### 2.6 Fix expiry precision loss on edit

**File**: `ShortLinkFormModal.tsx`
**Problem**: Editing approximates expiry to nearest preset bucket. Save-without-change shifts the date.
**Fix**: Replace the preset dropdown with a proper date/time input. Show the actual `expires_at` value. If no expiry, show a "No expiry" checkbox with the option to set one.

### 2.7 Remove `loggedMissingAliasTable` flag

**File**: `src/app/api/redirect/[code]/route.ts`
**Problem**: Module-level `let` flag is reset on every cold start. Adds dead complexity.
**Fix**: Remove the flag. Log the warning every time (it's an error condition that should be fixed by applying migrations, not silenced).

### 2.8 Fix `allowedLinkTypes` dependency in `useEffect`

**File**: `ShortLinkFormModal.tsx`
**Problem**: `allowedLinkTypes` is a `new Set()` created on every render, referenced inside `useEffect` but not in deps array.
**Fix**: Move `allowedLinkTypes` outside the component as a module-level constant.

### 2.9 Replace `confirm()` with `AlertDialog`

**File**: `ShortLinksClient.tsx`
**Problem**: Browser `confirm()` used for delete, inconsistent with project UI patterns.
**Fix**: Use the project's `ConfirmDialog` component from `src/components/ui-v2/overlay/ConfirmDialog.tsx`. Show the link URL and a clear destructive action warning.

### 2.10 Use `dateUtils` for display dates

**Files**: `ShortLinksClient.tsx`, `ShortLinkAnalyticsModal.tsx`
**Problem**: Raw `new Date().toLocaleDateString()` and `.toLocaleString()` used instead of project's `formatDateInLondon()`.
**Fix**: Import and use `formatDateInLondon()` from `src/lib/dateUtils.ts` for all user-facing date displays.

---

## 3. Performance Optimisations

### 3.1 Paginate the short links list

**File**: `src/services/short-links.ts` (`getShortLinks`)
**Problem**: `select('*')` with no limit. Will degrade as link count grows.
**Fix**: Add server-side pagination with `range()`. Default page size 50. Use explicit pagination with page numbers and total count (not infinite scroll) — staff need to jump to specific pages and see total link count at a glance.

### 3.2 Eliminate redundant analytics detail call

**File**: `ShortLinkAnalyticsModal.tsx`
**Problem**: `getShortLinkAnalytics(shortCode)` fetches `click_count` and `last_clicked_at` which the parent already has.
**Fix**: Pass `link.click_count` and `link.last_clicked_at` as props. Only call `getShortLinkAnalyticsSummary` for the chart/demographics data.

### 3.3 Debounce insights page data fetching

**File**: `InsightsClient.tsx`
**Problem**: Every control change (granularity, bot toggle, date) triggers an immediate API call via the `useEffect` -> `loadVolumeData` chain.
**Fix**: Add a 300ms debounce before firing the API call. Cancel pending requests when a new one starts.

### 3.4 Scope Realtime subscription

**File**: `useShortLinkClickToasts.ts`
**Problem**: Subscribes to ALL `UPDATE` events on `short_links` table, including non-click updates.
**Fix**: Use Supabase Realtime's filter to scope the subscription, or at minimum add a client-side guard that checks `click_count` actually changed before showing a toast. (Supabase Realtime filter support for individual columns is limited, so a client-side delta check is the pragmatic fix.)

---

## 4. Feature Improvements

### 4.1 Link status badges

**Where**: Overview table + mobile cards
**What**: Show a colour-coded badge:
- **Active** (green) — no expiry or expiry in the future
- **Expiring soon** (amber) — expires within 7 days
- **Expired** (red) — past expiry date
**Complexity**: XS — purely UI, data already available.

### 4.2 Custom expiry date picker

**Where**: `ShortLinkFormModal.tsx`
**What**: Replace the 1d/7d/30d/never dropdown with a proper date/time picker component. Include a "No expiry" toggle.
**Complexity**: S — UI change, no backend changes.

### 4.3 QR code download with branding

**Where**: Overview table action buttons
**What**: Replace "copy QR to clipboard" with a dropdown: "Copy QR" / "Download QR (PNG)" / "Download QR (SVG)". Downloaded QR includes the short URL text below it and optionally the venue logo.
**Complexity**: S — uses existing `qrcode` library, adds canvas rendering for branded output.

### 4.4 "Test this link" (skip tracking)

**Where**: Overview table + redirect route
**What**: Add a "Test" button that opens `l.the-anchor.pub/xxx?_test=<signed_token>`. The redirect handler validates the token (HMAC-SHA256 of the short code signed with `CRON_SECRET`) before skipping click tracking. Unsigned or invalid `_test` params are ignored and tracking proceeds normally. This prevents public abuse of the tracking bypass.
**Complexity**: S — HMAC generation in UI (server action), validation in route, button in UI.

### 4.5 UTM Variant Links (Parent/Child Pattern)

**Where**: Short links overview page — new UI flow + server actions + DB changes
**Inspired by**: BARONS-BaronsHub `/src/components/links/` implementation

**Concept**: Create one parent link, then generate channel-specific UTM variant short links from it with a single click. No manual UTM parameter entry. This replaces the separate "UTM parameter builder" idea (4.9) with something far more powerful.

**User Flow**:
1. User creates a **parent link** (e.g. "Easter Sunday Lunch" -> `https://www.the-anchor.pub/events/easter-sunday-lunch`)
2. In the overview table, parent link row gets two new action buttons: **Share** (digital) and **Print** (physical)
3. Clicking **Share** shows a dropdown of digital channels:
   - Facebook, Instagram (Lnk.bio), Google Business Profile, Meta Ads, Newsletter, SMS, WhatsApp
4. Clicking a channel:
   - Takes the parent's destination URL
   - Appends UTM params automatically (`utm_source`, `utm_medium`, `utm_campaign`, `utm_content`)
   - `utm_campaign` = slugified parent name (e.g. `easter_sunday_lunch`)
   - Creates (or reuses) a variant short link pointing to the UTM-tagged URL
   - Auto-copies the short URL to clipboard
   - Shows toast: "Facebook link copied!"
5. Clicking **Print** shows a dropdown of physical channels:
   - Poster, Table Talker, Bar Strut, Flyer, Menu Insert
6. Clicking a print channel:
   - Same UTM baking as above
   - Downloads a branded QR code PNG instead of copying to clipboard

**Variant Display**:
- Parent links show with a chevron to expand/collapse their variants
- Variants shown indented beneath their parent with channel label badges
- Each variant shows its own click count independently
- Variant names follow pattern: `"Easter Sunday Lunch — Facebook"`

**Data Model Changes**:
- Add `parent_link_id UUID REFERENCES short_links(id) ON DELETE CASCADE` column to `short_links`
- Null = parent link, populated = variant of that parent
- Index: `CREATE INDEX idx_short_links_parent ON short_links (parent_link_id) WHERE parent_link_id IS NOT NULL;`

**Channel Configuration**:
- Reuse and extend the existing `EVENT_MARKETING_CHANNELS` config from `src/lib/event-marketing-links.ts`
- Add any missing channels (WhatsApp, Newsletter already exist; may need to add print-only channels)
- Each channel defines: `key`, `label`, `type` (digital/print), `utmSource`, `utmMedium`, `utmContent`

**Key Behaviours**:
- **Idempotent**: Clicking the same channel twice for the same parent reuses the existing variant (no duplicates)
- **Inheritance**: Variants inherit parent's `link_type` and `expires_at`
- **Grouping**: `getShortLinks()` returns links with parent/variant grouping. Client groups by `parent_link_id`
- **Backward compat**: Existing links with no `parent_link_id` continue to work as standalone links

**Server Actions**:
- `getOrCreateUtmVariant(parentId: string, channelKey: string)` — creates or returns existing variant
- Returns `{ short_code, full_url, already_exists }`

**Complexity**: L — DB migration, new server action, channel config, dropdown UI components, grouped table display, QR download for print channels.

### 4.6 Bulk actions

**Where**: Overview table
**What**: Checkbox selection on rows. Bulk actions toolbar appears: Delete selected, Export selected (CSV), Change type.
**Complexity**: M — needs multi-select state, confirmation modal for bulk delete, CSV generation.

### 4.7 Link grouping / tags

**Where**: DB schema + form + overview table + insights filters
**What**: Add a `tags text[]` column to `short_links`. Tags are free-form strings (e.g. "valentines-2026", "music-bingo"). Filterable in both the overview and insights pages. Migration must include a GIN index: `CREATE INDEX idx_short_links_tags ON short_links USING GIN (tags);` for acceptable query performance on tag filters.
**Complexity**: M — schema migration with index, form UI, filter UI.

### 4.8 Expired link cleanup cron

**Where**: New cron endpoint + `vercel.json`
**What**: Daily cron that hard-deletes links expired > 90 days ago (cascade deletes click data via FK). Before deletion, exports a summary (code, destination, total clicks, expiry date) to an audit log entry for traceability. Hard delete is simpler than soft-delete (no `deleted_at` column, no query filter changes) and appropriate since click data for 90-day-expired links has no ongoing value.
**Complexity**: S — new API route, one DB query, audit log entry, vercel.json entry.

### 4.9 Click-through rate for SMS links

**Where**: Analytics modal + insights page
**What**: For links with `metadata.source = 'sms_auto_shortener'`, cross-reference the Twilio message log to show CTR (clicks / sends). Display as a percentage alongside the raw click count.
**Complexity**: M — requires joining SMS send data with click data, likely a new RPC or view.

### 4.10 Link health monitoring

**Where**: New cron endpoint + status column on `short_links`
**What**: Weekly cron pings each destination URL with a HEAD request. Records HTTP status. Shows a health indicator (green tick / red cross) in the overview table for links returning non-2xx.
**Complexity**: M — new cron, new column, UI indicator. Rate limiting: max 10 concurrent HEAD requests, 5s timeout per request, batch size 50 per cron run. If the cron has more than 50 links to check, it processes the oldest-checked first and picks up the rest on the next run. Cron execution window should be set to 60s max duration.

### 4.11 Click heatmap (time-of-day)

**Where**: Insights page, new section
**What**: A grid heatmap showing click volume by day-of-week (rows) vs hour-of-day (columns). Data sourced from the existing `short_link_clicks.clicked_at` timestamps.
**Complexity**: M — new RPC to bucket clicks by dow/hour, heatmap chart component.

### 4.12 Geographic map visualisation

**Where**: Analytics modal + potentially insights page
**What**: Render click locations on a simple map using country/city data already captured. Use a lightweight map library (e.g. `react-simple-maps` or a static SVG world map with highlighted countries).
**Complexity**: M — new dependency, map component, data aggregation.

### 4.13 A/B destination testing

**Where**: DB schema + form + redirect route
**What**: Allow a short link to have multiple destination URLs with traffic split percentages. Redirect route randomly assigns visitors based on weights. Analytics show conversion comparison.
**Complexity**: XL — schema changes (multiple destinations per link with weights), weighted random routing, session affinity (repeat visitors see same variant), conversion tracking definition and implementation, comparison analytics UI. This is effectively its own sub-project and should be treated as a separate spec if prioritised.

### 4.14 Redirect via Edge Function

**Where**: New Edge Function replacing `/api/redirect/[code]/route.ts`
**What**: Move the redirect handler to an Edge Function for sub-millisecond cold starts. Use a cached lookup (Vercel Runtime Cache or Edge Config) for hot short codes. Fall back to DB for cache misses. Click tracking fires via `waitUntil`.
**Complexity**: L — architectural change, cache invalidation strategy needed.

---

## 5. Implementation Priority

### Phase 1: Domain Migration + Critical Fixes
1. Domain migration (section 1)
2. Non-blocking click tracking (2.1)
3. Singleton Supabase client (2.2)
4. Replace `confirm()` with ConfirmDialog (2.9)
5. Use `dateUtils` (2.10)
6. Extract shared types (2.4)
7. Fix expiry precision loss (2.6)
8. Add `event_checkin` link type (2.5)
9. Remove dead `loggedMissingAliasTable` flag (2.7)
10. Fix `allowedLinkTypes` dependency (2.8)
11. Remove dead `resolveShortLink` method and action (2.3)

### Phase 2: Performance
12. Paginate links list (3.1)
13. Eliminate redundant analytics call (3.2)
14. Debounce insights fetching (3.3)
15. Scope Realtime subscription (3.4)

### Phase 3: UTM Variant Links (Key Feature)
16. DB migration: add `parent_link_id` column (4.5)
17. Server action: `getOrCreateUtmVariant` (4.5)
18. UI: Share/Print dropdowns with channel config (4.5)
19. UI: Grouped parent/variant table display (4.5)
20. QR code download for print channels (4.3 + 4.5)

### Phase 4: Quick Feature Wins
21. Link status badges (4.1)
22. Custom expiry date picker (4.2)
23. "Test this link" button (4.4)

### Phase 5: Medium Features
24. Bulk actions (4.6)
25. Link grouping/tags (4.7)
26. Expired link cleanup cron (4.8)
27. Link health monitoring (4.10)
28. Click heatmap (4.11)

### Phase 6: Advanced Features
29. CTR for SMS links (4.9)
30. Geographic map (4.12)
31. A/B destination testing (4.13)
32. Edge Function redirect (4.14)

---

## 6. Out of Scope

- Retiring `vip-club.uk` domain (keep indefinitely for backward compat)
- Multi-venue / multi-brand domain management (not needed yet)
- Public-facing analytics dashboard (staff-only for now)
- Integration with external link shorteners (Bitly, etc.)
