---
title: Stream 1 - Platform Stability
aliases:
  - Platform Stability Stream
  - Stream 1
tags:
  - type/reference
  - status/active
created: 2026-03-14
updated: 2026-03-14
---

← [[Roadmap MOC]]

# Stream 1 — Platform Stability

This stream addresses the foundational health of the platform: security vulnerabilities, performance bottlenecks, and architectural debt that slows development and hides bugs. It must complete before higher-level product work can be sustained safely.

## Team

| Role | Responsibility |
|------|---------------|
| Staff Backend Engineer (System Architect) | Security fixes, architecture decomposition, technical lead |
| Database Engineer | Query optimisation, DB view changes, RPC functions |
| Test / Reliability Engineer | Coverage gaps, test infrastructure, monitoring |

## Timeline

**Months 1–2**

## Batches

| Batch | Focus | Priority |
|-------|-------|----------|
| [[Batch 1 - Security Fixes]] | 5 security issues to resolve immediately | IMMEDIATE |
| [[Batch 2 - Performance]] | DB call reduction, SSR conversion, query optimisation | High |
| [[Batch 3 - Architecture]] | God class decomposition, coverage, dead code removal | High |

## Key Deliverables

- [ ] All 5 security issues in [[Batch 1 - Security Fixes]] resolved and verified
- [ ] P95 page load < 2s across all authenticated pages
- [ ] Permission check reduced to ≤ 1 DB call per page load
- [ ] Test coverage added to all payment and booking logic
- [ ] Private bookings service decomposed into focused modules

## Outcome

A secure, scalable core platform that engineers can work in without fear of hidden blast radius or security regression.

> [!warning] Dependency
> [[Stream 2 - Product Experience]] and [[Stream 3 - Business Automation]] both depend on this stream's security fixes being resolved first. Do not ship new customer-facing features until S1–S3 are closed.

## Related

- [[Batch 1 - Security Fixes]]
- [[Batch 2 - Performance]]
- [[Batch 3 - Architecture]]
- [[Stream 2 - Product Experience]]
- [[Stream 3 - Business Automation]]
- [[Team Structure]]
