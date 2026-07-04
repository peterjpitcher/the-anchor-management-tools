# Re-verification of June 2026 UI/UX report (tasks/section-review-ui-ux-findings.md) @ HEAD 76655f69

## HIGH items

1. **DS `Checkbox` silent data loss** — **FIXED** — `src/ds/primitives/Checkbox.tsx:13` now types `onChange?: (checked: boolean) => void` on a native `<input>` (line 57), no try/catch; consumer `employees/new/NewEmployeeOnboardingClient.tsx:758,763` uses `(checked) => updateHealth(...)`.
2. **GDPR "Export My Data" omits messages** — **FIXED** — `src/app/actions/profile.ts:222-247`: resolves customer IDs from `customers` for the user, then `messages .in('customer_id', customerIds)`; query errors are surfaced, not reported as success.
3. **Parking guest payment-failure masked** — **FIXED** — `src/app/parking/guest/[id]/paymentNotice.ts:12-33` has explicit `error`-tone branches for `missing_parameters`/`not_found`/`failed`/`retry_failed`; page passes `paymentNotice` down (`page.tsx:33-39`) and `canRetryParkingPayment` (line 98) enables retry.
4. **Sidebar nav no permission gating** — **FIXED** — `src/ds/shell/SidebarNav.tsx:15,30-58` carries per-item `permission` metadata; `filterNavGroupsForPermissions` (SidebarNav.tsx:79-91) applied in `AppShell.tsx:36` via `hasPermission`.
5. **`AppNavigation.tsx` dead code** — **FIXED** — file deleted; no `AppNavigation` references anywhere in `src/`.
6. **Customers bulk SMS/Email dead** — **FIXED** — `customers/_components/CustomersClient.tsx:323-329` `openBulkSmsForSelected` routes to `/messages/bulk?customerIds=…`; button wired at line 454, gated by `canSendBulkMessages` (dead email button removed).
7. **"Prospective" status rejected by schema** — **FIXED** — `NewEmployeeOnboardingClient.tsx:28` type is `'Active' | 'Former' | 'Onboarding'`, matching `services/employees.ts:127` enum; the option is no longer offered.
8. **Table booking cannot be edited** — **FIXED** — `table-bookings/[id]/BookingDetailClient.tsx:1007` `openBookingEdit` + edit modal with `handleSubmitBookingEdit` (:1294) and party-size edit (:1015).
9. **Sunday pre-order no admin surface** — **FIXED** — same file: `preorderItems` rendered (:494,575) and editable before cutoff (`openPreorderEdit` :897, cutoff check :497-498).
10. **Parking no edit / no cancel confirm / no rate UI** — **FIXED** — `ParkingClient.tsx:154,271` edit modal calling `updateParkingBookingDetails` (`actions/parking.ts:429`); cancel goes through `ConfirmDialog` (:928, `setCancelTarget` :657); a permission-gated "Rates" tab with `rateForm` (:159-183) manages hourly/daily/weekly/monthly rates.
11. **Rota drag-drop keyboard-inaccessible** — **FIXED** — `rota/RotaGrid.tsx:634-636` adds `KeyboardSensor` with `sortableKeyboardCoordinates` alongside `PointerSensor`.
12. **Rota `_components/` dead demo tree** — **FIXED** — directory deleted.
13. **Rota modals hand-rolled** — **PARTIALLY FIXED** — modals now use `@/ds` Button/Input/Select/Alert (`CreateShiftModal.tsx:6-10`), but all 6 rota modals still render bespoke `fixed inset-0` overlays (`CreateShiftModal.tsx:76`, `ShiftDetailModal.tsx:211`, plus AddShifts/MarkSick/BookHoliday/HolidayDetail) — no DS `Modal`, no focus trap/Escape found.
14. **Pay bands create-only** — **FIXED** — `actions/pay-bands.ts:102` `updatePayAgeBand`, `:214` `updatePayBandRate`; `PayBandsManager.tsx:75-90` has inline rate editing wired to them.
15. **API keys cannot be revoked** — **FIXED** — `ApiKeysManager.tsx:12,201-220` wires `revokeApiKey` and `deleteApiKey` with `ConfirmDialog` (:365-370) and toasts.
16. **Roles name/description uneditable** — **FIXED** — `roles/[id]/edit/page.tsx` exists and renders the form with `action={updateRole}` (:47).
17. **Users role filter no-op + fake badge** — **FIXED** — `users/_components/UsersContent.tsx:35-71` builds real role options from `UserSummaryWithRoles`, and `roleFilter` actually filters (`:71`); real roles rendered, no hardcoded "User".
18. **Invoices credit-note UI orphaned** — **FIXED** — `invoices/[id]/InvoiceDetailClient.tsx:5` imports `createCreditNote`; credit-note form state and validation at :258-514.
19. **OJ-Projects clients/billing/entries** — **FIXED** — `ClientsClient.tsx` has `createOJClient`/`updateOJClient`/`deleteOJClient` with modal + permission gates (:192-214) and a billing editor (`billing_mode`, retainer hours/rate :95-180); `entries/page.tsx:8-26` now paginates (`pageSize 50`).
20. **Messages holding raw-UUID + swallowed errors** — **FIXED** — `messages/holding/_components/HoldingQueueActions.tsx:6` uses `CustomerSearchInput`; `result.error` surfaced (:47-64); page renders load errors (`holding/page.tsx:51-52`).
21. **Messages 3-panel breaks on mobile** — **FIXED** — `MessagesClient.tsx:505` `grid-cols-1 lg:grid-cols-[320px_1fr_280px]` with `showMobileThread` toggle + back affordance (:507,581,598).
22. **Recruitment silent actions / no confirmations / no pagination** — **FIXED** — `RecruitmentDashboardClient.tsx`: errors surfaced via `setState({error})`/`setClientMessage` (:1245-1801), `ConfirmDialog` + `DECISION_CONFIG` confirmations incl. danger reject (:116-121), `TablePagination` in use (:36). (Feedback is inline state, not toasts — acceptable but noting.)
23. **Receipts delete no confirm + mobile loses features** — **FIXED** — `ReceiptTableRow.tsx:389-395` `ConfirmDialog` on file delete; `ReceiptsClient.tsx:165,175` ships an explicit `md:hidden` mobile path.
24. **Onboarding submit swallows errors** — **FIXED** — `onboarding/[token]/steps/CreateAccountStep.tsx:49-51` now has `catch (caught)` before `finally`.
25. **Public table-booking mockup** — **FIXED** — `(table-booking)/table-booking/_components/` and `PublicBookingClient.tsx` deleted.
26. **DataTable sort headers inaccessible** — **FIXED** — `src/ds/composites/DataTable.tsx:402` sets `aria-sort`, headers are real `<button>`s (:334,413). (Mobile card rows still mouse-only — see theme 16.)
27. **Staff portal: no leave cancel / errors as empty / no sign-out** — **FIXED** — `portal/leave/page.tsx:7,133` `CancelLeaveRequestButton` on pending rows; errors surfaced (:70-71); sign-out form in `(staff-portal)/layout.tsx:36-41`.
28. **Leave manager queue: no edit/delete, no confirm** — **FIXED** — `rota/leave/LeaveManagerClient.tsx:9-10` wires `deleteLeaveRequest`/`updateLeaveRequestDates`; inline date editing (:66-95) and `ConfirmDialog` on decision + delete (:70-71).

## Cross-cutting themes

1. **Dead/duplicate client components** — **no longer applies (spot-checked)** — dead `customers/CustomersClient.tsx`, `rota/_components/`, `table-bookings/_components/`, `AppNavigation.tsx`, `PublicBookingClient.tsx` all deleted.
2. **Nav permission gating** — **resolved** — `filterNavGroupsForPermissions` (SidebarNav.tsx:79) consumed by AppShell.
3. **Dead controls** — **resolved (spot-checked)** — events category filter wired (`EventsClient.tsx:108`), `UtmDropdown` gone, users role filter works, customers bulk wired.
4. **Destructive actions without confirmation / native `confirm()`** — **mostly resolved** — `window.confirm/alert` down to 3 occurrences in 2 files (`settings/calendar-notes/CalendarNotesManager.tsx`, `invoices/[id]/InvoiceDetailClient.tsx`); ConfirmDialog now standard elsewhere.
5. **ConfirmDialog closes synchronously** — **resolved** — `src/ds/primitives/ConfirmDialog.tsx:10,74`: `onConfirm: () => unknown | Promise<unknown>` is awaited, with internal loading + `loadingText`.
6. **Missing loading states** — **still applies** — only 8 section-level `loading.tsx` (customers, dashboard, employees, events, invoices, private-bookings, rota, table-bookings); parking, receipts, messages, settings, recruitment etc. still lack them.
7. **Errors swallowed / conflated with empty** — **partially resolved** — worst cases fixed (holding queue, recruitment, staff portal, parking guest); but e.g. `rota/leave/page.tsx:32` still `requestsResult.success ? requestsResult.data : []`.
8. **No section-level error boundaries** — **still applies** — exactly one `error.tsx` (`(authenticated)/error.tsx`).
9. **No inline field-level validation** — **still applies** — `aria-invalid` appears only 7 times app-wide, mostly in DS primitives; section forms remain server-deferred/toast-first.
10. **No unsaved-changes guard** — **still applies** — `beforeunload` only in the 3 menu-management drawers; events drawer, invoices/quotes, settings unguarded.
11. **Un-debounced search** — **resolved** — `SearchInput.tsx:55-67` now implements `debounceDelay` (setTimeout); customers passes `debounceDelay={350}` (CustomersClient.tsx:445).
12. **Unbounded lists** — **partially resolved** — receipts, mileage trips (`MileageClient.tsx:78`), oj-entries (50/page), recruitment, event attendees (`EventDetailClient.tsx:989-1316`, 25/page) now paginated; leave manager queue and others still unbounded.
13. **Hand-rolled / non-`@/ds` inputs** — **still applies** — `expenses/_components/ExpenseForm.tsx` has 0 `@/ds` imports vs 7 native `<input>/<select>`; rota modal shells still bespoke.
14. **Hardcoded colours** — **partially applies** — 22 hex/`bg-gray-200`-class hits remain inside `src/ds` alone; reduced but not eliminated.
15. **Shared-primitive a11y defects** — **resolved** — Checkbox and Radio are native `<input>`s; DataTable has `aria-sort` + button headers; `Tabs.tsx:67-102` and `SectionNav.tsx:37-63` have `role="tablist"`, `aria-controls`, arrow-key nav.
16. **Clickable rows without keyboard operability** — **still applies** — `DataTable.tsx:265-295` mobile cards are `<div onClick>` with no `role`/`tabIndex`/`onKeyDown`.
17. **Hand-rolled modals** — **still applies** — 11 files still use `fixed inset-0` overlays: 6 rota modals, timeclock client, expenses viewer/client, recruitment dashboard.
18. **Raw date handling** — **still applies** — 90 `toLocaleDateString`/`toISOString` occurrences in `(authenticated)` tsx files.
19. **No success toasts** — **still applies for expenses/mileage** — exactly 1 `toast.success` across both sections.
20. **Two page shells / fragmented DS** — **still applies** — PageLayout in 74 files vs PageHeader in 30; 54 files still import raw `react-hot-toast`.

## Top 10 CRUD gaps still open

1. **Cashing-up session — no delete/void** — no `deleteCashup`/`voidCashup` action exists anywhere in `src/app`; a mis-entered cash-up is permanent. (Approve/lock/unlock and daily targets are now wired — `DailyClient.tsx:12-16,368-475` — so only void/delete remains.) Financial-record correction requires SQL.
2. **Employee document/attachment — cannot edit category/description** — no `updateEmployeeAttachment`-style action (only `updateAttachmentCategory` for the category entity itself, `actions/attachmentCategories.ts:93`); still delete + re-upload for HR documents.
3. **Recruitment email templates — edit-only** — no `createRecruitmentEmailTemplate`/`deleteRecruitmentEmailTemplate` in the codebase; seeded rows only, so new hiring comms types can't be added from UI.
4. **Messages — no resend-failed / archive / delete conversation** — zero `resend|archive` matches in `MessagesClient.tsx`; a failed outbound SMS can't be retried from the conversation (only via the separate `settings/sms-failures` retry, `sms-failures/actions.ts:41`), and conversations can't be archived.
5. **Menu / Menu Category — no management UI** — no `createMenu`/`deleteMenu`/`createMenuCategory` actions exist; menus remain seed-only, so menu structure changes need SQL.
6. **Timeclock kiosk — no on-kiosk undo for mis-clock** — no undo affordance in `(timeclock)`; a wrong clock-in/out still requires a manager fixing it elsewhere.
7. **Receipts transaction — CSV-import only, no manual create, no row delete** — no `createTransaction`/`deleteTransaction`/`addTransaction` in `actions/receipts*.ts`; a stray or missing transaction can't be corrected in-UI.
8. **Expenses category — still a fake entity** — `actions/expenses.ts:25,95` still models free-text `company_ref` (no category table/UI); budget/category reporting can't be made reliable.
9. **Staff portal payslip — no real entity** — only guidance copy referencing "your payslip" (`portal/shifts/page.tsx:631`); no payslip list, detail, or PDF download for staff.
10. **Rota sales-target override — no removal path** — no `deleteSalesTarget`/`removeOverride`/`deleteTargetOverride` action exists; a wrong override can only be overwritten, never cleared.

Runners-up verified still open: leave manager queue unbounded (no pagination in `LeaveManagerClient.tsx`); `oj-projects` project-contact add is defined but only `removeProjectContact` is imported by `ProjectDetailClient.tsx:28` (add path uncertain). Verified **closed** since the review: parking rates UI, quotes now editable when sent/expired (`quotes/[id]/edit/page.tsx:84`), mileage distance delete (`deleteDistanceCache`, `actions/mileage.ts:982`), profile avatar remove (`actions/profile.ts:452`), parking-guest retry, employee self-cancel leave, calendar-note update/delete actions (`actions/calendar-notes.ts:389,489`).

## Summary counts

- **HIGH (28 items):** 27 FIXED, 1 PARTIALLY FIXED (#13 rota modal shells still hand-rolled `fixed inset-0`), 0 STILL OPEN, 0 CANNOT VERIFY.
- **Themes (20):** 7 resolved, 4 partially resolved, 9 still apply (6, 8, 9, 10, 13, 16, 17, 18, 19, 20).
- **CRUD matrix:** headline HIGH-tier gaps all closed; the 10 gaps above are the most impactful ones verified still true — mostly delete/void/correction paths and seed-only entities.

The 2026-06-24 review has been very substantially remediated — remaining work is concentrated in shared-pattern debt (loading/error boundaries, field-level validation, hand-rolled modals, raw dates) rather than broken features.
