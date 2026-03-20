# Insights Page Redesign — Design Spec

**Date**: 2026-03-20
**Status**: Reviewed
**Scope**: Replace the generic short link insights page with a campaign-performance-focused analytics dashboard

---

## 1. Goal

Rebuild the insights page so the primary view answers "which channels work?" for each campaign. The current page shows generic per-link volume data with no campaign or channel awareness. The new page uses the UTM variant system (parent + channel variants) to group and compare marketing performance.

---

## 2. Page Structure

### 2.1 Tab Navigation

Two tabs at the top of the content area (below the page header):

| Tab | Default | Purpose |
|-----|---------|---------|
| **Campaigns** | Yes | Channel leaderboard + campaign-grouped table |
| **All Links** | No | Flat per-link performance table with individual analytics |

Both tabs share the same controls bar.

### 2.2 Controls Bar (Simplified)

Replaces the current 5-select + 2-toggle-group + search + refresh layout. Simplified to:

| Control | Type | Options |
|---------|------|---------|
| Time Range | Preset select | Last 7 days, Last 14 days, Last 30 days, Last 90 days, Custom |
| Custom Start | datetime-local | Shown only when "Custom" is selected |
| Custom End | datetime-local | Shown only when "Custom" is selected |
| Traffic Filter | Toggle group | Human only (default) / Include bots |
| Search | Search input | Filters campaigns by name (Campaigns tab) or links by code/destination (All Links tab) |
| Refresh | Button | Manual refresh |

**Removed controls:**
- Granularity selector — hardcode to `day` for campaign view (keeps the API call simple, daily is the right resolution for campaign analysis)
- Sort dropdown — sorting is handled inline by clicking table column headers
- Metric toggle (clicks vs unique) — show both in the table; the leaderboard uses clicks

### 2.3 Summary Stats Row

Four stat cards shown on both tabs:

| Stat | Campaigns Tab | All Links Tab |
|------|--------------|---------------|
| 1 | Campaigns with Activity (parent links with clicked variants in period) | Active Links (total) |
| 2 | Total Human Clicks | Total Human Clicks |
| 3 | Total Unique Visitors | Total Unique Visitors |
| 4 | Top Channel (by clicks) | Top Link (by clicks) |

---

## 3. Campaigns Tab

### 3.1 Channel Leaderboard

A horizontal bar chart showing total clicks per channel across ALL campaigns in the selected period.

- Each bar = one channel (Facebook, SMS, Poster, etc.)
- Sorted by click count descending
- Colour-coded by channel type via a shared `CHANNEL_COLOURS` constant (defined in `src/lib/short-links/channels.ts` alongside the channel config):
  - **Digital channels**: blue tones
  - **Print channels**: amber tones
  - This constant is shared between `ChannelLeaderboard` and `ChannelMixBar` to avoid duplication
- Show click count value at the end of each bar
- Include channels with zero clicks (greyed out) so you can see which channels aren't being used

**Data source**: Sum `totalClicks` across all variant links grouped by `metadata.channel`.

### 3.2 Campaign Breakdown Table

Each row is a **parent link** (campaign).

**Columns:**

| Column | Content | Sortable |
|--------|---------|----------|
| Campaign | Parent link name + short code | Yes (by name) |
| Channels | Count of active channel variants (e.g. "5 channels") | No |
| Total Clicks | Sum of all variant clicks | Yes |
| Unique Visitors | Sum of all variant unique visitors | Yes |
| Top Channel | Channel with highest clicks + its count (e.g. "Facebook (45)") | No |
| Channel Mix | Inline stacked bar showing relative contribution of each channel | No |
| Created | Date created | Yes |

**Channel Mix column**: A small horizontal stacked bar (full width of the cell, ~120px) with segments coloured per channel. Hover shows tooltip: "Facebook: 45 (60%)". No labels on the bar itself — it's a visual summary.

**Expandable rows**: Click the row to expand and see individual channel variants:

| Sub-column | Content |
|------------|---------|
| Channel | Badge with channel label (e.g. "Facebook", "Poster") |
| Short Link | The variant's short URL |
| Clicks | Variant click count |
| Unique | Variant unique visitors |
| Actions | Copy link button |

**Standalone links section**: Parent links with zero variants and standalone links (no `parent_link_id`) appear in a collapsed "Other Links" section below the campaign table. Simple flat list with name, short code, clicks, unique visitors.

### 3.3 Empty States

- **No campaigns**: "No campaigns found in this period. Create a short link and use the Share/Print buttons to generate channel variants."
- **No data for filter**: "No results for '[search term]'. Try a broader search."

---

## 4. All Links Tab

A cleaned-up version of the current per-link table with better organisation.

### 4.1 Per-Link Performance Table

| Column | Content | Sortable |
|--------|---------|----------|
| Name | Link name (or "(no name)" + short code) | Yes |
| Short Link | Full short URL | No |
| Destination | Truncated destination URL | No |
| Type | Link type badge | Yes |
| Clicks | Total human clicks | Yes |
| Unique | Unique visitors | Yes |
| Actions | Copy, Open in new tab, View analytics modal |

The **View analytics** action opens the existing `ShortLinkAnalyticsModal`. Since the RPC response now includes `id`, `name`, and `parent_link_id` but not `created_at`, `expires_at`, or `last_clicked_at`, construct a partial `ShortLink` prop using the available fields and set missing date fields to `null`. The modal's `loadAnalytics` function calls `getShortLinkAnalyticsSummary(shortCode)` independently, so it doesn't need these fields for its core functionality — they're only used for the header display, where `null` renders as "N/A".

### 4.2 Differences from Current Page

**Removed:**
- The trend line chart (was confusing when showing aggregated data across unrelated links)
- The "Top Links" bar chart (redundant with the sortable table)
- The "Share %" column (not meaningful without campaign context)

**Kept:**
- Per-link table with search, sort, and mobile cards
- Link analytics modal for deep-dive

**Added:**
- The link name column (currently only shows on the overview page, not insights)
- Variant indicator — if a link is a variant, show the parent campaign name in a muted sub-label

---

## 5. Data Requirements

### 5.1 Extend `get_all_links_analytics_v2` Response

The current RPC returns: `short_code`, `link_type`, `destination_url`, `click_dates[]`, `click_counts[]`, `total_clicks`, `unique_visitors`.

**Add to the response:**
- `id` (from `short_links.id` — **critical** for parent/child grouping: variants reference their parent by `id`, not `short_code`)
- `name` (from `short_links.name`)
- `parent_link_id` (from `short_links.parent_link_id`)
- `metadata` (from `short_links.metadata` — needed to extract `channel` key for variant grouping)

This requires updating the RPC's SELECT clause and return type. No new tables or indexes needed.

**TypeScript**: Create a new `AnalyticsLinkRow` type in `src/types/short-links.ts` for the extended RPC response (distinct from the `ShortLink` type used by the overview page). This type includes `id`, `short_code`, `link_type`, `destination_url`, `name`, `parent_link_id`, `metadata`, `totalClicks`, `uniqueVisitors`, and `data` (time-series points).

**Note on INNER JOIN**: The existing RPC uses `INNER JOIN short_link_clicks`, so only links with at least one click in the period are returned. This is intentional — the Campaigns tab shows "Campaigns with Activity" not "All Campaigns." Zero-click campaigns can be seen on the overview page.

### 5.2 Client-Side Grouping

The client receives the flat list of all links with analytics. For the Campaigns tab, it:

1. Build a `Set<string>` of IDs that appear as `parent_link_id` in any link — these are "campaign parent" IDs
2. Classify each link:
   - **Campaign parent**: `parent_link_id IS NULL` AND `id` is in the parent ID Set
   - **Variant**: `parent_link_id IS NOT NULL`
   - **Standalone**: `parent_link_id IS NULL` AND `id` is NOT in the parent ID Set
3. Group variant links by `parent_link_id` into a `Map<string, AnalyticsLinkRow[]>`
4. For each campaign parent, sum variant clicks per channel (extracted from `metadata.channel`)
5. Build the channel leaderboard by summing across all campaigns
6. Sort campaigns by total clicks descending

This avoids a new RPC — all data is already fetched. The `id` field (added in the RPC extension) is the join key between parents and variants.

### 5.3 Granularity

Hardcode granularity to `day` for the API call. The Campaigns tab doesn't display time-series charts, so granularity only affects the bucket resolution of the underlying data (which we need for the All Links analytics modal). Daily is sufficient.

---

## 6. Component Architecture

### New Components

| Component | File | Responsibility |
|-----------|------|---------------|
| `InsightsClient` | Refactored in place | Controls bar, tab state, data fetching, routing to tab content |
| `CampaignsTab` | `insights/components/CampaignsTab.tsx` | Channel leaderboard + campaign table |
| `ChannelLeaderboard` | `insights/components/ChannelLeaderboard.tsx` | Horizontal bar chart of clicks per channel |
| `CampaignTable` | `insights/components/CampaignTable.tsx` | Grouped table with expandable rows |
| `ChannelMixBar` | `insights/components/ChannelMixBar.tsx` | Inline stacked bar for channel distribution |
| `AllLinksTab` | `insights/components/AllLinksTab.tsx` | Flat per-link table (cleaned-up current content) |

### Loading States

Loading state is owned by `InsightsClient` (parent), not individual tabs. The existing skeleton pattern (pulse animation with placeholder blocks) is shown while data is fetching. When data arrives, it's passed to whichever tab is active. Tab switching is instant — no re-fetch when toggling between Campaigns and All Links (same data, different view).

### Mobile Cards

Both tabs provide `renderMobileCard` for the DataTable:
- **CampaignTable**: Campaign name, channel count badge, total clicks, top channel, expand to see variants
- **AllLinksTab**: Link name, short URL, type badge, clicks, unique visitors, copy/open/analytics actions (same pattern as current, minus Share %)

### Removed/Replaced

| Current | Fate |
|---------|------|
| Trend line chart (`LineChart`) | Removed from insights (still used in analytics modal) |
| Top links bar chart (`BarChart`) | Replaced by `ChannelLeaderboard` |
| Performance breakdown table | Split into `CampaignTable` + `AllLinksTab` |
| Granularity controls | Removed |
| Sort dropdown | Removed (inline column sorting) |
| Metric toggle (clicks/unique) | Removed (show both in tables) |

---

## 7. Migration Plan for RPC

**Migration**: `supabase/migrations/YYYYMMDD_extend_analytics_v2_response.sql`

Update `get_all_links_analytics_v2` to include `name`, `parent_link_id`, and `metadata` in the return type and SELECT:

```sql
returns table (
  id uuid,                   -- NEW (critical for parent/child grouping)
  short_code varchar,
  link_type varchar,
  destination_url text,
  name varchar,              -- NEW
  parent_link_id uuid,       -- NEW
  metadata jsonb,            -- NEW
  click_dates timestamptz[],
  click_counts bigint[],
  total_clicks bigint,
  unique_visitors bigint
)
```

The `link_totals` CTE already joins `short_links` and references `sl.id`, so adding these columns is a straightforward SELECT extension. The `id` column is critical — without it, the client cannot match variants to their parents.

---

## 8. Out of Scope

- Time-series comparison between campaigns (overlaid line charts) — future enhancement
- Geographic map visualisation — separate spec
- Click heatmap by time-of-day — separate spec
- Export/download of analytics data — future enhancement
- Real-time click counter on the insights page (existing toast system already handles this)
