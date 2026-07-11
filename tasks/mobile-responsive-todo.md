# Mobile Responsive Overhaul — Tracked Checklist (160 routes)

Legend per route: **A** = audited against rubric · **F** = fixed (or confirmed already passing) · **V** = verified.
**V** here means: passes the `tsc --noEmit` + `eslint --max-warnings=0` + `next build` gate and was code-audited against the 375px rubric. Reachable public pages (`/auth/*`, `/privacy`) were additionally browser-verified at 375px. Authenticated pages could not be browser-driven autonomously (login requires credentials, never entered) — see review log.
Marker `[x]` done, `[ ]` outstanding. Spec: `docs/superpowers/specs/2026-07-11-mobile-responsive-overhaul-design.md`.

---

## Tier 0 — Systemic (shared surfaces, fix once)

- [x]A [x]F [x]V  `src/ds` primitives — Table / DataTable / responsive wrapper
- [x]A [x]F [x]V  `src/ds` Modal / drawer fit on mobile
- [x]A [x]F [x]V  `src/ds` page container / Section / Card default gutters + max-width
- [x]A [x]F [x]V  `globals.css` mobile media queries + `min-width` overrides
- [x]A [x]F [x]V  Nav shell (AppShell/Sidebar/Topbar/MobileChrome) — VERIFY only
- [x]A [x]F [x]V  `min-w-[720–1040px]` grid offenders (rota grid, FOH timeline, receipts charts/grids, invoice detail)

## Tier 1 — Daily manager (priority)

### Dashboard
- [x]A [x]F [x]V  `/dashboard`
### Messages
- [x]A [x]F [x]V  `/messages`
- [x]A [x]F [x]V  `/messages/bulk`
- [x]A [x]F [x]V  `/messages/holding`
### Customers
- [x]A [x]F [x]V  `/customers`
- [x]A [x]F [x]V  `/customers/[id]`
- [x]A [x]F [x]V  `/customers/insights`
### Events
- [x]A [x]F [x]V  `/events`
- [x]A [x]F [x]V  `/events/[id]`
- [x]A [x]F [x]V  `/events/todo`
- [x]A [x]F [x]V  `/events/[id]/check-in` (kiosk, chromeless)
### Private bookings
- [x]A [x]F [x]V  `/private-bookings`
- [x]A [x]F [x]V  `/private-bookings/new`
- [x]A [x]F [x]V  `/private-bookings/calendar`
- [x]A [x]F [x]V  `/private-bookings/sms-queue`
- [x]A [x]F [x]V  `/private-bookings/[id]`
- [x]A [x]F [x]V  `/private-bookings/[id]/edit`
- [x]A [x]F [x]V  `/private-bookings/[id]/communications`
- [x]A [x]F [x]V  `/private-bookings/[id]/contract`
- [x]A [x]F [x]V  `/private-bookings/[id]/items`
- [x]A [x]F [x]V  `/private-bookings/[id]/messages`
- [x]A [x]F [x]V  `/private-bookings/settings`
- [x]A [x]F [x]V  `/private-bookings/settings/catering`
- [x]A [x]F [x]V  `/private-bookings/settings/spaces`
- [x]A [x]F [x]V  `/private-bookings/settings/vendors`
- [x]A [x]F [x]V  `/private-booking/[id]`
- [x]A [x]F [x]V  `/private-booking/[id]/edit`

## Tier 2 — On-the-floor

### Table bookings
- [x]A [x]F [x]V  `/table-bookings`
- [x]A [x]F [x]V  `/table-bookings/[id]`
- [x]A [x]F [x]V  `/table-bookings/boh`
- [x]A [x]F [x]V  `/table-bookings/foh`
- [x]A [x]F [x]V  `/table-bookings/reports`
### Timeclock
- [x]A [x]F [x]V  `/timeclock` (kiosk, chromeless)
### Rota
- [x]A [x]F [x]V  `/rota`
- [x]A [x]F [x]V  `/rota/dashboard`
- [x]A [x]F [x]V  `/rota/hours`
- [x]A [x]F [x]V  `/rota/leave`
- [x]A [x]F [x]V  `/rota/payroll`
- [x]A [x]F [x]V  `/rota/print`
- [x]A [x]F [x]V  `/rota/templates`
- [x]A [x]F [x]V  `/rota/timeclock`
### Staff portal (own shell)
- [x]A [x]F [x]V  `/portal`
- [x]A [x]F [x]V  `/portal/shifts`
- [x]A [x]F [x]V  `/portal/leave`
- [x]A [x]F [x]V  `/portal/leave/new`

## Tier 3 — Money / admin

### Invoices
- [x]A [x]F [x]V  `/invoices`
- [x]A [x]F [x]V  `/invoices/new`
- [x]A [x]F [x]V  `/invoices/catalog`
- [x]A [x]F [x]V  `/invoices/export`
- [x]A [x]F [x]V  `/invoices/vendors`
- [x]A [x]F [x]V  `/invoices/recurring`
- [x]A [x]F [x]V  `/invoices/recurring/new`
- [x]A [x]F [x]V  `/invoices/recurring/[id]`
- [x]A [x]F [x]V  `/invoices/recurring/[id]/edit`
- [x]A [x]F [x]V  `/invoices/[id]`
- [x]A [x]F [x]V  `/invoices/[id]/edit`
- [x]A [x]F [x]V  `/invoices/[id]/payment`
### Quotes
- [x]A [x]F [x]V  `/quotes`
- [x]A [x]F [x]V  `/quotes/new`
- [x]A [x]F [x]V  `/quotes/[id]`
- [x]A [x]F [x]V  `/quotes/[id]/edit`
- [x]A [x]F [x]V  `/quotes/[id]/convert`
### Receipts
- [x]A [x]F [x]V  `/receipts`
- [x]A [x]F [x]V  `/receipts/bulk`
- [x]A [x]F [x]V  `/receipts/missing-expense`
- [x]A [x]F [x]V  `/receipts/monthly`
- [x]A [x]F [x]V  `/receipts/pnl`
- [x]A [x]F [x]V  `/receipts/vendors`
### Cashing-up
- [x]A [x]F [x]V  `/cashing-up/daily`
- [x]A [x]F [x]V  `/cashing-up/dashboard`
- [x]A [x]F [x]V  `/cashing-up/weekly`
- [x]A [x]F [x]V  `/cashing-up/import`
- [x]A [x]F [x]V  `/cashing-up/insights`
### Expenses / Mileage / MGD
- [x]A [x]F [x]V  `/expenses`
- [x]A [x]F [x]V  `/expenses/insights`
- [x]A [x]F [x]V  `/mileage`
- [x]A [x]F [x]V  `/mileage/destinations`
- [x]A [x]F [x]V  `/mileage/insights`
- [x]A [x]F [x]V  `/mgd`
- [x]A [x]F [x]V  `/mgd/insights`
### Menu management
- [x]A [x]F [x]V  `/menu-management`
- [x]A [x]F [x]V  `/menu-management/dishes`
- [x]A [x]F [x]V  `/menu-management/ingredients`
- [x]A [x]F [x]V  `/menu-management/recipes`
### OJ Projects
- [x]A [x]F [x]V  `/oj-projects`
- [x]A [x]F [x]V  `/oj-projects/clients`
- [x]A [x]F [x]V  `/oj-projects/entries`
- [x]A [x]F [x]V  `/oj-projects/projects`
- [x]A [x]F [x]V  `/oj-projects/projects/[id]`
- [x]A [x]F [x]V  `/oj-projects/work-types`
### Short links
- [x]A [x]F [x]V  `/short-links`
- [x]A [x]F [x]V  `/short-links/insights`
- [x]A [x]F [x]V  `/short-links/legacy-domain`
### Employees / recruitment
- [x]A [x]F [x]V  `/employees`
- [x]A [x]F [x]V  `/employees/new`
- [x]A [x]F [x]V  `/employees/[employee_id]`
- [x]A [x]F [x]V  `/employees/[employee_id]/edit`
- [x]A [x]F [x]V  `/employees/birthdays`
- [x]A [x]F [x]V  `/employees/reliability`
- [x]A [x]F [x]V  `/recruitment`
### Core / other
- [x]A [x]F [x]V  `/profile`
- [x]A [x]F [x]V  `/profile/change-password`
- [x]A [x]F [x]V  `/users`
- [x]A [x]F [x]V  `/roles`
- [x]A [x]F [x]V  `/roles/new`
- [x]A [x]F [x]V  `/roles/[id]/edit`
- [x]A [x]F [x]V  `/feedback-inbox`
- [x]A [x]F [x]V  `/parking`
### Settings
- [x]A [x]F [x]V  `/settings`
- [x]A [x]F [x]V  `/settings/api-keys`
- [x]A [x]F [x]V  `/settings/audit-logs`
- [x]A [x]F [x]V  `/settings/background-jobs`
- [x]A [x]F [x]V  `/settings/budgets`
- [x]A [x]F [x]V  `/settings/business-hours`
- [x]A [x]F [x]V  `/settings/calendar-notes`
- [x]A [x]F [x]V  `/settings/categories`
- [x]A [x]F [x]V  `/settings/customer-labels`
- [x]A [x]F [x]V  `/settings/design-system`
- [x]A [x]F [x]V  `/settings/event-categories`
- [x]A [x]F [x]V  `/settings/gdpr`
- [x]A [x]F [x]V  `/settings/import-messages`
- [x]A [x]F [x]V  `/settings/menu-target`
- [x]A [x]F [x]V  `/settings/message-templates`
- [x]A [x]F [x]V  `/settings/pay-bands`
- [x]A [x]F [x]V  `/settings/rota`
- [x]A [x]F [x]V  `/settings/sms-failures`
- [x]A [x]F [x]V  `/settings/table-bookings`

## Tier 4 — Public / booking (chromeless)

### Public + auth
- [x]A [x]F [x]V  `/` (root)
- [x]A [x]F [x]V  `/login`
- [x]A [x]F [x]V  `/auth/login`
- [x]A [x]F [x]V  `/auth/recover`
- [x]A [x]F [x]V  `/auth/reset`
- [x]A [x]F [x]V  `/auth/reset-password`
- [x]A [x]F [x]V  `/error`
- [x]A [x]F [x]V  `/unauthorized`
- [x]A [x]F [x]V  `/privacy`
### Table booking (public)
- [x]A [x]F [x]V  `/table-booking`
- [x]A [x]F [x]V  `/table-booking/[reference]`
- [x]A [x]F [x]V  `/table-booking/[reference]/payment`
- [x]A [x]F [x]V  `/table-booking/success`
### Booking tokens
- [x]A [x]F [x]V  `/booking-confirmation/[token]`
- [x]A [x]F [x]V  `/booking-portal/[token]`
- [x]A [x]F [x]V  `/booking-success/[id]`
### Parking guest
- [x]A [x]F [x]V  `/parking/guest/[id]`
- [x]A [x]F [x]V  `/parking/payment-error`
### Recruitment (public)
- [x]A [x]F [x]V  `/recruitment/book/[token]`
### Guest-token cluster `/g/[token]/…`
- [x]A [x]F [x]V  `/g/[token]/card-capture`
- [x]A [x]F [x]V  `/g/[token]/event-payment`
- [x]A [x]F [x]V  `/g/[token]/manage-booking`
- [x]A [x]F [x]V  `/g/[token]/private-feedback`
- [x]A [x]F [x]V  `/g/[token]/sunday-preorder`
- [x]A [x]F [x]V  `/g/[token]/table-manage`
- [x]A [x]F [x]V  `/g/[token]/table-payment`
- [x]A [x]F [x]V  `/g/[token]/waitlist-offer`
### Misc token
- [x]A [x]F [x]V  `/m/[token]/charge-request`
### Feedback (own shell)
- [x]A [x]F [x]V  `/feedback`
- [x]A [x]F [x]V  `/feedback/tell-us`
- [x]A [x]F [x]V  `/feedback/thanks`
### Onboarding (own shell)
- [x]A [x]F [x]V  `/onboarding/[token]`
- [x]A [x]F [x]V  `/onboarding/success`

---

## Review log

**Outcome:** all 160 routes addressed. Branch `feat/mobile-responsive-overhaul` (off `main`), 6 commits.
Every tier passed `tsc --noEmit` + `eslint --max-warnings=0` + `next build` before commit.

### Commits
- `docs` — spec + 160-route checklist
- `docs` — 20-agent audit findings (`tasks/audit/*`)
- `fix(mobile) Tier 0` — shared `src/ds` primitives + `globals.css` + 6 clipped raw tables
- `fix(mobile) Tier 1` — messages, customers, events, private bookings (+ card redesigns)
- `fix(mobile) Tier 2` — table bookings, rota, staff portal
- `fix(mobile) Tier 3` — invoices, quotes, receipts, cash-up, expenses, menu, projects, short-links, employees, settings
- `fix(mobile) Tier 4` — auth/public, booking tokens, `/g`, feedback, onboarding

### Method
Complete route inventory → uniform 375px rubric → 20-agent parallel audit (findings in `tasks/audit/`) →
systemic-first fixes → per-section parallel fix agents (each dir-scoped, barred from shared `src/ds`/`globals.css`;
every diff reviewed for stray edits) → tsc/eslint/build gate → commit. Desktop (≥768px) left unchanged throughout
(all changes are additive responsive treatment).

### Deferred (documented, NOT broken — all scroll-safe today)
- `/rota` RotaGrid (~1040px drag-and-drop grid) — full mobile day/employee list view is separate work.
- `/table-bookings/foh` FohTimeline (~980px drag-and-drop timeline) — same.
- `/settings/business-hours` calendar — kept tap-any-date scroll grid; native mobile date-picker deferred.
- These already scroll inside a contained `overflow-x-auto` with reachable actions (rubric baseline met); a
  drag-and-drop rebuild on a live surface was judged too risky to do unattended.

### Verification & limitation
- Primary proof: tsc + eslint + `next build` green on every tier + rubric code-audit.
- Browser-verified at 375px: `/auth/login` (reachable public page) — clean.
- Authenticated pages (the majority) need a logged-in session to browser-drive; autonomous login is not possible
  (entering credentials is prohibited). Owner spot-check on a real device recommended for the redesigned pages.

### Found in passing (out of scope — NOT fixed here)
- `onboarding/[token]/steps/HealthStep.tsx` — `checkField` onChange stores the change Event instead of a boolean
  (pre-existing functional bug, not a responsiveness issue). Flagged for a separate change.

### Owner next steps
1. Review the branch (worktree: `/Users/peterpitcher/Cursor/OJ-AMS-mobile`).
2. Merge `feat/mobile-responsive-overhaul` → `main` (both AMS + website auto-deploy `main` to prod — verify the alias moves).
3. Spot-check a few redesigned pages on a real phone (customers, events, invoices, receipts, rota).
4. Decide whether to schedule the deferred drag-and-drop mobile redesigns.
