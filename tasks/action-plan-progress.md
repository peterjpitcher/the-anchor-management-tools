# Full Action-Plan Progress

Baseline: `main` at `18ba92b0`.

Status values:
- `done-before-start`: verified in earlier commits.
- `done`: completed on `codex/action-plan-everything`.
- `todo`: not implemented yet.
- `blocked`: cannot be completed without an external dependency.

## Current checkpoint

- `done-before-start`: PR-01, PR-02, PR-03, PR-04, PR-05, PR-06, PR-07, PR-08, PR-S1, PR-S3, PR-S6, PR-10 partial, PR-11, PR-12, PR-13, PR-15, PR-16, PR-18-grant, rota audit/shift-request email work.
- `in-progress`: Phase 2 high-risk money/flow fixes.
- `todo`: everything else in `tasks/action-plan.md` and `tasks/remediation-spec.md`, including A-117.

## Proof log

| Unit | Status | Proof |
|---|---|---|
| PR-01 / A-001 | done-before-start | Commit `18ba92b0`, migration `20260708000014_drop_timeclock_anon_update.sql`, Supabase push applied. |
| PR-02 / A-002 | done-before-start | Commit `18ba92b0`, `/m` added to middleware public prefixes. |
| PR-03 / A-019/A-055 | done-before-start | Commit `18ba92b0`, DS Checkbox rebuilt and tested. |
| PR-04 / A-020 | done-before-start | Commit `18ba92b0`, DataTable sortable headers use buttons/aria-sort. |
| PR-05 / A-054 | done-before-start | Commit `18ba92b0`, ConfirmDialog async-safe. |
| PR-06 / A-056/A-057 | done-before-start | Commit `18ba92b0`, Tabs and Field accessibility tests. |
| PR-07 / A-058 partial | done-before-start | Commit `18ba92b0`, roles/receipts empty checkbox labels fixed. |
| PR-08 / A-021/A-022 | done-before-start | Commit `18ba92b0`, nav permission filtering and tests. |
| PR-S6 / A-093 partial | done-before-start | Commit `18ba92b0`, BOH table-booking server route gating. |
| PR-10 / A-003 | done-before-start | Commit `18ba92b0`, daily summary RBAC gates. |
| PR-10 / A-006 | done-before-start | Commit `18ba92b0`, `getEventBookings` checks `events:view` before admin PII query. |
| PR-11 / A-004 | done-before-start | Commit `18ba92b0`, holiday usage ownership/RBAC. |
| PR-12 / A-005 | done-before-start | Commit `18ba92b0`, pay-band/rate/budget read gates. |
| PR-13 / A-007 | done-before-start | Commit `18ba92b0`, AI menu parsing gates. |
| PR-15 / A-014 | done-before-start | Commit `18ba92b0`, permission cache invalidation. |
| PR-16 / A-015 | done-before-start | Commit `18ba92b0`, role permission self-escalation block. |
| PR-18-grant / A-008 prep | done-before-start | Commit `18ba92b0`, migration `20260708000015_add_payments_capture_api_scope.sql`, Supabase push applied. |
| PR-S1 / A-086 partial | done-before-start | Commit `18ba92b0`, mark-read/write gates. |
| PR-S2 / A-088 partial | done-before-start | Commit `18ba92b0`, `sendPayrollEmail` checks `payroll:send`; permission exists in `20260228100000_rota_system.sql`. |
| PR-S3 / A-081 partial | done-before-start | Commit `18ba92b0`, private-booking items layout gate. |
| PR-18b / A-008 external PayPal scopes | done | Event and table booking external PayPal create/capture routes require `payments:capture`; test `tests/api/eventPayPalExternalScope.test.ts`. |
| PR-19 / A-063 | done | PayPal capture/refund helpers now normalize and return currency; capture callers pass expected currency; table/private/portal/reconciliation/parking flows validate PayPal order/capture currency; event and parking refunds use source payment currency. Tests: `src/lib/__tests__/paypal-refund.test.ts`, PayPal route/action focused tests, full `npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run build`, Supabase dry-run. |
| PR-20 / A-064 | done | PayPal refund fallback no longer marks non-`COMPLETED` refunds completed; pending PayPal refunds remain pending on local post-processing failure. Existing `calculate_refundable_balance`/`reserve_refund_balance` RPCs were verified to count `completed` + `pending` refunds. Regression: `src/app/actions/__tests__/refundActions.test.ts`; full `npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run build`, Supabase dry-run. |
| PR-21 / A-009 | done | Parking refunds use real `parking_bookings` columns and regression test covers pending refunds. |
| PR-22 / A-010 | done | Deposit-timeout cron now requires expired `hold_expires_at`, skips captured deposits, expires hold/payment rows, and has route tests. |
| PR-23 / A-011 | done | Candidate cancellation clears `booking_token_used_at`, cancelled appointments are not returned as current, and service tests cover rebooking. |
| PR-24 / A-012 | done | Recruitment calendar retry now deletes orphaned Outlook events for cancelled appointments; test covers the retry path. |
| PR-32 / A-013 | done | Private-booking cancellation refund threshold uses Europe/London calendar days; BST boundary test added. |
| PR-S5 / A-082 | done | Customer list counts now use exact server counts, SMS stat cards use exact full-result counts instead of current-page rows, and import dedup runs globally inside the atomic import RPC; source regression test, typecheck, lint, and Supabase dry-run pass. |
| PR-25 / A-016 | done | Avatar upload validates size, MIME allowlist, and file signatures; stored extension is derived from MIME; action tests cover rejects. |
| PR-31 / A-017 | done | Manual mileage create/update now uses transactional RPCs with in-DB tax-year recalculation; rollback SQL added; dry-run passed. |
| PR-17 / A-018 | done | RBAC role/permission and user/role replacements now diff-and-apply additions before removals; tests cover insert-failure safety. |
| PR-50 / A-023 | done | Customer selections now open bulk SMS with eligible recipients preselected; dead Email action removed; parser test added. |
| PR-51 / A-024 | done | New-employee status dropdown now uses schema-valid `Onboarding`; create failures surface server field errors in the toast. |
| PR-52 / A-025 | done | Table-booking detail now has validated admin edit for date/time/customer/notes/dietary/allergies, loads saved preorder items, and allows legacy preorder item edits before cutoff; focused API tests added. |
| PR-53 / A-026 | done | Parking bookings now have edit flow, cancel confirmation, and rates management UI backed by validated/audited actions; action tests added. |
| PR-54 / A-027 | done | Rota drag-and-drop now registers `KeyboardSensor` with `sortableKeyboardCoordinates`; source regression test added. |
| PR-55 / A-028 | done | Pay age bands can be edited/reactivated/deactivated; future pay-band rates and employee overrides can be edited while historical/current rates stay protected; tests added. |
| PR-56 / A-029 | done | API key table now exposes edit, revoke, and delete actions with confirmations; `deleteApiKey` action and tests added. |
| PR-57 / A-030 | done | Parking guest payment failures now show explicit error states, pending/failed bookings show a retry/pay button, and the retry route only redirects active payable bookings to PayPal; focused tests added. |
| PR-58 / A-031 | done | Profile GDPR self-export now resolves linked customer ids by email before exporting messages and fails visibly on customer/message query errors; action tests added. |
| PR-59 / A-032 | done | Roles now have `/roles/[id]/edit`, custom role cards expose an Edit button, and the existing audited `updateRole` action backs the form; component test added. |
| PR-60 / A-033 | done | Users are now enriched with real joined roles, the role column renders actual badges, and the role filter uses those role ids; service and component tests added. |
| PR-61 / A-034 | done | Paid invoice detail now exposes an Issue Credit Note flow backed by `createCreditNote`, with amount/reason validation, VAT estimate, refresh, and component coverage. |
| PR-62a / A-035 clients | done | OJ clients now have create/edit/delete UI backed by OJ-scoped validation, RBAC, audit logs, revalidation, and action tests. |
| PR-62b / A-035 billing settings | done | Client drawer now exposes vendor billing settings editor backed by audited/revalidated `upsertVendorBillingSettings`; action tests cover audit/revalidation. |
| PR-62c / A-035 entries pagination | done | OJ entries now load counted 50-row pages with `TablePagination`; action tests cover `range()` and total count. |
| PR-63 / A-036 | done | `getClientBalance` now uses an unbounded unsettled-invoice query for money totals and keeps the 50-invoice cap only for display; regression test covers 60 invoices. |
| PR-64 / A-037 | done | Messages holding queue now uses `CustomerSearchInput`, highlights suggested customer IDs, surfaces link/ignore errors inline, and refreshes on success; component tests added. |
| PR-65 / A-038 | done | Messages page now switches to a single-column mobile list/thread flow with a Back affordance while keeping the desktop 3-panel layout; responsive component test added. |
| PR-66 / A-039 | done | Recruitment actions now use feedback/confirmation forms for silent and destructive flows, applications table paginates at 25 rows, and tests cover pagination plus candidate-erasure confirmation. |
| PR-67 / A-040 | done | Receipt file deletion now requires confirmation on desktop and mobile; mobile workspace now exposes upload/export/reclassify controls while rules remain available; component tests added. |
| PR-68 / A-041 | done | Onboarding account, section, and final-submit handlers now catch thrown action errors and show them inline; component tests cover all three action paths. |
| PR-39 / A-042 | done | Onboarding financial and health saves now write audit events with employee identity and section metadata only; action tests assert raw NI, bank, and health values are not logged. |
| PR-40 / A-043 | done | BOH table-booking soft-cancel and hard-delete branches now write audit events with actor, old values, result metadata, and action labels; API tests cover both paths. |
| PR-68 / A-044 | done | Staff portal employees can cancel their own pending holiday requests, cancel/load failures show inline, and the portal layout now has a sign-out control; action and UI tests added. |
| PR-69 / A-045 | done | Leave manager rows now confirm approve/decline, expose edit-date and delete actions behind `leave:edit`, and update/remove rows inline; component tests cover confirm/edit/delete paths. |
| PR-70 / A-046 | done | Recurring-invoice cron now transitions generated invoices to sent before email delivery, so failed Graph sends cannot leave sealed draft invoices; cron regression test covers the failure path. |
| PR-71 / A-047 | done | Invoice VAT is rounded per line before summing, and invoice detail totals now display persisted subtotal/VAT/total values; calculator and component regressions added. |
| PR-72 / A-048 | done | The top invoice action now routes to Record Payment instead of calling the rejected `paid` status transition; component test asserts `Mark as Paid` is gone. |
| PR-73 / A-049 | done | Receipt signed uploads now persist issued upload intents and completion rejects paths not issued to that transaction/user; migration, rollback, and action regressions added. |
| PR-74 / A-050 | done | Employee CSV exports now prefix formula-triggering cell values before CSV escaping; service test covers `=`, `+`, `-`, `@`, tab, and carriage-return prefixes. |
| PR-75 / A-051 | done | Dish cost helpers now track unpriced ingredients/recipes and GP analysis/composition surfaces cost-incomplete warnings instead of silently inflating GP%; helper and component tests added. |
| PR-76 / A-052 | done | Holiday allowance counts now ignore Saturdays, Sundays, and employee-specific non-working weekdays from pay settings; migration/rollback, action, helper, typecheck, lint, and Supabase dry-run all pass. |
| PR-14a-c / A-053 | done | Exported customer-label, site-settings, missing-cashup, menu-target, and payroll-period actions now re-check RBAC before data/service access; payroll cron/staff portal use internal helpers after their own auth; denied-path tests, typecheck, and lint pass. |
| PR-77 / A-054 | done-before-start | `ConfirmDialog` already awaits async `onConfirm`, keeps controls disabled while pending, preserves the dialog on errors, and surfaces the error; `tests/components/ds-primitives.test.tsx` passes. |
| PR-78 / A-055 | done | DS `Radio` now uses a real labelled radio input instead of a button role shim; checkbox/radio label tests, typecheck, and lint pass. |
| PR-79 / A-056 | done | DS `Tabs` already had tablist semantics and arrow-key coverage; `SectionNav` now exposes tablist/tab semantics with roving arrow-key focus/selection; DS tests, typecheck, and lint pass. |
| PR-80 / A-057 | done | DS `Field` now keeps hint and error text rendered together and wires both into `aria-describedby` with `aria-invalid`; DS tests, typecheck, and lint pass. |
| PR-81 / A-058 | done | Added `scope="col"` to remaining JSX raw table headers across app/components/DS tables and verified no TSX `<th>` remains without scope; inspected raw checkboxes for visible labels/aria labels; typecheck and lint pass. |
| PR-41a / A-059 payroll-employees-rbac | done | Added non-PII audit logging for payroll-row deletion, rota-settings updates, employee-note write failures, and RBAC assignments now log readable role/permission names; permission-service tests, typecheck, and lint pass. |
| PR-41b / A-059 private-bookings-parking-vendors | done | Parking booking status audit now records the actor, expired private-booking holds are audited per booking from cron, and vendor-contact CRUD writes non-PII audit events; focused action tests, typecheck, and lint pass. |
| PR-41c / A-059 receipts-mgd-table-moves | done | Receipt requeue now logs queued/failure results without transaction IDs, MGD return status audits include old/new lifecycle metadata, and FOH/BOH table moves audit actor/table/window data; focused tests, typecheck, and lint pass. |
| PR-41d / A-059 recruitment | done | Recruitment mutations now write actor-backed, non-PII audit events for postings, applications, candidates, slots, appointments, communications, hiring, retention, and GDPR erasure; source regression test, typecheck, and lint pass. |
| PR-42a / A-060 mileage | done-before-start | Mileage create/update atomicity was completed under `PR-31 / A-017` with transactional RPCs, rollback SQL, action tests, typecheck, lint, and Supabase dry-run. |
| PR-42b / A-060 recruitment appointments | done | Recruitment claim now marks booking tokens used inside the claim RPC, and public/staff reschedules use one RPC for new-slot booking, appointment update, old-slot release, and status event; migration/rollback, source regression test, typecheck, lint, and Supabase dry-run pass. |
| PR-42c / A-060 receipts bulk classify | done | Receipt bulk group classification now runs selection, row locks, updates, transaction logs, and classification signals inside `apply_receipt_group_classification_atomic`; migration/rollback, focused action test, typecheck, lint, and Supabase dry-run pass. |
| PR-42d / A-060 menu ingredient price history | done | Menu ingredient create/update and inline pack-cost edits now write ingredient rows and price history through transaction RPCs; migration/rollback, source regression test, typecheck, lint, and Supabase dry-run pass. |
| PR-42e / A-060 quote-to-invoice | done | Quote conversion now locks and validates the quote, advances the invoice series, creates invoice and line items, and marks the quote converted in one RPC; migration/rollback, source regression test, typecheck, lint, and Supabase dry-run pass. |
| PR-42f / A-060 customer dedup/import | done | Customer import now normalizes and file-dedups in app, then performs global mobile/email dedup and insert in one `import_customers_atomic` RPC with `ON CONFLICT DO NOTHING`; migration/rollback, source regression test, typecheck, lint, and Supabase dry-run pass. |
| PR-42g / A-060 onboarding emergency contacts | done | Employee onboarding emergency-contact saves now replace contacts in one locked RPC instead of delete/insert compensation; migration/rollback, source regression test, typecheck, lint, and Supabase dry-run pass. |
| PR-42h / A-060 cashing-up child rows | done | Cash-up session saves now write the session, payment breakdowns, cash counts, and sales splits in one locked `upsert_cashup_session_atomic` RPC; migration/rollback, source regression test, typecheck, lint, and Supabase dry-run pass. |
| PR-42i / A-060 expenses delete | done | Expense delete now locks the expense, captures file paths, and deletes expense/file rows in one `delete_expense_atomic` RPC before storage cleanup; migration/rollback, focused tests, typecheck, lint, and Supabase dry-run pass. |
| PR-42j / A-060 onboarding account link | done-before-start | `createEmployeeAccount` already creates the auth user then links employee/token state through `link_employee_invite_account`; added regression coverage that link failure deletes the orphan auth user; focused test, typecheck, and lint pass. |
| PR-43a-e / A-061 optimistic concurrency | done | Leave review now updates only pending rows, BOH/FOH table-booking status changes bind the loaded status, open timeclock sessions and Couldn't Work markers have partial unique indexes, duplicate races get clear action errors, and credit-note numbering is generated by locked RPC; migration/rollback and source regression test added. |
| PR-44 / A-065 Resend webhook idempotency | done | Resend webhooks now claim verified Svix IDs in `webhook_logs`, duplicate deliveries stop before side effects, failed claims can retry, and email status updates preserve newer states while still recording event timestamps; migration/rollback, route tests, typecheck, lint, and Supabase dry-run pass. |
| PR-70 / A-066 expenses validation/sidebar | done | Expenses create/update now reject VAT above gross and non-zero VAT when VAT is not applicable; the sidebar now shows real quarterly supplier spend instead of hard-coded fake category budgets. Tests: `src/app/actions/__tests__/expenses.test.ts`; typecheck and lint pass. |
| PR-71 / A-067 expenses RLS/atomic delete | done | Expense actions now use the request-scoped Supabase client; migration `20260708000031_expenses_permission_rls.sql` adds permission-based table/storage RLS and makes `delete_expense_atomic` enforce `expenses:manage`; rollback added. Tests: `src/app/actions/__tests__/expenses.test.ts`; typecheck, lint, and Supabase dry-run pass. |
| PR-72 / A-068 quotes nullable totals/non-draft edit | done | Quote money fields are normalized to zero at action boundaries; quote detail/convert/email/template paths tolerate null totals; sent/expired unconverted quotes can be edited while accepted/rejected/converted quotes remain blocked. Typecheck and lint pass. |
| PR-73 / A-069 MGD HMRC rate boxes | done | HMRC submission lines now derive machine count and lower/standard/higher rate boxes from return totals instead of hard-coded machine `1` and zero lower-rate boxes. Test: `src/lib/mgd/__tests__/hmrcFormat.test.ts`; typecheck and lint pass. |
| PR-74 / A-070 MGD search/export/async confirm | done | MGD collections and return history now have search and CSV export controls; delete/reopen still use async-safe `ConfirmDialog`; HMRC formatting logic is covered by helper tests. Typecheck and lint pass. |
| PR-75a-c / A-071 cashing-up flows | done | Daily cash-up now exposes approve/lock/unlock, target editing, and confirmed delete for unlocked sessions; submit saves directly as `submitted` through the atomic upsert RPC and logs once; delete cascades child rows. Tests: `tests/components/DailyCashupClient.test.tsx`, `tests/services/cashing-up.service.test.ts`, `tests/services/cashupSessionAtomicitySource.test.ts`; typecheck and lint pass. |
| PR-76 / A-072 cashing-up import/list UX | done | Historic import now validates rows server-side, rejects cash total vs denomination mismatches, requires explicit confirmation, paginates preview rows, and dashboard variance sessions are searchable. Cash-up focused tests, typecheck, and lint pass. |
| PR-82 / A-073 short-links security | done | Short-link create/update/variant paths now enforce an approved destination-host allowlist, staff-created links explicitly set `created_by`, exposed internal creation requires `short_links:manage`, and list counts exclude UTM variants. Test: `tests/services/short-links.service.test.ts`; typecheck and lint pass. |
| PR-83 / A-074 short-links UX/errors | done | Fixed literal short-link error interpolation, added DS `TableCell` colSpan support, fixed short-links empty-state row spanning, changed analytics lookup to `maybeSingle`, and surfaced insights load failures in an alert. Test: `tests/services/short-links.service.test.ts`; typecheck and lint pass. |
| PR-84 / A-075 menu security/correctness | done | Allergen verification now requires an authenticated actor, choice/upgrade rows require option groups in the schema and drawer, allergen choice-group checks use component IDs instead of display names, and pack-cost atomicity remains routed through `menu_update_ingredient_pack_cost`. Tests: `tests/services/menu.service.test.ts`, `tests/services/menuIngredientPriceAtomicitySource.test.ts`, `tests/components/MenuGpA051.test.tsx`; typecheck and lint pass. |
| PR-85 / A-076 menu UX/action fixes | done | Ingredient AI review output is schema-validated, recipe deletes now use the audited server action, menu card active toggles call `toggleDishActive`, and inline currency edits require explicit Save/Cancel instead of blur-commit. Menu focused tests, typecheck, and lint pass. |
| PR-86 / A-077 settings gates/validation/timezone | done | GDPR and Event Categories now have server route gates, site settings use Zod validation for email/URL/deposit/group-size/numeric limits, and Special Hours saves/displays dates through London date utilities. Tests: `tests/actions/settingsMutationGuards.test.ts`, `tests/services/business-hours.service.test.ts`, settings UI tests; typecheck and lint pass. |
| PR-87 / A-078 settings UX/remediation | done | Settings hub links to sub-pages, customer labels expose an icon picker with server validation, and SMS failures have retry/dismiss server actions wired into the failure log. Tests: settings focused tests; typecheck and lint pass. |
| PR-88 / A-079 events security/correctness | done | Event form JSON arrays/FAQs now parse through guarded Zod helpers, event date validation uses the London calendar date, category filters are applied server-side, event-wide cancellation no longer skips non-PayPal paid rows, and staff cancellation refunds are based on amount paid rather than current event price. Tests: `tests/actions/events.test.ts`, `tests/actions/eventsManualBookingGuards.test.ts`, `tests/services/eventsSchema.test.ts`, `tests/api/eventsRouteFilters.test.ts`; typecheck and lint pass. |
| PR-89 / A-080 events attendees/actions UX | done | Event attendee lists now paginate locally, transfer uses a real event picker instead of a raw UUID field, and event-list row actions now open details or edit instead of doing nothing. Tests: event focused tests; typecheck and lint pass. |
| PR-90 / A-081 private-bookings | done | Items route gate was already present; edit now exposes deposit amount, balance due date, and a structured open-dispute flag; cancellation finance uses `private_bookings.has_open_dispute` instead of note regex; payment CTAs use DS buttons; customer SMS/email date formatting uses London dates. Migration/rollback: `20260708000032_private_booking_dispute_flag.sql`. Tests: private-bookings focused tests; typecheck, lint, and Supabase dry-run pass. |
| PR-45 / A-092 timeclock PIN and clock-out robustness | done | Public kiosk clock-in/out now requires a 4-digit PIN, employee edit can set a stored scrypt PIN hash, actions allow authenticated timeclock users or valid PIN/fallback last-four phone, clock-out uses limited `maybeSingle` plus guarded update, and tests cover PIN hashing plus timeclock actions; migration/rollback, typecheck, lint, and Supabase dry-run pass. |
| PR-46 / A-094 webhooks status and idempotency | done | Resend status progression was completed in PR-44; parking `PAYMENT.CAPTURE.DENIED` now marks the parent booking payment status failed, and the general PayPal webhook claims idempotency before audit writes so replayed events do not duplicate audit rows; focused route tests, typecheck, lint, and Supabase dry-run pass. |
| PR-47 / A-095 cron hardening | done | Deposit-timeout was already completed in PR-22; private-booking hold expiry writes per-booking audit events, and recurring-invoices cron 500 responses no longer expose raw database/fatal error details; focused route tests, typecheck, lint, and Supabase dry-run pass. |
| PR-48 / A-114 cron auth constant-time compare | done | `authorizeCronRequest` now hashes both supplied and expected secrets and compares fixed-length digests with `timingSafeEqual`; unit/source regression tests, typecheck, lint, and Supabase dry-run pass. |
| PR-49 / A-115 webhook hardening | done | Resend missing-secret now ACKs without retry storm, Resend auth failures use typed errors, customer email health updates target one customer by id/exact email, PayPal verifies required headers and fresh transmission time before remote verification, event-booking blocked captures notify/audit manual review, and Twilio signature validation uses the configured public URL while reply-to-book stores inbound message/SID trace fields; migration/rollback, focused tests, typecheck, lint, and Supabase dry-run pass. |
| A-117 | todo | Included by owner request. |
