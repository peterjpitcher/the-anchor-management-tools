# Supabase Migration Fix Plan

## Issues Identified

### 1. Migration Ordering Issues
- **20250112_loyalty_system_complete.sql** (January 12, 2025) comes BEFORE the initial baseline
- **20250625223323_initial_baseline.sql** (June 25, 2025) is supposed to be the foundation
- **20250713_loyalty_core_tables.sql** (July 13, 2025) duplicates tables from January migration

### 2. Naming Convention Inconsistency
- Baseline uses timestamp format: `YYYYMMDDHHMMSS` (20250625223323)
- Other migrations use date format: `YYYYMMDD` (20250112, 20250713)

### 3. Table Conflicts
Both loyalty migrations create overlapping tables:
- **Both create**: loyalty_campaigns, loyalty_members, loyalty_point_transactions, loyalty_tiers
- **Only January creates**: loyalty_achievements, loyalty_challenges, loyalty_programs, loyalty_rewards

### 4. Missing Safeguards
- July migration has DROP POLICY but no DROP TABLE IF EXISTS
- No CREATE TABLE IF NOT EXISTS statements in loyalty migrations
- Will fail if tables already exist

## Fix Strategy (Without Deleting Migrations)

### Step 1: Rename Migrations for Proper Order
```
20250625223323_initial_baseline.sql        → 20240625000000_initial_baseline.sql
20250112_loyalty_system_complete.sql       → 20240625000001_loyalty_system_complete.sql  
20250713_loyalty_core_tables.sql           → 20240625000002_loyalty_core_tables_fix.sql
```

### Step 2: Add Conflict Resolution to Migrations
- Add CREATE TABLE IF NOT EXISTS to all CREATE TABLE statements
- Add DROP TABLE IF EXISTS before CREATE TABLE in the July migration (since it's a fix)
- Ensure all migrations are idempotent

### Step 3: Create Archive Folder
- Move original files to `migrations/original_backup/` for reference
- Keep modified versions in main migrations folder

### Step 4: Add Migration Status Check
- Create a script to verify migration state before pushing

## Implementation Order
1. Create backup folder and copy originals
2. Rename files with consistent timestamp format
3. Modify SQL files to be idempotent
4. Test migrations locally
5. Document the changes

## Important Notes
- All dates will be adjusted to 2024 to reflect actual creation time
- Original migrations preserved in backup folder
- Another agent may create new migrations - these will use proper naming