#!/bin/bash

# Fix Section variant="secondary" to variant="gray"
echo "Fixing Section components with variant=\"secondary\"..."

# Find all files with Section variant="secondary" and replace with variant="gray"
find /Users/peterpitcher/Cursor/anchor-management-tools/src -name "*.tsx" -type f -exec grep -l 'variant="secondary"' {} \; | while read file; do
    # Check if it's a Section component
    if grep -q '<Section.*variant="secondary"' "$file"; then
        echo "Fixing: $file"
        sed -i '' 's/<Section\([^>]*\)variant="secondary"/<Section\1variant="gray"/g' "$file"
    fi
done

echo "Done!"