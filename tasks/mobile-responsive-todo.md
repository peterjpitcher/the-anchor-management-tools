# Mobile Responsive Overhaul — Tracked Checklist (160 routes)

Legend per route: **A** = audited against rubric · **F** = fixed · **V** = verified.
Marker `[x]` done, `[ ]` outstanding. Spec: `docs/superpowers/specs/2026-07-11-mobile-responsive-overhaul-design.md`.

---

## Tier 0 — Systemic (shared surfaces, fix once)

- [x]A [x]F [ ]V  `src/ds` primitives — Table / DataTable / responsive wrapper
- [x]A [x]F [ ]V  `src/ds` Modal / drawer fit on mobile
- [x]A [x]F [ ]V  `src/ds` page container / Section / Card default gutters + max-width
- [x]A [x]F [ ]V  `globals.css` mobile media queries + `min-width` overrides
- [x]A [x]F [ ]V  Nav shell (AppShell/Sidebar/Topbar/MobileChrome) — VERIFY only
- [x]A [x]F [ ]V  `min-w-[720–1040px]` grid offenders (rota grid, FOH timeline, receipts charts/grids, invoice detail)

## Tier 1 — Daily manager (priority)

### Dashboard
- [x]A [x]F [ ]V  `/dashboard`
### Messages
- [x]A [x]F [ ]V  `/messages`
- [x]A [x]F [ ]V  `/messages/bulk`
- [x]A [x]F [ ]V  `/messages/holding`
### Customers
- [x]A [x]F [ ]V  `/customers`
- [x]A [x]F [ ]V  `/customers/[id]`
- [x]A [x]F [ ]V  `/customers/insights`
### Events
- [x]A [x]F [ ]V  `/events`
- [x]A [x]F [ ]V  `/events/[id]`
- [x]A [x]F [ ]V  `/events/todo`
- [x]A [x]F [ ]V  `/events/[id]/check-in` (kiosk, chromeless)
### Private bookings
- [x]A [x]F [ ]V  `/private-bookings`
- [x]A [x]F [ ]V  `/private-bookings/new`
- [x]A [x]F [ ]V  `/private-bookings/calendar`
- [x]A [x]F [ ]V  `/private-bookings/sms-queue`
- [x]A [x]F [ ]V  `/private-bookings/[id]`
- [x]A [x]F [ ]V  `/private-bookings/[id]/edit`
- [x]A [x]F [ ]V  `/private-bookings/[id]/communications`
- [x]A [x]F [ ]V  `/private-bookings/[id]/contract`
- [x]A [x]F [ ]V  `/private-bookings/[id]/items`
- [x]A [x]F [ ]V  `/private-bookings/[id]/messages`
- [x]A [x]F [ ]V  `/private-bookings/settings`
- [x]A [x]F [ ]V  `/private-bookings/settings/catering`
- [x]A [x]F [ ]V  `/private-bookings/settings/spaces`
- [x]A [x]F [ ]V  `/private-bookings/settings/vendors`
- [x]A [x]F [ ]V  `/private-booking/[id]`
- [x]A [x]F [ ]V  `/private-booking/[id]/edit`

## Tier 2 — On-the-floor

### Table bookings
- [x]A [ ]F [ ]V  `/table-bookings`
- [x]A [ ]F [ ]V  `/table-bookings/[id]`
- [x]A [ ]F [ ]V  `/table-bookings/boh`
- [x]A [ ]F [ ]V  `/table-bookings/foh`
- [x]A [ ]F [ ]V  `/table-bookings/reports`
### Timeclock
- [x]A [ ]F [ ]V  `/timeclock` (kiosk, chromeless)
### Rota
- [x]A [ ]F [ ]V  `/rota`
- [x]A [ ]F [ ]V  `/rota/dashboard`
- [x]A [ ]F [ ]V  `/rota/hours`
- [x]A [ ]F [ ]V  `/rota/leave`
- [x]A [ ]F [ ]V  `/rota/payroll`
- [x]A [ ]F [ ]V  `/rota/print`
- [x]A [ ]F [ ]V  `/rota/templates`
- [x]A [ ]F [ ]V  `/rota/timeclock`
### Staff portal (own shell)
- [x]A [ ]F [ ]V  `/portal`
- [x]A [ ]F [ ]V  `/portal/shifts`
- [x]A [ ]F [ ]V  `/portal/leave`
- [x]A [ ]F [ ]V  `/portal/leave/new`

## Tier 3 — Money / admin

### Invoices
- [x]A [ ]F [ ]V  `/invoices`
- [x]A [ ]F [ ]V  `/invoices/new`
- [x]A [ ]F [ ]V  `/invoices/catalog`
- [x]A [ ]F [ ]V  `/invoices/export`
- [x]A [ ]F [ ]V  `/invoices/vendors`
- [x]A [ ]F [ ]V  `/invoices/recurring`
- [x]A [ ]F [ ]V  `/invoices/recurring/new`
- [x]A [ ]F [ ]V  `/invoices/recurring/[id]`
- [x]A [ ]F [ ]V  `/invoices/recurring/[id]/edit`
- [x]A [ ]F [ ]V  `/invoices/[id]`
- [x]A [ ]F [ ]V  `/invoices/[id]/edit`
- [x]A [ ]F [ ]V  `/invoices/[id]/payment`
### Quotes
- [x]A [ ]F [ ]V  `/quotes`
- [x]A [ ]F [ ]V  `/quotes/new`
- [x]A [ ]F [ ]V  `/quotes/[id]`
- [x]A [ ]F [ ]V  `/quotes/[id]/edit`
- [x]A [ ]F [ ]V  `/quotes/[id]/convert`
### Receipts
- [x]A [ ]F [ ]V  `/receipts`
- [x]A [ ]F [ ]V  `/receipts/bulk`
- [x]A [ ]F [ ]V  `/receipts/missing-expense`
- [x]A [ ]F [ ]V  `/receipts/monthly`
- [x]A [ ]F [ ]V  `/receipts/pnl`
- [x]A [ ]F [ ]V  `/receipts/vendors`
### Cashing-up
- [x]A [ ]F [ ]V  `/cashing-up/daily`
- [x]A [ ]F [ ]V  `/cashing-up/dashboard`
- [x]A [ ]F [ ]V  `/cashing-up/weekly`
- [x]A [ ]F [ ]V  `/cashing-up/import`
- [x]A [ ]F [ ]V  `/cashing-up/insights`
### Expenses / Mileage / MGD
- [x]A [ ]F [ ]V  `/expenses`
- [x]A [ ]F [ ]V  `/expenses/insights`
- [x]A [ ]F [ ]V  `/mileage`
- [x]A [ ]F [ ]V  `/mileage/destinations`
- [x]A [ ]F [ ]V  `/mileage/insights`
- [x]A [ ]F [ ]V  `/mgd`
- [x]A [ ]F [ ]V  `/mgd/insights`
### Menu management
- [x]A [ ]F [ ]V  `/menu-management`
- [x]A [ ]F [ ]V  `/menu-management/dishes`
- [x]A [ ]F [ ]V  `/menu-management/ingredients`
- [x]A [ ]F [ ]V  `/menu-management/recipes`
### OJ Projects
- [x]A [ ]F [ ]V  `/oj-projects`
- [x]A [ ]F [ ]V  `/oj-projects/clients`
- [x]A [ ]F [ ]V  `/oj-projects/entries`
- [x]A [ ]F [ ]V  `/oj-projects/projects`
- [x]A [ ]F [ ]V  `/oj-projects/projects/[id]`
- [x]A [ ]F [ ]V  `/oj-projects/work-types`
### Short links
- [x]A [ ]F [ ]V  `/short-links`
- [x]A [ ]F [ ]V  `/short-links/insights`
- [x]A [ ]F [ ]V  `/short-links/legacy-domain`
### Employees / recruitment
- [x]A [ ]F [ ]V  `/employees`
- [x]A [ ]F [ ]V  `/employees/new`
- [x]A [ ]F [ ]V  `/employees/[employee_id]`
- [x]A [ ]F [ ]V  `/employees/[employee_id]/edit`
- [x]A [ ]F [ ]V  `/employees/birthdays`
- [x]A [ ]F [ ]V  `/employees/reliability`
- [x]A [ ]F [ ]V  `/recruitment`
### Core / other
- [x]A [ ]F [ ]V  `/profile`
- [x]A [ ]F [ ]V  `/profile/change-password`
- [x]A [ ]F [ ]V  `/users`
- [x]A [ ]F [ ]V  `/roles`
- [x]A [ ]F [ ]V  `/roles/new`
- [x]A [ ]F [ ]V  `/roles/[id]/edit`
- [x]A [ ]F [ ]V  `/feedback-inbox`
- [x]A [ ]F [ ]V  `/parking`
### Settings
- [x]A [ ]F [ ]V  `/settings`
- [x]A [ ]F [ ]V  `/settings/api-keys`
- [x]A [ ]F [ ]V  `/settings/audit-logs`
- [x]A [ ]F [ ]V  `/settings/background-jobs`
- [x]A [ ]F [ ]V  `/settings/budgets`
- [x]A [ ]F [ ]V  `/settings/business-hours`
- [x]A [ ]F [ ]V  `/settings/calendar-notes`
- [x]A [ ]F [ ]V  `/settings/categories`
- [x]A [ ]F [ ]V  `/settings/customer-labels`
- [x]A [ ]F [ ]V  `/settings/design-system`
- [x]A [ ]F [ ]V  `/settings/event-categories`
- [x]A [ ]F [ ]V  `/settings/gdpr`
- [x]A [ ]F [ ]V  `/settings/import-messages`
- [x]A [ ]F [ ]V  `/settings/menu-target`
- [x]A [ ]F [ ]V  `/settings/message-templates`
- [x]A [ ]F [ ]V  `/settings/pay-bands`
- [x]A [ ]F [ ]V  `/settings/rota`
- [x]A [ ]F [ ]V  `/settings/sms-failures`
- [x]A [ ]F [ ]V  `/settings/table-bookings`

## Tier 4 — Public / booking (chromeless)

### Public + auth
- [x]A [ ]F [ ]V  `/` (root)
- [x]A [ ]F [ ]V  `/login`
- [x]A [ ]F [ ]V  `/auth/login`
- [x]A [ ]F [ ]V  `/auth/recover`
- [x]A [ ]F [ ]V  `/auth/reset`
- [x]A [ ]F [ ]V  `/auth/reset-password`
- [x]A [ ]F [ ]V  `/error`
- [x]A [ ]F [ ]V  `/unauthorized`
- [x]A [ ]F [ ]V  `/privacy`
### Table booking (public)
- [x]A [ ]F [ ]V  `/table-booking`
- [x]A [ ]F [ ]V  `/table-booking/[reference]`
- [x]A [ ]F [ ]V  `/table-booking/[reference]/payment`
- [x]A [ ]F [ ]V  `/table-booking/success`
### Booking tokens
- [x]A [ ]F [ ]V  `/booking-confirmation/[token]`
- [x]A [ ]F [ ]V  `/booking-portal/[token]`
- [x]A [ ]F [ ]V  `/booking-success/[id]`
### Parking guest
- [x]A [ ]F [ ]V  `/parking/guest/[id]`
- [x]A [ ]F [ ]V  `/parking/payment-error`
### Recruitment (public)
- [x]A [ ]F [ ]V  `/recruitment/book/[token]`
### Guest-token cluster `/g/[token]/…`
- [x]A [ ]F [ ]V  `/g/[token]/card-capture`
- [x]A [ ]F [ ]V  `/g/[token]/event-payment`
- [x]A [ ]F [ ]V  `/g/[token]/manage-booking`
- [x]A [ ]F [ ]V  `/g/[token]/private-feedback`
- [x]A [ ]F [ ]V  `/g/[token]/sunday-preorder`
- [x]A [ ]F [ ]V  `/g/[token]/table-manage`
- [x]A [ ]F [ ]V  `/g/[token]/table-payment`
- [x]A [ ]F [ ]V  `/g/[token]/waitlist-offer`
### Misc token
- [x]A [ ]F [ ]V  `/m/[token]/charge-request`
### Feedback (own shell)
- [x]A [ ]F [ ]V  `/feedback`
- [x]A [ ]F [ ]V  `/feedback/tell-us`
- [x]A [ ]F [ ]V  `/feedback/thanks`
### Onboarding (own shell)
- [x]A [ ]F [ ]V  `/onboarding/[token]`
- [x]A [ ]F [ ]V  `/onboarding/success`

---

## Review log

_(updated as work proceeds)_
