# Mobile Responsive Overhaul — Tracked Checklist (160 routes)

Legend per route: **A** = audited against rubric · **F** = fixed · **V** = verified.
Marker `[x]` done, `[ ]` outstanding. Spec: `docs/superpowers/specs/2026-07-11-mobile-responsive-overhaul-design.md`.

---

## Tier 0 — Systemic (shared surfaces, fix once)

- [ ]A [ ]F [ ]V  `src/ds` primitives — Table / DataTable / responsive wrapper
- [ ]A [ ]F [ ]V  `src/ds` Modal / drawer fit on mobile
- [ ]A [ ]F [ ]V  `src/ds` page container / Section / Card default gutters + max-width
- [ ]A [ ]F [ ]V  `globals.css` mobile media queries + `min-width` overrides
- [ ]A [ ]F [ ]V  Nav shell (AppShell/Sidebar/Topbar/MobileChrome) — VERIFY only
- [ ]A [ ]F [ ]V  `min-w-[720–1040px]` grid offenders (rota grid, FOH timeline, receipts charts/grids, invoice detail)

## Tier 1 — Daily manager (priority)

### Dashboard
- [ ]A [ ]F [ ]V  `/dashboard`
### Messages
- [ ]A [ ]F [ ]V  `/messages`
- [ ]A [ ]F [ ]V  `/messages/bulk`
- [ ]A [ ]F [ ]V  `/messages/holding`
### Customers
- [ ]A [ ]F [ ]V  `/customers`
- [ ]A [ ]F [ ]V  `/customers/[id]`
- [ ]A [ ]F [ ]V  `/customers/insights`
### Events
- [ ]A [ ]F [ ]V  `/events`
- [ ]A [ ]F [ ]V  `/events/[id]`
- [ ]A [ ]F [ ]V  `/events/todo`
- [ ]A [ ]F [ ]V  `/events/[id]/check-in` (kiosk, chromeless)
### Private bookings
- [ ]A [ ]F [ ]V  `/private-bookings`
- [ ]A [ ]F [ ]V  `/private-bookings/new`
- [ ]A [ ]F [ ]V  `/private-bookings/calendar`
- [ ]A [ ]F [ ]V  `/private-bookings/sms-queue`
- [ ]A [ ]F [ ]V  `/private-bookings/[id]`
- [ ]A [ ]F [ ]V  `/private-bookings/[id]/edit`
- [ ]A [ ]F [ ]V  `/private-bookings/[id]/communications`
- [ ]A [ ]F [ ]V  `/private-bookings/[id]/contract`
- [ ]A [ ]F [ ]V  `/private-bookings/[id]/items`
- [ ]A [ ]F [ ]V  `/private-bookings/[id]/messages`
- [ ]A [ ]F [ ]V  `/private-bookings/settings`
- [ ]A [ ]F [ ]V  `/private-bookings/settings/catering`
- [ ]A [ ]F [ ]V  `/private-bookings/settings/spaces`
- [ ]A [ ]F [ ]V  `/private-bookings/settings/vendors`
- [ ]A [ ]F [ ]V  `/private-booking/[id]`
- [ ]A [ ]F [ ]V  `/private-booking/[id]/edit`

## Tier 2 — On-the-floor

### Table bookings
- [ ]A [ ]F [ ]V  `/table-bookings`
- [ ]A [ ]F [ ]V  `/table-bookings/[id]`
- [ ]A [ ]F [ ]V  `/table-bookings/boh`
- [ ]A [ ]F [ ]V  `/table-bookings/foh`
- [ ]A [ ]F [ ]V  `/table-bookings/reports`
### Timeclock
- [ ]A [ ]F [ ]V  `/timeclock` (kiosk, chromeless)
### Rota
- [ ]A [ ]F [ ]V  `/rota`
- [ ]A [ ]F [ ]V  `/rota/dashboard`
- [ ]A [ ]F [ ]V  `/rota/hours`
- [ ]A [ ]F [ ]V  `/rota/leave`
- [ ]A [ ]F [ ]V  `/rota/payroll`
- [ ]A [ ]F [ ]V  `/rota/print`
- [ ]A [ ]F [ ]V  `/rota/templates`
- [ ]A [ ]F [ ]V  `/rota/timeclock`
### Staff portal (own shell)
- [ ]A [ ]F [ ]V  `/portal`
- [ ]A [ ]F [ ]V  `/portal/shifts`
- [ ]A [ ]F [ ]V  `/portal/leave`
- [ ]A [ ]F [ ]V  `/portal/leave/new`

## Tier 3 — Money / admin

### Invoices
- [ ]A [ ]F [ ]V  `/invoices`
- [ ]A [ ]F [ ]V  `/invoices/new`
- [ ]A [ ]F [ ]V  `/invoices/catalog`
- [ ]A [ ]F [ ]V  `/invoices/export`
- [ ]A [ ]F [ ]V  `/invoices/vendors`
- [ ]A [ ]F [ ]V  `/invoices/recurring`
- [ ]A [ ]F [ ]V  `/invoices/recurring/new`
- [ ]A [ ]F [ ]V  `/invoices/recurring/[id]`
- [ ]A [ ]F [ ]V  `/invoices/recurring/[id]/edit`
- [ ]A [ ]F [ ]V  `/invoices/[id]`
- [ ]A [ ]F [ ]V  `/invoices/[id]/edit`
- [ ]A [ ]F [ ]V  `/invoices/[id]/payment`
### Quotes
- [ ]A [ ]F [ ]V  `/quotes`
- [ ]A [ ]F [ ]V  `/quotes/new`
- [ ]A [ ]F [ ]V  `/quotes/[id]`
- [ ]A [ ]F [ ]V  `/quotes/[id]/edit`
- [ ]A [ ]F [ ]V  `/quotes/[id]/convert`
### Receipts
- [ ]A [ ]F [ ]V  `/receipts`
- [ ]A [ ]F [ ]V  `/receipts/bulk`
- [ ]A [ ]F [ ]V  `/receipts/missing-expense`
- [ ]A [ ]F [ ]V  `/receipts/monthly`
- [ ]A [ ]F [ ]V  `/receipts/pnl`
- [ ]A [ ]F [ ]V  `/receipts/vendors`
### Cashing-up
- [ ]A [ ]F [ ]V  `/cashing-up/daily`
- [ ]A [ ]F [ ]V  `/cashing-up/dashboard`
- [ ]A [ ]F [ ]V  `/cashing-up/weekly`
- [ ]A [ ]F [ ]V  `/cashing-up/import`
- [ ]A [ ]F [ ]V  `/cashing-up/insights`
### Expenses / Mileage / MGD
- [ ]A [ ]F [ ]V  `/expenses`
- [ ]A [ ]F [ ]V  `/expenses/insights`
- [ ]A [ ]F [ ]V  `/mileage`
- [ ]A [ ]F [ ]V  `/mileage/destinations`
- [ ]A [ ]F [ ]V  `/mileage/insights`
- [ ]A [ ]F [ ]V  `/mgd`
- [ ]A [ ]F [ ]V  `/mgd/insights`
### Menu management
- [ ]A [ ]F [ ]V  `/menu-management`
- [ ]A [ ]F [ ]V  `/menu-management/dishes`
- [ ]A [ ]F [ ]V  `/menu-management/ingredients`
- [ ]A [ ]F [ ]V  `/menu-management/recipes`
### OJ Projects
- [ ]A [ ]F [ ]V  `/oj-projects`
- [ ]A [ ]F [ ]V  `/oj-projects/clients`
- [ ]A [ ]F [ ]V  `/oj-projects/entries`
- [ ]A [ ]F [ ]V  `/oj-projects/projects`
- [ ]A [ ]F [ ]V  `/oj-projects/projects/[id]`
- [ ]A [ ]F [ ]V  `/oj-projects/work-types`
### Short links
- [ ]A [ ]F [ ]V  `/short-links`
- [ ]A [ ]F [ ]V  `/short-links/insights`
- [ ]A [ ]F [ ]V  `/short-links/legacy-domain`
### Employees / recruitment
- [ ]A [ ]F [ ]V  `/employees`
- [ ]A [ ]F [ ]V  `/employees/new`
- [ ]A [ ]F [ ]V  `/employees/[employee_id]`
- [ ]A [ ]F [ ]V  `/employees/[employee_id]/edit`
- [ ]A [ ]F [ ]V  `/employees/birthdays`
- [ ]A [ ]F [ ]V  `/employees/reliability`
- [ ]A [ ]F [ ]V  `/recruitment`
### Core / other
- [ ]A [ ]F [ ]V  `/profile`
- [ ]A [ ]F [ ]V  `/profile/change-password`
- [ ]A [ ]F [ ]V  `/users`
- [ ]A [ ]F [ ]V  `/roles`
- [ ]A [ ]F [ ]V  `/roles/new`
- [ ]A [ ]F [ ]V  `/roles/[id]/edit`
- [ ]A [ ]F [ ]V  `/feedback-inbox`
- [ ]A [ ]F [ ]V  `/parking`
### Settings
- [ ]A [ ]F [ ]V  `/settings`
- [ ]A [ ]F [ ]V  `/settings/api-keys`
- [ ]A [ ]F [ ]V  `/settings/audit-logs`
- [ ]A [ ]F [ ]V  `/settings/background-jobs`
- [ ]A [ ]F [ ]V  `/settings/budgets`
- [ ]A [ ]F [ ]V  `/settings/business-hours`
- [ ]A [ ]F [ ]V  `/settings/calendar-notes`
- [ ]A [ ]F [ ]V  `/settings/categories`
- [ ]A [ ]F [ ]V  `/settings/customer-labels`
- [ ]A [ ]F [ ]V  `/settings/design-system`
- [ ]A [ ]F [ ]V  `/settings/event-categories`
- [ ]A [ ]F [ ]V  `/settings/gdpr`
- [ ]A [ ]F [ ]V  `/settings/import-messages`
- [ ]A [ ]F [ ]V  `/settings/menu-target`
- [ ]A [ ]F [ ]V  `/settings/message-templates`
- [ ]A [ ]F [ ]V  `/settings/pay-bands`
- [ ]A [ ]F [ ]V  `/settings/rota`
- [ ]A [ ]F [ ]V  `/settings/sms-failures`
- [ ]A [ ]F [ ]V  `/settings/table-bookings`

## Tier 4 — Public / booking (chromeless)

### Public + auth
- [ ]A [ ]F [ ]V  `/` (root)
- [ ]A [ ]F [ ]V  `/login`
- [ ]A [ ]F [ ]V  `/auth/login`
- [ ]A [ ]F [ ]V  `/auth/recover`
- [ ]A [ ]F [ ]V  `/auth/reset`
- [ ]A [ ]F [ ]V  `/auth/reset-password`
- [ ]A [ ]F [ ]V  `/error`
- [ ]A [ ]F [ ]V  `/unauthorized`
- [ ]A [ ]F [ ]V  `/privacy`
### Table booking (public)
- [ ]A [ ]F [ ]V  `/table-booking`
- [ ]A [ ]F [ ]V  `/table-booking/[reference]`
- [ ]A [ ]F [ ]V  `/table-booking/[reference]/payment`
- [ ]A [ ]F [ ]V  `/table-booking/success`
### Booking tokens
- [ ]A [ ]F [ ]V  `/booking-confirmation/[token]`
- [ ]A [ ]F [ ]V  `/booking-portal/[token]`
- [ ]A [ ]F [ ]V  `/booking-success/[id]`
### Parking guest
- [ ]A [ ]F [ ]V  `/parking/guest/[id]`
- [ ]A [ ]F [ ]V  `/parking/payment-error`
### Recruitment (public)
- [ ]A [ ]F [ ]V  `/recruitment/book/[token]`
### Guest-token cluster `/g/[token]/…`
- [ ]A [ ]F [ ]V  `/g/[token]/card-capture`
- [ ]A [ ]F [ ]V  `/g/[token]/event-payment`
- [ ]A [ ]F [ ]V  `/g/[token]/manage-booking`
- [ ]A [ ]F [ ]V  `/g/[token]/private-feedback`
- [ ]A [ ]F [ ]V  `/g/[token]/sunday-preorder`
- [ ]A [ ]F [ ]V  `/g/[token]/table-manage`
- [ ]A [ ]F [ ]V  `/g/[token]/table-payment`
- [ ]A [ ]F [ ]V  `/g/[token]/waitlist-offer`
### Misc token
- [ ]A [ ]F [ ]V  `/m/[token]/charge-request`
### Feedback (own shell)
- [ ]A [ ]F [ ]V  `/feedback`
- [ ]A [ ]F [ ]V  `/feedback/tell-us`
- [ ]A [ ]F [ ]V  `/feedback/thanks`
### Onboarding (own shell)
- [ ]A [ ]F [ ]V  `/onboarding/[token]`
- [ ]A [ ]F [ ]V  `/onboarding/success`

---

## Review log

_(updated as work proceeds)_
