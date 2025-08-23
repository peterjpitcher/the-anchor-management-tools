# ESLint Fixes - Agent B

## Overview
This document contains ESLint warnings for Agent B to fix. Focus on fixing TypeScript type issues and React hook dependencies in the assigned files.

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

## Assigned Files for Agent B

### Pages (15 files)
1. `/src/app/(authenticated)/private-bookings/settings/vendors/page.tsx`
2. `/src/app/(authenticated)/private-bookings/sms-queue/page.tsx`
3. `/src/app/(authenticated)/profile/page.tsx`
4. `/src/app/(authenticated)/settings/audit-logs/page.tsx`
5. `/src/app/(authenticated)/settings/categories/page.tsx`
6. `/src/app/(authenticated)/settings/event-categories/page.tsx`
7. `/src/app/(authenticated)/settings/import-messages/page.tsx`
8. `/src/app/(authenticated)/settings/message-templates/page.tsx`
9. `/src/app/(authenticated)/settings/page.tsx`
10. `/src/app/(authenticated)/settings/sms-health/page.tsx`
11. `/src/app/(authenticated)/settings/webhook-monitor/page.tsx`
12. `/src/app/(authenticated)/settings/webhook-test/page.tsx`
13. `/src/app/(authenticated)/unauthorized/page.tsx`
14. `/src/app/(authenticated)/users/page.tsx`
15. `/src/app/(authenticated)/roles/components/RoleForm.tsx`

### Components (10 files)
1. `/src/app/(authenticated)/roles/components/RolePermissionsModal.tsx`
2. `/src/app/(authenticated)/users/components/UserRolesModal.tsx`
3. `/src/components/HealthRecordsForm.tsx`
4. `/src/components/MessageThread.tsx`
5. `/src/components/modals/AddEmergencyContactModal.tsx`
6. `/src/components/Navigation.tsx`
7. `/src/components/private-bookings/CalendarView.tsx`
8. `/src/components/providers/SupabaseProvider.tsx`
9. `/src/components/BottomNavigation.tsx`
10. `/src/hooks/usePagination.ts`

### Actions & API Routes (8 files)
1. `/src/app/actions/messageActions.ts`
2. `/src/app/actions/messagesActions.ts`
3. `/src/app/actions/privateBookingActions.ts`
4. `/src/app/actions/rbac.ts`
5. `/src/app/actions/sms-timing.ts`
6. `/src/app/actions/sms.ts`
7. `/src/app/api/cron/reminders/route.ts`
8. `/src/app/api/webhooks/twilio/route.ts`

### Library & Types (8 files)
1. `/src/lib/auditLog.ts`
2. `/src/lib/contract-template.ts`
3. `/src/lib/dbErrorHandler.ts`
4. `/src/lib/google-calendar.ts`
5. `/src/lib/job-processor.ts`
6. `/src/lib/job-queue.ts`
7. `/src/types/actions.ts`
8. `/src/types/private-bookings.ts`

## How to Run ESLint
```bash
npm run lint
```

## Expected Result
All warnings in the assigned files should be fixed. The total warning count should decrease significantly.