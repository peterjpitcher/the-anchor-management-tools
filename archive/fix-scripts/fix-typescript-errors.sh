#!/bin/bash

# TypeScript Error Bulk Fix Script
# This script analyzes TypeScript errors and applies pattern-based fixes

echo "=== TypeScript Error Analysis and Fix Script ==="

# Step 1: Get all errors in parsable format
echo "Collecting TypeScript errors..."
npx tsc --pretty false --noEmit 2>&1 | grep "error TS" > ts-errors.txt

# Step 2: Analyze error patterns
echo "Analyzing error patterns..."
cat ts-errors.txt | sed -n 's/.*error TS\([0-9]*\):.*/\1/p' | sort | uniq -c | sort -nr > error-patterns.txt
echo "Top error codes:"
head -10 error-patterns.txt

# Step 3: Extract files with errors
cat ts-errors.txt | cut -d'(' -f1 | sort -u > files-with-errors.txt
echo "Files with errors: $(wc -l < files-with-errors.txt)"

# Step 4: Apply bulk fixes based on patterns

echo "Applying bulk fixes..."

# Fix 1: Modal isOpen -> open
echo "Fixing Modal isOpen props..."
find src -name "*.tsx" -type f -exec sed -i '' 's/<Modal isOpen=/<Modal open=/g' {} \;

# Fix 2: ConfirmDialog description -> message
echo "Fixing ConfirmDialog props..."
find src -name "*.tsx" -type f -exec sed -i '' 's/description: string/message: string/g' {} \;
find src -name "*.tsx" -type f -exec sed -i '' 's/description=/message=/g' {} \;

# Fix 3: Button icon -> leftIcon
echo "Fixing Button icon props..."
find src -name "*.tsx" -type f -exec sed -i '' 's/icon={/leftIcon={/g' {} \;

# Fix 4: FormGroup helperText -> help
echo "Fixing FormGroup props..."
find src -name "*.tsx" -type f -exec sed -i '' 's/helperText=/help=/g' {} \;
find src -name "*.tsx" -type f -exec sed -i '' 's/helper=/help=/g' {} \;

# Fix 5: Container maxWidth -> size
echo "Fixing Container props..."
find src -name "*.tsx" -type f -exec sed -i '' 's/maxWidth="sm"/size="sm"/g' {} \;
find src -name "*.tsx" -type f -exec sed -i '' 's/maxWidth="md"/size="md"/g' {} \;
find src -name "*.tsx" -type f -exec sed -i '' 's/maxWidth="lg"/size="lg"/g' {} \;
find src -name "*.tsx" -type f -exec sed -i '' 's/maxWidth="xl"/size="xl"/g' {} \;

# Fix 6: Button variant outline -> secondary
echo "Fixing Button variants..."
find src -name "*.tsx" -type f -exec sed -i '' 's/variant="outline"/variant="secondary"/g' {} \;

# Fix 7: Card variant fixes
echo "Fixing Card variants..."
find src -name "*.tsx" -type f -exec sed -i '' 's/variant="ghost"/variant="bordered"/g' {} \;
find src -name "*.tsx" -type f -exec sed -i '' 's/variant="secondary"/variant="bordered"/g' {} \;

# Fix 8: Alert type -> variant
echo "Fixing Alert props..."
find src -name "*.tsx" -type f -exec sed -i '' 's/type="info"/variant="info"/g' {} \;
find src -name "*.tsx" -type f -exec sed -i '' 's/type="error"/variant="error"/g' {} \;
find src -name "*.tsx" -type f -exec sed -i '' 's/type="warning"/variant="warning"/g' {} \;
find src -name "*.tsx" -type f -exec sed -i '' 's/type="success"/variant="success"/g' {} \;

# Fix 9: ConfirmDialog confirmLabel -> confirmText
echo "Fixing ConfirmDialog confirmLabel..."
find src -name "*.tsx" -type f -exec sed -i '' 's/confirmLabel=/confirmText=/g' {} \;

# Fix 10: Remove loadingText from Button
echo "Removing loadingText props..."
find src -name "*.tsx" -type f -exec sed -i '' 's/loadingText="[^"]*"//g' {} \;

echo "=== Bulk fixes applied ==="

# Step 5: Check remaining errors
echo "Checking remaining errors..."
npx tsc --pretty false --noEmit 2>&1 | grep "error TS" | wc -l
echo "errors remaining"

# Step 6: Generate report of remaining complex issues
echo "Generating report of remaining issues..."
npx tsc --pretty false --noEmit 2>&1 | grep "error TS" > remaining-errors.txt

echo "=== Script complete ==="
echo "Check remaining-errors.txt for issues that need manual intervention"