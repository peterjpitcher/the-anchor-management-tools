# ESLint Fixes - Agent A

## Overview
This document contains ESLint warnings for Agent A to fix. Focus on fixing TypeScript type issues and React hook dependencies in the assigned files.

## Instructions
1. Fix all ESLint warnings in the assigned files
2. Replace `any` types with proper TypeScript types
3. Remove unused imports and variables
4. Add missing dependencies to React hooks (useEffect, useCallback, useMemo)
5. Do NOT commit any changes - just fix the warnings

## Common Fixes Needed

### 1. Replace `any` types
```typescript
// Bad
const data: any = {}
// Good
const data: Record<string, unknown> = {}
```

### 2. Remove unused variables
```typescript
// Bad
import { SomeIcon } from '@heroicons/react/24/outline' // never used
// Good - remove the import entirely
```

### 3. Fix React hook dependencies
```typescript
// Bad
useEffect(() => {
  loadData()
}, []) // missing loadData

// Good
const loadData = useCallback(async () => {
  // ...
}, [dependency1, dependency2])

useEffect(() => {
  loadData()
}, [loadData])
```

## Assigned Files for Agent A

### Pages (13 files)
1. `/src/app/(authenticated)/customers/[id]/page.tsx`
2. `/src/app/(authenticated)/dashboard/page.tsx`
3. `/src/app/(authenticated)/employees/[employee_id]/edit/page.tsx`
4. `/src/app/(authenticated)/employees/[employee_id]/page.tsx`
5. `/src/app/(authenticated)/messages/bulk/page.tsx`
6. `/src/app/(authenticated)/messages/page.tsx`
7. `/src/app/(authenticated)/private-bookings/[id]/edit/page.tsx`
8. `/src/app/(authenticated)/private-bookings/[id]/messages/page.tsx`
9. `/src/app/(authenticated)/private-bookings/[id]/page.tsx`
10. `/src/app/(authenticated)/private-bookings/new/page.tsx`
11. `/src/app/(authenticated)/private-bookings/page.tsx`
12. `/src/app/(authenticated)/private-bookings/settings/catering/page.tsx`
13. `/src/app/(authenticated)/private-bookings/settings/spaces/page.tsx`

### Components (15 files)
1. `/src/components/dashboard/AuditTrailWidget.tsx`
2. `/src/components/dashboard/CategoryAnalyticsWidget.tsx`
3. `/src/components/dashboard/EmployeeActivityWidget.tsx`
4. `/src/components/dashboard/EnhancedActivityFeed.tsx`
5. `/src/components/dashboard/MessageTemplatesWidget.tsx`
6. `/src/components/dashboard/SmsHealthWidget.tsx`
7. `/src/components/CategoryCustomerSuggestions.tsx`
8. `/src/components/EmergencyContactsTab.tsx`
9. `/src/components/EmployeeForm.tsx`
10. `/src/components/EmployeeNotesList.tsx`
11. `/src/components/EmployeeRecentChanges.tsx`
12. `/src/components/EmployeeVersionHistory.tsx`
13. `/src/components/EventForm.tsx`
14. `/src/components/EventTemplateManager.tsx`
15. `/src/components/FinancialDetailsForm.tsx`

### Actions (7 files)
1. `/src/app/actions/audit.ts`
2. `/src/app/actions/bookings.ts`
3. `/src/app/actions/customerSmsActions.ts`
4. `/src/app/actions/diagnose-messages.ts`
5. `/src/app/actions/employeeActions.ts`
6. `/src/app/actions/employeeExport.ts`
7. `/src/app/actions/import-messages.ts`

## How to Run ESLint
```bash
npm run lint
```

## Expected Result
All warnings in the assigned files should be fixed. The total warning count should decrease significantly.