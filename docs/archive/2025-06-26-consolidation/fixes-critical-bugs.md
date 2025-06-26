# Critical Bugs and Runtime Errors

**Last Updated:** June 25, 2025 (Post-Migration Update)  
**Priority:** MEDIUM (down from CRITICAL)  
**Total Issues:** 0 critical runtime errors remaining

This document details critical bugs and runtime errors that are breaking functionality in production.

**🎉 UPDATE:** Private bookings form submission errors have been FIXED! The database migrations resolved the critical 500 errors.

## 1. Private Bookings Form Submission Error 🔴

### Issue
Form submission fails with 500 error due to missing database fields.

### Error Message
```
Error: insert into "private_bookings" - column "customer_first_name" does not exist
```

### Root Cause
The form is trying to insert fields that don't exist in the database table.

### Fix Required

**Option 1: Add Missing Fields (Recommended)**
```sql
-- Run this migration immediately
ALTER TABLE private_bookings 
ADD COLUMN IF NOT EXISTS customer_first_name TEXT,
ADD COLUMN IF NOT EXISTS customer_last_name TEXT,
ADD COLUMN IF NOT EXISTS contact_phone TEXT,
ADD COLUMN IF NOT EXISTS contact_email TEXT,
ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id);
```

**Option 2: Update Server Action**
```typescript
// In /src/app/actions/private-bookings.ts
export async function createPrivateBooking(formData: FormData) {
  // Combine first and last name
  const customerName = `${formData.get('customer_first_name')} ${formData.get('customer_last_name')}`;
  
  // Map fields to existing schema
  const bookingData = {
    customer_name: customerName,
    customer_phone: formData.get('contact_phone'),
    customer_email: formData.get('contact_email'),
    // ... other fields
  };
  
  // Insert with correct field names
  const { data, error } = await supabase
    .from('private_bookings')
    .insert(bookingData);
}
```

## 2. Settings Pages Saving to Wrong Table 🔴

### Issue
Catering, Spaces, and Vendors settings are trying to save to `private_bookings` table instead of their dedicated tables.

### Error Messages
```
Error: column "package_type" does not exist in private_bookings
Error: column "vendor_type" does not exist in private_bookings
Error: column "capacity" does not exist in private_bookings
```

### Fix Required

**Step 1: Create Missing Tables**
```sql
-- Run these migrations
CREATE TABLE IF NOT EXISTS private_booking_catering_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  name TEXT NOT NULL,
  package_type TEXT NOT NULL,
  per_head_cost DECIMAL(10,2) NOT NULL,
  -- ... see full schema in fixes-database-schema.md
);

CREATE TABLE IF NOT EXISTS private_booking_spaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  name TEXT NOT NULL,
  capacity INTEGER NOT NULL,
  hire_cost DECIMAL(10,2) NOT NULL,
  -- ... see full schema in fixes-database-schema.md
);

CREATE TABLE IF NOT EXISTS private_booking_vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  name TEXT NOT NULL,
  vendor_type TEXT NOT NULL,
  -- ... see full schema in fixes-database-schema.md
);
```

**Step 2: Update Server Actions**
```typescript
// In each settings file, change the table name:

// ❌ WRONG
.from('private_bookings')

// ✅ CORRECT
.from('private_booking_catering_packages') // for catering
.from('private_booking_spaces')            // for spaces
.from('private_booking_vendors')           // for vendors
```

## 3. Event Creation Date Validation 🟠

### Issue
Test expects to create events with past dates but validation correctly prevents this.

### Current Behavior
```typescript
// This is actually correct behavior
if (new Date(eventDate) < new Date()) {
  return { error: 'Cannot create events with dates in the past' };
}
```

### Fix Required
Update the test to expect this validation:

```typescript
// In /scripts/test-critical-flows.ts
test('Event - Create with past date', async () => {
  const result = await createEvent({ date: '2020-01-01' });
  
  // ✅ CORRECT: Expect validation error
  expect(result.error).toBe('Cannot create events with dates in the past');
  
  // ❌ WRONG: Don't expect success
  // expect(result.success).toBe(true);
});
```

## 4. Customer Email Field Mismatch 🟠

### Issue
Forms use `email_address` but database has `email` field.

### Quick Fix
```typescript
// In /src/app/actions/customers.ts
// Map the field name
const customerData = {
  first_name: formData.get('first_name'),
  last_name: formData.get('last_name'),
  mobile_number: formData.get('mobile_number'),
  email: formData.get('email_address'), // Map email_address to email
  sms_opt_in: formData.get('sms_opt_in') === 'true'
};
```

## 5. TypeScript Strict Errors 🟡

### Issue
Multiple TypeScript errors due to unescaped quotes and undefined checks.

### Common Fixes

**Unescaped Quotes:**
```typescript
// ❌ WRONG
<p>Don't forget to check today's events</p>

// ✅ CORRECT
<p>Don&apos;t forget to check today&apos;s events</p>
```

**Const vs Let:**
```typescript
// ❌ WRONG
let fetchError = null; // Never reassigned

// ✅ CORRECT
const fetchError = null;
```

**Type Any:**
```typescript
// ❌ WRONG
} catch (error: any) {

// ✅ CORRECT
} catch (error) {
  const message = error instanceof Error ? error.message : 'Unknown error';
}
```

## 6. Missing Error Boundaries 🟡

### Issue
No error boundaries to catch React component errors.

### Fix Required
Create an error boundary component:

```typescript
// Create /src/components/ErrorBoundary.tsx
'use client';

import { Component, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: any) {
    console.error('Error boundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="p-4 bg-red-50 text-red-600 rounded">
          <h2>Something went wrong</h2>
          <p>{this.state.error?.message}</p>
        </div>
      );
    }

    return this.props.children;
  }
}
```

## 7. Race Conditions in Forms 🟡

### Issue
Multiple form submissions possible before server responds.

### Fix Required
Add submission state management:

```typescript
// In form components
const [isSubmitting, setIsSubmitting] = useState(false);

async function handleSubmit(formData: FormData) {
  if (isSubmitting) return;
  
  setIsSubmitting(true);
  try {
    const result = await serverAction(formData);
    // handle result
  } finally {
    setIsSubmitting(false);
  }
}

// In the form
<button type="submit" disabled={isSubmitting}>
  {isSubmitting ? 'Saving...' : 'Save'}
</button>
```

## 8. Production Deployment Checklist

Before deploying fixes:

### 1. Database Migrations
```bash
# Run migrations in this order:
1. Add missing columns to existing tables
2. Create new tables
3. Add indexes
4. Update RLS policies
```

### 2. Environment Variables
Ensure these are set in production:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER`

### 3. Build Verification
```bash
npm run lint    # Should have 0 errors
npm run build   # Should build without errors
npm run test    # All tests should pass
```

### 4. Manual Testing
Test these critical flows:
- [ ] Create new private booking
- [ ] Edit existing private booking
- [ ] Add catering package
- [ ] Add venue space
- [ ] Add preferred vendor
- [ ] Send SMS message
- [ ] Create new event
- [ ] Book event as customer

## 9. Monitoring After Deploy

Set up monitoring for:
1. 500 errors on form submissions
2. Database connection errors
3. SMS delivery failures
4. Slow API responses (>3s)

## 10. Rollback Plan

If issues occur after deployment:

1. **Database Rollback:**
```sql
-- Keep rollback scripts ready
-- See fixes-database-schema.md for rollback SQL
```

2. **Code Rollback:**
```bash
# Revert to previous deployment
git revert HEAD
npm run build
npm run deploy
```

3. **Feature Flags:**
Consider adding feature flags for new functionality:
```typescript
const ENABLE_NEW_BOOKING_FORM = process.env.ENABLE_NEW_BOOKING_FORM === 'true';

if (ENABLE_NEW_BOOKING_FORM) {
  // New form logic
} else {
  // Old form logic
}
```

## Priority Fix Order

1. 🔴 **Immediate**: Private bookings form fields
2. 🔴 **Immediate**: Settings pages table names
3. 🟠 **Today**: Customer email field mapping
4. 🟠 **Today**: Add error boundaries
5. 🟡 **This Week**: TypeScript errors
6. 🟡 **This Week**: Form race conditions

## Next Steps

1. Apply database migrations (see [Migration Guide](./fixes-migration-guide.md))
2. Deploy code fixes
3. Monitor error logs
4. Run full regression test

See [ESLint Fixes](./fixes-eslint-issues.md) for code quality improvements.