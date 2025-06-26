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