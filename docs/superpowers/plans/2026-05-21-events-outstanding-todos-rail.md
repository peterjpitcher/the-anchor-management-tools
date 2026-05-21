# Events — Outstanding Todos Right Rail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Outstanding Todos" rail to the right-hand side of `/events` showing one flat, chronologically-sorted list of every checklist todo that is overdue or due today, with urgency made visually obvious and tickable in place.

**Architecture:** Reuse the existing `getChecklistTodos()` server action (it already returns exactly overdue + due-today items, sorted by due date). Add a new client component `EventTodosWidget` rendered in a two-column wrapper in `events/page.tsx` so `EventsClient` is untouched. Pure display helpers are extracted for unit testing.

**Tech Stack:** Next.js 15 App Router (RSC), React 19, TypeScript, Tailwind v4 (`@theme` tokens), Vitest + @testing-library/react, design-system components from `@/ds`.

**Spec:** `docs/superpowers/specs/2026-05-21-events-outstanding-todos-rail-design.md`

---

## File Structure

- **Create** `src/app/(authenticated)/events/_components/eventTodosWidget.helpers.ts` — pure, unit-testable display helpers (relative-due text, status counts, summary line).
- **Create** `src/app/(authenticated)/events/_components/eventTodosWidget.helpers.test.ts` — helper unit tests.
- **Create** `src/app/(authenticated)/events/_components/EventTodosWidget.tsx` — client component rendering the rail list with optimistic completion.
- **Create** `src/app/(authenticated)/events/_components/EventTodosWidget.test.tsx` — component tests.
- **Modify** `src/app/(authenticated)/events/page.tsx` — fetch todos + `canManage`, wrap content in a two-column row, render the widget in the right rail.
- **Modify (separate concern)** `src/app/(authenticated)/error.tsx` — fix the same dead `text-primary-foreground` token already fixed in the calendar.

### Key facts the implementer must know

- `getChecklistTodos()` (`src/app/actions/event-checklist.ts`) returns `{ success: boolean; error?: string; items?: ChecklistTodoItem[] }`. On success `items` is already filtered to `status === 'overdue' | 'due_today'` and sorted by `dueDate` ascending then `order`. **Do not re-sort or re-filter** in the widget — render in the order received.
- It includes **draft** events (it does not filter by `event_status`). This is intentional; do not add a status filter. A test fixture must include a draft-event item to prove this.
- `toggleEventChecklistTask(eventId, taskKey, completed)` → `Promise<{ success: boolean; error?: string }>`. It enforces `events:manage`, writes an audit log, and revalidates `/events`.
- `ChecklistTodoItem` (from `@/lib/event-checklist`) fields used: `key`, `label`, `channel`, `eventId`, `eventName`, `dueDate`, `status` (`'overdue' | 'due_today'` here).
- Semantic colour tokens exist in `@theme` (`src/app/globals.css`): `--color-danger`, `--color-warning` → utilities `border-danger`, `border-warning`, and Badge tones `danger`/`warning`. No hardcoded hex.
- DS `Checkbox` renders `<button role="checkbox">`; with no `label`/children it uses `aria-label` as its accessible name. Its click calls `onChange(!checked)` and does **not** stop propagation — so the checkbox must be a **sibling** of (never nested inside) the row's `<Link>`.
- Vitest is configured with `jsdom`, `globals: true`, and `@testing-library/jest-dom` (via `vitest.setup.ts`). `next/navigation` is globally mocked.

---

## Task 1: Isolate the dead-token fix as its own commit (separate concern)

The calendar today-marker fix (`ScheduleCalendarMonth.tsx`, `text-primary-foreground` → `text-primary-fg`) is **already applied** in the working tree. `error.tsx:61` has the identical bug. Fix it and commit both together as one isolated fix, separate from the widget feature.

**Files:**
- Modify: `src/app/(authenticated)/error.tsx:61`
- (Already modified, include in this commit) `src/components/schedule-calendar/ScheduleCalendarMonth.tsx:169`

- [ ] **Step 1: Fix `error.tsx`**

In `src/app/(authenticated)/error.tsx`, change the button class on line 61 from:

```tsx
        className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
```

to:

```tsx
        className="px-4 py-2 bg-primary text-primary-fg rounded-md hover:bg-primary/90"
```

- [ ] **Step 2: Verify no other dead-token usages remain**

Run: `grep -rn "text-primary-foreground\|bg-primary-foreground" src --include="*.tsx"`
Expected: no matches. (`DragConfirmationModal.tsx` uses `text-[hsl(var(--primary-foreground))]`, which is a different, working form — leave it.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit (separate concern)**

```bash
git add src/components/schedule-calendar/ScheduleCalendarMonth.tsx src/app/(authenticated)/error.tsx
git commit -m "fix: use real primary-fg token for white text on green (calendar today marker, error retry button)"
```

---

## Task 2: Pure display helpers (TDD)

**Files:**
- Create: `src/app/(authenticated)/events/_components/eventTodosWidget.helpers.ts`
- Test: `src/app/(authenticated)/events/_components/eventTodosWidget.helpers.test.ts`

- [ ] **Step 1: Write the failing test**

Create `eventTodosWidget.helpers.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  daysBetweenIso,
  formatRelativeDue,
  summariseTodos,
  formatSummaryLine,
} from './eventTodosWidget.helpers'

describe('daysBetweenIso', () => {
  it('counts whole days between ISO dates regardless of local timezone', () => {
    expect(daysBetweenIso('2026-05-18', '2026-05-21')).toBe(3)
    expect(daysBetweenIso('2026-05-21', '2026-05-21')).toBe(0)
  })
})

describe('formatRelativeDue', () => {
  it('labels overdue items by day count', () => {
    expect(formatRelativeDue('2026-05-18', '2026-05-21')).toBe('Overdue by 3d')
  })
  it('labels due-today items', () => {
    expect(formatRelativeDue('2026-05-21', '2026-05-21')).toBe('Due today')
  })
  it('labels future items', () => {
    expect(formatRelativeDue('2026-05-26', '2026-05-21')).toBe('Due in 5d')
  })
})

describe('summariseTodos', () => {
  it('counts by status', () => {
    expect(
      summariseTodos([{ status: 'overdue' }, { status: 'overdue' }, { status: 'due_today' }]),
    ).toEqual({ overdue: 2, dueToday: 1 })
  })
  it('handles empty input', () => {
    expect(summariseTodos([])).toEqual({ overdue: 0, dueToday: 0 })
  })
})

describe('formatSummaryLine', () => {
  it('joins non-zero parts', () => {
    expect(formatSummaryLine({ overdue: 3, dueToday: 2 })).toBe('3 overdue · 2 due today')
  })
  it('omits zero parts', () => {
    expect(formatSummaryLine({ overdue: 0, dueToday: 2 })).toBe('2 due today')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/\(authenticated\)/events/_components/eventTodosWidget.helpers.test.ts`
Expected: FAIL — cannot resolve `./eventTodosWidget.helpers`.

- [ ] **Step 3: Write the implementation**

Create `eventTodosWidget.helpers.ts`:

```ts
import type { ChecklistTodoItem } from '@/lib/event-checklist'

const MS_PER_DAY = 86_400_000

/** Whole-day difference (toIso - fromIso) using UTC-anchored ISO dates — deterministic and timezone-safe. */
export function daysBetweenIso(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T00:00:00Z`)
  const to = Date.parse(`${toIso}T00:00:00Z`)
  return Math.round((to - from) / MS_PER_DAY)
}

/** Human relative-due label for a todo's due date relative to today. */
export function formatRelativeDue(dueDate: string, todayIso: string): string {
  const overdueBy = daysBetweenIso(dueDate, todayIso) // positive => overdue
  if (overdueBy > 0) return `Overdue by ${overdueBy}d`
  if (overdueBy === 0) return 'Due today'
  return `Due in ${-overdueBy}d`
}

export interface TodoCounts {
  overdue: number
  dueToday: number
}

export function summariseTodos(items: Pick<ChecklistTodoItem, 'status'>[]): TodoCounts {
  let overdue = 0
  let dueToday = 0
  for (const item of items) {
    if (item.status === 'overdue') overdue += 1
    else if (item.status === 'due_today') dueToday += 1
  }
  return { overdue, dueToday }
}

export function formatSummaryLine(counts: TodoCounts): string {
  const parts: string[] = []
  if (counts.overdue > 0) parts.push(`${counts.overdue} overdue`)
  if (counts.dueToday > 0) parts.push(`${counts.dueToday} due today`)
  return parts.join(' · ')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/\(authenticated\)/events/_components/eventTodosWidget.helpers.test.ts`
Expected: PASS (10 assertions across 4 describe blocks).

- [ ] **Step 5: Commit**

```bash
git add src/app/\(authenticated\)/events/_components/eventTodosWidget.helpers.ts src/app/\(authenticated\)/events/_components/eventTodosWidget.helpers.test.ts
git commit -m "feat: add display helpers for events outstanding-todos rail"
```

---

## Task 3: EventTodosWidget component (TDD)

**Files:**
- Create: `src/app/(authenticated)/events/_components/EventTodosWidget.tsx`
- Test: `src/app/(authenticated)/events/_components/EventTodosWidget.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `EventTodosWidget.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ChecklistTodoItem } from '@/lib/event-checklist'

vi.mock('@/app/actions/event-checklist', () => ({
  toggleEventChecklistTask: vi.fn(),
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))

// Full, lightweight mock of the design-system barrel so the test does not load the heavy shell.
vi.mock('@/ds', async () => {
  const React = await import('react')
  return {
    Card: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
    CardHeader: ({ title, subtitle }: { title?: string; subtitle?: string }) =>
      React.createElement('div', null, title, subtitle ? React.createElement('p', null, subtitle) : null),
    CardBody: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
    Badge: ({ tone, children }: { tone?: string; children: React.ReactNode }) =>
      React.createElement('span', { 'data-tone': tone }, children),
    Checkbox: ({
      onChange,
      checked,
      ...rest
    }: {
      onChange?: (v: boolean) => void
      checked?: boolean
      'aria-label'?: string
    }) =>
      React.createElement('button', {
        type: 'button',
        role: 'checkbox',
        'aria-checked': Boolean(checked),
        'aria-label': rest['aria-label'],
        onClick: () => onChange?.(!checked),
      }),
    toast: { error: vi.fn(), success: vi.fn() },
  }
})

import EventTodosWidget from './EventTodosWidget'
import { toggleEventChecklistTask } from '@/app/actions/event-checklist'
import { toast } from '@/ds'

const mockToggle = vi.mocked(toggleEventChecklistTask)
const TODAY = '2026-05-21'

function makeItem(overrides: Partial<ChecklistTodoItem> = {}): ChecklistTodoItem {
  return {
    key: 'write_event_brief',
    label: 'Write event brief',
    offsetDays: -28,
    channel: 'Admin',
    required: true,
    order: 1,
    eventId: 'evt-1',
    dueDate: '2026-05-18',
    dueDateFormatted: '18 May 2026',
    completed: false,
    completedAt: null,
    status: 'overdue',
    eventName: 'Draft Quiz Night',
    eventDate: '2026-06-15',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('EventTodosWidget', () => {
  it('renders todos in the order received with correct urgency tone, including draft-event items', () => {
    const items = [
      makeItem({ key: 'a', label: 'Alpha task', status: 'overdue', dueDate: '2026-05-18', eventName: 'Draft Quiz Night' }),
      makeItem({ key: 'b', label: 'Beta task', status: 'due_today', dueDate: '2026-05-21', eventName: 'Scheduled Gig' }),
    ]
    render(<EventTodosWidget initialTodos={items} canManage todayIso={TODAY} />)

    const labels = screen.getAllByText(/ task$/).map((el) => el.textContent)
    expect(labels).toEqual(['Alpha task', 'Beta task'])

    expect(screen.getByText('Overdue by 3d')).toHaveAttribute('data-tone', 'danger')
    expect(screen.getByText('Due today')).toHaveAttribute('data-tone', 'warning')
    // Draft-event item is shown (widget must not filter by event_status).
    expect(screen.getByText('Draft Quiz Night')).toBeInTheDocument()
  })

  it('shows the caught-up empty state when there are no todos and no error', () => {
    render(<EventTodosWidget initialTodos={[]} canManage todayIso={TODAY} />)
    expect(screen.getByText(/all caught up/i)).toBeInTheDocument()
  })

  it('shows a load-error state instead of the caught-up state when loadError is set', () => {
    render(<EventTodosWidget initialTodos={[]} canManage todayIso={TODAY} loadError="boom" />)
    expect(screen.getByText(/could not be loaded/i)).toBeInTheDocument()
    expect(screen.queryByText(/all caught up/i)).not.toBeInTheDocument()
  })

  it('hides checkboxes when the user cannot manage', () => {
    render(<EventTodosWidget initialTodos={[makeItem()]} canManage={false} todayIso={TODAY} />)
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('gives each checkbox an accessible name', () => {
    render(<EventTodosWidget initialTodos={[makeItem({ label: 'Write event brief' })]} canManage todayIso={TODAY} />)
    expect(
      screen.getByRole('checkbox', { name: 'Mark "Write event brief" complete' }),
    ).toBeInTheDocument()
  })

  it('optimistically removes a todo on successful completion', async () => {
    mockToggle.mockResolvedValue({ success: true })
    const user = userEvent.setup()
    render(<EventTodosWidget initialTodos={[makeItem({ label: 'Write event brief' })]} canManage todayIso={TODAY} />)

    await user.click(screen.getByRole('checkbox', { name: 'Mark "Write event brief" complete' }))

    await waitFor(() => expect(screen.queryByText('Write event brief')).not.toBeInTheDocument())
    expect(mockToggle).toHaveBeenCalledWith('evt-1', 'write_event_brief', true)
  })

  it('restores the todo and shows a toast when completion fails', async () => {
    mockToggle.mockResolvedValue({ success: false, error: 'nope' })
    const user = userEvent.setup()
    render(<EventTodosWidget initialTodos={[makeItem({ label: 'Write event brief' })]} canManage todayIso={TODAY} />)

    await user.click(screen.getByRole('checkbox', { name: 'Mark "Write event brief" complete' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('nope'))
    expect(screen.getByText('Write event brief')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/\(authenticated\)/events/_components/EventTodosWidget.test.tsx`
Expected: FAIL — cannot resolve `./EventTodosWidget`.

- [ ] **Step 3: Write the implementation**

Create `EventTodosWidget.tsx`:

```tsx
'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Card, CardHeader, CardBody, Checkbox, Badge, toast } from '@/ds'
import { cn } from '@/lib/utils'
import { toggleEventChecklistTask } from '@/app/actions/event-checklist'
import type { ChecklistTodoItem } from '@/lib/event-checklist'
import { formatRelativeDue, summariseTodos, formatSummaryLine } from './eventTodosWidget.helpers'

interface EventTodosWidgetProps {
  initialTodos: ChecklistTodoItem[]
  canManage: boolean
  todayIso: string
  loadError?: string | null
}

export default function EventTodosWidget({
  initialTodos,
  canManage,
  todayIso,
  loadError = null,
}: EventTodosWidgetProps) {
  const [todos, setTodos] = useState<ChecklistTodoItem[]>(initialTodos)
  const [isPending, startTransition] = useTransition()

  function handleComplete(item: ChecklistTodoItem) {
    const snapshot = todos
    setTodos((prev) => prev.filter((t) => !(t.eventId === item.eventId && t.key === item.key)))
    startTransition(async () => {
      const result = await toggleEventChecklistTask(item.eventId, item.key, true)
      if (!result.success) {
        setTodos(snapshot)
        toast.error(result.error ?? 'Could not update todo')
      }
    })
  }

  const summary = formatSummaryLine(summariseTodos(todos))

  return (
    <div className="xl:sticky xl:top-6">
      <Card>
        <CardHeader
          title="Outstanding Todos"
          subtitle={!loadError && todos.length > 0 ? summary : undefined}
        />
        <CardBody className="max-h-96 xl:max-h-[calc(100vh-7rem)] overflow-y-auto">
          {loadError ? (
            <p className="py-6 text-center text-sm text-text-muted">
              Outstanding todos could not be loaded.
            </p>
          ) : todos.length === 0 ? (
            <p className="py-6 text-center text-sm text-text-muted">
              You&apos;re all caught up — no outstanding todos.
            </p>
          ) : (
            <ul className={cn('flex flex-col gap-1', isPending && 'opacity-60')}>
              {todos.map((item) => (
                <li
                  key={`${item.eventId}:${item.key}`}
                  className={cn(
                    'flex items-start gap-2 border-l-4 pl-3 py-2',
                    item.status === 'overdue' ? 'border-danger' : 'border-warning',
                  )}
                >
                  {canManage && (
                    <Checkbox
                      aria-label={`Mark "${item.label}" complete`}
                      checked={false}
                      onChange={() => handleComplete(item)}
                    />
                  )}
                  <Link href={`/events/${item.eventId}`} className="group block min-w-0 flex-1">
                    <span className="block truncate text-sm text-text group-hover:underline">
                      {item.label}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-2">
                      <span className="max-w-[10rem] truncate text-xs text-text-muted">
                        {item.eventName}
                      </span>
                      <Badge tone={item.status === 'overdue' ? 'danger' : 'warning'}>
                        {formatRelativeDue(item.dueDate, todayIso)}
                      </Badge>
                      <span className="text-xs text-text-subtle">{item.channel}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/\(authenticated\)/events/_components/EventTodosWidget.test.tsx`
Expected: PASS (7 tests).

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: zero warnings/errors (note: `--max-warnings=0` is enforced).

- [ ] **Step 6: Commit**

```bash
git add src/app/\(authenticated\)/events/_components/EventTodosWidget.tsx src/app/\(authenticated\)/events/_components/EventTodosWidget.test.tsx
git commit -m "feat: add EventTodosWidget for outstanding-todos rail"
```

---

## Task 4: Wire the widget into the `/events` page + verify end to end

**Files:**
- Modify: `src/app/(authenticated)/events/page.tsx`

- [ ] **Step 1: Update `page.tsx`**

Replace the full contents of `src/app/(authenticated)/events/page.tsx` with:

```tsx
import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { getEvents } from '@/app/actions/events'
import { getActiveEventCategories } from '@/app/actions/event-categories'
import { fetchPrivateBookingsForCalendar } from '@/app/actions/private-bookings-dashboard'
import { listCalendarNotes } from '@/app/actions/calendar-notes'
import { listParkingBookings } from '@/app/actions/parking'
import { getChecklistTodos } from '@/app/actions/event-checklist'
import { getTodayIsoDate } from '@/lib/dateUtils'
import type { VenueCalendarBooking, VenueCalendarParking } from '@/components/schedule-calendar'
import EventsClient from './_components/EventsClient'
import EventTodosWidget from './_components/EventTodosWidget'

export const metadata = {
  title: 'Events',
}

export default async function EventsPage() {
  const canViewEvents = await checkUserPermission('events', 'view')

  if (!canViewEvents) {
    redirect('/unauthorized')
  }

  const [
    eventsResult,
    categoriesResult,
    calEventsResult,
    bookingsResult,
    notesResult,
    parkingResult,
    todosResult,
    canManageEvents,
  ] = await Promise.all([
    getEvents({ status: 'all', dateFrom: getTodayIsoDate(), page: 1, pageSize: 25 }),
    getActiveEventCategories(),
    getEvents({ status: 'all', page: 1, pageSize: 500 }),
    fetchPrivateBookingsForCalendar(),
    listCalendarNotes(),
    listParkingBookings({ limit: 500 }),
    getChecklistTodos(),
    checkUserPermission('events', 'manage'),
  ])

  return (
    <div className="p-6">
      <div className="flex flex-col gap-6 xl:flex-row">
        <div className="min-w-0 flex-1">
          <EventsClient
            initialEvents={eventsResult.data ?? []}
            initialPagination={eventsResult.pagination}
            categories={categoriesResult.data ?? []}
            initialCalendarEvents={calEventsResult.data ?? []}
            initialCalendarBookings={'data' in bookingsResult && bookingsResult.data ? bookingsResult.data as VenueCalendarBooking[] : []}
            initialCalendarNotes={notesResult.data ?? []}
            initialCalendarParking={'data' in parkingResult && parkingResult.data ? parkingResult.data as VenueCalendarParking[] : []}
          />
        </div>
        <aside className="xl:w-80 xl:shrink-0">
          <EventTodosWidget
            initialTodos={todosResult.items ?? []}
            canManage={canManageEvents}
            todayIso={getTodayIsoDate()}
            loadError={todosResult.success ? null : todosResult.error ?? 'Unable to load outstanding todos'}
          />
        </aside>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: zero warnings/errors.

- [ ] **Step 4: Full test run**

Run: `npm test`
Expected: all tests pass (including the two new files).

- [ ] **Step 5: Production build**

Run: `npm run build`
Expected: build succeeds with no type/compile errors.

- [ ] **Step 6: In-browser verification**

Start the preview (`preview_start`) and open `/events`.

- **Auth note:** `/events` is behind auth. If the preview cannot reach an authenticated session, **do not claim visual success** — report that visual verification was blocked by auth and ask the user to confirm, or provide a logged-in session. Build + unit tests still gate correctness.

If reachable, confirm:
- The "Outstanding Todos" rail appears on the right (`xl`+), sticky while the main content scrolls; on a narrow viewport (`preview_resize`) it stacks below the main content.
- Overdue rows show a red left border + `danger` badge ("Overdue by Nd"); due-today rows show an amber left border + `warning` badge ("Due today").
- Ticking a row removes it; the summary count updates.
- The calendar "today" date number is now **white** on the green background (the Task 1 fix).

Capture a `preview_screenshot` as proof.

- [ ] **Step 7: Commit**

```bash
git add src/app/\(authenticated\)/events/page.tsx
git commit -m "feat: show outstanding-todos rail on the events page"
```

---

## Notes for the executor

- **Stale checklist keys:** The widget only ever consumes `getChecklistTodos()`, which derives visible tasks via `buildEventChecklist()` from `EVENT_CHECKLIST_DEFINITIONS`. Never read or count raw `event_checklist_statuses` rows in the widget — historical/stale task keys exist there.
- **Do not modify** `EventsClient`, `getChecklistTodos`, the `/events/todo` page, or `TodoClient`.
- **`todayIso` prop:** added beyond the spec's prop list so relative-due text uses the same "today" as the server-computed status (deterministic). It is passed from `page.tsx` via `getTodayIsoDate()`.
- Keep commit messages conventional; append the standard `Co-Authored-By` trailer per workspace git settings.
```
