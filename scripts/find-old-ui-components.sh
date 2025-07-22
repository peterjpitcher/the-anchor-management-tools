#!/bin/bash

# Script to find any remaining old UI component imports

echo "🔍 Searching for old UI component imports..."
echo "=========================================="

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Counter for issues found
ISSUES_FOUND=0

# Search for old UI imports
echo -e "\n${YELLOW}Checking for imports from @/components/ui/ (excluding ui-v2)...${NC}"
if grep -r "from ['\"]@/components/ui/" --include="*.tsx" --include="*.ts" --include="*.jsx" --include="*.js" src/ 2>/dev/null | grep -v "ui-v2"; then
    echo -e "${RED}❌ Found old UI imports!${NC}"
    ISSUES_FOUND=$((ISSUES_FOUND + 1))
else
    echo -e "${GREEN}✅ No old UI imports found${NC}"
fi

# List of old component names to check
OLD_COMPONENTS=(
    "Button"
    "Card" 
    "Modal"
    "Badge"
    "FormInput"
    "FormSelect"
    "FormTextarea"
    "Tabs"
    "LoadingSpinner"
    "SkeletonLoader"
    "StatusIndicator"
    "LineChart"
    "ListItem"
)

# Check for specific old component usage without proper imports
echo -e "\n${YELLOW}Checking for old component usage patterns...${NC}"
for component in "${OLD_COMPONENTS[@]}"; do
    # Search for component usage that might be from old UI
    if grep -r "<${component}\b" --include="*.tsx" --include="*.jsx" src/ 2>/dev/null | grep -v "ui-v2" | grep -v "import.*${component}.*ui-v2" > /dev/null; then
        echo -e "${YELLOW}⚠️  Found potential old usage of ${component}${NC}"
        grep -r "<${component}\b" --include="*.tsx" --include="*.jsx" src/ 2>/dev/null | grep -v "ui-v2" | head -5
    fi
done

# Check for any remaining references to old UI paths
echo -e "\n${YELLOW}Checking for any string references to old UI paths...${NC}"
if grep -r "@/components/ui/" --include="*.tsx" --include="*.ts" --include="*.jsx" --include="*.js" --include="*.json" src/ 2>/dev/null | grep -v "ui-v2"; then
    echo -e "${RED}❌ Found references to old UI paths${NC}"
    ISSUES_FOUND=$((ISSUES_FOUND + 1))
fi

# Summary
echo -e "\n=========================================="
if [ $ISSUES_FOUND -eq 0 ]; then
    echo -e "${GREEN}✅ All clear! No old UI components found.${NC}"
else
    echo -e "${RED}❌ Found $ISSUES_FOUND issue(s) with old UI components.${NC}"
    echo -e "${YELLOW}Please update these imports to use @/components/ui-v2/${NC}"
fi

# Suggest new component mappings
echo -e "\n${YELLOW}Component Migration Guide:${NC}"
echo "Old Component → New Component"
echo "----------------------------"
echo "Button → @/components/ui-v2/forms/Button"
echo "Card → @/components/ui-v2/layout/Card"
echo "Modal → @/components/ui-v2/overlay/Modal"
echo "Badge → @/components/ui-v2/display/Badge"
echo "FormInput → @/components/ui-v2/forms/Input"
echo "FormSelect → @/components/ui-v2/forms/Select"
echo "FormTextarea → @/components/ui-v2/forms/Textarea"
echo "Tabs → @/components/ui-v2/navigation/Tabs"
echo "LoadingSpinner → @/components/ui-v2/feedback/Spinner"
echo "SkeletonLoader → @/components/ui-v2/feedback/Skeleton"
echo "LinkButton → @/components/ui-v2/navigation/LinkButton"