---
phase: quick
plan: 260628-mde
subsystem: sms-actions
tags: [security, dead-code-removal, server-actions]
requires: []
provides: []
affects:
  - src/app/actions/sms.ts
  - tests/actions/smsActions.test.ts
tech-stack:
  added: []
  patterns: []
key-files:
  created: []
  modified:
    - src/app/actions/sms.ts
    - tests/actions/smsActions.test.ts
decisions:
  - "Removed now-orphaned ensureCustomerForPhone import from sms.ts (used only by deleted function)"
  - "Left ensureCustomerForPhone mock + import in test file (harmless mock setup; module mock for @/lib/sms/customers still required by resolveCustomerIdForSms)"
metrics:
  duration: 5min
  completed: "2026-06-28"
---

# Phase quick Plan 260628-mde: Delete dead ungated sendOTPMessage server action Summary

Removed the dead, unauthenticated `sendOTPMessage` server action (RLS-bypassing service-role client, no auth/permission/rate-limit guards, zero production callers) from `src/app/actions/sms.ts` and its four test cases from `tests/actions/smsActions.test.ts`, eliminating an exploitable unauthenticated SMS/customer-write surface with no functional cost.

## What Was Done

- **`src/app/actions/sms.ts`**: Deleted the entire `export async function sendOTPMessage(...)` block (~78 lines). Removed the now-orphaned `ensureCustomerForPhone` import (used only by the deleted function); `createAdminClient` and `resolveCustomerIdForSms` remain in use by the gated siblings.
- **`tests/actions/smsActions.test.ts`**: Removed `sendOTPMessage` from the import statement and deleted the entire `describe('sms action OTP guards', ...)` block (4 tests). Test count went from 16 to 12.
- **Untouched**: `sendSms` and `sendBulkSMSAsync` (gated with `checkUserPermission` + rate limiters) are byte-for-byte unchanged, as are all their tests.

## Verification

- `grep -rn "sendOTPMessage" src tests` -> zero matches (grep exit 1).
- `npm run lint` -> passed, zero warnings (`--max-warnings=0`).
- `npx tsc --noEmit` -> clean compile.
- `npx vitest run tests/actions/smsActions.test.ts` -> 12 passed (1 file).

## Deviations from Plan

None - plan executed exactly as written. The plan anticipated the orphaned `ensureCustomerForPhone` import and instructed removal for cleanliness, which was done.

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: src/app/actions/sms.ts (modified, sendSms present, sendOTPMessage absent)
- FOUND: tests/actions/smsActions.test.ts (modified, sendBulkSMSAsync present, sendOTPMessage absent)
- Verified: grep for sendOTPMessage across src/tests returns nothing.
