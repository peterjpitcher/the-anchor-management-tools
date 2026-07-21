# Weekly Checklist Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use the /implement-plan skill (multiple coordinated subagents) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. This is a READ-ONLY, super-admin-only reporting feature. No DB migration. Do NOT deploy or merge to main; build on branch `feat/checklist-weekly-review` and hand back for owner review.

**Goal:** Add a super-admin "Weekly review" tab under `/checklists/manage` that shows, for a chosen Monday to Sunday week, every checklist task across all 7 days as done / missed / skipped / not-applicable / pending / not-due, with who did each one and when, so a manager can scan a week and follow up on gaps.

**Architecture:** A new Server Component page reads data via one `'use server'` action (`getWeeklyReview`) that uses the service-role admin client (checklist_* is RLS deny-all) behind an explicit `super_admin` role check. The action reads pre-generated `checklist_task_instances` for the week's `business_date` range (missed is a STORED state, never computed), the per-date `checklist_generation_runs` status (so a failed or absent generation is not shown as a clean blank), and resolves employee names. A pure function assembles rows keyed by `(template_id, slot)` across 7 date cells. A client component renders an accessible sticky table with day-part groups, department and day-part filters, week navigation, and a click (not hover) detail drawer.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript strict, Tailwind v4, Supabase (service-role client), Vitest + @testing-library/react. Node 20 (`nvm use`) for build.

---

## Locked assumptions (owner did not answer the 5 decisions; proceeding on recommendations; revisit at review)

1. Deliverable is the **positive weekly grid** (the direct answer to "full week, done and not done"). The separate "add missed-task detail to Problems" enhancement is OUT of this plan (fast-follow).
2. Date columns are the task's **due business day** (`business_date`); the actual completion timestamp is shown on the cell drill-down.
3. Access is **super_admin only** (reuse `requireSuperAdmin`), all departments. No manager access in v1.
4. v1 **identifies** follow-ups only; it does not assign, track, or close them, and does not mutate any data.
5. Week is **Monday to Sunday**, computed from the current business date (London, 06:00 business-day roll-over).

## Data facts the implementer must respect (from discovery and developer review, verified in repo and prod)

- `checklist_task_instances` columns used: `template_id, business_date (date), slot (text), department (text), title_snapshot, instruction_snapshot, state, completed_by_employee_id, completed_at, was_late, requires_value, value_recorded, value_unit, value_min, value_max, value_breach, skip_reason, is_spot_checkable, accountable_employee_id, id`.
- `state` enum is FIVE values: `pending`, `done`, `missed`, `skipped`, `not_applicable`. Handle all five.
- `missed` is a STORED state (daily sweep flips `pending` to `missed` after `grace_until`). Read it; do NOT infer absence from template schedules.
- DB unique key is `(template_id, business_date, slot)`. A task can therefore have several rows on one day via different `slot` values (e.g. an "every 2 hours" template). Model one grid ROW per `(template_id, slot)`, so each cell maps to at most one instance.
- Slots seen: `open`, `close`, and `anytime` (floating/periodic, venue-level). Timed templates may use `HH:MM`-style slots. Map to display day-parts: `open` becomes Opening, `HH:MM` becomes During service, `close` becomes Closing, `anytime` becomes Anytime/periodic.
- `checklist_generation_runs`: `business_date, status, started_at, finished_at`. Use the LATEST run per date to derive a date-level health state (complete / running / failed / skipped_closed / none). A date whose generation is not `complete` must NOT render its empty cells as clean "not scheduled".
- Only the **bar** department currently generates data (~294 rows/week); paginate defensively anyway with the `fetchAllRows` pattern.
- Reusable private helpers exist in `src/app/actions/checklists-spotcheck.ts`: `requireSuperAdmin()` (:127), `resolveWindow()` (:87), `fetchAllRows<T>()` (:99), `fetchEmployeeNames()` (name map, "Unknown" fallback, does NOT filter on active status). Duplicate the tiny ones into the new action file rather than editing the working spot-check file.
- London date maths: use `src/lib/dateUtils.ts` only. Business date rolls over at 06:00 (see `checklist_settings.business_day_start_hour`, default 6). Never raw `new Date()` for display or boundaries. Reproduce date tests with `TZ=UTC`.

## File structure

- Create `src/types/checklists-review.ts` for the review payload types.
- Create `src/lib/checklists/weekly-review.ts` for pure helpers: `getBusinessWeek()`, `resolveCellState()`, `slotToDayPart()`, `assembleWeeklyReview()`. Unit-tested.
- Create `src/lib/checklists/__tests__/weekly-review.test.ts` for the pure-helper unit tests.
- Create `src/app/actions/checklists-review.ts` for the `'use server'` `getWeeklyReview(weekStartIso, filters)`.
- Create `src/app/actions/__tests__/checklists-review.test.ts` for action tests (mock admin client + permission).
- Create `src/app/(authenticated)/checklists/manage/review/page.tsx` for the Server Component page.
- Create `src/app/(authenticated)/checklists/manage/_components/WeeklyReviewClient.tsx` for the client grid.
- Create `src/app/(authenticated)/checklists/manage/_components/__tests__/WeeklyReviewClient.test.tsx` for component tests.
- Modify `src/app/(authenticated)/checklists/manage/_components/ManageNav.tsx` to add the `review` tab entry and activeId branch.

---

## Task 1: Types

**Files:** Create `src/types/checklists-review.ts`

- [ ] **Step 1: Define the payload types (no logic).**

```ts
export type CellState =
  | 'done'
  | 'missed'
  | 'skipped'
  | 'not_applicable'
  | 'pending'
  | 'not_due'      // date generated complete, task simply not scheduled that day
  | 'no_data'      // generation not complete / absent / failed for that date

export type DayPart = 'opening' | 'service' | 'closing' | 'anytime'

export interface ReviewCell {
  date: string            // business_date ISO (yyyy-mm-dd)
  state: CellState
  instanceId?: string
  completedByName?: string // resolved; 'Unknown' if id present but unresolved
  completedAt?: string    // ISO instant
  wasLate?: boolean
  valueRecorded?: number | null
  valueUnit?: string | null
  valueBreach?: boolean
  skipReason?: string | null
  spotCheckFailed?: boolean
}

export interface ReviewRow {
  templateId: string
  slot: string
  dayPart: DayPart
  title: string           // latest snapshot title for the week
  department: string
  cells: ReviewCell[]     // exactly 7, aligned to weekDates order
}

export type DateHealth = 'complete' | 'running' | 'failed' | 'skipped_closed' | 'none'

export interface WeeklyReview {
  weekStart: string       // Monday business date ISO
  weekDates: string[]     // 7 ISO dates Mon..Sun
  dateHealth: Record<string, DateHealth>
  departments: string[]   // distinct departments present, for the filter
  rows: ReviewRow[]       // grouped/sorted by dayPart then department then title then slot
  updatedAt: string       // ISO instant the report was assembled
  warnings: string[]      // partial-enrichment notes (e.g. employee lookup degraded)
}
```

- [ ] **Step 2: Commit.** `git add src/types/checklists-review.ts && git commit -m "feat(checklists): weekly review payload types"`

---

## Task 2: Business-week and day-part pure helpers (TDD)

**Files:** Create `src/lib/checklists/weekly-review.ts`, Test `src/lib/checklists/__tests__/weekly-review.test.ts`

- [ ] **Step 1: Write failing tests for `getBusinessWeek` and `slotToDayPart`.**

```ts
import { describe, it, expect } from 'vitest'
import { getBusinessWeek, slotToDayPart } from '../weekly-review'

describe('getBusinessWeek', () => {
  it('returns Monday..Sunday for a mid-week London date', () => {
    // 2026-07-22 is a Wednesday
    const wk = getBusinessWeek('2026-07-22')
    expect(wk.weekStart).toBe('2026-07-20')            // Monday
    expect(wk.weekDates).toEqual([
      '2026-07-20','2026-07-21','2026-07-22','2026-07-23','2026-07-24','2026-07-25','2026-07-26',
    ])
  })
  it('normalises any given day to that week Monday', () => {
    expect(getBusinessWeek('2026-07-26').weekStart).toBe('2026-07-20') // Sunday -> same week
    expect(getBusinessWeek('2026-07-20').weekStart).toBe('2026-07-20') // Monday -> itself
  })
})

describe('slotToDayPart', () => {
  it('maps known slots', () => {
    expect(slotToDayPart('open')).toBe('opening')
    expect(slotToDayPart('close')).toBe('closing')
    expect(slotToDayPart('anytime')).toBe('anytime')
    expect(slotToDayPart('14:00')).toBe('service')
    expect(slotToDayPart('anything-else')).toBe('service')
  })
})
```

- [ ] **Step 2: Run and confirm FAIL.** `npx vitest run src/lib/checklists/__tests__/weekly-review.test.ts` fails (functions not defined).

- [ ] **Step 3: Implement `getBusinessWeek` and `slotToDayPart`.** `business_date` is a plain calendar day, so a UTC anchor with `getUTCDay` is deterministic and timezone-safe (no wall clock involved), which is why it is acceptable here despite the general dateUtils rule.

```ts
import type { DayPart } from '@/types/checklists-review'

export function getBusinessWeek(businessDateIso: string): { weekStart: string; weekDates: string[] } {
  const [y, m, d] = businessDateIso.split('-').map(Number)
  const anchor = new Date(Date.UTC(y, m - 1, d))
  const dow = anchor.getUTCDay()            // 0=Sun..6=Sat
  const deltaToMonday = (dow + 6) % 7        // days back to Monday
  const monday = new Date(anchor); monday.setUTCDate(anchor.getUTCDate() - deltaToMonday)
  const weekDates: string[] = []
  for (let i = 0; i < 7; i++) {
    const dt = new Date(monday); dt.setUTCDate(monday.getUTCDate() + i)
    weekDates.push(dt.toISOString().slice(0, 10))
  }
  return { weekStart: weekDates[0], weekDates }
}

export function slotToDayPart(slot: string): DayPart {
  if (slot === 'open') return 'opening'
  if (slot === 'close') return 'closing'
  if (slot === 'anytime') return 'anytime'
  return 'service'
}
```

- [ ] **Step 4: Run and confirm PASS.** `npx vitest run src/lib/checklists/__tests__/weekly-review.test.ts`

- [ ] **Step 5: Commit.** `git commit -am "feat(checklists): business-week + day-part helpers"`

---

## Task 3: Cell-state resolution and assembly (TDD)

**Files:** extend `src/lib/checklists/weekly-review.ts` and its test.

- [ ] **Step 1: Write failing tests for `resolveCellState`.** Inputs: the instance (or undefined) for a `(templateId, slot, date)` and the date's `DateHealth`. Rules:
  - instance present maps its stored state straight through (`done`/`missed`/`skipped`/`not_applicable`/`pending`).
  - no instance and `dateHealth === 'complete'` gives `not_due` (task genuinely not scheduled that day).
  - no instance and `dateHealth === 'skipped_closed'` gives `not_due` (venue closed; render muted "closed").
  - no instance and any other health (`running`/`failed`/`none`) gives `no_data`.

```ts
import { resolveCellState } from '../weekly-review'
describe('resolveCellState', () => {
  it('passes stored instance state through', () => {
    expect(resolveCellState({ state: 'done' } as any, 'complete')).toBe('done')
    expect(resolveCellState({ state: 'missed' } as any, 'complete')).toBe('missed')
    expect(resolveCellState({ state: 'pending' } as any, 'running')).toBe('pending')
  })
  it('absent instance on a complete day is not_due', () => {
    expect(resolveCellState(undefined, 'complete')).toBe('not_due')
    expect(resolveCellState(undefined, 'skipped_closed')).toBe('not_due')
  })
  it('absent instance on a non-complete day is no_data', () => {
    expect(resolveCellState(undefined, 'failed')).toBe('no_data')
    expect(resolveCellState(undefined, 'running')).toBe('no_data')
    expect(resolveCellState(undefined, 'none')).toBe('no_data')
  })
})
```

- [ ] **Step 2: Run to confirm FAIL. Step 3: Implement `resolveCellState`.**

```ts
import type { CellState, DateHealth } from '@/types/checklists-review'
export function resolveCellState(
  instance: { state: CellState } | undefined,
  health: DateHealth,
): CellState {
  if (instance) return instance.state
  if (health === 'complete' || health === 'skipped_closed') return 'not_due'
  return 'no_data'
}
```

- [ ] **Step 4: Write failing test for `assembleWeeklyReview`.** Give it: weekDates (7), a small set of instance rows (with template_id/slot/business_date/state/title_snapshot/department/completed_by_employee_id and value fields), a name map, a failed-spot-check instance-id Set, a `dateHealth` map, and an `assembledAt` ISO string. Assert: rows are keyed one per `(template_id, slot)`; each row has exactly 7 cells aligned to weekDates; a `(template, slot, date)` with no instance on a complete day is `not_due`; a done instance surfaces completer name + time; a `value_breach=true` done cell has `valueBreach:true`; a failed-spot-check instance sets `spotCheckFailed:true`; rows sorted by dayPart order opening, service, closing, anytime, then department, then title, then slot. Write concrete fixtures and assertions.

- [ ] **Step 5: Run to confirm FAIL. Step 6: Implement `assembleWeeklyReview`.** Pure function returning `{ rows, departments }`. Build a Map keyed `templateId + ' ' + slot`; for each key create a row with 7 cells; fill cells from instances; resolve absent cells via `resolveCellState`; attach breach/late/value/spot-check fields; group-sort as specified. No DB access, no `Date.now` (use the `assembledAt` argument).

- [ ] **Step 7: Run to confirm PASS. Step 8: Commit.** `git commit -am "feat(checklists): weekly review cell-state + assembly"`

---

## Task 4: Server action `getWeeklyReview` (TDD with mocked client)

**Files:** Create `src/app/actions/checklists-review.ts`, Test `src/app/actions/__tests__/checklists-review.test.ts`

- [ ] **Step 1: Write failing action tests.** Mock `@/lib/supabase/admin` (createAdminClient), `@/lib/permissions` (checkUserPermission), and `@/lib/audit-helpers` (getCurrentUser) the same way `checklists-spotcheck` tests do. Cases:
  - permission denied (not super_admin) returns `{ error: 'Insufficient permissions' }`, no DB reads.
  - happy path: given instances + generation runs + employees, returns `{ data }` whose `rows`, `weekDates`, `dateHealth`, `departments` match expectations.
  - department filter passed returns only that department's rows.
  - pagination: a fetch returning 1000 rows triggers a second page (assert the range-based paging is invoked).

- [ ] **Step 2: Run to confirm FAIL. Step 3: Implement the action.**

```ts
'use server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkUserPermission } from '@/lib/permissions'
import { getCurrentUser } from '@/lib/audit-helpers'
import { getBusinessWeek, assembleWeeklyReview } from '@/lib/checklists/weekly-review'
import type { WeeklyReview, DateHealth } from '@/types/checklists-review'

// duplicate the tiny super-admin gate + paginator locally (do not edit the working spot-check file)
async function requireSuperAdmin(): Promise<{ ok: true } | { error: string }> { /* mirror spotcheck:127 */ }
async function fetchAllRows<T>(build: (from: number, to: number) => any): Promise<T[]> { /* page by 1000, stable order by business_date,id */ }

export async function getWeeklyReview(
  weekStartIso: string,
  filters?: { department?: string; slot?: string },
): Promise<{ data?: WeeklyReview; error?: string }> {
  const gate = await requireSuperAdmin()
  if ('error' in gate) return { error: gate.error }
  const { weekStart, weekDates } = getBusinessWeek(weekStartIso)
  const db = createAdminClient()
  // 1. instances for the 7-day range (select ONLY needed columns; least privilege, F25)
  // 2. latest generation run per date -> dateHealth map (F03)
  // 3. failed spot-check instance ids in range -> Set (F12)
  // 4. employee names for completer ids (Unknown fallback, no active filter) (F13/F25)
  // 5. assembleWeeklyReview(...); compute distinct departments; return with updatedAt + warnings
}
```

Fill in the real queries: instances `.gte('business_date', weekStart).lte('business_date', weekDates[6])` with optional `.eq('department', ...)`; generation runs for the same range ordered by `finished_at`/`started_at` desc, reduced to latest-per-date; failed spot checks `.eq('result','fail')` in range. Wrap enrichment (employees, spot checks) so a failure degrades to a `warnings` entry rather than failing the whole report (F14). Use `getCurrentUser` only inside the gate. No audit log (read-only, matches insights/problems).

- [ ] **Step 4: Run to confirm PASS. Step 5: Commit.** `git commit -am "feat(checklists): getWeeklyReview server action"`

---

## Task 5: Accessible weekly grid client component (TDD)

**Files:** Create `.../manage/_components/WeeklyReviewClient.tsx` and its test.

- [ ] **Step 1: Write failing component tests (RTL).** Render with a small `WeeklyReview` fixture. Assert:
  - a semantic `<table>` with a caption or legend; column headers are the 7 dates; a row header per task.
  - a `done` cell exposes an accessible name including the state and completer (e.g. `aria-label` "Done by Jacob Hambridge, 12:41"); colour is never the only signal (icon/text present).
  - a `missed` cell renders a visible cross + accessible "Missed" text.
  - a `no_data` day shows a visible banner or marker (not a clean blank).
  - clicking a cell opens a detail panel (drawer or dialog) with full name, time, value + range, breach, late flag, spot-check result. Click, not hover.
  - department and day-part `Select` filters render with an "All" default.

- [ ] **Step 2: Run to confirm FAIL. Step 3: Implement the component (`'use client'`).** Requirements:
  - Semantic table; `scope="col"` on date headers, `scope="row"` on the task cell; sticky first column and header row; horizontal scroll container (`overflow-x:auto`) so wide weeks scroll instead of breaking the page; test at 320px.
  - Group rows by day-part (Opening / During service / Closing / Anytime) with a labelled group header row; within a group show department when more than one is present.
  - Cell renders an icon + short initials for `done`; distinct icon for `missed`; muted dash for `skipped`/`not_applicable`/`not_due`; a warning glyph overlaid when `valueBreach` or `spotCheckFailed` or `wasLate`.
  - Each cell is a keyboard-focusable `<button>` opening an accessible detail popover or drawer (focus trap, Esc to close) using `@/ds` primitives.
  - Week navigation: Prev / This week / Next buttons that update a `?weekStart=YYYY-MM-DD` query param (client `router.push`); disable Next when the week is the current or a future business week.
  - Department and Day-part `Select` filters (default All); filter client-side over the provided rows (data already scoped to the week).
  - Show `Updated <time> (London)` and a Refresh button. No polling in v1.
  - Empty state: "No checklist data was generated for this week." Error state: surface the `error` prop with a retry. Use design tokens only, no hardcoded hex.

- [ ] **Step 4: Run to confirm PASS. Step 5: Commit.** `git commit -am "feat(checklists): accessible weekly review grid"`

---

## Task 6: Page + nav wiring

**Files:** Create `.../manage/review/page.tsx`; Modify `.../manage/_components/ManageNav.tsx`.

- [ ] **Step 1: Add the ManageNav entry + activeId branch.** In `ITEMS` add `{ id: 'review', label: 'Weekly review', href: '/checklists/manage/review' }` (place after `insights`). Add an activeId branch `pathname.startsWith('/checklists/manage/review') ? 'review'` in the existing ternary chain.

- [ ] **Step 2: Create the server page.** Server Component; reads `searchParams.weekStart` (default: today's business date via a shared helper), calls `getWeeklyReview(weekStart, {})`, renders `<WeeklyReviewClient data={res.data} error={res.error} />`. It inherits the `manage` layout gate; the action's own `requireSuperAdmin` is the real guard. Add a `PageHeader` matching sibling pages.

```tsx
import { getWeeklyReview } from '@/app/actions/checklists-review'
import { WeeklyReviewClient } from '../_components/WeeklyReviewClient'

export default async function WeeklyReviewPage({ searchParams }: { searchParams: Promise<{ weekStart?: string }> }) {
  const { weekStart } = await searchParams
  const res = await getWeeklyReview(weekStart ?? todaysBusinessDateIso(), {})
  return <WeeklyReviewClient data={res.data} error={res.error} />
}
```

- [ ] **Step 3: Run typecheck + the new tests.** `nvm use && npx tsc --noEmit` (clean) and `npx vitest run src/lib/checklists src/app/actions/__tests__/checklists-review.test.ts 'src/app/(authenticated)/checklists/manage/_components/__tests__/WeeklyReviewClient.test.tsx'` (all pass).

- [ ] **Step 4: Commit.** `git commit -am "feat(checklists): weekly review page + nav tab"`

---

## Task 7: Verify end-to-end + full pipeline

- [ ] **Step 1:** `nvm use` then `npm run lint` (zero warnings), `npx tsc --noEmit` (clean), `npm test` (all pass), `npm run build` (succeeds).
- [ ] **Step 2:** Timezone safety: `TZ=UTC npx vitest run src/lib/checklists/__tests__/weekly-review.test.ts` passes (week boundaries do not drift).
- [ ] **Step 3:** Reality check against prod for the week containing 2026-07-19: the grid must show Jacob's 21 opening bar tasks as done on Sun 19 Jul, the 21 closing bar tasks as missed, and any not-yet-swept current-day tasks as pending. Confirm no clean-blank day where generation did not complete.
- [ ] **Step 4:** Do NOT merge or deploy. Summarise branch `feat/checklist-weekly-review` for owner review, listing the 5 locked assumptions so the owner can confirm or adjust before it goes live.

---

## Self-review checklist (run before handing off)

- Spec coverage: every P0 from the developer review is addressed. F01 (Problems not touched; the grid is the new surface), F02 (row per `(template, slot)`), F03 (dateHealth drives `no_data`), F04 (columns are the due day, completion time on drill-down), F05 (super_admin gate). P1s addressed: F06 (health drives finality-style banners), F08 (four day-parts), F09 (skip_reason shown; not_applicable shows "No reason recorded"), F12 (breach/late/spot-check markers), F13 (accessible click detail + Unknown fallback), F14 (empty/error/partial states), F16 (typed action contract), F25 (least-privilege column selection, no notes returned).
- Out of scope (documented): CSV export, per-employee pivot, follow-up tracking mutation, Problems enhancement, historical backfill, current-week polling, the seed Mon-to-Sun drift fix.
