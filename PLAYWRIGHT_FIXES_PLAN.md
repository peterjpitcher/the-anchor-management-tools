# Playwright Test Fixes Implementation Plan

## 📋 Overview

Based on the discovery analysis, here's a comprehensive plan to fix all failing Playwright tests by aligning them with the actual application implementation.

---

## 🔧 Module-by-Module Fixes

### 1. Events Module

#### Form Field Selector Updates
**File**: `tests/events.spec.ts`

**Current (Wrong)**:
```javascript
await page.fill('input[name="name"]', eventName);
await page.fill('input[name="date"]', '2025-12-31');
await page.fill('input[name="time"]', '20:00');
await page.fill('input[name="capacity"]', '100');
```

**Fixed**:
```javascript
await page.fill('#name', eventName);
await page.fill('#date', '2025-12-31');
await page.fill('#time', '20:00');
await page.fill('#capacity', '100');
```

**Additional Fields Available**:
- `#category` - Category dropdown
- `#end_time` - End time
- `#description` - Description
- `#price` - Price field

---

### 2. Customers Module

#### Key Changes:
1. **No Modal** - Form replaces entire page
2. **No Email Field** - Customer model only has first_name, last_name, mobile_number

**File**: `tests/customers.spec.ts`

**Current (Wrong)**:
```javascript
// Expecting modal
await expect(page.locator('.fixed.inset-0, [role="dialog"]')).toBeVisible();
// Wrong field names
await page.fill('input[name="email"]', email);
```

**Fixed**:
```javascript
// Click Add Customer - navigates to form page
await page.getByRole('button', { name: 'Add Customer' }).click();

// Fill form with correct selectors
await page.fill('#first_name', 'John');
await page.fill('#last_name', 'Doe');
await page.fill('#mobile_number', '07700900000');
// Remove email field - doesn't exist

// Submit
await page.getByRole('button', { name: 'Create Customer' }).click();
```

---

### 3. Employees Module  

#### Major Issues:
1. Wrong field names (email vs email_address, phone vs phone_number)
2. No role field - uses status field instead
3. Navigation is to `/employees/new` route

**File**: `tests/employees.spec.ts`

**Current (Wrong)**:
```javascript
await page.fill('input[name="email"]', email);
await page.fill('input[name="phone"]', phone);
await roleSelect.selectOption({ value: 'staff' });
```

**Fixed**:
```javascript
// Navigate to new employee form
await page.goto('/employees/new');

// Use correct field names
await page.fill('input[name="first_name"]', 'John');
await page.fill('input[name="last_name"]', 'Doe');
await page.fill('input[name="email_address"]', 'john@example.com');
await page.fill('input[name="job_title"]', 'Developer');
await page.fill('input[name="employment_start_date"]', '2024-01-01');
await page.fill('input[name="phone_number"]', '07700900000');
await page.selectOption('select[name="status"]', 'Active');

// Submit with correct button text
await page.click('button:has-text("Save Employee")');
```

---

### 4. Private Bookings Module

#### Key Issues:
1. "New Booking" is a Link, not a button
2. Different field IDs than expected
3. Only 3 required fields

**File**: `tests/private-bookings.spec.ts`

**Current (Wrong)**:
```javascript
await page.click('button:has-text("New Booking")');
await page.fill('input[name="customer_id"]', customerId);
```

**Fixed**:
```javascript
// Click link (not button)
await page.click('a:has-text("New Booking")');
await page.waitForURL('/private-bookings/new');

// Fill with correct field IDs
await page.fill('#customer_first_name', 'John');
await page.fill('#customer_last_name', 'Doe');
await page.fill('#event_date', '2025-12-31');
await page.fill('#start_time', '18:00'); // Has default but can override
await page.fill('#guest_count', '50');

// Submit
await page.click('button:has-text("Create Booking")');
```

---

### 5. Messages Module

#### Major Architectural Difference:
- Messages are integrated into Customer detail pages
- No standalone message threads at `/messages/{id}`
- Conversations link to `/customers/{id}`

**File**: `tests/messages.spec.ts`

**Current (Wrong)**:
```javascript
// Expecting standalone message pages
await expect(page).toHaveURL(/\/messages\/[a-f0-9-]+/);
// Looking for wrong elements
const conversation = page.locator('[role="listitem"] a');
```

**Fixed**:
```javascript
// Conversations use div structure, not semantic lists
const conversation = page.locator('.divide-y > a').first();
await conversation.click();

// Should navigate to customer page, not message page
await expect(page).toHaveURL(/\/customers\/[a-f0-9-]+/);

// Messages are in customer detail page
// Look for message-related content there
```

---

### 6. Settings Module

#### Various Sub-modules Need Path Updates:
- Some settings pages may have different routes
- Need to verify actual navigation paths

**Common Pattern**:
```javascript
// Instead of expecting immediate page content
// Add explicit waits after navigation
await page.goto('/settings/sms');
await page.waitForLoadState('networkidle');
```

---

## 🎯 Global Test Improvements

### 1. Increase Timeouts
```javascript
// In critical sections, use longer timeouts
await page.fill('#field', 'value', { timeout: 30000 });
```

### 2. Better Wait Strategies
```javascript
// After navigation
await page.waitForLoadState('networkidle');

// Before form interaction
await page.waitForSelector('form', { state: 'visible' });
```

### 3. Flexible Selectors
```javascript
// Use multiple selector options
const button = page.locator('button:has-text("Save"), button:has-text("Submit")').first();
```

### 4. Remove Non-Existent Features
- Remove email field tests for Customers
- Remove role selection for Employees
- Remove message thread navigation tests
- Remove search/filter tests that don't exist

---

## 📝 Implementation Steps

1. **Update Events Tests** - Fix form field selectors (use IDs)
2. **Fix Customer Tests** - Remove modal expectations and email field
3. **Correct Employee Tests** - Use proper field names and remove role
4. **Adjust Private Bookings** - Use link navigation and correct fields
5. **Refactor Messages Tests** - Align with customer-integrated design
6. **Review Settings Tests** - Verify actual routes and increase timeouts

---

## ✅ Validation

After implementing fixes:
1. Run smoke tests first: `npx playwright test tests/smoke-test.spec.ts`
2. Run module by module: `./tests/run-all-tests.sh events`
3. Use UI mode for debugging: `npx playwright test --ui`
4. Check that form submissions actually work

---

## 🚀 Next Actions

1. Create updated test files with these fixes
2. Run tests incrementally to verify each fix
3. Update test documentation with correct patterns
4. Consider adding `data-testid` attributes for stability

---

*This plan addresses all discovered issues and aligns tests with actual implementation*