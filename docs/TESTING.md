# Testing Guide

This guide provides comprehensive information about testing in The Anchor Management Tools, including test philosophy, structure, running tests, and best practices.

## Table of Contents

1. [Testing Overview](#testing-overview)
2. [Test Structure and Organization](#test-structure-and-organization)
3. [Running Tests](#running-tests)
4. [Writing New Tests](#writing-new-tests)
5. [Test Data and Fixtures](#test-data-and-fixtures)
6. [CI/CD Test Integration](#cicd-test-integration)
7. [Testing Best Practices](#testing-best-practices)
8. [Test Coverage Requirements](#test-coverage-requirements)

## Testing Overview

### Testing Philosophy

The Anchor Management Tools follows a pragmatic approach to testing:

- **Production-First Testing**: Tests run against the production environment to ensure real-world compatibility
- **Critical Path Focus**: Prioritize testing of business-critical features and user journeys
- **Manual + Automated Balance**: Currently using Playwright for E2E tests, with plans for unit and integration tests
- **Continuous Improvement**: Gradually expanding test coverage based on incident reports and user feedback

### Testing Pyramid (Target State)

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

### Current Testing Stack

- **E2E Testing**: Playwright 1.53.1
- **Test Runner**: Playwright Test
- **Environment**: Production (https://management.orangejelly.co.uk)
- **Future Additions**: Vitest for unit/integration tests

## Test Structure and Organization

### Directory Structure

```
tests/
├── table-bookings.spec.ts        # Table booking UI tests
├── table-bookings-api.spec.ts    # Table booking API tests
├── table-bookings.config.ts      # Table booking test config
├── TABLE_BOOKINGS_TEST_README.md # Table booking test documentation
└── (future structure)
    ├── unit/                     # Unit tests
    ├── integration/              # Integration tests
    ├── e2e/                      # End-to-end tests
    ├── fixtures/                 # Test data and fixtures
    └── utils/                    # Test utilities
```

### Test Naming Conventions

- **Files**: Use descriptive names with `.spec.ts` suffix
- **Test Suites**: Use `describe()` blocks for logical grouping
- **Test Cases**: Start with "should" for clarity
- **Examples**:
  ```typescript
  describe('Table Booking System', () => {
    describe('Create Booking', () => {
      test('should create a regular table booking', async ({ page }) => {
        // Test implementation
      });
    });
  });
  ```

## Running Tests

### Prerequisites

```bash
# Install dependencies
npm install

# Set up environment variables
export TEST_EMAIL="your-test-email@example.com"
export TEST_PASSWORD="your-test-password"
export TEST_API_KEY="your-test-api-key"  # For API tests
export TEST_URL="https://management.orangejelly.co.uk"
```

### Test Commands

#### All Tests
```bash
# Run all tests
npm test

# Run tests in headed mode (see browser)
npm run test:headed

# Run tests in debug mode
npm run test:debug

# Show test report
npm run test:report
```

#### Table Booking Tests
```bash
# Run all table booking tests
npm run test:table-bookings

# Run in UI mode (interactive)
npm run test:table-bookings:ui

# Run only API tests
npm run test:table-bookings:api
```

#### Specific Test Suites
```bash
# Run employees tests
npm run test:employees
npm run test:employees:headed
npm run test:employees:ui

# Run comprehensive app test
npm run test:comprehensive
npm run test:comprehensive:headed

# Run smoke tests
npm run test:smoke
```

#### Running Specific Tests
```bash
# Run tests matching a pattern
npx playwright test -g "should create a regular table booking"

# Run a specific file
npx playwright test tests/table-bookings.spec.ts

# Run tests in a specific browser
npx playwright test --project=chromium
```

### Test Configuration

#### Main Configuration (`playwright.config.ts`)
```typescript
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : 3,
  use: {
    baseURL: 'https://management.orangejelly.co.uk',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
});
```

#### Custom Configurations
Some test suites use custom configurations:
- `tests/table-bookings.config.ts` - Table booking specific settings

## Writing New Tests

### Basic Test Structure

```typescript
import { test, expect } from '@playwright/test';

test.describe('Feature Name', () => {
  test.beforeEach(async ({ page }) => {
    // Login and setup
    await page.goto('/login');
    await page.fill('input[type="email"]', process.env.TEST_EMAIL);
    await page.fill('input[type="password"]', process.env.TEST_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL('/');
  });

  test('should perform specific action', async ({ page }) => {
    // Arrange
    await page.goto('/feature-page');
    
    // Act
    await page.click('button:has-text("Action")');
    await page.fill('input[name="field"]', 'value');
    
    // Assert
    await expect(page.locator('text=Success')).toBeVisible();
  });
});
```

### Common Patterns

#### Waiting for Elements
```typescript
// Wait for element to be visible
await page.waitForSelector('text=Loading', { state: 'hidden' });

// Wait for navigation
await page.waitForURL('/dashboard');

// Wait for network idle
await page.waitForLoadState('networkidle');
```

#### Form Interactions
```typescript
// Fill form fields
await page.fill('input[name="customerName"]', 'John Doe');
await page.selectOption('select[name="partySize"]', '4');
await page.click('input[type="checkbox"]');

// Submit form
await page.click('button[type="submit"]');
```

#### Assertions
```typescript
// Check visibility
await expect(page.locator('h1')).toBeVisible();

// Check text content
await expect(page.locator('.message')).toHaveText('Booking confirmed');

// Check URL
await expect(page).toHaveURL('/bookings/123');

// Check element count
await expect(page.locator('.booking-item')).toHaveCount(5);
```

### API Testing

```typescript
test('should check availability via API', async ({ request }) => {
  const response = await request.get('/api/table-bookings/availability', {
    params: {
      date: '2024-12-25',
      time: '19:00',
      party_size: '4'
    },
    headers: {
      'x-api-key': process.env.TEST_API_KEY
    }
  });

  expect(response.ok()).toBeTruthy();
  const data = await response.json();
  expect(data).toHaveProperty('available');
});
```

## Test Data and Fixtures

### Generating Test Data

```typescript
// Generate unique phone numbers
const TEST_PHONE = '07700900' + Math.floor(Math.random() * 1000).toString().padStart(3, '0');

// Generate unique emails
const TEST_EMAIL = `test-${Date.now()}@example.com`;

// Generate future dates
const tomorrow = new Date();
tomorrow.setDate(tomorrow.getDate() + 1);
const TEST_DATE = tomorrow.toISOString().split('T')[0];
```

### Test Data Best Practices

1. **Use Unique Data**: Generate random values to avoid conflicts
2. **Clean Up After Tests**: Delete test data when possible
3. **Avoid Production Data**: Never use real customer data
4. **Time-based Data**: Consider business hours and time zones

### Future: Test Factories

```typescript
// Example factory pattern (planned)
export function createTestCustomer(overrides = {}) {
  return {
    first_name: faker.person.firstName(),
    last_name: faker.person.lastName(),
    mobile_number: `+447${faker.string.numeric(9)}`,
    ...overrides,
  };
}
```

## CI/CD Test Integration

### GitHub Actions Configuration

```yaml
# .github/workflows/test.yml (future implementation)
name: Test Suite

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  e2e-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      
      - name: Install dependencies
        run: npm ci
      
      - name: Install Playwright
        run: npx playwright install --with-deps
      
      - name: Run E2E tests
        run: npm test
        env:
          TEST_EMAIL: ${{ secrets.TEST_EMAIL }}
          TEST_PASSWORD: ${{ secrets.TEST_PASSWORD }}
          TEST_API_KEY: ${{ secrets.TEST_API_KEY }}
```

### Test Reports in CI

- HTML reports generated in `test-results/`
- Screenshots and videos on failure
- Artifacts uploaded for debugging

## Testing Best Practices

### General Guidelines

1. **Test User Journeys, Not Implementation**
   - Focus on what users do, not how the code works
   - Test from the user's perspective

2. **Keep Tests Independent**
   - Each test should run in isolation
   - Don't depend on other tests' side effects

3. **Use Descriptive Names**
   ```typescript
   // Good
   test('should prevent booking when restaurant is at capacity', ...)
   
   // Bad
   test('test booking', ...)
   ```

4. **Handle Async Operations Properly**
   ```typescript
   // Wait for specific conditions
   await page.waitForSelector('.success-message');
   
   // Don't use arbitrary delays
   // await page.waitForTimeout(5000); // Avoid!
   ```

5. **Test Edge Cases**
   - Invalid inputs
   - Boundary conditions
   - Error scenarios

### Common Pitfalls to Avoid

1. **Hardcoded Wait Times**
   ```typescript
   // Bad
   await page.waitForTimeout(3000);
   
   // Good
   await page.waitForSelector('.loading', { state: 'hidden' });
   ```

2. **Brittle Selectors**
   ```typescript
   // Bad - relies on DOM structure
   await page.click('#root > div > div:nth-child(2) > button');
   
   // Good - uses semantic selectors
   await page.click('button:has-text("Submit")');
   ```

3. **Not Handling Test Data Cleanup**
   - Always consider what data your tests create
   - Implement cleanup where possible

4. **Testing During Downtime**
   - Some features have business hours
   - Consider time zones and operating hours

### Performance Considerations

1. **Parallel Execution**
   - Tests run in parallel by default
   - Use `test.describe.serial()` for dependent tests

2. **Resource Usage**
   - Limit workers to avoid overwhelming the system
   - Current config: 3 workers locally, 2 in CI

3. **Test Duration**
   - Keep individual tests under 30 seconds
   - Use appropriate timeouts

## Test Coverage Requirements

### Current Coverage

- **Table Bookings**: Comprehensive UI and API tests
- **Authentication**: Login flow testing
- **Critical Paths**: Basic coverage of key features

### Target Coverage

#### Phase 1: Critical Features (Current)
- [x] Authentication flows
- [x] Table booking creation
- [x] Basic CRUD operations
- [ ] SMS notification flows
- [ ] Payment processing

#### Phase 2: Extended Coverage (Planned)
- [ ] All user roles and permissions
- [ ] Error handling scenarios
- [ ] Data validation rules
- [ ] API rate limiting
- [ ] Security testing

#### Phase 3: Comprehensive Testing (Future)
- [ ] Unit tests for utilities
- [ ] Integration tests for services
- [ ] Performance testing
- [ ] Accessibility testing
- [ ] Cross-browser testing

### Coverage Metrics

**Target Metrics**:
- **Critical Paths**: 100% E2E coverage
- **API Endpoints**: 80% coverage
- **Business Logic**: 80% unit test coverage
- **Overall**: 70% code coverage

**Current Status**:
- Limited to E2E tests for table bookings
- Manual testing for other features
- Gradual expansion in progress

### Testing Checklist

#### Before Each Release
- [ ] All existing tests passing
- [ ] No console errors in test runs
- [ ] Test reports reviewed
- [ ] Manual testing of new features
- [ ] Regression testing of critical paths

#### Weekly
- [ ] Review test failures
- [ ] Update test data if needed
- [ ] Check for flaky tests
- [ ] Add tests for reported bugs

#### Monthly
- [ ] Expand test coverage
- [ ] Review and refactor tests
- [ ] Update test documentation
- [ ] Performance test review

## Future Enhancements

### Planned Improvements

1. **Unit Testing Framework**
   - Implement Vitest for unit tests
   - Test business logic and utilities
   - Achieve 80% coverage for critical code

2. **Integration Testing**
   - Test database operations
   - Test external service integrations
   - Mock external dependencies

3. **Performance Testing**
   - Load testing with k6
   - Response time benchmarks
   - Scalability testing

4. **Security Testing**
   - Input validation testing
   - Authentication/authorization tests
   - OWASP compliance checks

5. **Accessibility Testing**
   - WCAG compliance tests
   - Screen reader compatibility
   - Keyboard navigation tests

6. **Visual Regression Testing**
   - Screenshot comparison
   - UI consistency checks
   - Cross-browser rendering

### Testing Infrastructure

1. **Test Database**
   - Isolated test environment
   - Seed data management
   - Automatic cleanup

2. **CI/CD Pipeline**
   - Automated test runs
   - Parallel execution
   - Test result tracking

3. **Monitoring**
   - Test execution metrics
   - Flaky test detection
   - Coverage trends

## Resources

### Documentation
- [Playwright Documentation](https://playwright.dev)
- [Testing Best Practices](https://testingjavascript.com/)
- [Table Bookings Test README](../tests/TABLE_BOOKINGS_TEST_README.md)

### Tools
- **Playwright Test Runner**: Built-in test runner
- **Playwright UI Mode**: Interactive test debugging
- **Playwright Inspector**: Step-through debugging
- **VS Code Extension**: Playwright Test for VS Code

### Commands Reference
```bash
# Install Playwright
npx playwright install

# Update Playwright
npm update @playwright/test

# Generate tests
npx playwright codegen https://management.orangejelly.co.uk

# Open last HTML report
npx playwright show-report
```

## Getting Help

1. **Test Failures**
   - Check screenshots/videos in `test-results/`
   - Run in UI mode for debugging
   - Review test logs

2. **Writing Tests**
   - Follow existing patterns
   - Use Playwright codegen for selectors
   - Ask for code review

3. **Infrastructure Issues**
   - Check environment variables
   - Verify test user credentials
   - Review error messages

Remember: Quality tests lead to quality software. Take time to write clear, maintainable tests that provide confidence in the system's behavior.