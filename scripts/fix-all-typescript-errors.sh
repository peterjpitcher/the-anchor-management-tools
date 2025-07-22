#!/bin/bash
# Master fix script - runs all fixes

echo "🚀 Running all TypeScript fixes..."
echo "================================="

bash "/Users/peterpitcher/Cursor/anchor-management-tools/scripts/fix-1-unknown.sh"

echo ""
echo "✅ All fix scripts completed!"
echo "🔍 Running build to check remaining errors..."
npm run build
