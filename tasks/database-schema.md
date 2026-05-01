# Database Schema — The Anchor Management Tools

> Source: Live Supabase project `tfcasgxopxegwrabvwat` (eu-west-2). Generated 2026-04-24.
> RLS is enabled on all public tables unless noted. Views have no RLS.

---

## Enum Types

| Enum | Values |
|------|--------|
| `booking_item_type` | main, side, extra |
| `menu_storage_type` | ambient, chilled, frozen, dry, other |
| `menu_unit` | each, portion, gram, kilogram, millilitre, litre, ounce, pound, teaspoon, tablespoon, cup, slice, piece, pint, measure, glass |
| `parking_booking_status` | pending_payment, confirmed, completed, cancelled, expired |
| `parking_notification_channel` | sms, email |
| `parking_notification_event` | payment_request, payment_reminder, payment_confirmation, session_start, session_end, payment_overdue, refund_confirmation |
| `parking_payment_status` | pending, paid, refunded, failed, expired |
| `payment_status` | pending, completed, failed, refunded, partial_refund |
| `performer_submission_status` | new, shortlisted, contacted, booked, not_a_fit, do_not_contact |
| `receipt_transaction_status` | pending, completed, auto_completed, no_receipt_required, cant_find |
| `table_booking_payment_method` | payment_link, cash, paypal |
| `table_booking_status` | pending_payment, confirmed, cancelled, no_show, completed, pending_card_capture, visited_waiting_for_review, review_clicked |
| `table_booking_type` | regular, sunday_lunch |
| `oauth_authorization_status` | pending, approved, denied, expired |
| `oauth_client_type` | public, confidential |
| `oauth_registration_type` | dynamic, manual |
| `oauth_response_type` | code |

---

## Core Domain Tables

### customers
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| first_name | text | NO | |
| last_name | text | NO | |
| email | text | YES | |
| phone | text | YES | |
| marketing_opt_in | boolean | YES | false |
| sms_opt_in | boolean | YES | false |
| notes | text | YES | |
| source | text | YES | |
| messaging_status | text | YES | 'active' |
| consecutive_failures | integer | YES | 0 |
| total_failures_30d | integer | YES | 0 |
| last_successful_delivery | timestamptz | YES | |
| last_failure_type | text | YES | |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |

RLS: 5 policies. Audit: created_at, updated_at.

---

### bookings (event bookings)
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| customer_id | uuid | NO | |
| event_id | uuid | NO | |
| booking_date | date | NO | |
| party_size | integer | NO | |
| status | text | NO | 'pending' |
| payment_status | text | YES | |
| deposit_amount | numeric | YES | |
| deposit_paid | boolean | YES | false |
| special_requirements | text | YES | |
| dietary_requirements | text | YES | |
| source | text | YES | |
| notes | text | YES | |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |

FKs: customer_id → customers(id) CASCADE, event_id → events(id) CASCADE. RLS: 4 policies.

---

### events
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| title | text | NO | |
| slug | text | YES | |
| description | text | YES | |
| short_description | text | YES | |
| long_description | text | YES | |
| start_datetime | timestamptz | NO | |
| end_datetime | timestamptz | YES | |
| capacity | integer | YES | |
| price | numeric | YES | 0 |
| status | text | YES | 'draft' |
| is_private | boolean | YES | false |
| category_id | uuid | YES | |
| poster_image_url | text | YES | |
| gallery_image_urls | jsonb | YES | '[]' |
| meta_title | text | YES | |
| meta_description | text | YES | |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |

FKs: category_id → event_categories(id). RLS: 5 policies.

Related: `event_categories`, `event_images`, `event_faqs`, `event_checklist_statuses`, `event_check_ins`, `event_message_templates`, `event_interest_manual_recipients`.

---

### table_bookings
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| customer_id | uuid | NO | |
| booking_date | date | NO | |
| booking_time | time | NO | |
| party_size | integer | NO | |
| status | table_booking_status | NO | 'confirmed' |
| booking_type | table_booking_type | YES | 'regular' |
| payment_method | table_booking_payment_method | YES | |
| special_requirements | text | YES | |
| dietary_requirements | text | YES | |
| duration_minutes | integer | YES | 90 |
| deposit_amount | numeric | YES | |
| deposit_paid | boolean | YES | false |
| payment_intent_id | text | YES | |
| source | text | YES | |
| notes | text | YES | |
| review_suppressed_at | timestamptz | YES | |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |

FKs: customer_id → customers(id) RESTRICT. RLS: 4 policies.

Related: `table_booking_items`, `table_booking_payments`, `table_booking_modifications`, `table_booking_reminder_history`, `table_booking_sms_templates`, `booking_audit`, `booking_table_assignments`.

---

### private_bookings
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| customer_id | uuid | YES | |
| event_name | text | NO | |
| event_date | date | NO | |
| start_time | time | YES | |
| end_time | time | YES | |
| party_size | integer | YES | |
| venue_space_id | uuid | YES | |
| status | text | NO | 'draft' |
| deposit_amount | numeric | YES | |
| deposit_paid | boolean | YES | false |
| deposit_paid_at | timestamptz | YES | |
| total_amount | numeric | YES | |
| catering_required | boolean | YES | false |
| bar_required | boolean | YES | false |
| contract_sent | boolean | YES | false |
| contract_signed | boolean | YES | false |
| notes | text | YES | |
| special_requirements | text | YES | |
| cancelled_at | timestamptz | YES | |
| cancelled_by | text | YES | |
| cancellation_reason | text | YES | |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |

FKs: customer_id → customers(id), venue_space_id → venue_spaces(id). Views: `private_booking_summary`, `private_bookings_with_details`.

---

## Employee & HR Tables

### employees
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| employee_id | uuid | NO | gen_random_uuid() |
| auth_user_id | uuid | YES | |
| first_name | text | NO | |
| last_name | text | NO | |
| email | text | NO | |
| phone | text | YES | |
| role | text | YES | |
| department | text | YES | |
| start_date | date | YES | |
| end_date | date | YES | |
| status | text | YES | 'active' |
| hourly_rate | numeric | YES | |
| contracted_hours | numeric | YES | |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |

RLS: 4 policies.

Satellite tables (all FK → employees.employee_id CASCADE):
- `employee_emergency_contacts` — name, relationship, phone, email
- `employee_financial_details` — bank_account_name, sort_code, account_number, ni_number, tax_code
- `employee_health_records` — medical conditions, medications, allergies, emergency info
- `employee_right_to_work` — document_type, document_number, expiry_date, verified_by_user_id → auth.users
- `employee_attachments` — file_path, file_name, category_id → attachment_categories
- `employee_notes` — note content, created_by
- `employee_onboarding_checklist` — step tracking with completion flags
- `employee_pay_settings` — pay_rate, pay_type, overtime_rate
- `employee_rate_overrides` — date-specific rate overrides
- `employee_invite_tokens` — onboarding invite token management
- `employee_version_history` — changelog snapshots

---

### rota_shifts
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| employee_id | uuid | NO | |
| week_id | uuid | NO | |
| shift_date | date | NO | |
| start_time | time | NO | |
| end_time | time | NO | |
| break_minutes | integer | YES | 0 |
| role | text | YES | |
| notes | text | YES | |
| is_confirmed | boolean | YES | false |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |

FKs: employee_id → employees(employee_id), week_id → rota_weeks(id). RLS: 1 policy.

Related: `rota_weeks`, `rota_published_shifts`, `rota_shift_templates`, `rota_email_log`, `rota_google_calendar_events`.

---

### leave_requests / leave_days
`leave_requests`: employee_id, type, start_date, end_date, status, notes, created_at. RLS: 1 policy each.
`leave_days`: request_id → leave_requests(id) CASCADE, date, hours.

### timeclock_sessions
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| employee_id | uuid | NO | |
| clock_in | timestamptz | NO | |
| clock_out | timestamptz | YES | |
| break_minutes | integer | YES | 0 |
| approved_by | uuid | YES | |
| site_id | uuid | YES | |
| notes | text | YES | |
| created_at | timestamptz | YES | now() |

RLS: 3 policies.

---

### departments / department_budgets
`departments`: id, name. `department_budgets`: department_id → departments(id), budget_year, amount. RLS: 1–2 policies.

---

## Invoicing & Finance Tables

### invoices
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| invoice_number | text | NO | |
| vendor_id | uuid | YES | |
| status | text | NO | 'draft' |
| issue_date | date | NO | |
| due_date | date | YES | |
| subtotal | numeric | NO | 0 |
| vat_amount | numeric | NO | 0 |
| total | numeric | NO | 0 |
| currency | text | YES | 'GBP' |
| notes | text | YES | |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |

FKs: vendor_id → invoice_vendors(id). RLS: 5 policies.

Related: `invoice_line_items`, `invoice_payments`, `invoice_audit`, `invoice_email_logs`, `invoice_emails`, `invoice_email_templates`, `invoice_reminder_settings`, `invoice_series`, `invoice_vendors`, `invoice_vendor_contacts`.

### recurring_invoices / recurring_invoice_line_items / recurring_invoice_history
Recurring billing schedules with line items and generation history.

### quotes / quote_line_items
`quotes`: vendor_id, status, valid_until, total, created_at. `quote_line_items`: quote_id → quotes(id).

### credit_notes
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| invoice_id | uuid | YES | |
| amount_ex_vat | numeric | NO | |
| vat_rate | numeric | NO | 20 |
| amount_inc_vat | numeric | NO | |
| reason | text | NO | |
| status | text | NO | 'issued' |
| created_by | uuid | NO | |
| created_at | timestamptz | NO | now() |

RLS: 3 policies.

### line_item_catalog
Reusable line item templates. RLS: 1 policy.

### payments
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| event_booking_id | uuid | YES | |
| table_booking_id | uuid | YES | |
| amount | numeric | NO | |
| currency | text | YES | 'GBP' |
| status | payment_status | NO | |
| provider | text | YES | |
| provider_payment_id | text | YES | |
| created_at | timestamptz | YES | now() |

FKs: event_booking_id → bookings(id) CASCADE, table_booking_id → table_bookings(id) CASCADE.

### cashup_sessions
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| site_id | uuid | YES | |
| session_date | date | NO | |
| opened_by | uuid | YES | |
| closed_by | uuid | YES | |
| status | text | YES | 'open' |
| total_expected_amount | numeric | YES | |
| total_counted_amount | numeric | YES | |
| total_variance_amount | numeric | YES | |
| created_at | timestamptz | YES | now() |

FKs: site_id → sites(id). RLS: 3 policies.
Related: `cashup_cash_counts`, `cashup_payment_breakdowns`, `cashup_targets`.

### expenses / expense_files
`expenses`: id, employee_id, category, amount, date, description, status, receipt_url, created_at. RLS: 1 policy each.

### receipt_transactions / receipt_batches / receipt_files / receipt_rules / receipt_transaction_logs
Receipt management with status enum `receipt_transaction_status`. RLS: enabled.

### reconciliation_notes
Notes attached to cashup/reconciliation sessions.

---

## OJ Projects / Billing

### oj_projects (inferred from FKs and context)
Related: `oj_billing_runs`, `oj_recurring_charge_instances` (FK → invoices(id), oj_billing_runs(id)).
Supports monthly, quarterly, and annually recurring charges.

### charge_requests
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| charge_request_id | uuid | YES | |
| action_type | text | NO | |
| expires_at | timestamptz | NO | |
| consumed_at | timestamptz | YES | |
| waitlist_offer_id | uuid | YES | |
| private_booking_id | uuid | YES | |
| created_at | timestamptz | NO | now() |

---

## Loyalty Programme Tables

### loyalty_programs
id, name, description, is_active, created_at.

### loyalty_members
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| customer_id | uuid | YES | |
| program_id | uuid | YES | |
| points_balance | integer | YES | 0 |
| tier_id | uuid | YES | |
| joined_at | timestamptz | YES | now() |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |

FKs: customer_id → customers(id), program_id → loyalty_programs(id).

Related: `loyalty_tiers`, `loyalty_achievements`, `loyalty_challenges`, `loyalty_campaigns`, `loyalty_rewards`, `loyalty_point_transactions`, `customer_achievements`, `customer_challenges`, `achievement_progress`, `reward_redemptions`.

---

## Messaging & SMS Tables

### messages
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| customer_id | uuid | YES | |
| direction | text | NO | |
| body | text | NO | |
| status | text | YES | |
| from_number | text | YES | |
| to_number | text | YES | |
| message_type | text | YES | 'sms' |
| read_at | timestamptz | YES | |
| created_at | timestamptz | YES | now() |

Related: `message_templates`, `message_template_history`, `message_delivery_status`, `booking_reminders`, `private_booking_sms_reminders`, `table_booking_sms_templates`, `sms_promo_context`, `promo_sequence`.

---

## Venue & Operations Tables

### venue_spaces
id, name, capacity, description, is_active, created_at. FK target for private_bookings. RLS: 2 policies.
Related: `venue_space_table_areas`.

### tables / table_configuration / table_combinations
Physical table layout. `tables`: id, name, capacity, area_id, is_active.
`table_configuration`: id, label, capacity, area. `table_combinations`: id, name, combined_capacity.
`table_combination_tables`: combination_id → table_combinations(id), table_id → table_configuration(id).
`booking_table_assignments`: table_booking_id → table_bookings(id), table_id → tables(id) RESTRICT.
`table_join_groups`, `table_join_group_members`, `table_join_links`: dynamic table joining for large parties.
`table_areas`: area groupings.

### business_hours / special_hours
Operating hours with date-specific overrides. RLS: 2 policies each.

### service_statuses / service_status_overrides / service_slots / service_slot_config / service_slot_overrides
Time-slot booking availability configuration. RLS: 1–2 policies each.

### booking_time_slots / booking_policies
Availability time slots and booking constraint policies. RLS: 2 policies each.

### calendar_notes
id, date, note, created_by. RLS: 4 policies.

### sites
id, name, created_at. Multi-site support for cashup/timeclock. RLS: 1 policy.

### business_amenities
Venue amenity tags. RLS: 1 policy.

### sunday_lunch_menu_items
Menu items specific to the sunday lunch booking flow. RLS: 4 policies.

### catering_packages
id, name, description, price_per_head, is_active. RLS: 2 policies.

---

## RBAC Tables

### roles
id, name, description.

### role_permissions
role_id → roles(id) CASCADE, module, action.

### user_roles
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| user_id | uuid | NO | |
| role_id | uuid | NO | |
| assigned_by | uuid | YES | |
| assigned_at | timestamptz | YES | now() |

FKs: user_id → auth.users(id) CASCADE, role_id → roles(id) CASCADE, assigned_by → auth.users(id). RLS: 2 policies.

### profiles
id → auth.users(id), display_name, avatar_url, created_at, updated_at.

---

## Menu Management Tables

### menu_menus / menu_sections / menu_items / menu_categories / menu_category_menus
Full customer-facing menu hierarchy.

### menu_dishes / menu_ingredients / menu_recipes
Recipe costing system. `menu_dish_ingredients`, `menu_dish_recipes`, `menu_dish_menu_assignments`, `menu_recipe_ingredients` — many-to-many joins.
`menu_ingredient_prices` — price history. `menu_ingredients` has `unit` (menu_unit enum), `storage_type` (menu_storage_type enum).
Views: `menu_dishes_with_costs`, `menu_ingredients_with_prices`.

---

## Parking Tables

Status enum: `parking_booking_status`. Payment status: `parking_payment_status`.
Notification system uses: `parking_notification_event`, `parking_notification_channel`.

---

## Waitlist Tables

### waitlist_entries
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| event_id | uuid | NO | |
| customer_id | uuid | NO | |
| party_size | integer | YES | |
| status | text | YES | 'waiting' |
| created_at | timestamptz | YES | now() |

FKs: event_id → events(id) CASCADE, customer_id → customers(id) CASCADE.

### waitlist_offers
id, waitlist_entry_id → waitlist_entries(id) CASCADE, event_id → events(id), expires_at, status, created_at.

### booking_holds
id, event_booking_id → bookings(id) CASCADE, table_booking_id → table_bookings(id) CASCADE, waitlist_offer_id → waitlist_offers(id) CASCADE, hold_expires_at.

---

## API & Webhooks Tables

### api_keys
id, key_hash, name, permissions (jsonb), rate_limit (default 1000), is_active, last_used_at, expires_at, created_at, updated_at. RLS: 3 policies.

### api_usage
id, api_key_id → api_keys(id) CASCADE, endpoint, method, status_code, response_time_ms, ip_address, user_agent, created_at.

### webhooks / webhook_deliveries / webhook_logs
`webhooks`: id, url, events (jsonb), is_active, secret_hash, created_at. RLS: 2 policies.
`webhook_deliveries`: webhook_id → webhooks(id), payload, status, attempts, next_retry_at.
`webhook_logs`: id, endpoint, payload, response_status, created_at.

### short_links / short_link_clicks / short_link_daily_stats
URL shortener. `short_links`: slug, target_url, created_by → auth.users(id). RLS: 4 policies.
`short_link_clicks`: short_link_id CASCADE, clicked_at, ip_address, user_agent. RLS: 3 policies.

---

## System / Infrastructure Tables

### audit_logs
| Name | Type | Nullable | Default |
|------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| created_at | timestamptz | NO | now() |
| user_id | uuid | YES | |
| user_email | text | YES | |
| operation_type | text | NO | |
| resource_type | text | NO | |
| resource_id | text | YES | |
| operation_status | text | NO | |
| old_values | jsonb | YES | |
| new_values | jsonb | YES | |
| error_message | text | YES | |
| additional_info | jsonb | YES | |
| ip_address | inet | YES | |
| user_agent | text | YES | |

FK: user_id → auth.users(id). RLS: 5 policies.

### background_jobs / job_queue / jobs
`background_jobs`: type, payload (jsonb), status (default 'pending'), priority, attempts, max_attempts, scheduled_for, processed_at, completed_at, error, result (jsonb), duration_ms. RLS: 1 policy.
`cron_job_runs`: job_name, run_key, status, started_at, finished_at, error_message.

### idempotency_keys
key (PK), request_hash, response (jsonb), created_at, expires_at (now+24h). RLS: 1 policy.

### rate_limits
Per-key/window rate limiting records.

### system_settings
key (PK), value (jsonb), updated_at. RLS: 2 policies.

### ai_usage_events
id (bigint), occurred_at, context, model, prompt_tokens, completion_tokens, total_tokens, cost. RLS: 1 policy.

### analytics_events
id, customer_id, event_booking_id, table_booking_id, private_booking_id, event_type, metadata (jsonb), created_at.

### feedback
General feedback capture table.

### guest_tokens
Tokenised guest access for unauthenticated flows (parking, table bookings).

---

## Views (no RLS)

| View | Purpose |
|------|---------|
| admin_users_view | Auth user list for admin panel |
| cashup_weekly_view | Aggregated weekly cashup data |
| customer_messaging_health | Per-customer SMS delivery health metrics |
| customer_scores | Derived customer engagement scores |
| menu_dishes_with_costs | Dishes with calculated ingredient costs |
| menu_ingredients_with_prices | Ingredients with latest price lookup |
| message_templates_with_timing | Templates enriched with send-timing metadata |
| private_booking_summary | Enriched private booking summary |
| private_bookings_with_details | Full join with customer + space |
| recent_reminder_activity | Last N reminder send records |
| reminder_timing_debug | Debug view for SMS scheduling logic |
| short_link_daily_stats | Click aggregates by day |

---

## Foreign Key Summary

| Child Table | FK Column | References | On Delete |
|-------------|-----------|------------|-----------|
| bookings | customer_id | customers | CASCADE |
| bookings | event_id | events | CASCADE |
| table_bookings | customer_id | customers | RESTRICT |
| private_bookings | customer_id | customers | — |
| private_bookings | venue_space_id | venue_spaces | — |
| payments | event_booking_id | bookings | CASCADE |
| payments | table_booking_id | table_bookings | CASCADE |
| invoice_line_items | invoice_id | invoices | CASCADE |
| invoice_payments | invoice_id | invoices | CASCADE |
| employee_* | employee_id | employees | CASCADE |
| rota_shifts | employee_id | employees | — |
| loyalty_members | customer_id | customers | — |
| api_usage | api_key_id | api_keys | CASCADE |
| short_link_clicks | short_link_id | short_links | CASCADE |
| user_roles | user_id | auth.users | CASCADE |
| audit_logs | user_id | auth.users | — |
| waitlist_entries | customer_id | customers | CASCADE |
| waitlist_entries | event_id | events | CASCADE |
| waitlist_offers | waitlist_entry_id | waitlist_entries | CASCADE |
| booking_holds | event_booking_id | bookings | CASCADE |
| booking_holds | table_booking_id | table_bookings | CASCADE |
| booking_holds | waitlist_offer_id | waitlist_offers | CASCADE |
| oj_recurring_charge_instances | invoice_id | invoices | — |
| cashup_sessions | site_id | sites | — |
| achievement_progress | achievement_id | loyalty_achievements | CASCADE |
| achievement_progress | member_id | loyalty_members | CASCADE |
| booking_audit | booking_id | table_bookings | CASCADE |
