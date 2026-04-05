# Insights Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add insights sub-pages to MGD, Expenses, and Mileage sections with bar charts, stat cards, and breakdown tables.

**Architecture:** Each section gets a `/insights` sub-route with a server component (permission check + data fetch) and a client component (period pills + stats + chart + optional table). Server actions do all aggregation. Existing canvas `BarChart` component is reused. `HeaderNav` is added to each section to link between the main page and insights.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Supabase (PostgreSQL), Tailwind CSS, existing canvas BarChart component, ui-v2 components (PageLayout, HeaderNav, TabNav, StatGroup, Stat, Card).

**Spec:** `docs/superpowers/specs/2026-04-05-insights-pages-design.md`

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/app/(authenticated)/mgd/insights/page.tsx` | Server component: permission check, fetch MGD insights data |
| Create | `src/app/(authenticated)/mgd/insights/_components/MgdInsightsClient.tsx` | Client component: period pills, stat cards, bar chart |
| Modify | `src/app/(authenticated)/mgd/page.tsx` | Add HeaderNav with Collections/Insights tabs |
| Modify | `src/app/actions/mgd.ts` | Add `getMgdInsights()` server action + types |
| Create | `src/app/(authenticated)/expenses/insights/page.tsx` | Server component: permission check, fetch expense insights data |
| Create | `src/app/(authenticated)/expenses/insights/_components/ExpensesInsightsClient.tsx` | Client component: period pills, stat cards, bar chart, company breakdown table |
| Modify | `src/app/(authenticated)/expenses/page.tsx` | Add HeaderNav with Expenses/Insights tabs |
| Modify | `src/app/actions/expenses.ts` | Add `getExpenseInsights()` server action + types |
| Create | `src/app/(authenticated)/mileage/insights/page.tsx` | Server component: permission check, fetch mileage insights data |
| Create | `src/app/(authenticated)/mileage/insights/_components/MileageInsightsClient.tsx` | Client component: period pills, stat cards, bar chart, destination breakdown table |
| Modify | `src/app/(authenticated)/mileage/page.tsx` | Add "Insights" tab to existing HeaderNav |
| Modify | `src/app/(authenticated)/mileage/destinations/page.tsx` | Add HeaderNav (currently uses backButton) |
| Modify | `src/app/actions/mileage.ts` | Add `getMileageInsights()` server action + types |

---

## Task 1: MGD Insights — Server Action

**Files:**
- Modify: `src/app/actions/mgd.ts`

- [ ] **Step 1: Add insight types to mgd.ts**

Add these types after the existing `MgdReturn` interface (around line 41):

```typescript
// ---------------------------------------------------------------------------
// Insight Types
// ---------------------------------------------------------------------------

export type MgdGranularity = 'quarterly' | 'annually' | 'all'

export interface MgdInsightBar {
  label: string
  periodStart: string
  netTake: number
  mgdAmount: number
  vatOnSupplier: number
}

export interface MgdInsightTotals {
  totalNetTake: number
  totalMgd: number
  totalVatOnSupplier: number
}

export interface MgdInsightsData {
  bars: MgdInsightBar[]
  totals: MgdInsightTotals
}
```

- [ ] **Step 2: Implement getMgdInsights server action**

Add this function after the existing query functions in `mgd.ts`:

```typescript
/**
 * Fetch MGD collection data aggregated by period for insights charts.
 */
export async function getMgdInsights(
  granularity: MgdGranularity = 'quarterly'
): ActionResult<MgdInsightsData> {
  const auth = await requireMgdViewPermission()
  if ('error' in auth) return { error: auth.error }

  const db = createAdminClient()
  const { data, error } = await db
    .from('mgd_collections')
    .select('collection_date, net_take, mgd_amount, vat_on_supplier')
    .order('collection_date', { ascending: true })

  if (error) return { error: 'Failed to fetch MGD collections' }
  if (!data || data.length === 0) {
    return { success: true, data: { bars: [], totals: { totalNetTake: 0, totalMgd: 0, totalVatOnSupplier: 0 } } }
  }

  // Group collections into buckets based on granularity
  const buckets = new Map<string, { label: string; periodStart: string; netTake: number; mgdAmount: number; vatOnSupplier: number }>()

  for (const row of data) {
    const [y, m, d] = (row.collection_date as string).split('-').map(Number)
    const date = new Date(y, m - 1, d)
    let key: string
    let label: string
    let periodStart: string

    if (granularity === 'annually') {
      key = `${y}`
      label = `${y}`
      periodStart = `${y}-01-01`
    } else {
      // quarterly (default) and 'all' both show quarterly bars
      const q = getMgdQuarter(date)
      key = q.periodStart
      label = q.label
      periodStart = q.periodStart
    }

    const existing = buckets.get(key)
    if (existing) {
      existing.netTake += Number(row.net_take)
      existing.mgdAmount += Number(row.mgd_amount)
      existing.vatOnSupplier += Number(row.vat_on_supplier)
    } else {
      buckets.set(key, {
        label,
        periodStart,
        netTake: Number(row.net_take),
        mgdAmount: Number(row.mgd_amount),
        vatOnSupplier: Number(row.vat_on_supplier),
      })
    }
  }

  const bars: MgdInsightBar[] = Array.from(buckets.values()).sort(
    (a, b) => a.periodStart.localeCompare(b.periodStart)
  )

  const totals: MgdInsightTotals = bars.reduce(
    (acc, bar) => ({
      totalNetTake: acc.totalNetTake + bar.netTake,
      totalMgd: acc.totalMgd + bar.mgdAmount,
      totalVatOnSupplier: acc.totalVatOnSupplier + bar.vatOnSupplier,
    }),
    { totalNetTake: 0, totalMgd: 0, totalVatOnSupplier: 0 }
  )

  return { success: true, data: { bars, totals } }
}
```

- [ ] **Step 3: Verify the action compiles**

Run: `npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 4: Commit**

```bash
git add src/app/actions/mgd.ts
git commit -m "feat: add getMgdInsights server action for MGD insights page"
```

---

## Task 2: MGD Insights — Page and Client Component

**Files:**
- Create: `src/app/(authenticated)/mgd/insights/page.tsx`
- Create: `src/app/(authenticated)/mgd/insights/_components/MgdInsightsClient.tsx`
- Modify: `src/app/(authenticated)/mgd/page.tsx`

- [ ] **Step 1: Create the MGD insights server page**

Create `src/app/(authenticated)/mgd/insights/page.tsx`:

```typescript
import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { getMgdInsights } from '@/app/actions/mgd'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { Card } from '@/components/ui-v2/layout/Card'
import { MgdInsightsClient } from './_components/MgdInsightsClient'
import type { HeaderNavItem } from '@/components/ui-v2/navigation/HeaderNav'

const navItems: HeaderNavItem[] = [
  { label: 'Collections', href: '/mgd' },
  { label: 'Insights', href: '/mgd/insights' },
]

export default async function MgdInsightsPage(): Promise<React.ReactElement> {
  const canView = await checkUserPermission('mgd', 'view')
  if (!canView) redirect('/unauthorized')

  const result = await getMgdInsights('quarterly')

  if ('error' in result) {
    return (
      <PageLayout title="Machine Games Duty" subtitle="Insights" navItems={navItems}>
        <Card>
          <Alert variant="error" title="Error loading insights" description={result.error} />
        </Card>
      </PageLayout>
    )
  }

  return (
    <PageLayout title="Machine Games Duty" subtitle="Insights" navItems={navItems}>
      <MgdInsightsClient initialData={result.data!} />
    </PageLayout>
  )
}
```

- [ ] **Step 2: Create the MGD insights client component**

Create `src/app/(authenticated)/mgd/insights/_components/MgdInsightsClient.tsx`:

```typescript
'use client'

import { useState, useTransition } from 'react'
import { TabNav } from '@/components/ui-v2/navigation/TabNav'
import { StatGroup } from '@/components/ui-v2/data-display/StatGroup'
import { Stat } from '@/components/ui-v2/data-display/Stat'
import { Card } from '@/components/ui-v2/layout/Card'
import { BarChart } from '@/components/charts/BarChart'
import { getMgdInsights, type MgdInsightsData, type MgdGranularity } from '@/app/actions/mgd'

const PERIOD_TABS = [
  { key: 'quarterly' as const, label: 'Quarterly' },
  { key: 'annually' as const, label: 'Annually' },
  { key: 'all' as const, label: 'All Time' },
]

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(value)
}

interface MgdInsightsClientProps {
  initialData: MgdInsightsData
}

export function MgdInsightsClient({ initialData }: MgdInsightsClientProps): React.ReactElement {
  const [granularity, setGranularity] = useState<MgdGranularity>('quarterly')
  const [data, setData] = useState<MgdInsightsData>(initialData)
  const [isPending, startTransition] = useTransition()

  function handlePeriodChange(key: string): void {
    const newGranularity = key as MgdGranularity
    setGranularity(newGranularity)
    startTransition(async () => {
      const result = await getMgdInsights(newGranularity)
      if (!('error' in result) && result.data) {
        setData(result.data)
      }
    })
  }

  const chartData = data.bars.map((bar) => ({
    label: bar.label,
    value: bar.netTake,
  }))

  return (
    <div className="space-y-6">
      <TabNav
        tabs={PERIOD_TABS}
        activeKey={granularity}
        onChange={handlePeriodChange}
        variant="pills"
      />

      <StatGroup columns={3}>
        <Stat
          label="Total Net Takings"
          value={formatCurrency(data.totals.totalNetTake)}
          loading={isPending}
        />
        <Stat
          label="Total MGD Due (20%)"
          value={formatCurrency(data.totals.totalMgd)}
          loading={isPending}
        />
        <Stat
          label="Total VAT on Supplier"
          value={formatCurrency(data.totals.totalVatOnSupplier)}
          loading={isPending}
        />
      </StatGroup>

      <Card>
        <h3 className="text-lg font-semibold mb-4">Net Takings Over Time</h3>
        {chartData.length > 0 ? (
          <BarChart
            data={chartData}
            height={300}
            color="#10B981"
            formatType="shorthandCurrency"
          />
        ) : (
          <p className="text-gray-500 text-center py-12">No collection data available.</p>
        )}
      </Card>
    </div>
  )
}
```

- [ ] **Step 3: Add HeaderNav to the existing MGD page**

In `src/app/(authenticated)/mgd/page.tsx`, add the HeaderNav. Change the imports and add navItems:

Add import at the top:
```typescript
import type { HeaderNavItem } from '@/components/ui-v2/navigation/HeaderNav'
```

Add the navItems constant before the component function:
```typescript
const navItems: HeaderNavItem[] = [
  { label: 'Collections', href: '/mgd' },
  { label: 'Insights', href: '/mgd/insights' },
]
```

Update both `<PageLayout>` usages to include `navItems={navItems}`:

The error state return:
```typescript
<PageLayout title="Machine Games Duty" navItems={navItems}>
```

The success state return:
```typescript
<PageLayout title="Machine Games Duty" subtitle="Track collections and quarterly MGD returns" navItems={navItems}>
```

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 5: Commit**

```bash
git add src/app/\(authenticated\)/mgd/insights/ src/app/\(authenticated\)/mgd/page.tsx
git commit -m "feat: add MGD insights page with bar chart and stat cards"
```

---

## Task 3: Expenses Insights — Server Action

**Files:**
- Modify: `src/app/actions/expenses.ts`

- [ ] **Step 1: Add insight types to expenses.ts**

Add these types after the existing `ExpenseStats` interface:

```typescript
// ---------------------------------------------------------------------------
// Insight Types
// ---------------------------------------------------------------------------

export type ExpenseGranularity = 'monthly' | 'quarterly' | 'annually' | 'all'

export interface ExpenseInsightBar {
  label: string
  periodStart: string
  amount: number
  vatAmount: number
}

export interface ExpenseCompanyBreakdown {
  companyRef: string
  totalAmount: number
  totalVat: number
  count: number
}

export interface ExpenseInsightsData {
  bars: ExpenseInsightBar[]
  totals: { totalAmount: number; totalVat: number; count: number }
  byCompany: ExpenseCompanyBreakdown[]
}
```

- [ ] **Step 2: Implement getExpenseInsights server action**

Add this function after the existing query functions in `expenses.ts`:

```typescript
/**
 * Fetch expense data aggregated by period for insights charts,
 * plus a breakdown by company.
 */
export async function getExpenseInsights(
  granularity: ExpenseGranularity = 'monthly'
): Promise<{ success: boolean; data?: ExpenseInsightsData; error?: string }> {
  try {
    await requireExpensePermission('view')
    const supabase = createAdminClient()

    const { data, error } = await supabase
      .from('expenses')
      .select('expense_date, amount, vat_applicable, vat_amount, company_ref')
      .order('expense_date', { ascending: true })

    if (error) {
      logger.error('Failed to fetch expense insights', { error: error as unknown as Error })
      return { success: false, error: 'Failed to fetch expense insights' }
    }

    if (!data || data.length === 0) {
      return {
        success: true,
        data: {
          bars: [],
          totals: { totalAmount: 0, totalVat: 0, count: 0 },
          byCompany: [],
        },
      }
    }

    // Group by period
    const buckets = new Map<string, { label: string; periodStart: string; amount: number; vatAmount: number }>()

    for (const row of data) {
      const dateStr = row.expense_date as string
      const [y, m] = dateStr.split('-').map(Number)
      let key: string
      let label: string
      let periodStart: string

      if (granularity === 'annually') {
        key = `${y}`
        label = `${y}`
        periodStart = `${y}-01-01`
      } else if (granularity === 'quarterly') {
        const q = Math.ceil(m / 3)
        const qStart = (q - 1) * 3 + 1
        key = `${y}-Q${q}`
        label = `Q${q} ${y}`
        periodStart = `${y}-${String(qStart).padStart(2, '0')}-01`
      } else {
        // monthly (default) and 'all' both show monthly bars
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
        key = `${y}-${String(m).padStart(2, '0')}`
        label = `${monthNames[m - 1]} ${y}`
        periodStart = `${y}-${String(m).padStart(2, '0')}-01`
      }

      const amt = Number(row.amount)
      const vat = row.vat_applicable ? Number(row.vat_amount) : 0

      const existing = buckets.get(key)
      if (existing) {
        existing.amount += amt
        existing.vatAmount += vat
      } else {
        buckets.set(key, { label, periodStart, amount: amt, vatAmount: vat })
      }
    }

    const bars: ExpenseInsightBar[] = Array.from(buckets.values()).sort(
      (a, b) => a.periodStart.localeCompare(b.periodStart)
    )

    // Group by company
    const companyMap = new Map<string, { totalAmount: number; totalVat: number; count: number }>()
    for (const row of data) {
      const ref = (row.company_ref as string).trim()
      const existing = companyMap.get(ref)
      const amt = Number(row.amount)
      const vat = row.vat_applicable ? Number(row.vat_amount) : 0
      if (existing) {
        existing.totalAmount += amt
        existing.totalVat += vat
        existing.count += 1
      } else {
        companyMap.set(ref, { totalAmount: amt, totalVat: vat, count: 1 })
      }
    }

    const byCompany: ExpenseCompanyBreakdown[] = Array.from(companyMap.entries())
      .map(([companyRef, vals]) => ({ companyRef, ...vals }))
      .sort((a, b) => b.totalAmount - a.totalAmount)

    const totals = {
      totalAmount: data.reduce((sum, row) => sum + Number(row.amount), 0),
      totalVat: data.reduce((sum, row) => sum + (row.vat_applicable ? Number(row.vat_amount) : 0), 0),
      count: data.length,
    }

    return { success: true, data: { bars, totals, byCompany } }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch expense insights'
    return { success: false, error: message }
  }
}
```

- [ ] **Step 3: Verify the action compiles**

Run: `npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 4: Commit**

```bash
git add src/app/actions/expenses.ts
git commit -m "feat: add getExpenseInsights server action for expenses insights page"
```

---

## Task 4: Expenses Insights — Page and Client Component

**Files:**
- Create: `src/app/(authenticated)/expenses/insights/page.tsx`
- Create: `src/app/(authenticated)/expenses/insights/_components/ExpensesInsightsClient.tsx`
- Modify: `src/app/(authenticated)/expenses/page.tsx`

- [ ] **Step 1: Create the expenses insights server page**

Create `src/app/(authenticated)/expenses/insights/page.tsx`:

```typescript
import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { getExpenseInsights } from '@/app/actions/expenses'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { ExpensesInsightsClient } from './_components/ExpensesInsightsClient'
import type { HeaderNavItem } from '@/components/ui-v2/navigation/HeaderNav'

const navItems: HeaderNavItem[] = [
  { label: 'Expenses', href: '/expenses' },
  { label: 'Insights', href: '/expenses/insights' },
]

export default async function ExpensesInsightsPage(): Promise<React.JSX.Element> {
  const canView = await checkUserPermission('expenses', 'view')
  if (!canView) redirect('/unauthorized')

  const result = await getExpenseInsights('monthly')

  if (!result.success || !result.data) {
    return (
      <PageLayout title="Expenses" subtitle="Insights" navItems={navItems}>
        <Alert variant="error" title="Error loading insights" description={result.error ?? 'Unknown error'} />
      </PageLayout>
    )
  }

  return (
    <PageLayout title="Expenses" subtitle="Insights" navItems={navItems}>
      <ExpensesInsightsClient initialData={result.data} />
    </PageLayout>
  )
}
```

- [ ] **Step 2: Create the expenses insights client component**

Create `src/app/(authenticated)/expenses/insights/_components/ExpensesInsightsClient.tsx`:

```typescript
'use client'

import { useState, useTransition } from 'react'
import { TabNav } from '@/components/ui-v2/navigation/TabNav'
import { StatGroup } from '@/components/ui-v2/data-display/StatGroup'
import { Stat } from '@/components/ui-v2/data-display/Stat'
import { Card } from '@/components/ui-v2/layout/Card'
import { BarChart } from '@/components/charts/BarChart'
import {
  getExpenseInsights,
  type ExpenseInsightsData,
  type ExpenseGranularity,
} from '@/app/actions/expenses'

const PERIOD_TABS = [
  { key: 'monthly' as const, label: 'Monthly' },
  { key: 'quarterly' as const, label: 'Quarterly' },
  { key: 'annually' as const, label: 'Annually' },
  { key: 'all' as const, label: 'All Time' },
]

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(value)
}

interface ExpensesInsightsClientProps {
  initialData: ExpenseInsightsData
}

export function ExpensesInsightsClient({ initialData }: ExpensesInsightsClientProps): React.ReactElement {
  const [granularity, setGranularity] = useState<ExpenseGranularity>('monthly')
  const [data, setData] = useState<ExpenseInsightsData>(initialData)
  const [isPending, startTransition] = useTransition()

  function handlePeriodChange(key: string): void {
    const newGranularity = key as ExpenseGranularity
    setGranularity(newGranularity)
    startTransition(async () => {
      const result = await getExpenseInsights(newGranularity)
      if (result.success && result.data) {
        setData(result.data)
      }
    })
  }

  const chartData = data.bars.map((bar) => ({
    label: bar.label,
    value: bar.amount,
  }))

  return (
    <div className="space-y-6">
      <TabNav
        tabs={PERIOD_TABS}
        activeKey={granularity}
        onChange={handlePeriodChange}
        variant="pills"
      />

      <StatGroup columns={3}>
        <Stat
          label="Total Spend"
          value={formatCurrency(data.totals.totalAmount)}
          loading={isPending}
        />
        <Stat
          label="VAT Reclaimable"
          value={formatCurrency(data.totals.totalVat)}
          loading={isPending}
        />
        <Stat
          label="Number of Expenses"
          value={data.totals.count.toLocaleString('en-GB')}
          loading={isPending}
        />
      </StatGroup>

      <Card>
        <h3 className="text-lg font-semibold mb-4">Expenses Over Time</h3>
        {chartData.length > 0 ? (
          <BarChart
            data={chartData}
            height={300}
            color="#10B981"
            formatType="shorthandCurrency"
          />
        ) : (
          <p className="text-gray-500 text-center py-12">No expense data available.</p>
        )}
      </Card>

      {data.byCompany.length > 0 && (
        <Card>
          <h3 className="text-lg font-semibold mb-4">By Company</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 pr-4 font-medium text-gray-500">Company</th>
                  <th className="text-right py-2 px-4 font-medium text-gray-500">Total</th>
                  <th className="text-right py-2 px-4 font-medium text-gray-500">VAT</th>
                  <th className="text-right py-2 pl-4 font-medium text-gray-500">Count</th>
                </tr>
              </thead>
              <tbody>
                {data.byCompany.map((company) => (
                  <tr key={company.companyRef} className="border-b border-gray-100">
                    <td className="py-2 pr-4">{company.companyRef}</td>
                    <td className="text-right py-2 px-4">{formatCurrency(company.totalAmount)}</td>
                    <td className="text-right py-2 px-4">{formatCurrency(company.totalVat)}</td>
                    <td className="text-right py-2 pl-4">{company.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Add HeaderNav to the existing expenses page**

In `src/app/(authenticated)/expenses/page.tsx`, add the HeaderNav.

Add import at the top:
```typescript
import type { HeaderNavItem } from '@/components/ui-v2/navigation/HeaderNav'
```

Add the navItems constant before the component function:
```typescript
const navItems: HeaderNavItem[] = [
  { label: 'Expenses', href: '/expenses' },
  { label: 'Insights', href: '/expenses/insights' },
]
```

Update both `<PageLayout>` usages to include `navItems={navItems}`:

The error state return:
```typescript
<PageLayout title="Expenses" subtitle="Track and manage business expenses with receipt images." navItems={navItems}>
```

The success state return:
```typescript
<PageLayout title="Expenses" subtitle="Track and manage business expenses with receipt images." navItems={navItems}>
```

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 5: Commit**

```bash
git add src/app/\(authenticated\)/expenses/insights/ src/app/\(authenticated\)/expenses/page.tsx
git commit -m "feat: add expenses insights page with bar chart, stats, and company breakdown"
```

---

## Task 5: Mileage Insights — Server Action

**Files:**
- Modify: `src/app/actions/mileage.ts`

- [ ] **Step 1: Add insight types to mileage.ts**

Add these types after the existing `DistanceCacheEntry` interface:

```typescript
// ---------------------------------------------------------------------------
// Insight Types
// ---------------------------------------------------------------------------

export type MileageGranularity = 'monthly' | 'quarterly' | 'annually' | 'all'

export interface MileageInsightBar {
  label: string
  periodStart: string
  totalMiles: number
  amountDue: number
}

export interface MileageDestinationBreakdown {
  destinationName: string
  totalMiles: number
  amountDue: number
  tripCount: number
}

export interface MileageInsightsData {
  bars: MileageInsightBar[]
  totals: { totalMiles: number; totalAmountDue: number; tripCount: number }
  byDestination: MileageDestinationBreakdown[]
}
```

- [ ] **Step 2: Implement getMileageInsights server action**

Add this function after the existing query functions in `mileage.ts`:

```typescript
/**
 * Fetch mileage trip data aggregated by period for insights charts,
 * plus a breakdown by destination.
 */
export async function getMileageInsights(
  granularity: MileageGranularity = 'monthly'
): Promise<{ success: boolean; data?: MileageInsightsData; error?: string }> {
  try {
    await requireMileagePermission('view')
    const supabase = createAdminClient()

    // Fetch all trips
    const { data: trips, error: tripError } = await supabase
      .from('mileage_trips')
      .select('id, trip_date, total_miles, amount_due')
      .order('trip_date', { ascending: true })

    if (tripError) return { success: false, error: 'Failed to fetch mileage trips' }

    if (!trips || trips.length === 0) {
      return {
        success: true,
        data: {
          bars: [],
          totals: { totalMiles: 0, totalAmountDue: 0, tripCount: 0 },
          byDestination: [],
        },
      }
    }

    // Group trips into period buckets
    const buckets = new Map<string, { label: string; periodStart: string; totalMiles: number; amountDue: number }>()

    for (const trip of trips) {
      const dateStr = trip.trip_date as string
      const [y, m] = dateStr.split('-').map(Number)
      let key: string
      let label: string
      let periodStart: string

      if (granularity === 'annually') {
        key = `${y}`
        label = `${y}`
        periodStart = `${y}-01-01`
      } else if (granularity === 'quarterly') {
        const q = Math.ceil(m / 3)
        const qStart = (q - 1) * 3 + 1
        key = `${y}-Q${q}`
        label = `Q${q} ${y}`
        periodStart = `${y}-${String(qStart).padStart(2, '0')}-01`
      } else {
        // monthly (default) and 'all' both show monthly bars
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
        key = `${y}-${String(m).padStart(2, '0')}`
        label = `${monthNames[m - 1]} ${y}`
        periodStart = `${y}-${String(m).padStart(2, '0')}-01`
      }

      const miles = Number(trip.total_miles)
      const amt = Number(trip.amount_due)

      const existing = buckets.get(key)
      if (existing) {
        existing.totalMiles += miles
        existing.amountDue += amt
      } else {
        buckets.set(key, { label, periodStart, totalMiles: miles, amountDue: amt })
      }
    }

    const bars: MileageInsightBar[] = Array.from(buckets.values()).sort(
      (a, b) => a.periodStart.localeCompare(b.periodStart)
    )

    // Fetch trip legs with destination names for breakdown
    const tripIds = trips.map((t) => t.id as string)
    const { data: legs, error: legError } = await supabase
      .from('mileage_trip_legs')
      .select('trip_id, miles, to_destination_id, mileage_destinations!mileage_trip_legs_to_destination_id_fkey(name, is_home_base)')
      .in('trip_id', tripIds)

    if (legError) return { success: false, error: 'Failed to fetch trip legs' }

    // Build trip lookup for amount_due proportioning
    const tripLookup = new Map(trips.map((t) => [t.id as string, { totalMiles: Number(t.total_miles), amountDue: Number(t.amount_due) }]))

    // Group legs by destination (excluding home base)
    const destMap = new Map<string, { totalMiles: number; amountDue: number; tripIds: Set<string> }>()

    for (const leg of legs ?? []) {
      const dest = leg.mileage_destinations as unknown as { name: string; is_home_base: boolean } | null
      if (!dest || dest.is_home_base) continue

      const destName = dest.name
      const legMiles = Number(leg.miles)
      const trip = tripLookup.get(leg.trip_id as string)
      const legAmountDue = trip && trip.totalMiles > 0
        ? (legMiles / trip.totalMiles) * trip.amountDue
        : 0

      const existing = destMap.get(destName)
      if (existing) {
        existing.totalMiles += legMiles
        existing.amountDue += legAmountDue
        existing.tripIds.add(leg.trip_id as string)
      } else {
        destMap.set(destName, {
          totalMiles: legMiles,
          amountDue: legAmountDue,
          tripIds: new Set([leg.trip_id as string]),
        })
      }
    }

    const byDestination: MileageDestinationBreakdown[] = Array.from(destMap.entries())
      .map(([destinationName, vals]) => ({
        destinationName,
        totalMiles: Math.round(vals.totalMiles * 10) / 10,
        amountDue: Math.round(vals.amountDue * 100) / 100,
        tripCount: vals.tripIds.size,
      }))
      .sort((a, b) => b.totalMiles - a.totalMiles)

    const totals = {
      totalMiles: trips.reduce((sum, t) => sum + Number(t.total_miles), 0),
      totalAmountDue: trips.reduce((sum, t) => sum + Number(t.amount_due), 0),
      tripCount: trips.length,
    }

    return { success: true, data: { bars, totals, byDestination } }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch mileage insights'
    return { success: false, error: message }
  }
}
```

- [ ] **Step 3: Verify the action compiles**

Run: `npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 4: Commit**

```bash
git add src/app/actions/mileage.ts
git commit -m "feat: add getMileageInsights server action for mileage insights page"
```

---

## Task 6: Mileage Insights — Page and Client Component

**Files:**
- Create: `src/app/(authenticated)/mileage/insights/page.tsx`
- Create: `src/app/(authenticated)/mileage/insights/_components/MileageInsightsClient.tsx`
- Modify: `src/app/(authenticated)/mileage/page.tsx`
- Modify: `src/app/(authenticated)/mileage/destinations/page.tsx`

- [ ] **Step 1: Create the mileage insights server page**

Create `src/app/(authenticated)/mileage/insights/page.tsx`:

```typescript
import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { getMileageInsights } from '@/app/actions/mileage'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { MileageInsightsClient } from './_components/MileageInsightsClient'
import type { HeaderNavItem } from '@/components/ui-v2/navigation/HeaderNav'

const navItems: HeaderNavItem[] = [
  { label: 'Trips', href: '/mileage' },
  { label: 'Destinations', href: '/mileage/destinations' },
  { label: 'Insights', href: '/mileage/insights' },
]

export default async function MileageInsightsPage(): Promise<React.JSX.Element> {
  const canView = await checkUserPermission('mileage', 'view')
  if (!canView) redirect('/unauthorized')

  const result = await getMileageInsights('monthly')

  if (!result.success || !result.data) {
    return (
      <PageLayout title="Mileage" subtitle="Insights" navItems={navItems}>
        <Alert variant="error" title="Error loading insights" description={result.error ?? 'Unknown error'} />
      </PageLayout>
    )
  }

  return (
    <PageLayout title="Mileage" subtitle="Insights" navItems={navItems}>
      <MileageInsightsClient initialData={result.data} />
    </PageLayout>
  )
}
```

- [ ] **Step 2: Create the mileage insights client component**

Create `src/app/(authenticated)/mileage/insights/_components/MileageInsightsClient.tsx`:

```typescript
'use client'

import { useState, useTransition } from 'react'
import { TabNav } from '@/components/ui-v2/navigation/TabNav'
import { StatGroup } from '@/components/ui-v2/data-display/StatGroup'
import { Stat } from '@/components/ui-v2/data-display/Stat'
import { Card } from '@/components/ui-v2/layout/Card'
import { BarChart } from '@/components/charts/BarChart'
import {
  getMileageInsights,
  type MileageInsightsData,
  type MileageGranularity,
} from '@/app/actions/mileage'

const PERIOD_TABS = [
  { key: 'monthly' as const, label: 'Monthly' },
  { key: 'quarterly' as const, label: 'Quarterly' },
  { key: 'annually' as const, label: 'Annually' },
  { key: 'all' as const, label: 'All Time' },
]

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(value)
}

interface MileageInsightsClientProps {
  initialData: MileageInsightsData
}

export function MileageInsightsClient({ initialData }: MileageInsightsClientProps): React.ReactElement {
  const [granularity, setGranularity] = useState<MileageGranularity>('monthly')
  const [data, setData] = useState<MileageInsightsData>(initialData)
  const [isPending, startTransition] = useTransition()

  function handlePeriodChange(key: string): void {
    const newGranularity = key as MileageGranularity
    setGranularity(newGranularity)
    startTransition(async () => {
      const result = await getMileageInsights(newGranularity)
      if (result.success && result.data) {
        setData(result.data)
      }
    })
  }

  const chartData = data.bars.map((bar) => ({
    label: bar.label,
    value: bar.totalMiles,
  }))

  return (
    <div className="space-y-6">
      <TabNav
        tabs={PERIOD_TABS}
        activeKey={granularity}
        onChange={handlePeriodChange}
        variant="pills"
      />

      <StatGroup columns={3}>
        <Stat
          label="Total Miles"
          value={`${data.totals.totalMiles.toLocaleString('en-GB', { maximumFractionDigits: 1 })} mi`}
          loading={isPending}
        />
        <Stat
          label="Total Amount Due"
          value={formatCurrency(data.totals.totalAmountDue)}
          loading={isPending}
        />
        <Stat
          label="Number of Trips"
          value={data.totals.tripCount.toLocaleString('en-GB')}
          loading={isPending}
        />
      </StatGroup>

      <Card>
        <h3 className="text-lg font-semibold mb-4">Miles Over Time</h3>
        {chartData.length > 0 ? (
          <BarChart
            data={chartData}
            height={300}
            color="#10B981"
            formatType="number"
          />
        ) : (
          <p className="text-gray-500 text-center py-12">No mileage data available.</p>
        )}
      </Card>

      {data.byDestination.length > 0 && (
        <Card>
          <h3 className="text-lg font-semibold mb-4">By Destination</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 pr-4 font-medium text-gray-500">Destination</th>
                  <th className="text-right py-2 px-4 font-medium text-gray-500">Miles</th>
                  <th className="text-right py-2 px-4 font-medium text-gray-500">Amount Due</th>
                  <th className="text-right py-2 pl-4 font-medium text-gray-500">Trips</th>
                </tr>
              </thead>
              <tbody>
                {data.byDestination.map((dest) => (
                  <tr key={dest.destinationName} className="border-b border-gray-100">
                    <td className="py-2 pr-4">{dest.destinationName}</td>
                    <td className="text-right py-2 px-4">{dest.totalMiles.toLocaleString('en-GB', { maximumFractionDigits: 1 })}</td>
                    <td className="text-right py-2 px-4">{formatCurrency(dest.amountDue)}</td>
                    <td className="text-right py-2 pl-4">{dest.tripCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Update mileage page HeaderNav to include Insights**

In `src/app/(authenticated)/mileage/page.tsx`, update the existing `navItems` array (line 8-11) to add the Insights tab:

Change:
```typescript
const navItems: HeaderNavItem[] = [
  { label: 'Trips', href: '/mileage' },
  { label: 'Destinations', href: '/mileage/destinations' },
]
```

To:
```typescript
const navItems: HeaderNavItem[] = [
  { label: 'Trips', href: '/mileage' },
  { label: 'Destinations', href: '/mileage/destinations' },
  { label: 'Insights', href: '/mileage/insights' },
]
```

- [ ] **Step 4: Update mileage destinations page to use HeaderNav instead of backButton**

In `src/app/(authenticated)/mileage/destinations/page.tsx`, replace the backButton with navItems to keep navigation consistent across all mileage sub-pages.

Add import:
```typescript
import type { HeaderNavItem } from '@/components/ui-v2/navigation/HeaderNav'
```

Add navItems constant:
```typescript
const navItems: HeaderNavItem[] = [
  { label: 'Trips', href: '/mileage' },
  { label: 'Destinations', href: '/mileage/destinations' },
  { label: 'Insights', href: '/mileage/insights' },
]
```

Update `<PageLayout>` to use `navItems={navItems}` instead of `backButton={...}`.

- [ ] **Step 5: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 6: Commit**

```bash
git add src/app/\(authenticated\)/mileage/insights/ src/app/\(authenticated\)/mileage/page.tsx src/app/\(authenticated\)/mileage/destinations/page.tsx
git commit -m "feat: add mileage insights page with bar chart, stats, and destination breakdown"
```

---

## Task 7: Build Verification

- [ ] **Step 1: Run lint**

Run: `npm run lint`
Expected: Zero errors, zero warnings

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: Clean compilation

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: All existing tests pass

- [ ] **Step 4: Run production build**

Run: `npm run build`
Expected: Successful build with no errors

- [ ] **Step 5: Manual smoke test**

Run: `npm run dev`

Verify in browser:
1. Navigate to `/mgd` — should show HeaderNav with "Collections" and "Insights" tabs
2. Click "Insights" tab — should navigate to `/mgd/insights` showing period pills, stat cards, and bar chart
3. Switch between Quarterly/Annually/All Time — stats and chart should update
4. Navigate to `/expenses` — should show HeaderNav with "Expenses" and "Insights" tabs
5. Click "Insights" tab — should show period pills, stat cards, bar chart, and company breakdown table
6. Switch between Monthly/Quarterly/Annually/All Time — all sections should update
7. Navigate to `/mileage` — should show HeaderNav with "Trips", "Destinations", and "Insights" tabs
8. Click "Insights" tab — should show period pills, stat cards, bar chart, and destination breakdown table
9. Click "Destinations" tab — should show HeaderNav (not a back button) with same three tabs

- [ ] **Step 6: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: address lint/type/build issues from insights pages"
```
