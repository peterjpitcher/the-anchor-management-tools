# Plan: design system alignment

Spec: `tasks/spec-2026-09-26-design-system-alignment.md`. Rules: `docs/standards/UI_UX.md` (page contract). Branch `refactor/ds-alignment`, worktree `../OJ-AMS-ds-alignment`. Owner decisions recorded in the spec, section 6.

## Waves

- [x] Wave 0: DS foundation (Section padding, PageLayout rhythm and breakpoints, shell landmarks, PageLoading inline, FormFooter, StatGrid, SHELL_MEDIA_QUERY, Quotes gate, page contract). Commit ab429d21.
- [ ] Wave 1: mechanical codemods (FormGroup, EmptyState, Badge and Alert tones, toast imports, icons, dead compat code) and the page-contract guard with its baseline.
- [ ] Wave 2: section owners apply the whole contract to their files, in parallel, on disjoint file sets (table below).
- [ ] Wave 3: cross-cutting clean-up: shared status maps, DS Pagination removal, Headless UI removal, chart approach, BEM CSS and dead selectors in globals.css, design-system reference page, token-guard additions, docs drift.
- [ ] Wave 4: full gates, adversarial consistency review across sections until no new findings, browser check of the DS pieces at 390, 800 and 1280px.
- [ ] Owner go-ahead to merge and deploy; verify the production deployment.

Gate for every wave: `npm run lint`, `npx tsc --noEmit`, `npm run typecheck:tests`, `npm test`, `npm run test:utc`, `npm run build`, both guards.

## Wave 2 owners

Each file has exactly one owner. Tests belong to the owner of the file they test.

| Owner | Files |
|---|---|
| S1 invoicing | `(authenticated)/invoices`, `(authenticated)/quotes`, `components/features/invoices`, `components/modals/EmailQuoteModal.tsx`, `components/modals/ChasePaymentModal.tsx`, `(authenticated)/parking/_components/RefundHistoryTable.tsx`, `(authenticated)/parking/_components/RefundDialog.tsx` |
| S2 books | `(authenticated)/receipts`, `expenses`, `mileage`, `mgd`, `cashing-up` |
| S3 private bookings | `(authenticated)/private-bookings`, `(authenticated)/private-booking`, `components/private-bookings`, `components/features/private-bookings`, `components/features/catering`, `next.config.mjs` (redirects only) |
| S4 employees | `(authenticated)/employees`, `components/features/employees`, `components/modals/AddNoteModal.tsx`, `AddEmergencyContactModal.tsx`, `EditEmergencyContactModal.tsx` |
| S5 rota | `(authenticated)/rota` |
| S6 settings | `(authenticated)/settings` except `settings/design-system` |
| S7 admin | `(authenticated)/users`, `roles`, `profile`, `recruitment`, `dashboard`, `insights`, `feedback-inbox`, `maintenance`, `(authenticated)/error.tsx`, `components/features/feedback` |
| S8 tables and parking | `(authenticated)/table-bookings` except `foh/`, `components/features/table-bookings`, `(authenticated)/parking` except the two refund files |
| S9 events | `(authenticated)/events`, `components/features/events`, `components/schedule-calendar` |
| S10 customers and comms | `(authenticated)/customers`, `components/features/customers`, `(authenticated)/messages`, `components/features/messages`, `(authenticated)/marketing`, `(authenticated)/short-links` |
| S11 menu | `(authenticated)/menu-management`, `components/features/menu` |
| S12 checklists, vouchers, OJ Projects | `(authenticated)/checklists`, `vouchers`, `oj-projects` |
| S13a guest | `app/g`, `components/features/guest`, `components/features/shared`, `app/booking-portal`, `app/parking`, `app/recruitment`, `app/privacy`, `app/legacy-link`, `app/(feedback)`, `app/table-booking`, `app/booking-success`, `app/booking-confirmation`, `app/r`, `app/(dev)`, new public `not-found.tsx` and `error.tsx`, the guest token block in `globals.css` |
| S13b sign-in, kiosk, standalone | `app/auth`, `app/login`, `app/error`, `app/unauthorized`, `app/global-error.tsx`, `app/(timeclock)`, `app/(event-kiosk)`, `app/(staff-portal)`, `app/(employee-onboarding)`, `app/invoice-portal`, `app/page.tsx` |

Not owned in wave 2 (left for wave 3 or untouched): `src/ds`, `globals.css` outside the guest block, `components/charts`, `components/providers`, `settings/design-system`, `src/lib/**/status-ui*`, and the FOH exempt files (`table-bookings/foh`, `components/foh`, `ds/shell/FohClockBand.tsx`, `ds/shell/Topbar.tsx`).

## Results

(filled in as each wave lands)
