# Supabase Migration Analysis for Anchor Management Tools

## Migration Files Overview

### Total Migrations: 30 files

## 1. Initial Baseline (20240625000000_initial_baseline.sql)
**Type**: Foundation
**Size**: Very large (68,038+ tokens)
**Content**: Complete production schema as of June 25, 2024

### Core Tables Created:
- Users & Authentication: profiles, roles, permissions, role_permissions, user_roles
- Events: events, event_categories, event_images, event_faqs, event_message_templates
- Customers: customers, customer_category_stats
- Bookings: bookings, booking_reminders
- Employees: employees, employee_attachments, employee_emergency_contacts, employee_financial_details, employee_health_records, employee_notes
- Private Bookings: private_bookings, private_booking_items, private_booking_documents, private_booking_audit, private_booking_sms_queue
- Messaging: messages, message_templates, message_template_history, message_delivery_status
- Venue: venue_spaces, business_hours, special_hours, business_amenities
- Catering: catering_packages, menu_items, menu_sections
- System: audit_logs, job_queue, background_jobs, webhook_logs, webhooks, webhook_deliveries
- API: api_keys, api_usage
- Utilities: vendors, attachment_categories, phone_standardization_issues, reminder_processing_logs

## 2. Loyalty System Features (20240712000001-20240712000008)
**Purpose**: Complete loyalty/rewards system implementation

### 20240712000001_loyalty_system_complete.sql
- Creates: loyalty_programs, loyalty_tiers, loyalty_members, loyalty_campaigns, loyalty_point_transactions, loyalty_rewards, reward_redemptions, loyalty_achievements, customer_achievements, achievement_progress, loyalty_challenges, customer_challenges, event_check_ins
- Establishes complete loyalty infrastructure

### 20240712000002_loyalty_core_tables_fix.sql
- Fixes RLS policies for loyalty tables
- Drops and recreates policies with proper permissions

### 20240712000003_loyalty_fix_references.sql
- Fixes foreign key constraints on event_check_ins
- Adjusts relationships between tables

### 20240712000004_add_redemption_code_fields.sql
- Adds: code column (unique) to reward_redemptions
- Adds: expires_at column for time-limited redemptions
- Creates indexes for performance

### 20240712000005_add_booking_qr_fields.sql
- Adds QR code fields to bookings table
- Supports QR-based check-ins

### 20240712000006_loyalty_portal_auth.sql
- Creates: loyalty_otp_verifications, loyalty_portal_sessions
- Implements OTP-based authentication for loyalty portal

### 20240712000007_loyalty_initial_rewards.sql
- Seeds initial rewards data
- Sets up default reward tiers

### 20240712000008_loyalty_notifications.sql
- Creates: loyalty_notifications, loyalty_bulk_notifications
- Implements notification system for loyalty members

## 3. Rate Limiting (20240720000000_add_rate_limits_table.sql)
- Creates: rate_limits table
- Implements API rate limiting infrastructure

## 4. Loyalty System Enhancements (20250113155500_add_loyalty_access_token.sql)
- Adds: access_token column to loyalty_members
- Creates unique index and generation function
- Enhances security for loyalty portal access

## 5. Short Links System (20250113170000-20250114183000)
**Purpose**: URL shortening and analytics

### 20250113170000_add_short_links.sql
- Creates: short_links, short_link_clicks
- Implements URL shortening with analytics

### 20250113180000_fix_short_links_permissions.sql
- Fixes ambiguous column references
- Updates RLS policies for proper access

### 20250114180000_add_click_demographics.sql
- Adds demographic tracking columns to short_link_clicks
- Enhances analytics capabilities

### 20250114181000_fix_ambiguous_column.sql
- Fixes analytics function column references

### 20250114182000_fix_all_analytics_functions.sql
- Drops and recreates analytics views
- Fixes all analytics functions

### 20250114183000_drop_and_recreate_analytics_functions.sql
- Complete rebuild of analytics functions
- Ensures proper function signatures

## 6. Booking System Enhancements (20250714144905-20250715061200)
**Purpose**: API-driven booking confirmations

### 20250714144905_add_pending_bookings.sql
- Creates: pending_bookings table
- Supports API-initiated bookings requiring confirmation

### 20250714152207_remove_unused_event_columns.sql
- Removes: description, image_urls, is_recurring, recurrence_rule, parent_event_id, price_currency from events
- Removes: price_currency from menu_items
- Schema cleanup

### 20250714170000_add_booking_confirmation_link_type.sql
- Adds 'booking_confirmation' as valid link_type for short_links
- Integrates booking confirmations with short links

### 20250714210000_fix_pending_bookings_rls.sql
- Adds RLS policies for public access to pending bookings
- Allows anonymous token-based access

### 20250714215000_fix_booking_confirmation_rls_properly.sql
- Comprehensive RLS fix for anonymous access
- Ensures booking confirmation flow works

### 20250714220000_fix_booking_confirmation_anon_access.sql
- Final fix for anonymous access patterns
- Ensures all related tables accessible

### 20250715061200_add_metadata_to_pending_bookings.sql
- Adds: metadata JSONB column to pending_bookings
- Supports additional booking data

## 7. Table Booking System (20250719140000-20250719200000)
**Purpose**: Restaurant table reservation system

### 20250719140000_add_table_bookings_system.sql
- Creates: table_bookings, table_booking_items, booking_time_slots, booking_policies, table_booking_modifications, table_booking_payments, table_booking_sms_templates
- Complete table reservation infrastructure

### 20250719171529_update_nikki_event_categories.sql
- Updates event categories
- Splits into Nikki's Games Night and Karaoke Night

### 20250719190000_add_sunday_lunch_menu_items.sql
- Creates: sunday_lunch_menu_items
- Supports Sunday lunch menu management

### 20250719200000_add_table_management.sql
- Creates: tables, table_combinations, table_combination_tables, table_configuration
- Physical table management system

## 8. System Infrastructure (20250719210011-20250719210012)

### 20250719210011_create_missing_jobs_table.sql
- Creates: jobs table (CRITICAL - was missing)
- Implements job queue system
- Adds necessary indexes

### 20250719210012_add_performance_indexes.sql
- Adds performance indexes across multiple tables
- Addresses slow query issues
- Includes helper function for safe index creation

## Migration Dependencies & Modifications

### Tables Modified Across Migrations:
1. **reward_redemptions**: 
   - Added: code, expires_at columns
   - Added indexes

2. **bookings**:
   - Added: QR code fields
   - Multiple constraint modifications

3. **loyalty_members**:
   - Added: access_token column
   - Added unique index

4. **short_links**:
   - Modified: link_type constraints
   - Updated to support booking confirmations

5. **events**:
   - Removed: Multiple unused columns
   - Performance indexes added

6. **pending_bookings**:
   - Added: metadata column
   - Multiple RLS policy updates

7. **event_check_ins**:
   - Modified: Foreign key constraints

### Critical Dependencies:
1. Loyalty system depends on: customers, events, bookings
2. Short links system is standalone but integrates with bookings
3. Table booking system depends on: customers, venue infrastructure
4. Jobs table is critical for async processing (SMS, etc.)
5. Audit logs depend on all major tables

### RLS Policy Evolution:
- Initial policies in baseline
- Loyalty system adds comprehensive policies
- Short links fixes permission issues
- Pending bookings requires multiple iterations for anonymous access
- Table bookings adds new access patterns

## Recommendations for Baseline Squashing

### Include in New Baseline:
1. All table creations (with final schema including all modifications)
2. All indexes (including performance indexes)
3. All functions and triggers
4. Final RLS policies (after all fixes)
5. All constraints and foreign keys (in final state)

### Exclude from Baseline:
1. Data migrations (like initial rewards)
2. Iterative fixes (consolidate to final state)
3. Dropped columns/constraints
4. Intermediate policy versions

### Special Considerations:
1. The jobs table creation (20250719210011) is CRITICAL and was missing
2. Anonymous access patterns for pending_bookings need careful consolidation
3. Performance indexes should all be included
4. Event categories data should be in a separate seed file

## Database Objects Summary

### Functions Created (100+ total):
- **Calculation Functions**: calculate_balance_due_date, calculate_message_cost, calculate_private_booking_balance, calculate_send_time
- **Utility Functions**: date_utc, encrypt_sensitive_audit_data, ensure_single_default_category
- **Business Logic**: get_bookings_needing_reminders, get_category_regulars, get_cross_category_suggestions
- **Admin Functions**: get_all_users_with_roles, get_dashboard_stats
- **Audit Functions**: get_employee_at_timestamp, compare_employee_versions
- **Loyalty Functions**: generate_loyalty_access_token, various loyalty-related functions
- **Analytics Functions**: get_short_link_analytics, get_all_links_analytics
- **Cleanup Functions**: cleanup_old_jobs, cleanup_old_reminder_logs

### Triggers Created:
- **Updated_at Triggers**: Most tables have updated_at triggers
- **Special Triggers**:
  - pending_bookings_updated_at
  - set_loyalty_access_token_trigger
  - table_bookings_set_reference
  - update_customer_stats_on_booking
  - update_member_notification_stats_trigger

### Views Created:
- admin_users_view
- customer_messaging_health
- employee_version_history
- message_templates_with_timing
- private_booking_sms_reminders
- private_booking_summary
- private_bookings_with_details
- recent_reminder_activity
- reminder_timing_debug
- short_link_daily_stats

### Seed Data Included:
- booking_time_slots (4 entries)
- loyalty_tiers (2 entries)
- booking_policies
- table_configuration
- table_booking_sms_templates
- sunday_lunch_menu_items
- loyalty_programs
- event_categories (including Nikki's updates)
- Initial rbac_permissions and rbac_role_permissions

## Squashing Strategy

### Phase 1: Core Schema
1. Create all tables with final schema (including all column additions)
2. Create all indexes (including performance indexes from later migrations)
3. Create all constraints and foreign keys

### Phase 2: Functions and Triggers
1. Create all functions in dependency order
2. Create all triggers
3. Create all views

### Phase 3: RLS and Permissions
1. Enable RLS on all tables
2. Create final versions of all policies (consolidating fixes)
3. Create RBAC structure

### Phase 4: Seed Data
1. Essential system data (roles, permissions)
2. Configuration data (booking policies, time slots)
3. Business data in separate seed file

### Files to Archive:
- All intermediate fix migrations
- All migrations that just modify existing structures
- Keep for reference but not in main migration path