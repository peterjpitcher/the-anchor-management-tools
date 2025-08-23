#!/bin/bash

echo "Finding all BackButton usage issues..."

# Find files with BackButton but without proper import
echo "=== Files using BackButton without import ==="
grep -l "BackButton" src/**/*.tsx 2>/dev/null | while read file; do
  if ! grep -q "import.*BackButton" "$file" 2>/dev/null; then
    echo "$file"
  fi
done

echo ""
echo "=== Files with router.push but no router defined ==="
grep -l "router\.push\|router\.back" src/**/*.tsx 2>/dev/null | while read file; do
  if ! grep -q "const router = useRouter()" "$file" 2>/dev/null && ! grep -q "router =" "$file" 2>/dev/null; then
    echo "$file"
  fi
done

echo ""
echo "=== Files with BackButton inside Link elements ==="
grep -B2 -A2 "<BackButton" src/**/*.tsx 2>/dev/null | grep -B3 -A3 "</Link>" | grep -l "BackButton" 2>/dev/null | sort -u