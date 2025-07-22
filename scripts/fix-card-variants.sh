#!/bin/bash

# Fix Card variant="secondary" to variant="bordered"
echo "Fixing Card components with variant=\"secondary\"..."

# Find all files with Card variant="secondary" and replace with variant="bordered"
find /Users/peterpitcher/Cursor/anchor-management-tools/src -name "*.tsx" -type f -exec grep -l 'variant="secondary"' {} \; | while read file; do
    # Check if it's a Card component (not Button or other components)
    if grep -q '<Card.*variant="secondary"' "$file"; then
        echo "Fixing: $file"
        sed -i '' 's/<Card\([^>]*\)variant="secondary"/<Card\1variant="bordered"/g' "$file"
    fi
done

echo "Done!"