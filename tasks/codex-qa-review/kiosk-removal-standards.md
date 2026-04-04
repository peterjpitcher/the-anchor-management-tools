# Kiosk Secret Removal — Security Analysis

**Date:** 2026-03-22
**Reviewer:** Claude Opus 4.6 (security audit)
**Scope:** Removal of `TIMECLOCK_KIOSK_SECRET` from `clockIn()` and `clockOut()` server actions

---

## Summary Verdict: LOW RISK — Acceptable

The removal of the kiosk secret does **not meaningfully degrade** the security posture. The secret was already security theatre. However, there is one **real pre-existing vulnerability** worth documenting.

---

## What Changed

| Before | After |
|--------|-------|
| `clockIn(employeeId, kioskSecret)` | `clockIn(employeeId)` |
| `clockOut(employeeId, kioskSecret)` | `clockOut(employeeId)` |
| `validateKioskSecret()` checked env var | No auth check on these two actions |
| Secret passed as prop: page -> client component -> server action | N/A |

---

## Why the Kiosk Secret Was Already Security Theatre

1. **The secret was embedded in the page payload.** `TimeclockPage` (server component) read the env var and passed it as a prop to `TimeclockKiosk` (client component). React serialises props into the HTML/RSC payload. Anyone viewing page source or network traffic could extract it.

2. **The `/timeclock` page was already fully public.** The layout at `src/app/(timeclock)/layout.tsx` has zero auth — confirmed by the comment: "No authentication required — accessible on the till iPad." The middleware (currently disabled) explicitly allowlists `/timeclock` as a public path.

3. **The page already exposed the full employee list.** `TimeclockPage` fetches all active employees (employee_id, first_name, last_name) via admin client and passes them as props. An attacker visiting `/timeclock` already had access to every active employee's UUID and name.

4. **The secret was a single static value shared across all kiosks.** Not per-session, not per-device, not rotated. Once leaked (which it was, via the payload), it provided permanent access.

**Conclusion:** Removing a secret that was already exposed in the client payload does not change the attack surface.

---

## Pre-Existing Vulnerability (Unchanged by This PR)

### SEC-001: Unauthenticated Clock In/Out — Payroll Manipulation Risk

**Severity:** MEDIUM (pre-existing, not introduced by this change)
**Status:** Existed before the kiosk secret removal; exists after it

**Description:** `clockIn(employeeId)` and `clockOut(employeeId)` are Next.js server actions — they are callable as HTTP POST endpoints by anyone who can reach the server. No authentication, no rate limiting, no device binding.

**What an attacker can do:**
- Clock any active employee in or out at arbitrary times
- Create false timeclock sessions that feed into payroll calculations
- Disrupt shift tracking and payroll approval workflows

**What an attacker CANNOT do:**
- Access manager-only actions (create/update/delete/approve sessions require `canManageTimeclock()` permission check)
- Directly modify payroll amounts (sessions must be reviewed/approved by managers)
- Access any data beyond the employee list shown on the public page

**Mitigating factors:**
1. **Manager review gate.** All timeclock sessions must be reviewed (`is_reviewed` flag) before payroll approval. Fraudulent entries would be visible in the timeclock review screen.
2. **Audit logging.** Every `clock_in` and `clock_out` operation is logged via `logAuditEvent()` with employee_id and timestamp.
3. **Payroll approval invalidation.** Any clock event automatically calls `invalidatePayrollApprovalsForDate()`, forcing re-approval — making silent manipulation harder.
4. **Physical context.** The kiosk is intended for a specific iPad at the venue. The threat model assumes physical presence, not internet-wide attack.
5. **Employee status check.** Only `Active` employees can be clocked in. Inactive/terminated employees are rejected.
6. **Double clock-in prevention.** Cannot create duplicate open sessions for the same employee.

**Blast radius assessment:**
- An attacker could create nuisance clock-in/out entries, but these would be caught during the mandatory manager review before payroll is finalised.
- The attacker needs valid employee UUIDs, which ARE exposed on the `/timeclock` page — so this is a real (if low-impact) risk.

---

## Rate Limiting Analysis

**Finding:** There is NO rate limiting on `clockIn()` or `clockOut()`.

- No rate limiting middleware on the `/timeclock` route
- No rate limiting within the server actions themselves
- No Vercel-level rate limiting configured for this path

**Risk:** An attacker could spam clock-in/clock-out requests rapidly. However:
- Double clock-in is prevented (can't create duplicate open sessions)
- Each action does 2-4 database operations, so rapid spamming could create load but not data corruption
- Audit log would capture all activity

**Recommendation (future hardening, not blocking):** Consider adding basic rate limiting (e.g., max 10 clock operations per employee per hour) via Upstash or similar.

---

## Other Callers of clockIn/clockOut

| Caller | Auth Context |
|--------|-------------|
| `TimeclockKiosk.tsx` (kiosk page) | Public, no auth |
| `FohClockWidget.tsx` (FOH dashboard) | Inside `(authenticated)` route group — user must be logged in to reach the page, but `clockIn`/`clockOut` themselves don't check auth |

The FOH widget is behind auth at the layout level, so it's not an additional exposure point.

---

## Recommendations

### Not Required (removal is safe as-is)
The kiosk secret removal is justified. It was security theatre and its removal simplifies the codebase.

### Future Hardening (optional, not blocking)
1. **Rate limiting** — Add per-employee rate limiting to `clockIn`/`clockOut` (e.g., 10 ops/employee/hour)
2. **Device binding** — If the kiosk should only work from specific devices/IPs, consider IP allowlisting or a device token
3. **PIN entry** — Consider requiring employees to enter a short PIN instead of just selecting their name from a dropdown (this is a UX change, not just a code change)
4. **Employee list protection** — The public page exposes all active employee names and UUIDs. Consider whether this is acceptable for the threat model.

---

## Final Assessment

| Question | Answer |
|----------|--------|
| Does the removal make things worse? | **No.** The secret was already exposed in the client payload. |
| Is there a real vulnerability? | **Yes, but pre-existing.** Unauthenticated clock-in/out has always been the design. |
| Is payroll at risk? | **Low.** Manager review + audit logging + approval invalidation provide defence in depth. |
| Should this block the PR? | **No.** |
| Should rate limiting be added? | **Recommended but not urgent.** |
