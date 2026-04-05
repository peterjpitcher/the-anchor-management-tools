# Insights Pages Design — MGD, Expenses, Mileage

**Date**: 2026-04-05
**Status**: Approved

## Overview

Add an "Insights" sub-page to each of the three financial sections (MGD, Expenses, Mileage) of the Anchor Management Tools app. Each insights page provides time-based trend visualisation via bar charts, summary statistics, and (where applicable) breakdowns by company or destination.

## Shared Architecture

### Routing

Each insights page is a sub-route of its parent section, accessible via a `HeaderNav` tab:

| Section | Main Page | Insights Page | HeaderNav Tabs |
|---------|-----------|---------------|----------------|
| MGD | `/mgd` | `/mgd/insights` | Collections \| Insights |
| Expenses | `/expenses` | `/expenses/insights` | Expenses \| Insights |
| Mileage | `/mileage` | `/mileage/insights` | Trips \| Destinations \| Insights |

### Page Layout (all three pages)

```
PageLayout (title, subtitle, HeaderNav)
  └─ Period pills (TabNav, pills variant)
  └─ StatGroup (3 stat cards, responsive grid)
  └─ Card: Bar chart (existing canvas BarChart component)
  └─ Card: Breakdown table (Expenses & Mileage only)
```

### Period Granularity

Users switch between time granularities using pill-style tabs (`TabNav` with `pills` variant):

- **MGD**: Quarterly (default) | Annually | All Time — no "Monthly" since MGD collections are sparse and quarters are the natural unit
- **Expenses**: Monthly (default) | Quarterly | Annually | All Time
- **Mileage**: Monthly (default) | Quarterly | Annually | All Time

Selecting a pill re-fetches data from the server action with the new granularity. The page renders server-side with the default granularity; the client component handles subsequent switches.

### Permissions

Each insights page requires the same `view` permission as its parent section:

- MGD Insights: `mgd:view`
- Expenses Insights: `expenses:view`
- Mileage Insights: `mileage:view`

### Components Used

- `PageLayout` from `src/components/ui-v2/` — page wrapper with title, subtitle
- `HeaderNav` from `src/components/ui-v2/` — section tab navigation
- `TabNav` from `src/components/ui-v2/` — period pill selector (pills variant)
- `StatGroup` + `Stat` from `src/components/ui-v2/` — summary stat cards
- `Card` from `src/components/ui-v2/` — chart and table containers
- `BarChart` from `src/components/charts/BarChart` — existing canvas-based bar chart

### File Structure (per section)

```
src/app/(authenticated)/{section}/insights/
  page.tsx                              — Server component (permission check, initial data fetch)
  _components/
    {Section}InsightsClient.tsx          — Client component (pills, stats, chart, table)
```

---

## MGD Insights

### Route

`/mgd/insights`

### Stat Cards

| Card | Value | Description |
|------|-------|-------------|
| Total Net Takings | Sum of `net_take` for visible periods | Currency formatted |
| Total MGD Due (20%) | Sum of `mgd_amount` for visible periods | Currency formatted |
| Total VAT on Supplier | Sum of `vat_on_supplier` for visible periods | Currency formatted |

### Bar Chart

- **X-axis**: One bar per MGD quarter (e.g. "Feb-Apr 2026") or per year, depending on granularity
- **Y-axis**: Net takings (£)
- **Format**: Currency (shorthand for large values)
- **Data source**: Aggregated from `mgd_collections` table, grouped by MGD quarter boundaries
- **All Time**: Shows all quarters as individual bars

### Breakdown Table

None — MGD has no company/vendor dimension.

### Server Action

```typescript
// In src/app/actions/mgd.ts
export async function getMgdInsights(
  granularity: 'quarterly' | 'annually' | 'all'
): Promise<{ bars: InsightBar[]; totals: MgdTotals }>
```

- Fetches all `mgd_collections`, groups by period based on granularity
- For `quarterly`: uses MGD quarter boundaries (Feb-Apr, May-Jul, Aug-Oct, Nov-Jan) via existing `getMgdQuarter()` utility
- For `annually`: groups by calendar year
- For `all`: returns all quarters as individual bars with overall totals
- Returns `bars` (label + net_take + mgd_amount + vat_on_supplier per period) and `totals` (sums across all visible bars)

### HeaderNav Integration

Add `HeaderNav` to both `/mgd/page.tsx` and `/mgd/insights/page.tsx`:

```
HeaderNav items:
  - { label: "Collections", href: "/mgd" }
  - { label: "Insights", href: "/mgd/insights" }
```

---

## Expenses Insights

### Route

`/expenses/insights`

### Stat Cards

| Card | Value | Description |
|------|-------|-------------|
| Total Spend | Sum of `amount` for visible periods | Currency formatted |
| VAT Reclaimable | Sum of `vat_amount` where `vat_applicable = true` | Currency formatted |
| Number of Expenses | Count of expense records | Integer |

### Bar Chart

- **X-axis**: One bar per month (e.g. "Jan 2026"), quarter, or year depending on granularity
- **Y-axis**: Total spend (£)
- **Format**: Currency (shorthand for large values)
- **Data source**: Aggregated from `expenses` table, grouped by `expense_date`
- **All Time**: Shows all months as individual bars with overall totals

### Breakdown Table: By Company

Displayed below the bar chart. Shows totals grouped by `company_ref` for the entire dataset within the visible time range.

| Column | Source | Format |
|--------|--------|--------|
| Company | `company_ref` | Text |
| Total | Sum of `amount` | Currency |
| VAT | Sum of `vat_amount` where applicable | Currency |
| Count | Count of records | Integer |

- Sorted by Total descending
- Shows all companies (no pagination — unlikely to exceed ~20-30 unique values)

### Server Action

```typescript
// In src/app/actions/expenses.ts
export async function getExpenseInsights(
  granularity: 'monthly' | 'quarterly' | 'annually' | 'all'
): Promise<{
  bars: InsightBar[];
  totals: ExpenseTotals;
  byCompany: CompanyBreakdown[];
}>
```

- Fetches all `expenses`, groups by period and by `company_ref`
- `bars`: label + amount + vat_amount per period
- `totals`: total_amount, total_vat, count
- `byCompany`: company_ref + total_amount + total_vat + count, sorted by total descending

### HeaderNav Integration

Add `HeaderNav` to both `/expenses/page.tsx` and `/expenses/insights/page.tsx`:

```
HeaderNav items:
  - { label: "Expenses", href: "/expenses" }
  - { label: "Insights", href: "/expenses/insights" }
```

---

## Mileage Insights

### Route

`/mileage/insights`

### Stat Cards

| Card | Value | Description |
|------|-------|-------------|
| Total Miles | Sum of `total_miles` for visible periods | Number with "mi" suffix |
| Total Amount Due | Sum of `amount_due` for visible periods | Currency formatted |
| Number of Trips | Count of trip records | Integer |

### Bar Chart

- **X-axis**: One bar per month (e.g. "Jan 2026"), quarter, or year depending on granularity
- **Y-axis**: Total miles
- **Format**: Number with "mi" suffix
- **Data source**: Aggregated from `mileage_trips` table, grouped by `trip_date`
- **All Time**: Shows all months as individual bars with overall totals

### Breakdown Table: By Destination

Displayed below the bar chart. Shows totals grouped by destination for the visible time range.

| Column | Source | Format |
|--------|--------|--------|
| Destination | `mileage_destinations.name` (via trip legs `to_destination_id`) | Text |
| Total Miles | Sum of leg `miles` to this destination | Number |
| Amount Due | Sum of `(leg.miles / trip.total_miles) * trip.amount_due` for legs to this destination | Currency |
| Trips | Count of distinct trips with a leg to this destination | Integer |

- Aggregated from `mileage_trip_legs` joined to `mileage_destinations`
- Excludes home base destination (The Anchor) — only shows where you're driving TO
- Sorted by Total Miles descending

### Server Action

```typescript
// In src/app/actions/mileage.ts
export async function getMileageInsights(
  granularity: 'monthly' | 'quarterly' | 'annually' | 'all'
): Promise<{
  bars: InsightBar[];
  totals: MileageTotals;
  byDestination: DestinationBreakdown[];
}>
```

- Fetches all `mileage_trips` with their legs, groups by period and by destination
- `bars`: label + total_miles + amount_due per period
- `totals`: total_miles, total_amount_due, trip_count
- `byDestination`: destination_name + total_miles + amount_due + trip_count, sorted by miles descending
- Home base destination filtered out of the breakdown

### HeaderNav Integration

Update existing `/mileage` navigation. Currently Mileage has Trips + Destinations as separate routes. Add Insights as a third tab:

```
HeaderNav items:
  - { label: "Trips", href: "/mileage" }
  - { label: "Destinations", href: "/mileage/destinations" }
  - { label: "Insights", href: "/mileage/insights" }
```

---

## Shared Types

```typescript
// In src/types/ or co-located with actions
interface InsightBar {
  label: string;        // e.g. "Jan 2026", "Q1 2026", "2026"
  periodStart: string;  // ISO date for sorting
  value: number;        // Primary metric (net_take / amount / total_miles)
  secondaryValue?: number; // Optional secondary metric
}

interface CompanyBreakdown {
  companyRef: string;
  totalAmount: number;
  totalVat: number;
  count: number;
}

interface DestinationBreakdown {
  destinationName: string;
  totalMiles: number;
  amountDue: number;
  tripCount: number;
}
```

---

## Implementation Notes

- **Existing BarChart**: The canvas-based `BarChart` at `src/components/charts/BarChart.tsx` already supports currency formatting, value labels, grid display, and label skipping for dense data. Use it directly.
- **Data aggregation**: All aggregation happens server-side in the action functions. The client receives pre-computed bars and breakdowns. No client-side data processing beyond rendering.
- **Quarter boundaries for MGD**: Use existing `getMgdQuarter()` from `src/lib/mgd/quarterMapping.ts` for correct Feb-Apr/May-Jul/Aug-Oct/Nov-Jan grouping.
- **Quarter boundaries for Expenses/Mileage**: Use standard calendar quarters (Jan-Mar, Apr-Jun, Jul-Sep, Oct-Dec).
- **Date formatting**: Use `formatDateInLondon()` from `src/lib/dateUtils.ts` for all date display.
- **Empty states**: If no data exists for the selected granularity, show an empty state message within the chart card area.
- **Responsive**: StatGroup handles responsive grid natively. BarChart is canvas-based and should resize. Breakdown tables use standard responsive table patterns.
