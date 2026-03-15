# Design Spec: Add Shifts Modal

**Date:** 2026-03-15
**Project:** OJ-AnchorManagementTools
**Feature:** "Add Shifts" button + modal on /rota
**Status:** Approved by user

---

## Overview

A secondary "Add Shifts" button sits next to the existing "Apply Templates" button in the rota grid toolbar. Clicking it opens a week-scoped modal that lets the user pick individual shift templates to add, with intelligent recommendations based on which templates are already scheduled for each day and which shifts already exist in the current week.

---

## User-Facing Behaviour

### Trigger

- A secondary (outline) button labelled **"Add Shifts"** appears in the rota toolbar next to "Apply Templates".
- Visible whenever `canEdit === true` and at least one active shift template exists (regardless of whether any template has `day_of_week` set). This requires a new `useMemo` variable `hasAnyActiveTemplate = templates.some(t => t.is_active)` — separate from the existing `hasScheduledTemplates` guard used by "Apply Templates" — so the two buttons are independently controlled.
- Clicking it opens the modal for the currently-selected week.

### Modal — Structure

**Header**
- Title: "Add Shifts"
- Subtitle: "Week of Mon DD MMM – Sun DD MMM · N recommended, N already scheduled"
- Close (×) button

**Body (scrollable)**

The body has two zones:

**Zone 1 — Scheduled templates, grouped by day (Monday → Sunday)**

For each day of the week, a sticky day-header row shows the day name and date. Beneath it, every active template with `day_of_week` matching that day is listed as a shift row containing:
- Checkbox (pre-state determined by recommendation logic — see below)
- Template name + department badge
- Time range and paid hours
- Employee chip if `template.employee_id` is set (e.g. "👤 Jamie K")
- State badge: **"Recommended"** (blue) or **"Already added"** (grey, row disabled)

Day states:
- **Has rows to show:** display them normally.
- **All scheduled templates already added:** collapse the rows, show "✓ All scheduled templates already added" inline next to the day header in green.
- **No scheduled templates:** show a one-line italic note: "No templates scheduled for [Day]s — use Other templates below to add manually."

**Zone 2 — "Other templates" (floating, amber strip)**

Templates with `day_of_week === null` are listed here, each with:
- Checkbox (unchecked by default)
- Template name + department badge + time/hours
- A **day picker** dropdown ("Pick a day…" → Mon–Sun with dates). Required before the checkbox can submit.

If there are no floating templates, this zone is hidden.

**Footer**
- Left: live summary — "**N shifts** selected to add" (updates as user ticks/unticks)
- Right: "Cancel" (outline) + "Add N shifts" (primary, disabled when 0 selected or any checked floating template has no day picked)

### Recommendation Logic

On modal open, the client fetches (or receives from the server) the set of shifts already present this week. For each scheduled template (has `day_of_week`):

1. Calculate the target date for that day within the current week.
2. Check if a shift already exists this week that was created from this template (`template_id` match) on that date **OR** any shift exists for the same `(start_time, end_time, department)` tuple on that date (looser duplicate check as fallback). Both `start_time` values are normalised to `HH:MM` for comparison (`shift.start_time === template.start_time.slice(0, 5)`).
3. If no match → **Recommended** (pre-checked).
4. If match found → **Already added** (disabled, unchecked).

Floating templates are always unchecked with no state badge.

### Submission

On "Add N shifts" click:
1. Validate: every checked floating template must have a day selected.
2. Call a new server action `addShiftsFromTemplates(weekId, selections)` where `selections` is an array of `{ templateId, date }`.
3. Server action:
   - Re-fetches existing shifts for the week server-side to guard against race conditions (same deduplication logic as `autoPopulateWeekFromTemplates`).
   - Skips any `(templateId, date)` pair that already has a shift (idempotent).
   - Batch-inserts remaining shifts, respecting `template.employee_id` if set.
   - Returns `{ success, created: number, skipped: number, shifts: RotaShift[] }`.
4. On success: merge new shifts into local rota state, show toast "Added N shifts" (and if skipped > 0: "N already existed and were skipped"), close modal.
5. On error: show toast with error message, keep modal open.

---

## Component Design

### New files
- `src/app/(authenticated)/rota/AddShiftsModal.tsx` — modal component (client)

### Modified files
- `src/app/actions/rota.ts` — add `addShiftsFromTemplates()` server action
- `src/app/(authenticated)/rota/RotaGrid.tsx` — add button + modal state

### `AddShiftsModal` props
```typescript
interface AddShiftsModalProps {
  week: RotaWeek;
  weekDates: string[];           // Always exactly 7 ISO dates, index 0 = Monday … index 6 = Sunday (matches day_of_week). weekDates[t.day_of_week] gives the target date for template t.
  templates: ShiftTemplate[];    // all active templates
  existingShifts: RotaShift[];   // current week's shifts (for recommendation logic)
  employees: RotaEmployee[];     // for resolving employee_id → display name
  onClose: () => void;
  onShiftsAdded: (shifts: RotaShift[]) => void;
}
```

### `addShiftsFromTemplates` server action
```typescript
type ShiftSelection = { templateId: string; date: string }; // date = ISO "YYYY-MM-DD"

addShiftsFromTemplates(
  weekId: string,
  selections: ShiftSelection[]
): Promise<{ success: true; created: number; skipped: number; shifts: RotaShift[] }
         | { success: false; error: string }>
```

Server-side deduplication key: `${templateId}:${shiftDate}` (same as `autoPopulateWeekFromTemplates`). `skipped` is not present in `autoPopulateWeekFromTemplates` and must be computed explicitly as `selections.length - insertPayload.length` after the deduplication loop.

---

## Data Flow

```
RotaGrid (has existingShifts, templates, employees in state)
  └─ opens AddShiftsModal with those props
       └─ client computes recommendations (no extra fetch needed)
       └─ on submit → addShiftsFromTemplates(weekId, selections)
            └─ server deduplicates + inserts
            └─ returns new RotaShift[]
       └─ onShiftsAdded(newShifts) → RotaGrid merges into local state
```

No extra server round-trip to open the modal — all data already in RotaGrid's state.

---

## Edge Cases

| Scenario | Behaviour |
|---|---|
| All templates for every day already exist | Modal opens; all scheduled rows disabled; only floating templates actionable |
| No shift templates exist | Button not rendered (same condition as "Apply Templates") |
| No floating templates | "Other templates" section hidden entirely |
| Floating template checked but no day selected | "Add N shifts" button disabled; field highlighted on attempted submit |
| Race condition (shift added between open and submit) | Server skips duplicate silently; `skipped` count in toast |
| Week has no `id` yet (never had a shift) | `autoPopulateWeekFromTemplates` returns an error if the week record is missing — `addShiftsFromTemplates` follows the same pattern. RotaGrid must only open the modal for weeks that already have an `id` (i.e. at least one shift or the week row exists). If `week.id` is absent, the button should be disabled or the modal should show an error. |
| `canEdit === false` | Button not rendered |

---

## Permissions

- Button only rendered when `canEdit === true` (existing RBAC check, `rota` / `create`).
- Server action calls `checkUserPermission('rota', 'edit')` and returns `{ error: 'Permission denied' }` if not authorised. Uses `'edit'` (not `'create'`) to match the precedent set by `autoPopulateWeekFromTemplates`.

---

## UI Standards

- Modal follows existing modal patterns in the rota section (state in RotaGrid, conditional render, `onClose` prop).
- Uses `ui-v2` components: `Button`, `Badge`, `Select` (for day picker), inline checkboxes.
- Uses `sonner` toast (not `react-hot-toast`) for success/error feedback.
- Department badge colours follow `DEPARTMENT_COLOURS` / `DEPARTMENT_BADGE` pattern from `ShiftTemplatesManager`, with the `?? 'default'` fallback for unknown departments.
- Paid hours calculated client-side with the same `paidHours()` helper pattern used in `ShiftTemplatesManager`.

---

## Out of Scope

- Editing template details from within this modal (use /rota/templates for that).
- Bulk-assigning employees within this modal (assignment respects `template.employee_id`; drag-and-drop on the grid handles manual assignment).
- Historical coverage analysis for recommendation (Option B from brainstorm — deferred).
