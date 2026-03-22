---
title: Stream 3 - Business Automation
aliases:
  - Business Automation Stream
  - Stream 3
tags:
  - type/reference
  - status/active
created: 2026-03-14
updated: 2026-03-14
---

← [[Roadmap MOC]]

# Stream 3 — Business Automation

This stream delivers revenue visibility and automated customer communications. It targets the operational overhead that currently falls on staff: manually chasing invoices, sending booking reminders, and compiling financial reports from separate modules.

## Team

| Role | Responsibility |
|------|---------------|
| Senior Backend Engineer (Platform & Integrations) | Cron infrastructure, Stripe/PayPal integration, cross-module queries |
| Automation / Messaging Engineer | Invoice chasing, booking reminders, SMS sequences |
| Data / Analytics Engineer | Labour cost joins, revenue dashboards, cross-module reporting |

## Timeline

**Months 2–4**

## Batches

| Batch | Focus | Priority |
|-------|-------|----------|
| [[Batch 5 - Business Intelligence]] | Labour cost, revenue reporting, pipeline visibility | Medium |
| [[Batch 6 - Automation]] | Invoice chasing, balance reminders, win-back SMS | Medium |

## Key Deliverables

- [ ] Labour cost visible on rota dashboard (shift hours × pay band rates)
- [ ] Revenue vs labour cross-analysis view joining cashing-up and rota data
- [ ] Invoice overdue chasing automated at day 0, +7, and +14
- [ ] Private booking balance reminders automated at T-7 days and T-1 day
- [ ] Win-back bulk SMS action wired up on the customers insights page

## Outcome

Revenue insights surface to managers without manual compilation, and routine customer communications run automatically — reducing the manual workload on staff and improving payment collection rates.

> [!tip] Integration Note
> This stream relies on existing Twilio and Microsoft Graph integrations already present in the codebase. No new third-party integrations are required for [[Batch 6 - Automation]]. [[Batch 5 - Business Intelligence]] requires only DB-level joins — no new data sources.

## Related

- [[Batch 5 - Business Intelligence]]
- [[Batch 6 - Automation]]
- [[Stream 1 - Platform Stability]]
- [[Stream 2 - Product Experience]]
- [[Team Structure]]
