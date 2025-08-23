# Table Bookings Test Suite

This comprehensive test suite covers all aspects of the table booking system, including UI functionality, API endpoints, and integration tests.

## Test Coverage

### UI Tests (`table-bookings.spec.ts`)
- Dashboard functionality
- Create bookings (regular and Sunday lunch)
- Edit bookings
- Cancel bookings
- Table configuration management
- SMS template management
- Reports and analytics
- Search functionality

### API Tests (`table-bookings-api.spec.ts`)
- Availability endpoint
- Create booking endpoint
- Search bookings endpoint
- Rate limiting
- Error handling
- Webhook security

## Running Tests

### Prerequisites
```bash
# Install dependencies
npm install

# Set up environment variables
export TEST_EMAIL="your-test-email@example.com"
export TEST_PASSWORD="your-test-password"
export TEST_API_KEY="your-test-api-key"
export TEST_URL="https://management.orangejelly.co.uk"
```

### Run All Table Booking Tests
```bash
npm run test:table-bookings
```

### Run Tests in UI Mode (Interactive)
```bash
npm run test:table-bookings:ui
```

### Run Only API Tests
```bash
npm run test:table-bookings:api
```

### Run Specific Test
```bash
npx playwright test tests/table-bookings.spec.ts -g "should create a regular table booking"
```

## Test Data

The tests use randomly generated data to avoid conflicts:
- Phone numbers: `07700900XXX` where XXX is random
- Email addresses: `test-{timestamp}@example.com`
- Customer names: "Test Customer" or "API Test"

## Important Notes

1. **Rate Limiting**: API tests include rate limiting checks. Some tests intentionally trigger rate limits.

2. **Cleanup**: Tests create real bookings in the system. Consider implementing cleanup routines for test data.

3. **Timing**: Some tests depend on business hours and availability. They may fail outside of normal operating hours.

4. **API Keys**: For API tests, you need a valid API key with appropriate permissions.

## Test Reports

After running tests, reports are generated in:
- HTML Report: `test-results/table-bookings-report/index.html`
- JSON Results: `test-results/table-bookings-results.json`
- Screenshots/Videos: `test-results/table-bookings/` (on failure)

View the HTML report:
```bash
npx playwright show-report test-results/table-bookings-report
```

## Debugging Failed Tests

1. Run with UI mode to see the browser:
```bash
npm run test:table-bookings:ui
```

2. Run a specific test with debugging:
```bash
npx playwright test tests/table-bookings.spec.ts -g "test name" --debug
```

3. Check screenshots and videos in `test-results/table-bookings/`

## Writing New Tests

When adding new tests:

1. Use unique test data (phone numbers, emails)
2. Clean up created resources when possible
3. Use appropriate waits for async operations
4. Add descriptive test names
5. Group related tests in describe blocks

Example:
```typescript
test.describe('New Feature', () => {
  test('should do something specific', async ({ page }) => {
    // Arrange
    await page.goto('/table-bookings/new-feature');
    
    // Act
    await page.click('button:has-text("Action")');
    
    // Assert
    await expect(page.locator('text=Success')).toBeVisible();
  });
});
```

## CI/CD Integration

The tests are configured to run in CI environments:
- Retries: 2 attempts on failure
- Workers: Limited to 1 in CI
- Timeout: 60 seconds per test

## Common Issues

1. **Authentication Failures**: Ensure TEST_EMAIL and TEST_PASSWORD are correct
2. **API Key Invalid**: Check TEST_API_KEY has proper permissions
3. **Rate Limiting**: Wait between test runs or adjust rate limits
4. **Time-based Failures**: Some tests may fail late at night when kitchen is closed