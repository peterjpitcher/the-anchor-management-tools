# Migration Reset Documentation

**Date:** June 25, 2025  
**Performed by:** Development Team  
**Reason:** Consolidate migrations and resolve schema inconsistencies

## What Was Done

### 1. Backed Up Data
- Created full data backup: `backup_20250625_223259.sql`
- This contains all production data as of the reset date

### 2. Archived Old Migrations
- All previous migrations moved to: `supabase/migrations/archive_20250625/`
- This preserves the historical migration sequence for reference

### 3. Created Fresh Baseline
- New single migration file: `20250625223323_initial_baseline.sql`
- This represents the complete production schema as of reset date
- Includes all tables, indexes, functions, triggers, and RLS policies

### 4. Reset Local Development
- Successfully applied baseline migration to local database
- Verified all tables exist and match production schema

## For Team Members

### Pull Latest Changes
```bash
git pull origin main
```

### Reset Your Local Database
```bash
# Stop and restart Supabase
supabase stop
supabase start

# Reset database with new baseline
supabase db reset
```

### Verify Setup
```bash
# Check status
supabase status

# List tables (should see catering_packages, venue_spaces, vendors, etc.)
psql $DATABASE_URL -c "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;"
```

## Important Notes

1. **Production is unaffected** - This only changes how we track migrations locally
2. **All data is preserved** - The baseline includes complete schema with all constraints
3. **Future migrations** - Create new migration files as normal going forward
4. **Old migrations archived** - Available in archive folder if needed for reference

## Benefits of This Reset

- Single source of truth for current schema
- Eliminates migration conflicts and inconsistencies
- Faster local database setup
- Cleaner migration history going forward

## If You Have Issues

1. Make sure you have the latest code from main branch
2. Completely stop Supabase: `supabase stop`
3. Clear Docker volumes if needed: `docker volume prune`
4. Start fresh: `supabase start && supabase db reset`

## Next Migration

When creating your next migration:
```bash
supabase migration new your_migration_name
```

This will create a new migration file that builds on top of our baseline.