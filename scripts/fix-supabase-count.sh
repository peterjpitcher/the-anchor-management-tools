#!/bin/bash

echo "Fixing all Supabase badge: 'exact' to count: 'exact'..."

# Find all TypeScript files and replace badge: 'exact' with count: 'exact'
find /Users/peterpitcher/Cursor/anchor-management-tools/src -name "*.ts" -o -name "*.tsx" | while read file; do
    if grep -q "badge: 'exact'" "$file"; then
        echo "Fixing: $file"
        sed -i '' "s/badge: 'exact'/count: 'exact'/g" "$file"
    fi
done

echo "Done!"