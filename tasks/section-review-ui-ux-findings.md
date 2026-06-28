# The Anchor Management Tools — Exhaustive UI / UX / CRUD Review

*Lead UX reviewer synthesis of a per-section sweep across 32 application areas. False positives confirmed by the verifier (`verdict.isReal === false`) have been dropped; corrected severities applied. Duplicates and near-duplicates merged into cross-cutting themes.*

---

## Executive summary

This review covers the entire authenticated application plus the public-facing flows (table booking, parking guest, employee onboarding, staff portal) and the shared `@/ds` component library. The application is, on the whole, well-built: most sections handle loading/empty/error states, use server-action mutation patterns with audit logging, gate permissions server-side, and lean on a shared design system. Credit is due for the consistent `revalidatePath`/`revalidateTag` usage, `ConfirmDialog` adoption in 36 files, and Headless-UI-backed modals in many areas.

However, the sweep surfaced **a recurring set of systemic problems** that appear in section after section, plus a handful of genuinely broken or misleading features. The themes that matter most:

1. **Dead / duplicate client components.** At least **11 sections** ship an orphaned second copy of their list/detail client (or an entire `_components/` demo tree) that is never imported. Several have already diverged from the live version and contain features the live one lacks — a standing trap for maintainers who edit the wrong file.
2. **Navigation has no permission gating.** The *live* sidebar (`NAV_GROUPS` in `src/ds/shell/SidebarNav.tsx`) renders every section to every user; the permission-gated `AppNavigation.tsx` that `CLAUDE.md` names as the nav source is dead code. Every staff user sees Settings, Users, Roles, Payroll, GDPR, etc., and only discovers the gate at `/unauthorized`.
3. **Dead controls and silent no-ops.** Multiple sections render fully-interactive controls that do nothing: bulk SMS/Email buttons (customers), the "SMS Active" tab (customers), the category filter (events), per-row "more actions" (events), the role filter and the hardcoded "User" role badge (users), the card-view active toggle (menu-management), and the avatar in onboarding.
4. **Design-system fragmentation.** Two page shells (`PageLayout` vs `PageHeader`), two empty-state components, two toast import styles (~43 files use raw `react-hot-toast`), three tab components, native `window.confirm()` in several destructive flows, and ~120 non-token colour usages across `@/ds`.
5. **Accessibility gaps in shared primitives.** The DS `Checkbox`/`Radio` use `<button role>` with an inert `<label htmlFor>` (label clicks do nothing), `DataTable` sortable headers are keyboard-inoperable with no `aria-sort`, 21 raw tables lack `<th scope>`, and `ConfirmDialog` closes synchronously so async confirmations and its `loading` prop are decorative.
6. **CRUD asymmetry.** Several entities can be created but never edited or deleted (pay bands, roles' name/description, API keys cannot be revoked, vendor billing settings have no UI, project contacts can be removed but never added).

### Genuinely broken features (functional bugs, not polish)

- **DS `Checkbox` silent data loss** — `onChange` always emits a boolean wrapped in an empty `try/catch`; the employee onboarding health checkboxes pass `(e) => e.target.checked`, so `e.target` is `undefined`, the error is swallowed, and **every health-condition checkbox silently records nothing** (PII/medical data).
- **GDPR "Export My Data" omits all messages** — joins `messages.customer_id` on the auth user id, which never matches, so the export reports success with an always-empty messages array (data-subject-access failure).
- **Parking guest payment failure states masked** — the PayPal return handler redirects with `?payment=missing_parameters`/`not_found`, which the page ignores, showing a reassuring "booking received" message on a real payment failure.
- **Dashboard "Today" drill-down broken** — hrefs are computed but never rendered as links.

### Counts (after de-duplication and dropping verified false positives)

| Severity | Count |
|---|---|
| High | 28 |
| Medium | 118 |
| Low | 165 |
| **Total** | **311** |

Two findings were dropped as verified false positives: the events-section "no error boundary" claim (a parent `(authenticated)/error.tsx` exists) and the profile avatar "double-prefix" claim (storage path and display path are identical, so the image renders). The payroll P&L "no error boundary" claim was likewise corrected to low for the same reason.

---

## CRUD completeness matrix

Per entity, across every section. Operations: **C**reate · **R**ead · **U**pdate · **D**elete · **L**ist · **S**earch/Filter/Sort · **P**agination. `partial` = present but limited; `n-a` = not applicable by design.

### Core operational entities

| Section | Entity | C | R | U | D | List | Search/Sort | Pagination | Key gaps |
|---|---|---|---|---|---|---|---|---|---|
| dashboard | Calendar Note | yes | partial | **no** | **no** | partial | n-a | n-a | Create-only from dashboard; no edit/delete; existing notes show tooltip only |
| customers | Customer | yes | yes | yes | yes | yes | partial | yes | No debounce on search; **no column sort**; "SMS Active" tab is a no-op; **bulk SMS/Email buttons dead**; no list export |
| customers | Customer Label (assignment) | yes | yes | n-a | yes | yes | no | n-a | Bulk-apply action exists but not wired to UI; hand-rolled dropdown (no kbd/Escape) |
| employees | Employee | yes | yes | yes | yes | yes | partial | yes | **"Prospective" status offered but rejected by schema**; no column sort; no bulk; read-only Financial/Health tabs have no edit link |
| employees | Emergency Contact | yes | yes | yes | yes | yes | n-a | n-a | Hand-rolled modals (no focus-trap/Escape), hardcoded colours |
| employees | Attachment / Document | yes | yes | **no** | yes | yes | no | no | Cannot edit category/description (delete + re-upload only); no category filter |
| employees | Note | yes | yes | no (by design) | no (by design) | yes | no | **no** | Append-only intentional; unbounded growth on detail page |
| employees | Right to Work | yes | yes | yes | partial | n-a | n-a | n-a | Record undeletable (only photo); raw `new Date()`; `window.confirm`/`alert` |
| employees | Financial / Health | yes | yes | yes | **no** | n-a | n-a | n-a | Editable only via `/edit`; detail tab read-only with stale placeholder comment |
| events | Event | yes | yes | yes | yes | yes | partial | yes | **Category filter is a dead control**; no sort UI; no debounce; per-row "more actions" no-op; bulk = delete only |
| events | Booking (attendee) | yes | yes | partial | partial | yes | partial | **no** | Only seats editable inline; **no pagination on attendees**; transfer requires pasting raw UUID |
| events | Checklist item | n-a | yes | yes | n-a | yes | no | n-a | Template-derived; no ad-hoc tasks; divergent styling across 3 surfaces |
| events | Marketing link | partial | yes | **no** | **no** | yes | no | no | No edit/delete of an individual link |
| private-bookings | Private Booking | yes | yes | yes | yes | yes | partial | yes | **Edit form missing deposit/due-date fields create collects**; no sort; no bulk; export = per-booking PDF only |
| private-bookings | Booking Item | yes | yes | partial | yes | yes | n-a | n-a | **Items page has NO permission gating**; cannot change item_type/linked entity; reorder only on detail page |
| private-bookings | Vendor | yes | partial | yes | yes | yes | **no** | **no** | No search/filter/pagination (all edit forms rendered inline); `window.confirm`; no read view |
| private-bookings | Venue Space | yes | partial | yes | yes | yes | no | no | Same as Vendor; `window.confirm` delete |
| private-bookings | Catering Package | yes | partial | yes | yes | yes | no | no | DS-modal pattern (better); no search/pagination |
| private-bookings | Booking Payment / Refund | yes | yes | partial | **no** | yes | n-a | n-a | No delete (audit, OK); record-payment buttons are ad-hoc native w/ hardcoded colours |
| table-bookings | Table Booking | yes | yes | **partial** | yes | yes | yes | **no** | **Cannot edit date/time/notes/dietary/customer after creation** (delete+recreate only); no pagination month view; pre-orders invisible |
| table-bookings | Pre-order | **no** | **no** | **no** | **no** | **no** | n-a | n-a | **Sunday pre-order line items have no admin surface at all** (only timestamps shown) |
| parking-admin | Parking Booking | yes | partial | partial | **no** | yes | partial | **no** | **No edit after creation**; **Cancel has no confirmation**; 200-row hard cap, no pagination; no detail page |
| parking-admin | Rate | n-a | partial | **no** | n-a | **no** | n-a | n-a | **No UI to manage parking rates — prices changeable only via SQL** |

### Rota / scheduling / time

| Section | Entity | C | R | U | D | List | Search/Sort | Pagination | Key gaps |
|---|---|---|---|---|---|---|---|---|---|
| rota | Shift | yes | yes | yes | yes | yes | **no** | n-a | **Drag-drop reassignment keyboard-inaccessible**; no employee/role filter; delete via inline confirm only |
| rota | Shift Template | yes | partial | yes | partial | yes | partial | n-a | **Deactivated templates become unreachable orphans** (no view/restore); `window.confirm` |
| rota | Leave / Holiday | yes | yes | partial | yes | yes | n-a | n-a | Edit dates/delete only via rota-grid modal, not the leave queue |
| rota | Sales Target override | partial | yes | yes | **no** | n-a | n-a | n-a | Raw native inputs; no way to remove an override |
| leave | leave-request (employee) | yes | partial | **no** | **no** | yes | **no** | **no** | **Employee cannot cancel/edit own pending request** (delete gated to manager) |
| leave | leave-request (manager) | no | partial | partial | **no** | yes | partial | **no** | **No edit/delete from the manager queue**; approve/decline have **no confirmation**; unbounded list |
| leave | allowance | n-a | yes | **no** | n-a | n-a | n-a | n-a | Read-only here; no link to where it's set |
| payroll | Payroll Period | yes | yes | partial | no | partial | no | n-a | Month `<select>` not a real list; no history view |
| payroll | Payroll Row | no | yes | partial | yes | yes | **no** | **no** | No search/filter on month-sized table; delete has no success toast; edit-after-approval not re-locked |
| payroll / settings | Pay Age Band | yes | yes | **no** | **no** | yes | no | no | **Create-only; cannot edit/delete/deactivate** (payroll-critical); `is_active` badge unreachable |
| payroll / settings | Pay Band Rate | yes | yes | **no** | **no** | yes | no | no | Append-only; a mis-dated future rate cannot be voided |
| payroll / settings | Employee Rate Override | yes | yes | **no** | **no** | yes | no | n-a | Append-only; no correction path |
| timeclock-kiosk | Timeclock Session | yes | partial | partial | partial | yes | **no** | **no** | No staff search on grid; **no on-kiosk undo for mis-clock**; "On Leave" stat hardcoded to 0 |
| cashing-up | Cashup Session | yes | partial | partial | **no** | partial | **no** | **no** | **No delete/void**; Approve/Lock/Unlock actions exist but **unwired**; no searchable session list |
| cashing-up | Denomination count | yes | yes | partial | partial | yes | n-a | n-a | Child of session; cleared/replaced wholesale on save |
| cashing-up | Daily/Weekly Target | **no** | yes | **no** | **no** | partial | n-a | n-a | **Target actions exist but no UI calls them** — shows £0/No target with no fix |
| mgd | MGD Collection | yes | partial | yes | yes | yes | partial | **no** | No detail view; notes never displayed; no UI export (CSV exists); delete confirm closes before async resolves |
| mgd | MGD Return | partial | partial | partial | n-a | yes | partial | **no** | Trigger-created; no backfill UI; HMRC modal hardcodes machine count=1 and zeroes rate bands |

### Finance / projects / content

| Section | Entity | C | R | U | D | List | Search/Sort | Pagination | Key gaps |
|---|---|---|---|---|---|---|---|---|---|
| invoices | Invoice | yes | yes | partial | partial | yes | partial | yes | **Credit-note/refund UI orphaned** (action exists, no UI); status tabs ≠ dropdown; no sort; `window.confirm` for void |
| invoices | Line item | yes | yes | yes | yes | yes | n-a | n-a | HTML-required only; no per-row inline errors |
| invoices | Recurring invoice | yes | yes | yes | yes | yes | **no** | **no** | No search/filter/sort/pagination; `confirm()` for generate-now/activate |
| invoices | Line-item catalog | yes | yes | yes | yes | yes | **no** | **no** | No search; `confirm()` delete |
| quotes | Quote | yes | yes | **partial** | **partial** | yes | partial | **no** | **Edit/delete only for DRAFT** — sent quotes uncorrectable; no Quotes nav entry; no pagination |
| quotes | Line item | yes | yes | partial | partial | yes | n-a | n-a | Editable only in draft; new vs edit forms diverge (catalog picker, last-item rule) |
| receipts | Transaction | partial | partial | yes | **no** | yes | yes | yes | CSV-import only; no manual create; no detail view; no row delete; main list has no bulk-select |
| receipts | Receipt file | yes | yes | n-a | yes | yes | n-a | n-a | **Delete has no confirmation**; download silently no-ops on failure |
| receipts | Automation rule | yes | yes | yes | partial | yes | partial | **no** | Hard-delete action unwired; entire Rules panel hidden below `md` |
| receipts | Rule suggestion | n-a | yes | n-a | yes | yes | partial | **no** | Capped at 5 with no overflow access |
| receipts | Vendor watchlist | yes | yes | n-a | yes | yes | partial | no | No search/pagination |
| expenses | Expense | yes | partial | yes | yes | yes | partial | **no** | **No pagination (loads all)**; no detail view; no export in-UI; no bulk; row-click opens edit |
| expenses | Category | **no** | partial | **no** | **no** | partial | n-a | n-a | **Fake entity — hardcoded budgets matched against free-text company field** (always £0) |
| expenses | Receipt file | yes | yes | **no** | yes | yes | n-a | partial | No rename/replace; no bulk delete |
| mileage | Trip | yes | partial | yes | yes | yes | partial | **no** | **No pagination (unbounded)**; no free-text search; **no export despite existing CSV exporter**; no detail view |
| mileage | Trip Leg | yes | yes | yes | yes | yes | n-a | n-a | Child of trip; delete+reinsert on edit |
| mileage | Destination | yes | yes | yes | partial | yes | **no** | **no** | Undeletable when `tripCount>0` (no merge/reassign); hand-rolled tables |
| mileage | Destination Distance | yes | yes | yes | **no** | yes | no | no | **No delete UI/action** — mistyped distance can only be overwritten |
| oj-projects | Project | yes | yes | yes | yes | yes | partial | **no** | No sort; no pagination (loads all); delete shown for projects-with-entries that fail server-side |
| oj-projects | Time/Mileage Entry | yes | yes | partial | yes | yes | partial | **no** | **Capped at 200, no pagination — older entries invisible**; no bulk; no export |
| oj-projects | Client / Vendor | **no** | partial | **no** | **no** | yes | partial | **no** | **No create/edit/delete client UI**; project dropdown has no inline add |
| oj-projects | Vendor Billing Settings | **no** | **no** | **no** | n-a | n-a | n-a | n-a | **Orphaned — actions exist, zero UI; drives all billing snapshots** |
| oj-projects | Recurring Charge | yes | yes | yes | partial | yes | **no** | **no** | Soft-disable only; reactivation not obvious |
| oj-projects | Work Type | yes | yes | yes | partial | yes | **no** | no | Soft-disable only; no hard delete for unused |
| oj-projects | Project Contact | **no** | yes | n-a | yes | yes | n-a | n-a | **Can remove but never add** (`addProjectContact` orphaned) |
| short-links | Short Link | yes | partial | partial | yes | yes | partial | yes | Edit drops custom-slug field; no detail page; no sort/filter; no bulk; no export; UTM variants un-editable |
| short-links | Click (analytics) | n-a | partial | n-a | n-a | partial | partial | **no** | Read-only; insights load errors swallowed; no CSV export |
| menu-management | Dish | yes | yes | yes | yes | yes | yes | yes | No bulk; Overview reimplements `/dishes` list with weaker controls |
| menu-management | Ingredient | yes | yes | yes | yes | yes | yes | yes | Smart-import is one-at-a-time; export = allergen PDF only |
| menu-management | Recipe | yes | yes | yes | yes | yes | partial | yes | Delete path inconsistent (raw `fetch` in drawer vs server action in list) |
| menu-management | Menu | **no** | partial | **no** | **no** | partial | partial | n-a | **No create/edit/delete UI** (seed-only, undocumented) |
| menu-management | Menu Category / Section | **no** | partial | **no** | **no** | partial | n-a | n-a | **No management UI** at all |
| menu-management | Choice / Option group | partial | partial | partial | partial | n-a | n-a | n-a | Free-text string, no validation; typo creates separate group, distorts GP |

### Comms / admin / RBAC / public

| Section | Entity | C | R | U | D | List | Search/Sort | Pagination | Key gaps |
|---|---|---|---|---|---|---|---|---|---|
| messages | Conversation / Message | partial | yes | partial | **no** | yes | partial | **no** | **3-panel layout breaks on mobile**; no detail page; no resend on failed; no archive/delete; no pagination |
| messages | Bulk message send | yes | n-a | n-a | n-a | yes | yes | **no** | Recipient list unbounded; select-all only covers loaded rows; unknown `{{tokens}}` ship literally |
| messages | Message template | yes | yes | yes | yes | yes | **no** | no | No search/filter across 16 types; type immutable on edit; double error report (Alert+toast) |
| messages | Unmatched communication | n-a | yes | partial | partial | yes | **no** | **no** | **Requires pasting raw UUID to link**; **action errors silently swallowed** (`void` wrappers) |
| recruitment | Job posting | yes | yes | yes | partial | yes | **no** | **no** | No search/filter/sort/pagination; archive-via-edit only |
| recruitment | Applicant / Application | yes | yes | yes | partial | yes | partial | **no** | **No pagination** (talent tab has it, applications don't); archive/bulk have **no confirmation** |
| recruitment | Candidate (talent) | partial | yes | yes | yes | yes | partial | yes | **GDPR erase has no confirmation** (one-click anonymise) |
| recruitment | Slot / Appointment | yes | yes | yes | partial | yes | **no** | **no** | No search/filter/sort/pagination; cancel/reschedule/archive **no confirmation** |
| recruitment | Email template | **no** | yes | yes | **no** | yes | no | no | **Edit-only — cannot create or delete**; seeded rows only |
| settings | Customer Labels | yes | yes | yes | yes | yes | no | no | **`icon` field stored but no input** (locked to 'star'); no submit loading state |
| settings | API Keys | yes | yes | yes | **no** | yes | no | no | **Cannot revoke/deactivate/delete a key from UI** (security-adjacent) |
| settings | Event Categories | yes | yes | yes | yes | yes | partial | no | **No route-level permission gate**; mutating controls always rendered; raw colour buttons |
| settings | SMS Failures | n-a | yes | **no** | **no** | yes | partial | **no** | **No resend/retry/dismiss**; no pagination |
| settings | Various (categories/budgets/calendar-notes/jobs) | yes | yes | yes | yes | yes | partial | partial | **Native `window.confirm` in 4 places**; raw inputs in table-bookings setup |
| roles | Role | yes | partial | **no** | yes | yes | **no** | n-a | **`updateRole` exists but no edit UI/route** — name/description permanently fixed; two divergent role UIs; `window.confirm` delete |
| roles | Permission | n-a | yes | yes | n-a | yes | no | n-a | Matrix checkboxes have empty `label=""` (unlabelled for SR) |
| users | User | **no** | partial | partial | **no** | yes | partial | **no** | **Role filter dropdown is a no-op**; **hardcoded "User" role badge for all**; no pagination |
| profile | profile (self) | partial | yes | partial | partial | n-a | n-a | n-a | Delete = fire-and-forget request; **GDPR export omits messages (wrong join key)** |
| profile | avatar | yes | partial | yes | **no** | n-a | n-a | n-a | **No remove/clear**; no size/type validation; double-trigger file picker |
| onboarding | Onboarding submission | yes | partial | partial | n-a | n-a | n-a | n-a | No per-section edit from Review; **submit handlers swallow thrown errors** (try/finally no catch) |
| staff-portal | shift | n-a | yes | partial | no | yes | **no** | partial | Period-only nav; no shift swap/drop; ICS export only |
| staff-portal | leave-request | yes | partial | **no** | **no** | yes | **no** | **no** | **Cannot cancel own request**; **errors collapsed to empty state**; no sign-out control in portal |
| staff-portal | payslip | n-a | partial | n-a | n-a | **no** | no | partial | **No real payslip entity** — only a computed guidance card; no PDF/download |
| public-table-booking | Public booking flow | **no** | **no** | **no** | **no** | n-a | n-a | n-a | **No working booking UI** — redirects to external site; orphaned mockup with no submit handler |
| public-parking-guest | Parking booking (guest) | no | yes | **no** | **no** | n-a | n-a | n-a | **No pay/retry action for pending/failed** — dead-end page; raw enum status shown |

---

## Cross-cutting UI/UX themes

These patterns recur across many sections. Fixing them at the source (often a shared component or a documented convention) resolves dozens of individual findings.

### 1. Dead / duplicate client components (High)
**Affected:** customers, employees, private-bookings, invoices, quotes, parking, rota, table-bookings, short-links, roles/users, leave, onboarding, auth-and-layout, and the entire `table-bookings/_components/` and `rota/_components/` demo trees.

At least eleven sections carry an orphaned second copy of their list/detail client, imported nowhere yet fully maintained. Several have diverged and contain features the live one lacks (e.g. the dead `customers/CustomersClient.tsx` has the sortable DataTable the live `_components` version dropped). `rota/_components/` and `table-bookings/_components/` are whole demo trees rendering hardcoded `DEMO_*` data with non-functional buttons. The dead `AppNavigation.tsx` carries the permission gating the live nav is missing. **Fix:** delete the orphans (after porting any worth-keeping features), and decide one canonical implementation per concern.

### 2. Navigation has no permission gating (High)
**Affected:** every authenticated section (root cause in `src/ds/shell/SidebarNav.tsx` + `AppShell.tsx`).

`NAV_GROUPS` has no permission metadata and is rendered unfiltered to all users; the mobile drawer even *adds* admin items unconditionally. `PermissionContext` is loaded but never consulted by the live nav. Server-side enforcement still protects data (clicks land on `/unauthorized`), so this is a UX/standards violation rather than a data leak — but it affects every role. The user role label is also hardcoded to `"Manager"` for everyone. **Fix:** filter nav items by `usePermissions()` before passing to `Sidebar`/`MobileDrawer`, as the dead `AppNavigation.tsx` already intended.

### 3. Dead controls / silent no-op buttons (High → Medium)
**Affected:** customers (bulk SMS/Email, "SMS Active" tab), events (category filter, per-row "more actions"), users (role filter, hardcoded role badge), menu-management (card-view active toggle), dashboard (Today drill-down hrefs discarded), rota/leave demo (no-op approve/reject), public table-booking mockup (no submit handler), short-links (`UtmDropdown` dead).

Fully-interactive controls that do nothing mislead staff into believing an action succeeded. **Fix:** wire each control to its (often already-existing) action, or remove it.

### 4. Destructive actions without confirmation / with native `confirm()` (Medium)
**Affected:** parking (Cancel), receipts (file delete), recruitment (erase/reject/bulk/cancel/reschedule), leave (approve/decline), quotes (mark expired/rejected), invoices (void), settings (categories/budgets/calendar-notes/jobs deletes), private-bookings settings (vendor/space deletes), roles (delete), rota templates (deactivate), employees (RTW photo delete via `window.confirm`/`alert`).

Two distinct sub-problems: (a) destructive actions with **no** confirmation at all, and (b) destructive actions using **native `window.confirm()`** instead of the DS `ConfirmDialog` used by 36 other files (unstyled, not focus-trapped, blocks the main thread). **Fix:** standardise on `ConfirmDialog`; add confirmation to every irreversible action.

### 5. `ConfirmDialog` closes synchronously — async confirmation broken (Medium)
**Affected:** all consumers (root cause in `src/ds/primitives/ConfirmDialog.tsx`), notably mgd (delete & reopen), mileage (delete), settings, customer-labels, message-templates.

The confirm button runs `onConfirm()` then `onClose()` synchronously, so for async server actions the dialog closes before the action resolves; the accepted `loading` prop is decorative and in-dialog error feedback is impossible. **Fix:** make `onConfirm` awaitable, keep the dialog open + disabled while pending, surface errors, close only on success.

### 6. Missing / inconsistent loading states (Medium)
**Affected:** only 9 of 25 authenticated sections ship a route-level `loading.tsx`. Missing in parking, receipts, messages, quotes, mileage, expenses, cashing-up, oj-projects, short-links, settings, menu-management, recruitment, roles, users, plus public flows (booking-portal, onboarding). Some sections repurpose the `Empty` component as a loading indicator (oj-projects, expenses). Auth gate shows a bare "Loading..." text.

**Fix:** add `loading.tsx` skeletons (using the DS `Skeleton`) per section; never use `Empty` as a spinner.

### 7. Errors swallowed / conflated with empty states (Medium → High)
**Affected:** dashboard (per-section `.error` never read), customers (consent/SMS-stats), employees (pay/leave sub-queries), messages (conversation list + **holding-queue `void` wrappers swallow link/ignore errors**), receipts (workspace load), parking (bookings table), cashing-up (daily page reads action errors as empty), oj-projects (every list), short-links (**insights `catch {}` empty block**), leave (**`success ? data : []` masks failures**), staff-portal (leave), recruitment (~15 actions cast to `void`), public-parking (**failure query states ignored**).

A failed fetch renders identically to a genuinely-empty result, hiding outages. The recruitment and messages-holding cases are the worst: high-stakes mutations (Hire, Erase, link-to-customer) give zero feedback on failure. **Fix:** branch on the failure case and render an inline error/Alert; never default a failed action result to `[]`/`0`.

### 8. No error boundaries at section level (Medium)
**Affected:** only one `error.tsx` exists, at the `(authenticated)` group root. A render error anywhere escalates to the whole-area boundary (losing chrome). Reports/insights pages (table-bookings, cashing-up) and recruitment have bespoke or no error handling. **Fix:** add scoped `error.tsx` to high-traffic sections, or standardise on `PageLayout`'s inline error rendering.

### 9. Forms without inline field-level validation (Medium)
**Affected:** events (toast-only), customers (no required markers), employees (generic toast on schema failure), private-bookings/quotes/invoices line items (HTML-required only), parking (first server error as toast), receipts rules, cashing-up daily, mgd, recruitment (Add Application), menu-management drawers (`required` on a non-form button never fires), expenses, onboarding.

Validation is server-deferred and surfaced as a single top-of-form banner or toast, never bound to the offending field (no `aria-invalid`/`aria-describedby`). **Fix:** adopt field-level errors (RHF + Zod is already a dependency) with proper ARIA wiring.

### 10. No unsaved-changes guard (Medium)
**Affected:** events drawer (~30 fields), invoices/quotes create-edit (line items), settings (General/business-hours/rota), mileage modals, expenses modal, menu-management drawers (fragile `JSON.stringify` dirty-check; `beforeunload` never sets `returnValue`), rota grid. Accidental dismissal/navigation silently discards substantial work. **Fix:** track dirty state and confirm before close/navigate.

### 11. Un-debounced search firing a server action per keystroke (Medium)
**Affected:** customers, events, expenses, parking. `SearchInput`'s `debounceDelay` prop is deprecated/ignored, so each character triggers a DB-backed server action (flicker, race ordering). **Fix:** debounce (300 ms) before the fetch, or implement debounce in `SearchInput`.

### 12. Unbounded lists / missing pagination (Medium)
**Affected:** events attendees, employees notes/documents, private-bookings vendors/spaces, recurring invoices, quotes, expenses (loads all), mileage trips (unbounded), oj-projects entries (capped at 200, older invisible) & projects (loads all), parking (200 cap), messages (conversations + bulk recipients), recruitment (applications/postings/slots/appointments), settings (SMS failures), leave (all requests), cashing-up sessions, table-bookings month view. **Fix:** server-side pagination or a visible "showing N of M" cap with load-more.

### 13. Hand-rolled / non-`@/ds` components & native inputs (Medium)
**Affected:** employees modals, events (native `<select>`), private-bookings (149 hardcoded colours, 16 native buttons), expenses (entire form native), mileage (hand-rolled tables), rota (all 7 modals hand-rolled, native checkboxes), menu-management (`MenuDishesTable` raw), parking, table-bookings (1135-line setup with raw inputs), payroll (raw buttons/select/anchor), leave modals, onboarding (every step form native), settings (table-bookings setup, budgets, event-categories, rota), staff-portal. **Fix:** migrate to `@/ds` `Input`/`Select`/`Button`/`Modal`/`Checkbox` for consistent focus, disabled, loading, and a11y behaviour.

### 14. Hardcoded colours instead of design tokens (Low–Medium)
**Affected:** ~120 non-token colour usages across `@/ds` plus section components: dashboard skeleton (`bg-gray-200`), customers label chips, employees modals (`bg-green-600`, off-brand `focus:ring-indigo-500`), events checklist card, private-bookings, receipts (`utils.ts` tone maps), expenses form (blue accent vs green theme), mileage (`#10B981` chart), mgd, parking (`text-blue-600` links), rota modals, menu-management, messages (BulkMessagesClient), short-links (`text-white`), `SectionNav` (`#005131`/`#a57626`), `Avatar` palette, settings, cashing-up (chart hex), payroll (inline-style note chips). **Fix:** map to semantic tokens; reserve genuine user-chosen/chart-data colours as documented exceptions.

### 15. Accessibility: shared-primitive defects (High–Medium)
**Affected:** all consumers via `@/ds`.
- **`Checkbox`/`Radio`** use `<button role>` with inert `<label htmlFor>` — label clicks don't toggle; SR gets no association. The `Checkbox` `onChange` contract (always boolean, empty `catch`) causes the **onboarding health-checkbox data-loss bug**.
- **`DataTable`/`Table` sortable headers** — `<th onClick>` with no `role`/`tabIndex`/`onKeyDown` and no `aria-sort`. Keyboard users cannot sort any table.
- **`Tabs`/`SectionNav`** — no `role="tablist"`, no `aria-controls`, no arrow-key navigation.
- **21 raw tables** lack `<th scope>`.
- **Matrix/bulk checkboxes** pass empty `label=""` (RolesContent, receipts bulk-review).
**Fix:** correct the primitives once; ripples across the app.

### 16. Clickable rows without keyboard operability (Medium–Low)
**Affected:** events list, invoices, quotes, private-bookings, oj-projects, customers detail, table-bookings, menu-management cards. Rows navigate via `<tr onClick>`/`<div onClick>` with no `role`/`tabIndex`/`onKeyDown`. **Fix:** make the primary cell a real `<a>`/link, or add button semantics + key handling.

### 17. Hand-rolled / inaccessible modals (Medium)
**Affected:** employees (all modals), rota (all 7), expenses (form modal), leave (`HolidayDetailModal`, `BookHolidayModal`). Bespoke `fixed inset-0` overlays with no focus trap, no Escape-to-close, no focus restoration, sometimes missing `role="dialog"`. **Fix:** use the `@/ds Modal` (Headless UI) which handles all of this.

### 18. Raw date handling bypassing `dateUtils` (Medium–Low)
**Affected:** customers detail, employees (RTW/Health/birthdays), quotes, messages, mileage labels, short-links analytics modal, table-bookings (`toIsoDate` uses UTC), profile, oj-projects, cashing-up, public mockup. `new Date().toLocaleDateString()`/`.toISOString()` is timezone-dependent and can show the wrong day. **Fix:** use `formatDateInLondon`/`getTodayIsoDate` per workspace standard.

### 19. Inconsistent feedback (no success toast) (Low–Medium)
**Affected:** expenses (all mutations silent + swallowed delete error), mileage (all CRUD), invoices (status transitions), payroll (delete/edit-times), quotes (create redirect), leave (book in EmployeeHolidaysTab no refresh), onboarding (no save toast). **Fix:** add `toast.success` consistently and surface failures.

### 20. Two page shells & fragmented design-system surfaces (Medium)
`PageLayout` (78 files, stateful) vs `PageHeader` (31 files, no loading/error/back) are mixed within 14 sections; two empty-state components; three tab components; ~43 files import raw `react-hot-toast` instead of the `@/ds` wrapper. **Fix:** document and enforce one canonical choice per concern; add ESLint rules where possible.

---

## High & Medium priority list

> Ordered roughly by impact. `file:line` from the source findings; severities reflect verifier corrections.

### HIGH

1. **DS `Checkbox` silent data loss on event-style consumers** — `src/ds/primitives/Checkbox.tsx:56-66`. `onChange` always emits a boolean inside an empty `try/catch`; `employees/new/NewEmployeeOnboardingClient.tsx:774-779` passes `(e) => updateHealth('has_diabetes', e.target.checked)` → `e.target` is `undefined`, error swallowed, **every health-condition checkbox records nothing**. *Fix:* type `onChange` as `(checked: boolean) => void`, drop the catch, fix consumers to `(checked) => ...`.

2. **GDPR "Export My Data" omits all messages** — `src/app/actions/profile.ts:162-166`. Joins `messages.customer_id` on auth `user.id` (never matches), always returns empty messages but reports success. *Fix:* resolve the correct customer linkage or remove the section; don't present an empty result as complete.

3. **Parking guest payment-failure states masked** — `src/app/parking/guest/[id]/page.tsx:42-56`. Return handler redirects with `?payment=missing_parameters`/`not_found`; page ignores them and shows the reassuring pending message on a real failure. *Fix:* add explicit branches surfacing an error + contact info.

4. **Sidebar nav has no permission gating** — `src/ds/shell/SidebarNav.tsx:21-67` / `AppShell.tsx`. Every user sees every section. *Fix:* filter by `usePermissions()`.

5. **`AppNavigation.tsx` (permission-gated nav) is dead code** — `src/components/features/shared/AppNavigation.tsx`. Imported nowhere; the live `NAV_GROUPS` diverges and lacks gating + sub-groups. *Fix:* wire it in or port its gating into `SidebarNav`.

6. **Customers bulk SMS/Email buttons are dead** — `customers/_components/CustomersClient.tsx:407-412`. Selection bar + buttons with no `onClick`. *Fix:* wire to bulk action or remove.

7. **Employees "Prospective" status rejected by schema** — `employees/new/NewEmployeeOnboardingClient.tsx:536` vs `services/employees.ts:99`. Offered option fails `safeParse`; generic "Failed to create employee" with no field error. *Fix:* add to enum or remove option; surface field errors.

8. **Table booking cannot be edited after creation** — `table-bookings/[id]/BookingDetailClient.tsx:722-822`. No edit for date/time/notes/dietary/allergies/customer; delete+recreate only (destroys audit trail; allergy notes are food-safety relevant). *Fix:* add an edit form/action.

9. **Sunday pre-order line items have no admin surface** — `table-bookings/[id]/BookingDetailClient.tsx:287`. Only timestamps shown; kitchen-relevant contents invisible. *Fix:* add a read (ideally editable-before-cutoff) pre-order section.

10. **Parking: no edit after creation + Cancel has no confirmation + no rate UI** — `parking/_components/ParkingClient.tsx:498-526, 510-514` and `actions/parking.ts:265-299`. Three high-impact gaps; Cancel flips a paid booking to refunded on a single mis-click; parking prices changeable only via SQL. *Fix:* add edit action, confirmation dialog, and a rates management screen.

11. **Rota drag-drop shift reassignment is keyboard-inaccessible** — `rota/RotaGrid.tsx:622-624`. `PointerSensor` only; the core interaction is mouse-only. *Fix:* add `KeyboardSensor` or a "Move shift" control.

12. **Rota: entire `_components/` directory is dead demo code** — `rota/_components/RotaClient.tsx` + 6 children render `DEMO_*` data with no-op buttons. *Fix:* delete.

13. **All rota modals hand-rolled (no focus-trap/Escape)** — `rota/CreateShiftModal.tsx:75-89` (+6 modals). Fails a11y baseline. *Fix:* use `@/ds Modal`.

14. **Pay bands cannot be edited or deleted** — `actions/pay-bands.ts:62-86` / `settings/pay-bands/PayBandsManager.tsx`. Create-only on a payroll-critical entity; `is_active` badge unreachable. *Fix:* add update + deactivate.

15. **API keys cannot be revoked/deleted from UI** — `settings/api-keys/ApiKeysManager.tsx:273-308`. `revokeApiKey` action exists but is never wired; a leaked key can't be disabled without a DB write. *Fix:* surface revoke + delete with confirmation.

16. **Roles' name/description cannot be edited** — `roles/components/RoleForm.tsx`. `updateRole` implemented but no edit route renders the form in edit mode. *Fix:* add `roles/[id]/edit` + Edit button.

17. **Users role filter is a no-op + hardcoded "User" role badge** — `users/_components/UsersContent.tsx:46-59, 120-122`. The filter never runs and every row shows a fake "User" role; staff can't see who is super_admin/manager/staff. *Fix:* join `user_roles`, render real roles, wire the filter.

18. **Invoices credit-note/refund UI orphaned** — `actions/invoices.ts:982`. `createCreditNote` + `RefundDialog` exist but no invoices screen calls them. *Fix:* surface on `InvoiceDetailClient` for paid invoices.

19. **OJ-Projects: clients can't be created/edited/deleted; vendor billing settings have no UI; entries capped at 200** — `clients/_components/ClientsClient.tsx`, `actions/oj-projects/vendor-settings.ts:19-34`, `entries/page.tsx:9`. Billing config (retainer hours/rate) that drives invoices is unmanageable; older entries silently invisible. *Fix:* add client CRUD inline, a billing-settings editor, and entries pagination.

20. **Messages holding queue: raw-UUID linking + swallowed errors** — `messages/holding/page.tsx:35, 94`. Linking an orphan comm requires pasting a customer UUID; `void` wrappers discard `{error}`, so failures are invisible (a view-only user clicking Link gets nothing). *Fix:* use `CustomerSearchInput`; surface action results.

21. **Messages 3-panel layout breaks on mobile** — `messages/_components/MessagesClient.tsx:491`. Fixed `grid-cols-[320px_1fr_280px]`, no responsive collapse; staff can't read/reply on a phone. *Fix:* responsive single-column with back affordance.

22. **Recruitment: ~15 mutating actions give no feedback + no confirmation on destructive/bulk + no applications pagination** — `recruitment/_components/RecruitmentDashboardClient.tsx:329-346, 1807, 757`. Hire/Erase/Reject/bulk silently no-op on error; one-click GDPR erase. *Fix:* `useActionState`/toasts, confirmations, pagination.

23. **Receipts: file delete has no confirmation + mobile loses upload/export/rules** — `receipts/_components/ui/ReceiptTableRow.tsx:363` and `ReceiptsClient.tsx:162`. Destructive delete on a bare `×`; on a phone the receipts manager can't import/export/manage rules. *Fix:* confirm + a mobile path.

24. **Onboarding submit handlers swallow thrown errors** — `onboarding/[token]/steps/CreateAccountStep.tsx:41-52` (+all steps). `try/finally` with no `catch`; a thrown server action looks like a silent no-op. *Fix:* add `catch` surfacing an error.

25. **Public table-booking is an unwired mockup** — `table-booking/_components/PublicBookingClient.tsx`. Never rendered; Confirm button has no `onClick`; sample data. *Fix:* delete or wire to a real action.

26. **`DataTable` sortable headers keyboard-inaccessible + no `aria-sort`** — `src/ds/composites/DataTable.tsx:388-433`. Affects every list screen. *Fix:* wrap header in `<button>`, set `aria-sort`.

27. **Staff portal: cannot cancel own leave + errors collapse to empty state + no sign-out** — `(staff-portal)/portal/leave/page.tsx:66-67, 94-126` + `layout.tsx`. *Fix:* self-service cancel action, error branch, sign-out control.

28. **Leave manager queue cannot edit/delete; approve/decline have no confirmation** — `rota/leave/LeaveManagerClient.tsx:55-191, 83-104`. Edit/delete only via the rota grid; one mis-click declines (sends rejection email, frees dates). *Fix:* add row actions + confirmation.

### MEDIUM (grouped — representative items; full per-section detail below)

- **Dead duplicate clients:** `customers/CustomersClient.tsx` (850 lines), `employees/EmployeesClientPage.tsx`, `private-bookings/PrivateBookingsClient.tsx` (911), `invoices/InvoicesClient.tsx` (716), `quotes/QuotesClient.tsx` (437), `parking/ParkingClient.tsx` (1021), `table-bookings/_components/` (779), `users/components/UserList.tsx`, `short-links/_components/UtmDropdown.tsx`, `onboarding/[token]/OnboardingClient.tsx`. *Fix:* delete each.
- **Private-bookings items page has no permission gating** — `private-bookings/[id]/items/page.tsx:718-934`. Add/Edit/Delete render for any authenticated user (server re-checks, but UI invites failed actions). *Fix:* gate with `private_bookings:edit`.
- **Private-bookings edit form missing financial fields create collects** — `[id]/edit/page.tsx`. `deposit_amount`/`deposit_due_date`/`balance_due_date` uneditable after creation. *Fix:* add to edit form.
- **Event category filter is a dead control** — `events/_components/EventFilterPanel.tsx`. *Fix:* add `categoryId` to `getEvents` or remove the dropdown.
- **Event per-row "more actions" no-op** — `events/_components/EventListView.tsx:183-191`. *Fix:* wire a menu or remove.
- **Event attendees table has no pagination** — `events/[id]/EventDetailClient.tsx:969-1122`.
- **Booking transfer requires pasting raw UUID** — `events/[id]/EventDetailClient.tsx:1059-1071`. *Fix:* event picker.
- **Settings: native `window.confirm` in categories/budgets/calendar-notes/jobs + invoices void.** *Fix:* `ConfirmDialog`.
- **Customer-labels: `icon` field stored, no input** — `settings/customer-labels/CustomerLabelsClient.tsx`. *Fix:* add picker or drop field.
- **Event-categories page has no route-level permission gate** — `settings/event-categories/page.tsx`. *Fix:* server wrapper + `canManage`.
- **SMS-failures page has no remediation actions** — `settings/sms-failures/page.tsx`. *Fix:* add resend/mark-resolved.
- **Expenses "category" is a fake entity** — `expenses/_components/ExpensesClient.tsx:54-62`. Hardcoded budgets matched against free-text company field → always £0. *Fix:* real category field or remove the sidebar.
- **Expenses: no pagination, no in-UI export, no detail view, mutations silent, swallowed delete error.**
- **Mileage: no pagination, no export (CSV exporter exists), no search, hand-rolled tables, hardcoded colours.**
- **Quotes: edit/delete only for DRAFT; no Quotes nav entry; no pagination; convert can hang in loading.**
- **MGD: delete confirm closes before async resolves; HMRC modal hardcodes machine=1 & zeroes rate bands; no UI export.**
- **Cashing-up: no delete/void; Approve/Lock/Unlock & target actions unwired; no searchable session list; no loading/error.**
- **Receipts: rule suggestions capped at 5 with no overflow; rules panel hidden below `md`; quarterly export no loading/error.**
- **Menu-management: drawers have no client validation (`required` on non-form button never fires); card-view active toggle is a no-op; Menus/Categories/Choice-groups have no management UI.**
- **Recruitment: postings/slots/appointments lack search/filter/sort/pagination; templates edit-only (no create/delete); no loading; double-submit possible.**
- **Dashboard: per-section errors swallowed; Refresh has no pending state; Sparklines always empty; Today drill-down broken.**
- **Profile: avatar has no remove + no size/type validation + double-trigger picker; password change has no current-password check.**
- **Parking: stats/table grids not responsive; search un-debounced; bookings table no error state; refund lookup races selection.**
- **Payroll: P&L/budgets/pay-bands/payroll have no loading states; row delete/edit no toast; edit-after-approval not re-locked.**

---

## Per-section breakdown (remaining findings)

> False positives dropped; corrected severities applied. Positives noted in each section's source are preserved as context but not relisted exhaustively.

### dashboard
- **[M]** Today items carry hrefs but render as non-clickable text — `DashboardClient.tsx:224-230`. Drill-down silently does nothing.
- **[M]** Today list truncated to 6 with no "+N more" / overflow link — `:224`.
- **[M]** Refresh button has no pending/feedback state — `:122-127`.
- **[M]** Mini-metric Sparklines always render empty arrays (dead placeholder UI) — `:356-359`.
- **[M]** Per-module snapshot errors swallowed, never surfaced — `dashboard-data.ts:865-1599`.
- **[L]** Upcoming-events ProgressBar can produce `NaN` width when capacity is 0 — `:274`.
- **[L]** Action Items card uses raw Tailwind state styling + no-op hover — `:152-169`.
- **[L]** Quick Action tiles hand-built, not `@/ds Button` — `:183-189`.
- **[L]** Mini-metric cards show ambiguous `--` for unpermitted modules — `:350-363`.
- **[L]** Calendar note modal: empty-title submit is a silent no-op; cross-field date error not inline — `UpcomingScheduleCalendar.tsx:63-82`.
- **[L]** Activity card labelled "Last 24h" but shows current-state snapshots — `:287`.
- **[L]** No dashboard-scoped error boundary; `loading.tsx` skeleton doesn't match layout; `text-gray-500` token deviation in `VenueCalendar.tsx:410`.

### customers
- **[H→dropped to M by verifier]** "SMS Active" tab does not filter distinctly from "All" — `CustomersClient.tsx:383-395`.
- **[M]** Un-debounced search fires a server action per keystroke — `:182-184`.
- **[M]** No column sorting (regression from dead root client) — `:442-514`.
- **[M]** Dead duplicate `CustomersClient.tsx` (850 lines) — `customers/CustomersClient.tsx:1-850`.
- **[M]** Stats grid fixed 4-column, breaks on mobile — `:375`.
- **[M]** Label selector dropdown hand-rolled (no kbd/Escape/outside-click/ARIA) — `CustomerLabelSelector.tsx:156-193`.
- **[M]** Detail page uses raw `Intl`/`new Date` instead of `dateUtils` — `[id]/page.tsx:186-237`.
- **[L]** Hardcoded hex in label chips; SMS/WhatsApp status colour-only; consent-audit error conflated with empty; edit-form lacks required indicators; unused `Select` import; no page-size control.

### employees
- **[M]** Two divergent list clients; `EmployeesClientPage.tsx` is dead — `:1-423`.
- **[M]** List has no error/loading state for the table itself — `_components/EmployeesClient.tsx:203-274`.
- **[M]** `EmployeeForm` Cancel buttons default to `type=submit` (fires `updateEmployee`) — `EmployeeForm.tsx:324`.
- **[M]** Detail Financial/Health tabs read-only with stale "placeholder for future Edit button" and no link to `/edit` — `FinancialDetailsTab.tsx:35`.
- **[M]** Right to Work editable on detail tab but absent from `/edit` (split edit surface) — `EmployeeEditClient.tsx:24-58`.
- **[M]** All modals hand-rolled (no focus-trap/Escape); hardcoded green/red/indigo colours — `AddEmergencyContactModal.tsx`.
- **[M]** RTW/Health/Birthdays use raw `new Date().toLocaleDateString()` — `RightToWorkTab.tsx:206`.
- **[M]** RTW photo delete uses `window.confirm`/`alert` — `RightToWorkTab.tsx:179`.
- **[L]** Attachment upload reads FormData twice; partial sub-query failures degrade silently; icon-only buttons lack `aria-label`; notes/documents unbounded; reliability table no loading; no column sort.

### events
- **[H→M by verifier]** Category filter dropdown is a dead control — `EventFilterPanel.tsx:58-64`.
- *(dropped)* No error boundary — verifier confirmed `(authenticated)/error.tsx` covers it; corrected to low.
- **[M]** Per-row "more actions" button no-op — `EventListView.tsx:183-191`.
- **[M]** Search fires a server fetch per keystroke — `EventFilterPanel.tsx:50-56`.
- **[M]** No sortable columns / sort control — `EventListView.tsx:110-128`.
- **[M]** Bulk delete trigger is ad-hoc Tailwind button — `EventListView.tsx:99-106`.
- **[M]** Bulk delete loops sequentially, swallows partial failures — `EventsClient.tsx:219-233`.
- **[M]** Booking transfer uses raw event-UUID text input — `EventDetailClient.tsx:1059-1071`.
- **[M]** Create validation toast-only; drawer has no unsaved-changes guard; attendees table no pagination.
- **[L]** Native `<select>` for ticket type; hardcoded colours in checklist card & drawer; status/clickable-row a11y; untyped cast fields; inconsistent empty-state components; identical ghost variants for destructive actions; calendar first-load no spinner; booking-sheets `window.location` no feedback.

### private-bookings
- **[H→M by verifier]** Edit form missing financial fields create collects — `[id]/edit/page.tsx:333-484`.
- **[H→M by verifier]** Items page has no permission gating — `[id]/items/page.tsx:718-934`.
- **[M]** Dead duplicate list client (911 lines) — `private-bookings/PrivateBookingsClient.tsx:1-911`.
- **[M]** New-booking page flashes full form before redirecting unauthorized users — `new/page.tsx:46-56`.
- **[M]** Payment action buttons are ad-hoc native with hardcoded colours — `PrivateBookingDetailClient.tsx:2651-2760`.
- **[M]** Settings deletes use `window.confirm` (vendors/spaces) — `VendorDeleteButton.tsx:19`.
- **[M]** Vendor management has no search/filter/pagination (all edit forms inline) — `settings/vendors/page.tsx:307-453`.
- **[L]** No column sort / no bulk; split filter UI mobile vs desktop; raw `<select>` for hold-extension; items total recomputed client-side; "other" item allows £0; clickable rows not keyboard-operable; raw labels/checkboxes with hardcoded colours.

### invoices
- **[H→M by verifier]** Credit-note/refund UI orphaned for direct invoices — `actions/invoices.ts:982`.
- **[M]** Dead duplicate `InvoicesClient.tsx` — `invoices/InvoicesClient.tsx:1`.
- **[M]** Void invoice uses `window.confirm` (×2) — `[id]/InvoiceDetailClient.tsx:302, 317`.
- **[M]** Native `confirm()` in vendors/catalog/recurring — `recurring/page.tsx:99, 130`.
- **[L]** Status tabs/dropdown out of sync; recurring list no search/filter/sort/pagination; no unsaved-changes guard; line-item validation HTML-only; rows not keyboard-operable; inconsistent recurring sub-nav; no success toast on status transitions; catalog form no required indicators.

### quotes
- **[M]** Two divergent `QuotesClient.tsx`; root is dead — `quotes/QuotesClient.tsx:1-437`.
- **[H→M by verifier]** Sent/accepted/expired quotes cannot be edited or deleted — `[id]/edit/page.tsx:84-87`.
- **[M]** No "Quotes" entry in finance `SectionNav`; active state never matches — `_components/QuotesClient.tsx:34-40`.
- **[M]** Quote list has no pagination (`TablePagination` imported but unused) — `:242-343`.
- **[M]** Convert handlers can hang in loading on success-with-no-invoice — `[id]/convert/page.tsx:95-108`.
- **[M]** Detail/edit/new/convert are fully client-rendered; no error.tsx/loading.tsx; permission checks client-side only.
- **[M]** New-quote form: weaker line-item validation than edit; VAT free-text vs Select.
- **[L]** No sortable columns; no unsaved-changes guard; hardcoded status colours; missing `<th scope>`; rows not keyboard-operable; raw dates; email modal validation contradicts allowed input; list not refreshed after external mutations; mark-as-expired no confirmation.

### receipts
- **[H]** Receipt file delete has no confirmation — `ui/ReceiptTableRow.tsx:363`.
- **[H]** Mobile workspace missing stats/upload/export/re-classify/rules — `ReceiptsClient.tsx:162`.
- **[M]** Mobile card status update has no optimistic/rollback (diverges from desktop) — `ui/ReceiptMobileCard.tsx:58`.
- **[M]** Signed-URL download silently no-ops on failure — `ui/ReceiptTableRow.tsx:178`.
- **[M]** Empty `aria-label` on bulk-review apply checkboxes — `ReceiptBulkReviewClient.tsx:477`.
- **[M]** Rule create/edit forms have no inline validation — `ui/ReceiptRules.tsx:517`.
- **[M]** Rule suggestions capped at 5 with no overflow access — `ui/ReceiptRules.tsx:437`.
- **[M]** Quarterly export has no loading/error state — `ui/ReceiptExport.tsx:15`.
- **[L]** Raw native note input; icon-only buttons lack `aria-label`; hardcoded palette tones; desktop sort exposes fewer columns than mobile; no top-level error boundary; "Outstanding only" hides actioned rows with no undo; mixed instant-apply vs submit search.

### expenses
- **[H]** `ExpenseForm` uses raw native inputs + hardcoded blue/gray/red colours — `_components/ExpenseForm.tsx:227-335`.
- **[M]** Create/Update/Delete give no toast; failed delete error swallowed — `ExpensesClient.tsx:185-237`.
- **[M]** Form modal hand-rolled (no focus-trap/Escape) — `:421-457`.
- **[M]** Category sidebar is fake data (hardcoded budgets vs free-text company) — `:54-62`.
- **[M]** Main page has no link to Insights (one-way nav) — `page.tsx:43-56`.
- **[M]** Expense list has no pagination (fetches all) — `actions/expenses.ts:136-185`.
- **[M]** Export logic exists but not reachable from expenses UI — `ExpensesClient.tsx:272-418`.
- **[L]** No read-only detail; `Empty` reused as loading; un-debounced company filter; receipt-presence colour-only; redundant mount-time fetch; no VAT-vs-amount validation; no unsaved-changes guard.

### mileage
- **[H→M by verifier]** Trips list has no pagination (unbounded query + full client render) — `actions/mileage.ts:318-411`.
- **[M]** No export button despite existing CSV exporter — `_components/MileageClient.tsx:213-239`.
- **[M]** No free-text search on trips — `:242-273`.
- **[M]** Delete `ConfirmDialog` has no loading/disabled state — `:382-392`.
- **[M]** No success toast on any CRUD — `:160-176`.
- **[M]** Destinations screen uses hand-rolled tables — `DestinationsClient.tsx:353-442`.
- **[M]** Hardcoded colours throughout (incl. chart `#10B981`) — `TripForm.tsx:266-443`.
- **[L]** Inconsistent page-header pattern; raw ISO dates in delete labels; future-dated trips allowed; no unsaved-changes guard; bar chart not keyboard-operable; distance-cache entries undeletable; insights card silently hidden when empty; no trip detail view.

### mgd
- **[M]** Async delete/reopen confirm closes before action resolves; no loading state — `_components/MgdClient.tsx:519-540`.
- **[M]** No way to create a return for a non-current/backfill quarter — `:322-342`.
- **[M]** No detail view, search, filter, pagination, or UI export (CSV exists) — `:418-502`.
- **[M]** BarChart bare `<canvas>` — no role/aria-label/text alt/keyboard — `BarChart.tsx:326-337`.
- **[M]** HMRC Format modal hardcodes machine count=1 and zeroes all rate bands except 20% — `MgdClient.tsx:577-594`.
- **[L]** Deep-linked period has no removable filter/back control; hardcoded hex in CollectionForm error + chart; insights error/empty wraps Alert without CardBody; HMRC modal read-only with no copy/export; collections table no search/filter/pagination + Notes never displayed; write buttons not permission-gated in UI; collection form no inline validation.

### parking-admin
- **[H]** No way to edit a parking booking after creation — `_components/ParkingClient.tsx:498-526`.
- **[H]** No UI to manage parking rates (SQL-only) — `actions/parking.ts:265-299`.
- **[H]** Destructive Cancel has no confirmation dialog — `_components/ParkingClient.tsx:510-514`.
- **[M]** Filter `Select`s have no accessible label — `:391-392`.
- **[M]** Bookings list no pagination, silently capped at 200 — `actions/parking.ts:192-198`.
- **[M]** Search refetches per keystroke — `:188`.
- **[M]** Bookings table has no error state — `:175-186`.
- **[M]** Notifications gated behind selecting a booking; no in-section picker — `:550-586`.
- **[M]** Stats/table+sidebar grids not responsive — `:376, 385`.
- **[M]** Create modal has no inline field-level validation; refund-eligibility lookup can race selection.
- **[L]** `text-blue-600` links; dead duplicate `ParkingClient.tsx` (1021 lines); refund amount input no min/max/step; "send link now" failure swallowed.

### rota
- **[H]** `_components/` dead demo tree (RotaClient + 6 children) — `_components/RotaClient.tsx:76-209`.
- **[H]** Drag-drop reassignment keyboard-inaccessible — `RotaGrid.tsx:622-624`.
- **[H→M by verifier]** Deactivated shift templates become unreachable orphans — `templates/ShiftTemplatesManager.tsx:332-334`.
- **[H]** All 7 modals hand-rolled (no focus-trap/Escape) — `CreateShiftModal.tsx:75-89`.
- **[M]** Hardcoded colours across modals/templates; `HolidayDetailModal` actions raw `<button>`; template deactivate uses `confirm()`; per-day sales-target raw inputs; native checkboxes; create-shift form lacks time-order validation; `BookHolidayModal` no toast + Cancel not disabled mid-submit.
- **[L]** Nav has no breadcrumbs/Templates tab; loading skeleton mismatch; AddShifts rows not keyboard-operable; no "undo Couldn't Work"; no employee/role filter on grid.

### menu-management
- **[H→M by verifier]** No client-side required-field validation in any drawer (`required` on non-form button never fires) — `dishes/_components/DishDrawer.tsx:305-378`.
- **[H]** Overview card-view active toggle is a no-op — `_components/MenuManagementClient.tsx:583`.
- **[M]** Recipe delete uses raw `fetch` in drawer vs server action elsewhere — `RecipeDrawer.tsx:310-327`.
- **[M]** Choice/upgrade rows allow empty `option_group` (distorts GP) — `DishDrawer.tsx:331, 345`.
- **[M]** Overview reimplements a dish list diverging from `/dishes` — `MenuManagementClient.tsx:137-618`.
- **[M]** `MenuDishesTable` hand-rolled with hardcoded palette — `MenuDishesTable.tsx:455-553`.
- **[M]** Below-target row state colour-only — `dishes/page.tsx:746-751`.
- **[M]** Overview no error state; misleading empty on load failure — `MenuManagementClient.tsx:352-574`.
- **[M]** No bulk actions despite paginated lists — `dishes/page.tsx:733-753`.
- **[M]** Inline currency edit commits on blur (accidental price saves) — `EditableCurrencyCell.tsx:53-60`.
- **[L]** In-render sort mutation; AI parse can open drawer with empty fields; fragile dirty-check; `beforeunload` no `returnValue`; raw dates; card wrapper a11y hazard.

### messages-sms
- **[H]** 3-panel layout fixed-width, breaks on mobile — `_components/MessagesClient.tsx:491`.
- **[H]** Holding-queue link/ignore failures silently swallowed — `holding/page.tsx:35`.
- **[H]** Holding queue requires pasting raw customer UUID to link — `holding/page.tsx:94`.
- **[M]** Conversation list has no error state — `MessagesClient.tsx:146`.
- **[M]** Bulk recipients table no pagination/virtualization — `bulk/BulkMessagesClient.tsx:441`.
- **[M]** Bulk "select all" only covers loaded rows — `:446`.
- **[M]** SMS composer in thread has no length/segment counter — `MessagesClient.tsx:673`.
- **[M]** User-facing dates bypass `dateUtils` — `:389`.
- **[L]** Mark-read/Refresh no loading state; bulk hardcoded colours + raw `<label>`; template editor double error report; bulk personalisation no unknown-token warning; holding link form no loading; filter counts not in accessible labels; no resend/redact/archive.

### table-bookings-admin
- **[M]** `_components/` dead mock-data tree (779 lines) — `_components/TableBookingsClient.tsx`.
- **[H]** No full edit of a booking (date/time/notes/dietary/customer) — `[id]/BookingDetailClient.tsx:722-822`.
- **[M]** Sunday pre-order line items have no admin surface — `:287-288`.
- **[M]** BOH bookings table no pagination — `boh/BohBookingsClient.tsx:816`.
- **[M]** Reports page has no loading/error state — `reports/page.tsx:83-98`.
- **[M]** Create-booking modal uses raw native buttons/inputs — `foh/components/FohCreateBookingModal.tsx:594-608`.
- **[M]** Create-booking form lacks inline validation — `:245-296`.
- **[M]** Date helpers duplicated; `toIsoDate` uses UTC (off-by-one) — `boh/BohBookingsClient.tsx:130-165`.
- **[L]** No bulk; no export; cancel captures no reason; BOH raw inputs; view toggle ad-hoc; reports chart hex; move-table single-only; auto-return-to-today surprises; back button hardcoded to `/boh`; delete dialog inconsistency.

### cashing-up
- **[M]** `SectionNav` never highlights active tab (`activeId=""`) — `layout.tsx:20`.
- **[M]** No delete/void a session — `daily/_components/DailyClient.tsx:604-625`.
- **[M]** Approve/Lock/Unlock actions exist but unwired — `actions/cashing-up.ts:99-177`.
- **[M]** Daily/weekly targets can't be set from UI — `actions/cashing-up.ts:262-301`.
- **[M]** Daily form has no validation; allows empty/zero submission — `DailyClient.tsx:244-301`.
- **[M]** No loading states anywhere; daily page swallows fetch errors as empty data — `daily/page.tsx:33-55`.
- **[M]** Dashboard "Recent Variance" is the only session list (top-7, no search/filter/sort/pagination) — `dashboard/_components/DashboardClient.tsx:232-277`.
- **[M]** Import has no per-row validation; preview caps at 10; no confirmation before bulk write.
- **[L]** No error boundary; weekly missing "no site" state; coloured variance Stat tiles don't actually colour; raw date input; hand-rolled chips; hardcoded chart hex; raw ISO dates; misleading variance delta; chevron buttons no `aria-label`; ArrowRight hijacks caret; missing-cashups action no permission check; `DENOMINATIONS` duplicated ×3; notes single-line input.

### oj-projects
- **[H→partly M by verifier]** Clients cannot be created/edited/deleted — `clients/_components/ClientsClient.tsx:300-342`.
- **[H]** Vendor billing settings (retainer hours/rate) have no UI — `actions/oj-projects/vendor-settings.ts:19-34`.
- **[H→M by verifier]** Project contacts can be removed but never added — `projects/[id]/_components/ProjectDetailClient.tsx:352-379`.
- **[H→M by verifier]** Entries capped at 200 with no pagination (older invisible); projects load all — `entries/page.tsx:9`.
- **[M]** Overview conflates loading and empty (uses `Empty` as spinner) — `_components/ProjectsOverview.tsx:498-504`.
- **[M]** No error state on any list — `projects/page.tsx:6-11`.
- **[M]** Statement date defaults use raw `toISOString`; no from≤to validation — `ClientsClient.tsx:140-143, 253-269`.
- **[M]** Status-change Select no loading/confirm; delete-project promises a rule the UI can't guarantee.
- **[L]** Statement preview hand-rolled `<table>`; budget-over-90% colour-only; `Field` label not associated; rows not keyboard-operable; back button not breadcrumbs; sticky `?edit=` param; delete-entry ignores invoice-revision result; recurring-charge disable tone inconsistency; statement Email fires without confirmation; invoice filter input unlabelled; overview client filter uses stale projects.

### short-links
- **[H→M by verifier]** Insights page silently swallows load errors (empty `catch`) — `insights/_components/InsightsClient.tsx:71-75`.
- **[M]** Main list no loading indicator during refetch — `_components/ShortLinksClient.tsx:190-201`.
- **[M]** Edit form drops the custom-slug field create offers — `ShortLinkFormModal.tsx:169-177`.
- **[M]** Empty-state check uses `links.length` but renders `displayLinks`; no `colSpan` — `ShortLinksClient.tsx:332-339`.
- **[M]** `DataTable`/`TableCell` lacks `colSpan` — empty rows misrender section-wide — `src/ds/composites/Table.tsx:159-172`.
- **[M]** Page-level volume error → silent-zero — `page.tsx:55-56`.
- **[M]** Legacy-domain range selector ad-hoc Tailwind + `text-white` — `legacy-domain/page.tsx:63-76`.
- **[M]** `UtmDropdown.tsx` dead code — `:20`.
- **[L]** Raw dates in analytics modal; plain-text loading/empty; missing `<th scope>`; no sortable/filterable tables; no success toast on create-without-clipboard; custom slug no inline validation.

### recruitment
- **[H]** ~15 mutating actions cast to `void` — no success/error feedback — `_components/RecruitmentDashboardClient.tsx:329-346`.
- **[H]** Destructive/bulk actions have no confirmation (incl. GDPR erase) — `:1807`.
- **[H→M by verifier]** Applications list has no pagination — `:757`.
- **[M]** Postings list no search/filter/sort/pagination — `:1141`.
- **[M]** Email templates can't be created or deleted — `:1946`.
- **[M]** No loading state on dashboard/per-action — `page.tsx:6`.
- **[M]** Submit buttons lack disabled/pending (double-submit) — `:277`.
- **[M]** Add-Application/posting forms have no inline validation — `:1099`.
- **[M]** Reschedule/Match selects can submit with no option — `:1672`.
- **[M]** Public booking client no loading skeleton or empty-slots state — `book/[token]/RecruitmentBookingClient.tsx:137`.
- **[L]** Native checkbox/select/file inputs; score colour cue; consent checkbox+hidden-input pattern; no primary create CTA.

### settings
- **[M]** Settings hub doesn't link to most sub-pages — `_components/SettingsClient.tsx:43-48`.
- **[H]** Pay bands/rates create-only (no edit/delete/deactivate) — `pay-bands/PayBandsManager.tsx:40-57`.
- **[M]** Customer label `icon` stored but no input — `customer-labels/CustomerLabelsClient.tsx:62-68`.
- **[M]** Customer label form no submit loading/double-submit guard — `:104-135`.
- **[M]** Native `window.confirm` in categories/budgets/calendar-notes/jobs — `categories/CategoriesClient.tsx:124-140`.
- **[M]** `TableSetupManager` hand-rolls native inputs + inline delete confirm — `table-bookings/TableSetupManager.tsx:612-658`.
- **[M]** Event Categories has no route-level permission gate — `event-categories/page.tsx:27-64`.
- **[M]** SMS Failures read-only with no remediation — `sms-failures/page.tsx:183-258`.
- **[H]** API Keys cannot be revoked/deleted — `api-keys/ApiKeysManager.tsx:273-308`.
- **[L]** No unsaved-changes guard; Currency field permanently disabled; `BudgetsManager` hardcoded colours/raw buttons; `RotaSettings` raw `<select>`; business-hours no validation/no re-fetch; event-categories raw buttons + emoji icons; calendar-notes/customer-labels hardcoded hex; per-row loading on category toggle; message-templates no search; business-hours cells typed `any`; pay-bands N+1 queries; rate forms non-inline errors.

### roles-users-rbac
- **[H]** Roles can be created but never edited — `roles/components/RoleForm.tsx:10-17`.
- **[H]** Users role filter dropdown does nothing — `users/_components/UsersContent.tsx:46-59`.
- **[H]** Users table shows hardcoded "User" role badge for every user — `:120-122`.
- **[M]** Two divergent role-management UIs — `users/_components/RolesContent.tsx:68-294`.
- **[M]** `RoleForm` hand-rolled with native inputs + hardcoded colours — `RoleForm.tsx:44-88`.
- **[M]** Create-role success no toast — `:21-25`.
- **[M]** Standalone `/roles` list has no empty state — `RoleList.tsx:24-34`.
- **[M]** `RolesContent` permission save doesn't refresh — `:158-173`.
- **[M]** Dead duplicate `UserList.tsx` — `users/components/UserList.tsx:20-105`.
- **[M]** Role delete uses `window.confirm` — `RoleCard.tsx:28`.
- **[M]** Users list no pagination (loads all auth users) — `UsersContent.tsx:45-59`.
- **[M]** Permission matrix checkboxes have empty `label=""` — `RolesContent.tsx:274-278`.
- **[L]** Inconsistent Alert API (tone/children vs variant/description); matrix `<th>` no scope; matrix grid breaks on mobile; user mgmt role-assignment-only; `/roles` no loading state.

### profile
- *(dropped)* Avatar double-prefix — verifier confirmed storage & display paths identical; corrected to low.
- **[H]** GDPR "Export My Data" omits messages (wrong join key) — `actions/profile.ts:162-166`.
- **[M]** Avatar upload has no size/type validation — `:217-224`.
- **[M]** No way to remove/clear an uploaded avatar — `ProfileClient.tsx:379-397`.
- **[M]** "Change Photo" nested in `<label>` can open file picker twice — `:380-397`.
- **[M]** Full Name accepts empty/whitespace, no required indicator — `:249-255`.
- **[M]** Dates bypass `dateUtils` — `:404-419`.
- **[M]** Password change has no current-password verification, weak 6-char min — `change-password/page.tsx:29-39`.
- **[M]** Fixed `grid-cols-[1fr_320px]` not responsive — `:187, 233`.
- **[L]** Export filename raw `toISOString`; password errors toast-only; raw `<img>` no error fallback; inconsistent page-header pattern; deletion request no persistent status; notification toggles no in-flight state.

### payroll
- **[H]** Pay bands create-only (no edit/delete) — `actions/pay-bands.ts:62-86`.
- *(dropped → L by verifier)* P&L dashboard "no error boundary" — parent `(authenticated)/error.tsx` covers it.
- **[M]** No loading states on any payroll-section page — `rota/payroll/page.tsx:15`.
- **[M]** Payroll row delete/edit-times succeed with no success toast — `PayrollClient.tsx:191-198`.
- **[M]** Destructive row delete uses ad-hoc inline buttons (not DS/confirm) — `:503-549`.
- **[M]** Manual P&L/target edits discarded on timeframe switch — `PnlClient.tsx:170-205`.
- **[M]** Month selector + many controls raw native — `PayrollClient.tsx:288-296`.
- **[M]** Edit-after-approval allowed but snapshot not re-locked/re-approved — `:356-358`.
- **[M]** Daily-breakdown rows clickable but not keyboard-operable; header no scope — `:431-453`.
- **[L]** Inline-style note chips; budget delete `confirm()`; pay-bands N+1; P&L unsaved-edits; rate forms non-inline; budget year selector colour-only; no breadcrumbs; approve enabled on empty month; effective-rate logic assumes ordering; period editor no end≥start validation.

### leave
- **[H]** Dead prototype `RotaLeave.tsx` with no-op approve/reject — `rota/_components/RotaLeave.tsx:77-80`.
- **[H]** Employee cannot cancel/edit own pending leave — `(staff-portal)/portal/leave/page.tsx:99-126`.
- **[H→M by verifier]** Manager list has no edit/delete path — `rota/leave/LeaveManagerClient.tsx:55-191`.
- **[M]** Approve/decline have no confirmation — `:83-104`.
- **[M]** Approve/decline icon buttons missing `aria-label`, raw Tailwind — `:85-102`.
- **[M]** `HolidayDetailModal`/`BookHolidayModal` hand-rolled (no Escape/focus-trap) — `HolidayDetailModal.tsx:102-113`.
- **[M]** `HolidayDetailModal` edit uses raw `<input>`; hardcoded status colours; portal "Request holiday" raw anchor.
- **[M]** No loading/error state on portal/manager lists — `portal/leave/page.tsx:61-67`.
- **[M]** Lists unbounded (no pagination/current-year default/search) — `LeaveManagerClient.tsx:199-251`.
- **[L]** Booking doesn't re-fetch usage; allowance bar `NaN` at allowance 0; rows not keyboard-operable; no breadcrumbs; "declined" vs "rejected" terminology; stale usageMap after review.

### timeclock-kiosk
- **[M]** Dead duplicate `TimeclockKiosk.tsx` — `:1-182`.
- **[M]** "On Leave" stat hardcoded to 0 — `_components/TimeclockClient.tsx:108-111`.
- **[M]** No empty state when no active employees — `:116-139`.
- **[M]** Employee/session fetch failures silently swallowed — `page.tsx:22-23`.
- **[M]** Kiosk cards have no visible keyboard focus style — `globals.css:975-993`.
- **[M]** No per-card disabled/pending feedback during clock action — `TimeclockClient.tsx:126-127`.
- **[L]** Clocked-in state colour+dot only; optimistic state can drift from server; live clock stale after sleep; bespoke CSS/raw buttons; Toaster hardcoded hex; no clock-out confirmation/undo; role hardcoded "Staff".

### staff-portal
- **[H]** Staff cannot cancel/withdraw own pending leave — `portal/leave/page.tsx:94-126`.
- **[H→M by verifier]** Leave page swallows action errors → empty state — `:66-67`.
- **[M]** `PortalClient.tsx` dead code (and only sign-out lives there) — `_components/PortalClient.tsx:33-146`.
- **[M]** No sign-out control in the portal — `layout.tsx:17-28`.
- **[M]** Missing loading states for leave list and leave/new — `portal/leave/page.tsx:34-68`.
- **[M]** No error boundary anywhere in the portal — `portal/shifts/page.tsx:315-363`.
- **[M]** Reject/open-shift requests destructive but no confirmation — `ShiftDecisionControls.tsx:72-84`.
- **[M]** Ad-hoc native buttons/links bypass `@/ds` — `:99-150`.
- **[L]** Nav no active-state; hardcoded palette + inline SVG; deprecated Badge props; leave list no filter/sort/pagination; Couldn't-Work list capped silently; reject textarea weak focus; calendar copy-link failure silently ignored; no back/breadcrumb on leave/new.

### public-table-booking-flow
- **[H]** `PublicBookingClient` unwired mockup with no submit handler — `table-booking/_components/PublicBookingClient.tsx:16, 226-231`.
- **[M]** `BookingConfirmationClient` dead code; page only redirects — `booking-confirmation/[token]/_components/BookingConfirmationClient.tsx:11`.
- **[M]** Entire route group is hardcoded redirects discarding params — `table-booking/page.tsx:3-5`.
- **[M]** Booking portal has no loading/error boundary — `booking-portal/[token]/page.tsx:125-159, 136-147`.
- **[L]** Portal hardcoded colours/native buttons; PayPal link button no `aria-busy`; capture success forces timed full-page reload; status colour-only; mockup raw dates / no validation / `10+` string trap.

### public-parking-guest-flow
- **[H]** Guest with pending/failed booking has no pay/retry action (dead-end) — `parking/guest/[id]/_components/PublicParkingClient.tsx:24-97`.
- **[H]** Failure query states (`missing_parameters`/`not_found`) silently ignored → false success message — `parking/guest/[id]/page.tsx:42-56`.
- **[M]** `notFound()` falls back to generic 404 (no branded public not-found) — `:25-27`.
- **[M]** Status values shown raw to customer (`pending_payment`, only first `_` stripped) — `PublicParkingClient.tsx:66-67`.
- **[L]** Trailing-space name when last name absent; hardcoded `#fff`; no per-page noindex on a public PII page; hardcoded contact-phone fallback (not tappable); £0.00 with no context.

### auth-and-layout
- **[H]** Sidebar has no permission gating — `src/ds/shell/SidebarNav.tsx:21-67`.
- **[H]** `AppNavigation.tsx` permission-gated nav is dead code — `AppNavigation.tsx:22-315`.
- **[M]** User role hardcoded to "Manager" — `AuthenticatedLayout.tsx:169`.
- **[M]** Login 2FA screen + Microsoft SSO button are non-functional placeholders — `LoginClient.tsx:89-128, 192-203`.
- **[M]** No app-level `not-found.tsx` (bare default 404) — *(file absent)*.
- **[M]** Error boundaries use hardcoded palette + native buttons — `global-error.tsx:30-63`.
- **[M]** `FohClockBand` silently swallows clock-in/out failures — `FohClockBand.tsx:45-61`.
- **[L]** Sign-out uses ambiguous `×` icon; auth loading is bare "Loading..." text; dead-nav `hover:bg-green-600`; no shell-level breadcrumbs; no desktop topbar user menu.

### global-components (`@/ds`)
- **[H]** `Checkbox` onChange contract ambiguous + empty `catch` → silent data loss — `Checkbox.tsx:56-66`.
- **[M]** `Checkbox`/`Radio` label/control association broken (`<button>` + inert `htmlFor`) — `Checkbox.tsx:50-96`, `Radio.tsx:34-65`.
- **[H]** `DataTable` sortable headers keyboard-inaccessible + no `aria-sort` — `DataTable.tsx:388-433`.
- **[M]** `DataTable` hardcoded gray/green/black colours — `:199-453`.
- **[H→M by verifier]** `ConfirmDialog` closes synchronously (breaks async; `loading` decorative) — `ConfirmDialog.tsx:71-80`.
- **[M]** `Tabs`/`SectionNav` lack tablist semantics + arrow-key nav — `Tabs.tsx:68-109`.
- **[M]** `SectionNav` hardcodes hex brand colours — `SectionNav.tsx:38-39`.
- **[M]** `Field` renders error/hint ids but never associates them with the control — `Field.tsx:15-42`.
- **[L]** `Avatar` hex palette; `Modal` ignores `description`/no `aria-describedby`; `EmptyState`/`RadioGroup`/`FormGroup`/`Form`/`BackButton`/`TabNav` hardcoded colours; `Toast` dual API + hex fallbacks; `Alert` silently drops `closable`/`onClose`; `DataTable` selection has no bulk-action affordance/indeterminate; base `Table` forces min-width overflow on mobile; `Switch` colour-led; mobile button order may surface destructive first; `compat/Toggle` synthetic-event contract mismatch.

### cross-section-consistency
- **[M]** Two competing page shells (`PageLayout` vs `PageHeader`) mixed within 14 sections — `PageLayout.tsx` / `PageHeader.tsx:25`.
- **[M]** Native `window.confirm()` for destructive actions in 3 call sites — `InvoiceDetailClient.tsx:302, 317`, `CalendarNotesManager.tsx:177`.
- **[M]** Route-level `loading.tsx` in only 9 of 25 sections.
- **[M]** Only one error boundary for the entire authenticated area.
- **[M]** 21 raw tables missing `<th scope>`.
- **[M]** List pagination inconsistent (table-bookings/boh and parking have none).
- **[L]** Edit-as-page vs edit-as-modal split; mixed toast sources (~43 files raw `react-hot-toast`); two empty-state components + inline text; section-nav split (`SectionNav` vs `Tabs`); hardcoded hex in dashboard/rota/reports chrome; recruitment bespoke raw-`<h1>` error block.

---

## Coverage checklist — areas reviewed

- [x] dashboard
- [x] customers (list, detail, labels)
- [x] employees (list, detail tabs, edit, onboarding wizard, birthdays, reliability)
- [x] events (index, detail, attendees, checklist, todos)
- [x] private-bookings (list, new, edit, detail, items, messages, settings)
- [x] invoices (list, detail, new/edit, recurring, catalog, vendors)
- [x] quotes (list, detail, new, edit, convert)
- [x] receipts (workspace, bulk-review, rules, export, vendors, missing, monthly, P&L)
- [x] expenses (list, form, insights)
- [x] mileage (trips, destinations, insights)
- [x] mgd (collections, returns, insights)
- [x] parking-admin (bookings, refunds, notifications)
- [x] rota (grid, modals, templates)
- [x] menu-management (overview, dishes, ingredients, recipes)
- [x] messages-sms (inbox, bulk, holding, templates)
- [x] table-bookings-admin (BOH, detail, reports, FOH create modal)
- [x] cashing-up (dashboard, daily, weekly, insights, import)
- [x] oj-projects (overview, projects, entries, clients, work-types)
- [x] short-links (list, analytics, insights, legacy-domain)
- [x] recruitment (dashboard 7 tabs, public booking)
- [x] settings (all 20 sub-pages + hub)
- [x] roles-users-rbac
- [x] profile (+ change-password)
- [x] payroll (period, pay-bands, budgets, P&L, employee pay)
- [x] leave (portal self-service, manager queue, rota-grid modals)
- [x] timeclock-kiosk
- [x] staff-portal (shifts, leave, pay summary)
- [x] employee-onboarding (token flow, steps, success)
- [x] public-table-booking-flow
- [x] public-parking-guest-flow
- [x] auth-and-layout (login, unauthorized, shell, error boundaries)
- [x] global-components (`@/ds` primitives, composites, compat)
- [x] cross-section-consistency

**Not in scope (per instructions):** backend/security depth (auth token verification, PayPal amount matching, RLS policy correctness, SQL injection), automated test coverage, and performance profiling. These warrant a separate review.
