# Complete Database Documentation

**Generated on:** 2025-06-26T13:41:06.981Z
**Consolidated from:** 6 files

---


# Database Schema

*Source: database-schema.md*

# Database Schema

This document details the complete database schema for The Anchor Management Tools, including all tables, relationships, and constraints.

## Schema Overview

The database uses PostgreSQL via Supabase with the following design principles:
- UUID primary keys for all tables
- Timestamps for audit trails
- Foreign key constraints with appropriate cascade rules
- Row Level Security (RLS) for data protection
- Indexes on frequently queried columns

## Core Tables

### events
Stores information about venue events.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | uuid | PRIMARY KEY, DEFAULT uuid_generate_v4() | Unique event identifier |
| name | text | NOT NULL | Event name |
| date | date | NOT NULL | Event date |
| time | text | NOT NULL | Event time (e.g., "7:00pm") |
| capacity | integer | NULL | Maximum attendees (optional) |
| created_at | timestamptz | NOT NULL, DEFAULT now() | Creation timestamp |

**Indexes:**
- Primary key on `id`
- Index on `date` for chronological queries

### customers
Stores customer information.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | uuid | PRIMARY KEY, DEFAULT uuid_generate_v4() | Unique customer identifier |
| first_name | text | NOT NULL | Customer's first name |
| last_name | text | NOT NULL | Customer's last name |
| mobile_number | text | NOT NULL | Phone number for SMS |
| created_at | timestamptz | NOT NULL, DEFAULT now() | Creation timestamp |

**Indexes:**
- Primary key on `id`
- Index on `mobile_number` for lookups

### bookings
Links customers to events with booking details.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | uuid | PRIMARY KEY, DEFAULT uuid_generate_v4() | Unique booking identifier |
| customer_id | uuid | NOT NULL, REFERENCES customers(id) ON DELETE CASCADE | Customer reference |
| event_id | uuid | NOT NULL, REFERENCES events(id) ON DELETE CASCADE | Event reference |
| seats | integer | NULL | Number of seats (NULL = reminder only) |
| notes | text | NULL | Additional booking notes |
| created_at | timestamptz | NOT NULL, DEFAULT now() | Booking timestamp |

**Indexes:**
- Primary key on `id`
- Index on `customer_id` for customer queries
- Index on `event_id` for event queries
- Unique constraint on `(customer_id, event_id)` to prevent duplicates

## Employee Management Tables

### employees
Comprehensive employee information.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| employee_id | uuid | PRIMARY KEY, DEFAULT uuid_generate_v4() | Unique employee identifier |
| first_name | text | NOT NULL | Employee's first name |
| last_name | text | NOT NULL | Employee's last name |
| date_of_birth | date | NULL | Birth date |
| address | text | NULL | Home address |
| phone_number | text | NULL | Contact phone |
| email_address | text | NOT NULL, UNIQUE | Email (used for login) |
| job_title | text | NOT NULL | Current position |
| employment_start_date | date | NOT NULL | Start date |
| employment_end_date | date | NULL | End date (if applicable) |
| status | text | NOT NULL, DEFAULT 'Active' | Employment status |
| emergency_contact_name | text | NULL | Emergency contact name |
| emergency_contact_phone | text | NULL | Emergency contact phone |
| created_at | timestamptz | NOT NULL, DEFAULT now() | Record creation |
| updated_at | timestamptz | NOT NULL, DEFAULT now() | Last update |

**Indexes:**
- Primary key on `employee_id`
- Unique index on `email_address`
- Index on `status` for filtering

**Triggers:**
- Auto-update `updated_at` on row modification

### employee_notes
Time-stamped notes for employee records.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| note_id | uuid | PRIMARY KEY, DEFAULT uuid_generate_v4() | Unique note identifier |
| employee_id | uuid | NOT NULL, REFERENCES employees(employee_id) ON DELETE CASCADE | Employee reference |
| note_text | text | NOT NULL | Note content |
| created_by | uuid | NULL, REFERENCES auth.users(id) | User who created note |
| created_at | timestamptz | NOT NULL, DEFAULT now() | Note timestamp |

**Indexes:**
- Primary key on `note_id`
- Index on `employee_id` for employee queries
- Index on `created_at` for chronological ordering

### attachment_categories
Categorization for employee documents.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| category_id | uuid | PRIMARY KEY, DEFAULT uuid_generate_v4() | Unique category identifier |
| category_name | text | NOT NULL, UNIQUE | Category name |
| created_at | timestamptz | NOT NULL, DEFAULT now() | Creation timestamp |
| updated_at | timestamptz | NOT NULL, DEFAULT now() | Last update |

**Default Categories:**
- Contract
- ID Scan
- Right to Work Document
- Performance Review
- Other

### employee_attachments
Metadata for employee file attachments.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| attachment_id | uuid | PRIMARY KEY, DEFAULT uuid_generate_v4() | Unique attachment identifier |
| employee_id | uuid | NOT NULL, REFERENCES employees(employee_id) ON DELETE CASCADE | Employee reference |
| category_id | uuid | NOT NULL, REFERENCES attachment_categories(category_id) | Category reference |
| file_name | text | NOT NULL | Original filename |
| storage_path | text | NOT NULL | Supabase Storage path |
| mime_type | text | NOT NULL | File MIME type |
| file_size_bytes | bigint | NOT NULL | File size in bytes |
| description | text | NULL | Optional description |
| uploaded_at | timestamptz | NOT NULL, DEFAULT now() | Upload timestamp |

**Indexes:**
- Primary key on `attachment_id`
- Index on `employee_id` for employee queries
- Index on `category_id` for category filtering

## Relationships

### Entity Relationship Diagram

```
customers ──┐
            ├──< bookings >──── events
            │
employees ──┼──< employee_notes
            │
            └──< employee_attachments >──── attachment_categories
```

### Cascade Rules
- Deleting a customer removes all their bookings
- Deleting an event removes all its bookings
- Deleting an employee removes all notes and attachments
- Attachment files in storage must be manually cleaned

## Row Level Security (RLS)

All tables have RLS enabled with the following policies:

### General Policy Pattern
```sql
-- Example for employees table
CREATE POLICY "Users can view employees" ON employees
    FOR SELECT TO authenticated
    USING (true);

CREATE POLICY "Users can insert employees" ON employees
    FOR INSERT TO authenticated
    WITH CHECK (true);

CREATE POLICY "Users can update employees" ON employees
    FOR UPDATE TO authenticated
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Users can delete employees" ON employees
    FOR DELETE TO authenticated
    USING (true);
```

## Storage Schema

### Bucket: employee-attachments
- **Structure**: `/{employee_id}/{filename}`
- **Access**: Authenticated users only
- **Policies**: CRUD operations for authenticated users
- **Size Limit**: 10MB per file
- **Allowed Types**: PDF, PNG, JPG, JPEG

## Performance Indexes

Critical indexes for query optimization:

```sql
-- Event queries
CREATE INDEX idx_events_date ON events(date);
CREATE INDEX idx_bookings_event_id ON bookings(event_id);

-- Customer queries
CREATE INDEX idx_bookings_customer_id ON bookings(customer_id);

-- Employee queries
CREATE INDEX idx_employee_notes_employee_id ON employee_notes(employee_id);
CREATE INDEX idx_employee_attachments_employee_id ON employee_attachments(employee_id);

-- Composite indexes
CREATE INDEX idx_bookings_event_customer ON bookings(event_id, customer_id);
```

## Data Types and Constraints

### UUID Usage
All primary keys use UUID v4 for:
- Globally unique identifiers
- No sequential information leakage
- Better for distributed systems

### Timestamp Standards
- All timestamps use `timestamptz` (with timezone)
- Stored in UTC, displayed in local time
- Automatic defaults via `now()`

### Text Fields
- No arbitrary length limits
- Validation in application layer
- UTF-8 encoding throughout

## Migration Strategy

Database changes follow these principles:
1. Always create new migrations, never edit existing ones
2. Include both up and down migrations
3. Test in development before production
4. Use transactions for data integrity
5. Document breaking changes

## Backup and Recovery

### Automated Backups
- Daily backups by Supabase
- Point-in-time recovery available
- 7-day retention (free tier)

### Manual Backup Commands
```sql
-- Export schema
pg_dump --schema-only

-- Export data
pg_dump --data-only

-- Full backup
pg_dump --verbose
```

---


# Database Field Usage Report

*Source: database-field-usage-report.md*

# Database Field Usage Report
Generated: 2025-01-21

## Summary

This report analyzes the usage of database fields across the application against the schema at `2025-06-21f-schema.sql`.

## Key Findings

### 1. Type Definition Issues (Fixed)

1. **Message Table** - Missing fields in TypeScript interface:
   - `segments` - Used in SMS cost calculations
   - `cost_usd` - Used in SMS cost tracking
   - **Status**: Fixed in migration `20250121_fix_type_definitions.sql` and updated TypeScript types

2. **Customer Health View** - Not a type issue:
   - Fields like `messaging_status`, `consecutive_failures`, etc. come from the `customer_messaging_health` VIEW
   - The application correctly uses a separate `CustomerHealth` interface for this view
   - **Status**: No fix needed - working as designed

### 2. Unused Database Columns

After thorough analysis, nearly all database columns are actively used. The only truly unused columns are:

#### Generated/Computed Columns (Don't need direct access):
- `message_templates.character_count` - GENERATED column
- `message_templates.estimated_segments` - GENERATED column

#### All Other Tables - Fully Utilized:
- **customers** - All fields used directly or via views
- **events** - All fields used including `category_id`
- **bookings** - All fields used
- **employees** - All fields used including all related tables
- **messages** - All fields used (after adding segments/cost_usd)
- **audit_logs** - Accessed via RPC function `log_audit_event`
- **profiles** - All fields used
- **RBAC tables** - All used for permission checks
- **private_bookings** - All fields used in private bookings module
- **webhook_logs** - All fields used for debugging

### 3. Database Access Patterns

The application uses several patterns to access data:

1. **Direct Table Access**: Most common for CRUD operations
2. **Views**: 
   - `customer_messaging_health` - Aggregates SMS delivery stats
   - `message_templates_with_timing` - Joins templates with timing info
   - `reminder_timing_debug` - For debugging reminder scheduling
3. **RPC Functions**:
   - `log_audit_event` - Handles audit logging with proper field mapping
   - `user_has_permission` - RBAC permission checks
   - `get_message_template` - Template retrieval with event overrides
4. **Computed Fields**: Database handles character counts, segments, etc.

### 4. Schema Integrity

The application correctly handles:
- Foreign key relationships with CASCADE deletes
- Check constraints for data validation
- RLS policies for security
- Triggers for automatic updates (updated_at timestamps)

## Recommendations

1. **Run the type fix migration**: `20250121_fix_type_definitions.sql` to add missing message columns
2. **No unused columns to remove**: The schema is well-utilized
3. **Consider documenting**: The view/RPC function patterns for future developers

## Conclusion

The application and database schema are well-aligned. Only minor type definition updates were needed. All database fields serve a purpose and are either:
- Actively used by the application
- Automatically computed by the database
- Reserved for future features (none found)

The codebase demonstrates good practices in:
- Using views for complex aggregations
- RPC functions for business logic
- Proper TypeScript typing (after fixes)
- Leveraging database features (constraints, triggers, RLS)

---


# Database Schema Analysis Report

*Source: database-schema-analysis-report.md*

# Database Schema Analysis Report

**Date:** 2025-06-26  
**Priority:** P1 - Important but not blocking

## Executive Summary

This comprehensive analysis examined potential database schema mismatches between the codebase expectations and the actual database schema. The investigation found that most reported issues were false positives, and the database schema is largely consistent with code expectations.

## 1. Menu System Schema ✅

### menu_items table
The migration file confirms these columns **exist in the database**:
- ✅ `price_currency` (VARCHAR(3) DEFAULT 'GBP')
- ✅ `available_from` (TIMESTAMPTZ)
- ✅ `available_until` (TIMESTAMPTZ)

All other expected columns also exist:
- id, section_id, name, description, price
- calories, dietary_info, allergens
- is_available, is_special, image_url
- sort_order, created_at, updated_at

**Status:** No issues - all columns exist as expected.

### menu_sections table
The migration file confirms this column **exists in the database**:
- ✅ `is_active` (BOOLEAN DEFAULT true)

All other expected columns also exist:
- id, name, description, sort_order
- created_at, updated_at

**Status:** No issues - all columns exist as expected.

## 2. Private Bookings Schema ✅

### Form Field Analysis
The form field scanner reported 311 potential mismatches, but investigation revealed these are **false positives**:

#### Confirmed fields in private_bookings table:
- ✅ `customer_id` (UUID)
- ✅ `customer_first_name` (TEXT)
- ✅ `customer_last_name` (TEXT)
- ✅ `contact_phone` (TEXT with validation)
- ✅ `contact_email` (TEXT with validation)
- ✅ `source` (TEXT)
- ✅ `setup_date` (DATE)
- ✅ `customer_requests` (TEXT)
- ✅ `internal_notes` (TEXT)
- ✅ `special_requirements` (TEXT)
- ✅ `accessibility_needs` (TEXT)
- ✅ `deposit_amount` (NUMERIC(10,2) DEFAULT 250.00)
- ✅ `balance_due_date` (DATE)

**Status:** No issues - all expected fields exist.

### Settings Pages Architecture
The settings pages correctly reference separate tables:
- Catering settings → `catering_packages` table ✅ (confirmed exists)
- Spaces settings → `venue_spaces` table ✅ (confirmed exists)
- Vendors settings → `vendors` table ✅ (confirmed exists)

## 3. Missing TypeScript Types

The schema consistency check revealed missing TypeScript types for:
- ❌ `customer_category_stats` table (expected type `CustomerCategoryStat`)
- ❌ `event_categories` table (expected type `EventCategory`)
- ❌ `profiles` table (expected type `Profile`)

## 4. Type Mismatches

Common patterns found:
- SQL `uuid` → TypeScript `string` (acceptable)
- SQL `text` → TypeScript `string` (acceptable)
- SQL `timestamp` → TypeScript `string` (acceptable for JSON serialization)
- SQL `jsonb` → TypeScript `Record<string, any>` (acceptable)

These are generally acceptable type conversions for web applications.

## 5. Critical Fixes Already Documented

A critical fixes SQL file exists at `/docs/2025-06-26-085314/critical-fixes-required.sql` that includes:
- Menu system schema fixes (already exist in database)
- Performance indexes
- Security enhancements (RLS policies)

## Recommendations

### Immediate Actions (P1)
1. **Create missing TypeScript types** for:
   - CustomerCategoryStat (used for category analytics)
   - EventCategory (already has data in production)
   - Profile (user profiles table)

### Short-term Actions (P2)
1. **Update the form field scanner** - It's producing false positives due to not understanding table relationships
2. **Add database schema validation** to the CI/CD pipeline
3. **Document table relationships** clearly in the codebase

### Long-term Actions (P3)
1. **Consider using a schema generator** like Prisma or Drizzle for automatic type generation
2. **Add runtime schema validation** for critical operations
3. **Implement database migration testing** in staging before production deployment

## Conclusion

The investigation revealed that **there are no critical database schema issues**:

1. ✅ Menu system tables (`menu_items`, `menu_sections`) have all expected columns
2. ✅ Private bookings table has all expected fields
3. ✅ Related tables (catering_packages, venue_spaces, vendors) exist as expected
4. ⚠️ Only missing TypeScript type definitions for 3 tables (non-blocking)
5. ⚠️ Form field scanner needs improvement (false positives)

The database schema is consistent with code expectations. The critical fixes SQL file appears to be outdated.

## Next Steps

1. Create the 3 missing TypeScript type definitions
2. Remove or archive the outdated critical fixes SQL file
3. Update documentation to reflect current schema state
4. Consider implementing automated type generation from database schema

---


# Private Bookings Field Mapping

*Source: private-bookings-field-mapping.md*

# Private Bookings Field Mapping

This document provides a detailed mapping of all fields in the private bookings system, showing where each field is available across different interfaces.

## Field Availability Matrix

| Field Name | Database | TypeScript | View Page | Create Form | Edit Form | Notes |
|------------|----------|------------|-----------|-------------|-----------|-------|
| **Customer Information** ||||||| 
| customer_id | ✅ | ✅ | ✅ | ✅ | ❌ | Can select in create, but not change in edit |
| customer_name | ✅ | ✅ | ✅ | ❌ | ❌ | Deprecated field |
| customer_first_name | ✅ | ✅ | ✅ | ✅ | ✅ | |
| customer_last_name | ✅ | ✅ | ✅ | ✅ | ✅ | |
| customer_full_name | ✅ | ✅ | ✅ | Auto | Auto | Generated column |
| contact_phone | ✅ | ✅ | ✅ | ✅ | ✅ | |
| contact_email | ✅ | ✅ | ✅ | ✅ | ✅ | |
| **Event Details** ||||||| 
| event_date | ✅ | ✅ | ✅ | ✅ | ✅ | |
| start_time | ✅ | ✅ | ✅ | ✅ | ✅ | |
| setup_date | ✅ | ✅ | ✅ | ✅ | ❌ | Missing in edit form |
| setup_time | ✅ | ✅ | ✅ | ✅ | ✅ | |
| end_time | ✅ | ✅ | ✅ | ✅ | ✅ | |
| guest_count | ✅ | ✅ | ✅ | ✅ | ✅ | |
| event_type | ✅ | ✅ | ✅ | ✅ (text) | ✅ (select) | Inconsistent input types |
| **Status & Workflow** ||||||| 
| status | ✅ | ✅ | ✅ (modal) | Auto 'draft' | ❌ | Only changeable via modal |
| contract_version | ✅ | ✅ | ✅ | Auto 0 | ❌ | |
| calendar_event_id | ✅ | ✅ | ❌ | ❌ | ❌ | Not exposed in UI |
| **Financial Information** ||||||| 
| deposit_amount | ✅ | ✅ | ✅ | Auto 250 | ❌ | Cannot override default |
| deposit_paid_date | ✅ | ✅ | ✅ (modal) | ❌ | ❌ | Via payment modal only |
| deposit_payment_method | ✅ | ✅ | ✅ (modal) | ❌ | ❌ | Via payment modal only |
| total_amount | ✅ | ✅ | ✅ | Auto 0 | ❌ | Calculated from items |
| balance_due_date | ✅ | ✅ | ✅ | Auto calc | ❌ | Auto-calculated, not editable |
| final_payment_date | ✅ | ✅ | ✅ (modal) | ❌ | ❌ | Via payment modal only |
| final_payment_method | ✅ | ✅ | ✅ (modal) | ❌ | ❌ | Via payment modal only |
| **Discount Information** ||||||| 
| discount_type | ✅ | ✅ | ✅ (modal) | ❌ | ❌ | Via discount modal only |
| discount_amount | ✅ | ✅ | ✅ (modal) | ❌ | ❌ | Via discount modal only |
| discount_reason | ✅ | ✅ | ✅ (modal) | ❌ | ❌ | Via discount modal only |
| **Notes & Requirements** ||||||| 
| internal_notes | ✅ | ✅ | ✅ | ✅ | ✅ | |
| customer_requests | ✅ | ✅ | ✅ | ✅ | ✅ | |
| special_requirements | ✅ | ✅ | ✅ | ❌ | ❌ | Field exists but not in forms |
| accessibility_needs | ✅ | ✅ | ✅ | ❌ | ❌ | Field exists but not in forms |
| **Tracking & Metadata** ||||||| 
| source | ✅ | ✅ | ✅ | ❌ | ❌ | Field exists but not in forms |
| created_by | ✅ | ✅ | ✅ | Auto | N/A | Set automatically |
| created_at | ✅ | ✅ | ✅ | Auto | N/A | Set automatically |
| updated_at | ✅ | ✅ | ✅ | N/A | Auto | Updated automatically |

## Field Access Patterns

### 1. **Full Access** (can create and edit via forms)
- customer_first_name
- customer_last_name
- contact_phone
- contact_email
- event_date
- start_time
- end_time
- guest_count
- setup_time
- internal_notes
- customer_requests

### 2. **Create Only** (can set on creation but not edit)
- customer_id (customer selection)
- setup_date

### 3. **Modal Only** (requires separate modal on view page)
- status
- All payment fields (deposit/final payment dates and methods)
- All discount fields (type, amount, reason)

### 4. **View Only** (displayed but not editable anywhere)
- customer_full_name (generated)
- created_at, created_by
- updated_at
- balance_due_date (auto-calculated)
- calculated_total (from items)

### 5. **Hidden** (in database but not exposed in UI)
- special_requirements
- accessibility_needs
- source
- calendar_event_id

### 6. **Inconsistent** (different behavior in different forms)
- event_type: Free text in create, dropdown in edit

## Impact Analysis

### High Impact Issues

1. **Accessibility Gap**: `special_requirements` and `accessibility_needs` fields exist but are completely inaccessible through the UI, potentially causing compliance issues.

2. **Customer Lock-in**: Once a booking is created with a customer, it cannot be reassigned to a different customer, requiring recreation of the entire booking if the wrong customer was selected.

3. **Financial Inflexibility**: Cannot set custom deposit amounts or override the auto-calculated balance due date during booking creation.

### Medium Impact Issues

4. **Two-Step Workflows**: Many common operations require navigating to the view page and opening modals rather than being available in the main forms.

5. **Missing Business Intelligence**: The `source` field could track how bookings originate (phone, email, walk-in, etc.) but is not exposed.

6. **Setup Date Asymmetry**: Can set setup_date when creating but not when editing, forcing users to remember to set it correctly on creation.

### Low Impact Issues

7. **Type Inconsistency**: The event_type field behavior differs between forms, potentially confusing users.

8. **Hidden Metadata**: Fields like calendar_event_id exist but have no UI, suggesting incomplete feature implementation.

## Recommendations Priority

### Critical (Do First)
1. Add `special_requirements` and `accessibility_needs` to both create and edit forms
2. Add `source` field with predefined options (Phone, Email, Walk-in, Website, Other)
3. Make `event_type` consistent across forms

### Important (Do Soon)
4. Add customer re-selection to edit form
5. Add `setup_date` to edit form
6. Allow deposit amount override in create form
7. Add ability to manually set balance_due_date

### Nice to Have (Future)
8. Expose calendar_event_id for integration purposes
9. Add bulk status change functionality
10. Create booking templates for common event types

---


# Migration Cleanup Guide

*Source: migration-cleanup-guide.md*

# Migration Cleanup Guide

This guide explains how to clean up and consolidate Supabase migrations into a single baseline migration that matches your production database.

## Overview

When migrations become fragmented or inconsistent with production, it's best to create a fresh baseline. This process archives old migrations and creates a single migration file representing the current production state.

## Prerequisites

- Supabase CLI installed and configured
- Access to production database
- Local Supabase instance running (`supabase start`)

## Step-by-Step Process

### 1. Backup Current Data

First, create a complete backup of your database data:

```bash
supabase db dump --data-only > backup_$(date +%Y%m%d_%H%M%S).sql
```

This creates a timestamped backup file (e.g., `backup_20250625_223259.sql`) containing all your data.

### 2. Archive Existing Migrations

Preserve your old migrations for reference:

```bash
# Create archive directory with timestamp
mkdir -p supabase/migrations/archive_$(date +%Y%m%d)

# Move all existing migrations to archive
mv supabase/migrations/*.sql supabase/migrations/archive_$(date +%Y%m%d)/ 2>/dev/null || true

# If migrations are in subdirectories (like "already run")
mv "supabase/migrations/already run" supabase/migrations/archive_$(date +%Y%m%d)/ 2>/dev/null || true
```

### 3. Create Fresh Baseline from Production

Dump the complete schema from your production database:

```bash
# Create a new baseline migration with timestamp
supabase db dump --schema public > supabase/migrations/$(date +%Y%m%d%H%M%S)_initial_baseline.sql
```

This creates a migration file like `20250625223323_initial_baseline.sql` containing your entire production schema.

### 4. Add Documentation Header

Add a comment at the top of your baseline migration for clarity:

```bash
# Get the migration filename
MIGRATION_FILE=$(ls -t supabase/migrations/*.sql | head -1)

# Add header (using a temporary file to prepend)
echo "--
-- Baseline migration created from production schema on $(date +%Y-%m-%d)
-- Previous migrations archived in archive_$(date +%Y%m%d) folder
-- This represents the complete schema as deployed in production
--
" | cat - "$MIGRATION_FILE" > temp && mv temp "$MIGRATION_FILE"
```

### 5. Reset Local Database

Apply the new baseline to your local database:

```bash
# Ensure Supabase is running
supabase start

# Reset local database with new migrations
supabase db reset --local
```

This will:
- Drop and recreate your local database
- Apply the baseline migration
- Seed any data if you have seed files

### 6. Verify the Migration

Confirm that all expected tables exist:

```bash
# Check all tables
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c \
  "SELECT table_name FROM information_schema.tables 
   WHERE table_schema = 'public' 
   AND table_type = 'BASE TABLE' 
   ORDER BY table_name;"

# Check specific tables
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c \
  "SELECT table_name FROM information_schema.tables 
   WHERE table_schema = 'public' 
   AND table_name IN ('catering_packages', 'vendors', 'venue_spaces');"
```

### 7. Create Team Documentation

Document the reset for your team:

```bash
cat > MIGRATION_RESET_NOTES.md << 'EOF'
# Migration Reset Documentation

**Date:** $(date +%Y-%m-%d)
**Reason:** Consolidate migrations and resolve schema inconsistencies

## What Was Done

1. Backed up all data
2. Archived existing migrations to `supabase/migrations/archive_$(date +%Y%m%d)/`
3. Created fresh baseline migration from production schema
4. Reset local database with new baseline
5. Verified all tables exist and match production

## For Team Members

To update your local environment:

1. Pull latest changes
2. Stop local Supabase: `supabase stop`
3. Start Supabase: `supabase start`
4. Reset database: `supabase db reset --local`

## Next Steps

All future migrations should be created on top of the baseline migration.
EOF
```

## Complete Script

Here's a complete script that performs all steps:

```bash
#!/bin/bash
set -e

echo "🔄 Starting migration cleanup..."

# 1. Backup data
echo "📦 Creating backup..."
supabase db dump --data-only > backup_$(date +%Y%m%d_%H%M%S).sql

# 2. Archive old migrations
echo "📁 Archiving old migrations..."
ARCHIVE_DIR="supabase/migrations/archive_$(date +%Y%m%d)"
mkdir -p "$ARCHIVE_DIR"
find supabase/migrations -name "*.sql" -exec mv {} "$ARCHIVE_DIR/" \; 2>/dev/null || true
[ -d "supabase/migrations/already run" ] && mv "supabase/migrations/already run" "$ARCHIVE_DIR/" || true

# 3. Create baseline
echo "📝 Creating baseline migration..."
TIMESTAMP=$(date +%Y%m%d%H%M%S)
supabase db dump --schema public > "supabase/migrations/${TIMESTAMP}_initial_baseline.sql"

# 4. Add header
MIGRATION_FILE="supabase/migrations/${TIMESTAMP}_initial_baseline.sql"
echo "--
-- Baseline migration created from production schema on $(date +%Y-%m-%d)
-- Previous migrations archived in $ARCHIVE_DIR
-- This represents the complete schema as deployed in production
--
" | cat - "$MIGRATION_FILE" > temp && mv temp "$MIGRATION_FILE"

# 5. Reset local database
echo "🔄 Resetting local database..."
supabase db reset --local

# 6. Verify
echo "✅ Verifying tables..."
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c \
  "SELECT COUNT(*) as table_count FROM information_schema.tables 
   WHERE table_schema = 'public' AND table_type = 'BASE TABLE';"

echo "✨ Migration cleanup complete!"
```

## Important Notes

1. **Team Coordination**: Notify all team members before doing this
2. **Branch Compatibility**: Old feature branches may have migration conflicts
3. **Production Safety**: This process doesn't affect production - it only creates a local baseline
4. **Backup Retention**: Keep archived migrations for at least 30 days
5. **Migration History**: The production migration history table remains unchanged

## Troubleshooting

### Local Supabase won't start
```bash
supabase stop --no-backup
docker system prune -a
supabase start
```

### Migration conflicts
- Ensure all `.sql` files are moved to archive
- Check for hidden files: `ls -la supabase/migrations/`
- Remove any `.md` files from migrations directory

### Database connection issues
- Default local connection: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`
- Check Supabase status: `supabase status`
- Verify Docker is running

## Database Connection Methods

The commands above use `psql` to connect directly to the local Supabase database:

- **Host**: 127.0.0.1 (localhost)
- **Port**: 54322 (Supabase's PostgreSQL port)
- **Username**: postgres
- **Password**: postgres
- **Database**: postgres

You can also use:
- `supabase db execute` - But has limited functionality
- Supabase Studio UI at http://localhost:54323
- Any PostgreSQL client (TablePlus, pgAdmin, etc.)

---


# Database Migration Guide

*Source: fixes-migration-guide.md*

# Database Migration Guide

**Last Updated:** June 25, 2025  
**Priority:** CRITICAL  
**Estimated Time:** 2-3 hours

This guide provides step-by-step instructions for applying all required database migrations to fix the form field mismatches and missing tables.

## Prerequisites

- Access to Supabase dashboard
- Database admin permissions
- Backup of current database
- Maintenance window scheduled

## Pre-Migration Checklist

- [ ] Create full database backup
- [ ] Notify users of maintenance window
- [ ] Test migrations on staging environment
- [ ] Prepare rollback scripts
- [ ] Have monitoring ready

## Migration Files

Create these migration files in `/supabase/migrations/`:

### 1. `20250625_01_fix_private_bookings_fields.sql`

```sql
-- Fix private bookings missing fields
BEGIN;

-- Add customer information fields
ALTER TABLE private_bookings 
ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id),
ADD COLUMN IF NOT EXISTS customer_first_name TEXT,
ADD COLUMN IF NOT EXISTS customer_last_name TEXT,
ADD COLUMN IF NOT EXISTS contact_phone TEXT,
ADD COLUMN IF NOT EXISTS contact_email TEXT;

-- Add date/time fields
ALTER TABLE private_bookings
ADD COLUMN IF NOT EXISTS setup_date DATE,
ADD COLUMN IF NOT EXISTS setup_time TIME,
ADD COLUMN IF NOT EXISTS start_time TIME,
ADD COLUMN IF NOT EXISTS end_time TIME;

-- Add missing information fields
ALTER TABLE private_bookings
ADD COLUMN IF NOT EXISTS source TEXT,
ADD COLUMN IF NOT EXISTS customer_requests TEXT,
ADD COLUMN IF NOT EXISTS deposit_amount DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS balance_due_date DATE;

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_private_bookings_customer_id ON private_bookings(customer_id);
CREATE INDEX IF NOT EXISTS idx_private_bookings_customer_email ON private_bookings(customer_email);

COMMIT;
```

### 2. `20250625_02_create_settings_tables.sql`

```sql
-- Create tables for private booking settings
BEGIN;

-- Catering packages table
CREATE TABLE IF NOT EXISTS private_booking_catering_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  name TEXT NOT NULL,
  package_type TEXT NOT NULL CHECK (package_type IN ('buffet', 'plated', 'canapes', 'drinks', 'custom')),
  per_head_cost DECIMAL(10,2) NOT NULL CHECK (per_head_cost >= 0),
  minimum_order INTEGER DEFAULT 1 CHECK (minimum_order > 0),
  description TEXT,
  includes TEXT[],
  dietary_options TEXT[],
  is_active BOOLEAN DEFAULT true NOT NULL
);

-- Spaces table
CREATE TABLE IF NOT EXISTS private_booking_spaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  name TEXT NOT NULL,
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  hire_cost DECIMAL(10,2) NOT NULL CHECK (hire_cost >= 0),
  description TEXT,
  amenities TEXT[],
  restrictions TEXT,
  floor_plan_url TEXT,
  gallery_urls TEXT[],
  is_active BOOLEAN DEFAULT true NOT NULL
);

-- Vendors table
CREATE TABLE IF NOT EXISTS private_booking_vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  name TEXT NOT NULL,
  vendor_type TEXT NOT NULL CHECK (vendor_type IN ('catering', 'entertainment', 'decoration', 'photography', 'other')),
  contact_name TEXT,
  phone TEXT,
  email TEXT,
  website TEXT,
  typical_rate DECIMAL(10,2),
  rate_type TEXT CHECK (rate_type IN ('hourly', 'fixed', 'percentage')),
  notes TEXT,
  is_preferred BOOLEAN DEFAULT false NOT NULL,
  is_active BOOLEAN DEFAULT true NOT NULL,
  insurance_verified BOOLEAN DEFAULT false,
  insurance_expiry DATE,
  certifications TEXT[]
);

-- Add updated_at triggers
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_private_booking_catering_packages_updated_at
  BEFORE UPDATE ON private_booking_catering_packages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_private_booking_spaces_updated_at
  BEFORE UPDATE ON private_booking_spaces
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_private_booking_vendors_updated_at
  BEFORE UPDATE ON private_booking_vendors
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMIT;
```

### 3. `20250625_03_add_rls_policies.sql`

```sql
-- Add RLS policies for new tables
BEGIN;

-- Enable RLS
ALTER TABLE private_booking_catering_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE private_booking_spaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE private_booking_vendors ENABLE ROW LEVEL SECURITY;

-- Catering packages policies
CREATE POLICY "Anyone can view active catering packages" ON private_booking_catering_packages
  FOR SELECT USING (is_active = true);

CREATE POLICY "Staff can view all catering packages" ON private_booking_catering_packages
  FOR SELECT USING (user_has_permission(auth.uid(), 'private_bookings', 'view'));

CREATE POLICY "Managers can manage catering packages" ON private_booking_catering_packages
  FOR ALL USING (user_has_permission(auth.uid(), 'private_bookings', 'manage'));

-- Spaces policies
CREATE POLICY "Anyone can view active spaces" ON private_booking_spaces
  FOR SELECT USING (is_active = true);

CREATE POLICY "Staff can view all spaces" ON private_booking_spaces
  FOR SELECT USING (user_has_permission(auth.uid(), 'private_bookings', 'view'));

CREATE POLICY "Managers can manage spaces" ON private_booking_spaces
  FOR ALL USING (user_has_permission(auth.uid(), 'private_bookings', 'manage'));

-- Vendors policies
CREATE POLICY "Staff can view vendors" ON private_booking_vendors
  FOR SELECT USING (user_has_permission(auth.uid(), 'private_bookings', 'view'));

CREATE POLICY "Managers can manage vendors" ON private_booking_vendors
  FOR ALL USING (user_has_permission(auth.uid(), 'private_bookings', 'manage'));

COMMIT;
```

### 4. `20250625_04_fix_other_tables.sql`

```sql
-- Fix other table issues
BEGIN;

-- Fix customers table
ALTER TABLE customers
ADD COLUMN IF NOT EXISTS email TEXT,
ADD COLUMN IF NOT EXISTS notes TEXT,
ADD COLUMN IF NOT EXISTS date_of_birth DATE;

-- Fix audit_logs table
ALTER TABLE audit_logs
ADD COLUMN IF NOT EXISTS user_email TEXT,
ADD COLUMN IF NOT EXISTS operation_type TEXT,
ADD COLUMN IF NOT EXISTS resource_type TEXT,
ADD COLUMN IF NOT EXISTS resource_id UUID,
ADD COLUMN IF NOT EXISTS operation_status TEXT,
ADD COLUMN IF NOT EXISTS old_values JSONB,
ADD COLUMN IF NOT EXISTS new_values JSONB,
ADD COLUMN IF NOT EXISTS error_message TEXT,
ADD COLUMN IF NOT EXISTS additional_info JSONB;

-- Fix message_templates table
ALTER TABLE message_templates
ADD COLUMN IF NOT EXISTS description TEXT,
ADD COLUMN IF NOT EXISTS template_type TEXT,
ADD COLUMN IF NOT EXISTS is_default BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id),
ADD COLUMN IF NOT EXISTS character_count INTEGER,
ADD COLUMN IF NOT EXISTS estimated_segments INTEGER,
ADD COLUMN IF NOT EXISTS send_timing TEXT,
ADD COLUMN IF NOT EXISTS custom_timing_hours INTEGER;

-- Create customer category stats table
CREATE TABLE IF NOT EXISTS customer_category_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  category_id UUID REFERENCES event_categories(id) ON DELETE CASCADE,
  total_bookings INTEGER DEFAULT 0,
  last_booking_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(customer_id, category_id)
);

-- Enable RLS
ALTER TABLE customer_category_stats ENABLE ROW LEVEL SECURITY;

-- Add policy
CREATE POLICY "Staff can view customer stats" ON customer_category_stats
  FOR SELECT USING (user_has_permission(auth.uid(), 'customers', 'view'));

COMMIT;
```

### 5. `20250625_05_add_indexes.sql`

```sql
-- Add performance indexes
BEGIN;

-- Private bookings
CREATE INDEX IF NOT EXISTS idx_private_bookings_event_date ON private_bookings(event_date);
CREATE INDEX IF NOT EXISTS idx_private_bookings_status ON private_bookings(status);
CREATE INDEX IF NOT EXISTS idx_private_bookings_customer_name ON private_bookings(customer_name);

-- Events
CREATE INDEX IF NOT EXISTS idx_events_date ON events(date);
CREATE INDEX IF NOT EXISTS idx_events_category_id ON events(category_id);

-- Customers
CREATE INDEX IF NOT EXISTS idx_customers_mobile_number ON customers(mobile_number);
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);

-- Messages
CREATE INDEX IF NOT EXISTS idx_messages_customer_id ON messages(customer_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status);

-- New tables
CREATE INDEX IF NOT EXISTS idx_catering_packages_active ON private_booking_catering_packages(is_active);
CREATE INDEX IF NOT EXISTS idx_spaces_active ON private_booking_spaces(is_active);
CREATE INDEX IF NOT EXISTS idx_vendors_type ON private_booking_vendors(vendor_type, is_active);

COMMIT;
```

## Execution Steps

### 1. Local Testing

```bash
# Test on local Supabase
supabase db reset
supabase migration new fix_form_fields
# Copy migration content
supabase db push
```

### 2. Staging Deployment

```bash
# Apply to staging
supabase db push --db-url postgresql://[staging-connection-string]
# Test all forms
# Run automated tests
```

### 3. Production Deployment

#### Via Supabase Dashboard:

1. Go to SQL Editor
2. Create new query
3. Paste each migration file
4. Run in order (01, 02, 03, 04, 05)
5. Verify each step

#### Via CLI:

```bash
# Apply migrations
supabase migration up --db-url postgresql://[production-connection-string]
```

### 4. Verification Queries

Run these after each migration:

```sql
-- Verify private_bookings columns
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'private_bookings' 
AND column_name IN ('customer_id', 'customer_first_name', 'contact_phone')
ORDER BY ordinal_position;

-- Verify new tables exist
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name LIKE 'private_booking_%';

-- Check RLS is enabled
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename LIKE 'private_booking_%';

-- Count records (should be 0 for new tables)
SELECT 
  (SELECT COUNT(*) FROM private_booking_catering_packages) as catering_count,
  (SELECT COUNT(*) FROM private_booking_spaces) as spaces_count,
  (SELECT COUNT(*) FROM private_booking_vendors) as vendors_count;
```

## Post-Migration Steps

### 1. Update Application Code

```bash
# Pull latest code with fixes
git pull origin main

# Install dependencies
npm install

# Build and test
npm run build
npm run test
```

### 2. Deploy Application

```bash
# Deploy to Vercel
vercel --prod

# Or manual deployment
npm run build
npm run start
```

### 3. Smoke Tests

Test these critical paths:
- [ ] Create new private booking
- [ ] Edit existing private booking  
- [ ] Add catering package
- [ ] Add venue space
- [ ] Add vendor
- [ ] Send test SMS
- [ ] Create new event
- [ ] View audit logs

### 4. Monitor for Errors

Check for:
- 500 errors in logs
- Database connection errors
- Form submission failures
- Performance degradation

## Rollback Scripts

Keep these ready in case of issues:

### Rollback Private Bookings

```sql
BEGIN;

ALTER TABLE private_bookings 
DROP COLUMN IF EXISTS customer_id,
DROP COLUMN IF EXISTS customer_first_name,
DROP COLUMN IF EXISTS customer_last_name,
DROP COLUMN IF EXISTS contact_phone,
DROP COLUMN IF EXISTS contact_email,
DROP COLUMN IF EXISTS setup_date,
DROP COLUMN IF EXISTS setup_time,
DROP COLUMN IF EXISTS start_time,
DROP COLUMN IF EXISTS end_time,
DROP COLUMN IF EXISTS source,
DROP COLUMN IF EXISTS customer_requests,
DROP COLUMN IF EXISTS deposit_amount,
DROP COLUMN IF EXISTS balance_due_date;

DROP INDEX IF EXISTS idx_private_bookings_customer_id;
DROP INDEX IF EXISTS idx_private_bookings_customer_email;

COMMIT;
```

### Rollback New Tables

```sql
BEGIN;

DROP TABLE IF EXISTS private_booking_catering_packages CASCADE;
DROP TABLE IF EXISTS private_booking_spaces CASCADE;
DROP TABLE IF EXISTS private_booking_vendors CASCADE;
DROP TABLE IF EXISTS customer_category_stats CASCADE;

COMMIT;
```

## Troubleshooting

### Common Issues

1. **Migration fails with "column already exists"**
   - Safe to ignore, migration is idempotent
   - Continue with next migration

2. **RLS policy errors**
   - Check user_has_permission function exists
   - Verify auth schema is accessible

3. **Performance degradation**
   - Run ANALYZE on affected tables
   - Check index usage with EXPLAIN

4. **Application errors after migration**
   - Clear application cache
   - Restart application servers
   - Check environment variables

## Success Criteria

- [ ] All migrations applied successfully
- [ ] No errors in application logs
- [ ] All forms submit successfully
- [ ] Performance metrics normal
- [ ] Users can access all features

## Next Steps

After successful migration:
1. Update documentation
2. Notify team of completion
3. Monitor for 24 hours
4. Plan data migration if needed

See [ESLint Fixes](./fixes-eslint-issues.md) for code quality improvements.

---

