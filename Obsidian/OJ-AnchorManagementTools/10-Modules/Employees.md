---
title: Employees
aliases:
  - Employee Management
  - Staff Records
tags:
  - type/reference
  - module/employees
  - status/active
module: employees
route: /employees
created: 2026-03-14
updated: 2026-03-14
---

← [[Modules MOC]]

# Employees

Full employee lifecycle management for The Anchor. Covers onboarding through separation, personal details, financial records, health information, right-to-work compliance, and document storage.

---

## Routes

| Route | Purpose |
|---|---|
| `/employees` | Employee list with search and filters |
| `/employees/[id]` | Employee profile overview |
| `/employees/[id]/financial` | Bank details, NI number, payee name |
| `/employees/[id]/health` | Medical history, disabilities, allergies |
| `/employees/[id]/right-to-work` | Visa/passport verification and expiry |
| `/employees/[id]/attachments` | Certificates, training docs, signed agreements |

---

## Permissions

| Permission | Description |
|---|---|
| `employees.view` | View employee profiles and list |
| `employees.create` | Add new employees |
| `employees.edit` | Update employee records |
| `employees.delete` | Remove employee records |
| `employees.export` | Export employee data |

> [!WARNING]
> Financial details (bank account, NI number, payee name) are stored in a **separate restricted table** (`employee_financial_details`). Access requires `employees.edit` at minimum and should be further restricted by role. Never expose these fields in general list views.

---

## Employee Status Lifecycle

```
Onboarding → Active → Separation → Former
```

| Status | Description |
|---|---|
| **Onboarding** | Employee added, completing setup steps |
| **Active** | Fully onboarded, currently employed |
| **Separation** | Notice period or leaving in progress |
| **Former** | No longer employed; record retained |

> [!NOTE]
> Status transitions should follow the lifecycle in order. Records are never hard-deleted — former employees are retained for compliance and audit purposes.

---

## Key Features

### Personal Details
- Full name, date of birth, address
- Contact details (phone, personal email)
- Birthday tracking for team notifications

### Financial Details
- Bank account number and sort code
- National Insurance (NI) number
- Payee name for payroll

### Health Records
- Medical history relevant to work
- Disabilities and adjustments required
- Allergies (including food allergies relevant to the kitchen)

### Emergency Contact
- Next-of-kin name and relationship
- Emergency phone number

### Right to Work
- Document type (visa, passport, BRP, etc.)
- Verification date
- Expiry date with **automated alerts** before lapse

> [!DANGER]
> Right-to-work documents must be re-verified before expiry. The system surfaces alerts, but a manager must act on them. Allowing a right-to-work document to lapse is a legal liability.

### Attachments
- Certificates (food hygiene, first aid, etc.)
- Training completion documents
- Signed employment agreements
- DBS check records

### Internal Notes
- Free-text notes per employee
- Author and timestamp recorded on each note
- Not visible to the employee

### Export
- Export employee data for payroll, HR, or compliance purposes
- Controlled by `employees.export` permission

---

## Database Tables

| Table | Purpose |
|---|---|
| `employees` | Core profile: name, DOB, contact, status |
| `employee_financial_details` | Bank account, NI number, payee name (restricted) |
| `employee_health_record` | Medical history, disabilities, allergies |
| `employee_emergency_contact` | Next-of-kin details |
| `employee_right_to_work` | Document type, verification, expiry |
| `employee_attachment` | File references for uploaded documents |
| `employee_note` | Internal notes with author and timestamp |

---

## Code References

| File | Purpose |
|---|---|
| `src/types/database.ts` | TypeScript type definitions for all employee tables |
| `src/services/employees.ts` | Full lifecycle management service |

---

## Related

- [[Modules MOC]]
- [[Employee Model]]
- [[Employee Lifecycle]]
- [[Rota]]
- [[Payroll]]
