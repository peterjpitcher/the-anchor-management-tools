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

## Run Order
Run the migrations in this order:
1. `20250115_cleanup_legacy_fields.sql`
2. `20250115_drop_unused_tables.sql`
3. `20250115_fix_employee_notes_created_by.sql`
4. `20250115_add_performance_indexes.sql`
5. `20250115_add_employee_rls_policies.sql`
6. `20250115_fix_storage_bucket_policies.sql`

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