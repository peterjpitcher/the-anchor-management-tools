import { test, expect } from '@playwright/test';
import { TEST_USERS, TEST_DATA } from '../test-config';

// Use superadmin for all tests
const TEST_CREDENTIALS = TEST_USERS.superAdmin;

test.describe('Employee Edit Page', () => {
  let testEmployeeId: string | null = null;
  
  test.beforeAll(async ({ browser }) => {
    // Create a test employee to edit
    const page = await browser.newPage();
    
    // Login
    await page.goto('/');
    await page.fill('input[type="email"]', TEST_CREDENTIALS.email);
    await page.fill('input[type="password"]', TEST_CREDENTIALS.password);
    await page.click('button[type="submit"]:has-text("Sign in")');
    await page.waitForURL('**/dashboard');
    
    // Create employee
    await page.goto('/employees/new');
    const timestamp = Date.now();
    await page.fill('input[name="first_name"]', `${TEST_DATA.prefix} Edit`);
    await page.fill('input[name="last_name"]', `Test ${timestamp}`);
    await page.fill('input[name="email"]', `playwright.edit.${timestamp}@example.com`);
    await page.fill('input[name="job_title"]', 'Original Position');
    await page.fill('input[name="employment_start_date"]', new Date().toISOString().split('T')[0]);
    await page.selectOption('select[name="status"]', 'Active');
    
    await page.click('button:has-text("Add Employee")');
    await page.waitForURL(/\/employees\/([a-f0-9-]+)/, { timeout: 30000 });
    
    // Extract employee ID
    const url = page.url();
    const match = url.match(/\/employees\/([a-f0-9-]+)$/);
    if (match) {
      testEmployeeId = match[1];
      console.log(`Created test employee for editing with ID: ${testEmployeeId}`);
    }
    
    await page.close();
  });
  
  test.beforeEach(async ({ page }) => {
    // Login before each test
    await page.goto('/');
    await page.fill('input[type="email"]', TEST_CREDENTIALS.email);
    await page.fill('input[type="password"]', TEST_CREDENTIALS.password);
    await page.click('button[type="submit"]:has-text("Sign in")');
    await page.waitForURL('**/dashboard');
    
    // Navigate to employee edit page
    if (testEmployeeId) {
      await page.goto(`/employees/${testEmployeeId}/edit`);
      await page.waitForLoadState('networkidle');
    }
  });

  test('should display edit form with existing data', async ({ page }) => {
    if (!testEmployeeId) {
      test.skip();
      return;
    }
    
    // Check page title
    await expect(page.locator('h1')).toContainText('Edit Employee');
    
    // Check that form is pre-filled with existing data
    const firstNameInput = page.locator('input[name="first_name"]');
    const lastNameInput = page.locator('input[name="last_name"]');
    const jobTitleInput = page.locator('input[name="job_title"]');
    
    await expect(firstNameInput).toHaveValue(/Edit/);
    await expect(lastNameInput).toHaveValue(/Test/);
    await expect(jobTitleInput).toHaveValue('Original Position');
    
    // Check for tabs
    await expect(page.locator('button[role="tab"]:has-text("Personal Details")')).toBeVisible();
    await expect(page.locator('button[role="tab"]:has-text("Financial Details")')).toBeVisible();
    await expect(page.locator('button[role="tab"]:has-text("Health Records")')).toBeVisible();
    
    // Take screenshot
    await page.screenshot({ path: 'tests/screenshots/employee-edit-form.png' });
  });

  test('should update employee personal details', async ({ page }) => {
    if (!testEmployeeId) {
      test.skip();
      return;
    }
    
    // Update job title and phone number
    await page.fill('input[name="job_title"]', 'Updated Position');
    await page.fill('input[name="phone_number"]', '07700900999');
    
    // Add address if not already present
    await page.fill('textarea[name="address"]', '456 Updated Street\nNew City\nNC1 2UP');
    
    // Save changes
    await page.click('button:has-text("Save Changes")');
    
    // Should show success message or redirect
    const successMessage = page.locator('text=Employee updated successfully, Changes saved').first();
    await expect(successMessage).toBeVisible({ timeout: 10000 });
    
    // Verify changes were saved by checking the values remain
    await page.waitForTimeout(1000);
    await expect(page.locator('input[name="job_title"]')).toHaveValue('Updated Position');
  });

  test('should update financial details via tab', async ({ page }) => {
    if (!testEmployeeId) {
      test.skip();
      return;
    }
    
    // Switch to Financial Details tab
    await page.click('button[role="tab"]:has-text("Financial Details")');
    await page.waitForTimeout(500);
    
    // Fill in financial details
    await page.fill('input[name="ni_number"]', 'CD456789E');
    await page.fill('input[name="bank_account_number"]', '87654321');
    await page.fill('input[name="bank_sort_code"]', '65-43-21');
    await page.fill('input[name="bank_name"]', 'Updated Bank');
    await page.fill('input[name="payee_name"]', `${TEST_DATA.prefix} Payee`);
    
    // Save
    await page.click('button:has-text("Save Financial Details")');
    
    // Check for success
    await expect(page.locator('text=Financial details saved, Financial details updated').first()).toBeVisible({ timeout: 10000 });
  });

  test('should update health records via tab', async ({ page }) => {
    if (!testEmployeeId) {
      test.skip();
      return;
    }
    
    // Switch to Health Records tab
    await page.click('button[role="tab"]:has-text("Health Records")');
    await page.waitForTimeout(500);
    
    // Update health information
    await page.fill('input[name="doctor_name"]', 'Dr. Updated');
    await page.fill('textarea[name="doctor_address"]', '789 Health Ave\nMedical District');
    await page.fill('textarea[name="allergies"]', 'Updated allergies list');
    await page.fill('textarea[name="illness_history"]', 'Updated medical history');
    
    // Toggle some checkboxes
    await page.check('input[name="has_epilepsy"]');
    await page.check('input[name="disabled_reg"]');
    
    // Save
    await page.click('button:has-text("Save Health Records")');
    
    // Check for success
    await expect(page.locator('text=Health records saved, Health records updated').first()).toBeVisible({ timeout: 10000 });
  });

  test('should handle changing employee status', async ({ page }) => {
    if (!testEmployeeId) {
      test.skip();
      return;
    }
    
    // Go back to Personal Details tab if needed
    const personalTab = page.locator('button[role="tab"]:has-text("Personal Details")');
    if (await personalTab.isVisible()) {
      await personalTab.click();
      await page.waitForTimeout(500);
    }
    
    // Change status to Former
    await page.selectOption('select[name="status"]', 'Former');
    
    // Employment end date field should become visible/required
    const endDateField = page.locator('input[name="employment_end_date"]');
    await expect(endDateField).toBeVisible();
    
    // Set end date
    const today = new Date().toISOString().split('T')[0];
    await endDateField.fill(today);
    
    // Save
    await page.click('button:has-text("Save Changes")');
    
    // Check for success
    await expect(page.locator('text=Employee updated successfully, Changes saved').first()).toBeVisible({ timeout: 10000 });
  });

  test('should handle cancel action', async ({ page }) => {
    if (!testEmployeeId) {
      test.skip();
      return;
    }
    
    // Make some changes
    await page.fill('input[name="job_title"]', 'Cancelled Changes');
    
    // Click cancel
    await page.click('a:has-text("Cancel")');
    
    // Should navigate back to employee details
    await page.waitForURL(`**/employees/${testEmployeeId}`);
    
    // Verify we're on details page
    await expect(page.locator('text=Details')).toBeVisible();
    await expect(page.locator('text=Emergency Contacts')).toBeVisible();
  });

  test('should validate required fields remain required', async ({ page }) => {
    if (!testEmployeeId) {
      test.skip();
      return;
    }
    
    // Clear a required field
    await page.fill('input[name="first_name"]', '');
    
    // Try to save
    await page.click('button:has-text("Save Changes")');
    
    // Should not save due to validation
    const firstNameInput = page.locator('input[name="first_name"]');
    const isInvalid = await firstNameInput.evaluate((el: HTMLInputElement) => !el.validity.valid);
    expect(isInvalid).toBeTruthy();
    
    // Should still be on edit page
    await expect(page).toHaveURL(/\/employees\/.*\/edit/);
  });
});