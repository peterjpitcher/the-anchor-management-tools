# Testing Patterns

**Analysis Date:** 2026-05-18

## Test Framework

**Runner:**
- Vitest (not Jest)
- Config: `vitest.config.ts`
- React plugin: `@vitejs/plugin-react`
- Environment: `jsdom`
- Globals: enabled (no need to import `describe`, `it`, `expect` from vitest in test files — though most files import them explicitly anyway)
- Setup file: `vitest.setup.ts`

**Assertion Library:**
- Vitest built-in (`expect`)
- `@testing-library/jest-dom` matchers loaded via `vitest.setup.ts`

**Run Commands:**
```bash
npm test                     # Run all tests once (VITE_CJS_IGNORE_WARNING=true vitest run)
npm run test:coverage        # With v8 coverage report
npx vitest run src/lib/some-module.test.ts  # Run single file
```

**Coverage Provider:** v8
**Coverage Reports:** text, html, lcov
**Coverage Thresholds (current, low — reflect legacy debt):**
- Lines: 42%
- Branches: 34%
- Functions: 52%

## Test File Organization

**Two patterns coexist:**

1. `__tests__/` subdirectory alongside source:
   - `src/lib/__tests__/dateUtils.test.ts`
   - `src/lib/__tests__/status-transitions.test.ts`
   - `src/lib/mileage/__tests__/hmrcRates.test.ts`
   - `src/lib/sms/__tests__/safety.test.ts`
   - `src/app/actions/__tests__/mileage.test.ts`
   - `src/app/actions/__tests__/refundActions.test.ts`

2. Co-located directly next to source file:
   - `src/services/private-bookings.test.ts`
   - `src/lib/mgd/quarterMapping.test.ts`
   - `src/lib/private-bookings/weekly-digest-classifier.test.ts`

**Prefer `__tests__/` subdirectory** for new tests — it is the dominant and cleaner pattern.

**Naming:**
- `{moduleName}.test.ts` for TypeScript modules
- `{ComponentName}.test.tsx` for React components

## Test Structure

**Suite Organization:**
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mocks declared BEFORE imports of modules under test (critical for vi.mock hoisting)
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

import { functionUnderTest } from '../module'

describe('functionUnderTest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should [expected behaviour] when [condition]', () => {
    // arrange
    // act
    // assert
  })
})
```

**Nested describes** used to group related cases:
```typescript
describe('parentFunction', () => {
  describe('valid transitions from draft', () => {
    it('should allow draft → sent', () => { ... })
  })

  describe('BST/GMT boundary handling', () => {
    it('should display the correct London date during BST', () => { ... })
  })
})
```

**Parameterised tests** (`it.each`) used for exhaustive state/transition coverage:
```typescript
const validTargets: InvoiceStatus[] = ['sent', 'partially_paid', 'paid']
it.each(validTargets)('should allow draft → %s', (to) => {
  expect(isInvoiceStatusTransitionAllowed('draft', to)).toBe(true)
})
```

## Mocking

**Framework:** `vi.mock()` for module-level mocks, `vi.fn()` for function stubs, `vi.mocked()` for typed access.

**Critical rule:** All `vi.mock()` calls must appear before any `import` of the module under test. When mocks must be configured per-test (e.g., `refundActions.test.ts`), use `await import('../module')` inside the test body after setting up mocks, combined with `vi.resetModules()` in `beforeEach`.

**Global mocks (applied to all tests via `vitest.setup.ts`):**
- Twilio: `tests/mocks/twilio.ts` → `mockTwilioClient`
- Microsoft Graph: `tests/mocks/microsoft-graph.ts` → `mockGraphClient`
- `next/navigation`: `useRouter` stubbed with `vi.fn()`
- `server-only`: mocked to `{}`
- `@azure/identity`: `ClientSecretCredential` mocked
- Required env vars set (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, etc.)

**Supabase mock pattern (inline builder):**
```typescript
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

// In test or helper function:
function mockAdminClient(options) {
  vi.mocked(createAdminClient).mockReturnValue({
    from: vi.fn((table: string) => {
      if (table === 'my_table') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: options.data, error: null }),
        }
      }
      return {}
    }),
  })
}
```

**Chain mock pattern (thenable query builder):**

For query chains where filters affect the returned data, implement a `then` method directly on the chain object:
```typescript
function createQueryChain() {
  const range: { gte?: string; lte?: string } = {}
  const chain: Record<string, unknown> = {}
  chain.select = vi.fn(() => chain)
  chain.gte = vi.fn((_col, val) => { range.gte = val; return chain })
  chain.lte = vi.fn((_col, val) => { range.lte = val; return chain })
  chain.then = (resolve, reject) =>
    Promise.resolve({ data: filterData(range), error: null }).then(resolve, reject)
  return chain
}
```

**Always mock:**
- Supabase clients (`@/lib/supabase/admin`, `@/lib/supabase/server`)
- Twilio, Microsoft Graph, Azure Identity (handled globally in setup)
- `next/cache` (`revalidatePath`)
- `next/navigation` (handled globally)
- PayPal (`@/lib/paypal`)
- Audit/RBAC helpers (`@/app/actions/audit`, `@/app/actions/rbac`)
- Date utilities when a fixed "today" is needed (`@/lib/dateUtils`)

**Never mock:**
- Pure utility/calculation functions (`dateUtils`, `hmrcRates`, `status-transitions`)
- Type conversion helpers
- Zod schemas

**Reset between tests:**
```typescript
beforeEach(() => {
  vi.clearAllMocks()      // Clear call history and mock return values
  // vi.resetModules()    // Only when using dynamic imports to avoid module caching
})
```

## Fixtures and Factories

**Test data:** Defined as plain TypeScript arrays/objects at the top of the test file or in a local helper function. No shared fixture files or factory libraries.

**Example pattern:**
```typescript
const mileageRows: MileageTripRow[] = [
  { trip_date: '2026-04-29', total_miles: 27.6, amount_due: 12.42 },
  { trip_date: '2026-04-14', total_miles: 40.2, amount_due: 18.09 },
]
```

**Location:** Inline in test files — no `tests/fixtures/` directory.

**Global mocks directory:** `tests/mocks/` — only Twilio and Microsoft Graph shared mocks live here.

## Coverage

**Requirements:** Thresholds set low (lines 42%, branches 34%, functions 52%) — these are floor values reflecting current state, not targets. Business logic should target 80–90%.

**View Coverage:**
```bash
npm run test:coverage    # Generates text + HTML + lcov reports
# HTML report in coverage/ directory
```

**Excluded from coverage:**
- `node_modules/`
- `.next/`
- `tests/`
- `**/*.config.*`

## Test Types

**Unit Tests (primary):**
- Pure functions: `src/lib/__tests__/`, `src/lib/mileage/__tests__/`, `src/lib/sms/__tests__/`
- Server actions: `src/app/actions/__tests__/`
- Service functions: `src/services/__tests__/`, `src/services/*.test.ts`

**Integration Tests (limited):**
- `src/tests/api/` — API route handlers (e.g., `deposit-waiver.test.ts`)
- `src/tests/lib/` — library utilities with real logic (e.g., `utm.test.ts`)

**E2E Tests:** Not configured. Playwright is not present in this project.

**Component Tests:**
- `src/components/features/events/__tests__/SeoHealthIndicator.test.tsx` — one known component test using `@testing-library/jest-dom`

## Common Patterns

**Async Testing:**
```typescript
it('should return error when permission denied', async () => {
  vi.mocked(checkUserPermission).mockResolvedValue(false)
  const result = await createTrip(input)
  expect(result).toEqual({ error: expect.stringContaining('permission') })
})
```

**Error path testing:**
```typescript
it('should return error message from DB failure', async () => {
  mockAdminClient({ data: null, error: { message: 'db error' } })
  const result = await getBookings()
  expect(result.error).toBeDefined()
})
```

**Timer mocking (for date-dependent tests):**
```typescript
afterEach(() => {
  vi.useRealTimers()
})

it('should reflect faked clock', () => {
  vi.setSystemTime(new Date('2025-06-15T12:00:00Z'))
  const result = getTodayIsoDate()
  expect(result.startsWith('2025-')).toBe(true)
})
```

**Dynamic import for tests requiring per-test module state:**
```typescript
beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
})

it('should reject when permission denied', async () => {
  vi.mocked(checkUserPermission).mockResolvedValue(false)
  const { processPayPalRefund } = await import('../refundActions')
  const result = await processPayPalRefund(...)
  expect(result).toEqual({ error: expect.stringContaining('permission') })
})
```

**Partial match assertions:**
```typescript
expect(result).toMatchObject({
  type: 'deposit',
  amount: 250,
})
expect(result).toEqual({ error: expect.stringContaining('180') })
```

## Test Prioritisation

1. Server actions and business logic (highest value — `src/app/actions/__tests__/`)
2. Data transformation utilities (`src/lib/__tests__/`, `src/lib/mileage/__tests__/`)
3. Service functions (`src/services/__tests__/`)
4. API route handlers (`src/tests/api/`)
5. React components (lowest priority — only one component test currently exists)

---

*Testing analysis: 2026-05-18*
