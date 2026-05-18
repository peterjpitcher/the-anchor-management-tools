# Feature Landscape

**Domain:** Venue management system — 6 new full-stack sections for AMS UI Redesign
**Researched:** 2026-05-18
**Overall confidence:** HIGH (all 6 sections have existing backend implementations to audit)

---

## Critical Finding: Most Backends Already Exist

Every one of the 6 "new" sections already has database tables, types, server actions, and services in production. The redesign work is primarily **UI rebuild to match the design handoff**, not greenfield backend development. The tables below document what exists vs what the design screens require.

---

## 1. Events (Venue Event Management)

### Existing Backend (Production)

**Tables:** `events`, `event_categories`, `event_faqs`, `event_images`, `event_checklist_statuses`, `event_bookings` (managed via stored procedures), `analytics_events`, `booking_holds`

**Server Actions (6 files):**
- `events.ts` — CRUD (`createEvent`, `updateEvent`, `deleteEvent`, `getEvents`, `getEventById`), manual bookings (`createEventManualBooking`, `updateEventManualBookingSeats`, `cancelEventManualBooking`)
- `event-categories.ts` — category CRUD with defaults
- `event-checklist.ts` — pre-event task tracking
- `event-content.ts` — content/SEO field management
- `event-images.ts` — image upload and gallery management
- `event-marketing-links.ts` — auto-generated short links per event

**Services:** `EventService` (search, CRUD, recurring), `EventBookingService`, `EventCategoryService`, `EventMarketingService`

**Integrations:** Google Calendar sync, Stripe payments, Twilio SMS (promo, cancellation, rescheduled), short link generation per event

### What the Design Adds (UI Only)

| View | Status | Complexity | Notes |
|------|--------|------------|-------|
| Calendar view (month/week) | NEW UI | Medium | Needs date-based query; data exists via `getEvents({ from, to })` |
| List view with filters | EXISTS | Low | Current page has list; redesign to match handoff |
| Board/Kanban view (by status) | NEW UI | Medium | Group existing events by `event_status`; no new data needed |
| Event detail with tabs | EXISTS | Low | Current `EventDetailClient.tsx`; redesign tabs |
| Create/edit event modal/page | EXISTS | Low | Current form exists; redesign to match handoff |
| Category management | EXISTS | Low | Current page exists |
| Checklist management | EXISTS | Low | Current page exists |
| Stats bar (upcoming, this week, capacity) | NEW UI | Low | Aggregate query on existing data |

### Required New Backend Work

None. All data models, actions, and services are production-ready. The only backend work would be:
- Adding a `getEventsForCalendar(month, year)` query variant if the existing `getEvents` with date filters is insufficient
- Adding an aggregate stats query for the stats bar KPIs

### Dependencies on Existing Features

| Dependency | Direction | Notes |
|------------|-----------|-------|
| Customers | Events -> Customers | Event bookings link to `customer_id` |
| Short Links | Events -> Short Links | Auto-generated marketing links per event |
| Google Calendar | Events -> Integration | Sync to external calendar |
| Stripe | Events -> Integration | Ticket payments |
| SMS/Twilio | Events -> Integration | Promo and notification SMS |

---

## 2. Performers (Entertainment Act Directory)

### Existing Backend (Production)

**Tables:** `performer_submissions`

**Columns:** `id`, `full_name`, `email`, `phone`, `bio`, `source`, `status` (enum: `new`, `shortlisted`, `contacted`, `booked`, `not_a_fit`, `do_not_contact`), `consent_data_storage`, `internal_notes`, `submitted_ip`, `user_agent`, `created_at`, `updated_at`

**Server Actions:** `performer-submissions.ts` — `updatePerformerSubmission` (status + notes update)

**Public API:** `POST /api/external/performer-interest` — public submission endpoint

**UI Pages:** `performers/page.tsx` (list), `performers/[id]/page.tsx` (detail with `performer-submission-client.tsx`)

**RBAC:** `performers` module registered with `edit` action

### What the Design Requires

| Feature | Status | Complexity | Notes |
|---------|--------|------------|-------|
| Performer directory list with search/filter | EXISTS (partial) | Low | Current page exists; redesign layout |
| Performer detail with status pipeline | EXISTS (partial) | Low | Current detail page exists |
| Genre/category tagging | NEEDS TABLE CHANGE | Medium | No `genre` column exists; `performer_type` on events is free-text |
| Fee range tracking | NEEDS TABLE CHANGE | Low | No fee columns on `performer_submissions` |
| Rating/review system | NEEDS NEW TABLE | Medium | No rating table exists |
| Booking history (link to events) | NEEDS TABLE CHANGE | Medium | No `performer_id` FK on `events`; currently free-text `performer_name` |
| Availability calendar | NEEDS NEW TABLE | High | No availability tracking exists |
| Media gallery (photos, videos, social links) | NEEDS TABLE CHANGE | Medium | No media columns beyond `bio` |
| Contact log | NEEDS NEW TABLE | Medium | No structured contact history |

### Required New Backend Work

**Table changes to `performer_submissions` (or rename to `performers`):**

| Column | Type | Purpose |
|--------|------|---------|
| `stage_name` | `text` | Display name vs legal name |
| `genres` | `text[]` | Genre tags (array for multi-genre) |
| `fee_min` | `integer` | Minimum fee in pence |
| `fee_max` | `integer` | Maximum fee in pence |
| `website_url` | `text` | Portfolio/website |
| `social_links` | `jsonb` | `{ instagram, facebook, youtube, spotify }` |
| `photo_urls` | `text[]` | Gallery images |
| `video_urls` | `text[]` | Performance videos |
| `average_rating` | `numeric(2,1)` | Cached average (computed) |
| `total_bookings` | `integer` | Cached count (computed) |

**New tables:**

| Table | Key Columns | Purpose |
|-------|-------------|---------|
| `performer_ratings` | `id`, `performer_id`, `event_id`, `rated_by`, `score (1-5)`, `comments`, `created_at` | Post-event ratings |
| `performer_contact_log` | `id`, `performer_id`, `contacted_by`, `contact_method`, `notes`, `contacted_at` | Outreach history |

**FK addition:** Add `performer_id` (nullable FK to `performer_submissions`) on `events` table to replace free-text `performer_name`

**New server actions needed:**
- `createPerformer` — full profile creation (not just submission)
- `deletePerformer` — soft delete or archive
- `ratePerformer` — post-event rating
- `logPerformerContact` — contact history entry
- `getPerformerBookingHistory` — query events by performer_id
- `getPerformerStats` — aggregate ratings, booking count

### Dependencies on Existing Features

| Dependency | Direction | Notes |
|------------|-----------|-------|
| Events | Performers -> Events | `performer_id` FK on events; booking history |
| Public API | External -> Performers | Existing submission endpoint |

---

## 3. Cashing Up (Daily Till Reconciliation)

### Existing Backend (Production)

**Tables:** `cashup_sessions`, `cashup_payment_breakdowns`, `cashup_cash_counts`, `cashup_targets`, `cashup_target_overrides`, `sites`

**Types:** Full type system in `src/types/cashing-up.ts` — `CashupSession`, `CashupPaymentBreakdown`, `CashupCashCount`, `CashupWeeklyView`, `CashupDashboardStats`, `CashupDashboardData`, `CashupInsightsData`

**Statuses:** `draft -> submitted -> approved -> locked`

**Server Actions (13 functions):**
- Session lifecycle: `upsertSessionAction`, `submitSessionAction`, `approveSessionAction`, `lockSessionAction`, `unlockSessionAction`, `getSessionByIdAction`
- Weekly/dashboard: `getWeeklyDataAction`, `getDashboardDataAction`, `getInsightsDataAction`, `getWeeklyProgressAction`
- Targets: `getDailyTargetAction`, `setDailyTargetAction`, `updateWeeklyTargetsAction`

**Service:** `CashingUpService` class

**UI Pages:** `daily/`, `weekly/`, `dashboard/`, `insights/`, `import/`

**RBAC:** `cashing_up` module registered

### What the Design Requires

| Feature | Status | Complexity | Notes |
|---------|--------|------------|-------|
| Daily entry form (denominations + payment types) | EXISTS | Low | Redesign existing form |
| Weekly summary grid | EXISTS | Low | Redesign existing view |
| Dashboard with KPI stats | EXISTS | Low | Redesign charts/stats |
| Insights (day-of-week, payment mix, growth) | EXISTS | Low | All data queries exist |
| Target setting (daily/weekly) | EXISTS | Low | Actions exist |
| Import from external source | EXISTS | Low | Import page exists |
| Approval workflow (submit -> approve -> lock) | EXISTS | Low | Full lifecycle in actions |
| Variance alerts/highlighting | EXISTS | Low | Data available in `CashupDashboardData.tables.variance` |

### Required New Backend Work

None. This is the most complete backend of all 6 sections. All tables, types, actions, services, and data queries are production-ready. The redesign is purely UI.

### Dependencies on Existing Features

| Dependency | Direction | Notes |
|------------|-----------|-------|
| Sites | Cashing Up -> Sites | Multi-site support via `site_id` |
| Dashboard | Cashing Up -> Dashboard | Revalidates dashboard tag on mutations |

---

## 4. OJ Projects (Consultancy Time Tracking)

### Existing Backend (Production)

**Tables:** `vendors` (clients), `oj_projects`, `oj_entries`, `oj_work_types`, `oj_project_contacts`, `oj_billing_runs`, `oj_recurring_charge_instances`

**Types:** Full type system in `src/types/oj-projects.ts` — `OJProject`, `OJEntry`, `OJWorkType`, `OJVendorBillingSettings`, `OJVendorRecurringCharge`, `OJBillingRun`, `OJRecurringChargeInstance`

**Entry types:** `time`, `mileage`, `one_off`
**Entry statuses:** `unbilled -> billing_pending -> billed -> paid`
**Project statuses:** `active`, `paused`, `completed`, `archived`
**Billing modes:** `full` (hourly), `cap` (monthly cap)

**Server Actions (11 files with 30+ functions):**
- Entries: `createTimeEntry`, `createMileageEntry`, `createOneOffCharge`, `updateEntry`, `deleteEntry`, `getEntries`
- Projects: CRUD + `getProjectPaymentHistory`, `updateProjectStatus`
- Vendor/billing: `getVendorBillingSettings`, `upsertVendorBillingSettings`
- Recurring charges: CRUD + `disableRecurringCharge`
- Work types: CRUD + `disableWorkType`
- Billing: `getClientStatement`, `sendStatementEmail`, `getClientBalance`
- Project contacts: `getProjectContacts`, `addProjectContact`, `removeProjectContact`

**UI Pages:** `page.tsx` (overview), `clients/`, `entries/`, `projects/`, `projects/[id]/`, `work-types/`

**RBAC:** `oj_projects` module registered

### What the Design Requires

| Feature | Status | Complexity | Notes |
|---------|--------|------------|-------|
| Time entry form (start/end, project, work type) | EXISTS | Low | Redesign form |
| Mileage entry form | EXISTS | Low | Redesign form |
| One-off charge form | EXISTS | Low | Redesign form |
| Entry list with filters | EXISTS | Low | Redesign table |
| Project list with status | EXISTS | Low | Redesign list |
| Project detail with entries/billing | EXISTS | Low | Redesign detail page |
| Client/vendor management | EXISTS | Low | Redesign client pages |
| Billing settings per client | EXISTS | Low | Redesign settings |
| Client statements | EXISTS | Low | Redesign + email send |
| Recurring charges | EXISTS | Low | Redesign management |
| Work type configuration | EXISTS | Low | Redesign settings |
| Timer (live time tracking) | MAYBE NEW | Medium | No live timer in backend; would need client-side state only |
| Billing run / invoice generation | EXISTS | Low | Linked to invoice system |

### Required New Backend Work

Minimal. Possible additions:
- Timer state could be client-side only (start time in localStorage, compute duration on stop, create entry)
- May want a `getProjectDashboardStats` aggregate query for the overview page KPIs

### Dependencies on Existing Features

| Dependency | Direction | Notes |
|------------|-----------|-------|
| Vendors | OJ Projects -> Vendors | Clients are `vendors` table rows |
| Invoices | OJ Projects -> Invoices | Billing runs generate invoices via `invoice_id` |
| Mileage | OJ Projects -> Mileage | Shares mileage rate concepts |

---

## 5. Short Links (URL Shortener with Analytics)

### Existing Backend (Production)

**Tables:** `short_links`, `short_link_clicks`

**Short link columns:** `id`, `short_code`, `destination_url`, `link_type` (enum: `loyalty_portal`, `promotion`, `reward_redemption`, `custom`, `booking_confirmation`, `event_checkin`), `name`, `click_count`, `metadata` (JSONB), `expires_at`, `parent_link_id`, `created_by`, `created_at`, `updated_at`, `last_clicked_at`

**Click tracking columns:** `id`, `short_link_id`, `clicked_at`, `ip_address`, `user_agent`, `browser`, `os`, `device_type`, `referrer`, `country`, `region`, `city`, `utm_source`, `utm_medium`, `utm_campaign`, `metadata`

**Types:** `ShortLink`, `AnalyticsLinkRow`, `CampaignGroup` in `src/types/short-links.ts`

**Service:** `ShortLinkService` class with full CRUD + analytics + UTM variant generation

**Server Actions (10 functions):** `createShortLink`, `getShortLinks`, `updateShortLink`, `deleteShortLink`, `createShortLinkInternal`, `getOrCreateUtmVariant`, `getShortLinkAnalytics`, `getShortLinkAnalyticsSummary`, `getShortLinkVolume`, `getShortLinkVolumeAdvanced`

**Stored procedures:** `increment_short_link_clicks`, `get_all_links_analytics_v2`

**UI Pages:** `page.tsx` (list with `ShortLinksClient.tsx`), `insights/` (with `InsightsClient.tsx`), components (`ShortLinkFormModal`, `ShortLinkAnalyticsModal`, `UtmDropdown`)

**Custom domains:** `l.the-anchor.pub` for short link resolution

**RBAC:** `short_links` module registered

### What the Design Requires

| Feature | Status | Complexity | Notes |
|---------|--------|------------|-------|
| Link list with search/filter | EXISTS | Low | Redesign existing list |
| Create/edit link modal | EXISTS | Low | Redesign existing modal |
| Click analytics per link | EXISTS | Low | Redesign analytics modal |
| Volume insights (time series) | EXISTS | Low | Redesign insights page |
| UTM campaign grouping | EXISTS | Low | `CampaignGroup` type + parent/variant model |
| Geographic breakdown | EXISTS | Low | Click data has country/region/city |
| Device/browser breakdown | EXISTS | Low | Click data has browser/os/device_type |
| QR code generation | MAYBE NEW | Low | Can be client-side only (qrcode library) |
| Bulk link creation | MAYBE NEW | Medium | No bulk endpoint; would need new action |
| Link expiry management | EXISTS | Low | `expires_at` column exists |

### Required New Backend Work

None for core features. Possible additions:
- QR code generation is client-side only (no backend needed)
- Bulk creation endpoint if the design includes it

### Dependencies on Existing Features

| Dependency | Direction | Notes |
|------------|-----------|-------|
| Events | Short Links <- Events | Events auto-generate marketing short links |
| Custom domain | Infrastructure | `l.the-anchor.pub` domain routing in `vercel.json` |

---

## 6. Design System (Internal Style Guide)

### Existing Backend

None needed. This is a documentation/reference page that renders live component previews.

### What the Design Requires

| Feature | Status | Complexity | Notes |
|---------|--------|------------|-------|
| Colour palette display | NEW | Low | Read from design tokens, display swatches |
| Typography scale | NEW | Low | Display font sizes/weights from tokens |
| Component gallery | NEW | Medium | Live rendered components with code snippets |
| Spacing/layout reference | NEW | Low | Visual spacing scale |
| Icon library | NEW | Low | Display all icons with names |

### Required New Backend Work

**None.** This page is entirely frontend. It reads design tokens from the CSS/Tailwind config and renders components from the shared component library. No database tables, no server actions.

### Dependencies on Existing Features

| Dependency | Direction | Notes |
|------------|-----------|-------|
| Design System components | Circular | The page documents the components it is built with |

---

## Table Stakes (Expected in Every Section)

| Feature | Why Expected | Applies To |
|---------|--------------|------------|
| RBAC-gated access | All pages must check permissions | All 6 sections |
| Loading skeletons | Users expect instant feedback | All 6 sections |
| Empty states | Meaningful content when no data | All 6 sections |
| Search/filter on lists | Users expect to find things quickly | Events, Performers, OJ Projects, Short Links |
| Pagination or virtual scroll | Performance with large datasets | Events, Short Links, OJ Projects entries |
| Responsive layout | Mobile use by FOH staff | All 6 sections |
| Audit logging | All mutations logged | Events, Performers, Cashing Up, OJ Projects, Short Links |
| Toast notifications | Feedback on actions | All 6 sections |
| Keyboard navigation | Accessibility baseline | All 6 sections |
| Export capability (CSV/PDF) | Manager reporting | Cashing Up, OJ Projects, Events |

---

## Differentiators

| Feature | Value Proposition | Section | Complexity |
|---------|-------------------|---------|------------|
| Calendar view with drag-to-reschedule | Visual event planning | Events | High |
| Board/Kanban view | Status-at-a-glance workflow | Events, Performers | Medium |
| Live timer for time tracking | No manual time entry needed | OJ Projects | Medium |
| Campaign analytics with UTM grouping | Marketing ROI visibility | Short Links | Low (exists) |
| QR code generation for links | Physical venue use (posters, menus) | Short Links | Low |
| Performer pipeline (submission -> booked) | Structured recruitment workflow | Performers | Medium |
| Cash variance trend analysis | Spot theft/error patterns | Cashing Up | Low (exists) |
| Client statement email send | One-click billing communication | OJ Projects | Low (exists) |

---

## Anti-Features

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Real-time collaborative editing | Complexity explosion; single-user venue ops | Standard request/response; last-write-wins |
| Public performer profiles | Privacy/GDPR risk; performers submitted personal data | Internal directory only; separate public listing later |
| Automated billing/invoicing | Financial operations need human review | One-click generation + manual approval |
| Multi-currency support | Single UK venue; GBP only | Hardcode GBP; use pence internally |
| Complex permissions per event | Over-engineering; 3 roles suffice | Use existing RBAC (super_admin, manager, staff) |
| Dark mode for Design System page | Out of scope per PROJECT.md | Light mode only for v1 |

---

## Feature Dependencies (Cross-Section)

```
Events ──FK──> Customers (event_bookings.customer_id)
Events ──FK──> Performers (proposed performer_id on events)
Events ──auto──> Short Links (marketing link generation)
Events ──sync──> Google Calendar
Events ──pay──> Stripe (ticket payments)

Performers ──FK──> Events (booking history via performer_id)
Performers ──API──> Public submission endpoint

Cashing Up ──FK──> Sites (multi-site support)
Cashing Up ──tag──> Dashboard (revalidation)

OJ Projects ──FK──> Vendors (clients)
OJ Projects ──FK──> Invoices (billing runs)

Short Links ──domain──> Vercel (l.the-anchor.pub routing)
Short Links <──auto── Events (marketing links)

Design System ──reads──> Design tokens (CSS/Tailwind)
Design System ──renders──> Shared components
```

---

## MVP Recommendation Per Section

### Events
Prioritize: Calendar view, list view with redesigned filters, event detail tabs, stats bar.
Defer: Board/Kanban view (nice-to-have, not table stakes), drag-to-reschedule.

### Performers
Prioritize: Redesigned list with search/filter, detail page with status pipeline, genre tagging, fee tracking.
Defer: Rating system (needs post-event workflow), availability calendar (complex, low ROI initially), contact log.

### Cashing Up
Prioritize: All views (daily, weekly, dashboard, insights) — all backends exist; pure UI redesign.
Defer: Nothing; this section is ready for full implementation.

### OJ Projects
Prioritize: Entry list, time/mileage/charge forms, project detail, client list, billing settings.
Defer: Live timer (client-side enhancement, not core), advanced reporting.

### Short Links
Prioritize: Link list, create/edit modal, per-link analytics, volume insights, campaign grouping.
Defer: QR code generation (easy add-on later), bulk creation.

### Design System
Prioritize: Colour palette, typography, core component gallery (buttons, inputs, cards, tables).
Defer: Exhaustive component documentation; build incrementally as components are created.

---

## Complexity Summary

| Section | Backend Work | Frontend Work | Overall |
|---------|-------------|---------------|---------|
| Events | None (exists) | Medium (new calendar/board views) | Medium |
| Performers | Medium (schema changes + new tables) | Medium (redesign + new features) | Medium-High |
| Cashing Up | None (exists) | Low (pure redesign) | Low |
| OJ Projects | Minimal (optional timer) | Low-Medium (redesign 6 sub-pages) | Low-Medium |
| Short Links | None (exists) | Low (redesign existing) | Low |
| Design System | None | Medium (component gallery) | Medium |

---

## Sources

- Codebase audit of `src/types/`, `src/app/actions/`, `src/services/`, `src/app/(authenticated)/` — HIGH confidence
- `src/types/database.generated.ts` — authoritative source for existing table schemas — HIGH confidence
- `src/types/rbac.ts` — all 6 RBAC modules already registered — HIGH confidence
- Design handoff context from `.planning/PROJECT.md` — HIGH confidence
