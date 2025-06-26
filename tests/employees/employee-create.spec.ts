import { test, expect } from '@playwright/test';
import { TEST_USERS, TEST_DATA, generateTestData } from '../test-config';

// Use superadmin for all tests
const TEST_CREDENTIALS = TEST_USERS.superAdmin;

test.describe('Employee Create Page', () => {
  test.beforeEach(async ({ page }) => {
    // Login before each test
    await page.goto('/');
    await page.fill('input[type="email"]', TEST_CREDENTIALS.email);
    await page.fill('input[type="password"]', TEST_CREDENTIALS.password);
    await page.click('button[type="submit"]:has-text("Sign in")');
    await page.waitForURL('**/dashboard');
    
    // Navigate to new employee page
    await page.goto('/employees/new');
    await page.waitForLoadState('networkidle');
  });

  test('should display create employee form', async ({ page }) => {
    // Check page title
    await expect(page.locator('h3')).toContainText('Add New Employee');
    
    // Check for required fields
    await expect(page.locator('label:has-text("First Name")')).toBeVisible();
    await expect(page.locator('label:has-text("Last Name")')).toBeVisible();
    await expect(page.locator('label:has-text("Email Address")')).toBeVisible();
    await expect(page.locator('label:has-text("Job Title")')).toBeVisible();
    await expect(page.locator('label:has-text("Employment Start Date")')).toBeVisible();
    await expect(page.locator('label:has-text("Status")')).toBeVisible();
    
    // Check for optional fields
    await expect(page.locator('label:has-text("Date of Birth")')).toBeVisible();
    await expect(page.locator('label:has-text("Address")')).toBeVisible();
    await expect(page.locator('label:has-text("Phone Number")')).toBeVisible();
    
    // Check for buttons
    await expect(page.locator('a:has-text("Cancel")')).toBeVisible();
    await expect(page.locator('button:has-text("Save Employee")')).toBeVisible();
    
    // Take screenshot
    await page.screenshot({ path: 'tests/screenshots/employee-create-form.png' });
  });

  test('should validate required fields', async ({ page }) => {
    // Try to submit empty form
    await page.click('button:has-text("Save Employee")');
    
    // Check for validation messages or that we're still on the same page
    await expect(page).toHaveURL(/\/employees\/new/);
    
    // HTML5 validation should prevent submission
    const firstNameInput = page.locator('input[name="first_name"]');
    const isInvalid = await firstNameInput.evaluate((el: HTMLInputElement) => !el.validity.valid);
    expect(isInvalid).toBeTruthy();
  });

  test('should create a new employee successfully', async ({ page }) => {
    const timestamp = Date.now();
    const testEmployee = {
      firstName: `${TEST_DATA.prefix} Test`,
      lastName: `Employee ${timestamp}`,
      email: `playwright.emp.${timestamp}@example.com`,
      jobTitle: 'Test Position',
      phone: '07700900123'
    };
    
    // Fill in required fields
    await page.fill('input[name="first_name"]', testEmployee.firstName);
    await page.fill('input[name="last_name"]', testEmployee.lastName);
    await page.fill('input[name="email"]', testEmployee.email);
    await page.fill('input[name="job_title"]', testEmployee.jobTitle);
    
    // Set employment start date to today
    const today = new Date().toISOString().split('T')[0];
    await page.fill('input[name="employment_start_date"]', today);
    
    // Status should default to Active, but let's make sure
    const statusSelect = page.locator('select[name="status"]');
    await statusSelect.selectOption('Active');
    
    // Fill optional phone number
    await page.fill('input[name="phone_number"]', testEmployee.phone);
    
    // Take screenshot before submitting
    await page.screenshot({ path: 'tests/screenshots/employee-create-filled.png' });
    
    // Submit form
    await page.click('button:has-text("Save Employee")');
    
    // Should redirect to employee list or detail page
    await page.waitForURL(/\/employees(?:\/[a-f0-9-]+)?/, { timeout: 30000 });
    
    // Check for success message or that the employee appears
    const successMessage = page.locator('text=Employee added successfully, Employee created successfully, successfully added').first();
    const employeeName = page.locator(`text=${testEmployee.firstName} ${testEmployee.lastName}`).first();
    
    // Either we see a success message or the employee name
    const hasSuccess = await successMessage.isVisible({ timeout: 5000 }).catch(() => false);
    const hasEmployee = await employeeName.isVisible({ timeout: 5000 }).catch(() => false);
    
    expect(hasSuccess || hasEmployee).toBeTruthy();
    
    // Store employee ID for cleanup if we're on detail page
    const url = page.url();
    const match = url.match(/\/employees\/([a-f0-9-]+)$/);
    if (match) {
      console.log(`Created test employee with ID: ${match[1]}`);
    }
  });

  test('should handle cancel button', async ({ page }) => {
    // Fill some data
    await page.fill('input[name="first_name"]', 'Test');
    await page.fill('input[name="last_name"]', 'Cancel');
    
    // Click cancel
    await page.click('a:has-text("Cancel")');
    
    // Should navigate back to employee list
    await page.waitForURL('**/employees');
    
    // Verify we're on the list page
    await expect(page.locator('h1')).toContainText('Employees');
  });

  test('should validate email format', async ({ page }) => {
    // Fill in fields with invalid email
    await page.fill('input[name="first_name"]', 'Test');
    await page.fill('input[name="last_name"]', 'Employee');
    await page.fill('input[name="email"]', 'invalid-email');
    await page.fill('input[name="job_title"]', 'Test');
    
    const today = new Date().toISOString().split('T')[0];
    await page.fill('input[name="employment_start_date"]', today);
    
    // Try to submit
    await page.click('button:has-text("Save Employee")');
    
    // Should not navigate away due to validation
    await expect(page).toHaveURL(/\/employees\/new/);
    
    // Check email field validity
    const emailInput = page.locator('input[name="email"]');
    const isInvalid = await emailInput.evaluate((el: HTMLInputElement) => !el.validity.valid);
    expect(isInvalid).toBeTruthy();
  });

  test('should allow setting employment end date for former employees', async ({ page }) => {
    const timestamp = Date.now();
    
    // Fill in required fields
    await page.fill('input[name="first_name"]', `${TEST_DATA.prefix} Former`);
    await page.fill('input[name="last_name"]', `Employee ${timestamp}`);
    await page.fill('input[name="email"]', `playwright.former.${timestamp}@example.com`);
    await page.fill('input[name="job_title"]', 'Former Position');
    
    // Set dates
    const lastMonth = new Date();
    lastMonth.setMonth(lastMonth.getMonth() - 1);
    const startDate = lastMonth.toISOString().split('T')[0];
    const endDate = new Date().toISOString().split('T')[0];
    
    await page.fill('input[name="employment_start_date"]', startDate);
    
    // Set status to Former
    await page.selectOption('select[name="status"]', 'Former');
    
    // Employment end date field should be visible/enabled
    const endDateField = page.locator('input[name="employment_end_date"]');
    await expect(endDateField).toBeVisible();
    await endDateField.fill(endDate);
    
    // Submit
    await page.click('button:has-text("Save Employee")');
    
    // Should successfully create
    await page.waitForURL(/\/employees(?:\/[a-f0-9-]+)?/, { timeout: 30000 });
  });
});