#!/bin/bash

# Fix Supabase imports in client components
# This script updates components that import from @/lib/supabase to use the useSupabase hook instead

echo "Fixing Supabase imports in client components..."

# Array of files to fix (excluding server actions and scripts)
files=(
  "src/app/(authenticated)/settings/webhook-monitor/page.tsx"
  "src/components/EmployeeNotesList.tsx"
  "src/app/(authenticated)/settings/categories/page.tsx"
  "src/app/(authenticated)/employees/[employee_id]/edit/page.tsx"
  "src/components/EmergencyContactsTab.tsx"
)

for file in "${files[@]}"; do
  if [ -f "$file" ]; then
    echo "Processing $file..."
    
    # Check if file contains 'use client' directive
    if grep -q "'use client'" "$file"; then
      # Replace import statement
      sed -i '' "s/import { supabase } from '@\/lib\/supabase'/import { useSupabase } from '@\/components\/providers\/SupabaseProvider'/" "$file"
      
      # Add const supabase = useSupabase() after the component function declaration
      # This is more complex and needs to be done carefully for each file
      echo "  - Updated import statement"
      echo "  - NOTE: You need to manually add 'const supabase = useSupabase()' at the beginning of the component function"
    else
      echo "  - Skipping (not a client component)"
    fi
  else
    echo "File not found: $file"
  fi
done

echo "Done! Please manually add 'const supabase = useSupabase()' to each component function."
echo "Files that need manual update:"
for file in "${files[@]}"; do
  if [ -f "$file" ] && grep -q "'use client'" "$file"; then
    echo "  - $file"
  fi
done