# Bulk Messages Page Rebuild — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken `/messages/bulk` page with a ground-up rebuild using a Supabase RPC for all filtering, matching send-pipeline eligibility exactly.

**Architecture:** Server component wrapper (auth + data loading) passes events/categories to a client component. Recipient fetching uses a server action calling a new `get_bulk_sms_recipients` RPC. Send uses existing infrastructure via a single `sendBulkMessages` entry point.

**Tech Stack:** Next.js 15 App Router, Supabase RPC (PL/pgSQL), React 19, TypeScript, ui-v2 components (DataTable, ConfirmDialog, FilterPanel, toast), Vitest.

**Spec:** `docs/superpowers/specs/2026-04-15-bulk-messages-rebuild-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `supabase/migrations/20260415000000_add_bulk_sms_recipients_rpc.sql` | Create | RPC function with eligibility, booking semantics, security |
| `src/types/bulk-messages.ts` | Create | Types: BulkRecipientFilters, BulkRecipient |
| `src/app/actions/bulk-messages.ts` | Create | Server actions: fetchBulkRecipients, sendBulkMessages |
| `src/app/(authenticated)/messages/bulk/page.tsx` | Rewrite | Server component wrapper |
| `src/app/(authenticated)/messages/bulk/BulkMessagesClient.tsx` | Create | Full client component |
| `src/app/api/messages/bulk/customers/route.ts` | Delete | Replaced by RPC + server action |
| `tests/api/bulkCustomersRouteMarketingEligibility.test.ts` | Delete | Route no longer exists |
| `src/app/actions/__tests__/bulk-messages.test.ts` | Create | Server action unit tests |

---

### Task 1: Create the Supabase RPC migration

**Files:**
- Create: `supabase/migrations/20260415000000_add_bulk_sms_recipients_rpc.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- Migration: add get_bulk_sms_recipients RPC for bulk messaging page
-- This replaces the in-memory filtering in /api/messages/bulk/customers

CREATE OR REPLACE FUNCTION public.get_bulk_sms_recipients(
  p_event_id UUID DEFAULT NULL,
  p_booking_status TEXT DEFAULT NULL,
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
    c.mobile_e164 AS mobile_number,
    (
      SELECT MAX(ev.date)
      FROM public.bookings bk
      JOIN public.events ev ON ev.id = bk.event_id
      WHERE bk.customer_id = c.id
        AND bk.status IN ('pending_payment', 'confirmed')
        AND COALESCE(bk.is_reminder_only, false) = false
    )::DATE AS last_booking_date
  FROM public.customers c
  WHERE
    -- Must have a sendable phone number
    c.mobile_e164 IS NOT NULL

    -- Must be SMS-eligible (matches send pipeline in src/lib/sms/bulk.ts)
    AND c.sms_opt_in = TRUE
    AND c.marketing_sms_opt_in = TRUE
    AND (c.sms_status IS NULL OR c.sms_status = 'active')

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

    -- Search: name or phone (case-insensitive, wildcards pre-escaped by caller)
    AND (
      p_search IS NULL
      OR c.first_name ILIKE '%' || p_search || '%'
      OR c.last_name ILIKE '%' || p_search || '%'
      OR c.mobile_e164 ILIKE '%' || p_search || '%'
    )
  ORDER BY c.last_name, c.first_name;
END;
$$;

-- Security: restrict access to authenticated users only
REVOKE ALL ON FUNCTION public.get_bulk_sms_recipients FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_bulk_sms_recipients TO authenticated;
```

- [ ] **Step 2: Apply the migration**

Run: `npx supabase db push`
Expected: Migration applies successfully with no errors.

- [ ] **Step 3: Verify the RPC works**

Open Supabase SQL Editor and run:
```sql
-- Should return eligible customers
SELECT * FROM get_bulk_sms_recipients() LIMIT 5;

-- Should return customers NOT booked to a specific event
-- (replace with a real event_id from your DB)
SELECT * FROM get_bulk_sms_recipients(
  p_event_id := '<some-event-uuid>',
  p_booking_status := 'without_bookings'
);
```
Expected: Returns rows with `id`, `first_name`, `last_name`, `mobile_number` (which is `mobile_e164`), `last_booking_date`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260415000000_add_bulk_sms_recipients_rpc.sql
git commit -m "feat: add get_bulk_sms_recipients RPC for bulk messaging rebuild"
```

---

### Task 2: Create types

**Files:**
- Create: `src/types/bulk-messages.ts`

- [ ] **Step 1: Create the types file**

```typescript
export interface BulkRecipientFilters {
  eventId?: string
  bookingStatus?: 'with_bookings' | 'without_bookings'
  smsOptIn: 'opted_in' | 'all'
  categoryId?: string
  createdAfter?: string    // ISO date string YYYY-MM-DD
  createdBefore?: string   // ISO date string YYYY-MM-DD
  search?: string
}

export interface BulkRecipient {
  id: string
  first_name: string
  last_name: string
  mobile_number: string      // mobile_e164 from the RPC
  last_booking_date: string | null
}

export interface SendBulkResult {
  success: boolean
  sent?: number
  failed?: number
  queued?: boolean
  error?: string
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types/bulk-messages.ts
git commit -m "feat: add types for bulk messages rebuild"
```

---

### Task 3: Create server actions

**Files:**
- Create: `src/app/actions/bulk-messages.ts`

- [ ] **Step 1: Create the server actions file**

```typescript
'use server'

import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { sendBulkSMSDirect } from '@/app/actions/sms-bulk-direct'
import { enqueueBulkSMSJob } from '@/app/actions/job-queue'
import type { BulkRecipientFilters, BulkRecipient, SendBulkResult } from '@/types/bulk-messages'

function escapeSearchWildcards(search: string): string {
  return search.replace(/[%_\\]/g, '\\$&')
}

export async function fetchBulkRecipients(
  filters: BulkRecipientFilters
): Promise<{ data: BulkRecipient[] } | { error: string }> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: 'Unauthorized' }

    const hasPermission = await checkUserPermission('messages', 'send', user.id)
    if (!hasPermission) return { error: 'Insufficient permissions' }

    const escapedSearch = filters.search
      ? escapeSearchWildcards(filters.search)
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
    return { data: (data as BulkRecipient[]) ?? [] }
  } catch (err) {
    return { error: 'An unexpected error occurred while fetching recipients' }
  }
}

export async function sendBulkMessages(
  customerIds: string[],
  message: string,
  eventId?: string,
  categoryId?: string
): Promise<SendBulkResult> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { success: false, error: 'Unauthorized' }

    const hasPermission = await checkUserPermission('messages', 'send', user.id)
    if (!hasPermission) return { success: false, error: 'Insufficient permissions' }

    if (!customerIds.length) return { success: false, error: 'No recipients selected' }
    if (!message.trim()) return { success: false, error: 'Message cannot be empty' }

    if (customerIds.length <= 100) {
      const result = await sendBulkSMSDirect(customerIds, message, eventId, categoryId)
      if (result.error) {
        return { success: false, error: result.error }
      }
      return {
        success: true,
        sent: result.sent ?? 0,
        failed: result.failed ?? 0,
      }
    } else {
      const result = await enqueueBulkSMSJob(customerIds, message, eventId, categoryId)
      if (result.error) {
        return { success: false, error: result.error }
      }
      return {
        success: true,
        queued: true,
      }
    }
  } catch (err) {
    return { success: false, error: 'An unexpected error occurred while sending' }
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors related to `bulk-messages.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/app/actions/bulk-messages.ts
git commit -m "feat: add server actions for bulk messages rebuild"
```

---

### Task 4: Create server action tests

**Files:**
- Create: `src/app/actions/__tests__/bulk-messages.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock dependencies before imports
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn(),
}))

vi.mock('@/app/actions/sms-bulk-direct', () => ({
  sendBulkSMSDirect: vi.fn(),
}))

vi.mock('@/app/actions/job-queue', () => ({
  enqueueBulkSMSJob: vi.fn(),
}))

import { fetchBulkRecipients, sendBulkMessages } from '../bulk-messages'
import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { sendBulkSMSDirect } from '@/app/actions/sms-bulk-direct'
import { enqueueBulkSMSJob } from '@/app/actions/job-queue'

const mockRpc = vi.fn()
const mockGetUser = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  ;(createClient as any).mockResolvedValue({
    auth: { getUser: mockGetUser },
    rpc: mockRpc,
  })
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
  ;(checkUserPermission as any).mockResolvedValue(true)
})

describe('fetchBulkRecipients', () => {
  it('should return error when user is not authenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    const result = await fetchBulkRecipients({ smsOptIn: 'opted_in' })
    expect(result).toEqual({ error: 'Unauthorized' })
  })

  it('should return error when user lacks messages:send permission', async () => {
    ;(checkUserPermission as any).mockResolvedValue(false)
    const result = await fetchBulkRecipients({ smsOptIn: 'opted_in' })
    expect(result).toEqual({ error: 'Insufficient permissions' })
    expect(checkUserPermission).toHaveBeenCalledWith('messages', 'send', 'user-1')
  })

  it('should call RPC with correct params and return data', async () => {
    const mockData = [
      { id: 'c1', first_name: 'John', last_name: 'Doe', mobile_number: '+447123456789', last_booking_date: '2026-01-01' },
    ]
    mockRpc.mockResolvedValue({ data: mockData, error: null })

    const result = await fetchBulkRecipients({
      smsOptIn: 'opted_in',
      eventId: 'ev-1',
      bookingStatus: 'without_bookings',
      search: 'John',
    })

    expect(mockRpc).toHaveBeenCalledWith('get_bulk_sms_recipients', {
      p_event_id: 'ev-1',
      p_booking_status: 'without_bookings',
      p_sms_opt_in_only: true,
      p_category_id: null,
      p_created_after: null,
      p_created_before: null,
      p_search: 'John',
    })
    expect(result).toEqual({ data: mockData })
  })

  it('should escape search wildcards', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null })

    await fetchBulkRecipients({ smsOptIn: 'opted_in', search: '50%_off' })

    expect(mockRpc).toHaveBeenCalledWith('get_bulk_sms_recipients', expect.objectContaining({
      p_search: '50\\%\\_off',
    }))
  })

  it('should return error on RPC failure', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'DB error' } })
    const result = await fetchBulkRecipients({ smsOptIn: 'opted_in' })
    expect(result).toEqual({ error: 'Failed to fetch recipients: DB error' })
  })

  it('should pass sms_opt_in_only=false when filter is all', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null })
    await fetchBulkRecipients({ smsOptIn: 'all' })
    expect(mockRpc).toHaveBeenCalledWith('get_bulk_sms_recipients', expect.objectContaining({
      p_sms_opt_in_only: false,
    }))
  })
})

describe('sendBulkMessages', () => {
  it('should return error when user is not authenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    const result = await sendBulkMessages(['c1'], 'Hello')
    expect(result).toEqual({ success: false, error: 'Unauthorized' })
  })

  it('should return error when no recipients', async () => {
    const result = await sendBulkMessages([], 'Hello')
    expect(result).toEqual({ success: false, error: 'No recipients selected' })
  })

  it('should return error when message is empty', async () => {
    const result = await sendBulkMessages(['c1'], '   ')
    expect(result).toEqual({ success: false, error: 'Message cannot be empty' })
  })

  it('should use direct send for <= 100 recipients', async () => {
    ;(sendBulkSMSDirect as any).mockResolvedValue({ success: true, sent: 5, failed: 0 })
    const ids = Array.from({ length: 50 }, (_, i) => `c${i}`)
    const result = await sendBulkMessages(ids, 'Hello', 'ev-1')

    expect(sendBulkSMSDirect).toHaveBeenCalledWith(ids, 'Hello', 'ev-1', undefined)
    expect(result).toEqual({ success: true, sent: 5, failed: 0 })
  })

  it('should use job queue for > 100 recipients', async () => {
    ;(enqueueBulkSMSJob as any).mockResolvedValue({ success: true, jobId: 'job-1' })
    const ids = Array.from({ length: 150 }, (_, i) => `c${i}`)
    const result = await sendBulkMessages(ids, 'Hello')

    expect(enqueueBulkSMSJob).toHaveBeenCalledWith(ids, 'Hello', undefined, undefined)
    expect(result).toEqual({ success: true, queued: true })
  })

  it('should return error when direct send fails', async () => {
    ;(sendBulkSMSDirect as any).mockResolvedValue({ error: 'Rate limited' })
    const result = await sendBulkMessages(['c1'], 'Hello')
    expect(result).toEqual({ success: false, error: 'Rate limited' })
  })
})
```

- [ ] **Step 2: Run the tests**

Run: `npx vitest run src/app/actions/__tests__/bulk-messages.test.ts`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/app/actions/__tests__/bulk-messages.test.ts
git commit -m "test: add unit tests for bulk messages server actions"
```

---

### Task 5: Rewrite page.tsx as server wrapper

**Files:**
- Modify: `src/app/(authenticated)/messages/bulk/page.tsx`

- [ ] **Step 1: Rewrite page.tsx**

Replace the entire file with:

```typescript
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { getActiveEventCategories } from '@/app/actions/event-categories'
import { EventCategory } from '@/types/event-categories'
import BulkMessagesClient from './BulkMessagesClient'

export const metadata = {
  title: 'Bulk Messages | The Anchor',
}

interface EventOption {
  id: string
  name: string
  date: string
}

export default async function BulkMessagesPage() {
  const canSend = await checkUserPermission('messages', 'send')
  if (!canSend) redirect('/unauthorized')

  const supabase = await createClient()

  // Fetch events for the dropdown (all events, most recent first)
  const { data: events } = await supabase
    .from('events')
    .select('id, name, date')
    .order('date', { ascending: false })
    .limit(500)

  // Fetch categories for the dropdown
  const categoriesResult = await getActiveEventCategories()

  return (
    <BulkMessagesClient
      events={(events as EventOption[]) ?? []}
      categories={(categoriesResult.data as EventCategory[]) ?? []}
    />
  )
}
```

- [ ] **Step 2: Verify there are no TypeScript errors**

Run: `npx tsc --noEmit`
Expected: May show errors for missing `BulkMessagesClient` — that's expected, we create it in the next task.

- [ ] **Step 3: Commit**

```bash
git add src/app/(authenticated)/messages/bulk/page.tsx
git commit -m "refactor: rewrite bulk messages page as server component wrapper"
```

---

### Task 6: Create BulkMessagesClient component

**Files:**
- Create: `src/app/(authenticated)/messages/bulk/BulkMessagesClient.tsx`

This is the largest task — the full client component. Read the spec carefully: `docs/superpowers/specs/2026-04-15-bulk-messages-rebuild-design.md`.

- [ ] **Step 1: Create BulkMessagesClient.tsx**

```typescript
'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { fetchBulkRecipients, sendBulkMessages } from '@/app/actions/bulk-messages'
import { formatDate } from '@/lib/dateUtils'
import { evaluateSmsQuietHours } from '@/lib/sms/quiet-hours'
import type { BulkRecipientFilters, BulkRecipient } from '@/types/bulk-messages'
import type { EventCategory } from '@/types/event-categories'

// ui-v2 components
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Card } from '@/components/ui-v2/layout/Card'
import { Section } from '@/components/ui-v2/layout/Section'
import { Button } from '@/components/ui-v2/forms/Button'
import { Select } from '@/components/ui-v2/forms/Select'
import { Input } from '@/components/ui-v2/forms/Input'
import { Textarea } from '@/components/ui-v2/forms/Textarea'
import { DataTable, Column } from '@/components/ui-v2/display/DataTable'
import { ConfirmDialog } from '@/components/ui-v2/overlay/ConfirmDialog'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { Badge } from '@/components/ui-v2/display/Badge'
import {
  PaperAirplaneIcon,
  FunnelIcon,
  UserGroupIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline'

interface EventOption {
  id: string
  name: string
  date: string
}

interface BulkMessagesClientProps {
  events: EventOption[]
  categories: EventCategory[]
}

const DEFAULT_FILTERS: BulkRecipientFilters = {
  smsOptIn: 'opted_in',
}

function calculateSegments(text: string): number {
  if (!text) return 0
  // GSM-7 encoding: 160 chars per segment, 153 for multipart
  const length = text.length
  if (length <= 160) return 1
  return Math.ceil(length / 153)
}

function personaliseMessage(message: string, recipient: BulkRecipient): string {
  return message
    .replace(/\{\{first_name\}\}/g, recipient.first_name || 'there')
    .replace(/\{\{last_name\}\}/g, recipient.last_name || '')
}

export default function BulkMessagesClient({ events, categories }: BulkMessagesClientProps) {
  // Filter state
  const [filters, setFilters] = useState<BulkRecipientFilters>(DEFAULT_FILTERS)

  // Recipients state
  const [recipients, setRecipients] = useState<BulkRecipient[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string | number>>(new Set())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Compose state
  const [message, setMessage] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Send state
  const [sending, setSending] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  // Request cancellation
  const abortRef = useRef<AbortController | null>(null)
  const requestCounterRef = useRef(0)

  // Quiet hours
  const quietHours = evaluateSmsQuietHours()

  // Load recipients when filters change
  const loadRecipients = useCallback(async (currentFilters: BulkRecipientFilters) => {
    // Cancel any in-flight request
    if (abortRef.current) {
      abortRef.current.abort()
    }
    abortRef.current = new AbortController()
    const requestId = ++requestCounterRef.current

    setLoading(true)
    setError(null)
    setSelectedIds(new Set()) // Clear selection on filter change

    const result = await fetchBulkRecipients(currentFilters)

    // Only apply if this is still the latest request
    if (requestCounterRef.current !== requestId) return

    setLoading(false)
    if ('error' in result) {
      setError(result.error)
      toast({ title: 'Failed to load recipients', description: result.error, variant: 'error' })
    } else {
      setRecipients(result.data)
    }
  }, [])

  // Debounced filter effect
  useEffect(() => {
    const timeout = setTimeout(() => {
      loadRecipients(filters)
    }, 300)
    return () => clearTimeout(timeout)
  }, [filters, loadRecipients])

  // Filter update helper
  const updateFilter = useCallback((key: keyof BulkRecipientFilters, value: string | undefined) => {
    setFilters(prev => {
      const next = { ...prev, [key]: value || undefined }

      // Clear booking status when event is cleared
      if (key === 'eventId' && !value) {
        delete next.bookingStatus
      }

      return next
    })
  }, [])

  const clearFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS)
  }, [])

  // Insert personalisation variable at cursor
  const insertVariable = useCallback((variable: string) => {
    const textarea = textareaRef.current
    if (!textarea) return
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const newMessage = message.slice(0, start) + variable + message.slice(end)
    setMessage(newMessage)
    // Restore cursor position after React re-render
    requestAnimationFrame(() => {
      textarea.selectionStart = textarea.selectionEnd = start + variable.length
      textarea.focus()
    })
  }, [message])

  // Send handler
  const handleSend = useCallback(async () => {
    setShowConfirm(false)
    setSending(true)

    const customerIds = Array.from(selectedIds) as string[]
    const result = await sendBulkMessages(
      customerIds,
      message,
      filters.eventId,
      filters.categoryId,
    )

    setSending(false)

    if (!result.success) {
      toast({ title: 'Send failed', description: result.error, variant: 'error' })
      return
    }

    if (result.queued) {
      toast({
        title: 'Messages queued',
        description: `${customerIds.length} messages queued for delivery`,
        variant: 'success',
      })
    } else if (result.failed && result.failed > 0) {
      toast({
        title: 'Partially sent',
        description: `${result.sent} sent, ${result.failed} failed — do not retry`,
        variant: 'warning',
      })
    } else {
      const verb = quietHours.inQuietHours ? 'scheduled' : 'sent'
      toast({
        title: `Messages ${verb}`,
        description: `${result.sent} messages ${verb} successfully`,
        variant: 'success',
      })
    }

    // Clear compose state, keep filters
    setMessage('')
    setSelectedIds(new Set())
  }, [selectedIds, message, filters.eventId, filters.categoryId, quietHours.inQuietHours])

  // DataTable columns
  const columns: Column<BulkRecipient>[] = [
    {
      key: 'name',
      header: 'Name',
      cell: (row) => `${row.first_name || ''} ${row.last_name || ''}`.trim() || 'Unknown',
      sortable: true,
      sortFn: (a, b) => {
        const nameA = `${a.last_name} ${a.first_name}`.toLowerCase()
        const nameB = `${b.last_name} ${b.first_name}`.toLowerCase()
        return nameA.localeCompare(nameB)
      },
    },
    {
      key: 'mobile_number',
      header: 'Mobile',
      cell: (row) => row.mobile_number,
      hideOnMobile: true,
    },
    {
      key: 'last_booking_date',
      header: 'Last Booking',
      cell: (row) => row.last_booking_date ? formatDate(row.last_booking_date) : '—',
      sortable: true,
      hideOnMobile: true,
    },
  ]

  // Preview message
  const firstSelected = recipients.find(r => selectedIds.has(r.id))
  const previewText = message
    ? personaliseMessage(message, firstSelected || { id: '', first_name: 'John', last_name: 'Smith', mobile_number: '', last_booking_date: null })
    : ''

  const trimmedMessage = message.trim()
  const canSend = selectedIds.size > 0 && trimmedMessage.length > 0 && !sending

  return (
    <PageLayout
      title="Bulk Messages"
      description="Send SMS to multiple customers"
      icon={<PaperAirplaneIcon className="h-6 w-6" />}
      breadcrumbs={[
        { label: 'Messages', href: '/messages' },
        { label: 'Bulk Send' },
      ]}
    >
      {/* Filter Panel */}
      <Section>
        <Card>
          <div className="flex items-center gap-2 mb-4">
            <FunnelIcon className="h-5 w-5 text-gray-500" />
            <h3 className="text-sm font-medium text-gray-700">Filters</h3>
            {Object.keys(filters).length > 1 && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                Clear Filters
              </Button>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Event filter */}
            <Select
              label="Event"
              value={filters.eventId || ''}
              onChange={(e) => updateFilter('eventId', e.target.value)}
              options={[
                { value: '', label: 'All Events' },
                ...events.map(ev => ({
                  value: ev.id,
                  label: `${ev.name} (${formatDate(ev.date)})`,
                })),
              ]}
            />

            {/* Booking Status (disabled without event) */}
            <Select
              label="Booking Status"
              value={filters.bookingStatus || ''}
              onChange={(e) => updateFilter('bookingStatus', e.target.value)}
              disabled={!filters.eventId}
              options={[
                { value: '', label: filters.eventId ? 'Any Status' : 'Select an event first' },
                { value: 'with_bookings', label: 'With Bookings' },
                { value: 'without_bookings', label: 'Without Bookings' },
              ]}
            />

            {/* SMS Opt-in */}
            <Select
              label="SMS Status"
              value={filters.smsOptIn}
              onChange={(e) => updateFilter('smsOptIn', e.target.value)}
              options={[
                { value: 'opted_in', label: 'Opted In' },
                { value: 'all', label: 'All Eligible' },
              ]}
            />

            {/* Event Category */}
            <Select
              label="Event Category"
              value={filters.categoryId || ''}
              onChange={(e) => updateFilter('categoryId', e.target.value)}
              options={[
                { value: '', label: 'All Categories' },
                ...categories.map(cat => ({
                  value: cat.id,
                  label: cat.name,
                })),
              ]}
            />

            {/* Date Range */}
            <Input
              label="Created After"
              type="date"
              value={filters.createdAfter || ''}
              onChange={(e) => updateFilter('createdAfter', e.target.value)}
            />
            <Input
              label="Created Before"
              type="date"
              value={filters.createdBefore || ''}
              onChange={(e) => updateFilter('createdBefore', e.target.value)}
            />
          </div>

          {/* Search */}
          <div className="mt-4">
            <Input
              label="Search"
              placeholder="Search by name or phone number..."
              value={filters.search || ''}
              onChange={(e) => updateFilter('search', e.target.value)}
            />
          </div>
        </Card>
      </Section>

      {/* Recipients */}
      <Section>
        <Card>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <UserGroupIcon className="h-5 w-5 text-gray-500" />
              <h3 className="text-sm font-medium text-gray-700">Recipients</h3>
              {!loading && (
                <Badge variant="secondary">
                  {selectedIds.size} of {recipients.length} selected
                </Badge>
              )}
            </div>
          </div>

          {error && (
            <Alert variant="error" className="mb-4">
              {error}
            </Alert>
          )}

          <DataTable<BulkRecipient>
            data={recipients}
            columns={columns}
            getRowKey={(row) => row.id}
            loading={loading}
            skeletonRows={5}
            selectable
            selectedKeys={selectedIds}
            onSelectionChange={setSelectedIds}
            emptyMessage="No customers match these filters"
            emptyDescription="Try adjusting your filters to find recipients"
            size="sm"
          />
        </Card>
      </Section>

      {/* Compose & Send */}
      <Section>
        <Card>
          <h3 className="text-sm font-medium text-gray-700 mb-4">Compose Message</h3>

          {/* Personalisation buttons */}
          <div className="flex gap-2 mb-2">
            <Button variant="ghost" size="sm" onClick={() => insertVariable('{{first_name}}')}>
              {'{{first_name}}'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => insertVariable('{{last_name}}')}>
              {'{{last_name}}'}
            </Button>
          </div>

          {/* Message textarea */}
          <Textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Type your message here..."
            rows={4}
          />

          {/* Character / segment count */}
          <div className="flex justify-between items-center mt-2 text-sm text-gray-500">
            <span>
              {message.length} characters | {calculateSegments(message)} SMS segment{calculateSegments(message) !== 1 ? 's' : ''}
            </span>
            {firstSelected && message && (
              <span className="text-xs text-gray-400">
                Preview: {previewText}
              </span>
            )}
          </div>

          {/* Quiet hours warning */}
          {quietHours.inQuietHours && (
            <Alert variant="warning" className="mt-4">
              <ExclamationTriangleIcon className="h-4 w-4 inline mr-1" />
              Messages sent now will be delivered after 9:00 AM
            </Alert>
          )}

          {/* Send button */}
          <div className="mt-4 flex justify-end">
            <Button
              onClick={() => setShowConfirm(true)}
              disabled={!canSend}
              loading={sending}
              icon={<PaperAirplaneIcon className="h-4 w-4" />}
            >
              {sending ? 'Sending...' : `Send to ${selectedIds.size} recipient${selectedIds.size !== 1 ? 's' : ''}`}
            </Button>
          </div>
        </Card>
      </Section>

      {/* Confirmation Dialog */}
      <ConfirmDialog
        open={showConfirm}
        onClose={() => setShowConfirm(false)}
        onConfirm={handleSend}
        title="Confirm Send"
        type="info"
        confirmText="Confirm Send"
        confirmVariant="primary"
      >
        <div className="space-y-3">
          <p>
            You are about to send a message to <strong>{selectedIds.size}</strong> recipient{selectedIds.size !== 1 ? 's' : ''}.
          </p>
          {quietHours.inQuietHours && (
            <p className="text-amber-600 text-sm">
              Messages will be delivered after 9:00 AM (quiet hours are active).
            </p>
          )}
          <div className="bg-gray-50 p-3 rounded text-sm font-mono whitespace-pre-wrap">
            {previewText || trimmedMessage}
          </div>
        </div>
      </ConfirmDialog>
    </PageLayout>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors. If `Textarea` doesn't support `ref`, use a wrapper or `forwardRef` — check the component.

- [ ] **Step 3: Start dev server and test the page**

Run: `npm run dev`
Navigate to `/messages/bulk`.
Expected: Page loads, filters appear, recipients load automatically, selection works.

- [ ] **Step 4: Test the core bug fix**

1. Select an event from the dropdown
2. Set Booking Status to "Without Bookings"
3. Verify the list shows customers who have NOT booked that event
4. Verify the count is non-zero (should be most of your customer base)

- [ ] **Step 5: Test filter combinations**

1. Event + With Bookings → only customers booked to that event
2. Event Category → customers who attended that category
3. Search → filters by name/phone
4. Date range → filters by creation date
5. Clear Filters → resets to default

- [ ] **Step 6: Test send flow**

1. Select some recipients
2. Type a message with `{{first_name}}`
3. Verify preview shows personalised text
4. Click Send → confirmation modal appears
5. Confirm → toast shows success/failure

- [ ] **Step 7: Commit**

```bash
git add src/app/(authenticated)/messages/bulk/BulkMessagesClient.tsx
git commit -m "feat: add BulkMessagesClient component — ground-up rebuild"
```

---

### Task 7: Delete old API route and tests

**Files:**
- Delete: `src/app/api/messages/bulk/customers/route.ts`
- Delete: `tests/api/bulkCustomersRouteMarketingEligibility.test.ts`

- [ ] **Step 1: Delete the old API route**

```bash
rm src/app/api/messages/bulk/customers/route.ts
```

Check if the directory is now empty:
```bash
ls src/app/api/messages/bulk/customers/ 2>/dev/null || echo "Directory removed or empty"
```

If empty, remove the directory:
```bash
rmdir src/app/api/messages/bulk/customers 2>/dev/null
rmdir src/app/api/messages/bulk 2>/dev/null
```

- [ ] **Step 2: Delete the old route test**

```bash
rm tests/api/bulkCustomersRouteMarketingEligibility.test.ts
```

- [ ] **Step 3: Verify nothing else imports the deleted route**

Run: `grep -r "messages/bulk/customers" src/ --include="*.ts" --include="*.tsx" -l`
Expected: No results (the old page.tsx was already rewritten).

- [ ] **Step 4: Run the full verification pipeline**

```bash
npm run lint && npx tsc --noEmit && npm test && npm run build
```
Expected: All pass with no errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: delete old bulk messages API route and tests — replaced by RPC"
```

---

### Task 8: Final verification

- [ ] **Step 1: End-to-end test of the core bug fix**

1. Open `/messages/bulk`
2. Select any event with existing bookings
3. Set "Without Bookings"
4. Verify the list shows customers (should be non-empty)
5. Switch to "With Bookings"
6. Verify only customers booked to that event appear
7. Clear the event filter
8. Verify all eligible customers appear

- [ ] **Step 2: Test rapid filter changes**

1. Quickly toggle between different events
2. Verify no stale data appears (request counter prevents old responses)
3. Verify selection clears on each change

- [ ] **Step 3: Test send during quiet hours (if applicable)**

1. If testing between 21:00-09:00 London time, verify warning banner appears
2. Verify confirmation modal mentions quiet hours
3. After send, verify toast says "scheduled" not "sent"

- [ ] **Step 4: Run verification pipeline one final time**

```bash
npm run lint && npx tsc --noEmit && npm test && npm run build
```
Expected: All pass.

- [ ] **Step 5: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: address issues found during bulk messages final verification"
```
