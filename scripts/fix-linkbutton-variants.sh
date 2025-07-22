#!/bin/bash

echo "Fixing LinkButton outline variants..."

# Fix LinkButton variant="outline" to variant="secondary"
find /Users/peterpitcher/Cursor/anchor-management-tools/src -name "*.tsx" -type f -exec sed -i '' 's/<LinkButton\([^>]*\)variant="outline"/<LinkButton\1variant="secondary"/g' {} \;

echo "Done!"