# Playwright E2E Tests

This directory contains end-to-end tests for the Anchor Management Tools application using Playwright.

## Setup

1. **Install dependencies** (already done):
   ```bash
   npm install --save-dev @playwright/test playwright
   npx playwright install
   ```

2. **Configure test credentials**:
   
   Edit `tests/test-config.ts` and replace the TODO placeholders with real test user credentials:
   
   ```typescript
   export const TEST_USERS = {
     superAdmin: {
       email: 'your-real-super-admin@example.com', // <-- Replace this
       password: 'your-real-password', // <-- Replace this
       role: 'super_admin'
     },
     // ... also update manager and staff credentials
   };
   ```

## Running Tests

### Run all tests:
```bash
npx playwright test
```

### Run specific test file:
```bash
npx playwright test tests/auth/login.spec.ts
```

### Run in headed mode (see browser):
```bash
npx playwright test --headed
```

### Run only in Chrome:
```bash
npx playwright test --project=chromium
```

### Debug mode:
```bash
npx playwright test --debug
```

### View test report:
```bash
npx playwright show-report
```

## Test Structure

```
tests/
├── auth/
│   └── login.spec.ts        # Login/logout tests
├── test-config.ts           # Test credentials and data
├── screenshots/             # Screenshots from test runs
└── README.md               # This file
```

## Important Notes

1. **These tests run against PRODUCTION** (https://management.orangejelly.co.uk)
2. All test data is prefixed with `[PLAYWRIGHT_TEST]` for easy identification
3. Tests should clean up after themselves
4. Use fake UK phone numbers (07700900xxx range) for SMS tests
5. Be careful not to modify real customer/employee data

## Writing New Tests

1. Always use the `TEST_DATA.prefix` for test data:
   ```typescript
   const testEvent = {
     title: `${TEST_DATA.prefix} My Test Event ${Date.now()}`
   };
   ```

2. Clean up after tests:
   ```typescript
   test.afterEach(async () => {
     // Delete any test data created
   });
   ```

3. Use page objects for reusable selectors
4. Take screenshots on failures for debugging

## Troubleshooting

- **Login fails**: Check test credentials in `test-config.ts`
- **Timeouts**: Production might be slow, increase timeouts in `playwright.config.ts`
- **Flaky tests**: Add appropriate waits for elements/navigation

## Next Steps

After basic login test passes, we'll add:
- [ ] Event creation/management tests
- [ ] Customer management tests
- [ ] Employee management tests
- [ ] Private booking tests
- [ ] SMS messaging tests
- [ ] Permission-based tests for different roles
- [ ] Form validation tests
- [ ] Error handling tests