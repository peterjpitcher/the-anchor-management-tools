# Playwright Interactive UI Debugging Guide

## Getting Started with UI Mode

### 1. Launch UI Mode
```bash
# Run all tests in UI mode
npx playwright test --ui

# Or run specific module tests
npx playwright test tests/customers.spec.ts --ui
npx playwright test tests/employees.spec.ts --ui
```

### 2. UI Mode Interface Overview
When UI mode opens, you'll see:
- **Left Panel**: Test file tree
- **Center Panel**: Test code and execution
- **Right Panel**: Browser preview
- **Bottom Panel**: Test output and logs

## Step-by-Step Debugging Process

### Step 1: Start with the Simplest Module
I recommend starting with **Customers** or **Employees** as they have fewer dependencies.

```bash
# Start with customers module
npx playwright test tests/customers.spec.ts --ui
```

### Step 2: Run One Test at a Time
1. In the left panel, expand `customers.spec.ts`
2. Click on a single test (e.g., "should create a new customer successfully")
3. Click the **green play button** to run just that test

### Step 3: Use Time Travel Debugging
1. After the test fails, you'll see a **timeline** at the bottom
2. Click on any step in the timeline to see:
   - What the page looked like at that moment
   - What action was being performed
   - The exact selector being used

### Step 4: Inspect Failed Steps
When you find the failed step (marked in red):
1. **Hover over the step** to see the error message
2. **Click on it** to see the page state
3. Look for:
   - Missing elements
   - Different button text
   - Unexpected page navigation
   - Form validation errors

### Step 5: Use the Pick Locator Tool
1. Click the **"Pick locator"** button (crosshair icon)
2. Hover over elements in the browser preview
3. Click on the element you want to target
4. Copy the suggested selector
5. Note this selector for fixing the test

### Step 6: Check for Common Issues

#### A. Wrong Selectors
If test expects: `button:has-text("Create Customer")`
But you see: `button:has-text("Save Customer")`
→ Update the test with the correct text

#### B. Missing Elements
If test expects: `input[name="email"]`
But element doesn't exist
→ Remove this from the test or find the correct field

#### C. Different Navigation
If test expects: URL `/customers/new`
But actual URL is: `/customers/create`
→ Update the URL expectation

#### D. Timing Issues
If elements appear after a delay:
→ Add wait statements before the action

### Step 7: Live Edit and Retry
1. In UI mode, you can:
   - **Pause at breakpoints** by clicking line numbers
   - **Step through** actions one by one
   - **Re-run** the test immediately after making changes

## Practical Workflow

### For Each Failed Test:

1. **Run the test in UI mode**
   ```bash
   npx playwright test tests/customers.spec.ts -g "should create a new customer" --ui
   ```

2. **Identify the failure point**
   - Watch the test execution
   - Note where it fails
   - Use time travel to go back

3. **Inspect the actual page**
   - What's actually on the page?
   - What selectors would work?
   - Is the flow different?

4. **Make notes of needed changes**
   ```
   Test: "should create a new customer"
   Line 38: Change "Create Customer" to "Save Customer"
   Line 42: Remove email field (doesn't exist)
   Line 45: Add wait after form submission
   ```

5. **Fix and re-run**
   - Edit the test file
   - Save changes
   - Click play button again in UI mode

## Quick Fix Patterns

### Pattern 1: Button Text Changes
```javascript
// Before
await page.click('button:has-text("Create Customer")');

// After - check what text is actually shown
await page.click('button:has-text("Save Customer")');
```

### Pattern 2: Form Submission Waits
```javascript
// After clicking submit, wait for navigation
await page.click('button[type="submit"]');
await page.waitForURL('**/customers/**');
// Or wait for success message
await page.waitForSelector('text=/success|saved/i');
```

### Pattern 3: Dynamic Content
```javascript
// Wait for content to load
await page.waitForSelector('.customer-list', { state: 'visible' });
// Then interact with it
await page.click('.customer-list >> text="John Doe"');
```

### Pattern 4: Optional Fields
```javascript
// Check if field exists before filling
const emailField = page.locator('input[name="email"]');
if (await emailField.count() > 0) {
  await emailField.fill('test@example.com');
}
```

## Module-Specific Tips

### Customers Module
- Form doesn't use modals (remove modal expectations)
- No email field (remove email-related tests)
- Check for proper success messages after save

### Employees Module
- Use `email_address` not `email`
- Use `phone_number` not `phone`
- `job_title` is required
- Submit button says "Save Employee"

### Events Module
- All form fields use ID selectors (`#name`, `#date`, etc.)
- Watch for validation on dates (must be future)
- Category selection may auto-fill fields

### Messages Module
- Messages link to `/customers/{id}` not `/messages/{id}`
- Reply functionality is in customer detail page
- Look for Messages tab in customer view

### Private Bookings Module
- "New Booking" is a link, not a button
- Only 3 required fields: customer name, date, time
- Check for pricing calculation delays

## Debugging Checklist

- [ ] Is the element visible on the page?
- [ ] Does the selector match exactly?
- [ ] Is the page fully loaded before interaction?
- [ ] Are there any error messages shown?
- [ ] Is the user logged in with correct permissions?
- [ ] Does the URL match expectations?
- [ ] Are success/error toasts appearing?
- [ ] Is the form being submitted successfully?

## Common Commands in UI Mode

- **Run test**: Click play button
- **Debug test**: Click debug button (bug icon)
- **Pick locator**: Click crosshair icon
- **Clear results**: Click trash icon
- **Toggle browser**: Show/hide browser preview
- **Step through**: Use forward/back buttons in timeline

## When to Give Up and Rewrite

If a test has more than 50% of its steps failing, consider:
1. Recording a new test with codegen:
   ```bash
   npx playwright codegen localhost:3000
   ```
2. Perform the actions manually
3. Copy the generated code
4. Add assertions for success

## Save Your Progress

After fixing each test:
1. Copy your working test code
2. Run it once more to confirm
3. Move to the next test
4. Commit working tests frequently

---

Remember: The goal is to understand what the application actually does, not force it to match outdated test expectations. Be prepared to remove tests for features that no longer exist.