# Database Schema — OJ AnchorManagementTools

> Source: `supabase/migrations/` (squashed baseline 2025-11-23 + post-squash migrations)
> Project ID: `tfcasgxopxegwrabvwat`

---

## Enum Types

| Type | Values |
|------|--------|
| `table_booking_type` | `regular`, `sunday_lunch` |
| `table_booking_status` | `pending_payment`, `confirmed`, `cancelled`, `no_show`, `completed` |
| `payment_status` | `pending`, `completed`, `failed`, `refunded`, `partial_refund` |
| `booking_item_type` | `main`, `side`, `extra` |
| `parking_booking_status` | `pending_payment`, `confirmed`, `completed`, `cancelled`, `expired` |
| `parking_payment_status` | `pending`, `paid`, `refunded`, `failed`, `expired` |
| `parking_notification_channel` | `sms`, `email` |
| `parking_notification_event` | `payment_request`, `payment_reminder`, `payment_confirmation`, `session_start`, `session_end`, `payment_overdue`, `refund_confirmation` |
| `receipt_transaction_status` | `pending`, `completed`, `auto_completed`, `no_receipt_required` |
| `menu_unit` | `each`, `portion`, `gram`, `kilogram`, `millilitre`, `litre`, `ounce`, `pound`, `teaspoon`, `tablespoon`, `cup`, `slice`, `piece` |
| `menu_storage_type` | `ambient`, `chilled`, `frozen`, `dry`, `other` |

---

## Auth & RBAC

### profiles
| col | type | nullable | default |
|-----|------|----------|---------|
| id | uuid | N | — (FK → auth.users) |
| full_name | text | Y | |
| email | text | Y | |
| avatar_url | text | Y | |
| sms_notifications | boolean | Y | true |
| email_notifications | boolean | Y | true |
| created_at | timestamptz | Y | now() |
| updated_at | timestamptz | N | now() |

Audit: `created_at`, `updated_at`

### roles
| col | type | nullable | default |
|-----|------|----------|---------|
| id | uuid | N | gen_random_uuid() |
| name | text | N | |
| description | text | Y | |
| is_system | boolean | Y | false |
| created_at | timestamptz | Y | now() |
| updated_at | timestamptz | Y | now() |

### user_roles
| col | type | nullable | default |
|-----|------|----------|---------|
| user_id | uuid | N | |
| role_id | uuid | N | |
| assigned_at | timestamptz | Y | now() |
| assigned_by | uuid | Y | |

FK: `user_id → profiles.id`, `role_id → roles.id`

### permissions
| col | type | nullable | default |
|-----|------|----------|---------|
| id | uuid | N | gen_random_uuid() |
| module_name | text | N | |
| action | text | N | |
| description | text | Y | |
| created_at | timestamptz | Y | now() |

### role_permissions
Junction: `role_id → roles.id`, `permission_id → permissions.id`

---

## Customers

### customers
| col | type | nullable | default |
|-----|------|----------|---------|
| id | uuid | N | gen_random_uuid() |
| first_name | text | N | |
| last_name | text | N | |
| mobile_number | text | N | (E.164 enforced via CHECK) |
| email | text | Y | |
| sms_opt_in | boolean | Y | true |
| messaging_status | text | Y | `'active'` (active/suspended/invalid_number/opted_out) |
| sms_delivery_failures | integer | Y | 0 |
| consecutive_failures | integer | Y | 0 |
| total_failures_30d | integer | Y | 0 |
| last_sms_failure_reason | text | Y | |
| last_successful_sms_at | timestamptz | Y | |
| sms_deactivated_at | timestamptz | Y | |
| sms_deactivation_reason | text | Y | |
| created_at | timestamptz | N | now() |

Audit: `created_at`. RLS: enabled.

### customer_category_stats
| col | type | nullable | default |
|-----|------|----------|---------|
| customer_id | uuid | N | |
| category_id | uuid | N | |
| times_attended | integer | Y | 0 |
| last_attended_date | date | Y | |
| first_attended_date | date | Y | |
| created_at | timestamptz | Y | now() |
| updated_at | timestamptz | Y | now() |

FK: `customer_id → customers.id`, `category_id → event_categories.id`

### customer_labels / customer_label_assignments / customer_scores
Supporting tables for customer tagging and scoring.

---

## Events

### events
| col | type | nullable | default |
|-----|------|----------|---------|
| id | uuid | N | gen_random_uuid() |
| name | text | N | |
| date | date | N | |
| time | text | N | |
| end_time | time | Y | |
| doors_time | time | Y | |
| duration_minutes | integer | Y | |
| last_entry_time | time | Y | |
| capacity | integer | Y | (NULL = unlimited) |
| category_id | uuid | Y | |
| event_status | varchar(50) | Y | `'scheduled'` |
| slug | varchar(255) | N | (unique, SEO) |
| description | text | Y | |
| short_description | text | Y | |
| long_description | text | Y | |
| highlights | jsonb | Y | `[]` |
| price | numeric(10,2) | Y | 0 |
| price_currency | varchar(3) | Y | `'GBP'` |
| is_free | boolean | Y | true |
| performer_name | varchar(255) | Y | |
| performer_type | varchar(50) | Y | |
| booking_url | text | Y | |
| hero_image_url | text | Y | |
| poster_image_url | text | Y | |
| thumbnail_image_url | text | Y | |
| gallery_image_urls | jsonb | Y | `[]` |
| promo_video_url | text | Y | |
| highlight_video_urls | jsonb | Y | `[]` |
| is_recurring | boolean | Y | false |
| recurrence_rule | text | Y | |
| parent_event_id | uuid | Y | |
| meta_title | varchar(255) | Y | |
| meta_description | text | Y | |
| keywords | jsonb | Y | `[]` |
| created_at | timestamptz | N | now() |

Audit: `created_at`. FK: `category_id → event_categories.id`. RLS: enabled.

### event_categories
| col | type | nullable | default |
|-----|------|----------|---------|
| id | uuid | N | gen_random_uuid() |
| name | text | N | |
| description | text | Y | |
| display_order | integer | Y | 0 |
| created_at | timestamptz | Y | now() |

### bookings (event bookings)
| col | type | nullable | default |
|-----|------|----------|---------|
| id | uuid | N | gen_random_uuid() |
| customer_id | uuid | N | |
| event_id | uuid | N | |
| seats | integer | Y | |
| notes | text | Y | |
| created_at | timestamptz | N | now() |

FK: `customer_id → customers.id`, `event_id → events.id`. RLS: enabled.

### pending_bookings
| col | type | nullable | default |
|-----|------|----------|---------|
| id | uuid | N | gen_random_uuid() |
| token | uuid | N | (unique) |
| event_id | uuid | N | |
| mobile_number | varchar(20) | N | |
| customer_id | uuid | Y | |
| seats | integer | Y | |
| expires_at | timestamptz | N | |
| confirmed_at | timestamptz | Y | |
| booking_id | uuid | Y | |
| initiated_by_api_key | uuid | Y | |
| created_at | timestamptz | Y | now() |
| updated_at | timestamptz | Y | now() |

### event_check_ins / event_checklist_statuses / event_faqs / event_images / event_message_templates
Supporting event management tables.

---

## Table Bookings

### table_bookings
| col | type | nullable | default |
|-----|------|----------|---------|
| id | uuid | N | gen_random_uuid() |
| booking_reference | varchar(20) | N | (unique) |
| customer_id | uuid | Y | |
| booking_date | date | N | |
| booking_time | time | N | |
| party_size | integer | N | |
| booking_type | table_booking_type | N | |
| status | table_booking_status | N | `'pending_payment'` |
| duration_minutes | integer | Y | 120 |
| tables_assigned | jsonb | Y | |
| dietary_requirements | text[] | Y | |
| allergies | text[] | Y | |
| celebration_type | varchar(50) | Y | |
| special_requirements | text | Y | |
| internal_notes | text | Y | |
| source | varchar(20) | Y | |
| confirmed_at | timestamptz | Y | |
| cancelled_at | timestamptz | Y | |
| cancellation_reason | text | Y | |
| completed_at | timestamptz | Y | |
| no_show_at | timestamptz | Y | |
| created_at | timestamptz | Y | now() |
| updated_at | timestamptz | Y | now() |

Audit: `created_at`, `updated_at`. FK: `customer_id → customers.id`. RLS: enabled.

### table_booking_items
Sunday lunch food item selections per booking. FK: `booking_id → table_bookings.id`.

### table_booking_payments
Payment records per booking. FK: `booking_id → table_bookings.id`.

### table_booking_sms_templates
| col | type | nullable | default |
|-----|------|----------|---------|
| id | uuid | N | gen_random_uuid() |
| template_key | varchar(100) | N | (unique) |
| booking_type | table_booking_type | Y | |
| template_text | text | N | |
| is_active | boolean | Y | true |
| created_at | timestamptz | Y | now() |
| updated_at | timestamptz | Y | now() |

### tables / table_areas / table_configuration / table_combinations / table_combination_tables
Physical table layout management.

### table_join_groups / table_join_group_members
Group dining session management.

---

## Private Bookings

### private_bookings
| col | type | nullable | default |
|-----|------|----------|---------|
| id | uuid | N | gen_random_uuid() |
| customer_id | uuid | Y | |
| customer_first_name | text | Y | |
| customer_last_name | text | Y | |
| customer_full_name | text | Y | (generated column) |
| contact_phone | text | Y | |
| contact_email | text | Y | |
| event_date | date | N | |
| start_time | time | N | |
| setup_time | time | Y | |
| setup_date | date | Y | |
| end_time | time | Y | |
| guest_count | integer | Y | |
| event_type | text | Y | |
| status | text | Y | `'draft'` |
| deposit_amount | numeric(10,2) | Y | 250.00 |
| deposit_paid_date | timestamptz | Y | |
| deposit_payment_method | text | Y | |
| total_amount | numeric(10,2) | Y | 0 |
| balance_due_date | date | Y | (auto: event_date − 7 days) |
| final_payment_date | timestamptz | Y | |
| final_payment_method | text | Y | |
| discount_type | text | Y | |
| discount_amount | numeric(10,2) | Y | 0 |
| discount_reason | text | Y | |
| contract_version | integer | Y | 0 |
| calendar_event_id | text | Y | |
| internal_notes | text | Y | |
| customer_requests | text | Y | |
| created_by | uuid | Y | |
| created_at | timestamptz | N | now() |
| updated_at | timestamptz | N | now() |

Audit: `created_at`, `updated_at`. RLS: enabled.

### private_booking_items
Line items (food/drink/hire). FK: `booking_id → private_bookings.id`.

### private_booking_payments
| col | type | nullable | default |
|-----|------|----------|---------|
| id | uuid | N | gen_random_uuid() |
| booking_id | uuid | N | |
| amount | numeric(10,2) | N | |
| method | text | N | |
| notes | text | Y | |
| recorded_by | uuid | Y | |
| created_at | timestamptz | N | now() |

### private_booking_documents / private_booking_audit / private_booking_sms_queue
Contracts, audit trail, and SMS queue.

---

## Parking

### parking_bookings
| col | type | nullable | default |
|-----|------|----------|---------|
| id | uuid | N | gen_random_uuid() |
| reference | text | N | |
| customer_id | uuid | Y | |
| customer_first_name | text | N | |
| customer_last_name | text | Y | |
| customer_mobile | text | N | |
| customer_email | text | Y | |
| vehicle_registration | text | N | |
| vehicle_make | text | Y | |
| vehicle_model | text | Y | |
| vehicle_colour | text | Y | |
| start_at | timestamptz | N | |
| end_at | timestamptz | N | |
| duration_minutes | integer | N | |
| calculated_price | numeric(12,2) | N | |
| pricing_breakdown | jsonb | N | |
| override_price | numeric(12,2) | Y | |
| override_reason | text | Y | |
| capacity_override | boolean | Y | false |
| capacity_override_reason | text | Y | |
| status | parking_booking_status | N | `'pending_payment'` |
| payment_status | parking_payment_status | N | `'pending'` |
| payment_due_at | timestamptz | Y | |
| confirmed_at | timestamptz | Y | |
| cancelled_at | timestamptz | Y | |
| completed_at | timestamptz | Y | |
| expires_at | timestamptz | Y | |
| notes | text | Y | |
| created_by | uuid | Y | |
| updated_by | uuid | Y | |
| created_at | timestamptz | N | now() |
| updated_at | timestamptz | N | now() |

Audit: `created_at`, `updated_at`. FK: `customer_id → customers.id`. RLS: enabled.

### parking_booking_notifications / parking_booking_payments / parking_booking_sms_queue
Supporting tables.

---

## Invoices (Supplier)

### invoice_vendors
| col | type | nullable | default |
|-----|------|----------|---------|
| id | uuid | N | gen_random_uuid() |
| name | varchar(200) | N | |
| contact_name | varchar(200) | Y | |
| email | varchar(255) | Y | |
| phone | varchar(50) | Y | |
| address | text | Y | |
| vat_number | varchar(50) | Y | |
| payment_terms | integer | Y | 30 |
| notes | text | Y | |
| created_at | timestamptz | Y | now() |
| updated_at | timestamptz | Y | now() |

### invoices
| col | type | nullable | default |
|-----|------|----------|---------|
| id | uuid | N | gen_random_uuid() |
| invoice_number | varchar(50) | N | |
| vendor_id | uuid | Y | |
| invoice_date | date | N | CURRENT_DATE |
| due_date | date | N | |
| status | varchar(20) | Y | `'draft'` |
| reference | varchar(200) | Y | |
| subtotal_amount | numeric(10,2) | Y | 0 |
| invoice_discount_percentage | numeric(5,2) | Y | 0 |
| discount_amount | numeric(10,2) | Y | 0 |
| vat_amount | numeric(10,2) | Y | 0 |
| total_amount | numeric(10,2) | Y | 0 |
| paid_amount | numeric(10,2) | Y | 0 |
| notes | text | Y | |
| internal_notes | text | Y | |
| deleted_at | timestamptz | Y | |
| deleted_by | uuid | Y | |
| created_at | timestamptz | Y | now() |
| updated_at | timestamptz | Y | now() |

FK: `vendor_id → invoice_vendors.id`. RLS: enabled.

### invoice_line_items / invoice_payments / invoice_emails / invoice_email_templates / invoice_series / invoice_vendor_contacts / invoice_reminder_settings / invoice_audit
Supporting invoice management tables.

### vendors (event vendors)
| col | type | nullable | default |
|-----|------|----------|---------|
| id | uuid | N | gen_random_uuid() |
| name | text | N | |
| company_name | text | Y | |
| service_type | text | N | (dj/band/photographer/florist/decorator/cake/transport/other) |
| contact_phone | text | Y | |
| contact_email | text | Y | |
| website | text | Y | |
| typical_rate | text | Y | |
| preferred | boolean | Y | false |
| active | boolean | Y | true |
| notes | text | Y | |
| created_at | timestamptz | N | now() |
| updated_at | timestamptz | N | now() |

---

## Receipts & Finance

### receipt_transactions
Bank transaction records (imported). Key columns: `id`, `transaction_date`, `description`, `amount`, `direction` (in/out), `transaction_type`, `status` (receipt_transaction_status), `vendor_id`, `created_at`.

### receipt_batches
| col | type | nullable | default |
|-----|------|----------|---------|
| id | uuid | N | gen_random_uuid() |
| uploaded_at | timestamptz | N | now() |
| uploaded_by | uuid | Y | |
| original_filename | text | N | |
| source_hash | text | Y | |
| row_count | integer | N | 0 |
| notes | text | Y | |
| created_at | timestamptz | N | now() |

### receipt_rules / pl_targets / pl_manual_actuals
Rules-based auto-classification and P&L targets.

### expenses / expense_files
Employee expense claims with receipt file attachments.

### mileage_trips / mileage_trip_legs / mileage_destinations / mileage_destination_distances
HMRC mileage tracking with multi-leg trip support.

### mgd_returns / mgd_collections
Machine Games Duty quarterly returns.

### credit_notes
Credit note records against invoices.

---

## Cashing Up

### cashup_sessions
| col | type | nullable | default |
|-----|------|----------|---------|
| id | uuid | N | gen_random_uuid() |
| site_id | uuid | N | |
| session_date | date | N | |
| shift_code | text | Y | |
| status | text | N | |
| prepared_by_user_id | uuid | N | |
| approved_by_user_id | uuid | Y | |
| total_expected_amount | numeric(12,2) | N | 0 |
| total_counted_amount | numeric(12,2) | N | 0 |
| total_variance_amount | numeric(12,2) | N | 0 |
| notes | text | Y | |
| workbook_payload | jsonb | N | `{}` |
| created_by_user_id | uuid | N | |
| updated_by_user_id | uuid | N | |
| created_at | timestamptz | N | now() |
| updated_at | timestamptz | N | now() |

FK: `site_id → sites.id`. RLS: enabled.

### cashup_cash_counts
| col | type | nullable | default |
|-----|------|----------|---------|
| id | uuid | N | gen_random_uuid() |
| cashup_session_id | uuid | N | |
| denomination | numeric(6,2) | N | |
| quantity | integer | N | 0 |
| total_amount | numeric(12,2) | N | 0 |

FK: `cashup_session_id → cashup_sessions.id`

### cashup_payment_breakdowns
| col | type | nullable | default |
|-----|------|----------|---------|
| id | uuid | N | gen_random_uuid() |
| cashup_session_id | uuid | N | |
| payment_type_code | text | N | |
| payment_type_label | text | N | |
| expected_amount | numeric(12,2) | N | 0 |
| counted_amount | numeric(12,2) | N | 0 |
| variance_amount | numeric(12,2) | N | 0 |

FK: `cashup_session_id → cashup_sessions.id`

### cashup_config
| col | type | nullable | default |
|-----|------|----------|---------|
| key | text | N | (PK) |
| value | jsonb | N | |

### cashup_targets
Revenue targets per period for cashup comparison.

---

## Employees & Rota

### employees
| col | type | nullable | default |
|-----|------|----------|---------|
| employee_id | uuid | N | gen_random_uuid() |
| first_name | text | N | |
| last_name | text | N | |
| date_of_birth | date | Y | |
| address | text | Y | |
| phone_number | text | Y | (E.164 enforced) |
| email_address | text | N | |
| job_title | text | N | |
| employment_start_date | date | N | |
| employment_end_date | date | Y | |
| status | text | N | `'Active'` (Active/Former/On Leave) |
| created_at | timestamptz | N | now() |
| updated_at | timestamptz | N | now() |

Audit: `created_at`, `updated_at`. RLS: enabled.

### employee_attachments / employee_emergency_contacts / employee_financial_details / employee_health_records / employee_notes / employee_pay_settings / employee_rate_overrides
HR sub-tables. All FK → `employees.employee_id`.

### rota_weeks
| col | type | nullable | default |
|-----|------|----------|---------|
| id | uuid | N | gen_random_uuid() |
| week_start | date | N | |
| status | text | N | `'draft'` |
| published_at | timestamptz | Y | |
| published_by | uuid | Y | |
| has_unpublished_changes | boolean | N | false |
| created_at | timestamptz | N | now() |
| updated_at | timestamptz | N | now() |

### rota_shifts
| col | type | nullable | default |
|-----|------|----------|---------|
| id | uuid | N | gen_random_uuid() |
| week_id | uuid | N | |
| employee_id | uuid | N | |
| template_id | uuid | Y | |
| shift_date | date | N | |
| start_time | time | N | |
| end_time | time | N | |
| unpaid_break_minutes | smallint | N | 0 |
| department | text | N | |
| status | text | N | `'scheduled'` |
| is_overnight | boolean | N | false |
| original_employee_id | uuid | Y | |
| reassigned_from_id | uuid | Y | |
| reassigned_at | timestamptz | Y | |
| reassigned_by | uuid | Y | |
| reassignment_reason | text | Y | |
| created_by | uuid | Y | |
| created_at | timestamptz | N | now() |
| updated_at | timestamptz | N | now() |

FK: `week_id → rota_weeks.id`, `employee_id → employees.employee_id`. RLS: enabled.

### rota_shift_templates / rota_published_shifts
Template definitions and published shift snapshots.

### leave_requests
| col | type | nullable | default |
|-----|------|----------|---------|
| id | uuid | N | gen_random_uuid() |
| employee_id | uuid | N | |
| start_date | date | N | |
| end_date | date | N | |
| status | text | N | `'pending'` |
| note | text | Y | |
| manager_note | text | Y | |
| holiday_year | smallint | N | |
| reviewed_by | uuid | Y | |
| reviewed_at | timestamptz | Y | |
| created_by | uuid | Y | |
| created_at | timestamptz | N | now() |
| updated_at | timestamptz | N | now() |

FK: `employee_id → employees.employee_id`

### leave_days / departments / department_budgets
Supporting HR tables.

### timeclock_sessions
Clock-in/out records. FK: `employee_id → employees.employee_id`.

---

## Messaging

### messages
| col | type | nullable | default |
|-----|------|----------|---------|
| id | uuid | N | gen_random_uuid() |
| customer_id | uuid | N | |
| direction | text | N | (inbound/outbound) |
| message_sid | text | N | |
| body | text | N | |
| status | text | N | |
| twilio_message_sid | text | Y | |
| twilio_status | text | Y | |
| from_number | text | Y | |
| to_number | text | Y | |
| message_type | text | Y | `'sms'` (sms/mms/whatsapp) |
| price | numeric(10,4) | Y | |
| price_unit | text | Y | |
| cost_usd | numeric(10,4) | Y | |
| segments | integer | Y | 1 |
| error_code | text | Y | |
| error_message | text | Y | |
| sent_at | timestamptz | Y | |
| delivered_at | timestamptz | Y | |
| failed_at | timestamptz | Y | |
| read_at | timestamptz | Y | |
| created_at | timestamptz | N | now() |
| updated_at | timestamptz | N | now() |

FK: `customer_id → customers.id`. RLS: enabled.

### message_templates
| col | type | nullable | default |
|-----|------|----------|---------|
| id | uuid | N | gen_random_uuid() |
| name | text | N | |
| description | text | Y | |
| template_type | text | N | |
| content | text | N | |
| variables | text[] | Y | `{}` |
| is_default | boolean | Y | false |
| is_active | boolean | Y | true |
| send_timing | text | N | `'immediate'` (immediate/1_hour/12_hours/24_hours/7_days/custom) |
| custom_timing_hours | integer | Y | |
| character_count | integer | Y | (generated) |
| estimated_segments | integer | Y | (generated) |
| created_by | uuid | Y | |
| created_at | timestamptz | N | now() |
| updated_at | timestamptz | N | now() |

### message_delivery_status / message_template_history / reminder_processing_logs / booking_reminders
SMS delivery tracking and reminder management.

---

## Menu Management

### menu_menus
| col | type | nullable | default |
|-----|------|----------|---------|
| id | uuid | N | gen_random_uuid() |
| code | text | N | |
| name | text | N | |
| description | text | Y | |
| is_active | boolean | N | true |
| created_at | timestamptz | Y | now() |
| updated_at | timestamptz | Y | now() |

### menu_categories / menu_category_menus
Category taxonomy and menu-category junction.

### menu_dishes
| col | type | nullable | default |
|-----|------|----------|---------|
| id | uuid | N | gen_random_uuid() |
| name | text | N | |
| description | text | Y | |
| dietary_flags | jsonb | Y | `{}` |
| allergen_flags | jsonb | Y | `{}` |
| is_active | boolean | N | true |
| sort_order | integer | Y | 0 |
| created_at | timestamptz | Y | now() |
| updated_at | timestamptz | Y | now() |

### menu_dish_menu_assignments
Junction: dish ↔ menu with section, price, and availability overrides.

### menu_ingredients
| col | type | nullable | default |
|-----|------|----------|---------|
| id | uuid | N | gen_random_uuid() |
| name | text | N | |
| description | text | Y | |
| unit | menu_unit | N | |
| storage_type | menu_storage_type | Y | |
| created_at | timestamptz | N | now() |
| updated_at | timestamptz | N | now() |

### menu_ingredient_prices
| col | type | nullable | default |
|-----|------|----------|---------|
| id | uuid | N | gen_random_uuid() |
| ingredient_id | uuid | N | |
| pack_cost | numeric(12,4) | N | |
| effective_from | timestamptz | N | now() |
| supplier_name | text | Y | |
| supplier_sku | text | Y | |
| notes | text | Y | |
| created_at | timestamptz | N | now() |

FK: `ingredient_id → menu_ingredients.id`

### menu_recipes / menu_dish_recipes / menu_recipe_ingredients / menu_dish_ingredients
Recipe costing and ingredient linking.

### sunday_lunch_menu_items
Legacy Sunday lunch menu items (pre-menu-management module).

---

## OJ Projects

### oj_projects
| col | type | nullable | default |
|-----|------|----------|---------|
| id | uuid | N | gen_random_uuid() |
| name | text | N | |
| client_name | text | Y | |
| status | text | Y | |
| start_date | date | Y | |
| end_date | date | Y | |
| created_at | timestamptz | N | now() |

### oj_entries
| col | type | nullable | default |
|-----|------|----------|---------|
| id | uuid | N | gen_random_uuid() |
| project_id | uuid | N | |
| work_type_id | uuid | Y | |
| employee_id | uuid | Y | |
| entry_date | date | N | |
| hours | numeric | Y | |
| amount | numeric(10,2) | Y | |
| notes | text | Y | |
| created_at | timestamptz | N | now() |

FK: `project_id → oj_projects.id`

### oj_work_types
| col | type | nullable | default |
|-----|------|----------|---------|
| id | uuid | N | gen_random_uuid() |
| name | text | N | |
| code | text | Y | |
| hourly_rate | numeric(10,2) | Y | |
| is_active | boolean | Y | true |
| created_at | timestamptz | N | now() |
| updated_at | timestamptz | N | now() |

### oj_billing_runs / oj_recurring_charge_instances / oj_vendor_billing_settings / oj_vendor_recurring_charges / oj_project_contacts
OJ billing and recurring charge management.

---

## Hiring (ATS)

### hiring_jobs / hiring_job_templates / hiring_candidates / hiring_applications / hiring_notes / hiring_interviews / hiring_interview_attendees / hiring_candidate_documents / hiring_candidate_events / hiring_candidate_profile_versions / hiring_application_messages / hiring_application_overrides / hiring_screening_runs / hiring_outreach_messages
Full applicant tracking system module.

---

## Venue & Config

### business_hours
Day-of-week operating hours, kitchen hours, and booking slots.

### special_hours
Date-specific overrides: `override_date`, `is_closed`, `custom_capacity`, `custom_hours`, `created_at`, `updated_at`.

### service_slots / service_slot_config / service_slot_overrides / service_statuses / service_status_overrides
Booking slot generation and service status system.

### venue_spaces / catering_packages / business_amenities / sites
Venue configuration tables.

### system_settings
Key-value store: `key varchar(100) PK`, `value jsonb`, `description text`, `created_at`, `updated_at`.

---

## Loyalty Programme

### loyalty_programs / loyalty_tiers / loyalty_members / loyalty_point_transactions / loyalty_rewards / loyalty_achievements / loyalty_challenges / loyalty_campaigns
Full loyalty/points system. `loyalty_members` FK: `customer_id → customers.id`.

### loyalty_notifications / loyalty_bulk_notifications / loyalty_portal_sessions / loyalty_otp_verifications
Loyalty comms and portal access.

### customer_achievements / customer_challenges / achievement_progress
Customer-facing progress tracking.

---

## Audit & System

### audit_logs
| col | type | nullable | default |
|-----|------|----------|---------|
| id | uuid | N | gen_random_uuid() |
| user_id | uuid | Y | |
| user_email | text | Y | |
| operation_type | text | N | |
| resource_type | text | N | (employee/customer/financial_details/…) |
| resource_id | text | Y | |
| operation_status | text | N | (success/failure) |
| ip_address | inet | Y | |
| user_agent | text | Y | |
| old_values | jsonb | Y | |
| new_values | jsonb | Y | |
| error_message | text | Y | |
| additional_info | jsonb | Y | |
| created_at | timestamptz | N | now() |

RLS: enabled.

### background_jobs / job_queue
Async job tracking: `id`, `job_type`, `status`, `payload`, `result`, `created_at`, `completed_at`.

### cron_job_runs
Cron execution log: `id`, `job_name`, `started_at`, `finished_at`, `status`, `result`.

### api_keys / api_usage
API key management and usage tracking.

### idempotency_keys
| col | type | nullable | default |
|-----|------|----------|---------|
| key | varchar(255) | N | (PK) |
| request_hash | varchar(64) | N | |
| response | jsonb | N | |
| created_at | timestamptz | N | now() |
| expires_at | timestamptz | N | now() + 24h |

### rate_limits
Rate limiting state: `key`, `count`, `window_start`, `expires_at`.

### short_links / short_link_clicks
URL shortener with click tracking.

### webhooks / webhook_deliveries / webhook_logs
Outbound webhook management.

### booking_audit / booking_holds / booking_policies / booking_time_slots
Event booking subsystem tables.

### card_captures / charge_requests
Payment capture flow tables.

### calendar_notes / feedback / guest_tokens / analytics_events
General utility tables.

### phone_standardization_issues
Tracks phone numbers failing E.164 normalisation.

### employee_version_history / employee_invite_tokens
Employee record versioning and onboarding invites.

---

## Key Foreign Key Relationships

| Child Table | FK Column | References |
|-------------|-----------|------------|
| bookings | customer_id | customers.id |
| bookings | event_id | events.id |
| table_bookings | customer_id | customers.id |
| parking_bookings | customer_id | customers.id |
| private_bookings | customer_id | customers.id |
| messages | customer_id | customers.id |
| customer_category_stats | customer_id | customers.id |
| customer_category_stats | category_id | event_categories.id |
| events | category_id | event_categories.id |
| invoices | vendor_id | invoice_vendors.id |
| rota_shifts | week_id | rota_weeks.id |
| rota_shifts | employee_id | employees.employee_id |
| leave_requests | employee_id | employees.employee_id |
| menu_ingredient_prices | ingredient_id | menu_ingredients.id |
| oj_entries | project_id | oj_projects.id |
| user_roles | user_id | profiles.id |
| user_roles | role_id | roles.id |
| cashup_sessions | site_id | sites.id |
| cashup_cash_counts | cashup_session_id | cashup_sessions.id |
| cashup_payment_breakdowns | cashup_session_id | cashup_sessions.id |

---

## RLS Summary

RLS is enabled on all tables. Key policy groupings:

- **Public read**: `events`, `event_categories`, `menu_*`, `business_hours`, `special_hours`, `service_slots`, `venue_spaces`, `catering_packages`
- **Authenticated staff**: `customers`, `bookings`, `table_bookings`, `employees`, `rota_*`, `invoices`, `messages`, `audit_logs`, `parking_*`
- **Service role only**: system operations, cron jobs, webhook processing
- Staff-scoped tables use `auth.uid()` permission checks via `user_roles` + `role_permissions`
