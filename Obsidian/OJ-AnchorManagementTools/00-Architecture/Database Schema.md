---
title: "Database Schema"
aliases:
  - "Schema"
  - "Database"
  - "Tables"
tags:
  - type/reference
  - status/active
module: architecture
created: 2026-03-14
updated: 2026-03-14
---

# Database Schema

← [[Architecture MOC]]

> [!INFO] Platform
> PostgreSQL via Supabase. RLS is **always on** for all tables. Migrations live in `supabase/migrations/`. Full schema reference: `supabase/schema.sql`.

---

## Core Business Tables

### Events & Bookings
| Table | Purpose |
|---|---|
| `events` | Public events with SEO fields, pricing, performer info, booking URLs, media, FAQs |
| `table_bookings` | Table reservations linked to events; tracks guests, seating, payment method |
| `private_bookings` | Full-service event packages (status, deposits, payment, dates, notes) |
| `private_booking_items` | Line items per booking: spaces, catering packages, vendors |
| `private_booking_documents` | Generated PDFs (contracts, invoices) stored in Supabase storage |
| `private_booking_sms_queue` | SMS messages queued for customer send; includes approval status |
| `catering_packages` | Menu items (food, drink, add-ons) with pricing models and minimums |
| `venue_spaces` | Banquet halls/rooms with capacity and hourly rates |
| `vendors` | External suppliers (DJ, photographer, decorator, etc.) |

### Customer & Communications
| Table | Purpose |
|---|---|
| `customers` | Customer records: contact, SMS opt-in, delivery failures, labels |
| `messages` | SMS messages — inbound and outbound — with Twilio SID, delivery status |
| `message_delivery_status` | Webhook tracking for delivery status per message |
| `bookings` | Simple event ticket bookings (legacy / table bookings) |
| `booking_reminders` | Reminder history per booking |

### Employees & HR
| Table | Purpose |
|---|---|
| `employees` | Core record: name, status, contact, employment dates |
| `employee_financial_details` | Bank account, NI number, payee name |
| `employee_health_record` | Medical history, disabilities, allergies |
| `employee_emergency_contact` | Next-of-kin details |
| `employee_right_to_work` | Visa/passport verification with expiry date |
| `employee_attachment` | Uploaded certificates and documents |
| `employee_note` | Internal notes with author and audit trail |

### Finance & Operations
| Table | Purpose |
|---|---|
| `invoices` | Invoice records with payment method, status, email sent date |
| `invoice_line_items` | Line-by-line breakdown per invoice |
| `receipt_transactions` | Bank transactions with vendor/category classification |
| `receipt_rules` | Auto-classification rules (pattern → vendor/category) |
| `receipt_files` | Uploaded receipt scans and PDFs |
| `receipt_transaction_log` | Audit trail of status and category changes |
| `oj_project_clients` | Clients for internal time-tracking |
| `oj_project_work_types` | Categories of work (design, dev, admin, etc.) |
| `oj_project_entries` | Time entries with duration, date, project, work type |

### Configuration & Auth
| Table | Purpose |
|---|---|
| `roles` | RBAC roles (super_admin, manager, staff + custom) |
| `role_permissions` | Maps role → module + action |
| `user_roles` | Maps user → role |
| `permissions` | Master list of module/action combinations |
| `message_templates` | Reusable SMS templates |
| `event_message_template` | Per-event custom SMS content |
| `audit_logs` | Full operational audit trail |
| `short_links` | URL shortener mappings with click analytics |

---

## RLS Pattern

```sql
-- Every table has RLS enabled
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

-- User-scoped reads use the anon key client (respects RLS)
-- System operations use the service role client (bypasses RLS)
```

> [!WARNING] Never Disable RLS
> If you need to bypass RLS for a system operation, use `src/lib/supabase/admin.ts` (service role). Never disable RLS "temporarily".

---

## Migration Commands

```bash
npx supabase migration new <name>   # Create new migration
npx supabase db push                # Apply pending migrations
npx supabase db push --dry-run      # Preview without applying
```

> [!DANGER] Dropping Columns
> Before any `DROP COLUMN` or `DROP TABLE`, search all functions and triggers for references:
> ```bash
> grep -r "column_name" supabase/migrations/ --include="*.sql" -l
> ```
> Update all references in the **same migration**.

---

## Related
- [[RBAC & Permissions]]
- [[Auth & Security]]
- [[Private Booking Model]]
- [[Employee Model]]
- [[Event Model]]
- [[Invoice Model]]
- [[Customer Model]]
