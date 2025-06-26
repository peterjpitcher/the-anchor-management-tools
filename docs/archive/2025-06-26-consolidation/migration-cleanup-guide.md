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