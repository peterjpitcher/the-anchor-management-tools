---
title: Batch 4 - UI UX Polish
aliases:
  - UI UX Polish
  - Batch 4
tags:
  - type/reference
  - status/planned
created: 2026-03-14
updated: 2026-03-14
---

← [[Roadmap MOC]]

# Batch 4 — UI/UX Polish

**Stream:** [[Stream 2 - Product Experience]]
**Priority:** Medium-High — accessibility issues and mobile regressions affect all staff daily.

> [!info] Migration Context
> The codebase is mid-migration from the legacy `PageWrapper`/`Page` pattern to `PageLayout` + `HeaderNav` from `src/components/ui-v2/`. Items in this batch accelerate that migration where it matters most.

## Items

### U1 — `window.confirm` for cancel/delete actions

**Impact:** High

| Field | Detail |
|-------|--------|
| Files | `PrivateBookingsClient.tsx:281`, `customers/page.tsx:298` |
| Problem | Destructive actions use the browser's native `window.confirm` dialog — inaccessible, unstyled, and inconsistent with the ui-v2 design language. `DeleteBookingButton` correctly uses a proper `ConfirmDialog` component; these two instances are regressions. |
| Fix | Replace with the `ConfirmDialog` component from ui-v2 |

> [!warning] Accessibility Issue
> `window.confirm` cannot be styled, does not trap focus correctly in all browsers, and blocks the main thread. It fails WCAG 2.1 SC 4.1.3.

---

### U2 — Mobile filter bar hidden on private bookings

**Impact:** High

| Field | Detail |
|-------|--------|
| File | `PrivateBookingsClient.tsx:429` |
| Problem | The filter bar is wrapped in `hidden sm:block` — mobile users cannot search or filter the main booking list at all. |
| Fix | Collapsible filter drawer or mobile-optimised filter UI that is accessible on all screen sizes |

---

### U3 — Employees page throws on error instead of graceful UI

**Impact:** Medium

| Field | Detail |
|-------|--------|
| File | `src/app/(authenticated)/employees/page.tsx:44` |
| Problem | `throw new Error(initialData.error)` hits the Next.js error boundary, showing a full-page error instead of an in-page message. |
| Fix | Pass `initialError` as a prop to the client component and render a styled error state — same pattern as `invoices/page.tsx` |

---

### U4 — Rota error is a raw paragraph

**Impact:** Medium

| Field | Detail |
|-------|--------|
| File | `src/app/(authenticated)/rota/page.tsx:92-98` |
| Problem | Error state renders as `<p className="text-red-600">Error loading rota...</p>` instead of using the `PageLayout` error prop. |
| Fix | Use the `PageLayout error` prop pattern for consistency |

---

### U5 — No loading state on `CustomerForm`

**Impact:** Medium

| Field | Detail |
|-------|--------|
| Problem | No `isSubmitting` state tracking and no `loading` prop on the submit button. A user can click submit multiple times before the server action completes, risking duplicate submissions. |
| Fix | Track `isSubmitting` state; disable and show a spinner on the submit button during the server action call |

---

### U6 — Raw `<button>` elements bypassing ui-v2

**Impact:** Low

| Field | Detail |
|-------|--------|
| File | `PrivateBookingsClient.tsx:640, 777` |
| Problem | The "Hide" action on bookings uses raw Tailwind-styled `<button>` elements instead of the `Button` component from ui-v2, breaking visual and behavioural consistency. |
| Fix | Replace with the appropriate `Button` variant from ui-v2 |

---

### U7 — DataTable `sortable` not wired up

**Impact:** Low

| Field | Detail |
|-------|--------|
| Problem | The `DataTable` component supports `sortable: true` per column configuration, but the Private Bookings and Customers table definitions do not define sortable columns. Staff cannot sort either list. |

---

### U8 — Raw `<select>` in Customers page

**Impact:** Low

| Field | Detail |
|-------|--------|
| File | `customers/page.tsx:585` |
| Problem | The page-size selector uses a raw HTML `<select>` element, not the `Select` component from ui-v2. |
| Fix | Replace with ui-v2 `Select` component |

## Summary

| ID | Impact | Area | Status |
|----|--------|------|--------|
| U1 | High | Confirmation dialogs | Open |
| U2 | High | Mobile filter bar | Open |
| U3 | Medium | Employees error state | Open |
| U4 | Medium | Rota error state | Open |
| U5 | Medium | CustomerForm loading state | Open |
| U6 | Low | Raw button elements | Open |
| U7 | Low | DataTable sorting | Open |
| U8 | Low | Raw select element | Open |

## Related

- [[Stream 2 - Product Experience]]
- [[Batch 7 - Global Search]]
- [[Batch 8 - Customer Experience]]
