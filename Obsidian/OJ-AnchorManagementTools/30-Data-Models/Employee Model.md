---
title: Employee Model
aliases:
  - employees table
  - Employee
tags:
  - type/reference
  - section/data-models
  - status/active
created: 2026-03-14
updated: 2026-03-14
table: employees
typescript: src/types/database.ts
---

← [[Data Models MOC]]

# Employee Model

The `employees` table and its associated sub-tables store all staff records for The Anchor. Employee data is spread across multiple tables by sensitivity level — core identity information is in `employees`, while financial, health, and right-to-work data each have their own restricted tables.

## Primary Table: `employees`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | Primary key |
| `first_name` | text | Employee first name |
| `last_name` | text | Employee last name |
| `email` | text | Work or personal email |
| `phone` | text | Contact phone number |
| `date_of_birth` | date | Used for payroll and compliance |
| `start_date` | date | Employment start date |
| `end_date` | date | Employment end date (nullable — null if active) |
| `status` | text | `onboarding` \| `active` \| `separation` \| `former` |
| `job_title` | text | Role title |
| `created_at` | timestamptz | Auto-set on insert |
| `updated_at` | timestamptz | Auto-updated on change |

## Sensitive Sub-Tables

Access to these tables is controlled by stricter RBAC permissions than the main `employees` table.

### `employee_financial_details`

| Column | Notes |
|---|---|
| `bank_account_number` | UK bank account number |
| `sort_code` | UK sort code |
| `ni_number` | National Insurance number |
| `payee_name` | Name as it appears on payroll |

### `employee_health_record`

| Column | Notes |
|---|---|
| `medical_conditions` | Declared conditions relevant to the role |
| `disabilities` | Declared disabilities |
| `allergies` | Food or environmental allergies |
| `medications` | Medications that may affect work |

### `employee_right_to_work`

| Column | Notes |
|---|---|
| `document_type` | Passport, visa, share code, etc. |
| `document_number` | Document reference number |
| `expiry_date` | Date the document expires |
| `verified_by` | User ID of the manager who verified it |
| `verified_at` | Timestamp of verification |

### `employee_emergency_contact`

Stores next-of-kin details for each employee.

### `employee_attachment`

File references for uploaded documents — signed contracts, certificates, etc.

### `employee_note`

Internal notes added by managers throughout the employee lifecycle.

## Status Lifecycle

```
onboarding → active → separation → former
```

See [[Employee Lifecycle]] for the full process at each stage, including right-to-work verification, onboarding steps, and separation/offboarding.

> [!WARNING] Data Retention
> Former employee records are **never deleted**. They are marked `former` and become read-only. This is required for legal and tax compliance.

> [!NOTE] Right-to-Work Expiry
> The `expiry_date` on `employee_right_to_work` is actively tracked. The system flags employees whose documents are approaching expiry. An expired right-to-work is a legal compliance issue.

## Used By

- [[Employees]] — full HR management UI (profile, onboarding, sensitive data)
- [[Rota]] — scheduling and payroll use employee records

## Related

- [[Data Models MOC]]
- [[Employees]]
- [[Employee Lifecycle]]
- [[Rota]]
