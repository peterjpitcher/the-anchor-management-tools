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
- [x]A [x]F [ ]V  `/table-bookings`
- [x]A [x]F [ ]V  `/table-bookings/[id]`
- [x]A [x]F [ ]V  `/table-bookings/boh`
- [x]A [x]F [ ]V  `/table-bookings/foh`
- [x]A [x]F [ ]V  `/table-bookings/reports`
### Timeclock
- [x]A [x]F [ ]V  `/timeclock` (kiosk, chromeless)
### Rota
- [x]A [x]F [ ]V  `/rota`
- [x]A [x]F [ ]V  `/rota/dashboard`
- [x]A [x]F [ ]V  `/rota/hours`
- [x]A [x]F [ ]V  `/rota/leave`
- [x]A [x]F [ ]V  `/rota/payroll`
- [x]A [x]F [ ]V  `/rota/print`
- [x]A [x]F [ ]V  `/rota/templates`
- [x]A [x]F [ ]V  `/rota/timeclock`
### Staff portal (own shell)
- [x]A [x]F [ ]V  `/portal`
- [x]A [x]F [ ]V  `/portal/shifts`
- [x]A [x]F [ ]V  `/portal/leave`
- [x]A [x]F [ ]V  `/portal/leave/new`

## Tier 3 — Money / admin

### Invoices
- [x]A [x]F [ ]V  `/invoices`
- [x]A [x]F [ ]V  `/invoices/new`
- [x]A [x]F [ ]V  `/invoices/catalog`
- [x]A [x]F [ ]V  `/invoices/export`
- [x]A [x]F [ ]V  `/invoices/vendors`
- [x]A [x]F [ ]V  `/invoices/recurring`
- [x]A [x]F [ ]V  `/invoices/recurring/new`
- [x]A [x]F [ ]V  `/invoices/recurring/[id]`
- [x]A [x]F [ ]V  `/invoices/recurring/[id]/edit`
- [x]A [x]F [ ]V  `/invoices/[id]`
- [x]A [x]F [ ]V  `/invoices/[id]/edit`
- [x]A [x]F [ ]V  `/invoices/[id]/payment`
### Quotes
- [x]A [x]F [ ]V  `/quotes`
- [x]A [x]F [ ]V  `/quotes/new`
- [x]A [x]F [ ]V  `/quotes/[id]`
- [x]A [x]F [ ]V  `/quotes/[id]/edit`
- [x]A [x]F [ ]V  `/quotes/[id]/convert`
### Receipts
- [x]A [x]F [ ]V  `/receipts`
- [x]A [x]F [ ]V  `/receipts/bulk`
- [x]A [x]F [ ]V  `/receipts/missing-expense`
- [x]A [x]F [ ]V  `/receipts/monthly`
- [x]A [x]F [ ]V  `/receipts/pnl`
- [x]A [x]F [ ]V  `/receipts/vendors`
### Cashing-up
- [x]A [x]F [ ]V  `/cashing-up/daily`
- [x]A [x]F [ ]V  `/cashing-up/dashboard`
- [x]A [x]F [ ]V  `/cashing-up/weekly`
- [x]A [x]F [ ]V  `/cashing-up/import`
- [x]A [x]F [ ]V  `/cashing-up/insights`
### Expenses / Mileage / MGD
- [x]A [x]F [ ]V  `/expenses`
- [x]A [x]F [ ]V  `/expenses/insights`
- [x]A [x]F [ ]V  `/mileage`
- [x]A [x]F [ ]V  `/mileage/destinations`
- [x]A [x]F [ ]V  `/mileage/insights`
- [x]A [x]F [ ]V  `/mgd`
- [x]A [x]F [ ]V  `/mgd/insights`
### Menu management
- [x]A [x]F [ ]V  `/menu-management`
- [x]A [x]F [ ]V  `/menu-management/dishes`
- [x]A [x]F [ ]V  `/menu-management/ingredients`
- [x]A [x]F [ ]V  `/menu-management/recipes`
### OJ Projects
- [x]A [x]F [ ]V  `/oj-projects`
- [x]A [x]F [ ]V  `/oj-projects/clients`
- [x]A [x]F [ ]V  `/oj-projects/entries`
- [x]A [x]F [ ]V  `/oj-projects/projects`
- [x]A [x]F [ ]V  `/oj-projects/projects/[id]`
- [x]A [x]F [ ]V  `/oj-projects/work-types`
### Short links
- [x]A [x]F [ ]V  `/short-links`
- [x]A [x]F [ ]V  `/short-links/insights`
- [x]A [x]F [ ]V  `/short-links/legacy-domain`
### Employees / recruitment
- [x]A [x]F [ ]V  `/employees`
- [x]A [x]F [ ]V  `/employees/new`
- [x]A [x]F [ ]V  `/employees/[employee_id]`
- [x]A [x]F [ ]V  `/employees/[employee_id]/edit`
- [x]A [x]F [ ]V  `/employees/birthdays`
- [x]A [x]F [ ]V  `/employees/reliability`
- [x]A [x]F [ ]V  `/recruitment`
### Core / other
- [x]A [x]F [ ]V  `/profile`
- [x]A [x]F [ ]V  `/profile/change-password`
- [x]A [x]F [ ]V  `/users`
- [x]A [x]F [ ]V  `/roles`
- [x]A [x]F [ ]V  `/roles/new`
- [x]A [x]F [ ]V  `/roles/[id]/edit`
- [x]A [x]F [ ]V  `/feedback-inbox`
- [x]A [x]F [ ]V  `/parking`
### Settings
- [x]A [x]F [ ]V  `/settings`
- [x]A [x]F [ ]V  `/settings/api-keys`
- [x]A [x]F [ ]V  `/settings/audit-logs`
- [x]A [x]F [ ]V  `/settings/background-jobs`
- [x]A [x]F [ ]V  `/settings/budgets`
- [x]A [x]F [ ]V  `/settings/business-hours`
- [x]A [x]F [ ]V  `/settings/calendar-notes`
- [x]A [x]F [ ]V  `/settings/categories`
- [x]A [x]F [ ]V  `/settings/customer-labels`
- [x]A [x]F [ ]V  `/settings/design-system`
- [x]A [x]F [ ]V  `/settings/event-categories`
- [x]A [x]F [ ]V  `/settings/gdpr`
- [x]A [x]F [ ]V  `/settings/import-messages`
- [x]A [x]F [ ]V  `/settings/menu-target`
- [x]A [x]F [ ]V  `/settings/message-templates`
- [x]A [x]F [ ]V  `/settings/pay-bands`
- [x]A [x]F [ ]V  `/settings/rota`
- [x]A [x]F [ ]V  `/settings/sms-failures`
- [x]A [x]F [ ]V  `/settings/table-bookings`

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
