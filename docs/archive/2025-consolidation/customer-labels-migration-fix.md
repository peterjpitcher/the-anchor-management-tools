# Customer Labels Migration Fix

## Issue
The initial migration contained incorrect column references:
- Used `p.resource` instead of `p.module_name`
- This caused PostgreSQL error: `ERROR: 42703: column p.resource does not exist`

## Solution
Updated all RLS policies in the migration to use the correct column name `p.module_name` which matches the actual permissions table structure.

## Changes Made
1. Line 81: `p.resource = 'customers'` → `p.module_name = 'customers'`
2. Line 95: `p.resource = 'customers'` → `p.module_name = 'customers'`
3. Line 108: `p.resource = 'customers'` → `p.module_name = 'customers'`
4. Line 121: `p.resource = 'customers'` → `p.module_name = 'customers'`

## To Apply the Fixed Migration

1. **Via Supabase Dashboard:**
   ```
   1. Go to SQL Editor
   2. Copy the content from: /supabase/migrations/20250706160000_add_customer_labels.sql
   3. Paste and run in the SQL Editor
   ```

2. **Verify Success:**
   ```bash
   tsx scripts/check-customer-labels.ts
   ```

The migration should now execute successfully without any column reference errors.