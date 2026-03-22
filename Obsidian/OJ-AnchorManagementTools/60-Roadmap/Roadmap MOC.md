---
title: "Optimisation Roadmap MOC"
aliases:
  - "Roadmap"
  - "Improvement Plan"
  - "Product Roadmap"
tags:
  - type/moc
  - status/active
created: 2026-03-14
updated: 2026-03-14
---

# Optimisation Roadmap — Map of Content

← [[Home]]

> [!INFO] About This Roadmap
> 40 opportunities identified across a full specialist audit (security, performance, architecture, UX, business intelligence, automation). Grouped into 8 batches, delivered by 3 streams, 10 specialist roles.

---

## Batches

| # | Batch | Items Remaining | Priority | Stream |
|---|---|---|---|---|
| [[Batch 1 - Security Fixes]] | Critical security & correctness | 5 | **Immediate** | Platform Stability |
| [[Batch 2 - Performance]] | Query & data fetching optimisation | 7 | High | Platform Stability |
| [[Batch 3 - Architecture]] | Technical debt & code quality | 8 | High | Platform Stability |
| [[Batch 4 - UI UX Polish]] | Component consistency & usability | 8 | Medium-High | Product Experience |
| [[Batch 5 - Business Intelligence]] | Reporting & KPI dashboards | 1 of 7 | Medium | Business Automation |
| [[Batch 6 - Automation]] | Customer lifecycle automation | 1 of 5 | Medium | Business Automation |
| [[Batch 8 - Customer Experience]] | Self-service & online payments | 1 of 4 | Lower | Product Experience |

---

## Streams

| Stream | Team | Batches | Outcome |
|---|---|---|---|
| [[Stream 1 - Platform Stability]] | Staff Backend + DB Engineer + Test Engineer | 1, 2, 3 | Secure, scalable core |
| [[Stream 2 - Product Experience]] | Product Designer + Frontend + Full Stack | 4, 8 | Usable, self-service product |
| [[Stream 3 - Business Automation]] | Platform Backend + Automation + Data Engineer | 5, 6 | Revenue insights + automated comms |

---

## Team

→ [[Team Structure]] — 10 specialist roles, how they coordinate

---

## Timeline

| Phase | Months | Deliverables |
|---|---|---|
| Phase 1 | 1–2 | Security fixed, performance improved, architecture stabilised |
| Phase 2 | 3–4 | Automation workflows, global search, reporting dashboards |
| Phase 3 | 5–6 | Customer portal, deposit payments, digital contracts |

---

## KPIs

Success metrics defined by the Product Lead:

- **Security**: 0 data-visibility bugs, 100% server actions auth-gated
- **Performance**: Page load P95 < 2s, permission checks ≤ 1 DB round-trip per page
- **Automation**: Invoice chase rate 100% automated, balance reminder automation rate 100%
- **BI**: Labour:revenue ratio visible daily, private booking pipeline value on dashboard
- **UX**: 0 `window.confirm` dialogs, 100% mobile-accessible filter controls

---

```dataview
LIST
FROM "OJ-AnchorManagementTools/60-Roadmap"
WHERE type != "moc"
SORT file.name ASC
```
