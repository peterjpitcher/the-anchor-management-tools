---
title: Employee Lifecycle
aliases:
  - employee status
  - onboarding process
  - offboarding process
tags:
  - type/reference
  - section/business-rules
  - status/active
created: 2026-03-14
updated: 2026-03-14
---

← [[Business Rules MOC]]

# Employee Lifecycle

Employees at The Anchor progress through four statuses from hire to departure. This note covers what each status means, the steps involved at each transition, and the compliance requirements that must be met.

## Status Overview

| Status | Meaning | Typical Triggers |
|---|---|---|
| `onboarding` | New hire in progress | HR creates the employee record |
| `active` | Currently employed | Onboarding is complete |
| `separation` | In notice period or exiting | Resignation or termination |
| `former` | No longer employed | Separation and offboarding complete |

## Lifecycle Diagram

```
onboarding → active → separation → former
```

## Onboarding Process

When a new employee joins, the [[Employees]] module captures the following information in sequence:

1. **Create employee record** — name, contact details, job title, start date
2. **Financial details** — bank account number, sort code, NI number, payee name
3. **Health record** — medical conditions, disabilities, allergies, medications
4. **Emergency contact** — next-of-kin name and contact details
5. **Right-to-work verification** — document type, document number, expiry date; verified by a manager
6. **Attachments** — signed employment contract, certificates, and any other required documents
7. **Mark status = `active`** — employee is now on the active payroll

> [!NOTE] Sensitive Data Permissions
> Financial details and health records are stored in separate sub-tables with stricter RBAC than the main employee profile. Not all staff roles can view or edit these fields — see the [[Employee Model]] for the table structure.

## Right-to-Work Expiry

The `expiry_date` on `employee_right_to_work` is actively tracked by the system:

- Staff with expiry dates approaching are flagged in the [[Employees]] UI
- An expired right-to-work is a legal compliance issue — the system displays a prominent warning
- The document must be re-verified and the record updated before expiry

> [!WARNING] Right-to-Work Compliance
> Employing someone whose right-to-work has expired is a criminal offence. The expiry flag must not be dismissed or ignored. Escalate to management immediately.

## Separation Process

When an employee leaves The Anchor:

1. Set status to `separation`
2. Record the `end_date` on the employee record
3. Process any final payroll via the [[Rota]] payroll module
4. Complete offboarding tasks (return of keys, equipment, etc.)
5. Set status to `former` once all offboarding steps are complete

## Data Retention

> [!WARNING] Records Are Never Deleted
> Former employee records are **retained permanently** for legal and tax compliance. They are marked `former` and become **read-only** in the UI. Do not attempt to delete employee records — use the status field to reflect their current state.

This applies to all sub-tables: financial details, health records, right-to-work records, attachments, and notes are all retained alongside the main employee record.

## Related

- [[Business Rules MOC]]
- [[Employee Model]]
- [[Employees]]
- [[Rota]]
