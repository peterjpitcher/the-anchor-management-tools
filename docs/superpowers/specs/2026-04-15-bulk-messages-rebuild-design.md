# Bulk Messages Page — Ground-Up Rebuild

**Date:** 2026-04-15
**Status:** Revised (post-adversarial review)
**Complexity:** L (4) — new RPC, full page rewrite, migration

---

## Problem Statement

The `/messages/bulk` page has multiple critical bugs:

1. **Core bug:** Selecting an event + "Without Bookings" shows nobody. The filter checks global booking count (`total_bookings > 0`) instead of checking whether the customer has a booking for the *selected* event.
2. Hidden `marketing_sms_opt_in` gate silently excludes customers with no UI indication.
3. Customers without mobile numbers appear in the list but can't receive SMS.
4. Approximate match count shows misleading "0+" when in-memory filters are active.
5. Pagination re-scans from scratch on each page load.
6. Batch scanning caps at 2000 rows — results silently truncated.

The current architecture (API route with batch-scanning + in-memory filtering) is fundamentally fragile. This spec describes a complete rebuild.

## Success Criteria

- Selecting an event + "Without Bookings" returns all customers who have NOT actively booked that specific event
- All six filters work correctly in any combination
- Only sendable customers appear in results (valid mobile, opted in, marketing opted in, active SMS status)
- No silent exclusions — what you see is what gets sent (fetch eligibility matches send eligibility exactly)
- Send works for both small (<=100, direct) and larger (>100, job queue) recipient lists

## Constraints

- Customer base is ~400 contacts — no pagination needed, load all matches
- Must respect existing SMS safety guards (rate limits, quiet hours, Twilio chunking)
- Must check RBAC permissions (`messages`, `send`)
- Existing send infrastructure (`sendBulkSms` in `src/lib/sms/bulk.ts`) is reused — only the filtering/UI layer is rebuilt

---

## Architecture

### Current (being replaced)

```
page.tsx (client) → POST /api/messages/bulk/customers (API route)
  → Supabase query with partial DB filters
  → Fetch batches of 200, up to 10 batches
  → In-memory filtering (event, category, booking status)
  → Return paginated results
```

### New

```
page.tsx (server wrapper) → BulkMessagesClient.tsx (client component)
  → Server action: fetchBulkRecipients → Supabase RPC: get_bulk_sms_recipients
  → Returns full matching list (no pagination)
  → Server action: sendBulkMessages (single entry point, decides direct vs queue internally)
```

**Key change:** All filtering moves into a single Supabase RPC function. No in-memory filtering, no batch scanning, no API route.

---

## Database: RPC Function

### `get_bulk_sms_recipients`

```sql
CREATE OR REPLACE FUNCTION public.get_bulk_sms_recipients(
  p_event_id UUID DEFAULT NULL,
  p_booking_status TEXT DEFAULT NULL,       -- 'with_bookings' | 'without_bookings'
  p_sms_opt_in_only BOOLEAN DEFAULT TRUE,
  p_category_id UUID DEFAULT NULL,
  p_created_after DATE DEFAULT NULL,
  p_created_before DATE DEFAULT NULL,
  p_search TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  first_name TEXT,
  last_name TEXT,
  mobile_number TEXT,
  last_booking_date DATE
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.first_name,
    c.last_name,
    c.mobile_e164,
    (
      SELECT MAX(e.date)
      FROM public.bookings b
      JOIN public.events e ON e.id = b.event_id
      WHERE b.customer_id = c.id
        AND b.status IN ('pending_payment', 'confirmed')
        AND COALESCE(b.is_reminder_only, false) = false
    )::DATE AS last_booking_date
  FROM public.customers c
  WHERE
    -- Must have a sendable phone number
    c.mobile_e164 IS NOT NULL

    -- Must be SMS-eligible (matches send pipeline in src/lib/sms/bulk.ts)
    AND c.sms_opt_in = TRUE
    AND c.marketing_sms_opt_in = TRUE
    AND (c.sms_status IS NULL OR c.sms_status = 'active')

    -- Optional: relax sms_opt_in check when p_sms_opt_in_only is false
    -- (still requires marketing_sms_opt_in and sms_status — "All" means all eligible)

    -- Event + booking status filter (active, non-reminder bookings only)
    AND (
      p_event_id IS NULL
      OR p_booking_status IS NULL
      OR (
        p_booking_status = 'with_bookings'
        AND EXISTS (
          SELECT 1 FROM public.bookings b
          WHERE b.customer_id = c.id
            AND b.event_id = p_event_id
            AND b.status IN ('pending_payment', 'confirmed')
            AND COALESCE(b.is_reminder_only, false) = false
        )
      )
      OR (
        p_booking_status = 'without_bookings'
        AND NOT EXISTS (
          SELECT 1 FROM public.bookings b
          WHERE b.customer_id = c.id
            AND b.event_id = p_event_id
            AND b.status IN ('pending_payment', 'confirmed')
            AND COALESCE(b.is_reminder_only, false) = false
        )
      )
    )

    -- Category filter: customer has actively attended any event in this category
    AND (
      p_category_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.bookings b
        JOIN public.events e ON e.id = b.event_id
        WHERE b.customer_id = c.id
          AND e.category_id = p_category_id
          AND b.status IN ('pending_payment', 'confirmed')
          AND COALESCE(b.is_reminder_only, false) = false
      )
    )

    -- Date range filters on customer creation
    AND (p_created_after IS NULL OR c.created_at >= p_created_after)
    AND (p_created_before IS NULL OR c.created_at <= (p_created_before + INTERVAL '1 day'))

    -- Search: name or mobile number (case-insensitive, wildcards escaped)
    AND (
      p_search IS NULL
      OR c.first_name ILIKE '%' || p_search || '%'
      OR c.last_name ILIKE '%' || p_search || '%'
      OR c.mobile_e164 ILIKE '%' || p_search || '%'
    )
  ORDER BY c.last_name, c.first_name;
END;
$$;

-- Security: restrict access
REVOKE ALL ON FUNCTION public.get_bulk_sms_recipients FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_bulk_sms_recipients TO authenticated;
```

**Design decisions:**

- `SECURITY DEFINER` with `SET search_path = public` — follows the repo's secure RPC pattern. Access restricted via REVOKE/GRANT.
- **Eligibility matches send pipeline exactly:** `sms_opt_in`, `marketing_sms_opt_in`, `sms_status`, and `mobile_e164` — same checks as `sendBulkSms()` in `src/lib/sms/bulk.ts:243-276`.
- **Active booking = `status IN ('pending_payment', 'confirmed') AND is_reminder_only = false`** — matches the codebase definition used in event deletion protection and category stats.
- `last_booking_date` uses the same active-booking predicate for consistency.
- `p_booking_status` is only meaningful when `p_event_id` is also provided. When event is null, booking status is ignored.
- Returns `mobile_e164` (the canonical sendable phone) as `mobile_number` column for display.
- Search input should have `%`, `_`, `\` escaped before passing to the RPC to prevent wildcard expansion.

---

## Page Structure

### Server Component: `page.tsx`

Responsibilities:
- Auth check via `supabase.auth.getUser()` (redundant with layout but acceptable)
- Permission check via `checkUserPermission('messages', 'send', userId)` — fail closed on `false`
- Fetch events list for the filter dropdown (all events, ordered by date descending)
- Fetch event categories for the category filter dropdown
- Pass data as props to client component

### Client Component: `BulkMessagesClient.tsx`

Single client component containing all interactive UI. Sections:

#### 1. Filter Panel

Six filters in a horizontal/wrapping bar:

| Filter | Control | Default | Behaviour |
|--------|---------|---------|-----------|
| Event | Select dropdown (plain, ordered most recent first) | None | Populated from events prop. When selected, enables Booking Status |
| Booking Status | Select | Disabled | "With Bookings" / "Without Bookings". Disabled and hidden when no event selected |
| SMS Opt-in | Select | "Opted In" | "Opted In" / "All Eligible". "All Eligible" still requires marketing opt-in and active SMS status |
| Event Category | Select | None | Populated from categories prop |
| Date Range | Two date inputs (From / To) | None | Filters on customer `created_at` |
| Search | Text input | Empty | Filters on name or mobile number |

- Filters trigger a recipient reload, debounced at 300ms
- **Filter changes must use `AbortController`** to cancel in-flight requests — only the latest response updates the recipient list (prevents race conditions showing wrong audience)
- **Filter changes clear the current selection** before loading new recipients
- "Clear Filters" button resets all to defaults
- Filter state stored in component state (not URL — this is an internal tool page)
- **On page mount:** auto-load recipients with default filters (smsOptIn = 'opted_in')

#### 2. Recipient List

- Displayed as a table using `DataTable` from `ui-v2`: checkbox, name, mobile number, last booking date
- "Select All" checkbox in header — toggles all visible recipients
- Count line above table: **"X of Y recipients selected"**
- Empty state when filters return nothing: "No customers match these filters" (using `EmptyState` from `ui-v2`)
- Loading state: skeleton rows while RPC is in flight (using `DataTable` built-in skeleton)
- Error state: toast notification on fetch failure, preserve last good list

#### 3. Compose Panel

- Textarea for message body
- Character count display: `{chars} characters | {segments} SMS segment(s)` (segment = 160 chars for GSM-7)
- Send button disabled when message is whitespace-only (trim before check)
- Personalisation variable buttons: `{{first_name}}`, `{{last_name}}` — click to insert at cursor position
- Live preview box showing the message rendered with the first selected recipient's data
- If no recipients selected, preview shows placeholder: "Hi {{first_name}}..."

#### 4. Send Controls

- **Send button:** Disabled until recipients are selected AND message is non-empty (trimmed)
- Button label: "Send to X recipients"
- **Quiet hours warning:** When current London time is between 21:00 and 09:00, show a warning banner above the send button: "Messages sent now will be delivered after 9:00 AM"
- On click: confirmation modal (`ConfirmDialog` from `ui-v2`) with:
  - Recipient count
  - Message preview
  - Quiet hours note if applicable
  - "Cancel" / "Confirm Send" buttons
- After confirmation: call `sendBulkMessages` server action (single entry point — server decides direct vs queue)
- Post-send feedback:
  - Success: toast with "X messages sent successfully" (or "X messages scheduled" during quiet hours, or "X messages queued" for >100)
  - Partial failure: toast with "X sent, Y failed — do not retry"
  - Full failure: error alert with details
- After successful send: clear message, deselect recipients, keep filters

---

## Server Action: `fetchBulkRecipients`

New server action in `src/app/actions/bulk-messages.ts`:

```typescript
'use server'

import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'

export async function fetchBulkRecipients(
  filters: BulkRecipientFilters
): Promise<{ data: BulkRecipient[] } | { error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized' }

  const hasPermission = await checkUserPermission('messages', 'send', user.id)
  if (!hasPermission) return { error: 'Insufficient permissions' }

  // Escape search wildcards
  const escapedSearch = filters.search
    ? filters.search.replace(/[%_\\]/g, '\\$&')
    : null

  const { data, error } = await supabase.rpc('get_bulk_sms_recipients', {
    p_event_id: filters.eventId || null,
    p_booking_status: filters.bookingStatus || null,
    p_sms_opt_in_only: filters.smsOptIn !== 'all',
    p_category_id: filters.categoryId || null,
    p_created_after: filters.createdAfter || null,
    p_created_before: filters.createdBefore || null,
    p_search: escapedSearch,
  })

  if (error) return { error: `Failed to fetch recipients: ${error.message}` }
  return { data: data ?? [] }
}
```

### `sendBulkMessages` server action

Single entry point in `src/app/actions/bulk-messages.ts`. Internally decides direct vs queue:

```typescript
export async function sendBulkMessages(
  customerIds: string[],
  message: string,
  eventId?: string,
  categoryId?: string
): Promise<{ success: boolean; sent?: number; failed?: number; queued?: boolean; error?: string }> {
  // Auth + permission check (messages:send)
  // If <= 100: call sendBulkSMSDirect from sms-bulk-direct.ts
  // If > 100: call enqueueBulkSMSJob from job-queue.ts
  // Return result with counts
}
```

### Types

```typescript
interface BulkRecipientFilters {
  eventId?: string
  bookingStatus?: 'with_bookings' | 'without_bookings'
  smsOptIn: 'opted_in' | 'all'
  categoryId?: string
  createdAfter?: string    // ISO date
  createdBefore?: string   // ISO date
  search?: string
}

interface BulkRecipient {
  id: string
  first_name: string
  last_name: string
  mobile_number: string      // Actually mobile_e164 from the RPC
  last_booking_date: string | null
}
```

---

## Send Flow

Reuses existing infrastructure with no changes:

1. **<=100 recipients:** `sendBulkSMSDirect` from `src/app/actions/sms-bulk-direct.ts`
   - Permission check, rate limit check
   - Calls `sendBulkSms()` which handles personalisation, Twilio chunking, safety guards
2. **>100 recipients:** `enqueueBulkSMSJob` from `src/app/actions/job-queue.ts`
   - Splits into 50-recipient batches and enqueues to job queue for async processing

No changes to send actions or SMS infrastructure. The only change is how recipients are selected — the send functions receive an array of customer IDs, same as today. The client calls a single `sendBulkMessages` action which routes internally.

---

## Files Changed

### New Files

| File | Purpose |
|------|---------|
| `supabase/migrations/YYYYMMDDHHMMSS_add_bulk_sms_recipients_rpc.sql` | RPC function with REVOKE/GRANT |
| `src/app/(authenticated)/messages/bulk/BulkMessagesClient.tsx` | Client component (full rebuild) |
| `src/app/actions/bulk-messages.ts` | Server actions: fetchBulkRecipients + sendBulkMessages |

### Modified Files

| File | Change |
|------|--------|
| `src/app/(authenticated)/messages/bulk/page.tsx` | Rewrite as server component wrapper |

### Deleted Files

| File | Reason |
|------|--------|
| `src/app/api/messages/bulk/customers/route.ts` | Replaced by RPC + server action |
| `tests/api/bulkCustomersRouteMarketingEligibility.test.ts` | Route no longer exists — replaced by new action tests |

---

## What's NOT Changing

- SMS send infrastructure (`src/lib/sms/bulk.ts`, `src/app/actions/sms-bulk-direct.ts`, `src/app/actions/job-queue.ts`)
- Twilio integration
- Rate limiting and safety guards
- Job queue for large sends
- SMS quiet hours logic
- Audit logging in send functions
- Navigation / routing (page stays at `/messages/bulk`, accessed via `/messages` CTA)

---

## Edge Cases

| Scenario | Behaviour |
|----------|-----------|
| Event selected, no booking status | Show all eligible customers (event filter ignored without booking status) |
| Booking status selected, no event | Booking status filter disabled/hidden |
| "Without Bookings" + event with 0 bookings | Returns all eligible customers (everyone is "without bookings") |
| All filters cleared | Auto-loads all eligible customers with default smsOptIn filter |
| Search with `%` or `_` characters | Wildcards escaped before ILIKE — literal match only |
| Rapid filter changes | AbortController cancels stale requests — only latest response applied |
| Filter change while recipients selected | Selection cleared before new load |
| Send during quiet hours (21:00-09:00 London) | Warning banner shown; success copy says "scheduled" not "sent" |
| Partial send failure (fatal abort after some sent) | Toast: "X sent, Y failed — do not retry" |
| Null first_name in personalisation | Send pipeline handles fallback ("there" / "Customer") — no spec change needed |

---

## Testing Strategy

### RPC Function (SQL)

Manual verification via Supabase SQL editor:
- Call with no filters — returns all eligible customers (opted in, marketing opted in, active status, has mobile_e164)
- Call with event + 'with_bookings' — returns only customers with active, non-reminder bookings for that event
- Call with event + 'without_bookings' — returns customers NOT actively booked to that event
- Call with category — returns customers who've actively attended events in that category
- Call with search — matches on name and number (wildcards escaped)
- Call with date range — filters by creation date
- Verify cancelled/expired bookings are NOT counted as "booked"
- Verify reminder-only bookings are NOT counted as "booked"
- Verify customers without mobile_e164 are excluded
- Verify customers with marketing_sms_opt_in = false are excluded
- Verify customers with sms_status = 'opted_out' are excluded

### Server Action

Unit test `fetchBulkRecipients` and `sendBulkMessages`:
- Mocks Supabase RPC call via `createClient()`
- Verifies auth check (returns error when no user)
- Verifies permission check (returns error on false, uses `messages:send`)
- Verifies filter mapping to RPC params
- Verifies search wildcard escaping
- Verifies send threshold routing (<=100 direct, >100 queue)

### UI (Manual)

- Default load on page mount shows eligible recipients
- Filter combinations produce expected results
- Rapid filter changes don't show stale data (AbortController working)
- Selection clears on filter change
- Select all / deselect works
- Message compose with personalisation
- Whitespace-only message keeps send disabled
- Send confirmation modal shows correct count
- Quiet hours warning appears during 21:00-09:00 London time
- Post-send feedback displays correctly (including "scheduled" during quiet hours)
- Empty states render correctly
