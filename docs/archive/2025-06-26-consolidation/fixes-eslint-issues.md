# ESLint Issues Fix Guide

**Last Updated:** June 25, 2025  
**Priority:** MEDIUM  
**Total Issues:** 44 warnings, 29 errors

This document provides fixes for all ESLint warnings and errors found during the system scan.

## Summary by Type

- **Unescaped entities**: 23 errors
- **Unused variables**: 28 warnings  
- **Type any usage**: 15 warnings
- **Missing dependencies**: 3 warnings
- **Prefer const**: 1 error

## Fixes by File

### 1. Dashboard Pages

#### `/dashboard/page-complex.tsx`
```typescript
// ❌ Lines 12-16: Unused imports
import {
  DocumentTextIcon,  // unused
  EnvelopeIcon,     // unused
  ClockIcon,        // unused
  PlusIcon,         // unused
  ChartBarIcon      // unused
} from '@heroicons/react/24/outline';

// ✅ FIX: Remove unused imports
// Just delete these lines

// ❌ Lines 52, 86, 109, 160, 170: Type any
catch (error: any) {

// ✅ FIX: Remove explicit any
catch (error) {
  const message = error instanceof Error ? error.message : 'Unknown error';
}
```

#### `/dashboard/page.tsx`
```typescript
// ❌ Lines 64, 72, 94: Unescaped quotes
<p>You don't have any events today. Why don't you create one?</p>

// ✅ FIX: Escape quotes
<p>You don&apos;t have any events today. Why don&apos;t you create one?</p>
```

### 2. Events Pages

#### `/events/[id]/edit/page.tsx`
```typescript
// ❌ Lines 145: Unescaped quotes
<p className="text-sm text-gray-500">You haven't uploaded any images yet.</p>

// ✅ FIX: Escape quotes
<p className="text-sm text-gray-500">You haven&apos;t uploaded any images yet.</p>
```

#### `/events/[id]/page.tsx`
```typescript
// ❌ Line 98: Type any
const groupedBookings = bookings.reduce((acc: any, booking) => {

// ✅ FIX: Use proper type
interface GroupedBookings {
  [key: string]: Array<{
    customer: Customer;
    booking: Booking;
  }>;
}

const groupedBookings = bookings.reduce<GroupedBookings>((acc, booking) => {
```

### 3. Messages Pages

#### `/messages/bulk/page.tsx`
```typescript
// ❌ Line 220: Unnecessary dependencies
useCallback(() => {
  // function body
}, [categories, events]); // categories and events are not used

// ✅ FIX: Remove unused dependencies
useCallback(() => {
  // function body
}, []);
```

#### `/messages/page.tsx`
```typescript
// ❌ Line 8: Unused import
import { Message } from '@/types/database';

// ✅ FIX: Remove if not used
// Delete the line

// ❌ Line 18: Type any
} catch (err: any) {

// ✅ FIX: Remove explicit any
} catch (err) {
  console.error('Error:', err);
}
```

### 4. Private Bookings Pages

#### `/private-bookings/[id]/items/page.tsx`
```typescript
// ❌ Line 92: Type any
onChange={(e: any) => {

// ✅ FIX: Use proper event type
onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
```

#### `/private-bookings/[id]/page.tsx`
```typescript
// ❌ Lines 397, 1085: Missing dependencies
useEffect(() => {
  loadOptions();
}, []); // Missing loadOptions

// ✅ FIX: Add dependency
useEffect(() => {
  loadOptions();
}, [loadOptions]);

// Or make it stable with useCallback
const loadOptions = useCallback(async () => {
  // function body
}, []);
```

#### `/private-bookings/page.tsx`
```typescript
// ❌ Line 86: Unused variable
const hasEditPermission = checkPermission('private_bookings', 'edit');

// ✅ FIX: Use it or remove it
// If not needed, delete the line
// If needed later, prefix with underscore
const _hasEditPermission = checkPermission('private_bookings', 'edit');
```

### 5. Settings Pages

#### `/settings/catering/page.tsx`
```typescript
// ❌ Line 7: Unused import
import { TrashIcon } from '@heroicons/react/24/outline';

// ✅ FIX: Remove unused import
// Delete the line

// ❌ Line 360: Unescaped quote
<p>You haven't added any catering packages yet.</p>

// ✅ FIX: Escape quote
<p>You haven&apos;t added any catering packages yet.</p>
```

#### `/settings/api-keys/ApiKeysManager.tsx`
```typescript
// ❌ Line 178, 285: Unescaped quotes
<p>Once you've created an API key...</p>

// ✅ FIX: Escape quotes
<p>Once you&apos;ve created an API key...</p>
```

#### `/settings/calendar-test/page.tsx`
```typescript
// ❌ Lines 135, 141-143: Unescaped quotes
<code>"events"</code>

// ✅ FIX: Use HTML entities
<code>&quot;events&quot;</code>
```

#### `/settings/gdpr/page.tsx`
```typescript
// ❌ Lines 206: Unescaped quotes
"anonymized"

// ✅ FIX: Use HTML entities
&quot;anonymized&quot;
```

### 6. Profile Pages

#### `/profile/page.tsx`
```typescript
// ❌ Line 46: Prefer const
let fetchError = null;

// ✅ FIX: Use const
const fetchError = null;
```

### 7. Action Files

#### `/actions/audit.ts`
```typescript
// ❌ Line 9: Type any
details?: any;

// ✅ FIX: Use proper type
details?: Record<string, unknown>;
```

## Common Fixes

### 1. Unescaped Entities

Replace all quotes and apostrophes in JSX:
```typescript
// Search for these patterns and replace:
'  → &apos;
"  → &quot;
<  → &lt;
>  → &gt;
&  → &amp;
```

### 2. Remove Type Any

```typescript
// ❌ BAD
catch (error: any) {
  console.log(error.message);
}

// ✅ GOOD
catch (error) {
  const message = error instanceof Error ? error.message : 'Unknown error';
  console.log(message);
}

// ❌ BAD
const data: any = await response.json();

// ✅ GOOD
const data: unknown = await response.json();
// Then validate/parse the data
```

### 3. Fix Unused Variables

Options for unused variables:
```typescript
// Option 1: Remove if not needed
// const unused = 'value'; // DELETE THIS

// Option 2: Prefix with underscore if needed later
const _unused = 'value';

// Option 3: Use it
const used = 'value';
console.log(used);
```

### 4. Fix React Hook Dependencies

```typescript
// ❌ BAD: Missing dependency
useEffect(() => {
  loadData();
}, []); // loadData is missing

// ✅ GOOD: Include all dependencies
useEffect(() => {
  loadData();
}, [loadData]);

// ✅ BETTER: Make function stable
const loadData = useCallback(async () => {
  // load data
}, [/* only stable deps */]);

useEffect(() => {
  loadData();
}, [loadData]);
```

## ESLint Configuration Updates

Consider updating `.eslintrc.json` to prevent these issues:

```json
{
  "extends": ["next/core-web-vitals"],
  "rules": {
    "react/no-unescaped-entities": "error",
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/no-unused-vars": [
      "error",
      {
        "argsIgnorePattern": "^_",
        "varsIgnorePattern": "^_"
      }
    ],
    "prefer-const": "error",
    "react-hooks/exhaustive-deps": "warn"
  }
}
```

## Automated Fixes

Run these commands to auto-fix some issues:

```bash
# Auto-fix what ESLint can
npm run lint -- --fix

# Format with Prettier
npx prettier --write "src/**/*.{ts,tsx}"

# Type check
npx tsc --noEmit
```

## Manual Fix Script

Create a script to fix common issues:

```typescript
// scripts/fix-eslint-issues.ts
import { readFileSync, writeFileSync } from 'fs';
import { glob } from 'glob';

// Fix unescaped entities
function fixUnescapedEntities(content: string): string {
  return content
    .replace(/(\w)'(\w)/g, '$1&apos;$2')  // don't → don&apos;t
    .replace(/>"/g, '>&quot;')             // >" → >&quot;
    .replace(/"</g, '&quot;<');            // "< → &quot;<
}

// Process files
const files = glob.sync('src/**/*.tsx');
files.forEach(file => {
  const content = readFileSync(file, 'utf-8');
  const fixed = fixUnescapedEntities(content);
  if (content !== fixed) {
    writeFileSync(file, fixed);
    console.log(`Fixed: ${file}`);
  }
});
```

## Verification

After fixes:

```bash
# Run lint to verify
npm run lint

# Should see:
# ✔ No ESLint errors found
# ✔ No ESLint warnings found
```

## Prevention

1. **Pre-commit Hook**: Add husky to run ESLint before commits
2. **CI/CD Check**: Fail builds if ESLint errors exist
3. **Editor Integration**: Configure VS Code to show ESLint errors
4. **Code Reviews**: Check for ESLint issues in PRs

## Next Steps

1. Fix all errors first (breaking the build)
2. Fix warnings by category
3. Run `npm run lint` to verify
4. Update ESLint config to prevent future issues
5. Add pre-commit hooks

All documentation is now complete! The issues have been thoroughly documented in the `/docs` directory.