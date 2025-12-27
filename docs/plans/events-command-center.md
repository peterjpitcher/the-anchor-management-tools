# Event Command Center: /events Redesign

Status: Proposal
Owner: TBD
Last updated: 2025-12-27

## Summary
Rebuild the `/events` page into a "Command Center" dashboard focused on fast operations: KPI-first header, action-ready event cards, and a compact checklist assistant. This design keeps all existing data tables and permissions intact while shifting calculations server-side and delivering a more modern, premium UI.

## Goals
- Provide immediate visibility into event performance and operational risk.
- Reduce clicks for core actions (edit, check-in, promote).
- Keep the interface fluid on desktop and mobile with sensible defaults.
- Centralize business logic on the server and send ready-to-render view models.

## Non-goals
- No database schema changes or migrations.
- No changes to public event pages or booking flows.
- No rewrite of event detail or check-in screens.
- No removal of existing list or checklist pages.

## Constraints and Assumptions
- Data sources are `events`, `bookings`, `event_categories`, `event_checklist_statuses` only.
- Permissions follow existing roles: `events:view` to load, `events:manage` to edit/toggle tasks.
- Unlimited capacity is represented by `capacity = null`.
- Free events are represented by `is_free = true` or `price = 0`.
- **Price Handling**: Events have a simple `price` column. Revenue estimates will use this single price point multiplied by booked seats.

## User Stories
- As a manager, I can see which upcoming events are at risk without opening each event.
- As a door lead, I can jump to check-in mode in one click.
- As a marketer, I can quickly share or copy a promotion link.
- As an operator, I can clear urgent checklist items immediately.

## UX Principles
- Visual first: use hero imagery for scanning and recognition.
- Action oriented: primary actions are one click away.
- Insight driven: key KPIs are visible without drilling.
- Fluid: optimistic updates and snappy transitions.

## Layout Architecture

### A. KPI Header (Hero Section)
Display metrics for the next 30 days. Cards should be compact, high contrast, and scan-friendly.

- **Active Events**: count of upcoming events in the window.
- **Ticket Velocity**: seats sold in last 24h over total upcoming capacity (excluding null capacity).
- **Urgent Attention**: overdue checklist items plus events with 0 bookings within X days.
- **Revenue Estimate**: `sum(booked_seats * price)` in the window, price defaults to 0 if free.

### B. Control Bar
A compact toolbar that separates stats from content.

- View toggles: Grid | Calendar | List.
- Smart filters: All | Selling Fast | Attention Needed.
- Search: real-time filter by name or performer.
- Primary action: "New Event" with a secondary "Template Event" option.

### C. Main View (Grid Mode - Default)
A responsive grid of rich event cards.

Each card includes:
- Hero image header from `hero_image_url` (or `poster_image_url` fallback).
- Fallback gradient if image missing (based on category color).
- Status badge (Sold Out, Selling Fast, Cancelled, etc.).
- Title and relative date/time (e.g., "Tomorrow at 7pm").
- Capacity progress bar (color-coded by status).
- Checklist ring showing completion ratio.
- Hover actions: Check-in, Edit, Promote.

### D. Intelligent Sidebar (Collapsible)
A focused checklist assistant.

- Focus Mode: overdue and due-today items only.
- Grouped view: Marketing vs Operations tasks.
- Context aware: selecting a card filters tasks to that event.

## KPI and Status Definitions

### Date Window
Default window is 30 days ahead of today (local time).

### Active Events
Count of events where `date` is between today and today + 30 days and `event_status` is not cancelled.

### Ticket Velocity
```sql
-- Conceptual query logic
last24hSeats = sum(bookings.seats)
  JOIN events ON bookings.event_id = events.id
  WHERE bookings.created_at >= (now() - interval '24 hours')
  AND events.date BETWEEN today AND (today + interval '30 days')

capacityTotal = sum(events.capacity)
  WHERE events.date BETWEEN today AND (today + interval '30 days')
  AND events.capacity IS NOT NULL

velocityPercent = capacityTotal > 0 ? (last24hSeats / capacityTotal) : null
```
If `capacityTotal` is 0, show "N/A" and display only `last24hSeats`.

### Urgent Attention
```ts
overdueChecklistCount = count(checklist items with status = overdue)
zeroBookingCloseCount = count(events where booked_seats = 0 and date <= today + 7d)
urgentAttention = overdueChecklistCount + zeroBookingCloseCount
```

### Revenue Estimate
```ts
revenueEstimate = sum(booked_seats * (event.price || 0))
  where event.date in [today, today + 30d]
```
Use `£` (GBP) as the default currency label.

### Event Status Badge
Priority order:
1. Cancelled/Postponed/Rescheduled from `event_status`.
2. Sold Out if `capacity` is not null and `booked_seats >= capacity`.
3. Selling Fast if `capacity` is not null and `booked_seats / capacity >= 0.8`.
4. Low Bookings if `booked_seats = 0` and event is within 7 days.
5. On Track default.

## Filters and Sorting
- Default sort: date asc, time asc.
- Selling Fast: events with capacity ratio >= 0.8 or last24hSeats >= threshold.
- Attention Needed: events with overdue tasks or zero bookings within 7 days.
- Search fields: `name`, `performer_name`, `slug`.

## View Model (Server Output)
```ts
type EventOverview = {
  id: string
  name: string
  date: string
  time: string
  daysUntil: number
  capacity: number | null
  bookedSeats: number
  price: number | null
  isFree: boolean
  category: { id: string; name: string; color: string } | null
  heroImageUrl: string | null
  posterImageUrl: string | null
  eventStatus: string | null
  checklist: {
    completed: number
    total: number
    overdueCount: number
    dueTodayCount: number
    nextTask: EventChecklistItem | null
    outstanding: EventChecklistItem[]
  }
  statusBadge: {
    label: string
    tone: 'success' | 'warning' | 'error' | 'info'
  }
}

type EventsOverviewResult = {
  kpis: {
    activeEvents: number
    last24hSeats: number
    velocityPercent: number | null
    urgentAttention: number
    revenueEstimate: number
  }
  upcoming: EventOverview[]
  past: EventOverview[] // Limited to recent past (e.g. 7 days) if needed
  todos: ChecklistTodoItem[]
  error?: string
}
```

## Data Fetching Strategy
- All calculations occur server-side.
- Parallel loading in `page.tsx` using `Promise.all`.
- `Suspense` boundaries for KPI header and main grid can be added for granular loading if queries become slow, but initial fetch should be unified for consistency.

### Queries
1. **Main Events Query**:
   Fetch `events` with `bookings(sum:seats)` and `event_categories`.
   Range: `date >= today`.
2. **Velocity Query**:
   Fetch `bookings(seats)` where `created_at >= 24h ago`.
   Join `events` to ensure only bookings for *upcoming* events are counted (optional, or just count all recent sales velocity). A precise separate query or a filtered join is best.
3. **Checklist Statuses**:
   Fetch `event_checklist_statuses` for the retrieved event IDs.

### Caching
- Optional `unstable_cache` with tags `events`, `bookings`, `event-checklist`.
- Revalidate via existing `revalidatePath('/events')` and `revalidatePath('/events/[id]')`.

## Component Architecture
```
src/app/(authenticated)/events/page.tsx
  - EventsCommandCenter (server wrapper)
    - KPIHeader (server props)
    - CommandCenterShell (client state: filters, search, view mode)
      - ControlBar
      - EventGrid | EventList
        - EventCard
          - StatusBadge
          - ChecklistRing
      - TaskSidebar (collapsible)
```

### Notes
- **Grid and List Parity**: Both views share `EventOverview` model. List view provides a denser alternative for power users.
- **Calendar Support**: Calendar view can reuse `src/components/ui-v2/display/Calendar.tsx` but requires adaptation to consume `EventOverview`.
- **Checklist Actions**: use `src/actions/event-checklist.ts` for toggling items.

## Interaction and State
- **URL State**: Store view mode (`?view=grid`) and tabs (`?tab=upcoming`) in URL search params for shareability.
- **Optimistic UI**: Use `useOptimistic` for checklist toggles to ensure immediate feedback.
- **Search**: Client-side filtering is acceptable for < 500 events. If dataset grows, move to server-side search params.

## Accessibility
- All actions reachable via keyboard.
- Card actions use visible focus rings.
- Ensure badge text contrast meets WCAG AA.
- Provide alt text for hero images (event name).

## Error Handling
- If event list fails, show alert and empty state.
- If checklist statuses fail, show warning but keep events list.
- KPI header should handle missing data and show "N/A" gracefully.

## Implementation Phases
1. **Data Layer**: Create `getEventsCommandCenterData()` server function with the new velocity and revenue logic.
2. **Components**: Build `KPIHeader`, `EventCard`, and `CommandCenterShell`.
3. **Integration**: Replace `EventsClient` with `CommandCenterShell` in `page.tsx`.
4. **Refinement**: Add "Template Event" logic (likely just linking to `/events/new?template=...` or duplicating an ID).
5. **QA**: Test on mobile and verify "Selling Fast" logic.

## Open Questions Resolved
- **Close to date threshold**: defined as 7 days.
- **Currency**: GBP (£) derived from system defaults.
- **Template Event**: For now, this can be a "Duplicate" action on existing events or a specific "Create from Template" flow if templates exist in DB. MVP: Duplicate action.
- **Cancelled Events**: Excluded from "Active Events" count but visible in list/grid with "Cancelled" badge.
