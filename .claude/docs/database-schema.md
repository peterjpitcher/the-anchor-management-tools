# AMS Database Schema

**Database:** the-anchor-management-tools (Supabase, PostgreSQL 15)
**Tables:** 199 base tables, 14 views
**Foreign Keys:** 273
**RLS Policies:** 384

## Domain Groups

- [Auth & RBAC](#auth--rbac) (5 tables)
- [Employees](#employees) (11 tables)
- [Customers & Loyalty](#customers--loyalty) (17 tables)
- [Private Bookings](#private-bookings) (11 tables)
- [Table Bookings](#table-bookings) (20 tables)
- [Tables & Venue](#tables--venue) (16 tables)
- [Events & Performers](#events--performers) (9 tables)
- [Rota & Timeclock](#rota--timeclock) (10 tables)
- [Payroll](#payroll) (6 tables)
- [Invoices](#invoices) (16 tables)
- [Receipts & P&L](#receipts--p&l) (8 tables)
- [Expenses & Mileage](#expenses--mileage) (8 tables)
- [Payments](#payments) (2 tables)
- [Messaging](#messaging) (7 tables)
- [Parking](#parking) (5 tables)
- [Menu](#menu) (13 tables)
- [OJ Projects](#oj-projects) (8 tables)
- [Short Links](#short-links) (2 tables)
- [Cashing Up](#cashing-up) (5 tables)
- [Calendar](#calendar) (1 tables)
- [Vendors](#vendors) (2 tables)
- [System](#system) (16 tables)
- [Other](#other) (1 tables)
- [Views](#views) (14 views)
- [Enum Types](#enum-types) (13 types)

---
## Auth & RBAC

### `permissions`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| module_name | text | NO |  |
| action | text | NO |  |
| description | text | YES |  |
| created_at | timestamptz | YES | now() |

**RLS:** Enabled, 2 policies (ALL, SELECT)
**Audit columns:** created_at

### `profiles`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO |  |
| full_name | text | YES |  |
| updated_at | timestamptz | NO | now() |
| email | text | YES |  |
| created_at | timestamptz | YES | now() |
| sms_notifications | boolean | YES | true |
| email_notifications | boolean | YES | true |
| avatar_url | text | YES |  |
| first_name | text | YES |  |
| last_name | text | YES |  |

**Foreign Keys:**
- `id` -> `auth.users(id)`

**RLS:** Enabled, 2 policies (SELECT, UPDATE)
**Audit columns:** updated_at, created_at

### `role_permissions`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| role_id | uuid | NO |  |
| permission_id | uuid | NO |  |
| created_at | timestamptz | YES | now() |

**Foreign Keys:**
- `permission_id` -> `permissions(id)`
- `role_id` -> `roles(id)`

**RLS:** Enabled, 2 policies (ALL, SELECT)
**Audit columns:** created_at

### `roles`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| name | text | NO |  |
| description | text | YES |  |
| is_system | boolean | YES | false |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |

**RLS:** Enabled, 2 policies (ALL, SELECT)
**Audit columns:** created_at, updated_at

### `user_roles`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| user_id | uuid | NO |  |
| role_id | uuid | NO |  |
| assigned_at | timestamptz | YES | now() |
| assigned_by | uuid | YES |  |

**Foreign Keys:**
- `assigned_by` -> `auth.users(id)`
- `role_id` -> `roles(id)`
- `user_id` -> `auth.users(id)`

**RLS:** Enabled, 2 policies (ALL, SELECT)

---
## Employees

### `employee_attachments`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| attachment_id | uuid | NO | gen_random_uuid() |
| employee_id | uuid | NO |  |
| category_id | uuid | NO |  |
| file_name | text | NO |  |
| storage_path | text | NO |  |
| mime_type | text | NO |  |
| file_size_bytes | bigint | NO |  |
| description | text | YES |  |
| uploaded_at | timestamptz | NO | now() |

**Foreign Keys:**
- `category_id` -> `attachment_categories(category_id)`
- `employee_id` -> `employees(employee_id)`

**RLS:** Enabled, 2 policies (ALL, SELECT)

### `employee_emergency_contacts`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| created_at | timestamptz | YES | now() |
| employee_id | uuid | NO |  |
| name | text | NO |  |
| relationship | text | YES |  |
| address | text | YES |  |
| phone_number | text | YES |  |
| priority | text | YES | 'Other'::text |
| mobile_number | text | YES |  |

**Foreign Keys:**
- `employee_id` -> `employees(employee_id)`

**RLS:** Enabled, 2 policies (ALL, SELECT)
**Audit columns:** created_at

### `employee_financial_details`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| employee_id | uuid | NO |  |
| ni_number | text | YES |  |
| bank_account_number | text | YES |  |
| bank_sort_code | text | YES |  |
| bank_name | text | YES |  |
| payee_name | text | YES |  |
| branch_address | text | YES |  |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |

**Foreign Keys:**
- `employee_id` -> `employees(employee_id)`

**RLS:** Enabled, 2 policies (ALL, SELECT)
**Audit columns:** created_at, updated_at

### `employee_health_records`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| employee_id | uuid | NO |  |
| doctor_name | text | YES |  |
| doctor_address | text | YES |  |
| allergies | text | YES |  |
| illness_history | text | YES |  |
| recent_treatment | text | YES |  |
| has_diabetes | boolean | NO | false |
| has_epilepsy | boolean | NO | false |
| has_skin_condition | boolean | NO | false |
| has_depressive_illness | boolean | NO | false |
| has_bowel_problems | boolean | NO | false |
| has_ear_problems | boolean | NO | false |
| is_registered_disabled | boolean | NO | false |
| disability_reg_number | text | YES |  |
| disability_reg_expiry_date | date | YES |  |
| disability_details | text | YES |  |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |
| has_allergies | boolean | NO | false |
| had_absence_over_2_weeks_last_3_years | boolean | NO | false |
| had_outpatient_treatment_over_3_months_last_3_years | boolean | NO | false |
| absence_or_treatment_details | text | YES |  |

**Foreign Keys:**
- `employee_id` -> `employees(employee_id)`

**RLS:** Enabled, 2 policies (ALL, SELECT)
**Audit columns:** created_at, updated_at

### `employee_invite_tokens`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| employee_id | uuid | NO |  |
| email | text | NO |  |
| token | text | NO | encode(gen_random_bytes(32), 'hex'::t... |
| expires_at | timestamptz | NO | now() |
| completed_at | timestamptz | YES |  |
| day3_chase_sent_at | timestamptz | YES |  |
| day6_chase_sent_at | timestamptz | YES |  |
| created_at | timestamptz | NO | now() |
| invite_type | text | NO | 'onboarding'::text |

**Foreign Keys:**
- `employee_id` -> `employees(employee_id)`

**RLS:** Enabled, 1 policies (ALL)
**Audit columns:** created_at

### `employee_notes`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| note_id | uuid | NO | gen_random_uuid() |
| employee_id | uuid | NO |  |
| note_text | text | NO |  |
| created_at | timestamptz | NO | now() |
| created_by_user_id | uuid | YES |  |

**Foreign Keys:**
- `employee_id` -> `employees(employee_id)`

**RLS:** Enabled, 4 policies (DELETE, INSERT, SELECT, UPDATE)
**Audit columns:** created_at

### `employee_onboarding_checklist`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| employee_id | uuid | NO |  |
| wheniwork_invite_sent | boolean | YES | false |
| wheniwork_invite_date | date | YES |  |
| private_whatsapp_added | boolean | YES | false |
| private_whatsapp_date | date | YES |  |
| team_whatsapp_added | boolean | YES | false |
| team_whatsapp_date | date | YES |  |
| till_system_setup | boolean | YES | false |
| till_system_date | date | YES |  |
| training_flow_setup | boolean | YES | false |
| training_flow_date | date | YES |  |
| employment_agreement_drafted | boolean | YES | false |
| employment_agreement_date | date | YES |  |
| employee_agreement_accepted | boolean | YES | false |
| employee_agreement_accepted_date | timestamptz | YES |  |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |

**Foreign Keys:**
- `employee_id` -> `employees(employee_id)`

**RLS:** Enabled, 2 policies (ALL, SELECT)
**Audit columns:** created_at, updated_at

### `employee_pay_settings`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| employee_id | uuid | NO |  |
| pay_type | text | NO | 'hourly'::text |
| max_weekly_hours | numeric | YES |  |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |
| holiday_allowance_days | smallint | NO | 25 |

**Foreign Keys:**
- `employee_id` -> `employees(employee_id)`

**RLS:** Enabled, 1 policies (ALL)
**Audit columns:** created_at, updated_at

### `employee_rate_overrides`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| employee_id | uuid | NO |  |
| hourly_rate | numeric | NO |  |
| effective_from | date | NO |  |
| created_by | uuid | YES |  |
| created_at | timestamptz | NO | now() |

**Foreign Keys:**
- `employee_id` -> `employees(employee_id)`
- `created_by` -> `auth.users(id)`

**RLS:** Enabled, 1 policies (ALL)
**Audit columns:** created_by, created_at

### `employee_right_to_work`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| employee_id | uuid | NO |  |
| document_type | text | NO |  |
| document_details | text | YES |  |
| verification_date | date | NO |  |
| document_expiry_date | date | YES |  |
| follow_up_date | date | YES |  |
| verified_by_user_id | uuid | YES |  |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |
| photo_storage_path | text | YES |  |
| check_method | text | YES |  |
| document_reference | text | YES |  |

**Foreign Keys:**
- `employee_id` -> `employees(employee_id)`
- `verified_by_user_id` -> `auth.users(id)`

**RLS:** Enabled, 2 policies (ALL, SELECT)
**Audit columns:** created_at, updated_at

### `employees`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| employee_id | uuid | NO | gen_random_uuid() |
| first_name | text | YES |  |
| last_name | text | YES |  |
| date_of_birth | date | YES |  |
| address | text | YES |  |
| phone_number | text | YES |  |
| email_address | text | NO |  |
| job_title | text | YES |  |
| employment_start_date | date | YES |  |
| employment_end_date | date | YES |  |
| status | text | NO | 'Active'::text |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |
| post_code | text | YES |  |
| mobile_number | text | YES |  |
| uniform_preference | text | YES |  |
| keyholder_status | boolean | YES | false |
| first_shift_date | date | YES |  |
| auth_user_id | uuid | YES |  |
| invited_at | timestamptz | YES |  |
| onboarding_completed_at | timestamptz | YES |  |

**Foreign Keys:**
- `auth_user_id` -> `auth.users(id)`

**RLS:** Enabled, 4 policies (DELETE, INSERT, SELECT, UPDATE)
**Audit columns:** created_at, updated_at

---
## Customers & Loyalty

### `achievement_progress`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| member_id | uuid | YES |  |
| achievement_id | uuid | YES |  |
| progress | jsonb | YES | '{}'::jsonb |
| current_value | integer | YES | 0 |
| target_value | integer | NO |  |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |

**Foreign Keys:**
- `achievement_id` -> `loyalty_achievements(id)`
- `member_id` -> `loyalty_members(id)`

**RLS:** Enabled, 2 policies (ALL, SELECT)
**Audit columns:** created_at, updated_at

### `customer_achievements`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| member_id | uuid | YES |  |
| achievement_id | uuid | YES |  |
| earned_date | timestamptz | YES | now() |
| points_awarded | integer | YES | 0 |
| created_at | timestamptz | YES | now() |

**Foreign Keys:**
- `achievement_id` -> `loyalty_achievements(id)`
- `member_id` -> `loyalty_members(id)`

**RLS:** Enabled, 2 policies (ALL, SELECT)
**Audit columns:** created_at

### `customer_category_stats`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| customer_id | uuid | NO |  |
| category_id | uuid | NO |  |
| times_attended | integer | YES | 0 |
| last_attended_date | date | YES |  |
| first_attended_date | date | YES |  |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |

**Foreign Keys:**
- `category_id` -> `event_categories(id)`
- `customer_id` -> `customers(id)`

**RLS:** Enabled, 2 policies (SELECT)
**Audit columns:** created_at, updated_at

### `customer_challenges`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| member_id | uuid | YES |  |
| challenge_id | uuid | YES |  |
| progress | jsonb | YES | '{}'::jsonb |
| completed_count | integer | YES | 0 |
| last_completed_at | timestamptz | YES |  |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |

**Foreign Keys:**
- `challenge_id` -> `loyalty_challenges(id)`
- `member_id` -> `loyalty_members(id)`

**RLS:** Enabled, 2 policies (ALL, SELECT)
**Audit columns:** created_at, updated_at

### `customer_label_assignments`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| customer_id | uuid | NO |  |
| label_id | uuid | NO |  |
| assigned_at | timestamptz | YES | now() |
| assigned_by | uuid | YES |  |
| auto_assigned | boolean | YES | false |
| notes | text | YES |  |

**Foreign Keys:**
- `assigned_by` -> `auth.users(id)`
- `customer_id` -> `customers(id)`
- `label_id` -> `customer_labels(id)`

**RLS:** Enabled, 3 policies (DELETE, INSERT, SELECT)

### `customer_labels`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| name | varchar | NO |  |
| description | text | YES |  |
| color | varchar | YES | '#6B7280'::character varying |
| icon | varchar | YES |  |
| auto_apply_rules | jsonb | YES |  |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |

**RLS:** Enabled, 4 policies (DELETE, INSERT, SELECT, UPDATE)
**Audit columns:** created_at, updated_at

### `customer_scores`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| customer_id | uuid | NO |  |
| total_score | integer | NO | 0 |
| last_booking_date | date | YES |  |
| bookings_last_30 | integer | NO | 0 |
| bookings_last_90 | integer | NO | 0 |
| bookings_last_365 | integer | NO | 0 |
| booking_breakdown | jsonb | NO | '{}'::jsonb |
| updated_at | timestamptz | NO | now() |

**Foreign Keys:**
- `customer_id` -> `customers(id)`

**RLS:** No policies found
**Audit columns:** updated_at

### `customers`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| first_name | text | NO |  |
| last_name | text | NO |  |
| mobile_number | text | NO |  |
| created_at | timestamptz | NO | now() |
| sms_opt_in | boolean | YES | true |
| sms_delivery_failures | integer | YES | 0 |
| last_sms_failure_reason | text | YES |  |
| last_successful_sms_at | timestamptz | YES |  |
| sms_deactivated_at | timestamptz | YES |  |
| sms_deactivation_reason | text | YES |  |
| messaging_status | text | YES | 'active'::text |
| last_successful_delivery | timestamptz | YES |  |
| consecutive_failures | integer | YES | 0 |
| total_failures_30d | integer | YES | 0 |
| last_failure_type | text | YES |  |
| table_booking_count | integer | YES | 0 |
| no_show_count | integer | YES | 0 |
| last_table_booking_date | date | YES |  |
| email | varchar | YES |  |
| mobile_e164 | varchar | YES |  |
| mobile_number_raw | text | YES |  |
| sms_status | text | NO | 'active'::text |
| marketing_sms_opt_in | boolean | NO | false |
| stripe_customer_id | text | YES |  |
| internal_notes | text | YES |  |

**RLS:** Enabled, 5 policies (DELETE, INSERT, SELECT, UPDATE)
**Audit columns:** created_at

### `loyalty_achievements`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| program_id | uuid | YES |  |
| name | varchar | NO |  |
| description | text | YES |  |
| icon | varchar | YES |  |
| points_value | integer | YES | 0 |
| criteria | jsonb | NO |  |
| category | varchar | YES |  |
| active | boolean | YES | true |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |

**Foreign Keys:**
- `program_id` -> `loyalty_programs(id)`

**RLS:** Enabled, 2 policies (ALL, SELECT)
**Audit columns:** created_at, updated_at

### `loyalty_campaigns`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| program_id | uuid | YES |  |
| name | varchar | NO |  |
| description | text | YES |  |
| start_date | date | NO |  |
| end_date | date | NO |  |
| bonus_type | varchar | NO |  |
| bonus_value | numeric | NO |  |
| criteria | jsonb | YES | '{}'::jsonb |
| active | boolean | YES | true |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |

**Foreign Keys:**
- `program_id` -> `loyalty_programs(id)`

**RLS:** Enabled, 2 policies (ALL, SELECT)
**Audit columns:** created_at, updated_at

### `loyalty_challenges`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| program_id | uuid | YES |  |
| name | varchar | NO |  |
| description | text | YES |  |
| icon | varchar | YES |  |
| points_value | integer | YES | 0 |
| criteria | jsonb | NO |  |
| category | varchar | YES |  |
| start_date | timestamptz | NO |  |
| end_date | timestamptz | NO |  |
| max_completions | integer | YES | 1 |
| sort_order | integer | YES | 0 |
| active | boolean | YES | true |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |

**Foreign Keys:**
- `program_id` -> `loyalty_programs(id)`

**RLS:** Enabled, 2 policies (ALL, SELECT)
**Audit columns:** created_at, updated_at

### `loyalty_members`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| customer_id | uuid | YES |  |
| program_id | uuid | YES |  |
| tier_id | uuid | YES |  |
| total_points | integer | YES | 0 |
| available_points | integer | YES | 0 |
| lifetime_points | integer | YES | 0 |
| lifetime_events | integer | YES | 0 |
| join_date | date | YES | CURRENT_DATE |
| last_visit_date | date | YES |  |
| status | varchar | YES | 'active'::character varying |
| metadata | jsonb | YES | '{}'::jsonb |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |
| access_token | varchar | YES |  |

**Foreign Keys:**
- `customer_id` -> `customers(id)`
- `program_id` -> `loyalty_programs(id)`
- `tier_id` -> `loyalty_tiers(id)`

**RLS:** Enabled, 2 policies (ALL, SELECT)
**Audit columns:** created_at, updated_at

### `loyalty_point_transactions`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| member_id | uuid | YES |  |
| points | integer | NO |  |
| transaction_type | varchar | NO |  |
| description | text | YES |  |
| reference_type | varchar | YES |  |
| reference_id | uuid | YES |  |
| balance_after | integer | NO |  |
| created_at | timestamptz | YES | now() |
| created_by | uuid | YES |  |

**Foreign Keys:**
- `created_by` -> `auth.users(id)`
- `member_id` -> `loyalty_members(id)`

**RLS:** Enabled, 3 policies (ALL, INSERT, SELECT)
**Audit columns:** created_at, created_by

### `loyalty_programs`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| name | varchar | NO |  |
| active | boolean | YES | true |
| settings | jsonb | YES | '{}'::jsonb |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |

**RLS:** Enabled, 2 policies (ALL, SELECT)
**Audit columns:** created_at, updated_at

### `loyalty_rewards`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| program_id | uuid | YES |  |
| name | varchar | NO |  |
| description | text | YES |  |
| points_cost | integer | NO |  |
| tier_required | uuid | YES |  |
| category | varchar | YES |  |
| icon | varchar | YES |  |
| inventory | integer | YES |  |
| daily_limit | integer | YES |  |
| active | boolean | YES | true |
| metadata | jsonb | YES | '{}'::jsonb |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |

**Foreign Keys:**
- `program_id` -> `loyalty_programs(id)`
- `tier_required` -> `loyalty_tiers(id)`

**RLS:** Enabled, 2 policies (ALL, SELECT)
**Audit columns:** created_at, updated_at

### `loyalty_tiers`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| program_id | uuid | YES |  |
| name | varchar | NO |  |
| level | integer | NO |  |
| min_events | integer | YES | 0 |
| point_multiplier | numeric | YES | 1.0 |
| color | varchar | YES |  |
| icon | varchar | YES |  |
| benefits | jsonb | YES | '[]'::jsonb |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |

**Foreign Keys:**
- `program_id` -> `loyalty_programs(id)`

**RLS:** Enabled, 2 policies (ALL, SELECT)
**Audit columns:** created_at, updated_at

### `reward_redemptions`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| member_id | uuid | YES |  |
| reward_id | uuid | YES |  |
| redemption_code | varchar | YES |  |
| points_spent | integer | NO |  |
| generated_at | timestamptz | YES | now() |
| expires_at | timestamptz | YES |  |
| redeemed_at | timestamptz | YES |  |
| redeemed_by | uuid | YES |  |
| status | varchar | YES | 'pending'::character varying |
| metadata | jsonb | YES | '{}'::jsonb |
| created_at | timestamptz | YES | now() |

**Foreign Keys:**
- `member_id` -> `loyalty_members(id)`
- `redeemed_by` -> `auth.users(id)`
- `reward_id` -> `loyalty_rewards(id)`

**RLS:** Enabled, 2 policies (ALL, SELECT)
**Audit columns:** created_at

---
## Private Bookings

### `catering_packages`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| name | text | NO |  |
| serving_style | text | YES |  |
| cost_per_head | numeric | NO |  |
| minimum_guests | integer | YES | 10 |
| maximum_guests | integer | YES |  |
| dietary_notes | text | YES |  |
| active | boolean | YES | true |
| display_order | integer | YES | 0 |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |
| pricing_model | text | YES | 'per_head'::text |
| category | text | NO |  |
| summary | text | YES |  |
| includes | text | YES |  |
| served | text | YES |  |
| good_to_know | text | YES |  |
| guest_description | text | YES |  |

**RLS:** Enabled, 2 policies (ALL, SELECT)
**Audit columns:** created_at, updated_at

### `charge_requests`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| table_booking_id | uuid | NO |  |
| type | text | NO |  |
| amount | numeric | NO |  |
| currency | text | NO | 'GBP'::text |
| metadata | jsonb | NO | '{}'::jsonb |
| requested_by | text | NO | 'system'::text |
| requested_by_user_id | uuid | YES |  |
| manager_decision | text | YES |  |
| decided_at | timestamptz | YES |  |
| stripe_payment_intent_id | text | YES |  |
| charge_status | text | NO | 'pending'::text |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |

**Foreign Keys:**
- `table_booking_id` -> `table_bookings(id)`

**RLS:** No policies found
**Audit columns:** created_at, updated_at

### `private_booking_audit`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| booking_id | uuid | NO |  |
| action | text | NO |  |
| field_name | text | YES |  |
| old_value | text | YES |  |
| new_value | text | YES |  |
| metadata | jsonb | YES | '{}'::jsonb |
| performed_by | uuid | YES |  |
| performed_at | timestamptz | NO | now() |

**Foreign Keys:**
- `booking_id` -> `private_bookings(id)`
- `performed_by` -> `auth.users(id)`
- `performed_by` -> `profiles(id)`

**RLS:** Enabled, 1 policies (SELECT)

### `private_booking_documents`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| booking_id | uuid | NO |  |
| document_type | text | NO |  |
| file_name | text | NO |  |
| storage_path | text | NO |  |
| mime_type | text | YES |  |
| file_size_bytes | integer | YES |  |
| version | integer | YES | 1 |
| generated_at | timestamptz | YES | now() |
| generated_by | uuid | YES |  |
| metadata | jsonb | YES | '{}'::jsonb |

**Foreign Keys:**
- `booking_id` -> `private_bookings(id)`
- `generated_by` -> `auth.users(id)`

**RLS:** Enabled, 2 policies (ALL, SELECT)

### `private_booking_items`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| booking_id | uuid | NO |  |
| item_type | text | NO |  |
| space_id | uuid | YES |  |
| package_id | uuid | YES |  |
| vendor_id | uuid | YES |  |
| description | text | NO |  |
| quantity | numeric | NO | 1 |
| unit_price | numeric | NO |  |
| discount_type | text | YES |  |
| discount_value | numeric | YES | 0 |
| discount_reason | text | YES |  |
| notes | text | YES |  |
| created_at | timestamptz | NO | now() |
| display_order | integer | NO | 0 |
| line_total | numeric | YES |  |

**Foreign Keys:**
- `booking_id` -> `private_bookings(id)`
- `package_id` -> `catering_packages(id)`
- `space_id` -> `venue_spaces(id)`
- `vendor_id` -> `vendors(id)`

**RLS:** Enabled, 4 policies (ALL, SELECT)
**Audit columns:** created_at

### `private_booking_payments`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| booking_id | uuid | NO |  |
| amount | numeric | NO |  |
| method | text | NO |  |
| notes | text | YES |  |
| recorded_by | uuid | YES |  |
| created_at | timestamptz | NO | now() |

**Foreign Keys:**
- `booking_id` -> `private_bookings(id)`
- `recorded_by` -> `auth.users(id)`

**RLS:** Enabled, 4 policies (DELETE, INSERT, SELECT, UPDATE)
**Audit columns:** created_at

### `private_booking_send_idempotency`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| idempotency_key | text | NO |  |
| booking_id | uuid | NO |  |
| trigger_type | text | NO |  |
| window_key | text | NO |  |
| created_at | timestamptz | YES | now() |

**Foreign Keys:**
- `booking_id` -> `private_bookings(id)`

**RLS:** Enabled, 1 policies (ALL)
**Audit columns:** created_at

### `private_booking_sms_queue`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| booking_id | uuid | NO |  |
| trigger_type | text | NO |  |
| template_key | text | NO |  |
| scheduled_for | timestamptz | NO |  |
| message_body | text | NO |  |
| customer_phone | text | NO |  |
| customer_name | text | NO |  |
| status | text | YES | 'pending'::text |
| approved_by | uuid | YES |  |
| approved_at | timestamptz | YES |  |
| sent_at | timestamptz | YES |  |
| twilio_message_sid | text | YES |  |
| error_message | text | YES |  |
| created_at | timestamptz | NO | now() |
| created_by | uuid | YES |  |
| priority | integer | YES | 3 |
| metadata | jsonb | YES | '{}'::jsonb |
| recipient_phone | text | YES |  |
| skip_conditions | jsonb | YES |  |

**Foreign Keys:**
- `approved_by` -> `auth.users(id)`
- `booking_id` -> `private_bookings(id)`
- `created_by` -> `auth.users(id)`

**RLS:** Enabled, 5 policies (ALL, INSERT, SELECT, UPDATE)
**Audit columns:** created_at, created_by

### `private_bookings`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| customer_id | uuid | YES |  |
| customer_name | text | NO |  |
| contact_phone | text | YES |  |
| contact_email | text | YES |  |
| event_date | date | NO |  |
| start_time | time without time zone | NO |  |
| setup_time | time without time zone | YES |  |
| end_time | time without time zone | YES |  |
| guest_count | integer | YES |  |
| event_type | text | YES |  |
| status | text | YES | 'draft'::text |
| deposit_amount | numeric | YES | 250.00 |
| deposit_paid_date | timestamptz | YES |  |
| deposit_payment_method | text | YES |  |
| total_amount | numeric | YES | 0 |
| balance_due_date | date | YES |  |
| final_payment_date | timestamptz | YES |  |
| final_payment_method | text | YES |  |
| calendar_event_id | text | YES |  |
| contract_version | integer | YES | 0 |
| internal_notes | text | YES |  |
| customer_requests | text | YES |  |
| created_by | uuid | YES |  |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |
| setup_date | date | YES |  |
| discount_type | text | YES |  |
| discount_amount | numeric | YES | 0 |
| discount_reason | text | YES |  |
| customer_first_name | text | YES |  |
| customer_last_name | text | YES |  |
| customer_full_name | text | YES |  |
| source | text | YES |  |
| special_requirements | text | YES |  |
| accessibility_needs | text | YES |  |
| cancellation_reason | text | YES |  |
| cancelled_at | timestamptz | YES |  |
| end_time_next_day | boolean | YES | false |
| hold_expiry | timestamptz | YES |  |
| contract_note | text | YES |  |
| paypal_deposit_order_id | text | YES |  |
| paypal_deposit_capture_id | text | YES |  |
| review_processed_at | timestamptz | YES |  |
| review_clicked_at | timestamptz | YES |  |
| post_event_outcome | text | YES | 'pending'::text |
| post_event_outcome_decided_at | timestamptz | YES |  |
| outcome_email_sent_at | timestamptz | YES |  |
| review_sms_sent_at | timestamptz | YES |  |
| deposit_refund_status | text | YES |  |
| date_tbd | boolean | NO | false |

**Foreign Keys:**
- `created_by` -> `auth.users(id)`
- `customer_id` -> `customers(id)`

**RLS:** Enabled, 6 policies (ALL, DELETE, INSERT, SELECT, UPDATE)
**Audit columns:** created_by, created_at, updated_at

### `quote_line_items`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| quote_id | uuid | NO |  |
| catalog_item_id | uuid | YES |  |
| description | text | NO |  |
| quantity | numeric | YES | 1 |
| unit_price | numeric | YES | 0 |
| discount_percentage | numeric | YES | 0 |
| vat_rate | numeric | YES | 20 |
| subtotal_amount | numeric | YES |  |
| discount_amount | numeric | YES |  |
| vat_amount | numeric | YES |  |
| total_amount | numeric | YES |  |
| created_at | timestamptz | YES | now() |

**Foreign Keys:**
- `catalog_item_id` -> `line_item_catalog(id)`
- `quote_id` -> `quotes(id)`

**RLS:** Enabled, 1 policies (ALL)
**Audit columns:** created_at

### `quotes`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| quote_number | varchar | NO |  |
| vendor_id | uuid | YES |  |
| quote_date | date | NO | CURRENT_DATE |
| valid_until | date | NO |  |
| reference | varchar | YES |  |
| status | varchar | YES | 'draft'::character varying |
| quote_discount_percentage | numeric | YES | 0 |
| subtotal_amount | numeric | YES | 0 |
| discount_amount | numeric | YES | 0 |
| vat_amount | numeric | YES | 0 |
| total_amount | numeric | YES | 0 |
| notes | text | YES |  |
| internal_notes | text | YES |  |
| converted_to_invoice_id | uuid | YES |  |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |

**Foreign Keys:**
- `converted_to_invoice_id` -> `invoices(id)`
- `vendor_id` -> `invoice_vendors(id)`

**RLS:** Enabled, 1 policies (ALL)
**Audit columns:** created_at, updated_at

---
## Table Bookings

### `booking_audit`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | bigint | NO | auto-increment |
| booking_id | uuid | NO |  |
| event | varchar | NO |  |
| old_status | varchar | YES |  |
| new_status | varchar | YES |  |
| meta | jsonb | YES |  |
| created_at | timestamptz | NO | now() |
| created_by | uuid | YES |  |

**Foreign Keys:**
- `booking_id` -> `table_bookings(id)`
- `created_by` -> `auth.users(id)`

**RLS:** Enabled, 1 policies (SELECT)
**Audit columns:** created_at, created_by

### `booking_holds`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| hold_type | text | NO |  |
| event_booking_id | uuid | YES |  |
| table_booking_id | uuid | YES |  |
| waitlist_offer_id | uuid | YES |  |
| seats_or_covers_held | integer | NO |  |
| status | text | NO | 'active'::text |
| scheduled_sms_send_time | timestamptz | YES |  |
| expires_at | timestamptz | NO |  |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |
| consumed_at | timestamptz | YES |  |
| released_at | timestamptz | YES |  |

**Foreign Keys:**
- `event_booking_id` -> `bookings(id)`
- `table_booking_id` -> `table_bookings(id)`
- `waitlist_offer_id` -> `waitlist_offers(id)`

**RLS:** No policies found
**Audit columns:** created_at, updated_at

### `booking_policies`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| booking_type | enum | NO |  |
| full_refund_hours | integer | NO | 48 |
| partial_refund_hours | integer | NO | 24 |
| partial_refund_percentage | integer | NO | 50 |
| modification_allowed | boolean | YES | true |
| cancellation_fee | numeric | YES | 0 |
| max_party_size | integer | YES | 20 |
| min_advance_hours | integer | YES | 0 |
| max_advance_days | integer | YES | 56 |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |

**RLS:** Enabled, 2 policies (ALL, SELECT)
**Audit columns:** created_at, updated_at

### `booking_reminders`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| booking_id | uuid | NO |  |
| reminder_type | text | NO |  |
| sent_at | timestamptz | NO | now() |
| message_id | uuid | YES |  |
| created_at | timestamptz | NO | now() |
| scheduled_for | timestamptz | NO | now() |
| status | text | YES | 'pending'::text |
| error_message | text | YES |  |
| updated_at | timestamptz | YES | now() |
| event_id | uuid | YES |  |
| target_phone | text | YES |  |

**Foreign Keys:**
- `booking_id` -> `bookings(id)`
- `message_id` -> `messages(id)`

**RLS:** Enabled, 3 policies (ALL, SELECT)
**Audit columns:** created_at, updated_at

### `booking_table_assignments`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| table_booking_id | uuid | NO |  |
| table_id | uuid | NO |  |
| start_datetime | timestamptz | NO |  |
| end_datetime | timestamptz | NO |  |
| created_at | timestamptz | NO | now() |

**Foreign Keys:**
- `table_booking_id` -> `table_bookings(id)`
- `table_id` -> `tables(id)`

**RLS:** No policies found
**Audit columns:** created_at

### `booking_time_slots`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| day_of_week | integer | NO |  |
| slot_time | time without time zone | NO |  |
| duration_minutes | integer | YES | 120 |
| max_covers | integer | NO |  |
| booking_type | enum | YES |  |
| is_active | boolean | YES | true |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |

**RLS:** Enabled, 2 policies (ALL, SELECT)
**Audit columns:** created_at, updated_at

### `bookings`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| customer_id | uuid | NO |  |
| event_id | uuid | NO |  |
| seats | integer | YES |  |
| created_at | timestamptz | NO | now() |
| notes | text | YES |  |
| booking_source | text | YES | 'direct_booking'::text |
| last_reminder_sent | timestamptz | YES |  |
| is_reminder_only | boolean | NO | false |
| status | text | NO | 'confirmed'::text |
| source | text | NO | 'brand_site'::text |
| updated_at | timestamptz | YES | now() |
| cancelled_at | timestamptz | YES |  |
| cancelled_by | text | YES |  |
| expired_at | timestamptz | YES |  |
| hold_expires_at | timestamptz | YES |  |
| review_sms_sent_at | timestamptz | YES |  |
| review_clicked_at | timestamptz | YES |  |
| review_window_closes_at | timestamptz | YES |  |
| completed_at | timestamptz | YES |  |
| review_suppressed_at | timestamptz | YES |  |

**Foreign Keys:**
- `customer_id` -> `customers(id)`
- `event_id` -> `events(id)`

**RLS:** Enabled, 4 policies (DELETE, INSERT, SELECT, UPDATE)
**Audit columns:** created_at, updated_at

### `pending_bookings`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| token | uuid | NO |  |
| event_id | uuid | NO |  |
| mobile_number | varchar | NO |  |
| customer_id | uuid | YES |  |
| seats | integer | YES |  |
| expires_at | timestamptz | NO |  |
| confirmed_at | timestamptz | YES |  |
| booking_id | uuid | YES |  |
| initiated_by_api_key | uuid | YES |  |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |
| metadata | jsonb | YES |  |

**Foreign Keys:**
- `booking_id` -> `bookings(id)`
- `customer_id` -> `customers(id)`
- `event_id` -> `events(id)`
- `initiated_by_api_key` -> `api_keys(id)`

**RLS:** Enabled, 2 policies (ALL, SELECT)
**Audit columns:** created_at, updated_at

### `sunday_lunch_menu_items`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| name | varchar | NO |  |
| description | text | YES |  |
| price | numeric | NO |  |
| category | varchar | NO |  |
| is_active | boolean | YES | true |
| display_order | integer | NO | 0 |
| allergens | ARRAY | YES | '{}'::text[] |
| dietary_info | ARRAY | YES | '{}'::text[] |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |

**RLS:** Enabled, 4 policies (ALL, SELECT)
**Audit columns:** created_at, updated_at

### `table_booking_items`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| booking_id | uuid | NO |  |
| menu_item_id | uuid | YES |  |
| custom_item_name | varchar | YES |  |
| quantity | integer | NO | 1 |
| special_requests | text | YES |  |
| price_at_booking | numeric | NO |  |
| guest_name | varchar | YES |  |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |
| item_type | enum | NO | 'main'::booking_item_type |
| menu_dish_id | uuid | YES |  |

**Foreign Keys:**
- `booking_id` -> `table_bookings(id)`
- `menu_dish_id` -> `menu_dishes(id)`

**RLS:** Enabled, 1 policies (ALL)
**Audit columns:** created_at, updated_at

### `table_booking_modifications`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| booking_id | uuid | NO |  |
| modified_by | uuid | YES |  |
| modification_type | varchar | NO |  |
| old_values | jsonb | YES |  |
| new_values | jsonb | YES |  |
| created_at | timestamptz | YES | now() |

**Foreign Keys:**
- `booking_id` -> `table_bookings(id)`

**RLS:** Enabled, 2 policies (INSERT, SELECT)
**Audit columns:** created_at

### `table_booking_payments`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| booking_id | uuid | NO |  |
| payment_method | varchar | NO | 'paypal'::character varying |
| transaction_id | varchar | YES |  |
| amount | numeric | NO |  |
| currency | varchar | YES | 'GBP'::character varying |
| status | enum | NO | 'pending'::payment_status |
| refund_amount | numeric | YES |  |
| refund_transaction_id | varchar | YES |  |
| payment_metadata | jsonb | YES |  |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |
| paid_at | timestamptz | YES |  |
| refunded_at | timestamptz | YES |  |

**Foreign Keys:**
- `booking_id` -> `table_bookings(id)`

**RLS:** Enabled, 2 policies (ALL, SELECT)
**Audit columns:** created_at, updated_at

### `table_booking_reminder_history`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| booking_id | uuid | NO |  |
| reminder_type | varchar | NO |  |
| sent_at | timestamptz | YES | now() |
| status | varchar | NO |  |
| error_message | text | YES |  |
| metadata | jsonb | YES |  |
| created_at | timestamptz | YES | now() |

**Foreign Keys:**
- `booking_id` -> `table_bookings(id)`

**RLS:** Enabled, 2 policies (INSERT, SELECT)
**Audit columns:** created_at

### `table_booking_sms_templates`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| template_key | varchar | NO |  |
| booking_type | enum | YES |  |
| template_text | text | NO |  |
| variables | ARRAY | YES |  |
| is_active | boolean | YES | true |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |

**RLS:** Enabled, 2 policies (ALL, SELECT)
**Audit columns:** created_at, updated_at

### `table_bookings`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| booking_reference | varchar | NO |  |
| customer_id | uuid | YES |  |
| booking_date | date | NO |  |
| booking_time | time without time zone | NO |  |
| party_size | integer | NO |  |
| tables_assigned | jsonb | YES |  |
| booking_type | enum | NO |  |
| status | enum | NO | 'pending_payment'::table_booking_status |
| duration_minutes | integer | YES | 120 |
| special_requirements | text | YES |  |
| dietary_requirements | ARRAY | YES |  |
| allergies | ARRAY | YES |  |
| celebration_type | varchar | YES |  |
| internal_notes | text | YES |  |
| source | varchar | YES | 'website'::character varying |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |
| confirmed_at | timestamptz | YES |  |
| cancelled_at | timestamptz | YES |  |
| cancellation_reason | text | YES |  |
| completed_at | timestamptz | YES |  |
| no_show_at | timestamptz | YES |  |
| modification_count | integer | YES | 0 |
| original_booking_data | jsonb | YES |  |
| email_verification_token | uuid | YES |  |
| email_verified_at | timestamptz | YES |  |
| reminder_sent | boolean | YES | false |
| correlation_id | uuid | YES | gen_random_uuid() |
| payment_method | enum | YES |  |
| payment_status | enum | YES | 'pending'::payment_status |
| booking_purpose | text | NO | 'food'::text |
| committed_party_size | integer | NO |  |
| hold_expires_at | timestamptz | YES |  |
| card_capture_completed_at | timestamptz | YES |  |
| no_show_marked_at | timestamptz | YES |  |
| no_show_marked_by | uuid | YES |  |
| left_at | timestamptz | YES |  |
| review_sms_sent_at | timestamptz | YES |  |
| review_clicked_at | timestamptz | YES |  |
| sunday_preorder_cutoff_at | timestamptz | YES |  |
| sunday_preorder_completed_at | timestamptz | YES |  |
| start_datetime | timestamptz | YES |  |
| end_datetime | timestamptz | YES |  |
| seated_at | timestamptz | YES |  |
| event_id | uuid | YES |  |
| event_booking_id | uuid | YES |  |
| cancelled_by | text | YES |  |
| deposit_waived | boolean | NO | false |
| is_venue_event | boolean | NO | false |
| paypal_deposit_order_id | text | YES |  |
| paypal_deposit_capture_id | text | YES |  |
| deposit_amount | numeric | YES |  |
| review_suppressed_at | timestamptz | YES |  |
| deposit_refund_status | text | YES |  |
| deposit_amount_locked | numeric | YES |  |

**Foreign Keys:**
- `customer_id` -> `customers(id)`
- `event_id` -> `events(id)`
- `event_booking_id` -> `bookings(id)`

**RLS:** Enabled, 4 policies (DELETE, INSERT, SELECT, UPDATE)
**Audit columns:** created_at, updated_at

### `table_join_group_members`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| group_id | uuid | NO |  |
| table_id | uuid | NO |  |

**Foreign Keys:**
- `group_id` -> `table_join_groups(id)`
- `table_id` -> `tables(id)`

**RLS:** Enabled, 2 policies (ALL, SELECT)

### `table_join_groups`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| name | text | NO |  |
| created_at | timestamptz | NO | now() |

**RLS:** Enabled, 2 policies (ALL, SELECT)
**Audit columns:** created_at

### `table_join_links`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| table_id | uuid | NO |  |
| join_table_id | uuid | NO |  |
| created_at | timestamptz | NO | now() |
| created_by | uuid | YES |  |

**Foreign Keys:**
- `table_id` -> `tables(id)`
- `join_table_id` -> `tables(id)`

**RLS:** No policies found
**Audit columns:** created_at, created_by

### `waitlist_entries`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| event_id | uuid | NO |  |
| customer_id | uuid | NO |  |
| requested_seats | integer | NO |  |
| status | text | NO | 'queued'::text |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |
| offered_at | timestamptz | YES |  |
| accepted_at | timestamptz | YES |  |
| expired_at | timestamptz | YES |  |
| cancelled_at | timestamptz | YES |  |

**Foreign Keys:**
- `event_id` -> `events(id)`
- `customer_id` -> `customers(id)`

**RLS:** No policies found
**Audit columns:** created_at, updated_at

### `waitlist_offers`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| waitlist_entry_id | uuid | NO |  |
| event_id | uuid | NO |  |
| customer_id | uuid | NO |  |
| seats_held | integer | NO |  |
| status | text | NO | 'sent'::text |
| scheduled_sms_send_time | timestamptz | YES |  |
| sent_at | timestamptz | YES |  |
| accepted_at | timestamptz | YES |  |
| expired_at | timestamptz | YES |  |
| expires_at | timestamptz | NO |  |
| created_at | timestamptz | NO | now() |

**Foreign Keys:**
- `waitlist_entry_id` -> `waitlist_entries(id)`
- `event_id` -> `events(id)`
- `customer_id` -> `customers(id)`

**RLS:** No policies found
**Audit columns:** created_at

---
## Tables & Venue

### `business_amenities`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| type | varchar | NO |  |
| available | boolean | YES | true |
| details | text | YES |  |
| capacity | integer | YES |  |
| additional_info | jsonb | YES | '{}'::jsonb |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |

**RLS:** Enabled, 1 policies (SELECT)
**Audit columns:** created_at, updated_at

### `business_hours`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| day_of_week | integer | NO |  |
| opens | time without time zone | YES |  |
| closes | time without time zone | YES |  |
| kitchen_opens | time without time zone | YES |  |
| kitchen_closes | time without time zone | YES |  |
| is_closed | boolean | YES | false |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |
| is_kitchen_closed | boolean | YES | false |
| schedule_config | jsonb | YES | '[]'::jsonb |

**RLS:** Enabled, 2 policies (ALL, SELECT)
**Audit columns:** created_at, updated_at

### `service_slot_config`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| day_of_week | integer | NO |  |
| slot_type | varchar | NO |  |
| starts_at | time without time zone | NO |  |
| ends_at | time without time zone | NO |  |
| capacity | integer | NO | 50 |
| booking_type | enum | NO |  |
| is_active | boolean | YES | true |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |

**RLS:** Enabled, 2 policies (ALL, SELECT)
**Audit columns:** created_at, updated_at

### `service_slot_overrides`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| override_date | date | NO |  |
| reason | varchar | YES |  |
| is_closed | boolean | YES | false |
| custom_capacity | integer | YES |  |
| custom_hours | jsonb | YES |  |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |

**RLS:** Enabled, 2 policies (ALL, SELECT)
**Audit columns:** created_at, updated_at

### `service_slots`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| service_date | date | NO |  |
| starts_at | time without time zone | NO |  |
| ends_at | time without time zone | NO |  |
| capacity | integer | NO |  |
| booking_type | enum | NO |  |
| is_active | boolean | NO | true |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |

**RLS:** Enabled, 2 policies (ALL, SELECT)
**Audit columns:** created_at, updated_at

### `service_status_overrides`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| service_code | text | NO |  |
| start_date | date | NO |  |
| end_date | date | NO |  |
| is_enabled | boolean | NO | false |
| message | text | YES |  |
| created_by | uuid | YES |  |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |

**Foreign Keys:**
- `service_code` -> `service_statuses(service_code)`

**RLS:** Enabled, 1 policies (ALL)
**Audit columns:** created_by, created_at, updated_at

### `service_statuses`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| service_code | text | NO |  |
| display_name | text | NO |  |
| is_enabled | boolean | NO | true |
| message | text | YES |  |
| metadata | jsonb | NO | '{}'::jsonb |
| updated_by | uuid | YES |  |
| updated_at | timestamptz | NO | now() |

**RLS:** Enabled, 1 policies (ALL)
**Audit columns:** updated_by, updated_at

### `sites`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| name | text | NO |  |
| created_at | timestamptz | NO | now() |
| phone | text | YES |  |
| email | text | YES |  |
| website | text | YES |  |
| address | text | YES |  |
| online_bookings_enabled | boolean | NO | true |
| sms_notifications_enabled | boolean | NO | true |
| auto_confirm_bookings | boolean | NO | false |
| default_party_size | integer | NO | 2 |
| booking_duration_mins | integer | NO | 90 |
| advance_booking_days | integer | NO | 30 |
| deposit_amount | numeric | NO | 10.00 |
| min_group_size_deposit | integer | NO | 7 |
| currency | text | NO | 'GBP'::text |
| reminder_hours_before | integer | NO | 24 |
| admin_email | text | YES |  |
| cc_email | text | YES |  |
| updated_at | timestamptz | NO | now() |

**RLS:** Enabled, 1 policies (SELECT)
**Audit columns:** created_at, updated_at

### `special_hours`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| date | date | NO |  |
| opens | time without time zone | YES |  |
| closes | time without time zone | YES |  |
| kitchen_opens | time without time zone | YES |  |
| kitchen_closes | time without time zone | YES |  |
| is_closed | boolean | YES | false |
| note | text | YES |  |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |
| is_kitchen_closed | boolean | YES | false |
| schedule_config | jsonb | YES | '[]'::jsonb |

**RLS:** Enabled, 2 policies (ALL, SELECT)
**Audit columns:** created_at, updated_at

### `table_areas`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| name | text | NO |  |
| normalized_name | text | NO |  |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |

**RLS:** No policies found
**Audit columns:** created_at, updated_at

### `table_combination_tables`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| combination_id | uuid | NO |  |
| table_id | uuid | NO |  |
| created_at | timestamptz | YES | now() |

**Foreign Keys:**
- `combination_id` -> `table_combinations(id)`
- `table_id` -> `table_configuration(id)`

**RLS:** Enabled, 2 policies (ALL, SELECT)
**Audit columns:** created_at

### `table_combinations`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| name | varchar | YES |  |
| table_ids | ARRAY | NO |  |
| total_capacity | integer | NO |  |
| preferred_for_size | ARRAY | YES |  |
| is_active | boolean | YES | true |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |

**RLS:** Enabled, 2 policies (ALL, SELECT)
**Audit columns:** created_at, updated_at

### `table_configuration`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| table_number | varchar | NO |  |
| capacity | integer | NO |  |
| is_active | boolean | YES | true |
| notes | text | YES |  |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |

**RLS:** Enabled, 2 policies (ALL, SELECT)
**Audit columns:** created_at, updated_at

### `tables`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| table_number | varchar | NO |  |
| capacity | integer | NO |  |
| is_active | boolean | YES | true |
| notes | text | YES |  |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |
| name | text | YES |  |
| is_bookable | boolean | NO | true |
| area | text | YES |  |
| area_id | uuid | YES |  |

**Foreign Keys:**
- `area_id` -> `table_areas(id)`

**RLS:** Enabled, 2 policies (ALL, SELECT)
**Audit columns:** created_at, updated_at

### `venue_space_table_areas`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| venue_space_id | uuid | NO |  |
| table_area_id | uuid | NO |  |
| created_at | timestamptz | NO | now() |

**Foreign Keys:**
- `venue_space_id` -> `venue_spaces(id)`
- `table_area_id` -> `table_areas(id)`

**RLS:** No policies found
**Audit columns:** created_at

### `venue_spaces`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| name | text | NO |  |
| description | text | YES |  |
| capacity_seated | integer | YES |  |
| capacity_standing | integer | YES |  |
| rate_per_hour | numeric | NO |  |
| minimum_hours | integer | YES | 2 |
| setup_fee | numeric | YES | 0 |
| active | boolean | YES | true |
| display_order | integer | YES | 0 |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |

**RLS:** Enabled, 2 policies (ALL, SELECT)
**Audit columns:** created_at, updated_at

---
## Events & Performers

### `event_categories`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | uuid_generate_v4() |
| name | varchar | NO |  |
| description | text | YES |  |
| color | varchar | NO | '#6B7280'::character varying |
| icon | varchar | YES | 'CalendarIcon'::character varying |
| default_start_time | time without time zone | YES |  |
| default_capacity | integer | YES |  |
| default_reminder_hours | integer | YES | 24 |
| sort_order | integer | YES | 0 |
| is_active | boolean | YES | true |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |
| is_default | boolean | YES | false |
| default_end_time | time without time zone | YES |  |
| default_price | numeric | YES | 0 |
| default_is_free | boolean | YES | false |
| default_performer_type | varchar | YES |  |
| default_event_status | varchar | YES | 'scheduled'::character varying |
| slug | varchar | NO |  |
| meta_description | text | YES |  |
| default_image_url | text | YES |  |
| short_description | text | YES |  |
| long_description | text | YES |  |
| highlights | jsonb | YES | '[]'::jsonb |
| meta_title | varchar | YES |  |
| keywords | jsonb | YES | '[]'::jsonb |
| gallery_image_urls | jsonb | YES | '[]'::jsonb |
| poster_image_url | text | YES |  |
| thumbnail_image_url | text | YES |  |
| promo_video_url | text | YES |  |
| highlight_video_urls | jsonb | YES | '[]'::jsonb |
| default_duration_minutes | integer | YES |  |
| default_doors_time | varchar | YES |  |
| default_last_entry_time | varchar | YES |  |
| default_booking_url | text | YES |  |
| faqs | jsonb | YES | '[]'::jsonb |
| default_performer_name | varchar | YES |  |
| primary_keywords | jsonb | YES | '[]'::jsonb |
| secondary_keywords | jsonb | YES | '[]'::jsonb |
| local_seo_keywords | jsonb | YES | '[]'::jsonb |
| image_alt_text | text | YES |  |
| cancellation_policy | text | YES |  |
| accessibility_notes | text | YES |  |
| default_promo_sms_enabled | boolean | NO | true |
| default_bookings_enabled | boolean | NO | true |

**RLS:** Enabled, 2 policies (ALL, SELECT)
**Audit columns:** created_at, updated_at

### `event_check_ins`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| event_id | uuid | YES |  |
| customer_id | uuid | YES |  |
| member_id | uuid | YES |  |
| booking_id | uuid | YES |  |
| check_in_time | timestamptz | YES | now() |
| check_in_method | varchar | YES | 'qr'::character varying |
| points_earned | integer | YES | 0 |
| staff_id | uuid | YES |  |
| created_at | timestamptz | YES | now() |

**Foreign Keys:**
- `booking_id` -> `bookings(id)`
- `customer_id` -> `customers(id)`
- `event_id` -> `events(id)`
- `member_id` -> `loyalty_members(id)`
- `staff_id` -> `auth.users(id)`

**RLS:** Enabled, 4 policies (ALL, SELECT)
**Audit columns:** created_at

### `event_checklist_statuses`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| event_id | uuid | NO |  |
| task_key | text | NO |  |
| completed_at | timestamptz | YES |  |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |

**Foreign Keys:**
- `event_id` -> `events(id)`

**RLS:** Enabled, 4 policies (DELETE, INSERT, SELECT, UPDATE)
**Audit columns:** created_at, updated_at

### `event_faqs`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| event_id | uuid | NO |  |
| question | text | NO |  |
| answer | text | NO |  |
| sort_order | integer | YES | 0 |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |

**Foreign Keys:**
- `event_id` -> `events(id)`

**RLS:** Enabled, 2 policies (ALL, SELECT)
**Audit columns:** created_at, updated_at

### `event_images`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| event_id | uuid | NO |  |
| storage_path | text | NO |  |
| file_name | text | NO |  |
| mime_type | text | NO |  |
| file_size_bytes | integer | NO |  |
| image_type | text | NO |  |
| display_order | integer | YES | 0 |
| alt_text | text | YES |  |
| caption | text | YES |  |
| uploaded_by | uuid | YES |  |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |

**Foreign Keys:**
- `event_id` -> `events(id)`
- `uploaded_by` -> `auth.users(id)`

**RLS:** Enabled, 4 policies (DELETE, INSERT, SELECT, UPDATE)
**Audit columns:** created_at, updated_at

### `event_interest_manual_recipients`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| event_id | uuid | NO |  |
| customer_id | uuid | NO |  |
| created_at | timestamptz | NO | now() |
| reminder_14d_sent_at | timestamptz | YES |  |
| reminder_7d_sent_at | timestamptz | YES |  |
| reminder_1d_sent_at | timestamptz | YES |  |

**Foreign Keys:**
- `event_id` -> `events(id)`
- `customer_id` -> `customers(id)`

**RLS:** No policies found
**Audit columns:** created_at

### `event_message_templates`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| created_at | timestamptz | NO | now() |
| event_id | uuid | NO |  |
| template_type | text | NO |  |
| content | text | NO |  |
| variables | ARRAY | YES | '{}'::text[] |
| is_active | boolean | YES | true |
| character_count | integer | YES |  |
| estimated_segments | integer | YES |  |
| send_timing | text | YES | 'immediate'::text |
| custom_timing_hours | integer | YES |  |

**Foreign Keys:**
- `event_id` -> `events(id)`

**RLS:** Enabled, 2 policies (ALL, SELECT)
**Audit columns:** created_at

### `events`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| name | text | NO |  |
| date | date | NO |  |
| time | text | NO |  |
| created_at | timestamptz | NO | now() |
| capacity | integer | YES |  |
| category_id | uuid | YES |  |
| end_time | time without time zone | YES |  |
| event_status | varchar | YES | 'scheduled'::character varying |
| performer_name | varchar | YES |  |
| performer_type | varchar | YES |  |
| price | numeric | YES | 0 |
| is_free | boolean | YES | true |
| booking_url | text | YES |  |
| slug | varchar | NO |  |
| short_description | text | YES |  |
| long_description | text | YES |  |
| highlights | jsonb | YES | '[]'::jsonb |
| meta_title | varchar | YES |  |
| meta_description | text | YES |  |
| keywords | jsonb | YES | '[]'::jsonb |
| hero_image_url | text | YES |  |
| gallery_image_urls | jsonb | YES | '[]'::jsonb |
| poster_image_url | text | YES |  |
| thumbnail_image_url | text | YES |  |
| promo_video_url | text | YES |  |
| highlight_video_urls | jsonb | YES | '[]'::jsonb |
| doors_time | time without time zone | YES |  |
| duration_minutes | integer | YES |  |
| last_entry_time | time without time zone | YES |  |
| brief | text | YES |  |
| facebook_event_name | text | YES |  |
| facebook_event_description | text | YES |  |
| gbp_event_title | text | YES |  |
| gbp_event_description | text | YES |  |
| opentable_experience_title | text | YES |  |
| opentable_experience_description | text | YES |  |
| start_datetime | timestamptz | YES |  |
| payment_mode | text | NO | 'free'::text |
| price_per_seat | numeric | YES |  |
| booking_open | boolean | NO | true |
| event_type | text | YES |  |
| booking_mode | text | NO | 'table'::text |
| primary_keywords | jsonb | YES | '[]'::jsonb |
| secondary_keywords | jsonb | YES | '[]'::jsonb |
| local_seo_keywords | jsonb | YES | '[]'::jsonb |
| image_alt_text | text | YES |  |
| social_copy_whatsapp | text | YES |  |
| previous_event_summary | text | YES |  |
| attendance_note | text | YES |  |
| cancellation_policy | text | YES |  |
| accessibility_notes | text | YES |  |
| promo_sms_enabled | boolean | NO | true |
| bookings_enabled | boolean | NO | true |

**Foreign Keys:**
- `category_id` -> `event_categories(id)`

**RLS:** Enabled, 5 policies (DELETE, INSERT, SELECT, UPDATE)
**Audit columns:** created_at

### `performer_submissions`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |
| full_name | text | NO |  |
| email | text | NO |  |
| phone | text | NO |  |
| bio | text | NO |  |
| consent_data_storage | boolean | NO |  |
| status | enum | NO | 'new'::performer_submission_status |
| internal_notes | text | YES |  |
| source | text | NO | 'website_open_mic'::text |
| submitted_ip | text | YES |  |
| user_agent | text | YES |  |

**RLS:** Enabled, 4 policies (DELETE, INSERT, SELECT, UPDATE)
**Audit columns:** created_at, updated_at

---
## Rota & Timeclock

### `jobs`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| type | varchar | NO |  |
| payload | jsonb | NO | '{}'::jsonb |
| status | varchar | YES | 'pending'::character varying |
| attempts | integer | YES | 0 |
| max_attempts | integer | YES | 3 |
| scheduled_for | timestamptz | YES | now() |
| started_at | timestamptz | YES |  |
| completed_at | timestamptz | YES |  |
| failed_at | timestamptz | YES |  |
| error_message | text | YES |  |
| result | jsonb | YES |  |
| priority | integer | YES | 0 |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |
| processing_token | uuid | YES |  |
| lease_expires_at | timestamptz | YES |  |
| last_heartbeat_at | timestamptz | YES |  |

**RLS:** Enabled, 1 policies (ALL)
**Audit columns:** created_at, updated_at

### `leave_days`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| request_id | uuid | NO |  |
| employee_id | uuid | NO |  |
| leave_date | date | NO |  |
| created_at | timestamptz | NO | now() |

**Foreign Keys:**
- `request_id` -> `leave_requests(id)`
- `employee_id` -> `employees(employee_id)`

**RLS:** Enabled, 1 policies (ALL)
**Audit columns:** created_at

### `leave_requests`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| employee_id | uuid | NO |  |
| start_date | date | NO |  |
| end_date | date | NO |  |
| note | text | YES |  |
| status | text | NO | 'pending'::text |
| manager_note | text | YES |  |
| reviewed_by | uuid | YES |  |
| reviewed_at | timestamptz | YES |  |
| holiday_year | smallint | NO |  |
| created_by | uuid | YES |  |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |

**Foreign Keys:**
- `employee_id` -> `employees(employee_id)`
- `reviewed_by` -> `auth.users(id)`
- `created_by` -> `auth.users(id)`

**RLS:** Enabled, 1 policies (ALL)
**Audit columns:** created_by, created_at, updated_at

### `rota_email_log`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| email_type | text | NO |  |
| entity_type | text | YES |  |
| entity_id | uuid | YES |  |
| to_addresses | ARRAY | NO |  |
| cc_addresses | ARRAY | YES |  |
| subject | text | NO |  |
| status | text | NO |  |
| error_message | text | YES |  |
| message_id | text | YES |  |
| sent_by | uuid | YES |  |
| sent_at | timestamptz | NO | now() |
| created_at | timestamptz | NO | now() |

**Foreign Keys:**
- `sent_by` -> `auth.users(id)`

**RLS:** Enabled, 1 policies (ALL)
**Audit columns:** created_at

### `rota_google_calendar_events`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| shift_id | uuid | NO |  |
| week_id | uuid | NO |  |
| google_event_id | text | NO |  |
| updated_at | timestamptz | YES | now() |

**RLS:** No policies found
**Audit columns:** updated_at

### `rota_published_shifts`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO |  |
| week_id | uuid | NO |  |
| employee_id | uuid | YES |  |
| shift_date | date | NO |  |
| start_time | time without time zone | NO |  |
| end_time | time without time zone | NO |  |
| unpaid_break_minutes | smallint | NO | 0 |
| department | text | NO |  |
| status | text | NO | 'scheduled'::text |
| notes | text | YES |  |
| is_overnight | boolean | NO | false |
| is_open_shift | boolean | NO | false |
| name | text | YES |  |
| published_at | timestamptz | NO | now() |

**Foreign Keys:**
- `employee_id` -> `employees(employee_id)`
- `week_id` -> `rota_weeks(id)`

**RLS:** Enabled, 1 policies (SELECT)

### `rota_shift_templates`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| name | text | NO |  |
| start_time | time without time zone | NO |  |
| end_time | time without time zone | NO |  |
| unpaid_break_minutes | smallint | NO | 0 |
| department | text | NO |  |
| colour | text | YES |  |
| is_active | boolean | NO | true |
| created_by | uuid | YES |  |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |
| day_of_week | smallint | YES |  |
| employee_id | uuid | YES |  |

**Foreign Keys:**
- `created_by` -> `auth.users(id)`
- `employee_id` -> `employees(employee_id)`

**RLS:** Enabled, 1 policies (ALL)
**Audit columns:** created_by, created_at, updated_at

### `rota_shifts`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| week_id | uuid | NO |  |
| employee_id | uuid | YES |  |
| template_id | uuid | YES |  |
| shift_date | date | NO |  |
| start_time | time without time zone | NO |  |
| end_time | time without time zone | NO |  |
| unpaid_break_minutes | smallint | NO | 0 |
| department | text | NO |  |
| status | text | NO | 'scheduled'::text |
| notes | text | YES |  |
| is_overnight | boolean | NO | false |
| original_employee_id | uuid | YES |  |
| reassigned_from_id | uuid | YES |  |
| reassigned_at | timestamptz | YES |  |
| reassigned_by | uuid | YES |  |
| reassignment_reason | text | YES |  |
| created_by | uuid | YES |  |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |
| is_open_shift | boolean | NO | false |
| name | text | YES |  |

**Foreign Keys:**
- `week_id` -> `rota_weeks(id)`
- `employee_id` -> `employees(employee_id)`
- `template_id` -> `rota_shift_templates(id)`
- `original_employee_id` -> `employees(employee_id)`
- `reassigned_from_id` -> `employees(employee_id)`
- `reassigned_by` -> `auth.users(id)`
- `created_by` -> `auth.users(id)`

**RLS:** Enabled, 1 policies (ALL)
**Audit columns:** created_by, created_at, updated_at

### `rota_weeks`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| week_start | date | NO |  |
| status | text | NO | 'draft'::text |
| published_at | timestamptz | YES |  |
| published_by | uuid | YES |  |
| has_unpublished_changes | boolean | NO | false |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |

**Foreign Keys:**
- `published_by` -> `auth.users(id)`

**RLS:** Enabled, 1 policies (ALL)
**Audit columns:** created_at, updated_at

### `timeclock_sessions`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| employee_id | uuid | NO |  |
| work_date | date | NO |  |
| clock_in_at | timestamptz | NO |  |
| clock_out_at | timestamptz | YES |  |
| linked_shift_id | uuid | YES |  |
| is_unscheduled | boolean | NO | false |
| is_auto_close | boolean | NO | false |
| auto_close_reason | text | YES |  |
| is_reviewed | boolean | NO | false |
| reviewed_by | uuid | YES |  |
| reviewed_at | timestamptz | YES |  |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |
| notes | text | YES |  |
| manager_note | text | YES |  |

**Foreign Keys:**
- `employee_id` -> `employees(employee_id)`
- `linked_shift_id` -> `rota_shifts(id)`
- `reviewed_by` -> `auth.users(id)`

**RLS:** Enabled, 3 policies (ALL, INSERT, SELECT)
**Audit columns:** created_at, updated_at

---
## Payroll

### `department_budgets`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| department | text | NO |  |
| budget_year | smallint | NO |  |
| annual_hours | numeric | NO |  |
| created_by | uuid | YES |  |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |

**Foreign Keys:**
- `created_by` -> `auth.users(id)`

**RLS:** Enabled, 1 policies (ALL)
**Audit columns:** created_by, created_at, updated_at

### `departments`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| name | text | NO |  |
| label | text | NO |  |
| sort_order | integer | NO | 0 |
| created_at | timestamptz | NO | now() |

**RLS:** Enabled, 2 policies (ALL, SELECT)
**Audit columns:** created_at

### `pay_age_bands`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| label | text | NO |  |
| min_age | smallint | NO |  |
| max_age | smallint | YES |  |
| is_active | boolean | NO | true |
| sort_order | smallint | NO | 0 |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |

**RLS:** Enabled, 1 policies (ALL)
**Audit columns:** created_at, updated_at

### `pay_band_rates`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| band_id | uuid | NO |  |
| hourly_rate | numeric | NO |  |
| effective_from | date | NO |  |
| created_by | uuid | YES |  |
| created_at | timestamptz | NO | now() |

**Foreign Keys:**
- `band_id` -> `pay_age_bands(id)`
- `created_by` -> `auth.users(id)`

**RLS:** Enabled, 1 policies (ALL)
**Audit columns:** created_by, created_at

### `payroll_month_approvals`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| year | smallint | NO |  |
| month | smallint | NO |  |
| approved_at | timestamptz | NO | now() |
| approved_by | uuid | NO |  |
| snapshot | jsonb | NO |  |
| email_sent_at | timestamptz | YES |  |
| email_sent_by | uuid | YES |  |

**Foreign Keys:**
- `approved_by` -> `auth.users(id)`
- `email_sent_by` -> `auth.users(id)`

**RLS:** Enabled, 1 policies (ALL)

### `payroll_periods`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| year | smallint | NO |  |
| month | smallint | NO |  |
| period_start | date | NO |  |
| period_end | date | NO |  |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |

**RLS:** Enabled, 1 policies (ALL)
**Audit columns:** created_at, updated_at

---
## Invoices

### `credit_notes`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| credit_note_number | text | NO |  |
| invoice_id | uuid | NO |  |
| vendor_id | uuid | NO |  |
| amount_ex_vat | numeric | NO |  |
| vat_rate | numeric | NO | 20 |
| amount_inc_vat | numeric | NO |  |
| reason | text | NO |  |
| status | text | NO | 'issued'::text |
| created_at | timestamptz | NO | now() |
| created_by | uuid | NO |  |

**Foreign Keys:**
- `invoice_id` -> `invoices(id)`
- `vendor_id` -> `invoice_vendors(id)`
- `created_by` -> `auth.users(id)`

**RLS:** Enabled, 3 policies (INSERT, SELECT, UPDATE)
**Audit columns:** created_at, created_by

### `invoice_audit`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| invoice_id | uuid | YES |  |
| action | varchar | NO |  |
| performed_by | uuid | YES |  |
| performed_by_email | varchar | YES |  |
| details | jsonb | YES | '{}'::jsonb |
| old_values | jsonb | YES |  |
| new_values | jsonb | YES |  |
| ip_address | inet | YES |  |
| user_agent | text | YES |  |
| created_at | timestamptz | YES | now() |

**Foreign Keys:**
- `performed_by` -> `auth.users(id)`

**RLS:** Enabled, 1 policies (SELECT)
**Audit columns:** created_at

### `invoice_email_logs`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| invoice_id | uuid | YES |  |
| quote_id | uuid | YES |  |
| sent_at | timestamptz | YES | now() |
| sent_to | varchar | YES |  |
| sent_by | varchar | YES |  |
| subject | text | YES |  |
| body | text | YES |  |
| status | varchar | YES |  |
| error_message | text | YES |  |
| message_id | varchar | YES |  |
| created_at | timestamptz | YES | now() |
| payment_id | uuid | YES |  |

**Foreign Keys:**
- `invoice_id` -> `invoices(id)`
- `quote_id` -> `quotes(id)`
- `payment_id` -> `invoice_payments(id)`

**RLS:** Enabled, 1 policies (ALL)
**Audit columns:** created_at

### `invoice_email_templates`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| template_type | varchar | NO |  |
| subject_template | text | NO |  |
| body_template | text | NO |  |
| description | text | YES |  |
| is_active | boolean | YES | true |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |

**RLS:** Enabled, 2 policies (ALL, SELECT)
**Audit columns:** created_at, updated_at

### `invoice_emails`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| invoice_id | uuid | YES |  |
| email_type | varchar | NO |  |
| recipient_email | varchar | NO |  |
| cc_emails | ARRAY | YES |  |
| bcc_emails | ARRAY | YES |  |
| subject | text | NO |  |
| body | text | NO |  |
| attachments | jsonb | YES | '[]'::jsonb |
| message_id | varchar | YES |  |
| sent_at | timestamptz | YES |  |
| error_message | text | YES |  |
| status | varchar | YES | 'pending'::character varying |
| created_by | uuid | YES |  |
| created_at | timestamptz | YES | now() |

**Foreign Keys:**
- `created_by` -> `auth.users(id)`

**RLS:** Enabled, 2 policies (INSERT, SELECT)
**Audit columns:** created_by, created_at

### `invoice_line_items`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| invoice_id | uuid | NO |  |
| catalog_item_id | uuid | YES |  |
| description | text | NO |  |
| quantity | numeric | YES | 1 |
| unit_price | numeric | YES | 0 |
| discount_percentage | numeric | YES | 0 |
| vat_rate | numeric | YES | 20 |
| subtotal_amount | numeric | YES |  |
| discount_amount | numeric | YES |  |
| vat_amount | numeric | YES |  |
| total_amount | numeric | YES |  |
| created_at | timestamptz | YES | now() |

**Foreign Keys:**
- `catalog_item_id` -> `line_item_catalog(id)`
- `invoice_id` -> `invoices(id)`

**RLS:** Enabled, 5 policies (ALL, DELETE, INSERT, SELECT, UPDATE)
**Audit columns:** created_at

### `invoice_payments`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| invoice_id | uuid | NO |  |
| payment_date | date | NO | CURRENT_DATE |
| amount | numeric | NO |  |
| payment_method | varchar | YES |  |
| reference | varchar | YES |  |
| notes | text | YES |  |
| created_at | timestamptz | YES | now() |

**Foreign Keys:**
- `invoice_id` -> `invoices(id)`

**RLS:** Enabled, 5 policies (ALL, DELETE, INSERT, SELECT, UPDATE)
**Audit columns:** created_at

### `invoice_reminder_settings`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| enabled | boolean | YES | true |
| reminder_email | varchar | YES | 'peter@orangejelly.co.uk'::character ... |
| days_before_due | ARRAY | YES | ARRAY[7, 3, 1] |
| days_after_due | ARRAY | YES | ARRAY[1, 7, 14, 30] |
| reminder_time | time without time zone | YES | '09:00:00'::time without time zone |
| exclude_vendors | ARRAY | YES | '{}'::uuid[] |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |

**RLS:** Enabled, 2 policies (ALL, SELECT)
**Audit columns:** created_at, updated_at

### `invoice_series`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| series_code | varchar | NO |  |
| current_sequence | integer | YES | 0 |
| created_at | timestamptz | YES | now() |

**RLS:** Enabled, 4 policies (DELETE, INSERT, SELECT, UPDATE)
**Audit columns:** created_at

### `invoice_vendor_contacts`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| vendor_id | uuid | NO |  |
| name | text | YES |  |
| email | text | NO |  |
| is_primary | boolean | NO | false |
| created_at | timestamptz | NO | now() |
| phone | text | YES |  |
| role | text | YES |  |
| receive_invoice_copy | boolean | NO | false |

**Foreign Keys:**
- `vendor_id` -> `invoice_vendors(id)`

**RLS:** Enabled, 2 policies (ALL, SELECT)
**Audit columns:** created_at

### `invoice_vendors`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| name | varchar | NO |  |
| contact_name | varchar | YES |  |
| email | varchar | YES |  |
| phone | varchar | YES |  |
| address | text | YES |  |
| vat_number | varchar | YES |  |
| payment_terms | integer | YES | 30 |
| notes | text | YES |  |
| is_active | boolean | YES | true |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |

**RLS:** Enabled, 1 policies (ALL)
**Audit columns:** created_at, updated_at

### `invoices`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| invoice_number | varchar | NO |  |
| vendor_id | uuid | YES |  |
| invoice_date | date | NO | CURRENT_DATE |
| due_date | date | NO |  |
| reference | varchar | YES |  |
| status | varchar | YES | 'draft'::character varying |
| invoice_discount_percentage | numeric | YES | 0 |
| subtotal_amount | numeric | YES | 0 |
| discount_amount | numeric | YES | 0 |
| vat_amount | numeric | YES | 0 |
| total_amount | numeric | YES | 0 |
| paid_amount | numeric | YES | 0 |
| notes | text | YES |  |
| internal_notes | text | YES |  |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |
| deleted_at | timestamptz | YES |  |
| deleted_by | uuid | YES |  |

**Foreign Keys:**
- `vendor_id` -> `invoice_vendors(id)`

**RLS:** Enabled, 5 policies (ALL, DELETE, INSERT, SELECT, UPDATE)
**Audit columns:** created_at, updated_at, deleted_at

### `line_item_catalog`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| name | varchar | NO |  |
| description | text | YES |  |
| default_price | numeric | YES | 0 |
| default_vat_rate | numeric | YES | 20 |
| is_active | boolean | YES | true |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |

**RLS:** Enabled, 1 policies (ALL)
**Audit columns:** created_at, updated_at

### `recurring_invoice_history`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| recurring_invoice_id | uuid | YES |  |
| invoice_id | uuid | YES |  |
| generation_date | timestamptz | YES | now() |
| status | varchar | YES | 'success'::character varying |
| error_message | text | YES |  |
| created_at | timestamptz | YES | now() |

**RLS:** Enabled, 1 policies (SELECT)
**Audit columns:** created_at

### `recurring_invoice_line_items`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| recurring_invoice_id | uuid | NO |  |
| catalog_item_id | uuid | YES |  |
| description | text | NO |  |
| quantity | numeric | YES | 1 |
| unit_price | numeric | YES | 0 |
| discount_percentage | numeric | YES | 0 |
| vat_rate | numeric | YES | 20 |
| created_at | timestamptz | YES | now() |

**Foreign Keys:**
- `catalog_item_id` -> `line_item_catalog(id)`
- `recurring_invoice_id` -> `recurring_invoices(id)`

**RLS:** Enabled, 1 policies (ALL)
**Audit columns:** created_at

### `recurring_invoices`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| vendor_id | uuid | YES |  |
| frequency | varchar | YES |  |
| start_date | date | NO |  |
| end_date | date | YES |  |
| next_invoice_date | date | NO |  |
| days_before_due | integer | YES | 30 |
| reference | varchar | YES |  |
| invoice_discount_percentage | numeric | YES | 0 |
| notes | text | YES |  |
| internal_notes | text | YES |  |
| is_active | boolean | YES | true |
| last_invoice_id | uuid | YES |  |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |

**Foreign Keys:**
- `last_invoice_id` -> `invoices(id)`
- `vendor_id` -> `invoice_vendors(id)`

**RLS:** Enabled, 1 policies (ALL)
**Audit columns:** created_at, updated_at

---
## Receipts & P&L

### `pl_manual_actuals`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| metric_key | text | NO |  |
| timeframe | text | NO |  |
| value | numeric | YES |  |
| updated_at | timestamptz | NO | now() |

**RLS:** Enabled, 2 policies (ALL, SELECT)
**Audit columns:** updated_at

### `pl_targets`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| metric_key | text | NO |  |
| timeframe | text | NO |  |
| target_value | numeric | YES |  |
| updated_at | timestamptz | NO | now() |

**RLS:** Enabled, 2 policies (ALL, SELECT)
**Audit columns:** updated_at

### `receipt_batches`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| uploaded_at | timestamptz | NO | now() |
| uploaded_by | uuid | YES |  |
| original_filename | text | NO |  |
| source_hash | text | YES |  |
| row_count | integer | NO | 0 |
| notes | text | YES |  |
| created_at | timestamptz | NO | now() |

**Foreign Keys:**
- `uploaded_by` -> `auth.users(id)`

**RLS:** Enabled, 1 policies (ALL)
**Audit columns:** created_at

### `receipt_files`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| transaction_id | uuid | NO |  |
| storage_path | text | NO |  |
| file_name | text | NO |  |
| mime_type | text | YES |  |
| file_size_bytes | integer | YES |  |
| uploaded_by | uuid | YES |  |
| uploaded_at | timestamptz | NO | now() |

**Foreign Keys:**
- `transaction_id` -> `receipt_transactions(id)`
- `uploaded_by` -> `auth.users(id)`

**RLS:** Enabled, 1 policies (ALL)

### `receipt_rules`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| name | text | NO |  |
| description | text | YES |  |
| match_description | text | YES |  |
| match_transaction_type | text | YES |  |
| match_direction | text | NO | 'both'::text |
| match_min_amount | numeric | YES |  |
| match_max_amount | numeric | YES |  |
| auto_status | enum | NO | 'no_receipt_required'::receipt_transa... |
| is_active | boolean | NO | true |
| created_by | uuid | YES |  |
| updated_by | uuid | YES |  |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |
| set_vendor_name | text | YES |  |
| set_expense_category | text | YES |  |

**Foreign Keys:**
- `created_by` -> `auth.users(id)`
- `updated_by` -> `auth.users(id)`

**RLS:** Enabled, 1 policies (ALL)
**Audit columns:** created_by, updated_by, created_at, updated_at

### `receipt_transaction_logs`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| transaction_id | uuid | NO |  |
| previous_status | enum | YES |  |
| new_status | enum | YES |  |
| action_type | text | NO |  |
| note | text | YES |  |
| performed_by | uuid | YES |  |
| rule_id | uuid | YES |  |
| performed_at | timestamptz | NO | now() |

**Foreign Keys:**
- `performed_by` -> `auth.users(id)`
- `rule_id` -> `receipt_rules(id)`
- `transaction_id` -> `receipt_transactions(id)`

**RLS:** Enabled, 1 policies (ALL)

### `receipt_transactions`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| batch_id | uuid | YES |  |
| transaction_date | date | NO |  |
| details | text | NO |  |
| transaction_type | text | YES |  |
| amount_in | numeric | YES |  |
| amount_out | numeric | YES |  |
| balance | numeric | YES |  |
| dedupe_hash | text | NO |  |
| status | enum | NO | 'pending'::receipt_transaction_status |
| receipt_required | boolean | NO | true |
| marked_by | uuid | YES |  |
| marked_by_email | text | YES |  |
| marked_by_name | text | YES |  |
| marked_at | timestamptz | YES |  |
| marked_method | text | YES |  |
| rule_applied_id | uuid | YES |  |
| notes | text | YES |  |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |
| vendor_name | text | YES |  |
| vendor_source | text | YES |  |
| vendor_rule_id | uuid | YES |  |
| vendor_updated_at | timestamptz | YES |  |
| expense_category | text | YES |  |
| expense_category_source | text | YES |  |
| expense_rule_id | uuid | YES |  |
| expense_updated_at | timestamptz | YES |  |
| amount_total | numeric | YES |  |
| ai_confidence | smallint | YES |  |
| ai_suggested_keywords | text | YES |  |

**Foreign Keys:**
- `batch_id` -> `receipt_batches(id)`
- `expense_rule_id` -> `receipt_rules(id)`
- `marked_by` -> `auth.users(id)`
- `rule_applied_id` -> `receipt_rules(id)`
- `vendor_rule_id` -> `receipt_rules(id)`

**RLS:** Enabled, 1 policies (ALL)
**Audit columns:** created_at, updated_at

### `reconciliation_notes`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| entity_type | text | NO |  |
| entity_id | uuid | NO |  |
| note | text | NO |  |
| created_by | uuid | NO |  |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |

**Foreign Keys:**
- `created_by` -> `auth.users(id)`

**RLS:** Enabled, 1 policies (ALL)
**Audit columns:** created_by, created_at, updated_at

---
## Expenses & Mileage

### `expense_files`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| expense_id | uuid | NO |  |
| storage_path | text | NO |  |
| file_name | text | NO |  |
| mime_type | text | NO |  |
| file_size_bytes | integer | YES |  |
| uploaded_by | uuid | YES |  |
| uploaded_at | timestamptz | NO | now() |

**Foreign Keys:**
- `expense_id` -> `expenses(id)`
- `uploaded_by` -> `auth.users(id)`

**RLS:** Enabled, 1 policies (ALL)

### `expenses`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| expense_date | date | NO |  |
| company_ref | text | NO |  |
| justification | text | NO |  |
| amount | numeric | NO |  |
| vat_applicable | boolean | NO | false |
| vat_amount | numeric | NO | 0 |
| notes | text | YES |  |
| created_by | uuid | YES |  |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |

**Foreign Keys:**
- `created_by` -> `auth.users(id)`

**RLS:** Enabled, 1 policies (ALL)
**Audit columns:** created_by, created_at, updated_at

### `mgd_collections`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| collection_date | date | NO |  |
| net_take | numeric | NO |  |
| mgd_amount | numeric | YES |  |
| vat_on_supplier | numeric | NO |  |
| notes | text | YES |  |
| created_by | uuid | YES |  |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |

**Foreign Keys:**
- `created_by` -> `auth.users(id)`

**RLS:** Enabled, 1 policies (ALL)
**Audit columns:** created_by, created_at, updated_at

### `mgd_returns`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| period_start | date | NO |  |
| period_end | date | NO |  |
| total_net_take | numeric | NO | 0 |
| total_mgd | numeric | NO | 0 |
| total_vat_on_supplier | numeric | NO | 0 |
| status | text | NO | 'open'::text |
| submitted_at | timestamptz | YES |  |
| submitted_by | uuid | YES |  |
| date_paid | date | YES |  |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |

**Foreign Keys:**
- `submitted_by` -> `auth.users(id)`

**RLS:** Enabled, 1 policies (ALL)
**Audit columns:** created_at, updated_at

### `mileage_destination_distances`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| from_destination_id | uuid | NO |  |
| to_destination_id | uuid | NO |  |
| miles | numeric | NO |  |
| last_used_at | timestamptz | NO | now() |

**Foreign Keys:**
- `from_destination_id` -> `mileage_destinations(id)`
- `to_destination_id` -> `mileage_destinations(id)`

**RLS:** Enabled, 1 policies (ALL)

### `mileage_destinations`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| name | text | NO |  |
| postcode | text | YES |  |
| is_home_base | boolean | NO | false |
| created_by | uuid | YES |  |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |

**Foreign Keys:**
- `created_by` -> `auth.users(id)`

**RLS:** Enabled, 1 policies (ALL)
**Audit columns:** created_by, created_at, updated_at

### `mileage_trip_legs`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| trip_id | uuid | NO |  |
| leg_order | smallint | NO |  |
| from_destination_id | uuid | NO |  |
| to_destination_id | uuid | NO |  |
| miles | numeric | NO |  |

**Foreign Keys:**
- `trip_id` -> `mileage_trips(id)`
- `from_destination_id` -> `mileage_destinations(id)`
- `to_destination_id` -> `mileage_destinations(id)`

**RLS:** Enabled, 1 policies (ALL)

### `mileage_trips`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| trip_date | date | NO |  |
| description | text | YES |  |
| total_miles | numeric | NO |  |
| miles_at_standard_rate | numeric | NO | 0 |
| miles_at_reduced_rate | numeric | NO | 0 |
| amount_due | numeric | NO |  |
| source | text | NO |  |
| oj_entry_id | uuid | YES |  |
| created_by | uuid | YES |  |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |

**Foreign Keys:**
- `oj_entry_id` -> `oj_entries(id)`
- `created_by` -> `auth.users(id)`

**RLS:** Enabled, 1 policies (ALL)
**Audit columns:** created_by, created_at, updated_at

---
## Payments

### `payment_refunds`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| source_type | text | NO |  |
| source_id | uuid | NO |  |
| paypal_capture_id | text | YES |  |
| paypal_refund_id | text | YES |  |
| paypal_request_id | uuid | YES |  |
| paypal_status | text | YES |  |
| paypal_status_details | text | YES |  |
| refund_method | text | NO |  |
| amount | numeric | NO |  |
| original_amount | numeric | NO |  |
| reason | text | NO |  |
| status | text | NO | 'pending'::text |
| initiated_by | uuid | YES |  |
| initiated_by_type | text | NO | 'staff'::text |
| notification_status | text | YES |  |
| completed_at | timestamptz | YES |  |
| failed_at | timestamptz | YES |  |
| failure_message | text | YES |  |
| created_at | timestamptz | NO | now() |

**Foreign Keys:**
- `initiated_by` -> `auth.users(id)`

**RLS:** Enabled, 1 policies (ALL)
**Audit columns:** created_at

### `payments`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| event_booking_id | uuid | YES |  |
| table_booking_id | uuid | YES |  |
| charge_type | text | NO |  |
| stripe_payment_intent_id | text | YES |  |
| stripe_checkout_session_id | text | YES |  |
| amount | numeric | NO |  |
| currency | text | NO | 'GBP'::text |
| status | text | NO | 'pending'::text |
| metadata | jsonb | NO | '{}'::jsonb |
| created_at | timestamptz | NO | now() |
| refund_amount | numeric | YES |  |
| updated_at | timestamptz | YES | now() |

**Foreign Keys:**
- `event_booking_id` -> `bookings(id)`
- `table_booking_id` -> `table_bookings(id)`

**RLS:** No policies found
**Audit columns:** created_at, updated_at

---
## Messaging

### `feedback`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| event_booking_id | uuid | YES |  |
| table_booking_id | uuid | YES |  |
| private_booking_id | uuid | YES |  |
| rating_overall | integer | YES |  |
| rating_food | integer | YES |  |
| rating_service | integer | YES |  |
| comments | text | YES |  |
| created_at | timestamptz | NO | now() |

**Foreign Keys:**
- `event_booking_id` -> `bookings(id)`
- `table_booking_id` -> `table_bookings(id)`
- `private_booking_id` -> `private_bookings(id)`

**RLS:** No policies found
**Audit columns:** created_at

### `message_delivery_status`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| message_id | uuid | NO |  |
| status | text | NO |  |
| error_code | text | YES |  |
| error_message | text | YES |  |
| created_at | timestamptz | NO | now() |
| raw_webhook_data | jsonb | YES |  |
| note | text | YES |  |

**Foreign Keys:**
- `message_id` -> `messages(id)`

**RLS:** Enabled, 2 policies (INSERT, SELECT)
**Audit columns:** created_at

### `message_template_history`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| template_id | uuid | YES |  |
| created_at | timestamptz | NO | now() |
| content | text | NO |  |
| changed_by | uuid | YES |  |
| change_reason | text | YES |  |

**Foreign Keys:**
- `changed_by` -> `auth.users(id)`
- `template_id` -> `message_templates(id)`

**RLS:** Enabled, 2 policies (INSERT, SELECT)
**Audit columns:** created_at

### `message_templates`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |
| name | text | NO |  |
| description | text | YES |  |
| template_type | text | NO |  |
| content | text | NO |  |
| variables | ARRAY | YES | '{}'::text[] |
| is_default | boolean | YES | false |
| is_active | boolean | YES | true |
| created_by | uuid | YES |  |
| character_count | integer | YES |  |
| estimated_segments | integer | YES |  |
| send_timing | text | NO | 'immediate'::text |
| custom_timing_hours | integer | YES |  |

**Foreign Keys:**
- `created_by` -> `auth.users(id)`

**RLS:** Enabled, 2 policies (ALL, SELECT)
**Audit columns:** created_at, updated_at, created_by

### `messages`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| customer_id | uuid | NO |  |
| direction | text | NO |  |
| message_sid | text | NO |  |
| body | text | NO |  |
| status | text | NO |  |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |
| twilio_message_sid | text | YES |  |
| error_code | text | YES |  |
| error_message | text | YES |  |
| price | numeric | YES |  |
| price_unit | text | YES |  |
| sent_at | timestamptz | YES |  |
| delivered_at | timestamptz | YES |  |
| failed_at | timestamptz | YES |  |
| twilio_status | text | YES |  |
| from_number | text | YES |  |
| to_number | text | YES |  |
| message_type | text | YES | 'sms'::text |
| read_at | timestamptz | YES |  |
| segments | integer | YES | 1 |
| cost_usd | numeric | YES |  |
| event_booking_id | uuid | YES |  |
| table_booking_id | uuid | YES |  |
| private_booking_id | uuid | YES |  |
| template_key | text | YES |  |

**Foreign Keys:**
- `customer_id` -> `customers(id)`
- `event_booking_id` -> `bookings(id)`
- `table_booking_id` -> `table_bookings(id)`
- `private_booking_id` -> `private_bookings(id)`

**RLS:** Enabled, 2 policies (INSERT, SELECT)
**Audit columns:** created_at, updated_at

### `promo_sequence`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| customer_id | uuid | NO |  |
| event_id | uuid | NO |  |
| audience_type | text | NO |  |
| touch_14d_sent_at | timestamptz | NO |  |
| touch_7d_sent_at | timestamptz | YES |  |
| touch_3d_sent_at | timestamptz | YES |  |
| created_at | timestamptz | YES | now() |

**Foreign Keys:**
- `customer_id` -> `customers(id)`
- `event_id` -> `events(id)`

**RLS:** No policies found
**Audit columns:** created_at

### `sms_promo_context`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| customer_id | uuid | NO |  |
| phone_number | text | NO |  |
| event_id | uuid | NO |  |
| template_key | text | NO |  |
| message_id | uuid | YES |  |
| reply_window_expires_at | timestamptz | NO |  |
| booking_created | boolean | YES | false |
| created_at | timestamptz | YES | now() |

**Foreign Keys:**
- `customer_id` -> `customers(id)`
- `event_id` -> `events(id)`
- `message_id` -> `messages(id)`

**RLS:** No policies found
**Audit columns:** created_at

---
## Parking

### `guest_tokens`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| hashed_token | text | NO |  |
| customer_id | uuid | NO |  |
| event_booking_id | uuid | YES |  |
| table_booking_id | uuid | YES |  |
| charge_request_id | uuid | YES |  |
| action_type | text | NO |  |
| expires_at | timestamptz | NO |  |
| consumed_at | timestamptz | YES |  |
| created_at | timestamptz | NO | now() |
| waitlist_offer_id | uuid | YES |  |
| private_booking_id | uuid | YES |  |

**Foreign Keys:**
- `customer_id` -> `customers(id)`
- `event_booking_id` -> `bookings(id)`
- `table_booking_id` -> `table_bookings(id)`
- `charge_request_id` -> `charge_requests(id)`
- `waitlist_offer_id` -> `waitlist_offers(id)`
- `private_booking_id` -> `private_bookings(id)`

**RLS:** No policies found
**Audit columns:** created_at

### `parking_booking_notifications`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| booking_id | uuid | NO |  |
| channel | enum | NO |  |
| event_type | enum | NO |  |
| status | text | NO | 'queued'::text |
| message_sid | text | YES |  |
| email_message_id | text | YES |  |
| payload | jsonb | YES |  |
| error | text | YES |  |
| sent_at | timestamptz | YES |  |
| retries | integer | NO | 0 |
| created_at | timestamptz | NO | now() |

**Foreign Keys:**
- `booking_id` -> `parking_bookings(id)`

**RLS:** Enabled, 2 policies (INSERT, SELECT)
**Audit columns:** created_at

### `parking_booking_payments`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| booking_id | uuid | NO |  |
| provider | text | NO | 'paypal'::text |
| status | enum | NO | 'pending'::parking_payment_status |
| amount | numeric | NO |  |
| currency | text | NO | 'GBP'::text |
| paypal_order_id | text | YES |  |
| transaction_id | text | YES |  |
| expires_at | timestamptz | YES |  |
| paid_at | timestamptz | YES |  |
| refunded_at | timestamptz | YES |  |
| metadata | jsonb | YES |  |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |
| refund_status | text | YES |  |

**Foreign Keys:**
- `booking_id` -> `parking_bookings(id)`

**RLS:** Enabled, 4 policies (DELETE, INSERT, SELECT, UPDATE)
**Audit columns:** created_at, updated_at

### `parking_bookings`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| reference | text | NO |  |
| customer_id | uuid | YES |  |
| customer_first_name | text | NO |  |
| customer_last_name | text | YES |  |
| customer_mobile | text | NO |  |
| customer_email | text | YES |  |
| vehicle_registration | text | NO |  |
| vehicle_make | text | YES |  |
| vehicle_model | text | YES |  |
| vehicle_colour | text | YES |  |
| start_at | timestamptz | NO |  |
| end_at | timestamptz | NO |  |
| duration_minutes | integer | NO |  |
| calculated_price | numeric | NO |  |
| pricing_breakdown | jsonb | NO |  |
| override_price | numeric | YES |  |
| override_reason | text | YES |  |
| capacity_override | boolean | YES | false |
| capacity_override_reason | text | YES |  |
| status | enum | NO | 'pending_payment'::parking_booking_st... |
| payment_status | enum | NO | 'pending'::parking_payment_status |
| payment_due_at | timestamptz | YES |  |
| confirmed_at | timestamptz | YES |  |
| cancelled_at | timestamptz | YES |  |
| completed_at | timestamptz | YES |  |
| expires_at | timestamptz | YES |  |
| notes | text | YES |  |
| created_by | uuid | YES |  |
| updated_by | uuid | YES |  |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |
| start_notification_sent | boolean | YES | false |
| end_notification_sent | boolean | YES | false |
| payment_overdue_notified | boolean | YES | false |
| initial_request_sms_sent | boolean | NO | false |
| unpaid_week_before_sms_sent | boolean | NO | false |
| unpaid_day_before_sms_sent | boolean | NO | false |
| paid_start_three_day_sms_sent | boolean | NO | false |
| paid_end_three_day_sms_sent | boolean | NO | false |

**Foreign Keys:**
- `created_by` -> `auth.users(id)`
- `customer_id` -> `customers(id)`
- `updated_by` -> `auth.users(id)`

**RLS:** Enabled, 4 policies (DELETE, INSERT, SELECT, UPDATE)
**Audit columns:** created_by, updated_by, created_at, updated_at

### `parking_rates`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| effective_from | timestamptz | NO | now() |
| hourly_rate | numeric | NO |  |
| daily_rate | numeric | NO |  |
| weekly_rate | numeric | NO |  |
| monthly_rate | numeric | NO |  |
| capacity_override | integer | YES |  |
| notes | text | YES |  |
| created_at | timestamptz | NO | now() |

**RLS:** Enabled, 1 policies (SELECT)
**Audit columns:** created_at

---
## Menu

### `menu_categories`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| code | text | NO |  |
| name | text | NO |  |
| description | text | YES |  |
| sort_order | integer | NO | 0 |
| is_active | boolean | NO | true |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |

**RLS:** Enabled, 2 policies (ALL, SELECT)
**Audit columns:** created_at, updated_at

### `menu_category_menus`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| menu_id | uuid | NO |  |
| category_id | uuid | NO |  |
| sort_order | integer | NO | 0 |

**Foreign Keys:**
- `category_id` -> `menu_categories(id)`
- `menu_id` -> `menu_menus(id)`

**RLS:** Enabled, 2 policies (ALL, SELECT)

### `menu_dish_ingredients`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| dish_id | uuid | NO |  |
| ingredient_id | uuid | NO |  |
| quantity | numeric | NO | 0 |
| unit | enum | NO |  |
| yield_pct | numeric | NO | 100 |
| wastage_pct | numeric | NO | 0 |
| cost_override | numeric | YES |  |
| notes | text | YES |  |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |
| option_group | text | YES |  |
| inclusion_type | text | NO | 'included'::text |
| upgrade_price | numeric | YES |  |
| measure_ml | numeric | YES |  |

**Foreign Keys:**
- `dish_id` -> `menu_dishes(id)`
- `ingredient_id` -> `menu_ingredients(id)`

**RLS:** Enabled, 2 policies (ALL, SELECT)
**Audit columns:** created_at, updated_at

### `menu_dish_menu_assignments`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| dish_id | uuid | NO |  |
| menu_id | uuid | NO |  |
| category_id | uuid | NO |  |
| sort_order | integer | NO | 0 |
| available_from | date | YES |  |
| available_until | date | YES |  |
| is_special | boolean | NO | false |
| is_default_side | boolean | NO | false |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |

**Foreign Keys:**
- `category_id` -> `menu_categories(id)`
- `dish_id` -> `menu_dishes(id)`
- `menu_id` -> `menu_menus(id)`

**RLS:** Enabled, 2 policies (ALL, SELECT)
**Audit columns:** created_at, updated_at

### `menu_dish_recipes`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| dish_id | uuid | NO |  |
| recipe_id | uuid | NO |  |
| quantity | numeric | NO | 0 |
| yield_pct | numeric | NO | 100 |
| wastage_pct | numeric | NO | 0 |
| cost_override | numeric | YES |  |
| notes | text | YES |  |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |
| option_group | text | YES |  |
| inclusion_type | text | NO | 'included'::text |
| upgrade_price | numeric | YES |  |

**Foreign Keys:**
- `dish_id` -> `menu_dishes(id)`
- `recipe_id` -> `menu_recipes(id)`

**RLS:** Enabled, 2 policies (ALL, SELECT)
**Audit columns:** created_at, updated_at

### `menu_dishes`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| name | text | NO |  |
| slug | text | YES |  |
| description | text | YES |  |
| selling_price | numeric | NO | 0 |
| target_gp_pct | numeric | NO | 0.70 |
| portion_cost | numeric | NO | 0 |
| gp_pct | numeric | YES |  |
| allergen_flags | ARRAY | NO | '{}'::text[] |
| dietary_flags | ARRAY | NO | '{}'::text[] |
| calories | integer | YES |  |
| is_active | boolean | NO | true |
| is_sunday_lunch | boolean | NO | false |
| image_url | text | YES |  |
| notes | text | YES |  |
| is_gp_alert | boolean | NO | false |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |
| removable_allergens | ARRAY | YES | '{}'::text[] |
| is_modifiable_for | jsonb | YES | '{}'::jsonb |
| allergen_verified | boolean | YES | false |
| allergen_verified_at | timestamptz | YES |  |

**RLS:** Enabled, 2 policies (ALL, SELECT)
**Audit columns:** created_at, updated_at

### `menu_ingredient_prices`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| ingredient_id | uuid | NO |  |
| pack_cost | numeric | NO |  |
| effective_from | timestamptz | NO | now() |
| supplier_name | text | YES |  |
| supplier_sku | text | YES |  |
| notes | text | YES |  |
| created_at | timestamptz | NO | now() |

**Foreign Keys:**
- `ingredient_id` -> `menu_ingredients(id)`

**RLS:** Enabled, 2 policies (ALL, SELECT)
**Audit columns:** created_at

### `menu_ingredients`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| name | text | NO |  |
| description | text | YES |  |
| default_unit | enum | NO | 'each'::menu_unit |
| storage_type | enum | NO | 'ambient'::menu_storage_type |
| supplier_name | text | YES |  |
| supplier_sku | text | YES |  |
| brand | text | YES |  |
| pack_size | numeric | YES |  |
| pack_size_unit | enum | YES |  |
| pack_cost | numeric | NO | 0 |
| portions_per_pack | numeric | YES |  |
| wastage_pct | numeric | NO | 0 |
| shelf_life_days | integer | YES |  |
| allergens | ARRAY | NO | '{}'::text[] |
| dietary_flags | ARRAY | NO | '{}'::text[] |
| notes | text | YES |  |
| is_active | boolean | NO | true |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |
| abv | numeric | YES |  |
| purchase_department | text | NO | 'kitchen'::text |

**RLS:** Enabled, 2 policies (ALL, SELECT)
**Audit columns:** created_at, updated_at

### `menu_items`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| section_id | uuid | NO |  |
| name | varchar | NO |  |
| description | text | YES |  |
| price | numeric | NO |  |
| calories | integer | YES |  |
| dietary_info | jsonb | YES | '[]'::jsonb |
| allergens | jsonb | YES | '[]'::jsonb |
| is_available | boolean | YES | true |
| is_special | boolean | YES | false |
| available_from | timestamptz | YES |  |
| available_until | timestamptz | YES |  |
| image_url | text | YES |  |
| sort_order | integer | YES | 0 |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |

**Foreign Keys:**
- `section_id` -> `menu_sections(id)`

**RLS:** Enabled, 1 policies (SELECT)
**Audit columns:** created_at, updated_at

### `menu_menus`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| code | text | NO |  |
| name | text | NO |  |
| description | text | YES |  |
| is_active | boolean | NO | true |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |

**RLS:** Enabled, 2 policies (ALL, SELECT)
**Audit columns:** created_at, updated_at

### `menu_recipe_ingredients`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| recipe_id | uuid | NO |  |
| ingredient_id | uuid | NO |  |
| quantity | numeric | NO | 0 |
| unit | enum | NO |  |
| yield_pct | numeric | NO | 100 |
| wastage_pct | numeric | NO | 0 |
| cost_override | numeric | YES |  |
| notes | text | YES |  |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |

**Foreign Keys:**
- `ingredient_id` -> `menu_ingredients(id)`
- `recipe_id` -> `menu_recipes(id)`

**RLS:** Enabled, 2 policies (ALL, SELECT)
**Audit columns:** created_at, updated_at

### `menu_recipes`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| name | text | NO |  |
| description | text | YES |  |
| instructions | text | YES |  |
| yield_quantity | numeric | NO | 1 |
| yield_unit | enum | NO | 'portion'::menu_unit |
| portion_cost | numeric | NO | 0 |
| allergen_flags | ARRAY | NO | '{}'::text[] |
| dietary_flags | ARRAY | NO | '{}'::text[] |
| notes | text | YES |  |
| is_active | boolean | NO | true |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |

**RLS:** Enabled, 2 policies (ALL, SELECT)
**Audit columns:** created_at, updated_at

### `menu_sections`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| name | varchar | NO |  |
| description | text | YES |  |
| sort_order | integer | YES | 0 |
| is_active | boolean | YES | true |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |

**RLS:** Enabled, 1 policies (SELECT)
**Audit columns:** created_at, updated_at

---
## OJ Projects

### `oj_billing_runs`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| vendor_id | uuid | NO |  |
| period_yyyymm | text | NO |  |
| period_start | date | NO |  |
| period_end | date | NO |  |
| status | text | NO |  |
| invoice_id | uuid | YES |  |
| selected_entry_ids | jsonb | YES |  |
| carried_forward_inc_vat | numeric | YES |  |
| error_message | text | YES |  |
| run_started_at | timestamptz | NO | now() |
| run_finished_at | timestamptz | YES |  |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |

**Foreign Keys:**
- `invoice_id` -> `invoices(id)`
- `vendor_id` -> `invoice_vendors(id)`

**RLS:** Enabled, 2 policies (ALL, SELECT)
**Audit columns:** created_at, updated_at

### `oj_entries`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| vendor_id | uuid | NO |  |
| project_id | uuid | NO |  |
| entry_type | text | NO |  |
| entry_date | date | NO |  |
| start_at | timestamptz | YES |  |
| end_at | timestamptz | YES |  |
| duration_minutes_raw | integer | YES |  |
| duration_minutes_rounded | integer | YES |  |
| miles | numeric | YES |  |
| work_type_id | uuid | YES |  |
| work_type_name_snapshot | text | YES |  |
| description | text | YES |  |
| internal_notes | text | YES |  |
| billable | boolean | NO | true |
| status | text | NO | 'unbilled'::text |
| billing_run_id | uuid | YES |  |
| invoice_id | uuid | YES |  |
| billed_at | timestamptz | YES |  |
| paid_at | timestamptz | YES |  |
| hourly_rate_ex_vat_snapshot | numeric | YES |  |
| vat_rate_snapshot | numeric | YES |  |
| mileage_rate_snapshot | numeric | YES |  |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |
| amount_ex_vat_snapshot | numeric | YES | NULL::numeric |

**Foreign Keys:**
- `vendor_id` -> `invoice_vendors(id)`
- `project_id` -> `oj_projects(id)`
- `work_type_id` -> `oj_work_types(id)`
- `billing_run_id` -> `oj_billing_runs(id)`
- `invoice_id` -> `invoices(id)`

**RLS:** Enabled, 4 policies (DELETE, INSERT, SELECT, UPDATE)
**Audit columns:** created_at, updated_at

### `oj_project_contacts`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| project_id | uuid | NO |  |
| contact_id | uuid | NO |  |
| created_at | timestamptz | NO | now() |

**Foreign Keys:**
- `project_id` -> `oj_projects(id)`
- `contact_id` -> `invoice_vendor_contacts(id)`

**RLS:** Enabled, 2 policies (ALL, SELECT)
**Audit columns:** created_at

### `oj_projects`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| vendor_id | uuid | NO |  |
| project_code | text | NO |  |
| project_name | text | NO |  |
| brief | text | YES |  |
| internal_notes | text | YES |  |
| deadline | date | YES |  |
| budget_ex_vat | numeric | YES |  |
| status | text | NO | 'active'::text |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |
| is_retainer | boolean | NO | false |
| retainer_period_yyyymm | text | YES |  |
| budget_hours | numeric | YES |  |

**Foreign Keys:**
- `vendor_id` -> `invoice_vendors(id)`

**RLS:** Enabled, 4 policies (DELETE, INSERT, SELECT, UPDATE)
**Audit columns:** created_at, updated_at

### `oj_recurring_charge_instances`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| vendor_id | uuid | NO |  |
| recurring_charge_id | uuid | NO |  |
| period_yyyymm | text | NO |  |
| period_start | date | NO |  |
| period_end | date | NO |  |
| description_snapshot | text | NO |  |
| amount_ex_vat_snapshot | numeric | NO |  |
| vat_rate_snapshot | numeric | NO | 20 |
| sort_order_snapshot | integer | NO | 0 |
| status | text | NO | 'unbilled'::text |
| billing_run_id | uuid | YES |  |
| invoice_id | uuid | YES |  |
| billed_at | timestamptz | YES |  |
| paid_at | timestamptz | YES |  |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |

**Foreign Keys:**
- `vendor_id` -> `invoice_vendors(id)`
- `recurring_charge_id` -> `oj_vendor_recurring_charges(id)`
- `billing_run_id` -> `oj_billing_runs(id)`
- `invoice_id` -> `invoices(id)`

**RLS:** Enabled, 2 policies (ALL, SELECT)
**Audit columns:** created_at, updated_at

### `oj_vendor_billing_settings`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| vendor_id | uuid | NO |  |
| client_code | text | YES |  |
| billing_mode | text | NO | 'full'::text |
| monthly_cap_inc_vat | numeric | YES |  |
| hourly_rate_ex_vat | numeric | NO | 75 |
| vat_rate | numeric | NO | 20 |
| mileage_rate | numeric | NO | 0.420 |
| retainer_included_hours_per_month | numeric | YES |  |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |
| statement_mode | boolean | NO | false |

**Foreign Keys:**
- `vendor_id` -> `invoice_vendors(id)`

**RLS:** Enabled, 2 policies (ALL, SELECT)
**Audit columns:** created_at, updated_at

### `oj_vendor_recurring_charges`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| vendor_id | uuid | NO |  |
| description | text | NO |  |
| amount_ex_vat | numeric | NO |  |
| vat_rate | numeric | NO | 20 |
| is_active | boolean | NO | true |
| sort_order | integer | NO | 0 |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |
| frequency | text | NO | 'monthly'::text |

**Foreign Keys:**
- `vendor_id` -> `invoice_vendors(id)`

**RLS:** Enabled, 2 policies (ALL, SELECT)
**Audit columns:** created_at, updated_at

### `oj_work_types`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| name | text | NO |  |
| is_active | boolean | NO | true |
| sort_order | integer | NO | 0 |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |

**RLS:** Enabled, 4 policies (DELETE, INSERT, SELECT, UPDATE)
**Audit columns:** created_at, updated_at

---
## Short Links

### `short_link_clicks`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| short_link_id | uuid | YES |  |
| clicked_at | timestamptz | YES | now() |
| user_agent | text | YES |  |
| ip_address | inet | YES |  |
| referrer | text | YES |  |
| metadata | jsonb | YES | '{}'::jsonb |
| country | varchar | YES |  |
| city | varchar | YES |  |
| region | varchar | YES |  |
| device_type | varchar | YES |  |
| browser | varchar | YES |  |
| os | varchar | YES |  |
| utm_source | varchar | YES |  |
| utm_medium | varchar | YES |  |
| utm_campaign | varchar | YES |  |

**Foreign Keys:**
- `short_link_id` -> `short_links(id)`

**RLS:** Enabled, 3 policies (INSERT, SELECT)

### `short_links`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| short_code | varchar | NO |  |
| destination_url | text | NO |  |
| link_type | varchar | NO |  |
| metadata | jsonb | YES | '{}'::jsonb |
| expires_at | timestamptz | YES |  |
| click_count | integer | YES | 0 |
| last_clicked_at | timestamptz | YES |  |
| created_by | uuid | YES |  |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |
| name | text | YES |  |
| parent_link_id | uuid | YES |  |

**Foreign Keys:**
- `created_by` -> `auth.users(id)`
- `parent_link_id` -> `short_links(id)`

**RLS:** Enabled, 4 policies (DELETE, INSERT, SELECT, UPDATE)
**Audit columns:** created_by, created_at, updated_at

---
## Cashing Up

### `cashup_cash_counts`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| cashup_session_id | uuid | NO |  |
| denomination | numeric | NO |  |
| quantity | integer | NO | 0 |
| total_amount | numeric | NO | 0 |

**Foreign Keys:**
- `cashup_session_id` -> `cashup_sessions(id)`

**RLS:** Enabled, 4 policies (DELETE, INSERT, SELECT, UPDATE)

### `cashup_payment_breakdowns`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| cashup_session_id | uuid | NO |  |
| payment_type_code | text | NO |  |
| payment_type_label | text | NO |  |
| expected_amount | numeric | NO | 0 |
| counted_amount | numeric | NO | 0 |
| variance_amount | numeric | NO | 0 |

**Foreign Keys:**
- `cashup_session_id` -> `cashup_sessions(id)`

**RLS:** Enabled, 4 policies (DELETE, INSERT, SELECT, UPDATE)

### `cashup_sessions`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| site_id | uuid | NO |  |
| session_date | date | NO |  |
| status | text | NO |  |
| prepared_by_user_id | uuid | NO |  |
| approved_by_user_id | uuid | YES |  |
| total_expected_amount | numeric | NO | 0 |
| total_counted_amount | numeric | NO | 0 |
| total_variance_amount | numeric | NO | 0 |
| notes | text | YES |  |
| created_at | timestamptz | NO | now() |
| created_by_user_id | uuid | NO |  |
| updated_at | timestamptz | NO | now() |
| updated_by_user_id | uuid | NO |  |

**Foreign Keys:**
- `site_id` -> `sites(id)`

**RLS:** Enabled, 3 policies (INSERT, SELECT, UPDATE)
**Audit columns:** created_at, updated_at

### `cashup_target_overrides`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| site_id | uuid | NO |  |
| target_date | date | NO |  |
| target_amount | numeric | NO | 0 |
| reason | text | YES |  |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |
| created_by | uuid | YES |  |
| updated_by | uuid | YES |  |

**Foreign Keys:**
- `site_id` -> `sites(id)`
- `created_by` -> `auth.users(id)`
- `updated_by` -> `auth.users(id)`

**RLS:** Enabled, 4 policies (DELETE, INSERT, SELECT, UPDATE)
**Audit columns:** created_at, updated_at, created_by, updated_by

### `cashup_targets`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| site_id | uuid | NO |  |
| day_of_week | integer | NO |  |
| target_amount | numeric | NO | 0 |
| effective_from | date | NO |  |
| created_at | timestamptz | NO | now() |
| created_by | uuid | YES |  |

**Foreign Keys:**
- `created_by` -> `auth.users(id)`
- `site_id` -> `sites(id)`

**RLS:** Enabled, 4 policies (DELETE, INSERT, SELECT, UPDATE)
**Audit columns:** created_at, created_by

---
## Calendar

### `calendar_notes`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| note_date | date | NO |  |
| title | text | NO |  |
| notes | text | YES |  |
| source | text | NO | 'manual'::text |
| start_time | time without time zone | YES |  |
| end_time | time without time zone | YES |  |
| color | text | NO | '#0EA5E9'::text |
| generated_context | jsonb | NO | '{}'::jsonb |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |
| created_by | uuid | YES |  |
| updated_by | uuid | YES |  |
| end_date | date | YES |  |

**Foreign Keys:**
- `created_by` -> `auth.users(id)`
- `updated_by` -> `auth.users(id)`

**RLS:** Enabled, 4 policies (DELETE, INSERT, SELECT, UPDATE)
**Audit columns:** created_at, updated_at, created_by, updated_by

---
## Vendors

### `vendor_contacts`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| vendor_id | uuid | YES |  |
| name | varchar | NO |  |
| role | varchar | YES |  |
| email | varchar | YES |  |
| phone | varchar | YES |  |
| is_primary | boolean | YES | false |
| receives_invoices | boolean | YES | false |
| receives_statements | boolean | YES | false |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |

**Foreign Keys:**
- `vendor_id` -> `vendors(id)`

**RLS:** Enabled, 2 policies (ALL, SELECT)
**Audit columns:** created_at, updated_at

### `vendors`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| name | text | NO |  |
| company_name | text | YES |  |
| service_type | text | NO |  |
| contact_phone | text | YES |  |
| contact_email | text | YES |  |
| website | text | YES |  |
| typical_rate | text | YES |  |
| notes | text | YES |  |
| preferred | boolean | YES | false |
| active | boolean | YES | true |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |
| invoice_email | varchar | YES |  |
| invoice_contact_name | varchar | YES |  |
| payment_terms | integer | YES | 30 |
| purchase_order_required | boolean | YES | false |
| tax_exempt | boolean | YES | false |
| tax_exempt_number | varchar | YES |  |
| preferred_delivery_method | varchar | YES | 'email'::character varying |
| credit_limit | numeric | YES |  |
| invoice_categories | ARRAY | YES | '{}'::text[] |
| contact_name | text | YES |  |

**RLS:** Enabled, 2 policies (ALL, SELECT)
**Audit columns:** created_at, updated_at

---
## System

### `ai_usage_events`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | bigint | NO | auto-increment |
| occurred_at | timestamptz | NO | now() |
| context | text | YES |  |
| model | text | NO |  |
| prompt_tokens | integer | NO | 0 |
| completion_tokens | integer | NO | 0 |
| total_tokens | integer | NO | 0 |
| cost | numeric | NO | 0 |

**RLS:** Enabled, 1 policies (ALL)

### `analytics_events`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| customer_id | uuid | NO |  |
| event_booking_id | uuid | YES |  |
| table_booking_id | uuid | YES |  |
| private_booking_id | uuid | YES |  |
| event_type | text | NO |  |
| metadata | jsonb | NO | '{}'::jsonb |
| created_at | timestamptz | NO | now() |

**Foreign Keys:**
- `customer_id` -> `customers(id)`
- `event_booking_id` -> `bookings(id)`
- `table_booking_id` -> `table_bookings(id)`
- `private_booking_id` -> `private_bookings(id)`

**RLS:** No policies found
**Audit columns:** created_at

### `api_keys`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| key_hash | varchar | NO |  |
| name | varchar | NO |  |
| description | text | YES |  |
| permissions | jsonb | YES | '["read:events"]'::jsonb |
| rate_limit | integer | YES | 1000 |
| is_active | boolean | YES | true |
| last_used_at | timestamptz | YES |  |
| expires_at | timestamptz | YES |  |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |

**RLS:** Enabled, 3 policies (ALL, SELECT)
**Audit columns:** created_at, updated_at

### `api_usage`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| api_key_id | uuid | NO |  |
| endpoint | varchar | NO |  |
| method | varchar | NO |  |
| status_code | integer | YES |  |
| response_time_ms | integer | YES |  |
| ip_address | inet | YES |  |
| user_agent | text | YES |  |
| created_at | timestamptz | YES | now() |

**Foreign Keys:**
- `api_key_id` -> `api_keys(id)`

**RLS:** No policies found
**Audit columns:** created_at

### `audit_logs`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| created_at | timestamptz | NO | now() |
| user_id | uuid | YES |  |
| user_email | text | YES |  |
| operation_type | text | NO |  |
| resource_type | text | NO |  |
| resource_id | text | YES |  |
| operation_status | text | NO |  |
| ip_address | inet | YES |  |
| user_agent | text | YES |  |
| old_values | jsonb | YES |  |
| new_values | jsonb | YES |  |
| error_message | text | YES |  |
| additional_info | jsonb | YES |  |

**Foreign Keys:**
- `user_id` -> `auth.users(id)`

**RLS:** Enabled, 5 policies (INSERT, SELECT)
**Audit columns:** created_at

### `background_jobs`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| type | text | NO |  |
| payload | jsonb | NO | '{}'::jsonb |
| status | text | NO | 'pending'::text |
| priority | integer | YES | 0 |
| attempts | integer | YES | 0 |
| max_attempts | integer | YES | 3 |
| scheduled_for | timestamptz | NO | now() |
| created_at | timestamptz | YES | now() |
| processed_at | timestamptz | YES |  |
| completed_at | timestamptz | YES |  |
| error | text | YES |  |
| result | jsonb | YES |  |
| duration_ms | integer | YES |  |

**RLS:** Enabled, 1 policies (ALL)
**Audit columns:** created_at

### `cron_job_runs`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| job_name | text | NO |  |
| run_key | text | NO |  |
| status | text | NO |  |
| started_at | timestamptz | NO | now() |
| finished_at | timestamptz | YES |  |
| error_message | text | YES |  |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |

**RLS:** Enabled, 1 policies (ALL)
**Audit columns:** created_at, updated_at

### `idempotency_keys`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| key | varchar | NO |  |
| request_hash | varchar | NO |  |
| response | jsonb | NO |  |
| created_at | timestamptz | NO | now() |
| expires_at | timestamptz | NO | now() |

**RLS:** Enabled, 1 policies (ALL)
**Audit columns:** created_at

### `job_queue`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| type | varchar | NO |  |
| status | varchar | NO | 'pending'::character varying |
| payload | jsonb | YES |  |
| result | jsonb | YES |  |
| error | text | YES |  |
| created_at | timestamptz | YES | now() |
| started_at | timestamptz | YES |  |
| completed_at | timestamptz | YES |  |
| created_by | uuid | YES |  |

**Foreign Keys:**
- `created_by` -> `auth.users(id)`

**RLS:** Enabled, 3 policies (ALL, INSERT, SELECT)
**Audit columns:** created_at, created_by

### `phone_standardization_issues`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| table_name | text | NO |  |
| record_id | uuid | NO |  |
| original_phone | text | NO |  |
| created_at | timestamptz | YES | now() |

**RLS:** Enabled, 1 policies (ALL)
**Audit columns:** created_at

### `rate_limits`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| key | varchar | NO |  |
| requests | jsonb | YES | '[]'::jsonb |
| window_ms | integer | NO |  |
| max_requests | integer | NO |  |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |

**RLS:** No policies found
**Audit columns:** created_at, updated_at

### `reminder_processing_logs`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| created_at | timestamptz | YES | now() |
| processing_type | text | NO |  |
| booking_id | uuid | YES |  |
| event_id | uuid | YES |  |
| customer_id | uuid | YES |  |
| template_type | text | YES |  |
| reminder_type | text | YES |  |
| message | text | YES |  |
| error_details | jsonb | YES |  |
| metadata | jsonb | YES |  |

**Foreign Keys:**
- `booking_id` -> `bookings(id)`
- `customer_id` -> `customers(id)`
- `event_id` -> `events(id)`

**RLS:** Enabled, 2 policies (ALL, SELECT)
**Audit columns:** created_at

### `system_settings`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| key | varchar | NO |  |
| value | jsonb | NO |  |
| description | text | YES |  |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |

**RLS:** Enabled, 2 policies (ALL, SELECT)
**Audit columns:** created_at, updated_at

### `webhook_deliveries`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| webhook_id | uuid | NO |  |
| event_type | varchar | NO |  |
| payload | jsonb | NO |  |
| response_status | integer | YES |  |
| response_body | text | YES |  |
| attempt_count | integer | YES | 1 |
| delivered_at | timestamptz | YES |  |
| created_at | timestamptz | YES | now() |

**Foreign Keys:**
- `webhook_id` -> `webhooks(id)`

**RLS:** No policies found
**Audit columns:** created_at

### `webhook_logs`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| webhook_type | text | NO | 'twilio'::text |
| status | text | NO |  |
| headers | jsonb | YES |  |
| body | text | YES |  |
| params | jsonb | YES |  |
| error_message | text | YES |  |
| error_details | jsonb | YES |  |
| processed_at | timestamptz | NO | now() |
| message_sid | text | YES |  |
| from_number | text | YES |  |
| to_number | text | YES |  |
| message_body | text | YES |  |
| customer_id | uuid | YES |  |
| message_id | uuid | YES |  |

**RLS:** Enabled, 2 policies (INSERT, SELECT)

### `webhooks`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | NO | gen_random_uuid() |
| url | text | NO |  |
| events | jsonb | YES | '["*"]'::jsonb |
| secret | varchar | YES |  |
| is_active | boolean | YES | true |
| last_triggered_at | timestamptz | YES |  |
| failure_count | integer | YES | 0 |
| created_at | timestamptz | YES | now() |
| updated_at | timestamptz | YES | now() |

**RLS:** No policies found
**Audit columns:** created_at, updated_at

---
## Other

### `attachment_categories`

| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| category_id | uuid | NO | gen_random_uuid() |
| category_name | text | NO |  |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |
| email_on_upload | boolean | NO | false |

**RLS:** Enabled, 4 policies (DELETE, INSERT, SELECT, UPDATE)
**Audit columns:** created_at, updated_at

---
## Views

### `admin_users_view` (VIEW)
Columns: id, email, created_at, last_sign_in_at

### `cashup_weekly_view` (VIEW)
Columns: site_id, week_start_date, session_date, status, total_expected_amount, total_counted_amount, total_variance_amount

### `customer_messaging_health` (VIEW)
Columns: id, first_name, last_name, mobile_number, messaging_status, sms_opt_in, consecutive_failures, total_failures_30d, last_successful_delivery, last_failure_type, total_messages_sent, messages_delivered, messages_failed, delivery_rate, total_cost_usd, last_message_date

### `employee_version_history` (VIEW)
Columns: id, created_at, user_id, user_email, operation_type, employee_id, old_values, new_values, ip_address, version_number, employee_name

### `menu_dishes_with_costs` (VIEW)
Columns: dish_id, name, slug, description, selling_price, target_gp_pct, portion_cost, gp_pct, allergen_flags, dietary_flags, calories, is_active, is_sunday_lunch, is_gp_alert, image_url, notes, menu_id, menu_code, menu_name, category_id, category_code, category_name, sort_order, is_special, is_default_side, available_from, available_until, removable_allergens, is_modifiable_for, allergen_verified, allergen_verified_at

### `menu_ingredients_with_prices` (VIEW)
Columns: id, name, description, default_unit, storage_type, supplier_name, supplier_sku, brand, pack_size, pack_size_unit, pack_cost, portions_per_pack, wastage_pct, shelf_life_days, allergens, dietary_flags, notes, is_active, created_at, updated_at, abv, purchase_department, latest_pack_cost, latest_unit_cost, latest_price_effective_from

### `message_templates_with_timing` (VIEW)
Columns: id, created_at, updated_at, name, description, template_type, content, variables, is_default, is_active, created_by, character_count, estimated_segments, send_timing, custom_timing_hours, timing_description

### `oj_project_stats` (VIEW)
Columns: project_id, total_hours_used, total_spend_ex_vat

### `private_booking_sms_reminders` (VIEW)
Columns: booking_id, customer_first_name, contact_phone, event_date, start_time, guest_count, balance_due_date, deposit_paid_date, final_payment_date, status, reminder_14d_due, balance_reminder_due, reminder_1d_due, balance_amount

### `private_booking_summary` (VIEW)
Columns: id, customer_id, customer_name, contact_phone, contact_email, event_date, start_time, setup_time, end_time, guest_count, event_type, status, deposit_amount, deposit_paid_date, deposit_payment_method, total_amount, balance_due_date, final_payment_date, final_payment_method, calendar_event_id, contract_version, internal_notes, customer_requests, created_by, created_at, updated_at, first_name, last_name, calculated_total, deposit_status, days_until_event

### `private_bookings_with_details` (VIEW)
Columns: id, customer_id, customer_name, contact_phone, contact_email, event_date, start_time, setup_time, end_time, end_time_next_day, guest_count, event_type, status, deposit_amount, deposit_paid_date, deposit_payment_method, total_amount, balance_due_date, final_payment_date, final_payment_method, calendar_event_id, contract_version, internal_notes, customer_requests, created_by, created_at, updated_at, setup_date, discount_type, discount_amount, discount_reason, customer_first_name, customer_last_name, customer_full_name, date_tbd, customer_mobile, calculated_total, deposit_status, days_until_event, contract_note, hold_expiry, total_balance_paid, balance_remaining, payment_status

### `recent_reminder_activity` (VIEW)
Columns: created_at, processing_type, message, customer_name, event_name, event_date, event_time, template_type, reminder_type, error_details

### `reminder_timing_debug` (VIEW)
Columns: booking_id, customer_name, event_name, event_datetime, template_type, send_timing, hours_before_event, reminder_should_send_at, send_status, reminder_already_sent, has_any_reminder_sent

### `short_link_daily_stats` (VIEW)
Columns: short_link_id, short_code, link_type, click_date, total_clicks, unique_visitors, mobile_clicks, desktop_clicks, tablet_clicks

---
## Enum Types

| Type | Values |
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
