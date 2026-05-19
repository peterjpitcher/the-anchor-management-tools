---
phase: quick
plan: 260519-ice
type: execute
wave: 1
depends_on: []
files_modified:
  - src/app/(authenticated)/events/[id]/page.tsx
  - src/app/(authenticated)/events/[id]/EventDetailClient.tsx
  - src/app/(authenticated)/events/_components/EventsClient.tsx
  - src/app/actions/events.ts
autonomous: true
requirements: [restore-event-detail-page]

must_haves:
  truths:
    - "Clicking an event row in list/calendar/board navigates to /events/[id]"
    - "Event detail page shows full metadata (name, date, times, slug, brief, booking URL, performer, hero image, capacity)"
    - "Event detail page shows attendees table with name, phone, seats, status, created date"
    - "Staff can add manual bookings from the detail page (customer search, name, phone, seats)"
    - "Staff can edit seat count and cancel bookings from the attendees table"
    - "Marketing Links, Promotion Content, and Checklist cards render on the detail page"
    - "New Event button still opens the drawer (drawer is NOT removed)"
  artifacts:
    - path: "src/app/(authenticated)/events/[id]/page.tsx"
      provides: "Server component with auth, permission check, data fetch"
    - path: "src/app/(authenticated)/events/[id]/EventDetailClient.tsx"
      provides: "Full event detail UI with overview, attendees, marketing tabs"
  key_links:
    - from: "src/app/(authenticated)/events/_components/EventListView.tsx"
      to: "/events/[id]"
      via: "onEventClick triggers router.push"
      pattern: "router\\.push.*events/"
    - from: "src/app/(authenticated)/events/[id]/page.tsx"
      to: "src/app/actions/events.ts"
      via: "getEventById + getEventBookings"
      pattern: "getEventById|getEventBookings"
    - from: "src/app/(authenticated)/events/[id]/EventDetailClient.tsx"
      to: "src/components/features/events/"
      via: "Mounts EventMarketingLinksCard, EventPromotionContentCard, EventChecklistCard"
      pattern: "EventMarketingLinksCard|EventPromotionContentCard|EventChecklistCard"
---

<objective>
Restore the events detail page that was deleted in commit 1008f294. Build a new server component + client component pair following the private-bookings detail page pattern. Mount the three existing feature cards (Marketing Links, Promotion Content, Checklist) that are already fully built. Change list/calendar/board event clicks to navigate to /events/[id] instead of opening the drawer (keep drawer for "New Event" only).

Purpose: Staff need to view full event details, manage attendees, and access marketing tools from a dedicated page.
Output: Working event detail page at /events/[id] with overview, attendees, and marketing sections.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-plan.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@CLAUDE.md

@src/app/(authenticated)/private-bookings/[id]/page.tsx
@src/app/(authenticated)/events/_components/EventsClient.tsx
@src/app/(authenticated)/events/_components/EventListView.tsx
@src/app/actions/events.ts
@src/app/actions/event-marketing-links.ts
@src/app/actions/event-content.ts
@src/types/database.ts
@src/components/features/events/EventMarketingLinksCard.tsx
@src/components/features/events/EventPromotionContentCard.tsx
@src/components/features/events/EventChecklistCard.tsx

<interfaces>
<!-- Key types and contracts the executor needs -->

From src/types/database.ts:
```typescript
export interface Event {
  id: string; name: string; date: string; time: string; capacity: number | null;
  payment_mode?: 'free' | 'cash_only' | 'prepaid' | null;
  booking_mode?: 'table' | 'general' | 'mixed' | null;
  event_type?: string | null; category_id?: string | null; created_at: string;
  end_time?: string | null; event_status?: string | null;
  performer_name?: string | null; performer_type?: string | null;
  price?: number | null; price_per_seat?: number | null; is_free?: boolean | null;
  booking_url?: string | null; slug: string; short_description?: string | null;
  long_description?: string | null; highlights?: string[] | null;
  hero_image_url?: string | null; doors_time?: string | null;
  duration_minutes?: number | null; last_entry_time?: string | null;
  brief?: string | null; facebook_event_name?: string | null;
  facebook_event_description?: string | null; gbp_event_title?: string | null;
  gbp_event_description?: string | null; promo_sms_enabled?: boolean;
  bookings_enabled?: boolean;
}

export interface Booking {
  id: string; customer_id: string; event_id: string;
  seats: number | null; is_reminder_only: boolean;
  notes: string | null; created_at: string;
  customer?: Customer; event?: Event;
}
```

From src/app/actions/events.ts:
```typescript
export async function getEventById(eventId: string): Promise<{ data?: Event | null, error?: string }>
export async function createEventManualBooking(input: {
  eventId: string; phone: string; seats: number;
  defaultCountryCode?: string; firstName?: string; lastName?: string;
}): Promise<EventManualBookingResult>
export async function updateEventManualBookingSeats(input: { ... }): Promise<...>
export async function cancelEventManualBooking(input: { ... }): Promise<...>
```

From src/app/actions/event-marketing-links.ts:
```typescript
export type { EventMarketingLink }
export async function generateEventMarketingLinks(eventId: string): Promise<EventMarketingLinksResult>
export async function getEventMarketingLinks(eventId: string): Promise<EventMarketingLinksResult>
export async function regenerateEventMarketingLinks(eventId: string): Promise<EventMarketingLinksResult>
export async function generateSingleMarketingLink(eventId: string, ...): Promise<...>
```

Component props:
```typescript
// EventMarketingLinksCard
{ links: EventMarketingLink[]; loading?: boolean; error?: string | null;
  onRegenerate?: () => Promise<void>; eventId: string;
  onLinkGenerated: (link: EventMarketingLink) => void }

// EventPromotionContentCard
{ eventId: string; eventName: string; initialTicketUrl?: string | null;
  brief?: string | null; marketingLinks?: EventMarketingLink[];
  facebookName?: string | null; facebookDescription?: string | null;
  googleTitle?: string | null; googleDescription?: string | null }

// EventChecklistCard
{ eventId: string; eventName: string; className?: string }
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add getEventBookings action + build server page</name>
  <files>src/app/actions/events.ts, src/app/(authenticated)/events/[id]/page.tsx</files>
  <action>
**1a. Add `getEventBookings` server action to `src/app/actions/events.ts`:**

Add a new exported async function `getEventBookings(eventId: string)` that:
- Requires `checkUserPermission('events', 'view')` (follow existing permission patterns in the file)
- Uses `createAdminClient()` to query the `bookings` table:
  ```
  .from('bookings')
  .select('id, customer_id, event_id, seats, is_reminder_only, notes, created_at, status, customer:customers(id, first_name, last_name, mobile_number, email)')
  .eq('event_id', eventId)
  .order('created_at', { ascending: false })
  ```
- Returns `Promise<{ data?: EventBookingRow[], error?: string }>` where `EventBookingRow` is a new type defined at the top of the file:
  ```typescript
  export type EventBookingRow = {
    id: string
    customer_id: string
    event_id: string
    seats: number | null
    is_reminder_only: boolean
    notes: string | null
    created_at: string
    status?: string | null
    customer?: {
      id: string
      first_name: string | null
      last_name: string | null
      mobile_number: string | null
      email: string | null
    } | null
  }
  ```
- Wraps in try/catch, logs errors with logger.error, returns `{ error: string }` on failure

**1b. Replace redirect in `src/app/(authenticated)/events/[id]/page.tsx`:**

Follow the `private-bookings/[id]/page.tsx` pattern exactly:
- `export const dynamic = 'force-dynamic'`
- `interface PageProps { params: Promise<{ id: string }> }`
- Resolve params, get ID, call `notFound()` if missing
- Call `getCurrentUserModuleActions('events')` for permissions
- Extract `canView`, `canEdit`, `canDelete`, `canManage` from actions set (check for 'view', 'edit', 'delete', 'manage')
- If not authenticated, `redirect('/login')`; if no view permission, `redirect('/unauthorized')`
- Call `getEventById(eventId)` -- if error contains 'permission' redirect to /unauthorized, if 'not found' call `notFound()`, otherwise push to errors array
- Call `getEventBookings(eventId)` to load bookings (non-fatal if fails)
- Call `getEventMarketingLinks(eventId)` to load marketing links (non-fatal if fails)
- Render `<EventDetailClient>` passing: `event`, `bookings`, `marketingLinks`, `permissions: { canEdit, canDelete, canManage }`, `initialError`
- Import EventDetailClient from `./EventDetailClient`
  </action>
  <verify>
    <automated>cd /Users/peterpitcher/Cursor/OJ-AnchorManagementTools && npx tsc --noEmit 2>&1 | head -30</automated>
  </verify>
  <done>Server page fetches event + bookings + marketing links and renders EventDetailClient; getEventBookings action exists and works</done>
</task>

<task type="auto">
  <name>Task 2: Build EventDetailClient with overview, attendees, and marketing sections</name>
  <files>src/app/(authenticated)/events/[id]/EventDetailClient.tsx</files>
  <action>
Create `src/app/(authenticated)/events/[id]/EventDetailClient.tsx` as a `'use client'` component.

**Props interface:**
```typescript
interface EventDetailClientProps {
  event: Event | null
  bookings: EventBookingRow[]
  marketingLinks: EventMarketingLink[]
  permissions: { canEdit: boolean; canDelete: boolean; canManage: boolean }
  initialError: string | null
}
```

**Layout:** Use `Tabs` from `@/ds` with three tabs: "Overview", "Attendees", "Marketing".

**Header section** (always visible above tabs):
- Back button (`<Button variant="ghost">` with left arrow icon) linking to `/events`
- Event name as page title
- Status badge (use same `getStatusTone` logic from EventListView), category badge, price badge (free/paid)
- Edit button (if `canEdit`) linking to drawer or inline -- use `<Button>` with edit icon
- Use `PageHeader` from `@/ds` if it fits, otherwise a custom flex header

**Overview tab:**
- **Event metadata card** using `Card` from `@/ds`:
  - Slug with copy-to-clipboard button (pattern: `navigator.clipboard.writeText()` + `toast.success('Copied')`)
  - Brief with copy-to-clipboard
  - Booking URL with copy-to-clipboard (construct from `process.env.NEXT_PUBLIC_APP_URL` or show `event.booking_url`)
  - Performer name and type
  - Doors time, end time, last entry time (format with `formatDateInLondon` from `@/lib/dateUtils`)
  - Hero image thumbnail if `event.hero_image_url` exists (`<img>` tag with rounded corners)
  - Date and time prominently displayed
- **Bookings summary card** using `Card`:
  - Active bookings count (filter bookings where status !== 'cancelled')
  - Total seats booked (sum of seats from active bookings)
  - Capacity percentage (total seats / event.capacity * 100, show "-" if no capacity)
  - Estimated revenue (active seats * event.price, show "-" if free/no price)

**Attendees tab:**
- **Manual booking form** (only if `canManage`):
  - Phone input (required), first name (optional), last name (optional), seats number input (default 1, min 1, max 20)
  - Submit button calls `createEventManualBooking` from `@/app/actions/events`
  - On success: toast success, refresh bookings by calling `getEventBookings` and updating state
  - On error: toast error with message
- **Show/hide cancelled toggle** using a Checkbox or simple button toggle
- **Bookings table** using `Table, TableHeader, TableBody, TableRow, TableHead, TableCell` from `@/ds`:
  - Columns: Name (first + last from customer join), Phone (customer.mobile_number), Seats, Status (Badge), Created (formatDateInLondon), Actions
  - Actions column (if `canManage`):
    - Edit seats: inline number input or small modal, calls `updateEventManualBookingSeats`
    - Cancel: confirmation dialog, calls `cancelEventManualBooking`
  - Filter out cancelled bookings unless show-cancelled toggle is on
  - Empty state if no bookings

**Marketing tab:**
- Mount `EventMarketingLinksCard` from `@/components/features/events/EventMarketingLinksCard`:
  - Pass `links={marketingLinks}`, `eventId={event.id}`
  - `onRegenerate` calls `regenerateEventMarketingLinks` and updates state
  - `onLinkGenerated` appends to links state
- Mount `EventPromotionContentCard` from `@/components/features/events/EventPromotionContentCard`:
  - Pass `eventId`, `eventName`, `brief`, `marketingLinks`, `facebookName`, `facebookDescription`, `googleTitle`, `googleDescription` from event fields
- Mount `EventChecklistCard` from `@/components/features/events/EventChecklistCard`:
  - Pass `eventId`, `eventName`

**State management:**
- `useState` for bookings list (initialized from props, refreshed after mutations)
- `useState` for marketing links (initialized from props, updated on generate/regenerate)
- `useState` for showCancelled toggle (default false)
- `useTransition` for mutation loading states
- All dates formatted with `formatDateInLondon` from `@/lib/dateUtils`
- All toasts via `toast` from `@/ds`
- Currency formatting: `new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' })`
  </action>
  <verify>
    <automated>cd /Users/peterpitcher/Cursor/OJ-AnchorManagementTools && npx tsc --noEmit 2>&1 | head -30</automated>
  </verify>
  <done>EventDetailClient renders all three tabs with overview metadata, attendees table with CRUD, and mounted marketing components</done>
</task>

<task type="auto">
  <name>Task 3: Wire EventsClient to navigate to detail page on event click</name>
  <files>src/app/(authenticated)/events/_components/EventsClient.tsx</files>
  <action>
Modify `src/app/(authenticated)/events/_components/EventsClient.tsx`:

1. Add `import { useRouter } from 'next/navigation'` at the top
2. Add `const router = useRouter()` inside the component
3. Change `handleEventClick` from:
   ```typescript
   const handleEventClick = useCallback((event: Event) => {
     setActiveEvent(event)
     setDrawerOpen(true)
   }, [])
   ```
   To:
   ```typescript
   const handleEventClick = useCallback((event: Event) => {
     router.push(`/events/${event.id}`)
   }, [router])
   ```
4. Keep `handleNewEvent` unchanged (still opens drawer with `setActiveEvent(null)`)
5. Keep the EventDrawer component rendered (it is still used for creating new events)
6. Verify that "New Event" button still opens the drawer correctly

This is a minimal, surgical change -- only the click handler changes. The drawer, filters, views, and all other functionality remain untouched.
  </action>
  <verify>
    <automated>cd /Users/peterpitcher/Cursor/OJ-AnchorManagementTools && npm run lint 2>&1 | tail -5 && npx tsc --noEmit 2>&1 | head -20</automated>
  </verify>
  <done>Clicking an event row in list/calendar/board views navigates to /events/[id]; "New Event" button still opens the drawer</done>
</task>

</tasks>

<verification>
```bash
# Full verification pipeline
cd /Users/peterpitcher/Cursor/OJ-AnchorManagementTools
npm run lint 2>&1 | tail -5
npx tsc --noEmit 2>&1 | tail -10
npm run build 2>&1 | tail -10
```
</verification>

<success_criteria>
- /events/[id] renders event detail page with overview, attendees, marketing tabs
- Event metadata (name, date, times, slug, brief, booking URL, performer, hero image) all displayed
- Bookings table shows guest name, phone, seats, status, created date
- Manual booking form creates bookings via createEventManualBooking action
- Edit seats and cancel booking actions work from attendees table
- EventMarketingLinksCard, EventPromotionContentCard, EventChecklistCard all render in marketing tab
- Clicking event in list/calendar/board navigates to /events/[id]
- "New Event" button still opens creation drawer
- lint + typecheck + build all pass
</success_criteria>

<output>
After completion, create `.planning/quick/260519-ice-restore-events-detail-page-with-attendee/260519-ice-SUMMARY.md`
</output>
