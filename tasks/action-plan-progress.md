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
| PR-21 / A-009 | done | Parking refunds use real `parking_bookings` columns and regression test covers pending refunds. |
| PR-22 / A-010 | done | Deposit-timeout cron now requires expired `hold_expires_at`, skips captured deposits, expires hold/payment rows, and has route tests. |
| PR-23 / A-011 | done | Candidate cancellation clears `booking_token_used_at`, cancelled appointments are not returned as current, and service tests cover rebooking. |
| PR-24 / A-012 | done | Recruitment calendar retry now deletes orphaned Outlook events for cancelled appointments; test covers the retry path. |
| PR-32 / A-013 | done | Private-booking cancellation refund threshold uses Europe/London calendar days; BST boundary test added. |
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
| A-117 | todo | Included by owner request. |
