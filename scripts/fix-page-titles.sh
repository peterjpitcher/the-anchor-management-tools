#!/bin/bash

echo "Finding Page components without title prop..."

# Find all Page components that don't have a title prop
find /Users/peterpitcher/Cursor/anchor-management-tools/src -name "*.tsx" -type f | while read file; do
    # Check if file has <Page> without title
    if grep -q '<Page[[:space:]]*>' "$file" || grep -q '<Page[[:space:]]\+[^t]' "$file" | grep -v "title="; then
        echo "Checking: $file"
        
        # Get the component/page name from filename or function name
        basename=$(basename "$file" .tsx)
        
        # Replace <Page> with <Page title="...">
        sed -i '' "s/<Page>/<Page title=\"Page\">/g" "$file"
        sed -i '' "s/<Page className=/<Page title=\"Page\" className=/g" "$file"
    fi
done

echo "Done!"