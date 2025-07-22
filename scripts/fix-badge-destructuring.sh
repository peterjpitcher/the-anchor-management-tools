#!/bin/bash

echo "Fixing all { badge: } destructuring to { count: }..."

# Find all TypeScript files and replace { badge: varName } patterns where it's followed by supabase query
find /Users/peterpitcher/Cursor/anchor-management-tools/src -name "*.ts" -o -name "*.tsx" | while read file; do
    # Check if file contains the pattern
    if grep -q "{ badge: .* } = await supabase" "$file"; then
        echo "Fixing: $file"
        # Replace { badge: xxx } = await supabase with { count: xxx } = await supabase
        sed -i '' 's/{ badge: \([^}]*\) } = await supabase/{ count: \1 } = await supabase/g' "$file"
    fi
done

echo "Done!"