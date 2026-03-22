# Validation: MED-014 through MED-020 (Standards & Code Quality)

Validated on: 2026-03-22

---

## MED-014: `error: any` occurrences across action files

**Verdict: PARTIALLY CONFIRMED**

The pattern is real and pervasive, but the numbers are overstated.

- **Actual count:** 143 occurrences across 20 action files (not 171 across 31).
- There are 67 total action files in `src/app/actions/`, so 20/67 (30%) are affected.
- Top offenders by count:
  - `privateBookingActions.ts` — 38
  - `employeeActions.ts` — 18
  - `menu-management.ts` — 17
  - `invoices.ts` — 13
  - `business-hours.ts` — 12
  - `cashing-up.ts` — 11
  - `short-links.ts` — 10
- Every instance follows the `catch (error: any)` anti-pattern, using `any` to access `error.message` without proper type narrowing.

---

## MED-015: No `fromDb` conversion layer exists despite documented standard

**Verdict: CONFIRMED**

- Searched for `fromDb` across the entire `src/` directory: **zero results**.
- The workspace-level CLAUDE.md documents `fromDb<T>()` as a required pattern for converting snake_case DB columns to camelCase TypeScript types.
- No equivalent utility (e.g., `convertFromDb`, `dbToJs`, `snakeToCamel` wrapper) was found.
- DB results appear to be used directly without case conversion throughout the codebase.

---

## MED-016: Hardcoded personal phone/name PII in email templates

**Verdict: CONFIRMED**

`07995087315` appears in **12 locations** across 8 files:
- `src/app/actions/email.ts` (line 429)
- `src/app/actions/invoices.ts` (line 193)
- `src/lib/quote-template-compact.ts` (lines 472, 488)
- `src/lib/invoice-template-compact.ts` (lines 608, 626)
- `src/components/features/invoices/EmailInvoiceModal.tsx` (line 41)
- `src/components/modals/EmailQuoteModal.tsx` (line 39)
- `src/components/modals/ChasePaymentModal.tsx` (line 52)
- `src/lib/microsoft-graph.ts` (lines 137, 154, 261)

`"Peter Pitcher"` appears in **13 locations** across the same 8 files plus:
- `src/app/actions/employeeActions.ts` (line 66) — notably uses `process.env.DOCUMENT_EMAIL_SENDER || 'Peter Pitcher'` as a fallback, showing awareness of the issue but inconsistent application.

Only 1 out of 13 locations uses an env var with fallback. The rest are fully hardcoded. The claim of "10+ locations" is accurate.

---

## MED-017: Raw `new Date()` bypassing dateUtils for user-facing dates

**Verdict: CONFIRMED**

Found **9 instances** of `.toLocaleDateString()` across 6 files, all user-facing:

1. `src/components/features/employees/RightToWorkTab.tsx` (lines 206, 222) — displaying document expiry and follow-up dates
2. `src/components/features/employees/HealthRecordsTab.tsx` (line 45) — disability registration expiry
3. `src/components/features/employees/OnboardingChecklistTab.tsx` (line 164) — completion dates
4. `src/components/features/employees/EmployeeAttachmentsList.tsx` (line 216) — upload dates
5. `src/components/features/messages/MessageThread.tsx` (lines 87, 132) — message timestamps and "Today" comparison
6. `src/app/(authenticated)/menu-management/ingredients/page.tsx` (line 1200) — price effective dates
7. `src/app/(authenticated)/messages/bulk/page.tsx` (line 501) — event dates

All are user-facing UI components rendering dates without locale/timezone control. The `dateUtils.ts` library (`formatDateInLondon()` etc.) exists but is not used in these locations.

---

## MED-018: Zero `error.tsx` boundaries in authenticated route tree

**Verdict: CONFIRMED**

- Searched for `error.tsx` files across the entire `src/app/` directory: **zero results**.
- There are no error boundaries anywhere in the application, not just the authenticated routes.
- This means any unhandled runtime error in a route segment will bubble up to Next.js's default error handling (a generic error page with no recovery option).

---

## MED-019: Unsafe `FormData.get() as Type` casts without validation

**Verdict: CONFIRMED**

At `src/app/actions/invoices.ts` lines 414-415:

```typescript
const invoiceId = formData.get('invoiceId') as string
const newStatus = formData.get('status') as InvoiceStatus
```

- There is a null check on line 418 (`if (!invoiceId || !newStatus)`) but **no runtime type validation** that `newStatus` is actually a valid `InvoiceStatus` enum value.
- A malicious or buggy client could submit any string as `status`, and it would pass the truthy check but be an invalid status value.
- No Zod schema or `.includes()` check is present before the value is used.

---

## MED-020: `console.log` in production server actions

**Verdict: CONFIRMED**

**`src/app/actions/receipts.ts`** — 3 instances:
- Line 683: `console.log('[retro] applyAutomationRules start', {...})`
- Line 995: `console.log('[receipts] applyAutomationRules summary', summary)`
- Line 1127: `console.log('[retro-step] processed chunk', {...})`

**`src/app/actions/event-categories.ts`** — 2 instances:
- Line 475: `console.log('Categorize result:', count)`
- Line 511: `console.log('Rebuild stats result:', count)`

All 5 are debug/diagnostic logs that should not be in production server actions. They leak implementation details into server logs and add noise. The receipts.ts logs appear to be development tracing for an automation pipeline; the event-categories.ts logs are operation result logging that should use a proper logging framework or be removed.

---

## Summary

| Finding | Verdict | Notes |
|---------|---------|-------|
| MED-014 | PARTIALLY CONFIRMED | 143 occurrences in 20 files (not 171 in 31), but pattern is real |
| MED-015 | CONFIRMED | `fromDb` does not exist anywhere in the codebase |
| MED-016 | CONFIRMED | 12+ hardcoded PII locations across 8 files |
| MED-017 | CONFIRMED | 9 instances in 6 user-facing component files |
| MED-018 | CONFIRMED | Zero error.tsx files in entire app, not just authenticated routes |
| MED-019 | CONFIRMED | `as InvoiceStatus` cast with no runtime validation |
| MED-020 | CONFIRMED | 5 console.log statements across 2 server action files |
