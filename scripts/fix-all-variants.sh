#!/bin/bash

echo "Fixing all component variants..."

# Fix Card components
echo "Fixing Card variants..."
find /Users/peterpitcher/Cursor/anchor-management-tools/src -name "*.tsx" -type f -exec sed -i '' 's/<Card\([^>]*\)variant="secondary"/<Card\1variant="bordered"/g' {} \;

# Fix LinkButton components 
echo "Fixing LinkButton variants..."
find /Users/peterpitcher/Cursor/anchor-management-tools/src -name "*.tsx" -type f -exec sed -i '' 's/<LinkButton\([^>]*\)variant="secondary"/<LinkButton\1variant="outline"/g' {} \;

# Fix TextButton components
echo "Fixing TextButton variants..."
find /Users/peterpitcher/Cursor/anchor-management-tools/src -name "*.tsx" -type f -exec sed -i '' 's/<TextButton\([^>]*\)variant="secondary"/<TextButton\1variant="ghost"/g' {} \;

# Fix Badge components (secondary is valid for Badge, so skip)
echo "Skipping Badge components (secondary is valid)..."

echo "Done!"