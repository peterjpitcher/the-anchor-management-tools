# Loyalty Program Migration Instructions

## ⚠️ CURRENT ISSUE: Partial Migration Applied
The loyalty program migration has been **PARTIALLY APPLIED**. You're seeing "ERROR: 42P07: relation 'idx_loyalty_members_customer_id' already exists" because some tables/indexes were created before the migration failed.

## You Have Two Options:

### Option 1: Check Progress and Use Safe Migration (RECOMMENDED)

1. **First, check what already exists:**
   ```sql
   -- Run scripts/check-loyalty-migration-progress.sql in Supabase SQL editor
   ```
   This will show you which tables, indexes, and permissions already exist.

2. **Use the safe migration file:**
   ```sql
   -- Run the contents of supabase/migrations/20240715000000_loyalty_program_safe.sql
   ```
   This version uses `IF NOT EXISTS` and `ON CONFLICT DO NOTHING` clauses, so it can be run multiple times safely. It will skip objects that already exist and create only the missing ones.

### Option 2: Clean Up and Start Fresh

**⚠️ WARNING: This will DELETE all loyalty data if any exists**

1. **Check what will be deleted:**
   ```sql
   -- Run the first part of scripts/cleanup-partial-loyalty-migration.sql
   ```

2. **If you're sure you want to start fresh:**
   - Uncomment the cleanup commands in the script
   - Run the cleanup
   - Then run the original migration

## After Successful Migration

### 1. Verify Everything Was Created
```sql
-- Check all loyalty tables exist
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name LIKE 'loyalty%'
ORDER BY table_name;

-- Should return 10 tables:
-- customer_achievements
-- event_check_ins  
-- loyalty_achievements
-- loyalty_campaigns
-- loyalty_members
-- loyalty_point_transactions
-- loyalty_programs
-- loyalty_rewards
-- loyalty_tiers
-- reward_redemptions

-- Check permissions were added
SELECT * FROM permissions WHERE module_name = 'loyalty';
-- Should show: view, manage, redeem, enroll
```

### 2. Enable the Loyalty Program
1. Go to Settings > Loyalty Program Settings
2. Toggle "Enable Loyalty Program" to ON
3. Configure any custom settings as needed

### 3. Start Using the Program
- **Enroll customers**: Go to Customers page and click "Enroll" button
- **Set up check-ins**: Print QR codes from event details pages
- **Train staff**: Visit /loyalty/training for training materials
- **Manage program**: Access via "VIP Club" in the navigation menu

## Troubleshooting Common Issues

### "relation already exists" errors
- You have a partial migration. Use Option 1 above with the safe migration file.

### "column does not exist" errors
- Make sure you're using the corrected migration file that uses `module_name` instead of `module`

### "permission denied" errors
- Check that your database user has permission to create tables and functions
- Verify you're connected to the correct database

### Navigation menu doesn't show "VIP Club"
- Make sure the migration completed successfully
- Check that your user role has the `loyalty.view` permission
- Try refreshing the page or logging out/in

## Files Created for This Migration

1. **Original migration**: `supabase/migrations/20240715000000_loyalty_program.sql`
2. **Safe migration** (use this): `supabase/migrations/20240715000000_loyalty_program_safe.sql`
3. **Check progress script**: `scripts/check-loyalty-migration-progress.sql`
4. **Cleanup script**: `scripts/cleanup-partial-loyalty-migration.sql`
5. **Check requirements**: `scripts/check-loyalty-migration-status.sql`

## Need Help?
If you continue to have issues:
1. Run the check progress script and share the output
2. Note exactly which step is failing
3. Share any error messages in full