# Performance Analyst Report — Timeclock Dual-Auth Fallback

**Date:** 2026-03-22
**Files reviewed:**
- `src/app/actions/timeclock.ts` (clockIn, clockOut, canManageTimeclock)
- `src/app/(authenticated)/table-bookings/foh/FohClockWidget.tsx`
- `src/app/actions/rbac.ts` (checkUserPermission)
- `src/services/permission.ts` (PermissionService.checkUserPermission, getCachedUserPermissions)

**Change under review:** Dual-auth fallback in `clockIn()` and `clockOut()` — if `validateKioskSecret()` fails, fall back to `canManageTimeclock()` which checks `timeclock:edit` permission.

---

## Findings

### PERF-001 | Severity: NONE (No Issue) | Kiosk path unaffected

**Question:** Does the fallback add unnecessary latency on the kiosk path?

**Answer:** No. `validateKioskSecret()` is a synchronous env-var comparison that returns `null` on success. When the kiosk passes a valid secret, `secretError` is `null`, the `if (secretError)` block is skipped entirely, and `canManageTimeclock()` is never called. Zero additional latency on the kiosk hot path.

---

### PERF-002 | Severity: LOW | Permission check involves auth + DB call (mitigated by cache)

**Question:** Does `canManageTimeclock()` make a database call? Is there a caching concern?

**Answer:** Yes, `canManageTimeclock()` calls `checkUserPermission('timeclock', 'edit')` which:

1. Creates a Supabase cookie-based client and calls `supabase.auth.getUser()` (one network call to verify the JWT/session).
2. Calls `PermissionService.checkUserPermission()` which uses `unstable_cache` with a 60-second TTL keyed on `['user-permissions', userId]`.

On a cache hit, step 2 is free (no DB call). On a cache miss, it makes one `admin.rpc('get_user_permissions')` call. The `getUser()` call in step 1 is unavoidable for any authenticated path and is standard overhead.

**Impact:** This fallback path only executes when a valid kiosk secret is NOT provided (i.e., an authenticated manager using the FOH widget). For that use case, the auth + cached permission check is appropriate and expected. No performance concern.

---

### PERF-003 | Severity: NONE (No Issue) | No redundant async operations

**Question:** Are there redundant async operations?

**Answer:** No. The fallback is gated behind `if (secretError)`, so the permission check only runs when the secret check fails. The two auth mechanisms are mutually exclusive in practice:

- Kiosk path: valid secret, no permission check, no auth lookup.
- FOH widget path: no secret passed, one `getUser()` + one cached permission check.

There is no scenario where both the secret validation AND the permission check do unnecessary work.

---

### PERF-004 | Severity: NONE (No Issue) | No N+1 risk in FohClockWidget

**Question:** Is there an N+1 risk in how FohClockWidget calls these functions?

**Answer:** No. `FohClockWidget` calls `clockIn(selectedId)` and `clockOut(session.employee_id)` one at a time, triggered by user interaction (button clicks). There is no loop, no batch operation, and no list rendering that triggers server actions. Each user action produces exactly one server call.

The widget does NOT pass a `kioskSecret` argument (line 49: `clockIn(selectedId)`, line 62: `clockOut(session.employee_id)`), which means `kioskSecret` is `undefined`. This causes `validateKioskSecret()` to return an error string (unless `TIMECLOCK_KIOSK_SECRET` is unset in non-production), and the fallback to `canManageTimeclock()` WILL execute on every call from this widget. This is by design -- the FOH widget is used by authenticated managers, so the permission check is the intended auth path.

---

## Summary

No performance issues found. The dual-auth pattern is well-structured:

- The kiosk path (with valid secret) has zero additional overhead.
- The authenticated path (FOH widget) adds one `getUser()` call and one cached permission check, which is standard and expected for any authenticated server action.
- The 60-second `unstable_cache` on permissions prevents repeated DB calls within the same request window and across rapid successive calls.
- No N+1 patterns exist in the caller.

**Verdict: PASS** -- no performance regressions introduced by this change.
