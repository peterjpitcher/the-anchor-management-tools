# Timeclock "Use Planned" Links

**Complexity:** XS (1) — single file change
**Date:** 2026-04-10

## Problem

When editing timeclock entries, managers often need to correct clock-in/out times to match the planned shift times. Currently they must read the planned time displayed nearby and manually type it into the input field. This is tedious and error-prone.

## Solution

Add a small "Use planned" text link beneath each time input when editing a timeclock row. Clicking the link populates the corresponding input with the planned time from the linked shift. The user still confirms via the existing Save button.

## Visibility Rules

| Condition | Clock-in link | Clock-out link |
|-----------|--------------|----------------|
| Not editing | Hidden | Hidden |
| Editing, no linked shift (unscheduled) | Hidden | Hidden |
| Editing, has linked shift, employee still clocked in | Shown | Hidden |
| Editing, has linked shift, employee clocked out | Shown | Shown |

## Behaviour

- Clicking "Use planned" sets the edit state (`editIn` or `editOut`) to `s.planned_start` or `s.planned_end` respectively
- No database write — user must click Save to confirm
- Consistent with the existing edit-then-save flow

## Styling

- `text-xs text-blue-600 hover:text-blue-800 cursor-pointer` — small, subtle, clearly clickable
- Rendered directly below the `<input type="time">` field

## Files Changed

- `src/app/(authenticated)/rota/timeclock/TimeclockManager.tsx` — add two conditional "Use planned" links in the edit-mode rendering

## No Changes Required

- No server action changes
- No type/interface changes
- No new components
- No database changes
