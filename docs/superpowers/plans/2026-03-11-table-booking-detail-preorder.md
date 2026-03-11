# Table Booking Detail Page & Pre-order Management Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a full booking detail page at `/table-bookings/[id]`, port all BOH modal content to it, add a Sunday lunch pre-order tab with view/edit, update the BOH Manage button to navigate there, and add colour-coded pre-order status indicators to FOH swimlane cards.

**Architecture:** New Server Component page (`page.tsx`) fetches booking data and passes it to a Client Component (`BookingDetailClient`) that handles tab state and all interactive actions. The Pre-order tab is a separate Client Component (`PreorderTab`) that fetches its own data via a new API endpoint wrapping the existing `getSundayPreorderPageDataByBookingId` service function. The FOH card query gets one additional field. All existing BOH API endpoints (`/api/boh/table-bookings/[id]/status`, `/sms`, `/move-table`) are reused unchanged.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Tailwind CSS v4, Supabase, ui-v2 component library (`PageLayout`, `Button`), existing BOH API endpoints

---

## File Map

**Create:**
- `src/app/(authenticated)/table-bookings/[id]/page.tsx` — Server Component; auth + permission check, booking data fetch, renders `BookingDetailClient`
- `src/app/(authenticated)/table-bookings/[id]/BookingDetailClient.tsx` — Client Component; tab state, all action handlers (seat, cancel, move table, SMS, party size, delete), overview + SMS tab UI
- `src/app/(authenticated)/table-bookings/[id]/PreorderTab.tsx` — Client Component; pre-order read view + inline edit form; fetches via `/api/boh/table-bookings/[id]/preorder`
- `src/app/api/boh/table-bookings/[id]/preorder/route.ts` — GET (load pre-order state) + POST (save items) API route

**Modify:**
- `src/app/api/foh/schedule/route.ts` — Add `sunday_preorder_completed_at` to the select string (~line 178)
- `src/app/(authenticated)/table-bookings/foh/FohScheduleClient.tsx` — Add field to `FohBooking` type; add colour-coded border + label to swimlane card (~lines 11-32, 2605-2629)
- `src/app/(authenticated)/table-bookings/boh/BohBookingsClient.tsx` — Change Manage button to `router.push`; remove all modal state, handlers, and modal JSX

---

## Chunk 1: FOH Colour-Coded Cards

### Task 1: Add `sunday_preorder_completed_at` to FOH schedule query

**Files:**
- Modify: `src/app/api/foh/schedule/route.ts` (~line 178)
- Modify: `src/app/(authenticated)/table-bookings/foh/FohScheduleClient.tsx` (~lines 11-32)

- [ ] Open `src/app/api/foh/schedule/route.ts` and find the select string (~line 178). It currently ends with `deposit_waived, customer:customers!...`
- [ ] Add `sunday_preorder_completed_at` to the select string immediately after `deposit_waived`:

```typescript
// Before (excerpt):
'id, booking_reference, ... deposit_waived, customer:customers!table_bookings_customer_id_fkey(first_name,last_name)'

// After (excerpt):
'id, booking_reference, ... deposit_waived, sunday_preorder_completed_at, customer:customers!table_bookings_customer_id_fkey(first_name,last_name)'
```

- [ ] Open `src/app/(authenticated)/table-bookings/foh/FohScheduleClient.tsx` and find the `FohBooking` type definition (~lines 11-32)
- [ ] Add the field to the type:

```typescript
sunday_preorder_completed_at: string | null
```

- [ ] Note: `getSundayPreorderBorderStyle` should be placed at **module scope** (alongside `getBookingVisualState` and similar helpers near line 291), not inside the render function — this avoids it being re-created on every render
- [ ] Run `npm run typecheck` — fix any type errors that surface (TypeScript will complain about the new field being used before it exists in any logic — that's fine for now)
- [ ] Commit:

```bash
git add src/app/api/foh/schedule/route.ts src/app/(authenticated)/table-bookings/foh/FohScheduleClient.tsx
git commit -m "feat: add sunday_preorder_completed_at to FOH schedule query and type"
```

---

### Task 2: Colour-code FOH booking cards for Sunday lunch pre-order status

**Files:**
- Modify: `src/app/(authenticated)/table-bookings/foh/FohScheduleClient.tsx` (~lines 2605-2629)

- [ ] Locate the booking card `<button>` element in the swimlane (~line 2605). It has `style={{ left: ..., width: ... }}`
- [ ] Add the helper function at **module scope** alongside `getBookingVisualState` and similar helpers (~line 291) — NOT inline above the card render block (which would re-create it on every render):

```typescript
function getSundayPreorderBorderStyle(booking: FohBooking): React.CSSProperties {
  if (booking.booking_type !== 'sunday_lunch') return {}
  if (booking.sunday_preorder_completed_at) {
    return { borderLeft: '4px solid #16a34a' }  // green — submitted
  }
  return { borderLeft: '4px solid #d97706' }  // amber — pending
}
```

- [ ] Update the card `<button>` style prop to merge the border style:

```typescript
// Before:
style={{ left: `${leftPct}%`, width: `${widthPct}%` }}

// After:
style={{ left: `${leftPct}%`, width: `${widthPct}%`, ...getSundayPreorderBorderStyle(booking) }}
```

- [ ] Add a pre-order status label inside the card, after the existing `<p>` tags, conditional on `booking_type === 'sunday_lunch'`:

```tsx
{booking.booking_type === 'sunday_lunch' && (
  <p
    className="truncate text-xs font-semibold mt-0.5"
    style={{ color: booking.sunday_preorder_completed_at ? '#86efac' : '#fcd34d' }}
  >
    {booking.sunday_preorder_completed_at ? '✓ Pre-order done' : '⏳ Pre-order pending'}
  </p>
)}
```

- [ ] Run `npm run lint && npm run typecheck` — fix any issues
- [ ] Start dev server (`npm run dev`), navigate to FOH view on a date that has Sunday lunch bookings — confirm green/amber left borders appear and non-Sunday-lunch bookings are unchanged
- [ ] Commit:

```bash
git add src/app/(authenticated)/table-bookings/foh/FohScheduleClient.tsx
git commit -m "feat: colour-code FOH swimlane cards for Sunday lunch pre-order status"
```

---

## Chunk 2: Booking Detail Page — Server Shell + Tab Layout

### Task 3: Create `page.tsx` — Server Component

**Files:**
- Create: `src/app/(authenticated)/table-bookings/[id]/page.tsx`

- [ ] Create the file at `src/app/(authenticated)/table-bookings/[id]/page.tsx`:

```typescript
import { notFound, redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { createClient } from '@/lib/supabase/server'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import BookingDetailClient from './BookingDetailClient'

interface Props {
  params: Promise<{ id: string }>
}

export default async function BookingDetailPage({ params }: Props) {
  const { id } = await params

  const [canView, canEdit, canManage] = await Promise.all([
    checkUserPermission('table_bookings', 'view'),
    checkUserPermission('table_bookings', 'edit'),
    checkUserPermission('table_bookings', 'manage'),
  ])

  if (!canView) redirect('/unauthorized')

  const supabase = await createClient()
  const { data: booking, error } = await supabase
    .from('table_bookings')
    .select(`
      id, booking_reference, booking_date, booking_time, party_size,
      booking_type, booking_purpose, status, special_requirements,
      dietary_requirements, allergies, celebration_type,
      seated_at, left_at, no_show_at, confirmed_at, cancelled_at,
      start_datetime, end_datetime, duration_minutes,
      sunday_preorder_cutoff_at, sunday_preorder_completed_at,
      deposit_waived,
      customer:customers!table_bookings_customer_id_fkey(
        id, first_name, last_name, mobile_number
      ),
      table_booking_tables(
        table:venue_tables(id, name, table_number, capacity)
      )
    `)
    .eq('id', id)
    .single()

  if (error || !booking) notFound()

  const guestName = [booking.customer?.first_name, booking.customer?.last_name]
    .filter(Boolean)
    .join(' ')
  const title = guestName || booking.booking_reference || 'Booking'

  return (
    <PageLayout
      title={title}
      subtitle={`${booking.booking_reference ?? ''} · ${booking.booking_date} · ${booking.booking_time ?? ''}`}
      backButton={{ label: 'Back to BOH', href: '/table-bookings/boh' }}
    >
      <BookingDetailClient
        booking={booking}
        canEdit={canEdit}
        canManage={canManage}
      />
    </PageLayout>
  )
}
```

- [ ] Note: The `BookingDetailClient` import will fail until Task 4 creates it. **Skip `npm run typecheck` at this step** — commit as a checkpoint only; the typecheck gate will be satisfied after Task 4
- [ ] Confirm `'table_bookings'` is present in `src/types/rbac.ts` module list before committing (prevents silent redirect-all-users on typo)
- [ ] Commit as a checkpoint:

```bash
git add src/app/(authenticated)/table-bookings/[id]/page.tsx
git commit -m "feat: add booking detail server component page"
```

---

### Task 4: Create `BookingDetailClient.tsx` — tab shell

**Files:**
- Create: `src/app/(authenticated)/table-bookings/[id]/BookingDetailClient.tsx`
- Create (stub): `src/app/(authenticated)/table-bookings/[id]/PreorderTab.tsx`

- [ ] Create `BookingDetailClient.tsx` with tab state and placeholder content for each tab:

```typescript
'use client'

import { useState } from 'react'
import PreorderTab from './PreorderTab'

type Tab = 'overview' | 'preorder' | 'sms'

interface BookingCustomer {
  id: string
  first_name: string | null
  last_name: string | null
  mobile_number: string | null
}

interface BookingTable {
  table: {
    id: string
    name: string
    table_number: string | null
    capacity: number | null
  } | null
}

export interface Booking {
  id: string
  booking_reference: string | null
  booking_date: string
  booking_time: string | null
  party_size: number | null
  booking_type: string | null
  booking_purpose: string | null
  status: string
  special_requirements: string | null
  dietary_requirements: string | null
  allergies: string | null
  celebration_type: string | null
  seated_at: string | null
  left_at: string | null
  no_show_at: string | null
  confirmed_at: string | null
  cancelled_at: string | null
  start_datetime: string | null
  end_datetime: string | null
  duration_minutes: number | null
  sunday_preorder_cutoff_at: string | null
  sunday_preorder_completed_at: string | null
  deposit_waived: boolean | null
  customer: BookingCustomer | null
  table_booking_tables: BookingTable[]
}

interface Props {
  booking: Booking
  canEdit: boolean
  canManage: boolean
}

export default function BookingDetailClient({ booking, canEdit, canManage }: Props) {
  const [tab, setTab] = useState<Tab>('overview')
  const isSundayLunch = booking.booking_type === 'sunday_lunch'

  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    ...(isSundayLunch ? [{ id: 'preorder' as Tab, label: 'Pre-order' }] : []),
    { id: 'sms', label: 'SMS' },
  ]

  // Note: canManage is used in the overview tab quick actions (Task 6).
  // If ESLint reports it as unused at this stage, rename the destructured param to _canManage temporarily.

  return (
    <div>
      {/* Tab bar */}
      <div className="flex border-b border-gray-200 mb-6">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.id
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'overview' && (
        <div className="text-sm text-gray-500">Overview — coming in next task</div>
      )}
      {tab === 'preorder' && isSundayLunch && (
        <PreorderTab booking={booking} canEdit={canEdit} />
      )}
      {tab === 'sms' && (
        <div className="text-sm text-gray-500">SMS — coming in next task</div>
      )}
    </div>
  )
}
```

- [ ] Create a stub `PreorderTab.tsx` so the import resolves:

```typescript
// src/app/(authenticated)/table-bookings/[id]/PreorderTab.tsx
'use client'

import type { Booking } from './BookingDetailClient'

export default function PreorderTab({ booking: _booking, canEdit: _canEdit }: { booking: Booking; canEdit: boolean }) {
  return <div className="text-sm text-gray-500">Pre-order tab — coming soon</div>
}
```

- [ ] Run `npm run typecheck && npm run lint` — fix any errors
- [ ] Start dev server, navigate to `/table-bookings/<any-valid-booking-id>` — confirm the page loads with the tab bar visible
- [ ] Commit:

```bash
git add src/app/(authenticated)/table-bookings/[id]/BookingDetailClient.tsx src/app/(authenticated)/table-bookings/[id]/PreorderTab.tsx
git commit -m "feat: add booking detail client with tab shell and PreorderTab stub"
```

---

## Chunk 3: Overview Tab + SMS Tab

### Task 5: Overview tab — status strip, guest info, notes, pre-order banner

**Files:**
- Modify: `src/app/(authenticated)/table-bookings/[id]/BookingDetailClient.tsx`

- [ ] Add `formatDateInLondon` to the imports at the top of `BookingDetailClient.tsx`:

```typescript
import { formatDateInLondon } from '@/lib/dateUtils'
```

- [ ] Add a `StatusBadge` helper component at the top of the file (below imports):

```typescript
function StatusBadge({ status }: { status: string }) {
  const colours: Record<string, string> = {
    confirmed: 'bg-green-100 text-green-800',
    pending: 'bg-yellow-100 text-yellow-800',
    seated: 'bg-blue-100 text-blue-800',
    completed: 'bg-gray-100 text-gray-600',
    cancelled: 'bg-red-100 text-red-800',
    no_show: 'bg-red-100 text-red-800',
  }
  return (
    <span
      className={`text-xs font-semibold uppercase tracking-wide px-2 py-0.5 rounded ${colours[status] ?? 'bg-gray-100 text-gray-600'}`}
    >
      {status.replace(/_/g, ' ')}
    </span>
  )
}
```

Note: First search for an existing `StatusBadge` in `src/components/` — if found, import it instead of defining a new one.

- [ ] Replace `{tab === 'overview' && ...}` placeholder with the real overview layout:

```tsx
{tab === 'overview' && (
  <div className="space-y-4 max-w-2xl">
    {/* Status strip */}
    <div className="flex flex-wrap items-center gap-3 p-4 bg-gray-50 rounded-lg border border-gray-200">
      <StatusBadge status={booking.status} />
      {booking.party_size != null && (
        <span className="text-sm text-gray-600">{booking.party_size} covers</span>
      )}
      {booking.table_booking_tables.length > 0 && (
        <span className="text-sm text-gray-600">
          {booking.table_booking_tables.map((t) => t.table?.name).filter(Boolean).join(', ')}
        </span>
      )}
      {booking.booking_type && (
        <span className="text-xs font-medium uppercase tracking-wide text-gray-500 bg-gray-200 px-2 py-0.5 rounded">
          {booking.booking_type.replace(/_/g, ' ')}
        </span>
      )}
    </div>

    {/* Guest info */}
    <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-1">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Guest</p>
      <p className="text-sm font-medium text-gray-900">
        {[booking.customer?.first_name, booking.customer?.last_name].filter(Boolean).join(' ') || '—'}
      </p>
      {booking.customer?.mobile_number && (
        <p className="text-sm text-gray-600">{booking.customer.mobile_number}</p>
      )}
      {booking.seated_at && (
        <p className="text-xs text-gray-400">
          Seated: {formatDateInLondon(new Date(booking.seated_at), 'HH:mm')}
        </p>
      )}
      {booking.left_at && (
        <p className="text-xs text-gray-400">
          Left: {formatDateInLondon(new Date(booking.left_at), 'HH:mm')}
        </p>
      )}
    </div>

    {/* Notes — conditional */}
    {(booking.special_requirements || booking.dietary_requirements || booking.allergies || booking.celebration_type) && (
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Notes</p>
        {booking.special_requirements && (
          <p className="text-sm text-gray-700 mb-1">{booking.special_requirements}</p>
        )}
        {booking.dietary_requirements && (
          <p className="text-sm text-gray-700 mb-1">Dietary: {booking.dietary_requirements}</p>
        )}
        {booking.allergies && (
          <p className="text-sm text-gray-700 mb-1">Allergies: {booking.allergies}</p>
        )}
        {booking.celebration_type && (
          <p className="text-sm text-gray-700">Celebration: {booking.celebration_type}</p>
        )}
      </div>
    )}

    {/* Pre-order banner — Sunday lunch only.
        Note: item counts are NOT shown here (would require an extra fetch at page load).
        The Pre-order tab shows the full detail one click away — this banner is just a status signal. */}
    {isSundayLunch && (
      <button
        type="button"
        onClick={() => setTab('preorder')}
        className={`w-full text-left rounded-lg border p-4 flex items-center justify-between transition-colors ${
          booking.sunday_preorder_completed_at
            ? 'border-green-300 bg-green-50 hover:bg-green-100'
            : 'border-amber-300 bg-amber-50 hover:bg-amber-100'
        }`}
      >
        <span
          className={`text-sm font-medium ${booking.sunday_preorder_completed_at ? 'text-green-800' : 'text-amber-800'}`}
        >
          {booking.sunday_preorder_completed_at
            ? 'Sunday pre-order submitted'
            : 'Sunday pre-order not yet submitted'}
        </span>
        <span
          className={`text-xs ${booking.sunday_preorder_completed_at ? 'text-green-600' : 'text-amber-600'}`}
        >
          View in Pre-order tab →
        </span>
      </button>
    )}

    {/* Placeholder for quick actions — added in Task 6 */}
    {canEdit && (
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Quick actions — coming next</p>
      </div>
    )}
  </div>
)}
```

- [ ] Run `npm run lint && npm run typecheck` — fix any errors
- [ ] Load a booking in the browser — verify status strip, guest info, notes panel (conditional), and pre-order banner all render correctly
- [ ] Click the pre-order banner on a Sunday lunch booking — confirm it switches to the Pre-order tab
- [ ] Commit:

```bash
git add src/app/(authenticated)/table-bookings/[id]/BookingDetailClient.tsx
git commit -m "feat: add overview tab status strip, guest info, notes, and pre-order banner"
```

---

### Task 6: Overview tab — quick actions + move table + confirmation dialogs

**Files:**
- Modify: `src/app/(authenticated)/table-bookings/[id]/BookingDetailClient.tsx`

- [ ] Add imports at the top of the file — check `BohBookingsClient.tsx` for exact import paths, you'll need:
  - `useRouter` from `'next/navigation'`
  - `useEffect` added to the existing React import
  - `toast` from `'react-hot-toast'` (the project standard — confirmed in `BohBookingsClient.tsx` line 8)
  - `Button` from the ui-v2 components (check `BohBookingsClient` import path)
  - `ConfirmDialog` and `Modal` from ui-v2 (check `BohBookingsClient` import paths)
  - `formatDateInLondon` from `'@/lib/dateUtils'` (already added in Task 5)

- [ ] Add these type definitions at the top of the file (below the `Booking` interface):

```typescript
type MoveTableOption = {
  id: string
  name: string
  table_number?: string | null
  capacity?: number | null
}

type MoveTableAvailabilityResponse = {
  success?: boolean
  error?: string
  data?: {
    booking_id: string
    tables: MoveTableOption[]
  }
}
```

- [ ] Add state variables inside `BookingDetailClient` (after the `tab` state):

```typescript
const router = useRouter()
const [actionLoadingKey, setActionLoadingKey] = useState<string | null>(null)
const [moveTableId, setMoveTableId] = useState<string>('')
const [availableMoveTables, setAvailableMoveTables] = useState<
  { id: string; name: string; table_number: string | null; capacity: number | null }[]
>([])
const [loadingMoveTables, setLoadingMoveTables] = useState(false)
const [noShowConfirmOpen, setNoShowConfirmOpen] = useState(false)
const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false)
const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
const [partySizeEditOpen, setPartySizeEditOpen] = useState(false)
const [partySizeEditValue, setPartySizeEditValue] = useState('')
const [partySizeEditSendSms, setPartySizeEditSendSms] = useState(true)
```

- [ ] Add a `runAction` helper function:

```typescript
async function runAction(key: string, fn: () => Promise<void>, successMsg: string) {
  setActionLoadingKey(key)
  try {
    await fn()
    toast.success(successMsg)
    router.refresh()
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'Something went wrong')
  } finally {
    setActionLoadingKey(null)
  }
}
```

- [ ] Add the status action handler:

```typescript
async function handleStatusAction(
  action: 'seated' | 'left' | 'no_show' | 'cancelled' | 'confirmed' | 'completed'
) {
  await runAction(
    `status:${action}`,
    async () => {
      const response = await fetch(`/api/boh/table-bookings/${booking.id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const payload = (await response.json()) as { error?: string }
      if (!response.ok) throw new Error(payload.error ?? 'Failed to update booking status')
    },
    'Booking updated'
  )
}
```

- [ ] Add the move table handler:

```typescript
async function handleMoveTable() {
  if (!moveTableId) {
    toast.error('Select a table to move this booking')
    return
  }
  await runAction(
    'move-table',
    async () => {
      const response = await fetch(`/api/boh/table-bookings/${booking.id}/move-table`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table_id: moveTableId }),
      })
      const payload = (await response.json()) as { error?: string }
      if (!response.ok) throw new Error(payload.error ?? 'Failed to move booking to selected table')
    },
    'Table assignment updated'
  )
}
```

- [ ] Add a `useEffect` that loads available tables on mount — note the cancellation flag pattern to prevent state updates on unmounted components:

```typescript
useEffect(() => {
  let cancelled = false

  async function loadAvailableTables() {
    if (!canEdit) {
      setAvailableMoveTables([])
      setMoveTableId('')
      setLoadingMoveTables(false)
      return
    }
    setLoadingMoveTables(true)
    try {
      const response = await fetch(`/api/boh/table-bookings/${booking.id}/move-table`, {
        cache: 'no-store',
      })
      const payload = (await response.json()) as MoveTableAvailabilityResponse
      if (!response.ok || !payload.success || !payload.data) {
        throw new Error(payload.error ?? 'Failed to load available tables')
      }
      if (cancelled) return
      const options = Array.isArray(payload.data.tables) ? payload.data.tables : []
      setAvailableMoveTables(options)
      setMoveTableId((current) =>
        current && options.some((t) => t.id === current) ? current : ''
      )
    } catch (error) {
      if (cancelled) return
      setAvailableMoveTables([])
      setMoveTableId('')
      toast.error(error instanceof Error ? error.message : 'Failed to load available tables')
    } finally {
      if (!cancelled) setLoadingMoveTables(false)
    }
  }

  void loadAvailableTables()
  return () => { cancelled = true }
}, [booking.id, canEdit])
```

- [ ] Add the party size edit handler:

```typescript
async function handleSubmitPartySize() {
  const nextSize = Number.parseInt(partySizeEditValue, 10)
  if (!Number.isFinite(nextSize) || nextSize < 1 || nextSize > 50) {
    toast.error('Enter a party size between 1 and 50')
    return
  }
  setPartySizeEditOpen(false)
  await runAction(
    'party-size',
    async () => {
      const response = await fetch(`/api/boh/table-bookings/${booking.id}/party-size`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ party_size: nextSize, send_sms: partySizeEditSendSms }),
      })
      const payload = (await response.json()) as { error?: string }
      if (!response.ok) throw new Error(payload.error ?? 'Failed to update party size')
    },
    'Party size updated'
  )
}
```

- [ ] Add the copy deposit link handler — check `BohBookingsClient.tsx` for the exact implementation (it likely calls an endpoint and copies the returned URL to clipboard):

```typescript
async function handleCopyDepositLink() {
  await runAction(
    'deposit-link',
    async () => {
      const response = await fetch(`/api/boh/table-bookings/${booking.id}/deposit-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const payload = (await response.json()) as { error?: string; url?: string }
      if (!response.ok) throw new Error(payload.error ?? 'Failed to generate deposit link')
      if (payload.url) await navigator.clipboard.writeText(payload.url)
    },
    'Deposit link copied to clipboard'
  )
}
```

Note: Verify the exact endpoint and response shape in `BohBookingsClient.tsx` — the above is based on the expected pattern. Adjust if the actual implementation differs.

- [ ] Add the delete handler:

```typescript
async function handleDeleteBooking() {
  await runAction(
    'delete',
    async () => {
      const response = await fetch(`/api/boh/table-bookings/${booking.id}`, {
        method: 'DELETE',
      })
      const payload = (await response.json()) as { error?: string }
      if (!response.ok) throw new Error(payload.error ?? 'Failed to delete booking')
    },
    'Booking deleted'
  )
  router.push('/table-bookings/boh')
}
```

- [ ] Replace the "Quick actions — coming next" placeholder in the overview tab with the real panel:

```tsx
{canEdit && (
  <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Quick actions</p>
    <div className="flex flex-wrap gap-2">
      <Button
        size="sm"
        onClick={() => void handleStatusAction('seated')}
        loading={actionLoadingKey === 'status:seated'}
        disabled={Boolean(actionLoadingKey)}
      >
        Seat guests
      </Button>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => void handleStatusAction('left')}
        loading={actionLoadingKey === 'status:left'}
        disabled={Boolean(actionLoadingKey)}
      >
        Mark left
      </Button>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => void handleStatusAction('confirmed')}
        loading={actionLoadingKey === 'status:confirmed'}
        disabled={Boolean(actionLoadingKey)}
      >
        Mark confirmed
      </Button>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => void handleStatusAction('completed')}
        loading={actionLoadingKey === 'status:completed'}
        disabled={Boolean(actionLoadingKey)}
      >
        Mark completed
      </Button>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => setPartySizeEditOpen(true)}
        disabled={Boolean(actionLoadingKey)}
      >
        Edit party size
      </Button>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => void handleCopyDepositLink()}
        disabled={Boolean(actionLoadingKey)}
      >
        Copy deposit link
      </Button>
      {canManage && (
        <>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => setNoShowConfirmOpen(true)}
            disabled={Boolean(actionLoadingKey)}
          >
            Mark no-show
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => setCancelConfirmOpen(true)}
            disabled={Boolean(actionLoadingKey)}
          >
            Cancel booking
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => setDeleteConfirmOpen(true)}
            disabled={Boolean(actionLoadingKey)}
          >
            Delete booking
          </Button>
        </>
      )}
    </div>

    {/* Move table */}
    <div className="flex flex-col gap-2 sm:flex-row pt-2 border-t border-gray-100">
      <select
        value={moveTableId}
        onChange={(e) => setMoveTableId(e.target.value)}
        disabled={loadingMoveTables || availableMoveTables.length === 0}
        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-200"
      >
        <option value="">
          {loadingMoveTables
            ? 'Loading available tables…'
            : availableMoveTables.length === 0
              ? 'No available tables'
              : 'Select table to move booking'}
        </option>
        {availableMoveTables.map((table) => (
          <option key={table.id} value={table.id}>
            {table.name}
            {table.table_number ? ` (${table.table_number})` : ''}
            {table.capacity ? ` · cap ${table.capacity}` : ''}
          </option>
        ))}
      </select>
      <Button
        size="sm"
        variant="secondary"
        loading={actionLoadingKey === 'move-table'}
        disabled={loadingMoveTables || availableMoveTables.length === 0 || Boolean(actionLoadingKey)}
        onClick={() => void handleMoveTable()}
      >
        Move
      </Button>
    </div>
  </div>
)}
```

- [ ] Add confirmation dialog and party size modal JSX after the tab content block. Import paths for `ConfirmDialog` and `Modal` come from `BohBookingsClient` — check the top of that file:

```tsx
{/* No-show confirmation */}
<ConfirmDialog
  open={noShowConfirmOpen}
  onClose={() => setNoShowConfirmOpen(false)}
  onConfirm={async () => {
    setNoShowConfirmOpen(false)
    await handleStatusAction('no_show')
  }}
  type="warning"
  title="Mark as no-show?"
  message="This may trigger a charge request for the customer."
  confirmText="Mark No-show"
  closeOnConfirm={false}
/>

{/* Cancel confirmation */}
<ConfirmDialog
  open={cancelConfirmOpen}
  onClose={() => setCancelConfirmOpen(false)}
  onConfirm={async () => {
    setCancelConfirmOpen(false)
    await handleStatusAction('cancelled')
  }}
  type="warning"
  title="Cancel this booking?"
  message="The customer will be notified."
  confirmText="Cancel Booking"
  confirmVariant="danger"
  closeOnConfirm={false}
/>

{/* Delete confirmation */}
<ConfirmDialog
  open={deleteConfirmOpen}
  onClose={() => setDeleteConfirmOpen(false)}
  onConfirm={() => void handleDeleteBooking()}
  type="danger"
  destructive
  title="Delete this booking?"
  message={`Delete booking ${booking.booking_reference ?? ''} permanently? This cannot be undone.`}
  confirmText="Delete"
/>

{/* Party size edit modal */}
<Modal
  open={partySizeEditOpen}
  onClose={() => setPartySizeEditOpen(false)}
  title="Edit party size"
  size="sm"
>
  <div className="space-y-4">
    <div>
      <label htmlFor="party-size-input" className="block text-sm font-medium text-gray-700">
        New party size
      </label>
      <input
        id="party-size-input"
        type="number"
        min={1}
        max={50}
        value={partySizeEditValue}
        onChange={(e) => setPartySizeEditValue(e.target.value)}
        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-200"
      />
    </div>
    <label className="flex items-center gap-2 text-sm text-gray-700">
      <input
        type="checkbox"
        checked={partySizeEditSendSms}
        onChange={(e) => setPartySizeEditSendSms(e.target.checked)}
        className="rounded border-gray-300 text-green-600 focus:ring-green-500"
      />
      Notify guest by SMS
    </label>
    <div className="flex justify-end gap-2">
      <Button variant="secondary" size="sm" onClick={() => setPartySizeEditOpen(false)}>
        Cancel
      </Button>
      <Button
        size="sm"
        onClick={() => void handleSubmitPartySize()}
        disabled={!partySizeEditValue || Number.parseInt(partySizeEditValue, 10) < 1}
      >
        Save
      </Button>
    </div>
  </div>
</Modal>
```

- [ ] Run `npm run lint && npm run typecheck` — fix any errors

- [ ] Test in the browser: seat a guest, cancel a booking, move a table — all should call the existing BOH API endpoints and work correctly

- [ ] Commit:

```bash
git add src/app/(authenticated)/table-bookings/[id]/BookingDetailClient.tsx
git commit -m "feat: add quick actions, move table, and confirmation dialogs to booking detail"
```

---

### Task 7: SMS tab

**Files:**
- Modify: `src/app/(authenticated)/table-bookings/[id]/BookingDetailClient.tsx`

- [ ] Add state for SMS (at the top of the component alongside other state):

```typescript
const [smsBody, setSmsBody] = useState('')
```

- [ ] Add the SMS send handler:

```typescript
async function handleSendSms() {
  const trimmed = smsBody.trim()
  if (!trimmed) {
    toast.error('Enter an SMS message before sending')
    return
  }
  await runAction(
    'send-sms',
    async () => {
      const response = await fetch(`/api/boh/table-bookings/${booking.id}/sms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed }),
      })
      const payload = (await response.json()) as { error?: string }
      if (!response.ok) throw new Error(payload.error ?? 'Failed to send SMS')
    },
    'SMS sent to guest'
  )
}
```

- [ ] Replace the `{tab === 'sms' && ...}` placeholder:

```tsx
{tab === 'sms' && (
  <div className="space-y-4 max-w-lg">
    {canEdit ? (
      <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Send SMS to guest</p>
        <textarea
          value={smsBody}
          onChange={(e) => setSmsBody(e.target.value)}
          rows={5}
          maxLength={640}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-200"
          placeholder="Type message…"
        />
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-500">{smsBody.length}/640</p>
          <Button
            size="sm"
            variant="secondary"
            loading={actionLoadingKey === 'send-sms'}
            disabled={Boolean(actionLoadingKey)}
            onClick={() => void handleSendSms()}
          >
            Send SMS
          </Button>
        </div>
      </div>
    ) : (
      <p className="text-sm text-gray-500">You do not have permission to send SMS messages.</p>
    )}
  </div>
)}
```

- [ ] Run `npm run lint && npm run typecheck` — fix any errors
- [ ] Test in browser: navigate to SMS tab, type a message, send — confirm it sends
- [ ] Commit:

```bash
git add src/app/(authenticated)/table-bookings/[id]/BookingDetailClient.tsx
git commit -m "feat: add SMS tab to booking detail page"
```

---

## Chunk 4: Pre-order Tab + BOH Navigation

### Task 8: Create `/api/boh/table-bookings/[id]/preorder` API route

**Files:**
- Create: `src/app/api/boh/table-bookings/[id]/preorder/route.ts`

- [ ] First, check how other BOH API routes are structured — open `src/app/api/boh/table-bookings/[id]/status/route.ts` to see the exact import paths and auth pattern used

- [ ] Create `src/app/api/boh/table-bookings/[id]/preorder/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { checkUserPermission } from '@/app/actions/rbac'
import {
  getSundayPreorderPageDataByBookingId,
  saveSundayPreorderByBookingId,
} from '@/lib/table-bookings/sunday-preorder'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params

  const canView = await checkUserPermission('table_bookings', 'view')
  if (!canView) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const data = await getSundayPreorderPageDataByBookingId(id)
  return NextResponse.json(data)
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params

  const canEdit = await checkUserPermission('table_bookings', 'edit')
  if (!canEdit) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = (await req.json()) as { items: { menu_dish_id: string; quantity: number }[] }

  // Check the exact signature of saveSundayPreorderByBookingId in
  // src/lib/table-bookings/sunday-preorder.ts and adjust this call to match
  const result = await saveSundayPreorderByBookingId(id, body.items)
  if (result && typeof result === 'object' && 'error' in result) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }

  return NextResponse.json({ success: true })
}
```

- [ ] Open `src/lib/table-bookings/sunday-preorder.ts` and check the actual signature of `saveSundayPreorderByBookingId` — adjust the POST handler to match exactly (the items array shape and return type may differ slightly)

- [ ] Run `npm run typecheck && npm run lint` — fix any errors

- [ ] Test the GET endpoint: start dev server, open `/api/boh/table-bookings/<a-sunday-lunch-booking-id>/preorder` in a browser (while logged in) — should return JSON with `state: 'ready'` and pre-order data

- [ ] Commit:

```bash
git add src/app/api/boh/table-bookings/[id]/preorder/route.ts
git commit -m "feat: add GET and POST /api/boh/table-bookings/[id]/preorder endpoint"
```

---

### Task 9: Pre-order tab — read view

**Files:**
- Modify: `src/app/(authenticated)/table-bookings/[id]/PreorderTab.tsx`

- [ ] Replace the stub with the full read view. Note the `Booking` type is exported from `BookingDetailClient.tsx` — import it from there:

```typescript
'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui-v2/forms/Button'  // adjust import path to match project
import toast from 'react-hot-toast'
import { formatDateInLondon } from '@/lib/dateUtils'
import type { Booking } from './BookingDetailClient'

interface PreorderItem {
  menu_dish_id: string
  custom_item_name: string | null
  item_type: 'main' | 'side' | 'extra'
  quantity: number
  price_at_booking: number
  guest_name: string | null
}

interface MenuItem {
  menu_dish_id: string
  name: string
  price: number
  category_code: string | null
  item_type: 'main' | 'side' | 'extra'
  sort_order: number
}

interface PreorderData {
  state: 'ready' | 'blocked'
  reason?: string
  can_submit?: boolean
  submit_deadline_at?: string | null
  sunday_preorder_cutoff_at?: string | null
  sunday_preorder_completed_at?: string | null
  existing_items?: PreorderItem[]
  menu_items?: MenuItem[]
}

interface Props {
  booking: Booking
  canEdit: boolean
}

export default function PreorderTab({ booking, canEdit }: Props) {
  const [data, setData] = useState<PreorderData | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/boh/table-bookings/${booking.id}/preorder`)
      if (!res.ok) throw new Error('Failed to load pre-order')
      const json = (await res.json()) as PreorderData
      setData(json)
    } catch {
      toast.error('Could not load pre-order data')
    } finally {
      setLoading(false)
    }
  }, [booking.id])

  useEffect(() => { void load() }, [load])

  if (loading) return <p className="text-sm text-gray-500">Loading pre-order…</p>

  if (!data || data.state === 'blocked') {
    return (
      <p className="text-sm text-gray-500">
        Pre-order not available{data?.reason ? `: ${data.reason}` : ''}
      </p>
    )
  }

  const itemsByType = {
    main: data.existing_items?.filter((i) => i.item_type === 'main') ?? [],
    side: data.existing_items?.filter((i) => i.item_type === 'side') ?? [],
    extra: data.existing_items?.filter((i) => i.item_type === 'extra') ?? [],
  }

  const hasItems = (data.existing_items?.length ?? 0) > 0

  if (editing) {
    return (
      <PreorderEditForm
        data={data}
        bookingId={booking.id}
        onSave={() => { setEditing(false); void load() }}
        onCancel={() => setEditing(false)}
      />
    )
  }

  return (
    <div className="space-y-4 max-w-2xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-gray-900">
            {data.sunday_preorder_completed_at ? '✓ Submitted by guest' : 'Not yet submitted'}
          </p>
          {data.sunday_preorder_cutoff_at && (
            <p className="text-xs text-gray-500 mt-0.5">
              Cutoff: {formatDateInLondon(new Date(data.sunday_preorder_cutoff_at), 'dd MMM yyyy, HH:mm')}
            </p>
          )}
        </div>
        {canEdit && (
          <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
            {hasItems ? 'Edit pre-order' : 'Create pre-order'}
          </Button>
        )}
      </div>

      {!hasItems && (
        <p className="text-sm text-gray-500 italic">No items on this pre-order yet.</p>
      )}

      {/* Mains */}
      {itemsByType.main.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Mains</p>
          {itemsByType.main.map((item) => (
            <div
              key={item.menu_dish_id}
              className="flex items-center justify-between bg-gray-50 rounded-md px-3 py-2 mb-1"
            >
              <span className="text-sm text-gray-900">
                {item.custom_item_name ?? item.menu_dish_id}
              </span>
              <span className="text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded px-2 py-0.5">
                × {item.quantity}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Sides */}
      {itemsByType.side.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Sides</p>
          {itemsByType.side.map((item) => (
            <div
              key={item.menu_dish_id}
              className="flex items-center justify-between bg-gray-50 rounded-md px-3 py-2 mb-1"
            >
              <span className="text-sm text-gray-900">
                {item.custom_item_name ?? item.menu_dish_id}
              </span>
              <span className="text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded px-2 py-0.5">
                × {item.quantity}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Extras */}
      {itemsByType.extra.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Extras</p>
          {itemsByType.extra.map((item) => (
            <div
              key={item.menu_dish_id}
              className="flex items-center justify-between bg-gray-50 rounded-md px-3 py-2 mb-1"
            >
              <span className="text-sm text-gray-900">
                {item.custom_item_name ?? item.menu_dish_id}
              </span>
              <span className="text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded px-2 py-0.5">
                × {item.quantity}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] Run `npm run typecheck && npm run lint` — fix any errors
- [ ] Test in browser: open a Sunday lunch booking, go to Pre-order tab — confirm it loads and shows items (or "not yet submitted" if none)
- [ ] Commit:

```bash
git add src/app/(authenticated)/table-bookings/[id]/PreorderTab.tsx
git commit -m "feat: add pre-order tab read view"
```

---

### Task 10: Pre-order tab — edit form

**Files:**
- Modify: `src/app/(authenticated)/table-bookings/[id]/PreorderTab.tsx`

- [ ] Add the `PreorderEditForm` component at the bottom of `PreorderTab.tsx` (before the `export default`):

```typescript
function PreorderEditForm({
  data,
  bookingId,
  onSave,
  onCancel,
}: {
  data: PreorderData
  bookingId: string
  onSave: () => void
  onCancel: () => void
}) {
  const initialQtys: Record<string, number> = {}
  data.existing_items?.forEach((item) => {
    initialQtys[item.menu_dish_id] = item.quantity
  })

  const [qtys, setQtys] = useState<Record<string, number>>(initialQtys)
  const [saving, setSaving] = useState(false)

  const menuByType = {
    main: data.menu_items?.filter((i) => i.item_type === 'main').sort((a, b) => a.sort_order - b.sort_order) ?? [],
    side: data.menu_items?.filter((i) => i.item_type === 'side').sort((a, b) => a.sort_order - b.sort_order) ?? [],
    extra: data.menu_items?.filter((i) => i.item_type === 'extra').sort((a, b) => a.sort_order - b.sort_order) ?? [],
  }

  async function handleSave() {
    setSaving(true)
    try {
      const items = Object.entries(qtys)
        .filter(([, qty]) => qty > 0)
        .map(([menu_dish_id, quantity]) => ({ menu_dish_id, quantity }))

      const res = await fetch(`/api/boh/table-bookings/${bookingId}/preorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      })

      if (!res.ok) {
        const payload = (await res.json()) as { error?: string }
        throw new Error(payload.error ?? 'Failed to save pre-order')
      }

      toast.success('Pre-order saved')
      onSave()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save pre-order')
    } finally {
      setSaving(false)
    }
  }

  function renderSection(label: string, items: MenuItem[]) {
    if (items.length === 0) return null
    return (
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">{label}</p>
        {items.map((item) => (
          <div
            key={item.menu_dish_id}
            className="flex items-center justify-between bg-gray-50 rounded-md px-3 py-2 mb-1"
          >
            <span
              className={`text-sm ${(qtys[item.menu_dish_id] ?? 0) === 0 ? 'text-gray-400' : 'text-gray-900'}`}
            >
              {item.name}
            </span>
            <input
              type="number"
              min={0}
              max={99}
              value={qtys[item.menu_dish_id] ?? 0}
              onChange={(e) =>
                setQtys((prev) => ({
                  ...prev,
                  [item.menu_dish_id]: Math.max(0, parseInt(e.target.value) || 0),
                }))
              }
              className="w-16 text-center rounded-md border border-gray-300 px-2 py-0.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-gray-900">Edit pre-order</p>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => void handleSave()} loading={saving}>
            Save changes
          </Button>
        </div>
      </div>
      {renderSection('Mains', menuByType.main)}
      {renderSection('Sides', menuByType.side)}
      {renderSection('Extras', menuByType.extra)}
    </div>
  )
}
```

- [ ] Run `npm run lint && npm run typecheck` — fix any errors
- [ ] Test the full edit flow in the browser:
  - Open a Sunday lunch booking, go to Pre-order tab
  - Click "Edit pre-order" — form should appear with all menu items and current quantities
  - Change some quantities, click Save — data should persist and read view should update
  - Click Cancel — should return to read view without saving
- [ ] Commit:

```bash
git add src/app/(authenticated)/table-bookings/[id]/PreorderTab.tsx
git commit -m "feat: add pre-order edit form to pre-order tab"
```

---

### Task 11: Update BOH Manage button to navigate, remove modal

**Files:**
- Modify: `src/app/(authenticated)/table-bookings/boh/BohBookingsClient.tsx`

- [ ] Ensure `useRouter` is imported and `const router = useRouter()` is present in the component (check if it's already there — if not, add both)

- [ ] Find the Manage button (~line 1172) and replace the `onClick` handler:

```typescript
// Before:
onClick={() => {
  setSelectedBookingId(booking.id)
  setMoveTableId('')
  setSmsBody('')
  setLastInteractionAtMs(Date.now())
}}

// After:
onClick={() => router.push(`/table-bookings/${booking.id}`)}
```

- [ ] Remove all the following `useState` declarations (they are no longer needed in BOH — they move to the detail page):
  - `selectedBookingId` / `setSelectedBookingId`
  - `moveTableId` / `setMoveTableId`
  - `availableMoveTables` / `setAvailableMoveTables`
  - `loadingMoveTables` / `setLoadingMoveTables` — **Note:** check if `loadingMoveTables` is also used outside the modal (e.g. in the main table list); if it is used elsewhere in the BOH table render, keep it and only remove the modal-specific usage
  - `smsBody` / `setSmsBody`
  - `lastInteractionAtMs` / `setLastInteractionAtMs`
  - `deleteConfirmOpen` / `setDeleteConfirmOpen`
  - `deleteConfirmBookingId` / `setDeleteConfirmBookingId`
  - `partySizeEditOpen` / `setPartySizeEditOpen`
  - `partySizeEditValue` / `setPartySizeEditValue`
  - `partySizeEditSendSms` / `setPartySizeEditSendSms`
  - `noShowConfirmOpen` / `setNoShowConfirmOpen`
  - `cancelConfirmOpen` / `setCancelConfirmOpen`

- [ ] Remove the `selectedBooking` derived value (`useMemo`)

- [ ] Remove the `closeSelectedBookingModal` function

- [ ] Remove all handler functions that referenced `selectedBooking`:
  `handleStatusAction`, `handleMoveTable`, `handleSendSms`, `handlePartySizeEdit`, `handleDeleteBooking`, `openPartySizeEdit`, `loadAvailableMoveTables`, `runAction`, and any `useEffect` that called `loadAvailableMoveTables`

- [ ] Remove the `<Modal>` JSX block and all its contents (the large block starting ~line 1194)

- [ ] Remove any imports that are now unused (the modal component import, any action-specific hooks)

- [ ] Run `npm run lint && npm run typecheck` — fix any remaining references to removed state/functions

- [ ] Test: click Manage on any BOH booking row — should navigate to `/table-bookings/<id>`. Use the browser back button to return to BOH.

- [ ] Commit:

```bash
git add src/app/(authenticated)/table-bookings/boh/BohBookingsClient.tsx
git commit -m "feat: update BOH Manage button to navigate to booking detail page, remove modal"
```

---

## Final Verification

- [ ] `npm run build` — production build must succeed with zero errors
- [ ] `npm run lint` — zero warnings
- [ ] `npm run typecheck` — clean

**Manual smoke test checklist:**
- [ ] FOH: Navigate to the FOH schedule on a Sunday with sunday_lunch bookings — green left borders on bookings with pre-orders submitted, amber on those without
- [ ] FOH: Confirm non-sunday-lunch bookings have no border change
- [ ] BOH: Click Manage on any booking — navigates to `/table-bookings/<id>`
- [ ] Detail page: All three tabs render (Overview, Pre-order only on sunday_lunch bookings, SMS)
- [ ] Detail page > Overview: Status strip, guest info, notes, quick actions all visible
- [ ] Detail page > Overview: Seat and Cancel actions work (hit existing API endpoints)
- [ ] Detail page > Overview: Pre-order banner visible on sunday_lunch bookings, clicking it switches to Pre-order tab
- [ ] Detail page > Pre-order: Data loads, items displayed grouped by type
- [ ] Detail page > Pre-order: Edit form opens, quantities editable, save persists changes
- [ ] Detail page > Pre-order: Cancel in edit form returns to read view unchanged
- [ ] Detail page > SMS: Send a message — confirm it sends successfully
- [ ] Back button on detail page returns to BOH
