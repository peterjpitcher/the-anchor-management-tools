# Actual Issues to Fix - Verified List

**Date:** June 26, 2025  
**Status:** Minor optimizations only - no blockers

## Summary

After thorough discovery, only minor performance optimizations are needed. No critical issues exist.

## 1. Performance Optimizations (Priority: Medium)

### N+1 Query Patterns

#### A. Employee Export Function
**File:** `/src/app/actions/employees.ts`  
**Issue:** Fetches attachments individually for each employee
```typescript
// Current (N+1 pattern):
for (const employee of employees) {
  const { data: attachments } = await supabase
    .from('employee_attachments')
    .select('*')
    .eq('employee_id', employee.id);
}

// Fix: Use single query with join or batch fetch
```

#### B. Business Hours Special Dates
**File:** `/src/app/actions/business-hours.ts`  
**Issue:** Individual queries for each special date
```typescript
// Current (N+1 pattern):
for (const date of specialDates) {
  const hours = await getHoursForDate(date);
}

// Fix: Fetch all special dates in one query
```

#### C. Private Booking Vendor Availability
**File:** `/src/app/(authenticated)/private-bookings/[id]/edit/page.tsx`  
**Issue:** Checks vendor availability one by one

### Heavy Operations

Move these to background processing:
1. Employee CSV exports (currently synchronous)
2. Customer stats rebuilding
3. Historical event categorization
4. Bulk SMS operations

## 2. TypeScript Type Definitions (Priority: Low)

Add missing type definitions for:
```typescript
// src/types/database.ts

export interface CustomerCategoryStats {
  customer_id: string;
  category_id: string;
  booking_count: number;
  total_spent: number;
  last_booking_date: string;
  created_at: string;
  updated_at: string;
}

export interface EventCategory {
  id: string;
  name: string;
  color: string;
  description?: string;
  created_at: string;
  updated_at: string;
}

export interface Profile {
  id: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  avatar_url?: string;
  created_at: string;
  updated_at: string;
}
```

## 3. Pagination Implementation (Priority: Low)

Apply existing pagination component to:
- Customers list (currently shows all)
- Events list (currently shows all)
- Bookings list (currently shows all)
- Messages list (currently shows all)

## 4. Rate Limiting Enhancement (Priority: Medium)

Current implementation uses in-memory storage. For production scale:
```typescript
// Replace TokenBucket with Redis-based solution
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(10, '10 s'),
});
```

## 5. Form Field Scanner Improvement (Priority: Low)

The scanner in `scripts/find-form-field-mismatches.ts` produces 311 false positives.
Improve the matching logic to reduce noise.

## Implementation Time Estimates

| Task | Complexity | Time Estimate |
|------|------------|---------------|
| Fix N+1 queries | Medium | 2-3 hours |
| Add TypeScript types | Low | 30 minutes |
| Implement pagination | Low | 1-2 hours |
| Redis rate limiting | Medium | 1-2 hours |
| Background jobs | High | 4-6 hours |

**Total: 9-14 hours of work**

## Notes

- **None of these issues block production deployment**
- All issues are performance optimizations or nice-to-haves
- The application is secure and functional as-is
- These improvements can be rolled out incrementally post-launch