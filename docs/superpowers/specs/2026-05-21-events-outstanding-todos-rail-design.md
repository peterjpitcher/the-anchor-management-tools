# Events — Outstanding Todos Right Rail

**Date:** 2026-05-21
**Status:** Reviewed against codebase/database actuals; ready for implementation with explicit draft-event inclusion
**Complexity:** S (2) — 1 new component + 1 page wrapper, no schema/data-layer changes

## Problem

The cross-event checklist todos already exist, but the only place to see them is `/events/todo`, which groups them into a separate card per event. Staff want an at-a-glance, single consolidated list of the todos that need action *now*, visible while they work on the main `/events` page, with urgency made visually obvious.

## Goal

Add an "Outstanding Todos" rail down the right-hand side of the `/events` landing page showing **one flat list, sorted chronologically by due date**, of every checklist todo that is **overdue or due today**. Each row makes urgency visually obvious and can be ticked off in place.

## Non-goals / out of scope

- **No change to `/events/todo`** — the existing grouped-by-event view stays exactly as-is.
- **No future ("upcoming") todos** — only items due today or before are shown.
- **No new data layer for this iteration** — reuse the existing `getChecklistTodos()` action and make its current event-status behaviour explicit.
- The `text-primary-foreground` dead-token bug fix (calendar today-marker + `error.tsx` "Try again" button) is a **separate concern** tracked independently, not part of this feature.

## Codebase/database actuals reviewed

- Checklist todos are **derived**, not stored as todo rows. The source of truth is:
  - `src/lib/event-checklist.ts` → `EVENT_CHECKLIST_DEFINITIONS`, `buildEventChecklist()`, `getOutstandingTodos()`.
  - `event_checklist_statuses` → sparse completion records keyed by `(event_id, task_key)`.
- `EventChecklistService.getChecklistTodos()` currently:
  - loads events where `date >= today`;
  - does **not** filter by `event_status`;
  - builds checklist items from definitions;
  - removes completed items;
  - returns only `overdue` and `due_today`;
  - sorts by `dueDate` ascending, then `order`.
- Live database sample on **2026-05-21**:
  - 88 current/future events matched `date >= today`.
  - 85 were `draft`, 3 were `scheduled`.
  - 40 outstanding due/overdue todos were produced.
  - 35 of those todos were on draft events, 5 on scheduled events.
- Persisted `event_checklist_statuses` contains historical/stale task keys that no longer exist in `EVENT_CHECKLIST_DEFINITIONS` (for example `publish_event_page`, `create_short_link`, `print_materials`). Do **not** count raw status rows as checklist totals; always derive visible tasks through `buildEventChecklist()` / `getOutstandingTodos()`.
- `supabase/migrations/20260228000004_auto_close_past_event_tasks.sql` also has a stale task-key list and omits the current `setup_paid_advertising` definition. This does not block the rail, but it confirms that UI logic must rely on the current TypeScript checklist definitions, not migration hardcoded key lists.

## Scope decision

- **Show:** todos with status `overdue` or `due_today`.
- **Hide:** todos with status `upcoming` (not yet due) and `completed`.
- **Event-status scope:** include the exact existing dataset returned by `getChecklistTodos()`, including draft events. This intentionally preserves `/events/todo` semantics and keeps the change additive.
- If the product decision changes to "scheduled/public events only", this spec must be revised before implementation because that is a data-layer/filter change, not just a rail component change.

## Data flow

1. `events/page.tsx` (server component) already runs a `Promise.all` of server actions. Add two calls:
   - `getChecklistTodos()` → `{ success, error?, items?: ChecklistTodoItem[] }` (flat, already sorted chronologically on success).
   - `checkUserPermission('events', 'manage')` → `canManage: boolean` (gates the tick action).
2. Pass `initialTodos={result.items ?? []}`, `loadError={result.success ? null : result.error ?? 'Unable to load outstanding todos'}`, and `canManage` into a new `EventTodosWidget`.
3. `EventTodosWidget` (client) renders the list and owns local state for optimistic removal on completion.

`ChecklistTodoItem` (from `src/lib/event-checklist.ts`) already carries everything the row needs: `key`, `label`, `channel`, `eventId`, `eventName`, `eventDate`, `dueDate`, `dueDateFormatted`, `status` (`'overdue' | 'due_today'` for this widget's input).

## Layout

`events/page.tsx` wraps the existing content in a two-column row so **`EventsClient` is not modified**:

```tsx
<div className="p-6">
  <div className="flex flex-col xl:flex-row gap-6">
    <div className="flex-1 min-w-0">
      <EventsClient ... />
    </div>
    <aside className="xl:w-80 xl:shrink-0">
      <EventTodosWidget initialTodos={...} canManage={...} loadError={...} />
    </aside>
  </div>
</div>
```

- **Desktop (`xl`+):** rail sits on the right at a fixed `w-80` (~320px). The widget card is `xl:sticky xl:top-6` so it stays in view while the main content scrolls. The list body is `overflow-y-auto` with a `max-h` so a long list never stretches the page.
- **Below `xl`:** columns collapse to a single column; the rail drops **below** the main content as a full-width card (DOM order is main → aside, so no ordering hacks needed).
- The rail top-aligns with the existing Events `PageHeader`.

## Component: `EventTodosWidget`

Location: `src/app/(authenticated)/events/_components/EventTodosWidget.tsx` (client component).

**Props:** `{ initialTodos: ChecklistTodoItem[]; canManage: boolean; loadError?: string | null }`

**Structure** (design-system components from `@/ds`): a `Card` with:
- `CardHeader` — title "Outstanding Todos" + a summary line, e.g. *"3 overdue · 2 due today"* (or just the relevant non-zero parts).
- `CardBody` — the scrollable flat list. One row per todo, in the order received (chronological).

**Row anatomy** (compact, stacks vertically to fit the narrow rail):
- A coloured **left border** indicating urgency.
- Optional `Checkbox` (see interactivity) on the left.
- Line 1: task `label`.
- Line 2: `eventName` (muted/truncated) + a relative-due `Badge` and the `channel` tag.
- The row (excluding the checkbox) is a link to `/events/{eventId}` so staff can jump to the event to action it.

**Urgency visuals** (two states only):
| Status | Left border / Badge tone | Relative-due text |
|---|---|---|
| `overdue` | red (`danger`) | "Overdue by Nd" |
| `due_today` | amber (`warning`) | "Due today" |

Because the list is sorted by `dueDate` ascending, the most-overdue items naturally sort to the top.

## Interactivity (confirmed: interactive)

- If `canManage` is true, each row shows a `Checkbox`. Ticking it:
  1. Optimistically **removes** the row from local state (it is no longer "outstanding").
  2. Calls `toggleEventChecklistTask(eventId, key, true)`.
  3. On failure, restores the row and shows an error toast.
- `toggleEventChecklistTask` already enforces `events:manage`, writes an audit log, and `revalidatePath('/events')` — so the server-side count refreshes on the next load.
- If `canManage` is false, rows render **without** checkboxes (read-only). The list is still fully visible.
- The checkbox click target must stop propagation so ticking a row does not navigate to the event detail page.

## Derived-display helpers (unit-testable, pure)

Extract pure functions (co-located, e.g. `eventTodosWidget.helpers.ts`) so logic is testable without rendering:
- `formatRelativeDue(dueDate: string, todayIso: string): string` → "Overdue by 3d" / "Due today". Use deterministic ISO-date arithmetic; never raw browser-local date parsing for user-visible display.
- `summariseTodos(items): { overdue: number; dueToday: number }` → for the header summary line.

## States

- **Loading:** none needed for first paint (server-rendered with data). Toggle uses `useTransition`; dim the row while pending.
- **Empty:** friendly message — *"You're all caught up — no outstanding todos."*
- **Load error:** show a compact warning in the card body, e.g. *"Outstanding todos could not be loaded."* Do **not** show the caught-up empty state when `loadError` is present.
- **Error (toggle):** restore optimistic change + toast.

## Permissions

- Page already gates on `events:view` (redirects otherwise). The widget inherits that.
- Ticking requires `events:manage`, enforced both in the UI (`canManage`) and server-side in `toggleEventChecklistTask` (never rely on UI hiding alone).

## Accessibility

- Checkboxes use the DS `Checkbox` with an explicit accessible name, e.g. `aria-label={`Mark ${item.label} complete`}`.
- Urgency is conveyed by **badge text + relative-due text**, not colour alone.
- Row links are keyboard-focusable with visible focus styles.
- The scroll container is keyboard-scrollable; the rail card uses a proper heading.

## Testing

Per project testing conventions (Vitest, mock external/server actions):
- `formatRelativeDue` — overdue (N days), due-today, boundary cases.
- `summariseTodos` — counts by status, empty input.
- `EventTodosWidget` — renders rows in the order received; correct badge tone per status; empty state only when no `loadError`; load-error state; checkbox hidden when `!canManage`; checkbox has an accessible name; optimistic removal on toggle success; rollback + toast on toggle failure (mock `toggleEventChecklistTask`).
- Include at least one fixture item from a draft event to prove the widget does not silently filter by event status.

## Risks & rollback

- **Risk:** the right rail narrows the calendar/list view on mid-width screens. Mitigated by the `xl` breakpoint (rail only sits beside content on wide screens; stacks below otherwise).
- **Risk:** the rail may be dominated by draft events because `getChecklistTodos()` includes all current/future event statuses. This is accepted for this implementation because it preserves the existing `/events/todo` dataset.
- **Risk:** stale task keys exist in historical checklist status rows and one auto-close migration. Mitigated by deriving display rows only from current `EVENT_CHECKLIST_DEFINITIONS`.
- **Risk:** sticky positioning interaction with the flex row. Verify during implementation in-browser.
- **Rollback:** the change is additive and isolated to `page.tsx` (wrapper) + one new component. Reverting the `page.tsx` wrapper restores the original single-column page; `EventsClient`, `getChecklistTodos`, and `/events/todo` are untouched.

## Files

- **Modify:** `src/app/(authenticated)/events/page.tsx` — add `getChecklistTodos()` + `canManage` to the fetch, pass `loadError`, wrap content in the two-column row, render `EventTodosWidget`.
- **Create:** `src/app/(authenticated)/events/_components/EventTodosWidget.tsx`.
- **Create:** `src/app/(authenticated)/events/_components/eventTodosWidget.helpers.ts` (+ co-located test).
