# Events Emergency Hotfix + Form Fields Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop active data corruption where every event edit erases `capacity` and `payment_mode`, then add these fields to the admin form so they can be managed through the UI.

**Architecture:** Fix the data corruption by removing hardcoded null values from the form data preparation function, then add capacity and payment_mode fields to the event form with proper validation and type system updates.

**Tech Stack:** TypeScript, React 19, Next.js 15 App Router, Zod, Tailwind CSS, Supabase

**Spec:** `docs/superpowers/specs/2026-04-13-events-remediation-design.md` — D06-HOTFIX, D06, D07

---

## File Structure

### Modified Files
| File | What changes |
|------|-------------|
| `src/app/actions/events.ts` | Remove hardcoded `capacity: null`, add capacity/payment_mode from form data when provided |
| `src/components/features/events/EventFormGrouped.tsx` | Remove hardcoded `capacity: null` from SEO preview, add capacity input and payment_mode select |
| `src/services/events.ts` | Add `payment_mode` to `CreateEventInput`, add Zod enum validation, update publish validation |
| `src/types/database.ts` | Add `payment_mode` to hand-written `Event` type |

---

## Task 1: Emergency Hotfix — Stop Erasing Capacity (D06-HOTFIX)

**Files:**
- Modify: `src/app/actions/events.ts:138-142`

- [ ] **Step 1: Read current `prepareEventDataFromFormData()` to confirm the hardcoded null**

Read `src/app/actions/events.ts` lines 138-142. Confirm `capacity: null` is on line 142.

- [ ] **Step 2: Remove `capacity: null` and conditionally include capacity**

In `src/app/actions/events.ts`, find the data object in `prepareEventDataFromFormData()` (around line 138). Replace the hardcoded `capacity: null` on line 142:

```typescript
// Old (line 142):
    capacity: null,

// New — only include capacity if the form actually sends a value:
    ...(rawData.capacity !== undefined && rawData.capacity !== null && rawData.capacity !== ''
      ? { capacity: Number(rawData.capacity) || null }
      : {}),
```

This means: if the form doesn't send `capacity` (which it currently doesn't), the field is omitted from the payload entirely. The RPC's `CASE WHEN p_event_data ? 'capacity'` will see the key is absent and preserve the existing DB value.

- [ ] **Step 3: Run type check**

Run: `npx tsc --noEmit`
Expected: Clean compilation

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: All pass (existing tests don't assert on capacity value)

- [ ] **Step 5: Commit**

```bash
git add src/app/actions/events.ts
git commit -m "fix: stop erasing event capacity on every admin edit

prepareEventDataFromFormData() hardcoded capacity: null, which meant
every event edit overwrote any existing capacity value. 29 events in
production have capacity set via direct DB edits — this was silently
erasing their seat limits. Now only includes capacity in the update
payload when the form explicitly sends a value."
```

---

## Task 2: Emergency Hotfix — Stop Erasing Payment Mode

**Files:**
- Modify: `src/app/actions/events.ts:138-179`

- [ ] **Step 1: Check if payment_mode is in the data object**

Read `src/app/actions/events.ts` lines 138-179. Search for `payment_mode` in the `data` object. If it's not there, it's not being erased by the action (it's not in `CreateEventInput` and not in the form data).

However, check if `booking_mode` at line 143 could be conflated with `payment_mode`. They're different fields: `booking_mode` (table/general/mixed) IS in the form and IS in the data. `payment_mode` (free/cash_only/prepaid) is NOT in the form but may be in the RPC payload.

Read the RPC `update_event_transaction` to check if `booking_mode` or `payment_mode` are handled separately.

- [ ] **Step 2: Verify payment_mode is not being overwritten**

If `payment_mode` is NOT in the `prepareEventDataFromFormData()` output, it won't be in the JSON payload sent to the RPC. The RPC's `CASE WHEN p_event_data ? 'payment_mode'` will preserve the existing value. In this case, no code change is needed for payment_mode erasure — only the capacity fix from Task 1 was necessary.

If `payment_mode` IS being sent (perhaps via `booking_mode` confusion or a different path), apply the same fix as Task 1.

- [ ] **Step 3: Verify with a test query**

After deploying the capacity fix, verify live data integrity by running:
```bash
npx tsx --tsconfig tsconfig.json scripts/database/check-all-date-drift.ts
```
And a new check:
```bash
npx tsx --tsconfig tsconfig.json -e "
import dotenv from 'dotenv'; import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
import { createAdminClient } from './src/lib/supabase/admin';
async function main() {
  const db = createAdminClient();
  const { data } = await db.from('events')
    .select('id, name, capacity, payment_mode')
    .not('capacity', 'is', null)
    .order('date', { ascending: true });
  console.log('Events with capacity set:', data?.length);
  data?.forEach(e => console.log(e.name, '| capacity:', e.capacity, '| payment_mode:', e.payment_mode));
}
main().catch(console.error);
"
```

- [ ] **Step 4: Commit if changes were needed**

```bash
git add src/app/actions/events.ts
git commit -m "fix: verify payment_mode is not being erased by event edits"
```

---

## Task 3: Remove Hardcoded Capacity from SEO Preview

**Files:**
- Modify: `src/components/features/events/EventFormGrouped.tsx:336`

- [ ] **Step 1: Fix the SEO preview payload**

In `src/components/features/events/EventFormGrouped.tsx`, find the `generateEventSeoContent` call (around line 330). Replace the hardcoded `capacity: null` on line 336:

```typescript
// Old (line 336):
        capacity: null,

// New — pass the event's existing capacity if editing, or null for new events:
        capacity: event?.capacity ?? null,
```

This ensures the SEO AI generation has the real capacity value for context, and doesn't overwrite anything (this is a read-only usage for AI prompt context, not a DB write).

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: Clean

- [ ] **Step 3: Commit**

```bash
git add src/components/features/events/EventFormGrouped.tsx
git commit -m "fix: pass real capacity to SEO content generator instead of null

The SEO preview was always sending capacity: null, losing context
about the event's actual capacity for AI content generation."
```

---

## Task 4: Add `payment_mode` to Type System (D07 prerequisite)

**Files:**
- Modify: `src/types/database.ts`
- Modify: `src/services/events.ts`

- [ ] **Step 1: Add `payment_mode` to the hand-written Event type**

Read `src/types/database.ts` and find the `Event` interface. Add `payment_mode`:

```typescript
// Add to the Event interface:
  payment_mode?: 'free' | 'cash_only' | 'prepaid' | null
```

- [ ] **Step 2: Add `payment_mode` to `CreateEventInput`**

In `src/services/events.ts`, find `CreateEventInput` (line 14). Add:

```typescript
  payment_mode?: 'free' | 'cash_only' | 'prepaid' | null;
```

- [ ] **Step 3: Add Zod enum validation for payment_mode**

In `src/services/events.ts`, find the `eventSchema` Zod definition. Add payment_mode validation:

```typescript
  payment_mode: z.enum(['free', 'cash_only', 'prepaid']).nullable().optional(),
```

- [ ] **Step 4: Run type check**

Run: `npx tsc --noEmit`
Expected: Clean

- [ ] **Step 5: Commit**

```bash
git add src/types/database.ts src/services/events.ts
git commit -m "feat: add payment_mode to Event type and Zod schema

Adds payment_mode to the hand-written Event interface and
CreateEventInput type. Adds Zod enum validation to reject invalid
values at the app layer. Prerequisite for adding payment_mode to
the admin event form."
```

---

## Task 5: Add Capacity Field to Event Form (D06)

**Files:**
- Modify: `src/components/features/events/EventFormGrouped.tsx`
- Modify: `src/app/actions/events.ts`

- [ ] **Step 1: Add capacity state to the form**

In `src/components/features/events/EventFormGrouped.tsx`, find the state declarations (around line 80). Add:

```typescript
  const [capacity, setCapacity] = useState(event?.capacity?.toString() ?? '')
```

- [ ] **Step 2: Add capacity input to the form UI**

Find the "Pricing & Booking" CollapsibleSection (around line 620). Add a capacity input after the price field:

```tsx
          <div className="sm:col-span-2">
            <label htmlFor="capacity" className="block text-sm font-medium leading-6 text-gray-900">
              Capacity
            </label>
            <div className="mt-2">
              <Input
                type="number"
                id="capacity"
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
                min="1"
                max="10000"
                placeholder="Unlimited"
                fullWidth
              />
              <p className="mt-1 text-xs text-gray-500">Leave blank for unlimited</p>
            </div>
          </div>
```

- [ ] **Step 3: Add capacity to the form submit payload**

In the `handleSubmit` function (around line 167), add capacity to the eventData object:

```typescript
        // Add inside the eventData object:
        capacity: capacity && capacity !== '' ? parseInt(capacity) : null,
```

- [ ] **Step 4: Update the action to pass capacity through**

In `src/app/actions/events.ts`, the capacity conditional from Task 1 already handles this — when the form sends a `capacity` value, it will be included in the payload. No additional changes needed here.

- [ ] **Step 5: Run type check and tests**

Run: `npx tsc --noEmit && npm test`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add src/components/features/events/EventFormGrouped.tsx src/app/actions/events.ts
git commit -m "feat: add capacity field to event form

Admins can now set event capacity through the UI. Leave blank for
unlimited. The capacity value is preserved across edits — no longer
silently erased to null."
```

---

## Task 6: Add Payment Mode Field to Event Form (D07)

**Files:**
- Modify: `src/components/features/events/EventFormGrouped.tsx`
- Modify: `src/app/actions/events.ts`

- [ ] **Step 1: Add payment_mode state to the form**

In `src/components/features/events/EventFormGrouped.tsx`, add state:

```typescript
  const [paymentMode, setPaymentMode] = useState<'free' | 'cash_only' | 'prepaid'>(
    (event?.payment_mode as 'free' | 'cash_only' | 'prepaid') ?? 'free'
  )
```

- [ ] **Step 2: Add payment_mode select to the form UI**

In the "Pricing & Booking" section, add a select after the booking_mode field:

```tsx
          <div className="sm:col-span-2">
            <label htmlFor="payment_mode" className="block text-sm font-medium leading-6 text-gray-900">
              Payment mode
            </label>
            <div className="mt-2">
              <Select
                id="payment_mode"
                value={paymentMode}
                onChange={(e) => {
                  const mode = e.target.value as 'free' | 'cash_only' | 'prepaid'
                  setPaymentMode(mode)
                  if (mode === 'free') {
                    setPrice('0')
                    setIsFree(true)
                  } else {
                    setIsFree(false)
                  }
                }}
                fullWidth
              >
                <option value="free">Free</option>
                <option value="cash_only">Cash on arrival</option>
                <option value="prepaid">Prepaid (online payment required)</option>
              </Select>
            </div>
          </div>
```

- [ ] **Step 3: Add payment_mode to the form submit payload**

In `handleSubmit`, add to the eventData object:

```typescript
        payment_mode: paymentMode,
```

- [ ] **Step 4: Update the action to extract payment_mode from form data**

In `src/app/actions/events.ts`, in `prepareEventDataFromFormData()`, add payment_mode extraction. Find the data object and add:

```typescript
    // Add to the data object:
    ...(rawData.payment_mode && ['free', 'cash_only', 'prepaid'].includes(rawData.payment_mode as string)
      ? { payment_mode: rawData.payment_mode as 'free' | 'cash_only' | 'prepaid' }
      : {}),
```

- [ ] **Step 5: Update publish validation**

In `src/services/events.ts`, find `getPublishValidationIssues()` (around line 109). Read the current `PublishValidationInput` type and the function body. Add a check:

```typescript
// Add to the issues array:
if (input.payment_mode === 'prepaid' && (!input.price || input.price <= 0)) {
  issues.push('Prepaid events must have a price set')
}
```

Also update `PublishValidationInput` to include `payment_mode`:

```typescript
// Add to PublishValidationInput:
  payment_mode?: string | null
```

And update the caller that fetches the event data for publish validation to include `payment_mode` in the select.

- [ ] **Step 6: Run type check and tests**

Run: `npx tsc --noEmit && npm test`
Expected: All pass

- [ ] **Step 7: Commit**

```bash
git add src/components/features/events/EventFormGrouped.tsx src/app/actions/events.ts src/services/events.ts
git commit -m "feat: add payment_mode field to event form with validation

Admins can now set payment mode (free, cash on arrival, prepaid)
through the UI. Prepaid events require a price to be published.
Payment mode value is preserved across edits. Includes Zod enum
validation to reject invalid values."
```

---

## Task 7: Verification Pipeline

- [ ] **Step 1: Run the full verification pipeline**

```bash
npm run lint
npx tsc --noEmit
npm test
npm run build
```

Expected: All four pass cleanly.

- [ ] **Step 2: Verify live data integrity**

After deploying, edit a test event that has capacity set. Confirm the capacity value survives the edit. Check the database:

```bash
npx tsx --tsconfig tsconfig.json -e "
import dotenv from 'dotenv'; import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
import { createAdminClient } from './src/lib/supabase/admin';
async function main() {
  const db = createAdminClient();
  const { data } = await db.from('events')
    .select('id, name, capacity, payment_mode')
    .not('capacity', 'is', null)
    .order('date', { ascending: true });
  console.log('Events with capacity set:', data?.length);
  data?.forEach(e => console.log(e.name, '| capacity:', e.capacity, '| payment_mode:', e.payment_mode));
}
main().catch(console.error);
"
```

Confirm the count matches pre-fix count (29 events).

- [ ] **Step 3: Review all changes**

```bash
git diff main --stat
git log --oneline main..HEAD
```

- [ ] **Step 4: Final commit if any lint fixes needed**

```bash
npm run lint -- --fix
git add -A && git commit -m "chore: lint fixes for event form changes"
```

---

## Deferred to Plan B: Event Lifecycle Cascades

The following defects are covered in a separate implementation plan:
- D04: UI warning for events with existing bookings
- D03: Event reschedule notification (async SMS dispatch)
- D01: Event cancellation cascade (refunds, notifications)
- D02: Event deletion safeguards (DB trigger + app check)
- D10: Hold recalculation on date change

## Deferred to Plan C: Cron/SMS/Polish

- D08, D09, D05, D11-D19
