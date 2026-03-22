---
title: Batch 3 - Architecture
aliases:
  - Architecture Improvements
  - Batch 3
tags:
  - type/reference
  - status/planned
created: 2026-03-14
updated: 2026-03-14
---

← [[Roadmap MOC]]

# Batch 3 — Architecture

**Stream:** [[Stream 1 - Platform Stability]]
**Priority:** High — this debt slows development velocity and hides bugs in critical business logic.

> [!warning] Impact on Development Speed
> The items in this batch do not break anything today, but they compound over time. A 2,200-line god class and zero test coverage on payment logic make every subsequent change a risk.

## Items

### A1 — Private bookings service is a 2,200-line god class

**Severity:** High

| Field | Detail |
|-------|--------|
| File | `src/services/private-bookings.ts` (112 KB) |
| Problem | Zod schemas, booking CRUD, payment lifecycle, SMS side-effects, calendar sync, and hold management are all mixed in one file. SMS notification logic is duplicated across 5 methods. |
| Extraction candidates | `PrivateBookingSmsService`, `PrivateBookingPaymentService`, `PrivateBookingQueryService`, `PrivateBookingCalendarService` |

> [!tip] Extraction Order
> Start with `PrivateBookingPaymentService` — it has the most test risk and the clearest boundary. SMS service second, as its logic is currently duplicated.

---

### A2 — `sendSMS` is a 470-line function with 8 responsibilities

**Severity:** High

| Field | Detail |
|-------|--------|
| File | `src/lib/twilio.ts:206-674` |
| Problem | One function handles: customer resolution, eligibility checks, rate limiting, idempotency, URL shortening, quiet hours enforcement, job queue deferral, and message logging. Any change risks breaking all 8. |

---

### A3 — Zero test coverage on critical logic

**Severity:** High

| Field | Detail |
|-------|--------|
| Files | `invoiceCalculations.ts`, `status-transitions.ts`, `phone/index.ts`, `dateUtils.ts`, `sms/safety.ts` |
| Problem | Money-handling and booking-state transition code has zero automated test coverage. A regression here is invisible until a customer or accountant reports it. |

> [!danger] Coverage Gap
> `invoiceCalculations.ts` and `status-transitions.ts` handle money and booking state. These must have tests before any refactoring work in A1 or A2 begins.

---

### A4 — Logger has no production sink

**Severity:** Medium

| Field | Detail |
|-------|--------|
| File | `src/lib/logger.ts:40-42` |
| Problem | The logger is a no-op wrapper over `console.*`. It provides zero value over direct console calls and gives a false impression that structured logging is in place. |

---

### A5 — `SupabaseClient<any>` throughout SMS layer

**Severity:** Medium

| Field | Detail |
|-------|--------|
| Files | `src/lib/sms/safety.ts`, `src/lib/sms/customers.ts`, `src/lib/sms/logging.ts` |
| Problem | The SMS layer uses untyped `SupabaseClient<any>`, bypassing all type safety on DB queries. |
| Fix | Apply the generated `Database` type from `src/types/database.generated.ts` |

---

### A6 — Duplicated logic

**Severity:** Low

| Duplicate | Locations |
|-----------|-----------|
| `stableSerialize` | `src/lib/sms/safety.ts` and `src/lib/api/idempotency.ts` |
| Hold expiry calculation | `createBooking` and `updateBooking` in private bookings service |

Fix: Single source of truth for each. Extract shared utilities and import them.

---

### A7 — Dead loyalty code still executing

**Severity:** Low

| Field | Detail |
|-------|--------|
| File | `src/app/(authenticated)/customers/page.tsx` |
| Problem | The loyalty feature was removed, but `fetchCustomerCategoryStats` still runs a DB query on every customers page load. Unused types remain in the codebase. |
| Fix | Remove the query call, dead code, and associated types |

---

### A8 — Two toast libraries coexisting

**Severity:** Low

| Field | Detail |
|-------|--------|
| Problem | Both `react-hot-toast` and `sonner` are listed in `package.json`. Only one is actively used. The other is dead weight increasing bundle size. |
| Fix | Identify which is actively used; remove the other from `package.json` |

## Summary

| ID | Severity | Area | Status |
|----|----------|------|--------|
| A1 | High | Private bookings god class | Open |
| A2 | High | sendSMS decomposition | Open |
| A3 | High | Test coverage gaps | Open |
| A4 | Medium | Logger production sink | Open |
| A5 | Medium | Supabase client typing | Open |
| A6 | Low | Duplicated logic | Open |
| A7 | Low | Dead loyalty code | Open |
| A8 | Low | Duplicate toast libraries | Open |

## Related

- [[Stream 1 - Platform Stability]]
- [[Batch 1 - Security Fixes]]
- [[Batch 2 - Performance]]
