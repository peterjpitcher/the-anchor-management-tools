# Coding Conventions

**Analysis Date:** 2026-05-18

## Naming Patterns

**Files:**
- React page files: `page.tsx` (Next.js App Router convention)
- React component files: `PascalCase.tsx` (e.g., `MileageClient.tsx`, `DishExpandedRow.tsx`)
- Server action files: `camelCase.ts` (e.g., `mileage.ts`, `quotes.ts`, `employeeDetails.ts`)
- Test files: co-located with source in `__tests__/` subdirectory (e.g., `src/lib/__tests__/dateUtils.test.ts`) or co-located directly (e.g., `src/services/private-bookings.test.ts`)
- Library/utility files: `camelCase.ts` (e.g., `hmrcRates.ts`, `dateUtils.ts`, `audit-helpers.ts`)

**Functions:**
- Exported server actions: `camelCase` async functions (e.g., `getDestinations`, `createTrip`, `deleteTrip`)
- Internal helpers: `camelCase` (e.g., `requireMileagePermission`, `revalidateMileagePaths`, `validateManualTripLegs`)
- Constants: `SCREAMING_SNAKE_CASE` (e.g., `STANDARD_RATE`, `REDUCED_RATE`, `THRESHOLD_MILES`)

**Variables:**
- All TypeScript variables: `camelCase`
- Zod schema objects: `camelCase` with `Schema` suffix (e.g., `destinationSchema`, `tripLegSchema`, `createTripSchema`)

**Types and Interfaces:**
- Interfaces: `PascalCase` with named exports (e.g., `MileageDestination`, `MileageTrip`, `MileageTripLeg`)
- Type aliases: `PascalCase` (e.g., `MileageGranularity`, `GenericClient`)
- Exported from action files alongside the functions they relate to

**Database:**
- DB columns: `snake_case` (as stored in Supabase)
- TypeScript representations: `camelCase` with manual mapping in query results
- No `fromDb<T>()` generic helper used in this project — manual field-by-field mapping in query result transforms

## Code Style

**Formatting:**
- No Prettier config detected — formatting enforced via ESLint
- Single quotes for strings
- No semicolons at end of statements in most files (some legacy files use semicolons)
- Two-space indentation

**Linting:**
- ESLint v9 flat config (`eslint.config.js`)
- Extends `next/core-web-vitals` + `next/typescript`
- `no-console` is an error — `console.warn` and `console.error` are the only permitted console calls
  - Exception: `src/scripts/**` files allow all console calls
- `@typescript-eslint/no-unused-vars`: off (not enforced)
- `@typescript-eslint/no-explicit-any`: off (not enforced, but should still be avoided)
- `react-hooks/exhaustive-deps`: off
- `@next/next/no-img-element`: off
- ESLint rule prevents importing `@/lib/supabase-singleton` in any `src/components/**` file — admin client must only be used in server actions and route handlers
- Zero warnings enforced via `--max-warnings=0` in `npm run lint`

## Import Organization

**Order (observed pattern in server actions):**
1. Framework imports (`'use server'` directive at top, then `next/cache`, `next/navigation`)
2. Third-party libraries (e.g., `zod`)
3. Relative action imports (e.g., `./rbac`, `./audit`)
4. Internal `@/` path imports — lib utilities then service clients
5. Type imports last (using `import type`)

**Path Aliases:**
- `@/` maps to `src/` (configured in `vitest.config.ts` and `tsconfig.json`)

**Example:**
```typescript
'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { checkUserPermission } from './rbac'
import { logAuditEvent } from './audit'
import { getCurrentUser } from '@/lib/audit-helpers'
import { createAdminClient } from '@/lib/supabase/admin'
import { getTodayIsoDate } from '@/lib/dateUtils'
import type { SomeType } from '@/types/something'
```

## Server Action Pattern

All mutations use this pattern in `src/app/actions/`:

```typescript
'use server'

export async function doSomething(input: InputType): Promise<{ success?: boolean; error?: string; data?: ResultType }> {
  try {
    // 1. Permission check (throws on failure)
    const { userId } = await requirePermission('manage')
    const db = createAdminClient()

    // 2. Zod validation
    const parsed = schema.safeParse(input)
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
    }

    // 3. Business logic + DB operations
    const { data, error } = await db.from('table').insert({...}).select().single()
    if (error) throw error

    // 4. Audit log
    await logAuditEvent({ user_id: userId, operation_type: 'create', resource_type: 'thing', operation_status: 'success' })

    // 5. Cache invalidation
    revalidatePath('/path')
    return { success: true, data }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to do something'
    return { error: message }
  }
}
```

Return type is always `Promise<{ success?: boolean; error?: string; data?: T }>`.

## Error Handling

**Strategy:** Try/catch in every server action. DB errors thrown inline (`if (error) throw error`), caught at action boundary.

**Patterns:**
- Permission failures: throw `new Error('Insufficient permissions')` or `new Error('Unauthorized')` inside permission helper
- Validation failures: return `{ error: parsed.error.issues[0]?.message }` immediately (no throw)
- DB errors: `if (dbError) throw dbError` — caught by outer try/catch
- Catch block always extracts message: `error instanceof Error ? error.message : 'Fallback message'`
- Service layer (non-action) functions may throw directly (caller handles)

## Logging

**Permitted calls:** `console.warn()` and `console.error()` only (enforced by ESLint).

**Pattern:** `console.error('Descriptive context message:', error)` — seen in `src/app/actions/messageTemplates.ts`.

**Audit logging:** All mutations call `logAuditEvent()` from `src/app/actions/audit.ts`.

## Comments

**Section Dividers:** Large action files use 75-char dashed dividers with a label:
```typescript
// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------
```

**Inline comments:** Used to explain "why" for non-obvious logic (e.g., BST boundary calculations, threshold splits).

**JSDoc:** Used sparingly — seen on exported interfaces for property descriptions (e.g., `/** Human-readable route summary */`).

## Component Design

**Client vs Server:**
- Default to server components for page-level data fetching
- `'use client'` added for interactivity, hooks, and browser APIs
- Data passed from server parents as props to client children

**UI Component Library:**
- New code uses `src/components/ui-v2/` via the barrel export `src/components/ui-v2/index.ts`
- Legacy `PageWrapper`/`Page` pattern still exists but being phased out
- New pages: use `PageLayout` + `HeaderNav` from `ui-v2`

**Design Tokens:**
- Defined in `src/components/ui-v2/tokens.ts` — primary green `#16a34a`, neutral grays
- Tailwind classes only — no inline hex colors in components
- Never use dynamic Tailwind class construction (e.g., no `bg-${color}-500`)

## Module Design

**Exports:**
- Named exports everywhere (no default exports from utility/service files)
- Default exports used only for Next.js page/layout components

**Barrel Files:**
- `src/components/ui-v2/index.ts` is the single export point for the UI library
- `src/components/ui-v2/navigation/index.ts` sub-barrel for navigation components
- Service and action files do not use barrel exports — import directly from specific files

## Form Validation

**Pattern:** Zod schemas defined at the top of action files, grouped in a "Zod Schemas" section. Use `.safeParse()` — never `.parse()` — in server actions:

```typescript
const schema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format'),
})

const parsed = schema.safeParse(input)
if (!parsed.success) {
  return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }
}
```

## Date Handling

- Always use `src/lib/dateUtils.ts` utilities for user-facing dates
- Key functions: `getTodayIsoDate()`, `toLocalIsoDate()`, `formatDateInLondon()`, `formatTime12Hour()`
- London timezone hardcoded (`Europe/London`) throughout
- Never use raw `new Date()` or `.toISOString()` for display

## Phone Numbers

- Normalise to E.164 format via `formatPhoneForStorage()` from `src/lib/utils.ts` (delegates to `src/lib/phone/`)
- `generatePhoneVariants()` used for search matching across formats

---

*Convention analysis: 2026-05-18*
