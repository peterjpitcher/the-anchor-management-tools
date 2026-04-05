# Implementation Standards Review: Mileage, Expenses, MGD Modules

**Date:** 2026-04-05
**Reviewer:** Standards Enforcement Specialist (Claude Opus 4.6)
**Scope:** Server actions, page components, and client components for Mileage, Expenses, and MGD modules
**Standards checked:** Server action pattern, ui-v2 PageLayout, dateUtils, loading/error/empty states, button types, accessibility, TypeScript strictness, Tailwind conventions, snake_case/camelCase conversion

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 3 |
| High | 9 |
| Medium | 12 |
| Low | 7 |
| **Total** | **31** |

The **Mileage** module is the most standards-compliant, using ui-v2 components consistently, proper `formatDateInLondon` usage, and following the server action pattern closely. The **MGD** module also aligns well with ui-v2. The **Expenses** module has the most deviations -- it uses raw HTML elements instead of ui-v2 components, builds a custom modal instead of using the `Modal` component, and uses `window.confirm()` instead of `ConfirmModal`.

---

## Findings

### STD-001: Expense types use snake_case instead of camelCase

**File:** `src/app/actions/expenses.ts:21-34`
**Severity:** High
**Standard violated:** Supabase Conventions (CLAUDE.md: "DB columns are snake_case; TypeScript types are camelCase")

**Current code:**
```typescript
export interface Expense {
  id: string
  expense_date: string
  company_ref: string
  // ... all snake_case
}
```

**Expected per standard:**
```typescript
export interface Expense {
  id: string
  expenseDate: string
  companyRef: string
  // ... all camelCase with fromDb<T>() conversion
}
```

---

### STD-002: Expense types not converted with `fromDb<T>()`

**File:** `src/app/actions/expenses.ts:138-151`
**Severity:** High
**Standard violated:** Supabase Conventions ("Always wrap DB results with a conversion helper e.g. `fromDb<T>()`")

**Current code:**
```typescript
const expenses: Expense[] = (data ?? []).map((row: Record<string, unknown>) => ({
  id: row.id as string,
  expense_date: row.expense_date as string,
  // manual mapping with `as` casts
}))
```

**Expected per standard:** Use `fromDb<Expense>(row)` helper to convert snake_case DB columns to camelCase TypeScript properties.

---

### STD-003: MGD types use snake_case instead of camelCase

**File:** `src/app/actions/mgd.ts:15-41`
**Severity:** High
**Standard violated:** Supabase Conventions (snake_case to camelCase)

**Current code:**
```typescript
export interface MgdCollection {
  collection_date: string
  net_take: number
  mgd_amount: number
  vat_on_supplier: number
  // ...
}
```

**Expected per standard:** All interface properties should be camelCase (`collectionDate`, `netTake`, `mgdAmount`, `vatOnSupplier`).

---

### STD-004: MGD return data not converted with `fromDb<T>()`

**File:** `src/app/actions/mgd.ts:145-164`
**Severity:** High
**Standard violated:** Supabase Conventions ("Always wrap DB results with a conversion helper")

**Current code:**
```typescript
const returns: MgdReturn[] = (data ?? []).map((r: Record<string, unknown>) => {
  // manual mapping with `as` casts
})
```

**Expected per standard:** Use `fromDb<MgdReturn>(r)` for each row.

---

### STD-005: Expenses `getExpenseStats` uses raw `new Date()` instead of dateUtils

**File:** `src/app/actions/expenses.ts:176-181`
**Severity:** Critical
**Standard violated:** Date Handling (CLAUDE.md: "Never use raw `new Date()` for user-facing dates", "Default timezone: Europe/London")

**Current code:**
```typescript
const now = new Date()
const quarterMonth = Math.floor(now.getMonth() / 3) * 3
const quarterStart = new Date(now.getFullYear(), quarterMonth, 1)
const quarterEnd = new Date(now.getFullYear(), quarterMonth + 3, 0)
const qStartStr = quarterStart.toISOString().slice(0, 10)
```

**Expected per standard:** Use `getTodayIsoDate()` from `@/lib/dateUtils` and compute quarter boundaries in Europe/London timezone. The current code uses system timezone which may produce incorrect results if the server is in UTC and it is past midnight in London but not yet in UTC (or vice versa).

---

### STD-006: MGD `updateReturnStatus` uses raw `new Date().toISOString()`

**File:** `src/app/actions/mgd.ts:477`
**Severity:** Medium
**Standard violated:** Date Handling ("Never use raw `new Date()` or `.toISOString()` for user-facing dates")

**Current code:**
```typescript
updatePayload.submitted_at = new Date().toISOString()
```

**Expected per standard:** Use dateUtils function to produce London-timezone ISO string, or at minimum use `getTodayIsoDate()` if only date precision is needed.

---

### STD-007: No `loading.tsx` files for mileage, expenses, or mgd routes

**File:** `src/app/(authenticated)/mileage/`, `expenses/`, `mgd/` (missing files)
**Severity:** Medium
**Standard violated:** UI Patterns ("Every data-driven UI must handle Loading -- skeleton loaders or spinners, not blank screens")

**Current code:** No `loading.tsx` files exist in any of the three route directories.

**Expected per standard:** Each route should have a `loading.tsx` that renders a skeleton/spinner while the server component fetches data via `Promise.all`.

---

### STD-008: Expenses module uses raw HTML elements instead of ui-v2 components

**File:** `src/app/(authenticated)/expenses/_components/ExpensesClient.tsx:242-282`
**Severity:** High
**Standard violated:** UI Components (CLAUDE.md: "New pages must use the ui-v2 pattern")

**Current code:**
```typescript
<input
  id="filter-from"
  type="date"
  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-1.5 ..."
/>
// ...
<button
  type="button"
  onClick={handleCreate}
  className="shrink-0 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white ..."
>
  New Expense
</button>
```

**Expected per standard:** Use `<Input>` from `@/components/ui-v2/forms/Input` and `<Button>` from `@/components/ui-v2/forms/Button` (as mileage and MGD modules do).

---

### STD-009: Expenses module builds custom modal div instead of using ui-v2 Modal

**File:** `src/app/(authenticated)/expenses/_components/ExpensesClient.tsx:396-433`
**Severity:** High
**Standard violated:** UI Components (ui-v2 pattern); Accessibility ("Modal dialogs trap focus and close on Escape")

**Current code:**
```typescript
<div
  className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4"
  onClick={(e) => {
    if (e.target === e.currentTarget) setShowForm(false)
  }}
  role="dialog"
  aria-modal="true"
>
```

**Expected per standard:** Use `<Modal>` from `@/components/ui-v2/overlay/Modal` which handles focus trapping, Escape key handling, and consistent styling. The custom div does not trap focus.

---

### STD-010: Expenses uses `window.confirm()` instead of ConfirmModal for destructive actions

**File:** `src/app/(authenticated)/expenses/_components/ExpensesClient.tsx:183`, `ExpenseForm.tsx:126`, `ExpenseFileViewer.tsx:63`
**Severity:** High
**Standard violated:** UI Patterns ("Confirmation dialogs on destructive actions"), Definition of Done ("Modal dialogs trap focus and close on Escape")

**Current code:**
```typescript
if (!confirm('Delete this expense and all attached receipts?')) return
```

**Expected per standard:** Use `<ConfirmModal>` or `<ConfirmDialog>` from ui-v2, as the mileage and MGD modules do. `window.confirm()` cannot be styled, breaks focus flow, and is inconsistent with the rest of the application.

---

### STD-011: Expense form uses raw HTML inputs instead of ui-v2 components

**File:** `src/app/(authenticated)/expenses/_components/ExpenseForm.tsx:209-316`
**Severity:** High
**Standard violated:** UI Components ("New pages must use the ui-v2 pattern")

**Current code:** All form fields use raw `<input>` and `<textarea>` elements with inline Tailwind classes.

**Expected per standard:** Use `<Input>` from `@/components/ui-v2/forms/Input`, `<Textarea>` from `@/components/ui-v2/forms/Textarea`, and `<FormGroup>` from `@/components/ui-v2/forms/FormGroup` (as the MGD CollectionForm does).

---

### STD-012: Expense form uses raw HTML buttons instead of ui-v2 Button

**File:** `src/app/(authenticated)/expenses/_components/ExpenseForm.tsx:431-452`
**Severity:** Medium
**Standard violated:** UI Patterns ("Consistent variant usage -- no ad-hoc Tailwind-only buttons")

**Current code:**
```typescript
<button type="submit" disabled={isLoading}
  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
```

**Expected per standard:** Use `<Button variant="primary" type="submit" loading={isLoading}>` for consistent styling and loading state handling.

---

### STD-013: Expenses page does not pass `canManage` permission to client

**File:** `src/app/(authenticated)/expenses/page.tsx`
**Severity:** Critical
**Standard violated:** Permissions/RBAC ("UI elements conditionally rendered based on permissions")

**Current code:** The page checks `canView` but never checks or passes `canManage`. The delete button and edit functionality are shown to all users who can view expenses.

**Expected per standard:** Check `canManage` permission and pass it as a prop to `ExpensesClient`, then conditionally render create/edit/delete controls (as mileage and MGD modules do).

---

### STD-014: Expenses audit log missing `resource_id` on create/update/delete

**File:** `src/app/actions/expenses.ts:271-277, 330-336, 390-396`
**Severity:** Critical
**Standard violated:** Supabase Conventions ("All mutations must call `logAuditEvent()`" with `resource_id`)

**Current code:**
```typescript
await logAuditEvent({
  user_id: userId,
  operation_type: 'create',
  resource_type: 'expense',
  operation_status: 'success',
  additional_info: { expense_id: data.id, amount: parsed.data.amount },
  // missing: resource_id
})
```

**Expected per standard:**
```typescript
await logAuditEvent({
  user_id: userId,
  operation_type: 'create',
  resource_type: 'expense',
  resource_id: data.id, // <-- required field
  operation_status: 'success',
  // ...
})
```

Mileage and MGD actions correctly include `resource_id`.

---

### STD-015: Mileage actions use admin client for all queries (including user-scoped reads)

**File:** `src/app/actions/mileage.ts:128-129, 203-207`
**Severity:** Medium
**Standard violated:** Supabase Conventions ("Use the anon-key client for user-scoped operations (respects RLS)", "Use the service-role client only for system operations, crons, and webhooks")

**Current code:**
```typescript
const db = createAdminClient() // used for all queries
```

**Expected per standard:** Read queries should use the cookie-based auth client (`createClient()` from `@/lib/supabase/server`) that respects RLS. The admin client should only be used for operations that genuinely need to bypass RLS. The MGD module correctly uses `createClient()` for auth checks, though it also uses admin for data queries.

---

### STD-016: Mileage distance cache uses `new Date().toISOString()` for timestamp

**File:** `src/app/actions/mileage.ts:896`
**Severity:** Low
**Standard violated:** Date Handling ("Never use raw `new Date()` or `.toISOString()`")

**Current code:**
```typescript
last_used_at: new Date().toISOString(),
```

**Expected per standard:** This is a server-side timestamp for a non-user-facing field, so the impact is low, but for consistency use dateUtils or let the database default handle it.

---

### STD-017: ExpenseFileViewer custom modal does not trap focus

**File:** `src/app/(authenticated)/expenses/_components/ExpenseFileViewer.tsx:89-198`
**Severity:** Medium
**Standard violated:** Accessibility ("Modal dialogs trap focus and close on Escape")

**Current code:** The viewer handles Escape key correctly but does not trap focus within the modal. Tab key can navigate to elements behind the overlay.

**Expected per standard:** Use a focus-trapping mechanism (the ui-v2 Modal component handles this automatically) or add a focus trap manually.

---

### STD-018: Expenses uses hardcoded `bg-blue-600` colour instead of design tokens

**File:** `src/app/(authenticated)/expenses/_components/ExpensesClient.tsx:279`, `ExpenseForm.tsx:215, 231, 248, 267, 279, 297, 315, 442`
**Severity:** Medium
**Standard violated:** Tailwind CSS ("Use design tokens only -- no hardcoded hex colours in components"), also `focus:border-blue-500 focus:ring-blue-500` repeated throughout

**Current code:**
```typescript
className="... bg-blue-600 ... hover:bg-blue-700"
className="... focus:border-blue-500 focus:ring-1 focus:ring-blue-500 ..."
```

**Expected per standard:** Use the project's design tokens (`primary-600`, `primary-700`, etc.) or ui-v2 components which handle this internally. The mileage module uses `focus:border-primary-600 focus:ring-primary-600` consistently.

---

### STD-019: MGD `requireMgdPermission` uses different auth pattern from mileage/expenses

**File:** `src/app/actions/mgd.ts:51-64`
**Severity:** Low
**Standard violated:** Consistency with established patterns

**Current code:**
```typescript
async function requireMgdPermission(): Promise<
  { userId: string } | { error: string }
> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const allowed = await checkUserPermission('mgd', 'manage', user.id)
  // returns union type, callers must check 'error' in result
```

**Expected per standard:** Mileage and Expenses use a throwing pattern (`throw new Error('Insufficient permissions')`) and return `{ userId, userEmail }`. The MGD approach is valid but inconsistent -- callers must use `'error' in auth` checks, which is a different control flow pattern.

---

### STD-020: MGD `requireMgdPermission` only checks `manage`, not `view`

**File:** `src/app/actions/mgd.ts:51, 60`
**Severity:** Medium
**Standard violated:** Permissions/RBAC ("Every authenticated page must check permissions")

**Current code:** The helper hardcodes `'manage'` for all operations including reads (`getCollections`, `getReturns`, `getCurrentReturn`).

**Expected per standard:** Read operations should check `'view'` permission, write operations should check `'manage'`. This is how mileage and expenses handle it.

---

### STD-021: MGD page only checks `manage` permission for page access

**File:** `src/app/(authenticated)/mgd/page.tsx:10-12`
**Severity:** Medium
**Standard violated:** Permissions/RBAC

**Current code:**
```typescript
const canManage = await checkUserPermission('mgd', 'manage')
if (!canManage) redirect('/unauthorized')
```

**Expected per standard:** Users with `view` permission should be able to see the data (read-only). Only mutation controls should be gated behind `manage`. Mileage correctly checks `view` for page access and separately passes `canManage` for UI gating.

---

### STD-022: Mileage destinations page missing navItems for consistent sub-navigation

**File:** `src/app/(authenticated)/mileage/destinations/page.tsx:16-19`
**Severity:** Low
**Standard violated:** UI Patterns ("Breadcrumbs on nested pages")

**Current code:** Uses `backButton` prop but not `navItems`, while the parent mileage page defines `navItems` for sub-navigation.

**Expected per standard:** Either consistently use `navItems` on both pages, or the current `backButton` approach is acceptable if it was an intentional design choice. Minor inconsistency.

---

### STD-023: Expenses `ExpenseFile` interface uses snake_case

**File:** `src/app/actions/expenses.ts:36-46`
**Severity:** Medium
**Standard violated:** Supabase Conventions (camelCase for TypeScript types)

**Current code:**
```typescript
export interface ExpenseFile {
  expense_id: string
  storage_path: string
  file_name: string
  mime_type: string
  file_size_bytes: number | null
  uploaded_by: string | null
  uploaded_at: string
  signed_url?: string
}
```

**Expected per standard:** Properties should be camelCase: `expenseId`, `storagePath`, `fileName`, etc.

---

### STD-024: Mileage `createAdminClient()` call inconsistency (no `await`)

**File:** `src/app/actions/mileage.ts:128`
**Severity:** Low
**Standard violated:** Consistency with Supabase client patterns

**Current code:**
```typescript
const db = createAdminClient()
```

**Note:** If `createAdminClient` is synchronous (singleton pattern), this is fine. If it should be async, the missing `await` would be a bug. The standard doc shows `await getDb()`. This needs verification against the actual implementation but is likely correct for the admin singleton.

---

### STD-025: Expense stats card uses `<dt>/<dd>` outside of a `<dl>` element

**File:** `src/app/(authenticated)/expenses/_components/ExpensesClient.tsx:467-478`
**Severity:** Low
**Standard violated:** Accessibility ("Tables use proper markup")

**Current code:**
```typescript
<div className="rounded-lg border ...">
  <dt className="...">{label}</dt>
  <dd className="...">{value}</dd>
</div>
```

**Expected per standard:** `<dt>` and `<dd>` must be children of a `<dl>` element for valid HTML. Either wrap in `<dl>` or use `<p>` elements instead.

---

### STD-026: Mileage TripForm has redundant/conflicting useEffect hooks for editing state

**File:** `src/app/(authenticated)/mileage/_components/TripForm.tsx:65-113, 175-209`
**Severity:** Medium
**Standard violated:** Code quality ("No Laziness -- find root causes")

**Current code:** Two separate `useEffect` hooks both react to `editingTrip` and `open` changes, both trying to set `stops` state. The first one (lines 65-113) sets stops, then the second one (lines 175-209) overwrites them. This is confusing and could cause race conditions.

**Expected per standard:** Consolidate into a single useEffect that handles all editing state initialization.

---

### STD-027: MGD `getCollections` casts entire row as `MgdCollection` without conversion

**File:** `src/app/actions/mgd.ts:127`
**Severity:** Medium
**Standard violated:** Supabase Conventions ("Always wrap DB results with a conversion helper")

**Current code:**
```typescript
return { success: true, data: data as MgdCollection[] }
```

**Expected per standard:** Use `fromDb<MgdCollection>()` for proper snake_case to camelCase conversion and type safety.

---

### STD-028: Expenses uses `as unknown as Error` pattern extensively for logger calls

**File:** `src/app/actions/expenses.ts:134, 192, 267, 326, 370, 384, 603, 617, 659`
**Severity:** Low
**Standard violated:** TypeScript strictness ("No `any` types unless absolutely justified")

**Current code:**
```typescript
logger.error('Failed to fetch expenses', { error: error as unknown as Error })
```

**Expected per standard:** While this avoids `any`, the double-cast `as unknown as Error` is a code smell. The logger should accept the Supabase error type directly, or a utility function should safely convert it.

---

### STD-029: Missing `error.tsx` boundary files for all three modules

**File:** `src/app/(authenticated)/mileage/`, `expenses/`, `mgd/` (missing files)
**Severity:** Low
**Standard violated:** UI Patterns ("Error -- user-facing error message or error boundary")

**Current code:** No `error.tsx` files. The pages handle errors inline (expenses and MGD show Alert components), but an unhandled runtime error would bubble to a parent error boundary or show a white screen.

**Expected per standard:** Add `error.tsx` files at the route level for graceful error recovery.

---

### STD-030: Mileage page.tsx does not handle server-side fetch errors

**File:** `src/app/(authenticated)/mileage/page.tsx:19-33`
**Severity:** Medium
**Standard violated:** UI Patterns ("Error -- user-facing error message or error boundary")

**Current code:**
```typescript
const [tripsResult, statsResult, destsResult] = await Promise.all([
  getTrips(),
  getTripStats(),
  getDestinations(),
])
const trips = tripsResult.data ?? []
// No check for tripsResult.error
```

**Expected per standard:** Check for errors and display an Alert or error state (as expenses/page.tsx does with `loadError`).

---

### STD-031: Expenses and MGD modules have no test files

**File:** (missing `__tests__/` for MGD actions and expense UI)
**Severity:** Medium
**Standard violated:** Testing Conventions ("Minimum per feature: happy path + at least 1 error/edge case"), Definition of Done ("New tests written for business logic")

**Note:** A test file exists for expenses actions (`src/app/actions/__tests__/expenses.test.ts`) but no tests were found for MGD actions or any UI components. The testing standard requires at minimum happy path + 1 error case for server actions and business logic.

---

## Module Compliance Summary

| Area | Mileage | Expenses | MGD |
|------|---------|----------|-----|
| Server action pattern (auth -> perm -> Zod -> service -> audit -> revalidate) | PASS | PARTIAL (missing resource_id in audit) | PASS |
| ui-v2 PageLayout usage | PASS | PASS | PASS |
| ui-v2 component usage (Button, Input, Modal) | PASS | FAIL (raw HTML throughout) | PASS |
| dateUtils for date display | PASS | PASS (display), FAIL (quarter calc) | PASS |
| Loading state (loading.tsx) | FAIL | FAIL | FAIL |
| Error state handling | PARTIAL (no error check on fetch) | PASS (page-level) | PASS (page-level) |
| Empty state | PASS | PASS | PASS |
| Button types | PASS | PARTIAL (raw buttons) | PASS |
| Accessibility (focus trap, aria, keyboard) | PASS | FAIL (custom modal, no focus trap) | PASS |
| TypeScript strictness | PASS | PARTIAL (as unknown as casts) | PARTIAL (as casts) |
| snake_case -> camelCase | PASS | FAIL | FAIL |
| Tailwind conventions (design tokens) | PASS | FAIL (hardcoded blue) | PASS |
| RBAC (view vs manage) | PASS | FAIL (no canManage gating) | FAIL (manage-only) |
| ConfirmModal for destructive actions | PASS | FAIL (window.confirm) | PASS |

---

## Recommended Priority

1. **Critical:** Fix STD-005 (timezone bug in expense stats), STD-013 (missing permission gating), STD-014 (missing audit resource_id)
2. **High:** Migrate Expenses UI to ui-v2 components (STD-008, 009, 010, 011, 012), fix snake_case types (STD-001, 002, 003, 004)
3. **Medium:** Add loading.tsx files, fix MGD permission model, consolidate TripForm effects, add error.tsx boundaries
4. **Low:** Minor consistency fixes, test coverage gaps
