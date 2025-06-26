# Comprehensive Testing Strategy

This document outlines the testing strategy for The Anchor Management Tools based on audit findings and critical issues.

## 🎯 Testing Priorities

### Critical (Week 1)
1. **Data Validation** - Prevent invalid data entry
2. **Rate Limiting** - Verify DDoS protection
3. **GDPR Compliance** - Ensure data rights work
4. **Authentication** - Confirm security boundaries

### High (Month 1)
1. **Performance** - Load testing and optimization
2. **SMS Delivery** - End-to-end messaging tests
3. **Booking Flows** - Complete user journeys
4. **Error Handling** - Graceful failure scenarios

### Medium (Quarter 1)
1. **Accessibility** - WCAG compliance
2. **Cross-browser** - Compatibility testing
3. **Mobile Experience** - Responsive design
4. **Integration** - Third-party services

## Testing Pyramid

```
         /\
        /  \       E2E Tests (10%)
       /────\      - Critical user journeys
      /      \     - Happy path scenarios
     /────────\    
    /          \   Integration Tests (30%)
   /────────────\  - API endpoints
  /              \ - Database operations
 /────────────────\- External services
/                  \
────────────────────── Unit Tests (60%)
                       - Business logic
                       - Validation rules
                       - Utility functions
```

## Test Implementation Plan

### Phase 1: Unit Tests (Week 1)

#### 1.1 Validation Tests

Create `src/lib/__tests__/validation.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import {
  phoneSchema,
  emailSchema,
  futureDateSchema,
  customerSchema,
  formatPhoneForStorage,
  formatPhoneForDisplay,
} from '../validation';

describe('Phone Number Validation', () => {
  describe('phoneSchema', () => {
    const validNumbers = [
      { input: '+447700900123', description: 'E.164 format' },
      { input: '+447911123456', description: 'Different UK mobile' },
    ];

    const invalidNumbers = [
      { input: '123', description: 'Too short' },
      { input: '07700900123', description: 'Missing country code' },
      { input: 'notaphone', description: 'Not a number' },
      { input: '+44', description: 'Incomplete' },
      { input: '+1234567890', description: 'Non-UK number' },
    ];

    validNumbers.forEach(({ input, description }) => {
      it(`accepts valid number: ${description}`, () => {
        expect(() => phoneSchema.parse(input)).not.toThrow();
      });
    });

    invalidNumbers.forEach(({ input, description }) => {
      it(`rejects invalid number: ${description}`, () => {
        expect(() => phoneSchema.parse(input)).toThrow();
      });
    });

    it('allows empty values', () => {
      expect(() => phoneSchema.parse('')).not.toThrow();
      expect(() => phoneSchema.parse(null)).not.toThrow();
      expect(() => phoneSchema.parse(undefined)).not.toThrow();
    });
  });

  describe('Phone Number Formatting', () => {
    it('formats for storage correctly', () => {
      expect(formatPhoneForStorage('07700900123')).toBe('+447700900123');
      expect(formatPhoneForStorage('07700 900123')).toBe('+447700900123');
      expect(formatPhoneForStorage('+447700900123')).toBe('+447700900123');
    });

    it('formats for display correctly', () => {
      expect(formatPhoneForDisplay('+447700900123')).toBe('07700 900123');
      expect(formatPhoneForDisplay(null)).toBe('');
    });

    it('throws on invalid format', () => {
      expect(() => formatPhoneForStorage('123')).toThrow();
      expect(() => formatPhoneForStorage('invalid')).toThrow();
    });
  });
});

describe('Date Validation', () => {
  it('accepts future dates', () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    expect(() => futureDateSchema.parse(tomorrow.toISOString())).not.toThrow();
  });

  it('accepts today', () => {
    const today = new Date().toISOString().split('T')[0];
    expect(() => futureDateSchema.parse(today)).not.toThrow();
  });

  it('rejects past dates', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    expect(() => futureDateSchema.parse(yesterday.toISOString())).toThrow();
  });
});

describe('Email Validation', () => {
  const validEmails = [
    'user@example.com',
    'user.name@example.co.uk',
    'user+tag@example.com',
  ];

  const invalidEmails = [
    'notanemail',
    '@example.com',
    'user@',
    'user@example',
  ];

  validEmails.forEach((email) => {
    it(`accepts valid email: ${email}`, () => {
      expect(() => emailSchema.parse(email)).not.toThrow();
    });
  });

  invalidEmails.forEach((email) => {
    it(`rejects invalid email: ${email}`, () => {
      expect(() => emailSchema.parse(email)).toThrow();
    });
  });
});
```

#### 1.2 Business Logic Tests

Create `src/app/actions/__tests__/bookings.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createBooking } from '../bookings';
import { createClient } from '@/lib/supabase/server';

vi.mock('@/lib/supabase/server');

describe('Booking Creation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prevents overbooking', async () => {
    const mockSupabase = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          id: 'event-1',
          capacity: 10,
          bookings: [
            { seats: 5 },
            { seats: 3 },
          ],
        },
      }),
    };

    vi.mocked(createClient).mockReturnValue(mockSupabase as any);

    const formData = new FormData();
    formData.set('event_id', 'event-1');
    formData.set('customer_id', 'customer-1');
    formData.set('seats', '5'); // Requesting 5, but only 2 available

    const result = await createBooking(formData);
    
    expect(result.error).toBe('Only 2 seats available for this event');
  });

  it('prevents booking past events', async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    const mockSupabase = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          id: 'event-1',
          date: yesterday.toISOString(),
          capacity: 100,
          bookings: [],
        },
      }),
    };

    vi.mocked(createClient).mockReturnValue(mockSupabase as any);

    const formData = new FormData();
    formData.set('event_id', 'event-1');
    formData.set('customer_id', 'customer-1');
    formData.set('seats', '2');

    const result = await createBooking(formData);
    
    expect(result.error).toBe('Cannot book past events');
  });
});
```

#### 1.3 Rate Limiting Tests

Create `src/lib/__tests__/rate-limit.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { checkRateLimit } from '../rate-limit';
import { redis } from '../redis';

describe('Rate Limiting', () => {
  const testId = `test-${Date.now()}`;

  beforeAll(async () => {
    // Ensure Redis connection
    await redis.ping();
  });

  afterAll(async () => {
    // Clean up test data
    await redis.del(`rl:api:${testId}`);
  });

  it('allows requests within limit', async () => {
    const results = [];
    
    // Make 5 requests (well under 100/min limit)
    for (let i = 0; i < 5; i++) {
      const result = await checkRateLimit('api', testId);
      results.push(result);
    }

    results.forEach((result) => {
      expect(result.success).toBe(true);
      expect(result.remaining).toBeGreaterThan(0);
    });
  });

  it('enforces SMS rate limit', async () => {
    const smsTestId = `sms-test-${Date.now()}`;
    
    // SMS limit is 10/minute
    for (let i = 0; i < 10; i++) {
      await checkRateLimit('sms', smsTestId);
    }

    // 11th request should fail
    const result = await checkRateLimit('sms', smsTestId);
    expect(result.success).toBe(false);
    expect(result.remaining).toBe(0);
  });
});
```

### Phase 2: Integration Tests (Week 2)

#### 2.1 API Endpoint Tests

Create `src/app/api/__tests__/health.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { GET } from '../health/route';

describe('Health Check Endpoint', () => {
  it('returns healthy status when all services are up', async () => {
    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.status).toBe('healthy');
    expect(data.checks).toHaveProperty('database');
    expect(data.checks).toHaveProperty('auth');
    expect(data.checks).toHaveProperty('storage');
  });

  it('returns unhealthy status when a service is down', async () => {
    // Mock a database failure
    // ... mock implementation

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data.status).toBe('unhealthy');
  });
});
```

#### 2.2 Database Operations

Create `src/lib/__tests__/database.integration.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { createClient } from '@/lib/supabase/server';

describe('Database Operations', () => {
  const supabase = createClient();
  let testCustomerId: string;

  beforeEach(async () => {
    // Create test customer
    const { data } = await supabase
      .from('customers')
      .insert({
        first_name: 'Test',
        last_name: 'User',
        mobile_number: '+447700900999',
      })
      .select()
      .single();
    
    testCustomerId = data.id;
  });

  afterEach(async () => {
    // Clean up
    await supabase
      .from('customers')
      .delete()
      .eq('id', testCustomerId);
  });

  it('enforces phone number constraint', async () => {
    const { error } = await supabase
      .from('customers')
      .insert({
        first_name: 'Invalid',
        last_name: 'Phone',
        mobile_number: '123', // Invalid format
      });

    expect(error).toBeTruthy();
    expect(error.code).toBe('23514'); // Check constraint violation
  });

  it('cascades booking deletion with event', async () => {
    // Create event
    const { data: event } = await supabase
      .from('events')
      .insert({
        name: 'Test Event',
        date: new Date().toISOString(),
        time: '19:00',
        capacity: 100,
      })
      .select()
      .single();

    // Create booking
    const { data: booking } = await supabase
      .from('bookings')
      .insert({
        event_id: event.id,
        customer_id: testCustomerId,
        seats: 2,
      })
      .select()
      .single();

    // Delete event
    await supabase
      .from('events')
      .delete()
      .eq('id', event.id);

    // Verify booking was deleted
    const { data: deletedBooking } = await supabase
      .from('bookings')
      .select()
      .eq('id', booking.id)
      .single();

    expect(deletedBooking).toBeNull();
  });
});
```

### Phase 3: End-to-End Tests (Week 3)

#### 3.1 Critical User Journeys

Create `e2e/booking-flow.spec.ts`:
```typescript
import { test, expect } from '@playwright/test';

test.describe('Booking Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Login
    await page.goto('/login');
    await page.fill('[name="email"]', 'test@example.com');
    await page.fill('[name="password"]', 'testpassword');
    await page.click('[type="submit"]');
    await page.waitForURL('/dashboard');
  });

  test('complete booking journey', async ({ page }) => {
    // Navigate to events
    await page.goto('/events');
    
    // Create new event
    await page.click('text=Create Event');
    await page.fill('[name="name"]', 'Test Quiz Night');
    await page.fill('[name="date"]', '2024-12-31');
    await page.fill('[name="time"]', '19:00');
    await page.fill('[name="capacity"]', '50');
    await page.click('text=Create Event');

    // Verify event created
    await expect(page.locator('text=Test Quiz Night')).toBeVisible();

    // Navigate to customers
    await page.goto('/customers');
    
    // Create customer
    await page.click('text=Add Customer');
    await page.fill('[name="first_name"]', 'John');
    await page.fill('[name="last_name"]', 'Doe');
    await page.fill('[name="mobile_number"]', '07700900123');
    await page.click('text=Create Customer');

    // Create booking
    await page.goto('/bookings/new');
    await page.selectOption('[name="event_id"]', 'Test Quiz Night');
    await page.selectOption('[name="customer_id"]', 'John Doe');
    await page.fill('[name="seats"]', '2');
    await page.click('text=Create Booking');

    // Verify booking created
    await expect(page.locator('text=Booking confirmed')).toBeVisible();
  });

  test('prevents overbooking', async ({ page }) => {
    // Assume event with capacity 10, 8 seats booked
    await page.goto('/bookings/new');
    await page.selectOption('[name="event_id"]', 'Nearly Full Event');
    await page.selectOption('[name="customer_id"]', 'John Doe');
    await page.fill('[name="seats"]', '5'); // Try to book 5 when only 2 available
    await page.click('text=Create Booking');

    // Verify error message
    await expect(page.locator('text=Only 2 seats available')).toBeVisible();
  });
});
```

#### 3.2 GDPR Compliance Tests

Create `e2e/gdpr-compliance.spec.ts`:
```typescript
import { test, expect } from '@playwright/test';

test.describe('GDPR Compliance', () => {
  test('privacy policy accessible', async ({ page }) => {
    await page.goto('/');
    
    // Check footer link
    await page.click('text=Privacy Policy');
    await expect(page).toHaveURL('/privacy');
    await expect(page.locator('h1')).toContainText('Privacy Policy');
    
    // Verify key sections
    await expect(page.locator('text=Information We Collect')).toBeVisible();
    await expect(page.locator('text=Your Rights')).toBeVisible();
    await expect(page.locator('text=Contact Us')).toBeVisible();
  });

  test('data export functionality', async ({ page }) => {
    // Login and navigate to customer
    await page.goto('/login');
    // ... login steps
    
    await page.goto('/customers/123/gdpr');
    
    // Request data export
    await page.click('text=Export Data');
    
    // Wait for download
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('text=Download JSON'),
    ]);

    // Verify download
    expect(download.suggestedFilename()).toContain('customer-data');
    expect(download.suggestedFilename()).toContain('.json');
  });

  test('consent management', async ({ page }) => {
    await page.goto('/customers/new');
    
    // Check consent checkbox
    const consentCheckbox = page.locator('[name="sms_opt_in"]');
    await expect(consentCheckbox).not.toBeChecked();
    
    // Check consent
    await consentCheckbox.check();
    
    // Verify consent text
    await expect(page.locator('text=Reply STOP to opt-out')).toBeVisible();
    
    // Submit form
    await page.fill('[name="first_name"]', 'Jane');
    await page.fill('[name="mobile_number"]', '07700900123');
    await page.click('text=Create Customer');
    
    // Verify consent recorded
    await page.goto('/customers/jane-doe');
    await expect(page.locator('text=SMS Marketing: ✓')).toBeVisible();
  });
});
```

### Phase 4: Performance Tests (Week 4)

#### 4.1 Load Testing

Create `performance/load-test.js`:
```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '2m', target: 10 },  // Ramp up
    { duration: '5m', target: 50 },  // Stay at 50 users
    { duration: '2m', target: 100 }, // Peak load
    { duration: '2m', target: 0 },   // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<3000'], // 95% of requests under 3s
    http_req_failed: ['rate<0.1'],    // Error rate under 10%
  },
};

export default function () {
  const BASE_URL = 'https://management.orangejelly.co.uk';

  // Test health endpoint
  const healthRes = http.get(`${BASE_URL}/api/health`);
  check(healthRes, {
    'health check status is 200': (r) => r.status === 200,
    'health check responds quickly': (r) => r.timings.duration < 500,
  });

  sleep(1);

  // Test customer list (authenticated)
  const headers = {
    'Authorization': `Bearer ${__ENV.TEST_TOKEN}`,
  };
  
  const customersRes = http.get(`${BASE_URL}/api/customers`, { headers });
  check(customersRes, {
    'customers status is 200': (r) => r.status === 200,
    'customers response time OK': (r) => r.timings.duration < 2000,
  });

  sleep(2);
}
```

#### 4.2 Database Query Performance

Create `performance/database-performance.sql`:
```sql
-- Test query performance
EXPLAIN ANALYZE
SELECT 
  c.id,
  c.first_name,
  c.last_name,
  COUNT(b.id) as total_bookings,
  MAX(e.date) as last_event_date
FROM customers c
LEFT JOIN bookings b ON b.customer_id = c.id
LEFT JOIN events e ON e.id = b.event_id
WHERE c.created_at > NOW() - INTERVAL '30 days'
GROUP BY c.id
ORDER BY total_bookings DESC
LIMIT 100;

-- Check for missing indexes
SELECT 
  schemaname,
  tablename,
  attname,
  n_distinct,
  most_common_vals
FROM pg_stats
WHERE tablename IN ('customers', 'bookings', 'events', 'messages')
  AND n_distinct > 100
  AND NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = pg_stats.tablename
    AND indexdef LIKE '%' || attname || '%'
  );
```

### Phase 5: Security Tests (Month 2)

#### 5.1 Authentication Tests

Create `security/auth.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';

describe('Authentication Security', () => {
  it('prevents access to protected routes without auth', async () => {
    const protectedRoutes = [
      '/dashboard',
      '/customers',
      '/events',
      '/employees',
      '/settings',
    ];

    for (const route of protectedRoutes) {
      const response = await fetch(`${BASE_URL}${route}`, {
        redirect: 'manual',
      });
      
      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toContain('/login');
    }
  });

  it('enforces rate limiting on login attempts', async () => {
    const attempts = [];
    
    // Make 6 login attempts (limit is 5/15min)
    for (let i = 0; i < 6; i++) {
      attempts.push(
        fetch(`${BASE_URL}/api/auth/login`, {
          method: 'POST',
          body: JSON.stringify({
            email: 'test@example.com',
            password: 'wrongpassword',
          }),
        })
      );
    }

    const responses = await Promise.all(attempts);
    const lastResponse = responses[5];
    
    expect(lastResponse.status).toBe(429);
    expect(lastResponse.headers.get('retry-after')).toBeTruthy();
  });
});
```

#### 5.2 Input Sanitization

Create `security/input-sanitization.test.ts`:
```typescript
describe('Input Sanitization', () => {
  const maliciousInputs = [
    '<script>alert("XSS")</script>',
    '"; DROP TABLE customers; --',
    '../../../etc/passwd',
    'javascript:alert(1)',
    '<img src=x onerror=alert(1)>',
  ];

  it('sanitizes customer names', async () => {
    for (const input of maliciousInputs) {
      const response = await createCustomer({
        first_name: input,
        last_name: 'Test',
        mobile_number: '+447700900123',
      });

      // Should either reject or sanitize
      if (response.data) {
        expect(response.data.first_name).not.toContain('<script>');
        expect(response.data.first_name).not.toContain('DROP TABLE');
      }
    }
  });
});
```

## Test Automation

### Continuous Integration

Create `.github/workflows/test.yml`:
```yaml
name: Test Suite

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run unit tests
        run: npm run test:unit
      
      - name: Upload coverage
        uses: codecov/codecov-action@v3

  integration-tests:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: supabase/postgres:15
        env:
          POSTGRES_PASSWORD: postgres
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      
      - name: Setup test database
        run: |
          npm run db:test:setup
      
      - name: Run integration tests
        run: npm run test:integration
        env:
          DATABASE_URL: postgresql://postgres:postgres@localhost:5432/test

  e2e-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      
      - name: Install Playwright
        run: npx playwright install --with-deps
      
      - name: Run E2E tests
        run: npm run test:e2e
        env:
          BASE_URL: ${{ secrets.STAGING_URL }}
          TEST_USER_EMAIL: ${{ secrets.TEST_USER_EMAIL }}
          TEST_USER_PASSWORD: ${{ secrets.TEST_USER_PASSWORD }}
```

### Test Scripts

Update `package.json`:
```json
{
  "scripts": {
    "test": "vitest",
    "test:unit": "vitest run src/**/*.test.ts",
    "test:integration": "vitest run src/**/*.integration.test.ts",
    "test:e2e": "playwright test",
    "test:load": "k6 run performance/load-test.js",
    "test:security": "npm run test:security:auth && npm run test:security:input",
    "test:coverage": "vitest run --coverage",
    "test:watch": "vitest watch"
  }
}
```

## Test Data Management

### Test Data Factory

Create `tests/factories/customer.factory.ts`:
```typescript
import { faker } from '@faker-js/faker';

export function createTestCustomer(overrides = {}) {
  return {
    first_name: faker.person.firstName(),
    last_name: faker.person.lastName(),
    email_address: faker.internet.email(),
    mobile_number: `+447${faker.string.numeric(9)}`,
    date_of_birth: faker.date.past({ years: 50 }).toISOString(),
    sms_opt_in: faker.datatype.boolean(),
    notes: faker.lorem.sentence(),
    ...overrides,
  };
}

export function createTestEvent(overrides = {}) {
  const futureDate = faker.date.future();
  return {
    name: faker.lorem.words(3),
    date: futureDate.toISOString().split('T')[0],
    time: faker.date.future().toTimeString().slice(0, 5),
    capacity: faker.number.int({ min: 10, max: 200 }),
    ...overrides,
  };
}
```

### Database Seeding

Create `tests/seed.ts`:
```typescript
import { createClient } from '@/lib/supabase/server';
import { createTestCustomer, createTestEvent } from './factories';

export async function seedTestData() {
  const supabase = createClient();
  
  // Create test customers
  const customers = Array(50).fill(null).map(() => createTestCustomer());
  await supabase.from('customers').insert(customers);
  
  // Create test events
  const events = Array(20).fill(null).map(() => createTestEvent());
  await supabase.from('events').insert(events);
  
  console.log('✅ Test data seeded');
}

export async function cleanupTestData() {
  const supabase = createClient();
  
  // Delete test data (be careful in production!)
  await supabase.from('bookings').delete().match({ test_data: true });
  await supabase.from('events').delete().match({ test_data: true });
  await supabase.from('customers').delete().match({ test_data: true });
  
  console.log('✅ Test data cleaned up');
}
```

## Testing Checklist

### Before Each Release

- [ ] All unit tests passing
- [ ] Integration tests passing
- [ ] E2E tests for critical paths passing
- [ ] No console errors in browser
- [ ] Performance benchmarks met
- [ ] Security scan completed
- [ ] Accessibility audit passed
- [ ] Mobile testing completed
- [ ] Cross-browser testing done

### Weekly

- [ ] Review test coverage reports
- [ ] Update test data
- [ ] Check for flaky tests
- [ ] Review error logs from production
- [ ] Update test documentation

### Monthly

- [ ] Full regression test
- [ ] Load testing
- [ ] Security penetration test
- [ ] Accessibility audit
- [ ] Performance profiling

## Success Metrics

- **Test Coverage**: > 80% for critical paths
- **Test Execution Time**: < 10 minutes for CI
- **Test Reliability**: < 1% flaky tests
- **Bug Detection**: > 90% caught before production
- **Performance**: All endpoints < 3s response time