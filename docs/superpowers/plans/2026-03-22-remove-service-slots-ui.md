# Remove Service Slots Configuration UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the unused ScheduleConfigEditor UI from business hours settings while preserving the load-bearing schedule_config backend.

**Architecture:** Pure UI deletion — remove 1 component file, strip its integration from 2 parent components, and update 1 calendar description. No backend, database, or API changes.

**Tech Stack:** React, TypeScript, Next.js App Router

**Spec:** `docs/superpowers/specs/2026-03-22-remove-service-slots-ui.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/app/(authenticated)/settings/business-hours/ScheduleConfigEditor.tsx` | DELETE | The unused service slots editor component |
| `src/app/(authenticated)/settings/business-hours/BusinessHoursManager.tsx` | MODIFY | Remove editor integration (imports, state, modal). Preserve Sunday Lunch and schedule_config submission. |
| `src/app/(authenticated)/settings/business-hours/SpecialHoursModal.tsx` | MODIFY | Remove editor JSX block. Preserve scheduleConfig state and submit merge logic. |
| `src/app/(authenticated)/settings/business-hours/SpecialHoursCalendar.tsx` | MODIFY | Update description text to remove "adjust service slots" reference. |

---

### Task 1: Modify BusinessHoursManager — remove editor integration

**Files:**
- Modify: `src/app/(authenticated)/settings/business-hours/BusinessHoursManager.tsx`

This is the highest-risk file because the code being removed sits adjacent to load-bearing Sunday Lunch code. Follow the removal list exactly.

- [ ] **Step 1: Remove 3 imports (lines 11-13)**

Remove these three lines:
```typescript
import { Modal } from '@/components/ui-v2/overlay/Modal'
import { ScheduleConfigEditor } from './ScheduleConfigEditor'
import { Settings } from 'lucide-react'
```

- [ ] **Step 2: Remove `editingConfigDay` state (line 33)**

Remove this line:
```typescript
const [editingConfigDay, setEditingConfigDay] = useState<number | null>(null)
```

- [ ] **Step 3: Remove `handleConfigChange` function (lines 39-44)**

Remove the entire function:
```typescript
const handleConfigChange = (dayOfWeek: number, newConfig: any[]) => {
    if (!canManage) return
    setHours(prev => prev.map(h =>
      h.day_of_week === dayOfWeek ? { ...h, schedule_config: newConfig } : h
    ))
  }
```

- [ ] **Step 4: Remove the "Slots" column from the DataTable (lines 264-274)**

Remove this column entry from the `columns` array:
```typescript
{ key: 'config', header: 'Slots', cell: (h: any) => (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEditingConfigDay(h.day_of_week)}
              disabled={!canManage || h.is_closed}
              title="Configure Service Slots"
            >
              <Settings className="w-4 h-4" />
            </Button>
          ) },
```

- [ ] **Step 5: Remove the modal block (lines 341-358)**

Remove the entire conditional modal rendering:
```tsx
{editingConfigDay !== null && (
        <Modal
          open={true}
          onClose={() => setEditingConfigDay(null)}
          title={`Edit Service Slots for ${DAY_NAMES[editingConfigDay]}`}
          size="lg"
        >
          <div className="p-6">
            <ScheduleConfigEditor
              config={hours.find(h => h.day_of_week === editingConfigDay)?.schedule_config || []}
              onChange={(newConfig) => handleConfigChange(editingConfigDay, newConfig)}
            />
            <div className="mt-6 flex justify-end">
              <Button onClick={() => setEditingConfigDay(null)}>Done</Button>
            </div>
          </div>
        </Modal>
      )}
```

- [ ] **Step 6: Verify preservation — visually confirm these are NOT touched**

These must remain intact after your edits:
- `handleSundayLunchTimeChange` function (lines 100-132)
- `getSundayLunchTime` function (lines 134-137)
- Sunday Lunch columns `slopens` and `slcloses` (lines 240-263)
- `formData.append(\`schedule_config_\${dayHours.day_of_week}\`, ...)` in `handleSubmit` (line 158)

- [ ] **Step 7: Run lint check**

Run: `npx eslint src/app/\(authenticated\)/settings/business-hours/BusinessHoursManager.tsx --no-error-on-unmatched-pattern`
Expected: No errors. If `Modal`, `Settings`, or `editingConfigDay` appear as unused — you missed a removal. If `handleSundayLunchTimeChange` or `getSundayLunchTime` appear as unused — you removed something you shouldn't have.

---

### Task 2: Modify SpecialHoursModal — remove editor JSX block

**Files:**
- Modify: `src/app/(authenticated)/settings/business-hours/SpecialHoursModal.tsx`

- [ ] **Step 1: Remove the ScheduleConfigEditor import (line 8)**

Remove this line:
```typescript
import { ScheduleConfigEditor } from './ScheduleConfigEditor'
```

- [ ] **Step 2: Remove the Service Slots JSX block (lines 392-403)**

Remove this entire block:
```tsx
{/* Service Slots */}
        {!isClosed && (
          <div className="pt-4 border-t border-gray-200">
            <ScheduleConfigEditor
              config={scheduleConfig}
              onChange={setScheduleConfig}
            />
            <p className="text-xs text-gray-500 mt-2">
              These slots determine customer booking availability for this specific date.
            </p>
          </div>
        )}
```

- [ ] **Step 3: Add retention comments to setScheduleConfig calls**

Add a comment above each `setScheduleConfig` call explaining why it must stay:

At line 59 (inside the `if (initialData)` branch):
```typescript
// Retained: carries existing seeded schedule_config through save without overwriting
setScheduleConfig(initialData.schedule_config || [])
```

At line 85 (inside the `else` reset branch):
```typescript
// Retained: reset schedule_config for new exceptions (preserves seeded data on save)
setScheduleConfig([])
```

At line 107 (inside `fetchDefaults`):
```typescript
// Retained: pre-fills with regular day's schedule_config so save doesn't overwrite seeded data
setScheduleConfig(regular.schedule_config || [])
```

- [ ] **Step 4: Verify preservation — confirm these are NOT touched**

These must remain intact:
- `scheduleConfig` state declaration (line 47)
- `ScheduleConfigItem` import (line 10) — still used by the state type
- All `sundayLunchOpens`/`sundayLunchCloses` state and UI (lines 44-45, 288-378)
- The `handleSubmit` merge logic that builds `finalConfig` from `scheduleConfig` (lines 156-202)
- The `formData.append('schedule_config', JSON.stringify(finalConfig))` (line 202)

- [ ] **Step 5: Run lint check**

Run: `npx eslint src/app/\(authenticated\)/settings/business-hours/SpecialHoursModal.tsx --no-error-on-unmatched-pattern`
Expected: No errors. `ScheduleConfigItem` should NOT be flagged as unused (it's still used by `scheduleConfig` state).

---

### Task 3: Update SpecialHoursCalendar description text

**Files:**
- Modify: `src/app/(authenticated)/settings/business-hours/SpecialHoursCalendar.tsx:157`

- [ ] **Step 1: Update the description text**

Change line 157 from:
```typescript
description="Click any date to close the venue, change hours, or adjust service slots."
```
To:
```typescript
description="Click any date to close the venue or change hours."
```

---

### Task 4: Delete ScheduleConfigEditor component

**Files:**
- Delete: `src/app/(authenticated)/settings/business-hours/ScheduleConfigEditor.tsx`

- [ ] **Step 1: Delete the file**

```bash
rm src/app/\(authenticated\)/settings/business-hours/ScheduleConfigEditor.tsx
```

**Important:** Do this AFTER Tasks 1-3. If you delete the file first, the other files will fail to compile because they still import it.

---

### Task 5: Verify and commit

- [ ] **Step 1: Run the full verification pipeline**

```bash
npm run lint && npx tsc --noEmit && npm run build
```

All three must pass with zero errors. If any fail, the most likely causes are:
- Orphaned import (forgot to remove `Modal`, `Settings`, or `ScheduleConfigEditor` import)
- Accidentally deleted a load-bearing function (`handleSundayLunchTimeChange`, `getSundayLunchTime`, `scheduleConfig` state)
- Missing closing bracket from removing JSX block

- [ ] **Step 2: Manual regression checks (if dev server available)**

Verify in a running dev server (`npm run dev`):
1. **Weekly view**: edit Sunday hours, save — confirm Sunday Lunch start/end times persist after page reload
2. **Exceptions calendar**: click a Sunday, edit exception hours, save — confirm Sunday Lunch merge logic works (times retained)
3. **Exceptions calendar**: click a non-Sunday, save — confirm existing seeded slots are not wiped (check `schedule_config` in the saved FormData via network tab or server action logs)

All three must save without data loss before committing.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "refactor: remove unused Service Slots Configuration UI

Remove ScheduleConfigEditor component and its integration from
BusinessHoursManager and SpecialHoursModal. The schedule_config
JSONB column and booking validation RPC remain intact — only the
unused generic slots editor UI is removed.

Sunday Lunch dedicated UI and all schedule_config persistence
paths are preserved.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```
