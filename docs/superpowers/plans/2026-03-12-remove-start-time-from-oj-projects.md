# Remove Start Time from OJ-Projects Quick Entry — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the start time field from oj-projects time entry creation and editing, storing NULL for `start_at`/`end_at` on new entries while preserving historical timestamps.

**Architecture:** Relax the DB CHECK constraint to allow NULL `start_at`/`end_at` for time entries. Remove `start_time` from Zod schemas and server action logic. Strip the start time input from both UI forms. Update `buildInvoiceNotes` to conditionally omit the time range when `start_at` is NULL.

**Tech Stack:** Next.js 15 App Router, TypeScript, Supabase (PostgreSQL), Zod, Vitest, Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-03-12-remove-quick-entry-start-time-design.md`

---

## File Map

| File | Change |
|---|---|
| `supabase/migrations/20260512000000_oj_entries_relax_time_constraint.sql` | **Create** — new constraint allows NULL start_at/end_at for time entries |
| `src/app/actions/oj-projects/entries.ts` | **Modify** — remove start_time from schemas, remove timestamp computation, preserve timestamps on update, remove overlap detection |
| `src/app/actions/oj-projects/__tests__/entries.test.ts` | **Create** — tests for createTimeEntry and updateEntry |
| `src/app/(authenticated)/oj-projects/page.tsx` | **Modify** — remove startTime field from quick entry form |
| `src/app/(authenticated)/oj-projects/entries/page.tsx` | **Modify** — remove start/end time from edit modal (incl. EntryFormState + openEdit), update table display, remove toLondonTimeHm |
| `src/app/api/cron/oj-projects-billing/route.ts` | **Modify** — update buildInvoiceNotes to format lines without time range when start_at is NULL |

---

## Chunk 1: Database Migration

### Task 1: Write and apply the migration

**Files:**
- Create: `supabase/migrations/20260512000000_oj_entries_relax_time_constraint.sql`

**Context:** The current live constraint (last set in `20260226120000_oj_entries_one_off.sql`) is:
```sql
(entry_type = 'time' AND start_at IS NOT NULL AND end_at IS NOT NULL AND duration_minutes_rounded IS NOT NULL AND miles IS NULL)
OR
(entry_type = 'mileage' AND miles IS NOT NULL AND start_at IS NULL AND end_at IS NULL AND duration_minutes_rounded IS NULL)
OR
(entry_type = 'one_off' AND amount_ex_vat_snapshot IS NOT NULL AND miles IS NULL AND start_at IS NULL AND end_at IS NULL AND duration_minutes_rounded IS NULL)
```

The only change is to the `time` branch: remove the `start_at IS NOT NULL AND end_at IS NOT NULL` requirement, and add `(start_at IS NULL) = (end_at IS NULL)` to enforce pairing. All other branches are unchanged.

**Migration filename note:** The latest migration is `20260509000012_...`. This filename (`20260512000000`) sorts after it, ensuring correct application order.

- [ ] **Step 1: Pre-check existing data would not violate the new pairing rule**

Run this in Supabase SQL Editor (or via `psql`) before writing the migration. There should be zero rows returned — if any exist they must be fixed manually first.

```sql
SELECT id, start_at, end_at
FROM oj_entries
WHERE entry_type = 'time'
  AND (
    (start_at IS NULL AND end_at IS NOT NULL)
    OR (start_at IS NOT NULL AND end_at IS NULL)
  );
```

Expected: 0 rows. If any rows are returned, stop and investigate before proceeding.

- [ ] **Step 2: Create the migration file**

```sql
-- Relax oj_entries CHECK constraint to allow NULL start_at/end_at for time entries.
-- Previously time entries required start_at and end_at. Going forward, only
-- duration_minutes_rounded is required; timestamps are optional (preserved for
-- historical entries only).
--
-- Only the 'time' branch changes. Mileage and one_off branches are identical to
-- the constraint set in 20260226120000_oj_entries_one_off.sql.

ALTER TABLE public.oj_entries
  DROP CONSTRAINT IF EXISTS chk_oj_entries_time_fields;

ALTER TABLE public.oj_entries
  ADD CONSTRAINT chk_oj_entries_time_fields
  CHECK (
    (
      entry_type = 'time'
      AND duration_minutes_rounded IS NOT NULL
      AND miles IS NULL
      AND (start_at IS NULL) = (end_at IS NULL)  -- both set or both NULL, never partial
    )
    OR (
      entry_type = 'mileage'
      AND miles IS NOT NULL
      AND start_at IS NULL
      AND end_at IS NULL
      AND duration_minutes_rounded IS NULL
    )
    OR (
      entry_type = 'one_off'
      AND amount_ex_vat_snapshot IS NOT NULL
      AND miles IS NULL
      AND start_at IS NULL
      AND end_at IS NULL
      AND duration_minutes_rounded IS NULL
    )
  );
```

- [ ] **Step 3: Dry-run to verify SQL is valid**

```bash
npx supabase db push --dry-run
```

Expected: migration listed as pending, no errors.

- [ ] **Step 4: Apply the migration**

```bash
npx supabase db push
```

Expected: migration applied successfully.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260512000000_oj_entries_relax_time_constraint.sql
git commit -m "fix: relax oj_entries CHECK constraint to allow NULL start_at/end_at for time entries"
```

---

## Chunk 2: Server Actions

### Task 2: Update createTimeEntry — write failing tests first

**Files:**
- Create: `src/app/actions/oj-projects/__tests__/entries.test.ts`
- Modify: `src/app/actions/oj-projects/entries.ts`

**What changes in entries.ts:**
- Remove `start_time` from `TimeEntrySchema`
- Remove `fromZonedTime` import (only used by `toLondonUtcIso`)
- Remove three now-dead helpers: `timeToMinutes()`, `toLondonUtcIso()`, `addMinutesToIso()`
- Remove `LONDON_TZ` constant (only used by `toLondonUtcIso`)
- Rewrite `createTimeEntry` body: no timestamp computation, `start_at: null, end_at: null`, no overlap detection block — **do this as a single atomic rewrite** to avoid an intermediate broken state where `endAtIso`/`startAtIso` are referenced by the overlap block but never computed

- [ ] **Step 1: Create the test file with failing tests for createTimeEntry**

```typescript
// src/app/actions/oj-projects/__tests__/entries.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))
vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn(),
}))
vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn(),
}))

import { createTimeEntry } from '../entries'
import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'

const mockCheckUserPermission = vi.mocked(checkUserPermission)
const mockCreateClient = vi.mocked(createClient)
const mockLogAuditEvent = vi.mocked(logAuditEvent)

function makeFormData(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

function makeSupabaseMock() {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'user-1', email: 'test@test.com' } },
      }),
    },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'oj_vendor_billing_settings') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { hourly_rate_ex_vat: 75, vat_rate: 20, mileage_rate: 0.42 },
          }),
        }
      }
      if (table === 'oj_projects') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { id: 'b0000000-0000-0000-0000-000000000001', vendor_id: 'a0000000-0000-0000-0000-000000000001', status: 'active' },
            error: null,
          }),
        }
      }
      if (table === 'oj_work_types') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        }
      }
      // oj_entries insert path
      return {
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            id: 'entry-1',
            project_id: 'b0000000-0000-0000-0000-000000000001',
            entry_date: '2026-03-12',
            duration_minutes_rounded: 60,
            start_at: null,
            end_at: null,
          },
          error: null,
        }),
      }
    }),
  }
}

describe('createTimeEntry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckUserPermission.mockResolvedValue(true)
    mockLogAuditEvent.mockResolvedValue(undefined)
  })

  it('should create a time entry with null start_at and end_at', async () => {
    const supabaseMock = makeSupabaseMock()
    mockCreateClient.mockResolvedValue(supabaseMock as any)

    const fd = makeFormData({
      vendor_id: 'a0000000-0000-0000-0000-000000000001',
      project_id: 'b0000000-0000-0000-0000-000000000001',
      entry_date: '2026-03-12',
      duration_minutes: '60',
    })

    const result = await createTimeEntry(fd)

    expect(result.error).toBeUndefined()
    expect(result.success).toBe(true)
  })

  it('should ignore start_time if passed in FormData', async () => {
    const supabaseMock = makeSupabaseMock()
    mockCreateClient.mockResolvedValue(supabaseMock as any)

    const fd = makeFormData({
      vendor_id: 'a0000000-0000-0000-0000-000000000001',
      project_id: 'b0000000-0000-0000-0000-000000000001',
      entry_date: '2026-03-12',
      duration_minutes: '60',
      start_time: '09:00', // should be silently ignored
    })

    const result = await createTimeEntry(fd)
    expect(result.error).toBeUndefined()
    expect(result.success).toBe(true)
  })

  it('should return an error when the user lacks permission', async () => {
    mockCheckUserPermission.mockResolvedValue(false)

    const fd = makeFormData({
      vendor_id: 'a0000000-0000-0000-0000-000000000001',
      project_id: 'b0000000-0000-0000-0000-000000000001',
      entry_date: '2026-03-12',
      duration_minutes: '60',
    })

    const result = await createTimeEntry(fd)
    expect(result.error).toBeDefined()
  })
})
```

- [ ] **Step 2: Run to confirm it fails**

```bash
npx vitest run src/app/actions/oj-projects/__tests__/entries.test.ts
```

Expected: FAIL — `start_time` is required in the current `TimeEntrySchema`.

- [ ] **Step 3: Rewrite createTimeEntry atomically** (schema change + body rewrite + overlap removal in one edit)

**3a. Remove `start_time` from `TimeEntrySchema`:**
```typescript
// Remove this line:
start_time: z.string().regex(/^\d{2}:\d{2}$/, 'Start time must be HH:MM'),
```

**3b. Remove unused imports and helpers** — delete all four:
```typescript
// Remove import:
import { fromZonedTime } from 'date-fns-tz'

// Remove constant:
const LONDON_TZ = 'Europe/London'

// Remove functions:
function timeToMinutes(time: string) { ... }
function toLondonUtcIso(date: string, time: string) { ... }
function addMinutesToIso(isoContext: string, minutes: number) { ... }
```

**3c. Replace the entire `createTimeEntry` function body** with:
```typescript
export async function createTimeEntry(formData: FormData) {
  const hasPermission = await checkUserPermission('oj_projects', 'create')
  if (!hasPermission) return { error: 'You do not have permission to create entries' }

  const parsed = TimeEntrySchema.safeParse({
    vendor_id: formData.get('vendor_id'),
    project_id: formData.get('project_id'),
    entry_date: formData.get('entry_date'),
    duration_minutes: formData.get('duration_minutes'),
    work_type_id: formData.get('work_type_id') || undefined,
    description: formData.get('description') || undefined,
    internal_notes: formData.get('internal_notes') || undefined,
    billable: formData.get('billable') ?? undefined,
  })
  if (!parsed.success) return { error: parsed.error.errors[0].message }

  const rawMinutes = parsed.data.duration_minutes
  const roundedMinutes = Math.ceil(rawMinutes / 15) * 15
  if (roundedMinutes <= 0) return { error: 'Invalid duration after rounding' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const match = await ensureProjectMatchesVendor(supabase, parsed.data.project_id, parsed.data.vendor_id)
  if ('error' in match) return { error: match.error }

  const workTypeId = parsed.data.work_type_id ? String(parsed.data.work_type_id) : null
  const [settings, workTypeName] = await Promise.all([
    getVendorSettingsOrDefault(supabase, parsed.data.vendor_id),
    getWorkTypeName(supabase, workTypeId),
  ])

  const { data, error } = await supabase
    .from('oj_entries')
    .insert({
      vendor_id: parsed.data.vendor_id,
      project_id: parsed.data.project_id,
      entry_type: 'time',
      entry_date: parsed.data.entry_date,
      start_at: null,
      end_at: null,
      duration_minutes_raw: rawMinutes,
      duration_minutes_rounded: roundedMinutes,
      miles: null,
      work_type_id: workTypeId,
      work_type_name_snapshot: workTypeName,
      description: parsed.data.description || null,
      internal_notes: parsed.data.internal_notes || null,
      billable: parsed.data.billable ?? true,
      status: 'unbilled',
      hourly_rate_ex_vat_snapshot: settings.hourly_rate_ex_vat,
      vat_rate_snapshot: settings.vat_rate,
      mileage_rate_snapshot: null,
    })
    .select('*')
    .single()

  if (error) return { error: error.message }

  await logAuditEvent({
    user_id: user?.id,
    user_email: user?.email,
    operation_type: 'create',
    resource_type: 'oj_entry',
    resource_id: data.id,
    operation_status: 'success',
    new_values: {
      entry_type: 'time',
      project_id: data.project_id,
      entry_date: data.entry_date,
      duration_minutes_rounded: data.duration_minutes_rounded,
    },
  })

  return { entry: data, success: true as const }
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
npx vitest run src/app/actions/oj-projects/__tests__/entries.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Run lint and typecheck**

```bash
npm run lint && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/actions/oj-projects/__tests__/entries.test.ts src/app/actions/oj-projects/entries.ts
git commit -m "feat: remove start_time from createTimeEntry; write null start_at/end_at"
```

---

### Task 3: Update updateEntry — preserve existing timestamps

**Files:**
- Modify: `src/app/actions/oj-projects/entries.ts`
- Modify: `src/app/actions/oj-projects/__tests__/entries.test.ts`

**What changes:**
- Remove `start_time` from `UpdateEntrySchema`
- Remove `start_time` from `formData.get()` call in `updateEntry`
- Update the existing row `SELECT` to also fetch `start_at` and `end_at` — **note:** this changes the inferred TypeScript type of `existing`. After the change `existing` will have type `{ id: string; status: string; start_at: string | null; end_at: string | null }`. The `existing.start_at` and `existing.end_at` references in the update payload will then type-check correctly. If TypeScript complains about the type, add an explicit type annotation: `const { data: existing, error: fetchError } = ...` — the Supabase client narrows the return type based on the `.select()` string.
- Rewrite the time entry branch: no `start_time` requirement check, no timestamp computation, preserve `existing.start_at ?? null` and `existing.end_at ?? null`, remove overlap detection block

- [ ] **Step 1: Add failing tests to the test file**

Add inside `src/app/actions/oj-projects/__tests__/entries.test.ts`:

```typescript
import { updateEntry } from '../entries'

function makeUpdateSupabaseMock(existingStartAt: string | null, existingEndAt: string | null) {
  let entriesCallCount = 0
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'user-1', email: 'test@test.com' } },
      }),
    },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'oj_vendor_billing_settings') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { hourly_rate_ex_vat: 75, vat_rate: 20 },
          }),
        }
      }
      if (table === 'oj_projects') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { id: 'b0000000-0000-0000-0000-000000000001', vendor_id: 'a0000000-0000-0000-0000-000000000001', status: 'active' },
            error: null,
          }),
        }
      }
      if (table === 'oj_work_types') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        }
      }
      if (table === 'oj_entries') {
        entriesCallCount++
        const mock = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { id: 'entry-1', status: 'unbilled', start_at: existingStartAt, end_at: existingEndAt },
            error: null,
          }),
          update: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: 'entry-1', entry_type: 'time', duration_minutes_rounded: 60, start_at: existingStartAt, end_at: existingEndAt },
            error: null,
          }),
        }
        return mock
      }
      return {}
    }),
  }
}

describe('updateEntry (time entry)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckUserPermission.mockResolvedValue(true)
    mockLogAuditEvent.mockResolvedValue(undefined)
  })

  it('should preserve existing start_at/end_at when editing a historical entry', async () => {
    const existingStartAt = '2026-01-15T09:00:00.000Z'
    const existingEndAt = '2026-01-15T10:30:00.000Z'
    const supabaseMock = makeUpdateSupabaseMock(existingStartAt, existingEndAt)
    mockCreateClient.mockResolvedValue(supabaseMock as any)

    const fd = makeFormData({
      id: 'entry-1',
      entry_type: 'time',
      vendor_id: 'a0000000-0000-0000-0000-000000000001',
      project_id: 'b0000000-0000-0000-0000-000000000001',
      entry_date: '2026-03-12',
      duration_minutes: '60',
    })

    const result = await updateEntry(fd)
    expect(result.error).toBeUndefined()
    expect(result.success).toBe(true)
  })

  it('should write null start_at/end_at when entry has no existing timestamps', async () => {
    const supabaseMock = makeUpdateSupabaseMock(null, null)
    mockCreateClient.mockResolvedValue(supabaseMock as any)

    const fd = makeFormData({
      id: 'entry-1',
      entry_type: 'time',
      vendor_id: 'a0000000-0000-0000-0000-000000000001',
      project_id: 'b0000000-0000-0000-0000-000000000001',
      entry_date: '2026-03-12',
      duration_minutes: '60',
    })

    const result = await updateEntry(fd)
    expect(result.error).toBeUndefined()
    expect(result.success).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run src/app/actions/oj-projects/__tests__/entries.test.ts
```

Expected: FAIL — `updateEntry` currently requires `start_time`.

- [ ] **Step 3: Remove `start_time` from `UpdateEntrySchema`**

```typescript
// Remove this line from UpdateEntrySchema:
start_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
```

- [ ] **Step 4: Remove `start_time` from the `formData.get()` call** in `updateEntry`:

```typescript
// Remove this line from the parsed object in updateEntry:
start_time: formData.get('start_time') || undefined,
```

- [ ] **Step 5: Update the existing row fetch** to also select `start_at` and `end_at`:

```typescript
const { data: existing, error: fetchError } = await supabase
  .from('oj_entries')
  .select('id, status, start_at, end_at')  // add start_at, end_at
  .eq('id', parsed.data.id)
  .single()
```

- [ ] **Step 6: Replace the time entry branch atomically** (lines 440–512 in current file):

```typescript
if (parsed.data.entry_type === 'time') {
  if (!parsed.data.duration_minutes) {
    return { error: 'Duration is required for time entries' }
  }

  const rawMinutes = parsed.data.duration_minutes
  const roundedMinutes = Math.ceil(rawMinutes / 15) * 15
  if (roundedMinutes <= 0) return { error: 'Invalid duration after rounding' }

  const workTypeId = entryWorkTypeId
  const workTypeName = preloadedWorkTypeName

  const { data, error } = await supabase
    .from('oj_entries')
    .update({
      vendor_id: parsed.data.vendor_id,
      project_id: parsed.data.project_id,
      entry_date: parsed.data.entry_date,
      start_at: existing.start_at ?? null,  // preserve historical timestamp
      end_at: existing.end_at ?? null,       // preserve historical timestamp
      duration_minutes_raw: rawMinutes,
      duration_minutes_rounded: roundedMinutes,
      work_type_id: workTypeId,
      work_type_name_snapshot: workTypeName,
      description: parsed.data.description ?? null,
      internal_notes: parsed.data.internal_notes ?? null,
      billable: parsed.data.billable ?? true,
      hourly_rate_ex_vat_snapshot: settings.hourly_rate_ex_vat,
      vat_rate_snapshot: settings.vat_rate,
      updated_at: new Date().toISOString(),
    })
    .eq('id', parsed.data.id)
    .select('*')
    .maybeSingle()

  if (error) return { error: error.message }
  if (!data) return { error: 'Entry not found' }

  await logAuditEvent({
    user_id: user?.id,
    user_email: user?.email,
    operation_type: 'update',
    resource_type: 'oj_entry',
    resource_id: parsed.data.id,
    operation_status: 'success',
    new_values: { entry_type: 'time', duration_minutes_rounded: roundedMinutes },
  })

  return { entry: data, success: true as const }
}
```

- [ ] **Step 7: Run all tests**

```bash
npx vitest run src/app/actions/oj-projects/__tests__/entries.test.ts
```

Expected: all tests PASS.

- [ ] **Step 8: Run lint and typecheck**

```bash
npm run lint && npx tsc --noEmit
```

Expected: zero errors. If TypeScript complains about `existing.start_at` not existing on the type, verify the `.select('id, status, start_at, end_at')` change was applied correctly.

- [ ] **Step 9: Commit**

```bash
git add src/app/actions/oj-projects/entries.ts src/app/actions/oj-projects/__tests__/entries.test.ts
git commit -m "feat: remove start_time from updateEntry; preserve historical timestamps on edit"
```

---

## Chunk 3: Quick Entry Form

### Task 4: Remove startTime from the quick entry form

**Files:**
- Modify: `src/app/(authenticated)/oj-projects/page.tsx`

- [ ] **Step 1: Find all references to startTime / start_time in the file**

```bash
grep -n "startTime\|start_time\|start time\|Start time\|Start Time" "src/app/(authenticated)/oj-projects/page.tsx"
```

Note every line number before making changes.

- [ ] **Step 2: Remove `startTime` from form state initialisation**

Find the state object (likely an `useState` initialisation containing `startTime: ''`) and remove that field.

- [ ] **Step 3: Remove `startTime` from the form reset / clear logic**

Find any `setFormState({ ...form, startTime: '' })` or equivalent and remove `startTime` from it.

- [ ] **Step 4: Remove the start time `<input type="time">` and its wrapper/label from the JSX**

- [ ] **Step 5: Remove `formData.append('start_time', ...)` from the submit handler**

- [ ] **Step 6: Run lint and typecheck**

```bash
npm run lint && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(authenticated)/oj-projects/page.tsx"
git commit -m "feat: remove start time input from oj-projects quick entry form"
```

---

## Chunk 4: Entries List Page

### Task 5: Remove start/end time from entries list and edit modal

**Files:**
- Modify: `src/app/(authenticated)/oj-projects/entries/page.tsx`

**What changes:**
1. Remove `toLondonTimeHm` helper function and its import (lint enforces zero unused code)
2. Remove `start_time` and `end_time` from `EntryFormState` type/interface
3. Remove `start_time`/`end_time` loading from the `openEdit` function — currently converts `entry.start_at` → `start_time` via `toLondonTimeHm(entry.start_at) || '09:00'`; after this change those fields are simply gone
4. Remove the start time `<input>` and end time display from the edit modal JSX
5. Remove `fd.append('start_time', ...)` from the edit form submit handler
6. Update the table cell that currently shows `HH:MM–HH:MM` to show duration instead
7. Update the corresponding `<th>` header to "Duration" (or equivalent)

- [ ] **Step 1: Find all references**

```bash
grep -n "startTime\|endTime\|start_time\|end_time\|toLondonTimeHm\|start_at\|end_at" "src/app/(authenticated)/oj-projects/entries/page.tsx"
```

Note every line number before making changes.

- [ ] **Step 2: Remove `toLondonTimeHm` helper and its import**

Delete the function definition and any import it uses (e.g. `Intl.DateTimeFormat` wrappers that are only used by this helper).

- [ ] **Step 3: Remove `start_time` and `end_time` from `EntryFormState`**

Find the type or interface for form state and remove both fields.

- [ ] **Step 4: Update `openEdit` function**

Remove the lines that set `start_time` and `end_time` from `entry.start_at`/`entry.end_at`. These fields no longer exist in form state.

- [ ] **Step 5: Remove start/end time inputs from the edit modal JSX**

Find and remove the start time and end time input fields from the modal form.

- [ ] **Step 6: Remove `fd.append('start_time', ...)` from the submit handler**

- [ ] **Step 7: Update the table cell**

Replace:
```tsx
{toLondonTimeHm(entry.start_at)}–{toLondonTimeHm(entry.end_at)}
```

With:
```tsx
{entry.duration_minutes_rounded
  ? `${(entry.duration_minutes_rounded / 60).toFixed(2)}h`
  : '—'}
```

Update the `<th>` column header to "Duration".

- [ ] **Step 8: Run lint and typecheck**

```bash
npm run lint && npx tsc --noEmit
```

Expected: zero errors. No unused variable warnings.

- [ ] **Step 9: Commit**

```bash
git add "src/app/(authenticated)/oj-projects/entries/page.tsx"
git commit -m "feat: replace start/end time display with duration in oj-projects entries list"
```

---

## Chunk 5: Invoice Notes

### Task 6: Update buildInvoiceNotes for NULL start_at

**Files:**
- Modify: `src/app/api/cron/oj-projects-billing/route.ts`

**Context:** Current format line (~line 319):
```typescript
lines.push(`    - ${e.entry_date} ${start}–${end} (${hours.toFixed(2)}h) [${workType}]${desc ? ` ${desc}` : ''}`)
```
When `start_at` is NULL, `start`/`end` are empty strings producing broken output like `2026-03-12 – (1.00h)`.

After change: guard on `e.start_at` — if present, include the time range; if NULL, omit it entirely.

- [ ] **Step 1: Write a test that defines the expected formats**

Create `src/app/api/cron/oj-projects-billing/__tests__/invoice-notes.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'

// Mirror the formatting logic we're implementing, to lock in the expected output formats.
function formatEntryLine(e: {
  entry_date: string
  start_at: string | null
  end_at: string | null
  duration_minutes_rounded: number | null
  description?: string | null
  work_type_name_snapshot?: string | null
}): string {
  const hours = Number(e.duration_minutes_rounded || 0) / 60
  const workType = e.work_type_name_snapshot || 'General'
  const desc = e.description ? String(e.description).replace(/\s+/g, ' ').trim() : ''

  if (e.start_at) {
    const fmt = (iso: string) =>
      new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London', hour12: false,
      }).format(new Date(iso))
    const start = fmt(e.start_at)
    const end = e.end_at ? fmt(e.end_at) : ''
    return `    - ${e.entry_date} ${start}–${end} (${hours.toFixed(2)}h) [${workType}]${desc ? ` ${desc}` : ''}`
  }

  return `    - ${e.entry_date} (${hours.toFixed(2)}h) [${workType}]${desc ? ` ${desc}` : ''}`
}

describe('invoice entry line formatting', () => {
  it('includes time range for entries with start_at', () => {
    const line = formatEntryLine({
      entry_date: '2026-01-15',
      start_at: '2026-01-15T09:00:00.000Z',
      end_at: '2026-01-15T10:30:00.000Z',
      duration_minutes_rounded: 90,
      work_type_name_snapshot: 'Development',
      description: 'Fixed the bug',
    })
    expect(line).toContain('09:00–10:30')
    expect(line).toContain('(1.50h)')
    expect(line).toContain('[Development]')
    expect(line).toContain('Fixed the bug')
  })

  it('omits time range for entries without start_at', () => {
    const line = formatEntryLine({
      entry_date: '2026-03-12',
      start_at: null,
      end_at: null,
      duration_minutes_rounded: 60,
      work_type_name_snapshot: 'Development',
      description: null,
    })
    expect(line).not.toContain('–')
    expect(line).toBe('    - 2026-03-12 (1.00h) [Development]')
  })

  it('handles null description and null work type without errors', () => {
    const line = formatEntryLine({
      entry_date: '2026-03-12',
      start_at: null,
      end_at: null,
      duration_minutes_rounded: 30,
      work_type_name_snapshot: null,
      description: null,
    })
    expect(line).toContain('[General]')
    expect(line).not.toMatch(/undefined|null/)
  })
})
```

- [ ] **Step 2: Run to confirm it passes** (the test is self-contained)

```bash
npx vitest run src/app/api/cron/oj-projects-billing/__tests__/invoice-notes.test.ts
```

Expected: PASS.

- [ ] **Step 3: Update buildInvoiceNotes in route.ts**

Find the entry detail formatting block (~line 313–319). Replace:

```typescript
// Current:
const start = toLondonTimeHm(e.start_at) || ''
const end = toLondonTimeHm(e.end_at) || ''
const hours = Number(e.duration_minutes_rounded || 0) / 60
const workType = getWorkTypeLabel(e)
const desc = e.description ? String(e.description).replace(/\s+/g, ' ').trim() : ''
lines.push(`    - ${e.entry_date} ${start}–${end} (${hours.toFixed(2)}h) [${workType}]${desc ? ` ${desc}` : ''}`)
```

With:

```typescript
const hours = Number(e.duration_minutes_rounded || 0) / 60
const workType = getWorkTypeLabel(e)
const desc = e.description ? String(e.description).replace(/\s+/g, ' ').trim() : ''

if (e.start_at) {
  const start = toLondonTimeHm(e.start_at) || ''
  const end = toLondonTimeHm(e.end_at) || ''
  lines.push(`    - ${e.entry_date} ${start}–${end} (${hours.toFixed(2)}h) [${workType}]${desc ? ` ${desc}` : ''}`)
} else {
  lines.push(`    - ${e.entry_date} (${hours.toFixed(2)}h) [${workType}]${desc ? ` ${desc}` : ''}`)
}
```

- [ ] **Step 4: Run lint and typecheck**

```bash
npm run lint && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/cron/oj-projects-billing/route.ts src/app/api/cron/oj-projects-billing/__tests__/invoice-notes.test.ts
git commit -m "feat: update buildInvoiceNotes to omit time range when start_at is null"
```

---

## Final Verification

- [ ] **Run full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Run full verification pipeline**

```bash
npm run lint && npx tsc --noEmit && npm run build
```

Expected: zero errors, successful build.

- [ ] **Smoke test manually**

1. Open `/oj-projects` — confirm no start time field in quick entry form
2. Submit a time entry — confirm it saves without error
3. Open `/oj-projects/entries` — confirm table shows duration (e.g. `1.50h`), not `HH:MM–HH:MM`
4. Open the edit modal on an existing entry — confirm no start time field
5. Save an edited entry — confirm it saves without error
