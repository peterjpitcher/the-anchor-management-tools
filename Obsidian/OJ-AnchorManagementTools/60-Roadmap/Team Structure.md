---
title: "Team Structure"
aliases:
  - "Team"
  - "Roles"
  - "Engineering Team"
tags:
  - type/reference
  - status/active
created: 2026-03-14
updated: 2026-03-14
---

# Team Structure

← [[Roadmap MOC]]

> [!TIP] Philosophy
> 10 specialist roles, not 10 generalist developers. Architecture, database, automation, UX, and analytics each require a distinct skill set. Generalist teams produce architecture decay.

---

## Roles

### Product Lead
**Owns the roadmap.** Turns 40 opportunities into a prioritised product plan. Defines outcomes, not just tasks. Coordinates 3 streams. Defines KPIs.
- Deep SaaS product experience
- Strong hospitality / SMB operational understanding
- Comfortable with technical architecture

---

### Stream 1 — Platform Stability

#### Staff Backend Engineer (System Architect)
Most critical hire. Owns security, service architecture, auth layers, transaction boundaries.
- Fixes: [[Batch 1 - Security Fixes]], A1, A2
- Owns: booking domain, payment flows, messaging orchestration
- 10+ years backend, distributed systems, API design, security patterns

#### Database Engineer
Performance problems here are database design problems. Schema, indexes, views, RPCs.
- Fixes: [[Batch 2 - Performance]] (P1, P2, P4, P5, P6)
- Also designs: reporting tables, analytics pipelines
- This role alone cuts latency 50–70%

#### Test / Reliability Engineer
Zero coverage on critical logic today. Builds the safety net.
- Fixes: A3 (zero test coverage)
- Builds: automated coverage, regression tests, security tests, CI pipeline
- Focus: payment logic, booking logic, status transitions

---

### Stream 2 — Product Experience

#### Full Stack Engineer (Next.js Specialist)
Next.js architecture, SSR vs client boundaries, data fetching patterns, cache tagging.
- Fixes: P3, P7, UI architecture consistency
- Implements: [[Batch 7 - Global Search]] (G1)

#### Frontend Engineer (Design Systems)
UI consistency and usability. The product feeling cohesive, not hacked together.
- Fixes: [[Batch 4 - UI UX Polish]] (U1–U8)
- Focus: component system, accessibility, mobile usability, state management

#### Product Designer (UX / Workflow Specialist)
Not a graphic designer. A workflow designer.
- Designs: booking workflows, staff usability, reporting dashboards
- Owns: deposit payment flows, contract signing UX, customer portal
- Fixes: [[Batch 8 - Customer Experience]] (E1–E4)

---

### Stream 3 — Business Automation

#### Senior Backend Engineer (Platform & Integrations)
Infrastructure and integrations. Async systems, event-driven architecture.
- Owns: SMS systems, cron architecture, notification pipelines
- Implements: [[Batch 6 - Automation]] (C1–C5)

#### Automation / Messaging Engineer
Purely customer lifecycle automation.
- Owns: SMS logic refactor, Twilio workflows, email support, reminder sequences
- Implements: win-back automation, balance reminders, invoice chasing

#### Data / Analytics Engineer
The business intelligence layer. Turns the system from tool → operational intelligence platform.
- Builds: [[Batch 5 - Business Intelligence]] (B1–B7)
- Revenue dashboards, labour vs revenue reporting, event profitability, KPI models

---

## Stream Ownership

| Stream | Owner | Batches | Monthly Outcome |
|---|---|---|---|
| [[Stream 1 - Platform Stability]] | Staff Backend Engineer | 1, 2, 3 | Secure, scalable core platform |
| [[Stream 2 - Product Experience]] | Full Stack Engineer | 4, 7, 8 | Usable product with self-service |
| [[Stream 3 - Business Automation]] | Platform Backend Engineer | 5, 6 | Revenue insights + automated comms |

---

## Related
- [[Roadmap MOC]]
- [[Stream 1 - Platform Stability]]
- [[Stream 2 - Product Experience]]
- [[Stream 3 - Business Automation]]
