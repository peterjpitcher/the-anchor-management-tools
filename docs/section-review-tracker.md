# Section Review Tracker

This working document lists every authenticated route group and tracks discovery/progress for the business logic review. Sections marked with ✅ were reviewed and remediated by the current agent (2025-09-13 session). Use this table to see exactly what was touched so a new agent can pick up remaining areas without re-treading completed work.

| Section | Route Prefix | Primary Surfaces | Discovery Status | Notes |
|---------|--------------|------------------|------------------|-------|
| Dashboard | `/dashboard` | Overview widgets, quick actions | Remediation applied | ✅ (2025-10-16, Agent Codex) Dashboard now loads via a cached server action with per-section permission gates, graceful fallbacks, and a unified section snapshot covering every module except Settings. |
| Events | `/events` | List, detail, new/edit, check-in, checklist todo | Remediation applied | ✅ Reviewed & patched: permission gates, booking mutations via server actions, checklist UI restrictions |
| Customers | `/customers` | List, profile, bookings, messaging | Remediation applied | ✅ Reviewed & patched: server actions for CRUD/import, permission-guarded UI, bookings aligned |
| Employees | `/employees` | Employee roster & details | Remediation applied | ✅ Roster/detail/edit now server-backed with permission gating; exports enforce `employees:export` and documents use signed URLs with role checks. |
| Invoices | `/invoices` | Invoice list & detail flows | Remediation applied | ✅ (2025-09-13, Agent Codex) Index/list/detail/create/payment/export plus catalog/vendor/recurring pages hardened; remaining work limited to follow-up testing (see section notes). |
| Loyalty | `/loyalty` | Loyalty dashboard & member tools | Removed | ✅ Section decommissioned (routes deleted, navigation entry removed, all actions return disabled response). |
| Messages | `/messages` | Conversations, message center | Remediation applied | ✅ Unread polling now uses user-scoped server actions (no service-role), refresh cadence reduced, and manage-only controls are hidden without `messages:manage`. |
| Parking | `/parking` | Parking management tools | Remediation applied | ✅ Booking lists/notifications now fetch via permission-checked server actions, and manage-only UI (rates, status/payment controls) is hidden for read-only roles. |
| Private Bookings | `/private-bookings` | Lead intake, pipeline, comms | Remediation applied | ✅ Dashboard/detail/calendar/settings now use service-role server actions with permission gating and audit logging; UI hides destructive/manage affordances unless permitted. |
| Profile | `/profile` | User profile & settings | Remediation applied | ✅ Profile loads/mutations/export now run through server actions; client dropped browser Supabase usage and keeps manage actions gated per user. |
| Quotes | `/quotes` | Quote management | Remediation applied | ✅ (2025-09-13, Agent Codex) Permissions gated and UI hardened; see section notes for residual testing follow-up. |
| Receipts | `/receipts` | Receipt workspace, bulk review, vendor trends | Remediation applied | ✅ Reviewed & patched: permission enforcement (actions + pages), UI disables, retro-run safeguards |
| Roles | `/roles` | Role management | Remediation applied | ✅ Role CRUD and permission assignment run through service-role actions with audit logging; UI now distinguishes read-only viewers from managers and disables destructive controls for system roles. |
| Settings | `/settings` | Org-wide configuration (subsections) | Remediation applied | ✅ (2025-10-16, Agent Codex) SMS delivery tooling now enforces `sms_health:view` + `customers:view`, hydrates data via server actions, and prior migrations were verified. |
| Short Links | `/short-links` | Short link campaigns & analytics | Remediation applied | ✅ Server actions now gate list/create/update/delete/analytics by permission, UI consumes them without browser Supabase, and create/edit affordances are hidden for read-only roles. |
| Table Bookings | `/table-bookings` | Table booking management & calendar | Remediation applied | ✅ Dashboard data + stats now load through permission-checked server actions; client widgets consume them without browser Supabase and hide manage-only controls when roles lack access. |
| Unauthorized | `/unauthorized` | Access denied surface | Discovery complete | No issues—confirm redirect flows land here and consider logging denied attempts for audit visibility. |
| Users | `/users` | User management | Remediation applied | ✅ (2025-10-16, Agent Codex) Manage affordances require `users:manage_roles`, role assignments load via service-role helpers, and user listings rely on admin-gated fetches. |

## Dashboard — Remediation Notes (2025-10-16)

**What changed**
- Replaced the direct service-role component with `loadDashboardSnapshot`, a cached server action that fans queries out only after confirming module-level permissions and logging permission lookups.
- Each widget now gracefully degrades: unauthorised users receive restricted messaging, upstream errors surface as EmptyState notices, and data fetches no longer leak via console errors.
- Added a Section Snapshot card that surfaces every section (excluding Settings) with live counts or state badges so operators can audit coverage at a glance, including the loyalty decommission notice.
- Topline metrics, booking lists, parking summaries, and invoice widgets now reuse the snapshot payload, removing duplicated Supabase calls and centralising formatting.

**Next steps**
- Align quick action tiles with corresponding "create/manage" permissions so restricted roles do not hit downstream denials when launching shortcuts.
- Monitor cache hit rates for `loadDashboardSnapshot` once production telemetry is available; consider shortening the revalidation interval if time-sensitive counts drift.

## Settings — Remediation Notes (2025-10-16)

**What changed**
- Attachment categories now rely on server actions with `settings:manage` checks, audit logging, and page-level permission gating. The client UI disables add/edit/delete when the operator lacks manage rights and refreshes data via the new actions.
- Background jobs management loads via server actions, enforces permission gating, and funnels retry/delete operations through audited server mutations (the cron trigger remains mediated through the API endpoint).
- SMS Health dashboard and message templates now read/mutate via server actions; UI affordances disable cleanly for read-only roles while refreshes flow through the new endpoints.
- Webhook monitoring and test tools dropped browser Supabase usage: monitor now streams through a server action gated by `messages:view`, and the test tool validates super-admin access server-side before exposing the client runner.
- Audit logs viewer now renders as a server-gated page; filtering/pagination flows through a new server action so admins stay within manage-only visibility and the UI no longer reaches Supabase directly.
- Event categories management now calls service-role helpers that enforce `events:manage`, log create/update/delete/audit RPC actions, and allow the client page to stay read-only for unauthorised viewers.
- Business hours and special hours now route through `settings:manage` service-role actions; the client disables editing without permission and write paths log audited outcomes.
- Removed the legacy calendar diagnostics, SMS delivery, SMS health, Twilio message monitor, and cron testing pages; navigation links now point to a decommission notice instead of the retired tools.
- Webhook diagnostics tool now runs behind `settings:manage`, with a server component gate and client runner that calls the hardened action—no direct Supabase usage from the browser.
- Calendar test utility is now permission-gated and calls a server action that wraps the shared integration health check; the client no longer hits the API route directly.
- Cron test screen shells out to a server action that proxies authorised requests to cron endpoints, keeping credentials off the client and ensuring only `settings:manage` operators can fire manual jobs.
- SMS delivery statistics now redirect unauthorised viewers, require `sms_health:view` plus `customers:view`, hydrate data server-side, and expose a refreshable client view without leaking service-role credentials.
- Added component/action-level regression tests to guarantee read-only viewers cannot mutate attachment categories, trigger background jobs, or send SMS delivery updates without the required scopes.

**Outstanding**
- Monitor real usage of the new tests/caching and extend full integration coverage to remaining settings subsections if regressions surface.

## Invoices — Discovery Notes & Plan (2025-09-13)

**Discovery recap**
- Index/detail/new/edit/payment pages render entirely on the client, so viewers without `invoices:view` briefly see full controls before server actions reject their requests.
- Navigation surfaces always render “manage” affordances (New, Export, Catalog, Vendors, Recurring, status changes, delete, record payment) even when the viewer lacks the matching permission.
- Export UI does not check for `invoices:export` before calling `/api/invoices/export`, and the route handler still writes directly to `audit_logs` instead of using `logAuditEvent`.
- Recurring invoice screens expose destructive toggles (`delete`, `activate/deactivate`, `generate now`) without consulting the permission context.

**Remediation plan**
1. Convert the index route to a server component that runs `checkUserPermission('invoices','view')` up front, and introduce a client wrapper that reads `usePermissions()` for UI state.
2. Gate every management control behind permission checks (create/edit/delete/export/recurring/catalog/vendor/payment) and surface inline messaging or disabled states for read-only users.
3. Add permission guards/redirects to subpages (new, edit, record payment, export, catalog, vendors, recurring) before they fetch data from server actions.
4. Swap the export API’s manual `audit_logs` insert for `logAuditEvent` and ensure failures bubble meaningful errors to the UI.
5. Verify recurring invoice actions (`generate`, `toggle`, `delete`) enforce module permissions and update UI to hide/disable them when not authorised.

**Progress (2025-09-13)**
- `/invoices/page.tsx` now redirects unauthorised viewers server-side and hands off to a client wrapper that gates header CTA buttons and mobile actions by role, with an info banner when in read-only mode.
- `/invoices/new`, `/invoices/[id]`, `/invoices/[id]/edit`, and `/invoices/[id]/payment` defer data loading until permissions resolve, redirect unauthorised roles, and block submit/delete/status transitions without the matching capability.
- `/invoices/export/page.tsx` redirects users lacking `invoices:export`, disables the call-to-action during permission load, and surfaces a toast if an export is attempted without rights; `/api/invoices/export` now logs via `logAuditEvent`.
- `/invoices/vendors` and `/invoices/catalog` respect permission context throughout (disabled affordances for read-only roles, redirects without `invoices:view`, and inline messaging) while recurring list/detail/new routes mirror the same gating for create/edit/delete actions.

**Outstanding follow-ups**
- Add a lightweight regression check (e.g., focused unit/RTL coverage) to ensure view-only roles cannot see `New Invoice`, `Record Payment`, export, or recurring-management actions.

## Quotes — Remediation Notes (2025-09-13)

**What changed**
- `/quotes/page.tsx` is now a server component that performs the initial `invoices:view` check before delegating to a permission-aware client wrapper; list actions (Convert / New Quote) disable or hide themselves for read-only roles.
- `/quotes/new`, `/quotes/[id]`, `/quotes/[id]/edit`, and `/quotes/[id]/convert` wait for the permission context, redirect unauthorised visitors, and gate destructive actions (`send`, `status`, `convert`, `delete`) based on `invoices:create|edit|delete` capabilities.
- Quick actions continue to link into invoices tooling, and the tracker documents the dependency so roles missing invoice access understand the coupling.

**Outstanding**
- Add targeted unit/RTL coverage ensuring read-only roles cannot trigger status updates, conversions, or quote creation from the UI (including modal entry points).
- Consider introducing dedicated `quotes:*` permissions if product wants to decouple quote management from invoice roles in future.

Shared infrastructure to revisit as each section is reviewed:

- `src/app/actions/*`: Server actions backing mutations and workflows (e.g. events, customers, SMS).
- `src/lib/*`: Utilities (Supabase clients, checklist builder, validation, logging).
- `src/components/*`: Shared UI (forms, tables, modals) used across sections.
- `src/contexts/*`: Permission and other contexts gating UI/business logic.

Update this table with discovery notes, risks, and remediation status as we progress through each section.

**Current agent scope (completed this session)**
- Discovery across the remaining sections surfaced the highest-risk gaps (browser Supabase reads in Employees/Parking/Table Bookings, permissive short-link creation, service-role polling in Messages).
- Legacy remediations from the prior session still stand for `/events`, `/customers`, and `/receipts`.
- `/employees` – roster + detail + edit flows sit behind server actions with permission-aware UI; notes/attachments respect document roles end-to-end.
- `/short-links` – permissions enforced via server actions with client UI now consuming secure endpoints (no browser Supabase access).
- `/parking` – booking list/notifications/rates now flow through permission-checked server actions; manage-only UI is hidden when roles lack `parking:manage`.
- `/private-bookings` – list/search/pagination now run through server action (`fetchPrivateBookings`), client affordances gate create/delete/cancel per permission, and legacy browser Supabase usage has been removed. Detail/calendar/settings still need to adopt the same pattern.
- `/profile` – server actions now back profile reads, updates, avatar uploads, notification toggles, exports, and deletion requests; the client is free of Supabase credentials.
- `/table-bookings` – dashboard listing/statistics now load through permission-checked server actions and the client dashboard hides manage-only controls for read-only roles.
- `/messages` – unread feed now uses user-scoped server actions with reduced polling cadence; bulk “mark all read” is hidden unless the viewer has `messages:manage`.
 - `/loyalty` – section decommissioned; routes removed and actions return a decommissioned response.
- `/roles` – role CRUD/assignment flows now use service-role server actions with audit logging; UI affords management controls only to viewers with `roles:manage` and blocks edits to system roles.

**Remediation checklist for the next agent**
Focus first on areas leaking sensitive data or bypassing permission checks:
1. **Permission enforcement**
   - Confirm the relevant server actions call `checkUserPermission` (or equivalent) and *abort* work on failure.
   - Ensure pages/clients that expose the feature redirect or hide controls when the user lacks permission.
2. **Client vs. server responsibilities**
   - Verify mutations happen via server actions (not direct Supabase calls from the browser) so validations, audit logging, and revalidation run centrally.
   - Check optimistic UI paths still work safely after enforcing the server action.
3. **UI gating & affordances**
   - Disable or hide buttons/forms for read-only roles; show clear error/toast if a restricted action is attempted.
   - Make sure alternative/legacy routes (e.g., exports, recurring flows, background jobs) respect the same gating.
4. **Audit & side effects**
   - Confirm critical actions log audit events, cancel dependent jobs, and revalidate affected paths.
   - Review any automation (webhooks, background processes) that rely on service-role clients.
5. **Documentation update**
   - After finishing a section, update this tracker: change the status, add a succinct note, and log newly discovered risks or TODOs for follow-up.

Triage order: refactor Parking/Table Bookings data access, then tighten Messages polling/backoff hardening.

## Employees — Remediation Notes (2025-09-13)

**What changed**
- Converted `/employees` detail and edit pages to load via server actions with permission-aware data hydration (roster already server-backed).
- Notes/attachments now render from server-provided data; create/delete/download flows enforce `employees:edit`/`employees:view_documents`/`employees:delete_documents`.
- Client affordances (add note, upload/delete docs, audit history) hide automatically without the required scopes and trigger `router.refresh()` after server actions.

**Next steps**
- Review onboarding/right-to-work/checklist server actions for additional field-level permissions (e.g., HR-only fields) and expand audit assertions if needed.
- Confirm post-save redirects in `FinancialDetailsForm` / `HealthRecordsForm` align with new navigation expectations (currently hard redirect to `/employees`).

## Private Bookings — Remediation Notes (2025-10-16)

**What changed**
- Replaced the list/search/pagination Supabase calls with the `fetchPrivateBookings` server action so all queries enforce `private_bookings:view`.
- Detail page now renders via `PrivateBookingDetailClient`, which receives hydrated booking data + permissions from the server and hides status, payment, discount, and item controls when roles lack access.
- `/private-bookings/calendar` uses the new `fetchPrivateBookingsForCalendar` helper with server-side gating, eliminating direct Supabase usage.
- Dashboard search input now debounces requests (300 ms) to reduce server load while users type.
- Settings pages (spaces/catering/vendors) now run via service-role management actions with audit logging, and server-side handlers redirect unauthorised requests before mutating.
- Messaging view now loads via server-hydrated data and hides send controls when the user lacks `private_bookings:send`.
- Dashboard list results now cache (30 s TTL) per filter/page combination so repeated views avoid redundant server work while destructive actions automatically invalidate the cache.
- Calendar agenda view exposes status/date filters that mirror the dashboard, giving mobile users comparable drill-downs without fetching extra data.
- Added component-level tests covering read-only messaging behaviour and server-action permission gates for the private booking SMS workflow.

**Next steps**
- Monitor caching hit rates and adjust the TTL or prefetch strategy once telemetry is available.
- Backfill integration tests that exercise the server actions end-to-end (mocking Supabase) if we expand the messaging queue beyond the current component coverage.

## Loyalty — Removal Notes (2025-09-13)

**What changed**
- `/loyalty/*` routes were deleted and navigation entries removed so the UI no longer exposes loyalty tools.
- All loyalty-related actions now short-circuit with a “feature decommissioned” error; legacy helper modules were removed.

**Next steps**
- Clean up any background jobs or scripts that referenced loyalty actions (none detected in the codebase).
- Communicate the change to operations teams so they retire any external shortcuts (e.g. loyalty portal links).

## Roles — Remediation Notes (2025-09-13)

**What changed**
- Role list/manage flows now run through service-role server actions with audit logging for create/update/delete and permission assignments.
- Client components hide manage affordances when the viewer lacks `roles:manage`, destructive actions are disabled for system roles, and the permissions modal offers a read-only view when editing is not allowed.

**Next steps**
- Consider adding pagination/search to the roles list if the catalogue grows.
- Expand automated tests to cover permission assignment and audit logging paths.

## Users — Remediation Notes (2025-10-16)

**What changed**
- `/users` now redirects unauthorised viewers up front and only fetches role data for operators with `users:manage_roles`.
- The user list hides the “Manage Roles” column entirely for read-only viewers and surfaces an informational banner when assignments are locked.
- Role management modal respects the same permission, avoids loading data without access, and uses the admin client to fetch assignments safely while surfacing load errors.
- `getAllUsers` now runs behind `requirePermission('users','view')`, falling back through RPC/view/admin APIs with normalised payloads so sensitive listings stay server-side.
- `getUserRoles` enforces `users:manage_roles` (when targeting other accounts) so role lookups and updates always run with service-role privileges.

**Next steps**
- Add automated coverage asserting read-only viewers cannot trigger the role modal or mutate assignments.
- Reconfirm RLS on `admin_users_view` and the `get_users_for_admin` RPC supports the updated permission model now that admin fallbacks are in place.
