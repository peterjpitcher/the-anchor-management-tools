---
title: "Business Rules MOC"
aliases:
  - "Business Rules"
  - "Policies"
  - "Domain Rules"
tags:
  - type/moc
  - status/active
created: 2026-03-14
updated: 2026-03-14
---

# Business Rules — Map of Content

← [[Home]]

## Notes in This Section

- [[Deposits & Payments]] — Deposit policy, payment methods, Stripe/PayPal integration
- [[SMS Policy]] — Opt-in rules, quiet hours, rate limits, approval workflow
- [[Employee Lifecycle]] — Onboarding, active, separation, and former statuses

---

> [!WARNING] Legacy Code Alert
> The application previously used "credit card holds" for deposits. This has been replaced with **£10 cash deposits per person** for groups of 7+. Any reference to "credit card hold" in code or templates is a **bug**.

---

```dataview
LIST
FROM "OJ-AnchorManagementTools/50-Business-Rules"
WHERE type != "moc"
SORT file.name ASC
```
