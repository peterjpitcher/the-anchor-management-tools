---
title: Batch 6 - Automation
aliases:
  - Automation
  - Batch 6
tags:
  - type/reference
  - status/planned
created: 2026-03-14
updated: 2026-03-14
---

← [[Roadmap MOC]]

# Batch 6 — Automation

**Stream:** [[Stream 3 - Business Automation]]
**Priority:** Medium — high operational impact. Each item removes a class of manual staff work entirely.

> [!info] Integration Dependencies
> All automation items use existing integrations: Twilio (SMS) and Microsoft Graph (email) are already wired up. No new third-party services are required.

## Items

### C1 — No automated invoice chasing

**Impact:** High

| Field | Detail |
|-------|--------|
| Problem | Overdue invoices must be manually chased by staff. No automated email is sent at the point an invoice becomes overdue, or at +7 or +14 days. |
| Fix | Cron job using existing Microsoft Graph email integration |
| Schedule | Daily — checks for invoices overdue by 0, 7, and 14 days |
| New files | `src/app/api/cron/invoice-reminders/route.ts`, invoice service method, email template, `vercel.json` cron entry |

> [!tip] Templates Already Exist
> The Microsoft Graph email integration and existing email templates provide the foundation. This is primarily a cron job and service method addition.

---

### C2 — No booking balance reminder automation

**Impact:** High

| Field | Detail |
|-------|--------|
| Problem | The dashboard surfaces bookings with balances due within 14 days, but sends nothing automatically. Staff must manually identify and chase each one. |
| Fix | Cron job sending SMS (via Twilio) and email (via Microsoft Graph) at T-7 days and T-1 day before balance due date |
| New files | `src/app/api/cron/booking-balance-reminders/route.ts` |
| Guard | Must check `sms_opt_out` before sending SMS; must not double-send if reminder already sent |

---

### C3 — Win-back list has no send action

**Impact:** Medium

| Field | Detail |
|-------|--------|
| Problem | Win-back candidates are identified and listed on `/customers/insights`, but there is no bulk SMS trigger on the page. Staff must manually navigate to Messages and compose an individual message for each customer. |
| Fix | "Send win-back SMS" button on the insights page, using the existing bulk SMS infrastructure |

---

### C4 — No customer-facing email

**Impact:** Medium

| Field | Detail |
|-------|--------|
| Problem | All customer communications are currently SMS only. Customers without a mobile number, or those who have opted out, receive no communications at all. The Microsoft Graph email infrastructure is present but not wired to the customer communications flow. |

---

### C5 — No post-event follow-up sequence

**Impact:** Low

| Field | Detail |
|-------|--------|
| Problem | There is no automated message sent to customers after a visit. A "thanks for visiting — here's what's on next month" message at day 7 post-visit would support repeat bookings. |

## Summary

| ID | Impact | Area | Status |
|----|--------|------|--------|
| C1 | High | Invoice chasing cron | Open |
| C2 | High | Balance reminder cron | ✅ Complete |
| C3 | Medium | Win-back SMS action | ✅ Complete |
| C4 | Medium | Customer email channel | ✅ Complete |
| C5 | Low | Post-event follow-up | ✅ Complete |

## New Cron Jobs Required

| Route | Purpose | Schedule |
|-------|---------|----------|
| `api/cron/invoice-reminders` | Chase overdue invoices at day 0, +7, +14 | Daily |
| `api/cron/booking-balance-reminders` | Balance due reminders at T-7 and T-1 | Daily |

## Related

- [[Stream 3 - Business Automation]]
- [[Batch 5 - Business Intelligence]]
