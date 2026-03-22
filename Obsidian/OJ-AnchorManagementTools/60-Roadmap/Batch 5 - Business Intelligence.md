---
title: Batch 5 - Business Intelligence
aliases:
  - Business Intelligence
  - Batch 5
tags:
  - type/reference
  - status/planned
created: 2026-03-14
updated: 2026-03-14
---

← [[Roadmap MOC]]

# Batch 5 — Business Intelligence

**Stream:** [[Stream 3 - Business Automation]]
**Priority:** Medium — revenue and labour data already exist in the DB; they just aren't joined or surfaced.

> [!info] No New Data Sources Required
> All items in this batch are achievable by joining data that already exists across modules. No new integrations or data collection is needed.

## Items

### B1 — No labour cost on rota dashboard

**Impact:** High

| Field | Detail |
|-------|--------|
| File | `src/app/(authenticated)/rota/dashboard/page.tsx` |
| Problem | The rota dashboard shows hours worked but no pound value. Pay bands are already stored in the DB. Labour cost as a percentage of revenue is the number-one KPI in hospitality management. |
| Fix | Join shift hours × pay band rates to compute weekly and monthly labour cost totals |

> [!tip] Labour:Revenue Ratio
> Once B1 and B2 are both complete, the rota dashboard can show a labour-to-revenue ratio directly. This is the single most actionable number for a hospitality manager.

---

### B2 — No revenue vs labour cross-analysis

**Impact:** High

| Field | Detail |
|-------|--------|
| Problem | Revenue data lives in cashing-up records; labour data lives in the rota. These have never been joined. A daily labour:revenue ratio requires data from both modules. |
| Fix | New cross-module view or dashboard section that joins cashing-up totals with rota labour cost by date |

---

### B3 — Private booking pipeline not reported

**Impact:** Medium

| Field | Detail |
|-------|--------|
| Problem | There is no aggregate of confirmed-but-unpaid booking values. A manager cannot see the revenue pipeline or forecast expected incoming payments. |
| Fix | Pipeline value tile on the private bookings dashboard showing total value of confirmed unpaid bookings |

---

### B4 — No revenue today tile on main dashboard

**Impact:** Medium

| Field | Detail |
|-------|--------|
| Problem | The main dashboard shows operational context (covers, events, staff on shift) but no financial context for the day. |
| Fix | Revenue today tile: estimated revenue from confirmed table covers + confirmed private booking values for today's date |

---

### B5 — Event attendance vs capacity not shown

**Impact:** Medium

| Field | Detail |
|-------|--------|
| Problem | The main dashboard shows "1 event today" but not the attendance vs capacity. "Quiz Night tonight — 34/50" is far more actionable than a count. |
| Fix | Expand the event tile to show current attendance count against event capacity |

---

### B6 — Audit log missing user filter and resource search

**Impact:** Medium

| Field | Detail |
|-------|--------|
| File | `src/app/(authenticated)/settings/audit-logs/AuditLogsClient.tsx` |
| Problem | The audit log cannot be filtered by staff member or searched by resource ID. There is no export capability. Investigating an incident requires manually scanning the full log. |
| Fix | User filter dropdown, resource ID search field, and CSV export action |

---

### B7 — No event profitability tracking

**Impact:** Low

| Field | Detail |
|-------|--------|
| Problem | There is no mechanism to attribute cashing-up revenue to a specific event. Whether "Quiz Night" is profitable compared to a regular Friday night is unknown. |

## Summary

| ID | Impact | Area | Status |
|----|--------|------|--------|
| B1 | High | Labour cost on rota | ✅ Complete |
| B2 | High | Revenue vs labour view | ✅ Complete |
| B3 | Medium | Booking pipeline tile | ✅ Complete |
| B4 | Medium | Revenue today tile | ✅ Complete |
| B5 | Medium | Event attendance vs capacity | ✅ Complete |
| B6 | Medium | Audit log filters and export | Open |
| B7 | Low | Event profitability | ✅ Complete |

## Related

- [[Stream 3 - Business Automation]]
- [[Batch 6 - Automation]]
