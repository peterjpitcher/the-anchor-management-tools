# QA Finding Validation — Security (HIGH-009 through HIGH-013)

Validated against actual source code on 2026-03-22.

---

## HIGH-009: Employee document actions sign arbitrary storage paths

**Verdict: CONFIRMED**

**File:** `src/app/actions/employeeActions.ts`, lines 812-836

The function `getAttachmentSignedUrl(storagePath: string)` at line 812 accepts a raw `storagePath` string from the caller. It checks the caller has the `employees:view_documents` permission (line 813), but it does **not** verify that:

1. The `storagePath` corresponds to an actual `employee_attachments` DB record.
2. The file belongs to an employee the caller is authorised to view.

Any authenticated user with `employees:view_documents` permission can pass an arbitrary Supabase Storage path (e.g., another bucket or another employee's file) and receive a signed URL. The same pattern repeats in `getRightToWorkPhotoUrl(photoPath)` at line 1252-1264 -- it also accepts an arbitrary path with only a blanket permission check.

**Severity assessment:** Matches the claim exactly. A user with document-view permission could access any file in the storage bucket by guessing or enumerating paths.

---

## HIGH-010: System roles mutable via permission assignment bypass

**Verdict: CONFIRMED**

**File:** `src/services/permission.ts`, lines 212-214 and 246-248; `src/app/actions/rbac.ts`, line 311

In `permission.ts`:
- `updateRole()` (line 212): checks `if (existing.is_system)` and throws "System roles cannot be modified".
- `deleteRole()` (line 246): checks `if (existing.is_system)` and throws "System roles cannot be deleted".
- `assignPermissionsToRole()` (line 267): **no `is_system` check exists**. It proceeds directly to read existing permissions and insert/delete role_permissions rows.

In `rbac.ts`:
- `assignPermissionsToRole()` (line 311): calls `requirePermission('roles', 'manage')` for auth, then delegates directly to `PermissionService.assignPermissionsToRole()` -- **no `is_system` check at this layer either**.

A user with `roles:manage` permission can add or remove permissions from system roles (e.g., `super_admin`, `manager`, `staff`), bypassing the protection that `updateRole` and `deleteRole` enforce.

**Severity assessment:** Matches the claim exactly. The `is_system` guard is missing from the permission-assignment path in both the service layer and the action layer.

---

## HIGH-011: Two cron routes fail open when CRON_SECRET unset

**Verdict: DISPUTED**

**Files:**
- `src/app/api/cron/table-booking-deposit-timeout/route.ts`, line 9
- `src/app/api/cron/private-bookings-expire-holds/route.ts`, line 10

Both files use the same pattern:
```ts
if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
```

If `CRON_SECRET` is unset, the comparison becomes: `authHeader !== "Bearer undefined"`. This does **not** "fail open." An attacker would need to send the header `Authorization: Bearer undefined` to pass the check. While this is a weak secret (the literal string "undefined"), it is not "fail open" in the traditional sense -- a request with no Authorization header, or with any normal bearer token, would still be rejected.

That said, the issue is real but less severe than claimed. The string `"Bearer undefined"` is guessable and would grant access. The mitigation should be to check `if (!process.env.CRON_SECRET)` early and reject, but as-is it does not silently accept unauthenticated requests.

**Revised verdict: PARTIALLY CONFIRMED** -- the vulnerability exists (a known bypass string works), but the description "fail open" overstates it. The routes reject requests without the specific `Bearer undefined` header.

---

## HIGH-012: Public config endpoint leaks internal vendor/commercial data

**Verdict: CONFIRMED**

**File:** `src/app/api/public/private-booking/config/route.ts`, lines 1-32

The endpoint is fully unauthenticated (no auth check). It calls:
- `PrivateBookingService.getVenueSpaces(true, true)`
- `PrivateBookingService.getCateringPackages(true, true)`
- `PrivateBookingService.getVendors(undefined, true, true)`

The `getVendors()` call (in `src/services/private-bookings.ts`, line 2256) runs `select('*')` on the `vendors` table, returning **all columns** including any internal fields (contact details, rates, preferred status, notes, etc.). There is no field filtering or projection for public consumption.

The same applies to venue spaces and catering packages -- they use `select('*')` patterns. All raw database records are returned to unauthenticated callers without any field stripping.

**Severity assessment:** Matches the claim. The endpoint intentionally serves public booking configuration, but `select('*')` exposes internal commercial data (vendor rates, preferred flags, potentially contact info) that should not be publicly visible.

---

## HIGH-013: persistOverdueInvoices() called on every invoice read

**Verdict: CONFIRMED**

**File:** `src/services/invoices.ts`, lines 276 and 331

- `getInvoices()` (line 276): calls `await this.persistOverdueInvoices()` before every paginated list fetch.
- `getInvoiceById()` (line 331): calls `await this.persistOverdueInvoices()` before every single-invoice fetch.

`persistOverdueInvoices()` (lines 248-266) runs an `UPDATE` via the admin client on every call, setting all `sent` invoices past their due date to `overdue` status. This means:

1. Every read operation triggers a write (UPDATE) against the invoices table.
2. The admin client is used (bypassing RLS), adding privilege escalation on what should be a read-only path.
3. Multiple concurrent readers trigger redundant UPDATE statements.
4. A failure in `persistOverdueInvoices()` throws an error, causing the entire read to fail.

**Severity assessment:** Matches the claim exactly. This is both a performance concern (write-on-read, no caching/debouncing) and a correctness concern (read path should not mutate data, and failure in the mutation blocks the read).

---

## Summary

| Finding | Verdict |
|---------|---------|
| HIGH-009: Arbitrary storage path signing | **CONFIRMED** |
| HIGH-010: System role permission bypass | **CONFIRMED** |
| HIGH-011: Cron routes fail open | **PARTIALLY CONFIRMED** (guessable bypass, not truly "fail open") |
| HIGH-012: Public endpoint leaks vendor data | **CONFIRMED** |
| HIGH-013: Write-on-read in invoice service | **CONFIRMED** |
