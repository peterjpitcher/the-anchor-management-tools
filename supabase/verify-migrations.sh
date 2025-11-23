#!/bin/bash

# Verify Supabase migrations are properly formatted and ordered

echo "🔍 Verifying Supabase migrations..."
echo "================================"

MIGRATION_DIR="./migrations"

# Check if migrations directory exists
if [ ! -d "$MIGRATION_DIR" ]; then
    echo "❌ Error: Migrations directory not found!"
    exit 1
fi

echo "📁 Migration files found:"
echo ""

# List all SQL files in order
for file in $MIGRATION_DIR/*.sql; do
    if [ -f "$file" ]; then
        basename "$file"
    fi
done | sort

echo ""
echo "🔍 Checking migration format..."
echo ""

# Check for consistent naming
INCONSISTENT=0
for file in $MIGRATION_DIR/*.sql; do
    if [ -f "$file" ]; then
        filename=$(basename "$file")
        # Skip backup folder
        if [[ "$filename" == *"original_backup"* ]]; then
            continue
        fi
        
        # Check if filename matches expected pattern (timestamp_description.sql)
        if ! [[ "$filename" =~ ^[0-9]{14}_[a-z_]+\.sql$ ]]; then
            echo "⚠️  Non-standard naming: $filename"
            echo "   Expected format: YYYYMMDDHHMMSS_description.sql"
            INCONSISTENT=1
        fi
    fi
done

if [ $INCONSISTENT -eq 0 ]; then
    echo "✅ All migrations follow consistent naming pattern"
else
    echo "❌ Some migrations have inconsistent naming"
fi

echo ""
echo "🔍 Checking for CREATE TABLE statements..."
echo ""

# Count tables per migration (simpler approach for compatibility)
for file in $MIGRATION_DIR/*.sql; do
    if [ -f "$file" ]; then
        filename=$(basename "$file")
        count=$(grep -c "CREATE TABLE" "$file" 2>/dev/null || echo 0)
        if [ "${count:-0}" -gt 0 ]; then
            echo "  $filename: $count tables"
        fi
    fi
done

echo ""
echo "📋 Summary:"
echo "==========="
echo "Total migrations: $(ls -1 $MIGRATION_DIR/*.sql 2>/dev/null | wc -l)"

echo ""
echo "💡 Recommendations:"
echo "1. Ensure all migrations use YYYYMMDDHHMMSS_description.sql format"
echo "2. Use CREATE TABLE IF NOT EXISTS for idempotency"
echo "3. Add DROP TABLE IF EXISTS when replacing tables"
echo "4. Test migrations locally before pushing"

echo ""
echo "To apply migrations:"
echo "  supabase db push"
echo ""
echo "To reset and reapply all migrations:"
echo "  supabase db reset"
