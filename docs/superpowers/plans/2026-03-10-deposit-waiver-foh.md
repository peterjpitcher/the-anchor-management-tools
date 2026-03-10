# Deposit Waiver (FOH) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow managers and super admins to waive the deposit requirement on a per-booking basis from the FOH booking form, with the waiver recorded on the booking and displayed as a badge.

**Architecture:** New `deposit_waived` boolean column on `table_bookings` (default false, immutable after creation). API route validates role (manager+), skips deposit logic, creates booking as `confirmed`. FOH UI shows a toggle when deposit would normally be required, and a "Deposit waived" badge on confirmed bookings where the waiver was used.

**Tech Stack:** Next.js 15 App Router, Supabase (PostgreSQL RPC), TypeScript, Zod, Tailwind CSS v4, Vitest

**Spec:** `docs/superpowers/specs/2026-03-10-deposit-waiver-foh-design.md`

---

## Files to Create or Modify

| File | Action | Purpose |
|---|---|---|
| `supabase/migrations/20260509000004_deposit_waiver_column.sql` | Create | Add `deposit_waived` column to `table_bookings` |
| `supabase/migrations/20260509000005_create_table_booking_v05_deposit_waived.sql` | Create | Add `p_deposit_waived` param to `create_table_booking_v05` RPC |
| `src/app/api/foh/bookings/route.ts` | Modify | Add `waive_deposit` to Zod schema, role check, and waiver booking path |
| `src/app/api/foh/schedule/route.ts` | Modify | Include `deposit_waived` in the bookings SELECT query |
| `src/app/(authenticated)/table-bookings/foh/page.tsx` | Modify | Derive and pass `canWaiveDeposit` prop |
| `src/app/(authenticated)/table-bookings/foh/FohScheduleClient.tsx` | Modify | Add waive toggle, form state, payload field, and badge display |
| `src/tests/api/foh/deposit-waiver.test.ts` | Create | API-level tests for the waiver permission and booking path |

---

## Chunk 1: Database

### Task 1: Add `deposit_waived` column

**Files:**
- Create: `supabase/migrations/20260509000004_deposit_waiver_column.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- supabase/migrations/20260509000004_deposit_waiver_column.sql

ALTER TABLE public.table_bookings
  ADD COLUMN IF NOT EXISTS deposit_waived BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.table_bookings.deposit_waived IS
  'True when a manager or super_admin explicitly waived the deposit at booking creation. Immutable after creation.';
```

- [ ] **Step 2: Apply the migration**

```bash
npx supabase db push
```

Expected output: migration applied with no errors. Verify:

```bash
npx supabase db push --dry-run
```

Should report zero pending migrations after the push.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260509000004_deposit_waiver_column.sql
git commit -m "feat: add deposit_waived column to table_bookings"
```

---

### Task 2: Update `create_table_booking_v05` RPC

**Files:**
- Create: `supabase/migrations/20260509000005_create_table_booking_v05_deposit_waived.sql`

The current RPC signature lives in `supabase/migrations/20260509000003_fix_foh_create_booking_rpc_card_capture_column.sql` — this is the source file to copy from.

- [ ] **Step 1: Create the migration**

This migration uses `CREATE OR REPLACE` — it rewrites the function signature adding one new parameter with a default. All existing callers continue to work unchanged since the parameter has a default value.

```sql
-- supabase/migrations/20260509000005_create_table_booking_v05_deposit_waived.sql
-- Add p_deposit_waived parameter to create_table_booking_v05.
-- Existing callers are unaffected (parameter has DEFAULT false).

CREATE OR REPLACE FUNCTION public.create_table_booking_v05(
  p_customer_id         uuid,
  p_booking_date        date,
  p_booking_time        time without time zone,
  p_party_size          integer,
  p_booking_purpose     text    DEFAULT 'food',
  p_notes               text    DEFAULT NULL,
  p_sunday_lunch        boolean DEFAULT false,
  p_source              text    DEFAULT 'brand_site',
  p_bypass_cutoff       boolean DEFAULT false,
  p_deposit_waived      boolean DEFAULT false   -- NEW: manager/super_admin waiver
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
-- [IMPLEMENTER: instructions below — do NOT skip any of these steps]
$$;
```

> **Important for implementer — three required edits to the function body:**
>
> 1. Open `supabase/migrations/20260509000003_fix_foh_create_booking_rpc_card_capture_column.sql`.
>    Copy the full `$$...$$` function body into this migration.
>
> 2. **Add `p_deposit_waived` to the parameter list** (already shown above).
>
> 3. **Short-circuit the deposit requirement when waiving.** Inside the function body,
>    find the block that sets `v_deposit_required` (it will look like `v_deposit_required := true`
>    based on `v_party_size >= 7 OR v_sunday_lunch`). Immediately **before** that block, add:
>
>    ```sql
>    -- Deposit waiver overrides the automatic deposit requirement
>    IF p_deposit_waived THEN
>      v_deposit_required := false;
>    END IF;
>    ```
>
>    This ensures the booking is inserted with `status = 'confirmed'` (not `'pending_payment'`)
>    and `hold_expires_at = NULL` when the deposit is waived.
>
> 4. **Write `deposit_waived` to the booking row.** In the `INSERT INTO table_bookings (...)` statement,
>    add `deposit_waived` to the column list and `p_deposit_waived` to the values list.
>    If no INSERT exists (the RPC calls a sub-function), add an UPDATE immediately after:
>
>    ```sql
>    UPDATE public.table_bookings SET deposit_waived = p_deposit_waived WHERE id = v_booking_id;
>    ```

- [ ] **Step 2: Apply migration**

```bash
npx supabase db push
```

- [ ] **Step 3: Verify**

Using Supabase SQL editor or `psql`, confirm the function accepts the new parameter:
```sql
SELECT pg_get_function_arguments('public.create_table_booking_v05'::regproc);
```
Should include `p_deposit_waived boolean`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260509000005_create_table_booking_v05_deposit_waived.sql
git commit -m "feat: add p_deposit_waived to create_table_booking_v05 RPC"
```

---

## Chunk 2: API Route & Types

### Task 3: Write failing tests for the API waiver path

**Files:**
- Create: `src/tests/api/foh/deposit-waiver.test.ts`

This project uses Vitest. **Note: there are currently zero test files in this codebase — this is the first test file being introduced.** Create the directory before writing the file.

- [ ] **Step 1: Create the test directory**

```bash
mkdir -p src/tests/api/foh
```

- [ ] **Step 2: Write the failing tests**

```typescript
// src/tests/api/foh/deposit-waiver.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock auth and Supabase before importing the route
vi.mock('@/lib/foh/api-auth', () => ({
  requireFohPermission: vi.fn()
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn()
}))

import { requireFohPermission } from '@/lib/foh/api-auth'
import { POST } from '@/app/api/foh/bookings/route'

function makeRequest(body: object) {
  return new Request('http://localhost/api/foh/bookings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }) as unknown as import('next/server').NextRequest
}

const baseBookingPayload = {
  customer_id: '00000000-0000-0000-0000-000000000001',
  date: '2026-04-05',
  time: '13:00',
  party_size: 8,
  purpose: 'food'
}

describe('POST /api/foh/bookings — deposit waiver', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return 403 when a non-manager tries to waive the deposit', async () => {
    vi.mocked(requireFohPermission).mockResolvedValue({
      ok: true,
      userId: 'user-1',
      supabase: {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: [{ roles: { name: 'staff' } }]
            })
          })
        })
      } as unknown as ReturnType<typeof import('@/lib/supabase/server').createClient> extends Promise<infer T> ? T : never,
      response: undefined as unknown as Response
    })

    const req = makeRequest({ ...baseBookingPayload, waive_deposit: true })
    const res = await POST(req)
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.error).toMatch(/permission/i)
  })

  it('should allow a manager to waive the deposit', async () => {
    const mockRpcResult = {
      data: {
        state: 'confirmed',
        table_booking_id: 'booking-1',
        booking_reference: 'REF001',
        reason: null,
        table_name: 'Table 1'
      },
      error: null
    }

    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({
            data: [{ roles: { name: 'manager' } }]
          })
        })
      }),
      rpc: vi.fn().mockResolvedValue(mockRpcResult)
    }

    vi.mocked(requireFohPermission).mockResolvedValue({
      ok: true,
      userId: 'user-2',
      supabase: mockSupabase as unknown as ReturnType<typeof import('@/lib/supabase/server').createClient> extends Promise<infer T> ? T : never,
      response: undefined as unknown as Response
    })

    const req = makeRequest({ ...baseBookingPayload, waive_deposit: true })
    const res = await POST(req)
    // Should succeed (200) — not blocked on deposit method missing
    expect(res.status).toBe(200)
  })

  it('should require sunday_deposit_method when waive_deposit is false and party_size >= 7', async () => {
    vi.mocked(requireFohPermission).mockResolvedValue({
      ok: true,
      userId: 'user-3',
      supabase: {} as unknown as ReturnType<typeof import('@/lib/supabase/server').createClient> extends Promise<infer T> ? T : never,
      response: undefined as unknown as Response
    })

    const req = makeRequest({ ...baseBookingPayload, waive_deposit: false })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/deposit/i)
  })
})
```

- [ ] **Step 3: Run tests to confirm they fail or error**

```bash
npx vitest run src/tests/api/foh/deposit-waiver.test.ts
```

Expected: tests fail or throw import/assertion errors — both are acceptable for the TDD red phase. The important thing is that no test passes green yet.

---

### Task 4: Update the FOH bookings API route

**Files:**
- Modify: `src/app/api/foh/bookings/route.ts`

- [ ] **Step 1: Add `waive_deposit` to the Zod schema**

Find the `CreateFohTableBookingSchema` definition (around line 32). Add `waive_deposit` as the last field before `.superRefine(`:

```typescript
// Add after management_override line:
waive_deposit: z.boolean().optional()
```

- [ ] **Step 2: Update the superRefine deposit check**

Find the `superRefine` block containing this condition (around line 85):

```typescript
if (
  value.management_override !== true &&
  (value.sunday_lunch === true || (value.party_size != null && value.party_size >= 7)) &&
  value.sunday_deposit_method == null
) {
```

Change to:

```typescript
if (
  value.management_override !== true &&
  value.waive_deposit !== true &&
  (value.sunday_lunch === true || (value.party_size != null && value.party_size >= 7)) &&
  value.sunday_deposit_method == null
) {
```

- [ ] **Step 3: Add the deposit waiver permission check and booking path**

After the `management_override` block (which returns early), add a new block for `waive_deposit`. Find the section after the management override early return — this is where normal booking flow begins. Add the following immediately after parsing `payload`:

```typescript
// Deposit waiver: manager or super_admin can skip deposit for a specific booking.
if (payload.waive_deposit === true) {
  const { data: roleRows } = await auth.supabase
    .from('user_roles')
    .select('roles(name)')
    .eq('user_id', auth.userId)
  const isManagerOrAbove = (roleRows as Array<{ roles: { name: string } | null }> | null)
    ?.some((r) => r.roles?.name === 'manager' || r.roles?.name === 'super_admin') ?? false
  if (!isManagerOrAbove) {
    return NextResponse.json(
      { error: 'Insufficient permissions to waive deposit' },
      { status: 403 }
    )
  }
}
```

- [ ] **Step 4: Patch the server-side `requiresDeposit` guard (critical — two places, not one)**

There are **two independent deposit guards** in `route.ts`. The `superRefine` patch in Step 2 handles Zod validation. There is a second guard later in the POST handler (around line 1018) that runs after Zod parsing:

```typescript
const requiresDeposit = effectiveSundayLunch || payload.party_size >= 7
const depositMethod = requiresDeposit ? payload.sunday_deposit_method || null : null
if (requiresDeposit && !depositMethod) {
  return NextResponse.json({ error: '...' }, { status: 400 })
}
```

This guard will still fire and return a 400 even when `waive_deposit === true` because `depositMethod` will be null. Patch this guard to also check for the waiver:

```typescript
const requiresDeposit = (effectiveSundayLunch || payload.party_size >= 7) && payload.waive_deposit !== true
const depositMethod = requiresDeposit ? payload.sunday_deposit_method || null : null
if (requiresDeposit && !depositMethod) {
  return NextResponse.json({ error: '...' }, { status: 400 })
}
```

Search for `requiresDeposit` in the file to find all occurrences — patch every one that gates on `!depositMethod`.

- [ ] **Step 5: Pass `p_deposit_waived` to the RPC call**

Find the `create_table_booking_v05` RPC call (around line 1029). It will look like:

```typescript
const { data: rpcData, error: rpcError } = await auth.supabase.rpc('create_table_booking_v05', {
  p_customer_id: ...,
  p_booking_date: ...,
  ...
})
```

Add the new parameter:

```typescript
p_deposit_waived: payload.waive_deposit === true
```

- [ ] **Step 6: Skip the cash/payment_link branch when waiver is active**

Find where the deposit method branch is handled after the RPC call. Locate the section that checks `payload.sunday_deposit_method === 'cash'` and `payload.sunday_deposit_method === 'payment_link'`. Wrap it in a condition:

```typescript
if (payload.waive_deposit !== true) {
  // existing cash / payment_link branch
  if (payload.sunday_deposit_method === 'cash') {
    // ... existing cash logic ...
  } else if (payload.sunday_deposit_method === 'payment_link') {
    // ... existing payment link logic ...
  }
}
// If waive_deposit is true, booking is already confirmed via RPC — fall through to SMS
```

The standard confirmation SMS (sent for bookings that don't require a deposit) should already fire naturally after this block. Verify by reading the code flow — if the standard SMS is only sent when no deposit method is involved, ensure it also fires when `waive_deposit === true`.

- [ ] **Step 7: Run tests**

```bash
npx vitest run src/tests/api/foh/deposit-waiver.test.ts
```

Expected: all 3 tests pass.

- [ ] **Step 8: Run lint and typecheck**

```bash
npm run lint && npx tsc --noEmit
```

Fix any errors before continuing.

- [ ] **Step 9: Commit**

```bash
git add src/app/api/foh/bookings/route.ts src/tests/api/foh/deposit-waiver.test.ts
git commit -m "feat: add deposit waiver support to FOH bookings API"
```

---

### Task 5: Add `deposit_waived` to the FOH schedule query

**Files:**
- Modify: `src/app/api/foh/schedule/route.ts`

- [ ] **Step 1: Find the booking SELECT string**

At line 178 of `src/app/api/foh/schedule/route.ts`, the bookings are fetched with a hardcoded select string:

```typescript
'id, booking_reference, booking_date, booking_time, party_size, booking_type, booking_purpose, status, special_requirements, seated_at, left_at, no_show_at, start_datetime, end_datetime, event_id, customer:customers!table_bookings_customer_id_fkey(first_name,last_name)'
```

- [ ] **Step 2: Add `deposit_waived` to the SELECT**

Append `, deposit_waived` to the select string:

```typescript
'id, booking_reference, booking_date, booking_time, party_size, booking_type, booking_purpose, status, special_requirements, seated_at, left_at, no_show_at, start_datetime, end_datetime, event_id, deposit_waived, customer:customers!table_bookings_customer_id_fkey(first_name,last_name)'
```

- [ ] **Step 3: Add `deposit_waived` to both booking mappers**

There are **two separate mapping locations** in this file — both must be updated or the badge will silently not render for some bookings:

**Location A — table-assigned bookings mapper** (around line 479, inside a loop that builds `lanes`):
Find the object literal that includes `party_size: booking.party_size` and add:
```typescript
deposit_waived: booking.deposit_waived ?? false,
```

**Location B — unassigned bookings mapper** (around line 527, builds `unassigned_bookings`):
Find the separate object literal that also includes `party_size: booking.party_size` and add the same line:
```typescript
deposit_waived: booking.deposit_waived ?? false,
```

> **Warning:** TypeScript will NOT catch a missing `deposit_waived` here because `FohBooking.deposit_waived` is optional. The badge will silently never appear if either mapper is missed. Manual testing in Task 7 is the safety net.

- [ ] **Step 4: Lint and typecheck**

```bash
npm run lint && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/app/api/foh/schedule/route.ts
git commit -m "feat: include deposit_waived in FOH schedule booking response"
```

---

## Chunk 3: FOH UI

### Task 6: Derive `canWaiveDeposit` in `page.tsx`

**Files:**
- Modify: `src/app/(authenticated)/table-bookings/foh/page.tsx`

The page already queries `user_roles` to derive `isSuperAdmin`. We need a similar `isManager` check, then combine them into `canWaiveDeposit`.

- [ ] **Step 1: Extend the role query**

Find the block starting at line 30:

```typescript
let isSuperAdmin = false
if (userId) {
  const admin = createAdminClient()
  const { data: roleRows } = await admin
    .from('user_roles')
    .select('roles(name)')
    .eq('user_id', userId)
  isSuperAdmin = (roleRows as Array<{ roles: { name: string } | null }> | null)
    ?.some((r) => r.roles?.name === 'super_admin') ?? false
}
```

Replace with:

```typescript
let isSuperAdmin = false
let canWaiveDeposit = false
if (userId) {
  const admin = createAdminClient()
  const { data: roleRows } = await admin
    .from('user_roles')
    .select('roles(name)')
    .eq('user_id', userId)
  const roles = (roleRows as Array<{ roles: { name: string } | null }> | null) ?? []
  isSuperAdmin = roles.some((r) => r.roles?.name === 'super_admin')
  canWaiveDeposit = roles.some(
    (r) => r.roles?.name === 'manager' || r.roles?.name === 'super_admin'
  )
}
```

- [ ] **Step 2: Pass `canWaiveDeposit` to `FohScheduleClient`**

Find the `<FohScheduleClient ... />` JSX (around line 121):

```tsx
<FohScheduleClient
  initialDate={getLondonDateIso()}
  canEdit={canEdit}
  isSuperAdmin={isSuperAdmin}
  styleVariant={useManagerKioskStyle ? 'manager_kiosk' : 'default'}
/>
```

Add the new prop:

```tsx
<FohScheduleClient
  initialDate={getLondonDateIso()}
  canEdit={canEdit}
  isSuperAdmin={isSuperAdmin}
  canWaiveDeposit={canWaiveDeposit}
  styleVariant={useManagerKioskStyle ? 'manager_kiosk' : 'default'}
/>
```

- [ ] **Step 3: Lint and typecheck**

```bash
npm run lint && npx tsc --noEmit
```

TypeScript will error on the unrecognised prop until Task 7 adds it to the props interface — that's expected. Fix any other errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/(authenticated)/table-bookings/foh/page.tsx
git commit -m "feat: derive and pass canWaiveDeposit prop to FohScheduleClient"
```

---

### Task 7: Add waiver toggle and badge to `FohScheduleClient`

**Files:**
- Modify: `src/app/(authenticated)/table-bookings/foh/FohScheduleClient.tsx`

This file is very large (~3000 lines). Read each section carefully before editing.

- [ ] **Step 1: Add `canWaiveDeposit` to the props interface**

Find the component's props type definition near the top of the file. It will contain `canEdit`, `isSuperAdmin`, `styleVariant`. Add:

```typescript
canWaiveDeposit?: boolean
```

Destructure it in the component function parameters alongside the others.

- [ ] **Step 2: Add `deposit_waived` to the `FohBooking` type**

Find the `FohBooking` type definition near the top of the file (around line 11). Add:

```typescript
deposit_waived?: boolean | null
```

- [ ] **Step 3: Add `waive_deposit` to the create form state**

Find where the create form state is initialised (look for `useState` with `sunday_deposit_method`, `party_size`, etc.). Add:

```typescript
waive_deposit: false
```

to the initial state object.

- [ ] **Step 4: Add the waiver toggle UI**

Find the section where the deposit method selector is rendered (around line 1551, where `formRequiresDeposit` is used). The deposit method selector (Cash / Payment link) is shown when `formRequiresDeposit` is true.

**Above** the deposit method selector, add the waiver toggle (only shown to managers+):

```tsx
{formRequiresDeposit && canWaiveDeposit && (
  <div className="flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
    <input
      id="waive-deposit"
      type="checkbox"
      checked={createForm.waive_deposit}
      onChange={(e) =>
        setCreateForm((prev) => ({
          ...prev,
          waive_deposit: e.target.checked,
          // Clear deposit method when waiving
          sunday_deposit_method: e.target.checked ? undefined : prev.sunday_deposit_method
        }))
      }
      className="h-4 w-4 rounded border-gray-300 text-sidebar focus:ring-sidebar"
    />
    <label htmlFor="waive-deposit" className="text-xs font-medium text-gray-700 cursor-pointer">
      Waive deposit for this booking
    </label>
  </div>
)}
```

Then, show the Cash / Payment link selector only when the waiver is **not** checked:

```tsx
{formRequiresDeposit && !createForm.waive_deposit && (
  // existing deposit method selector JSX
)}
```

- [ ] **Step 5: Include `waive_deposit` in the API payload**

Find the `fetch('/api/foh/bookings', ...)` call (around line 2125). In the JSON body object, add:

```typescript
waive_deposit: createForm.waive_deposit || undefined,
```

Also update the deposit validation guard (around line 2089). The guard is expressed as a **constant** (`requiresDepositValidation`) that is then checked in an `if` block. You must update the **constant itself**, not just add a condition inside the `if`:

```typescript
// CORRECT — update the constant:
const requiresDepositValidation =
  (!isWalkIn && !isManagement && !createForm.waive_deposit) &&
  ((createForm.sunday_lunch && sundaySelected) || partySize >= 7)

// Then the existing if-check below it can remain as-is:
if (requiresDepositValidation && !createForm.sunday_deposit_method) {
  setErrorMessage('Choose whether the deposit was taken in cash or should be sent by payment link.')
  return
}
```

Do NOT add the waiver check only inside the `if` block body — the constant must be updated so the validation is skipped entirely.

- [ ] **Step 6: Reset `waive_deposit` when the form resets**

Wherever the create form is reset to its initial state (after a successful booking, or when the form is closed), ensure `waive_deposit: false` is included in the reset.

- [ ] **Step 7: Add "Deposit waived" badge to the booking modal**

Find the booking detail modal (around line 2643). Locate where the status badge is rendered (look for `selectedBookingVisualLabel` or `statusBadgeClass`). After the status badge, add:

```tsx
{selectedBooking?.deposit_waived && (
  <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
    Deposit waived
  </span>
)}
```

- [ ] **Step 8: Lint and typecheck**

```bash
npm run lint && npx tsc --noEmit
```

Fix all errors. Common issues:
- `sunday_deposit_method: undefined` may not match the enum type — use `sunday_deposit_method: undefined as typeof createForm.sunday_deposit_method` or reset to `null` if the type is nullable.
- `deposit_waived` on `FohBooking` must be present in the schedule API response mapping (done in Task 5).

- [ ] **Step 9: Run all tests**

```bash
npm test
```

All tests must pass.

- [ ] **Step 10: Run full verification pipeline**

```bash
npm run lint && npx tsc --noEmit && npm test && npm run build
```

All must pass with zero errors or warnings.

- [ ] **Step 11: Commit**

```bash
git add src/app/(authenticated)/table-bookings/foh/FohScheduleClient.tsx
git commit -m "feat: add deposit waiver toggle and badge to FOH booking form"
```

---

## Final Verification

- [ ] Manual test: log in as a manager, create a booking for 8 people, verify the "Waive deposit" toggle appears
- [ ] Manual test: check the toggle, submit the booking — verify it confirms immediately and the standard SMS path fires (not payment link)
- [ ] Manual test: open the confirmed booking modal — verify "Deposit waived" badge is shown
- [ ] Manual test: log in as a staff member (not manager) — verify the "Waive deposit" toggle does NOT appear
- [ ] Manual test: attempt to POST `waive_deposit: true` as a staff user via the API — verify 403 response
- [ ] Manual test: create a normal deposit booking (no waiver) — verify existing Cash / Payment link flow is unchanged
