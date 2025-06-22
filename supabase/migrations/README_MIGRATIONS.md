# Database Migrations to Run

The following migrations need to be run on your live database to fix the identified issues:

## 1. Cleanup Legacy Fields (HIGH PRIORITY)
**File:** `20250115_cleanup_legacy_fields.sql`
- Removes `emergency_contact_name` and `emergency_contact_phone` from employees table (moved to separate table)
- Removes `ni_number` from employees table (moved to employee_financial_details)
- Migrates any remaining data before removing fields

## 2. Drop Unused Tables (MEDIUM PRIORITY)
**File:** `20250115_drop_unused_tables.sql`
- Drops the `messages` table (no UI exists for this feature)
- Keeps `profiles` table but adds clarifying comment (required for auth)

## 3. Fix Employee Notes Field (HIGH PRIORITY)
**File:** `20250115_fix_employee_notes_created_by.sql`
- Renames `created_by` column to `created_by_user_id` to match UI expectations
- Updates RLS policies to use the new column name

## 4. Add Performance Indexes (HIGH PRIORITY)
**File:** `20250115_add_performance_indexes.sql`
- Adds indexes on all foreign key columns for better JOIN performance
- Adds indexes on commonly queried fields (email, status, dates)
- Adds unique constraint on employee email

## 5. Add RLS Policies (HIGH PRIORITY)
**File:** `20250115_add_employee_rls_policies.sql`
- Enables Row Level Security on all employee tables
- Adds appropriate policies for authenticated users
- Ensures data security at the database level

## 6. Fix Storage Policies (HIGH PRIORITY)
**File:** `20250115_fix_storage_bucket_policies.sql`
- Makes storage policies more restrictive
- Adds validation for file uploads
- Ensures users can only access attachments with valid database records

## 7. Update SMS Templates to Use First Name (LOW PRIORITY)
**File:** `20250122_update_sms_templates_first_name.sql`
- Updates default SMS templates to use {{first_name}} instead of {{customer_name}}
- Makes messages more personal by using just the first name
- Maintains backward compatibility - both variables are still available

## Run Order
Run the migrations in this order:
1. `20250115_cleanup_legacy_fields.sql`
2. `20250115_drop_unused_tables.sql`
3. `20250115_fix_employee_notes_created_by.sql`
4. `20250115_add_performance_indexes.sql`
5. `20250115_add_employee_rls_policies.sql`
6. `20250115_fix_storage_bucket_policies.sql`
7. `20250122_update_sms_templates_first_name.sql` (optional - for more personal SMS)

## How to Run
1. Go to your Supabase dashboard
2. Navigate to SQL Editor
3. Copy and paste each migration file content
4. Run each migration one at a time
5. Check for any errors in the output

## Post-Migration Steps
After running all migrations:
1. Test the application thoroughly
2. Verify employee notes still display correctly
3. Test file attachments upload/download
4. Ensure all CRUD operations work as expected

---

# Phone Number Standardization Migrations (NEW - 2025-06-19)

## Overview
These migrations fix the issue where customers appear as "Unknown" due to inconsistent phone number formats in the database.

## The Problem
- Some customers have phone numbers stored as `07990587315` (UK format)
- Others have `+447990587315` (E.164 international format)
- When Twilio sends SMS webhooks with `+447990587315`, it doesn't match `07990587315` in the database
- This creates duplicate "Unknown" customers

## Migration Files

### 7. `20250619_standardize_phone_numbers.sql` (HIGH PRIORITY)
**Run this FIRST before the merge migration**

This migration:
- Converts all UK mobile numbers from `07...` to `+447...` format
- Fixes malformed numbers (e.g., numbers with extra digits)
- Updates the messages table to maintain correct links
- Logs any numbers that couldn't be automatically fixed

### 8. `20250619_merge_duplicate_customers.sql` (HIGH PRIORITY)
**Run this SECOND (after the standardization migration)**

This migration:
- Finds "Unknown" customers that match existing customers by phone number
- Merges their data (messages, bookings) into the existing customer
- Deletes the duplicate "Unknown" customers
- Creates audit log entries for the merges
- Cleans up unused "Unknown" customers

## How to Run These Phone Number Migrations

1. Go to your Supabase dashboard
2. Navigate to SQL Editor
3. Copy and paste the content of `20250619_standardize_phone_numbers.sql`
4. Run the migration
5. Check the output messages for any warnings
6. Copy and paste the content of `20250619_merge_duplicate_customers.sql`
7. Run the second migration
8. Check the output messages for merge details

## What to Expect

After running these migrations:
- All customer phone numbers will be in `+447...` format
- Duplicate "Unknown" customers will be merged with their real records
- Messages and bookings will be correctly linked
- Future SMS messages will match existing customers correctly

## Manual Review

The migrations will log any phone numbers that couldn't be automatically fixed. You may need to manually update these in the Customers page.

## Verification

To verify the migrations worked:
1. Check the Customers page - you should see fewer "Unknown" customers
2. Check the Messages page - messages should be linked to the correct customers
3. Send a test SMS - it should match existing customers instead of creating "Unknown" ones

---

# Private Bookings Module Migration (NEW - 2025-01-21)

## Overview
This comprehensive migration adds a complete Private Booking Module for managing venue hire enquiries and bookings.

## Migration File

### 9. `20250121_private_bookings_module.sql` (HIGH PRIORITY)

This migration creates:
- **Core Tables**:
  - `private_bookings` - Main booking records with draft/tentative/confirmed workflow
  - `venue_spaces` - Configurable spaces (Dining Room, Private Garden, etc.)
  - `catering_packages` - Buffet, sit-down meal options with per-head pricing
  - `vendors` - External vendors database (DJs, photographers, etc.)
  
- **Supporting Tables**:
  - `private_booking_items` - Line items for spaces, catering, vendors with discounts
  - `private_booking_sms_queue` - SMS approval queue system
  - `private_booking_documents` - Contract and document storage
  - `private_booking_audit` - Audit trail for all changes

- **Features**:
  - Row Level Security on all tables
  - RBAC permissions for granular access control
  - Automatic balance due date calculation (event date - 7 days)
  - Support for setup time tracking separate from event time
  - Phone number validation following existing patterns
  - Comprehensive indexes for performance

- **Sample Data**:
  - 4 venue spaces (Dining Room, Private Garden, Full Venue, Bar Area)
  - 5 catering packages (Classic Buffet, Premium Buffet, Canapes, etc.)

## How to Run

1. Go to your Supabase dashboard
2. Navigate to SQL Editor
3. Copy and paste the entire content of `20250121_private_bookings_module.sql`
4. Run the migration
5. Check for any errors in the output

## Post-Migration Setup

1. **Verify Permissions**: Check that super_admin, manager, and staff roles have appropriate permissions
2. **Configure Spaces**: Review and adjust the sample venue spaces and pricing
3. **Configure Catering**: Review and adjust the sample catering packages
4. **Test Creation**: Try creating a draft booking to ensure everything works

## Google Calendar Setup (Required Later)

You'll need to provide:
- Google Calendar API credentials
- Calendar ID for "Pub Events" calendar
- OAuth configuration for calendar access

## What This Enables

- Create draft bookings with minimal info (name + date)
- Incrementally add spaces, catering, vendors
- Track deposits (£250 standard) and payments
- SMS queue with approval workflow
- PDF contract generation (implementation to follow)
- Google Calendar integration (implementation to follow)

---

# Event Categories Migration (NEW - 2025-06-21)

## Overview
This migration adds event categorization system for standardizing event types (Quiz Night, Tasting Night, etc.)

## Migration Files

### 10. `20250621_event_categories.sql` (HIGH PRIORITY)

This migration creates:
- `event_categories` table with predefined categories
- Adds `category_id` to events table with proper foreign key constraint
- `customer_category_stats` table for tracking attendance patterns
- Functions for analyzing category performance
- Default categories: Quiz Night, Tasting Night, Bingo Night, Drag Night
- RLS policies for proper access control

## How to Run Event Categories Migration

1. Go to your Supabase dashboard
2. Navigate to SQL Editor
3. Copy and paste the content of `20250621_event_categories.sql`
4. Run the migration
5. **Important**: After running, go to Settings → API and click "Reload Schema" to refresh PostgREST cache

## What This Enables

- Categorize events as Quiz Night, Tasting Night, etc.
- Visual identity with colors and icons for each category
- Track customer preferences by category
- Get smart suggestions for customer invitations
- Filter bulk messages by category attendance
- Dashboard analytics by event category

---

# Add Source Field to Private Bookings (NEW - 2025-06-22)

## Overview
This migration adds a `source` field to the private_bookings table to track where booking enquiries originate from.

## Migration File

### 16. `20250622_add_source_to_private_bookings.sql` (HIGH PRIORITY)

This migration adds:
- `source` column to track booking origin (phone, email, walk-in, website, referral, other)

## How to Run

1. Go to your Supabase dashboard
2. Navigate to SQL Editor
3. Copy and paste the content of `20250622_add_source_to_private_bookings.sql`
4. Run the migration
5. Check for any errors in the output

## What This Fixes

- Resolves the "Could not find the 'source' column" error when creating private bookings
- Enables tracking of where booking enquiries come from for marketing insights

---

# Runtime Error Fixes Migration (NEW - 2025-01-21)

## Overview
This migration fixes runtime errors related to employee_notes column naming and audit_logs permissions that were causing dashboard widgets to fail.

## Migration File

### 11. `20250121_fix_runtime_errors.sql` (HIGH PRIORITY)

This migration fixes:
- **Employee Notes Column Names**: 
  - Renames `note` to `note_text` if needed (matches initial schema)
  - Renames `created_by` to `created_by_user_id` if needed
  
- **Audit Logs Permissions**:
  - Creates proper RLS policies for audit_logs table
  - Allows users with `settings:view` permission to read all logs
  - Allows users without permission to see only their own logs
  - Restricts inserts to service role only (server actions)

## How to Run

1. Go to your Supabase dashboard
2. Navigate to SQL Editor
3. Copy and paste the content of `20250121_fix_runtime_errors.sql`
4. Run the migration
5. Check for any errors in the output

## What This Fixes

- EmployeeActivityWidget will properly load employee notes
- AuditTrailWidget will handle permissions gracefully
- Dashboard will load without console errors
- Users without audit permissions won't see permission errors

---

# Type Definition and Permission Fixes (NEW - 2025-01-21)

## Overview
These migrations fix type mismatches between the database and application, and add missing permissions.

## Migration Files

### 12. `20250121_fix_type_definitions.sql` (HIGH PRIORITY)

This migration adds missing columns to the messages table:
- `segments` - Number of SMS segments (used in cost calculations)
- `cost_usd` - Estimated cost in USD (used in SMS tracking)

These columns are already being referenced in the application code but were missing from the database.

### 13. `20250121_add_events_manage_permission.sql` (HIGH PRIORITY)

This migration adds the missing `events:manage` permission that is:
- Referenced in the settings page for Event Categories access
- Needed for managers to configure event categories
- Grants the permission to super_admin and manager roles

## How to Run

1. Go to your Supabase dashboard
2. Navigate to SQL Editor
3. Run `20250121_fix_type_definitions.sql` first
4. Then run `20250121_add_events_manage_permission.sql`
5. Check for any errors in the output

## What This Fixes

- SMS cost tracking will work properly with segments and cost data
- Event Categories link in settings will be visible to managers
- TypeScript types will match the database schema

---

# Customer Name Field Split Migration (NEW - 2025-01-21)

## Overview
This migration splits the `customer_name` field in private bookings into `customer_first_name` and `customer_last_name` to enable more personalized SMS messaging and better integration with the customers table.

## Migration File

### 14. `20250121_split_customer_name_fields.sql` (HIGH PRIORITY)

This migration:
- Adds `customer_first_name` and `customer_last_name` columns to `private_bookings`
- Migrates existing data by intelligently splitting the current `customer_name`
- Creates a generated `customer_full_name` column for backward compatibility
- Updates the view to use the new fields
- Adds trigger to sync names from customers table when linked
- Preserves the old `customer_name` column (marked as deprecated)

## How to Run

1. Go to your Supabase dashboard
2. Navigate to SQL Editor
3. Copy and paste the content of `20250121_split_customer_name_fields.sql`
4. Run the migration
5. Check for any errors in the output

## What This Enables

- More personal SMS messages using first name only (e.g., "Hi John" instead of "Hi John Smith")
- Better integration with customers table
- Automatic name syncing when a customer record is linked
- Maintains backward compatibility during transition

## Post-Migration Notes

- The old `customer_name` field remains but is deprecated
- All new bookings will use the split fields
- SMS templates now use `{customer_first_name}` for personalization
- The UI has been updated to show separate first/last name fields

---

# Audit Logs Permission Fix (NEW - 2025-06-21)

## Overview
This migration fixes 403 (Forbidden) errors when dashboard components try to access audit logs.

## Migration File

### 15. `20250621_fix_audit_logs_permissions.sql` (HIGH PRIORITY)

This migration:
- Updates Row Level Security policies to allow dashboard widgets to access certain audit logs
- Adds the `audit_logs` module to the permissions system
- Creates three access levels:
  1. Full access for users with audit_logs permission
  2. Limited access for dashboard widgets (employee, message_template, bulk_message activities)
  3. Users can view their own login/logout activity
- Adds performance indexes for dashboard queries
- Grants audit_logs permissions to super_admin role

## How to Run

1. Go to your Supabase dashboard
2. Navigate to SQL Editor
3. Copy and paste the content of `20250621_fix_audit_logs_permissions.sql`
4. Run the migration
5. Check for any errors in the output

## What This Fixes

- Dashboard widgets (EmployeeActivityWidget, AuditTrailWidget) will load without 403 errors
- Recent activity feeds will display properly
- Users can see limited audit data for dashboard purposes
- Super admins can access full audit logs via Settings → Audit Logs

## Post-Migration Notes

- Regular users can now see limited audit data for dashboard widgets
- Full audit log access requires the audit_logs permission
- The policy maintains security while fixing the dashboard errors

---

# Phone Validation and SMS Queue Fix (NEW - 2025-06-22)

## Overview
This migration fixes migration errors related to phone number validation constraints and the scheduled_for column in private_booking_sms_queue.

## Migration File

### 17. `20250622_fix_phone_validation_and_sms_queue.sql` (HIGH PRIORITY)

This migration:
- **Phone Number Standardization**:
  - Creates a function to convert UK phone numbers to E.164 format
  - Handles various formats: 07xxx, +447xxx, 00447xxx, etc.
  - Logs all phone number changes to audit_logs for transparency
  - Updates customer and employee phone numbers to standardized format
  
- **Validation Constraints**:
  - Applies phone number constraints (E.164 format validation)
  - Adds email format validation
  - Adds name format validation (letters, spaces, hyphens, apostrophes)
  - Adds date of birth validation (must be in past, after 1900)
  
- **SMS Queue Fix**:
  - Checks if scheduled_for column already exists before adding
  - Prevents "column already exists" errors
  - Adds proper index for scheduled message queries
  
- **Additional Features**:
  - Booking date validation (prevents past event bookings)
  - Private booking date validation (prevents past date creation)
  - Booking capacity checks (prevents overbooking)
  - Performance indexes on phone number fields

## How to Run

1. Go to your Supabase dashboard
2. Navigate to SQL Editor
3. Copy and paste the content of `20250622_fix_phone_validation_and_sms_queue.sql`
4. Run the migration
5. Check the audit_logs table for details of any phone numbers that were changed

## What This Fixes

- Resolves "violates check constraint" errors for phone numbers
- Standardizes all phone numbers to E.164 format (+447xxxxxxxxx)
- Prevents "column already exists" error for scheduled_for
- Ensures data validation for better data quality
- Improves SMS delivery by ensuring consistent phone formats

## Post-Migration Notes

- All UK phone numbers will be in +447xxxxxxxxx format
- Invalid phone numbers that couldn't be standardized will be set to NULL
- Check audit_logs for a record of all phone number changes
- The standardize_uk_phone function remains available for future use