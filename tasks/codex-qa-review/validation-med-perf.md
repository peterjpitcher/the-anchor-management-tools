# Validation: Medium-Priority Performance Findings

## MED-008: Messages inbox fetches up to 900 rows to build 25 conversations

**Verdict: CONFIRMED**

File: `src/app/actions/messagesActions.ts`

Constants at lines 64-66:
- `RECENT_CONVERSATION_LIMIT = 25` (line 64)
- `RECENT_MESSAGE_FETCH_LIMIT = 400` (line 65)
- `UNREAD_MESSAGE_FETCH_LIMIT = 500` (line 66)

Three parallel queries at lines 156-206:
1. Recent messages: `select(...)` ordered by `created_at` desc, `.limit(400)` (line 177)
2. Unread messages: `select(...)` filtered to inbound + null read_at, `.limit(500)` (line 200)
3. Unread count: `select('*', { count: 'exact', head: true })` — count-only, no rows fetched (line 203)

The third query is a head-only count (zero rows transferred), so the actual row fetch is up to **900 rows** (400 + 500). All 900 rows are then iterated in JS (lines 238-275) to build a `conversationMap`, from which only `RECENT_CONVERSATION_LIMIT = 25` recent conversations are produced (line 270). The claim is accurate: up to 900 message rows are fetched and processed client-side to display ~25 conversations.

---

## MED-009: Private bookings getBookings() uses select('*') on view without pagination

**Verdict: CONFIRMED**

File: `src/services/private-bookings.ts`, lines 1760-1793

At line 1762: `select('*', { count: 'exact' })` on the `private_bookings_with_details` view. The method accepts an optional `filters.limit` parameter (line 1782-1784), but only applies it if explicitly provided.

File: `src/app/actions/privateBookingActions.ts`, line 140:
```
const { data } = await PrivateBookingService.getBookings(filters);
```

The `filters` parameter comes from the caller and contains `status`, `fromDate`, `toDate`, `customerId` — but **no `limit` field** is passed from the action. Since `filters.limit` is never set by the action, the query returns all matching rows with no pagination. The claim is accurate.

---

## MED-010: Quotes dashboard fetches 3x1000 rows to sum in JS instead of SQL

**Verdict: CONFIRMED**

File: `src/app/(authenticated)/dashboard/dashboard-data.ts`, lines 1051-1078

Four parallel queries at lines 1051-1068:
1. **draftRes**: `select('id', { count: 'exact', head: true })` — count-only, zero rows (line 1053). This one is fine.
2. **pendingRes**: `select('total_amount')...limit(1000)` — fetches up to 1000 rows (line 1057)
3. **expiredRes**: `select('total_amount')...limit(1000)` — fetches up to 1000 rows (line 1061)
4. **acceptedRes**: `select('total_amount')...limit(1000)` — fetches up to 1000 rows (line 1065)

Results are summed in JS via `sumAmounts()` at lines 1076-1078. The claim says "3x1000" which is correct — three of the four queries fetch up to 1000 rows each (the fourth is count-only). All three fetch only `total_amount` and sum in JS. This could be done with a SQL aggregate (`SUM(total_amount)`) to avoid transferring up to 3000 rows.

Additionally, each query has a `withDeletedAtFallback` wrapper that may execute the query twice if a `deleted_at` column error occurs, potentially doubling the load.

---

## MED-011: All unpaid invoices fetched to sum in JS — no limit

**Verdict: CONFIRMED**

File: `src/app/(authenticated)/dashboard/dashboard-data.ts`, lines 886-890

Query at lines 886-890:
```typescript
supabase
  .from('invoices')
  .select('total_amount, paid_amount')
  .is('deleted_at', null)
  .in('status', unpaidStatuses),
```

No `.limit()`, no `.range()`, no pagination. All rows matching the unpaid status filter are returned. The result is then reduced in JS at lines 946-949:
```typescript
invoices.totalUnpaidValue = (allUnpaidResult.data ?? []).reduce((sum, inv) => {
  const total = Number(inv.total_amount ?? 0)
  const paid = Number(inv.paid_amount ?? 0)
  const outstanding = Math.max(0, total - paid)
```

This is purely for computing a sum — a SQL `SUM(total_amount - paid_amount)` aggregate would be more efficient. The claim is accurate.

---

## MED-012: checkUserPermission creates new Supabase client each time

**Verdict: PARTIALLY CONFIRMED**

File: `src/app/actions/rbac.ts`, lines 64-84

The `checkUserPermission` function at line 69 does:
```typescript
const supabase = await createClient();
const { data: { user } } = await supabase.auth.getUser();
```

So yes, **each call creates a new cookie-based auth client and calls `getUser()`** to identify the caller. This part of the claim is confirmed.

However, the downstream `PermissionService.checkUserPermission()` (at `src/services/permission.ts` line 101) uses `getCachedUserPermissions()` (line 85-98) which is wrapped in `unstable_cache` with a 60-second revalidation window. So while a new Supabase client + `getUser()` call happens per invocation, the actual permission DB query is cached and not repeated within the same request/cache window.

The concern is valid but the severity is mitigated: the repeated cost is the `createClient()` + `getUser()` call per check, not a full DB permission query each time. In a server action that calls `checkUserPermission` only once this is standard practice. It becomes a real issue only if multiple permission checks are performed in the same request (each one creates a client and calls `getUser()` redundantly).

---

## MED-013: Zero next/dynamic imports in the entire codebase

**Verdict: CONFIRMED**

Searched for both `next/dynamic` and `React.lazy` across the entire `src/` directory. Zero matches found for either pattern. The codebase does not use any code-splitting via dynamic imports. For a ~600-file project with multiple heavy modules (Stripe, PayPal, Twilio integrations, rich text editors, charts, etc.), this means the entire client-side bundle includes all components upfront.
