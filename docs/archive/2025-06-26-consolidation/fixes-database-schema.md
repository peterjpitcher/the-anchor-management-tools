# Database Schema Fixes Required

**Last Updated:** June 25, 2025 (Post-Migration Update)  
**Priority:** HIGH (down from CRITICAL)  
**Total Issues:** 25+ → 10 remaining

This document details all database schema issues that need to be fixed, including missing fields, type mismatches, and missing tables.

**🎉 UPDATE:** Private bookings fields have been added! The following have been fixed:
- ✅ All private_bookings missing fields
- ✅ Performance indexes added
- ✅ Some audit_log fields
- ❌ Still need: Settings tables, enhanced event fields, type updates

## 1. Missing Fields in Existing Tables

### private_bookings table

**Missing Customer Information Fields:**
```sql
-- These fields are used in forms but don't exist in the database
ALTER TABLE private_bookings ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id);
ALTER TABLE private_bookings ADD COLUMN IF NOT EXISTS customer_first_name TEXT;
ALTER TABLE private_bookings ADD COLUMN IF NOT EXISTS customer_last_name TEXT;
ALTER TABLE private_bookings ADD COLUMN IF NOT EXISTS contact_phone TEXT;
ALTER TABLE private_bookings ADD COLUMN IF NOT EXISTS contact_email TEXT;
```

**Missing Date/Time Fields:**
```sql
-- Forms expect separate date/time fields
ALTER TABLE private_bookings ADD COLUMN IF NOT EXISTS setup_date DATE;
ALTER TABLE private_bookings ADD COLUMN IF NOT EXISTS setup_time TIME;
ALTER TABLE private_bookings ADD COLUMN IF NOT EXISTS start_time TIME;
ALTER TABLE private_bookings ADD COLUMN IF NOT EXISTS end_time TIME;
```

**Missing Information Fields:**
```sql
-- Additional fields used in forms
ALTER TABLE private_bookings ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE private_bookings ADD COLUMN IF NOT EXISTS customer_requests TEXT;
ALTER TABLE private_bookings ADD COLUMN IF NOT EXISTS deposit_amount DECIMAL(10,2);
ALTER TABLE private_bookings ADD COLUMN IF NOT EXISTS balance_due_date DATE;
```

### customers table

**Missing Fields:**
```sql
ALTER TABLE customers ADD COLUMN IF NOT EXISTS email_address TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS date_of_birth DATE;
```

### events table

**Missing Enhanced Fields:**
```sql
-- SEO and metadata fields
ALTER TABLE events ADD COLUMN IF NOT EXISTS slug TEXT UNIQUE;
ALTER TABLE events ADD COLUMN IF NOT EXISTS short_description TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS long_description TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS highlights TEXT[];
ALTER TABLE events ADD COLUMN IF NOT EXISTS meta_title TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS meta_description TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS keywords TEXT[];

-- Additional time fields
ALTER TABLE events ADD COLUMN IF NOT EXISTS end_time TIME;
ALTER TABLE events ADD COLUMN IF NOT EXISTS doors_time TIME;
ALTER TABLE events ADD COLUMN IF NOT EXISTS duration_minutes INTEGER;
ALTER TABLE events ADD COLUMN IF NOT EXISTS last_entry_time TIME;

-- Event details
ALTER TABLE events ADD COLUMN IF NOT EXISTS event_status TEXT DEFAULT 'scheduled';
ALTER TABLE events ADD COLUMN IF NOT EXISTS performer_name TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS performer_type TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS price_currency TEXT DEFAULT 'GBP';
ALTER TABLE events ADD COLUMN IF NOT EXISTS is_free BOOLEAN DEFAULT false;
ALTER TABLE events ADD COLUMN IF NOT EXISTS booking_url TEXT;

-- Media URLs
ALTER TABLE events ADD COLUMN IF NOT EXISTS hero_image_url TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS gallery_image_urls TEXT[];
ALTER TABLE events ADD COLUMN IF NOT EXISTS poster_image_url TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS thumbnail_image_url TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS promo_video_url TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS highlight_video_urls TEXT[];
```

### audit_logs table

**Missing Fields:**
```sql
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS user_email TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS operation_type TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS resource_type TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS resource_id UUID;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS operation_status TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS old_values JSONB;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS new_values JSONB;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS error_message TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS additional_info JSONB;
```

### message_templates table

**Missing Fields:**
```sql
ALTER TABLE message_templates ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE message_templates ADD COLUMN IF NOT EXISTS template_type TEXT;
ALTER TABLE message_templates ADD COLUMN IF NOT EXISTS is_default BOOLEAN DEFAULT false;
ALTER TABLE message_templates ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id);
ALTER TABLE message_templates ADD COLUMN IF NOT EXISTS character_count INTEGER;
ALTER TABLE message_templates ADD COLUMN IF NOT EXISTS estimated_segments INTEGER;
ALTER TABLE message_templates ADD COLUMN IF NOT EXISTS send_timing TEXT;
ALTER TABLE message_templates ADD COLUMN IF NOT EXISTS custom_timing_hours INTEGER;
```

## 2. Missing Tables

### private_booking_catering_packages
```sql
CREATE TABLE IF NOT EXISTS private_booking_catering_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  name TEXT NOT NULL,
  package_type TEXT NOT NULL,
  per_head_cost DECIMAL(10,2) NOT NULL,
  minimum_order INTEGER DEFAULT 1,
  description TEXT,
  includes TEXT[],
  is_active BOOLEAN DEFAULT true
);

-- Enable RLS
ALTER TABLE private_booking_catering_packages ENABLE ROW LEVEL SECURITY;

-- Add policies
CREATE POLICY "Users can view active catering packages" ON private_booking_catering_packages
  FOR SELECT USING (is_active = true OR user_has_permission(auth.uid(), 'private_bookings', 'manage'));

CREATE POLICY "Users with manage permission can insert" ON private_booking_catering_packages
  FOR INSERT WITH CHECK (user_has_permission(auth.uid(), 'private_bookings', 'manage'));

CREATE POLICY "Users with manage permission can update" ON private_booking_catering_packages
  FOR UPDATE USING (user_has_permission(auth.uid(), 'private_bookings', 'manage'));

CREATE POLICY "Users with manage permission can delete" ON private_booking_catering_packages
  FOR DELETE USING (user_has_permission(auth.uid(), 'private_bookings', 'manage'));
```

### private_booking_spaces
```sql
CREATE TABLE IF NOT EXISTS private_booking_spaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  name TEXT NOT NULL,
  capacity INTEGER NOT NULL,
  hire_cost DECIMAL(10,2) NOT NULL,
  description TEXT,
  amenities TEXT[],
  restrictions TEXT,
  is_active BOOLEAN DEFAULT true
);

-- Enable RLS
ALTER TABLE private_booking_spaces ENABLE ROW LEVEL SECURITY;

-- Add policies (similar to catering packages)
CREATE POLICY "Users can view active spaces" ON private_booking_spaces
  FOR SELECT USING (is_active = true OR user_has_permission(auth.uid(), 'private_bookings', 'manage'));

CREATE POLICY "Users with manage permission can insert" ON private_booking_spaces
  FOR INSERT WITH CHECK (user_has_permission(auth.uid(), 'private_bookings', 'manage'));

CREATE POLICY "Users with manage permission can update" ON private_booking_spaces
  FOR UPDATE USING (user_has_permission(auth.uid(), 'private_bookings', 'manage'));

CREATE POLICY "Users with manage permission can delete" ON private_booking_spaces
  FOR DELETE USING (user_has_permission(auth.uid(), 'private_bookings', 'manage'));
```

### private_booking_vendors
```sql
CREATE TABLE IF NOT EXISTS private_booking_vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  name TEXT NOT NULL,
  vendor_type TEXT NOT NULL,
  contact_name TEXT,
  phone TEXT,
  email TEXT,
  website TEXT,
  typical_rate DECIMAL(10,2),
  notes TEXT,
  is_preferred BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true
);

-- Enable RLS
ALTER TABLE private_booking_vendors ENABLE ROW LEVEL SECURITY;

-- Add policies
CREATE POLICY "Users can view vendors" ON private_booking_vendors
  FOR SELECT USING (user_has_permission(auth.uid(), 'private_bookings', 'view'));

CREATE POLICY "Users with manage permission can insert" ON private_booking_vendors
  FOR INSERT WITH CHECK (user_has_permission(auth.uid(), 'private_bookings', 'manage'));

CREATE POLICY "Users with manage permission can update" ON private_booking_vendors
  FOR UPDATE USING (user_has_permission(auth.uid(), 'private_bookings', 'manage'));

CREATE POLICY "Users with manage permission can delete" ON private_booking_vendors
  FOR DELETE USING (user_has_permission(auth.uid(), 'private_bookings', 'manage'));
```

### customer_category_stats
```sql
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

-- Add policies
CREATE POLICY "Users can view stats" ON customer_category_stats
  FOR SELECT USING (user_has_permission(auth.uid(), 'customers', 'view'));
```

## 3. Type Mismatches

### UUID Fields
All UUID fields in the database should remain as UUID type, but TypeScript is expecting them. The fix is in TypeScript types, not the database.

### Text vs VARCHAR
Several fields use TEXT in the database but forms expect specific lengths. Consider adding constraints:

```sql
-- Add constraints to text fields
ALTER TABLE customers ADD CONSTRAINT phone_format CHECK (mobile_number ~ '^(\+44|0)[0-9]{10,11}$');
ALTER TABLE private_bookings ADD CONSTRAINT email_format CHECK (customer_email ~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$');
```

## 4. Missing Indexes

Add indexes for better performance:

```sql
-- Private bookings
CREATE INDEX IF NOT EXISTS idx_private_bookings_event_date ON private_bookings(event_date);
CREATE INDEX IF NOT EXISTS idx_private_bookings_status ON private_bookings(status);
CREATE INDEX IF NOT EXISTS idx_private_bookings_customer_name ON private_bookings(customer_name);

-- Events
CREATE INDEX IF NOT EXISTS idx_events_date ON events(date);
CREATE INDEX IF NOT EXISTS idx_events_category_id ON events(category_id);
CREATE INDEX IF NOT EXISTS idx_events_slug ON events(slug);

-- Customers
CREATE INDEX IF NOT EXISTS idx_customers_mobile_number ON customers(mobile_number);
CREATE INDEX IF NOT EXISTS idx_customers_messaging_status ON customers(messaging_status);

-- Messages
CREATE INDEX IF NOT EXISTS idx_messages_customer_id ON messages(customer_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status);
```

## 5. Migration Order

Execute migrations in this order to avoid dependency issues:

1. First, add missing columns to existing tables
2. Create new tables (catering, spaces, vendors)
3. Add indexes
4. Add constraints
5. Update RLS policies

## 6. Rollback Plan

Keep rollback scripts ready:

```sql
-- Rollback private_bookings changes
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

-- Drop new tables
DROP TABLE IF EXISTS private_booking_catering_packages;
DROP TABLE IF EXISTS private_booking_spaces;
DROP TABLE IF EXISTS private_booking_vendors;
DROP TABLE IF EXISTS customer_category_stats;
```

## 7. Validation After Migration

Run these queries to validate the migration:

```sql
-- Check all columns exist
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'private_bookings' 
ORDER BY ordinal_position;

-- Check new tables exist
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name LIKE 'private_booking_%';

-- Check indexes
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE schemaname = 'public' 
AND tablename IN ('private_bookings', 'events', 'customers', 'messages');

-- Check RLS is enabled
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename LIKE 'private_booking_%';
```

## Next Steps

After applying database changes:
1. Update TypeScript types to match new schema
2. Update form validations
3. Test all affected forms
4. Run integration tests

See [TypeScript Type Fixes](./fixes-typescript-types.md) for the next steps.