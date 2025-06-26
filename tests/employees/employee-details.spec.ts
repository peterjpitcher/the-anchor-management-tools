import { test, expect } from '@playwright/test';
import { TEST_USERS, TEST_DATA } from '../test-config';

// Use superadmin for all tests
const TEST_CREDENTIALS = TEST_USERS.superAdmin;

test.describe('Employee Details Page', () => {
  let testEmployeeId: string | null = null;
  
  test.beforeAll(async ({ browser }) => {
    // Create a test employee to work with
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
    await page.fill('input[name="first_name"]', `${TEST_DATA.prefix} Detail`);
    await page.fill('input[name="last_name"]', `Test ${timestamp}`);
    await page.fill('input[name="email"]', `playwright.detail.${timestamp}@example.com`);
    await page.fill('input[name="job_title"]', 'Test Position');
    await page.fill('input[name="employment_start_date"]', new Date().toISOString().split('T')[0]);
    await page.selectOption('select[name="status"]', 'Active');
    await page.fill('input[name="phone_number"]', '07700900789');
    await page.fill('textarea[name="address"]', '123 Test Street\nTest City\nTS1 1ST');
    
    await page.click('button:has-text("Add Employee")');
    await page.waitForURL(/\/employees\/([a-f0-9-]+)/, { timeout: 30000 });
    
    // Extract employee ID from URL
    const url = page.url();
    const match = url.match(/\/employees\/([a-f0-9-]+)$/);
    if (match) {
      testEmployeeId = match[1];
      console.log(`Created test employee with ID: ${testEmployeeId}`);
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
    
    // Navigate to employee details page
    if (testEmployeeId) {
      await page.goto(`/employees/${testEmployeeId}`);
      await page.waitForLoadState('networkidle');
    }
  });

  test('should display employee details with all tabs', async ({ page }) => {
    if (!testEmployeeId) {
      test.skip();
      return;
    }
    
    // Check that we're on the details page
    await expect(page.locator('h1')).toContainText('Detail Test');
    
    // Check for all tabs
    await expect(page.locator('button[role="tab"]:has-text("Details")')).toBeVisible();
    await expect(page.locator('button[role="tab"]:has-text("Emergency Contacts")')).toBeVisible();
    await expect(page.locator('button[role="tab"]:has-text("Financial Details")')).toBeVisible();
    await expect(page.locator('button[role="tab"]:has-text("Health Records")')).toBeVisible();
    await expect(page.locator('button[role="tab"]:has-text("Version History")')).toBeVisible();
    
    // Check for action buttons
    await expect(page.locator('a:has-text("Edit Employee")')).toBeVisible();
    
    // Take screenshot
    await page.screenshot({ path: 'tests/screenshots/employee-details-page.png' });
  });

  test('should display employee information in Details tab', async ({ page }) => {
    if (!testEmployeeId) {
      test.skip();
      return;
    }
    
    // Details tab should be active by default
    const detailsPanel = page.locator('[role="tabpanel"]').first();
    
    // Check for employee information sections
    await expect(detailsPanel.locator('text=Personal Information')).toBeVisible();
    await expect(detailsPanel.locator('text=Contact Information')).toBeVisible();
    await expect(detailsPanel.locator('text=Employment Information')).toBeVisible();
    
    // Check that data is displayed
    await expect(detailsPanel.locator('text=Detail Test')).toBeVisible(); // Name
    await expect(detailsPanel.locator('text=Test Position')).toBeVisible(); // Job title
    await expect(detailsPanel.locator('text=Active')).toBeVisible(); // Status
    await expect(detailsPanel.locator('text=07700900789')).toBeVisible(); // Phone
  });

  test('should switch to Emergency Contacts tab', async ({ page }) => {
    if (!testEmployeeId) {
      test.skip();
      return;
    }
    
    // Click Emergency Contacts tab
    await page.click('button[role="tab"]:has-text("Emergency Contacts")');
    await page.waitForTimeout(500);
    
    // Check for emergency contacts content
    const panel = page.locator('[role="tabpanel"]').first();
    await expect(panel.locator('text=Add Emergency Contact')).toBeVisible();
    
    // Should show empty state or list
    const hasEmptyState = await panel.locator('text=No emergency contacts').isVisible().catch(() => false);
    const hasContactList = await panel.locator('text=Relationship').isVisible().catch(() => false);
    
    expect(hasEmptyState || hasContactList).toBeTruthy();
  });

  test('should add an emergency contact', async ({ page }) => {
    if (!testEmployeeId) {
      test.skip();
      return;
    }
    
    // Go to Emergency Contacts tab
    await page.click('button[role="tab"]:has-text("Emergency Contacts")');
    await page.waitForTimeout(500);
    
    // Click Add Emergency Contact button
    await page.click('button:has-text("Add Emergency Contact")');
    
    // Wait for modal to appear
    await expect(page.locator('text=Add Emergency Contact').nth(1)).toBeVisible();
    
    // Fill in emergency contact form
    await page.fill('input[name="name"]', `${TEST_DATA.prefix} Emergency Contact`);
    await page.fill('input[name="relationship"]', 'Spouse');
    await page.fill('input[name="phone_number"]', '07700900456');
    await page.fill('input[name="email"]', 'emergency@example.com');
    
    // Submit
    await page.click('button:has-text("Save")');
    
    // Wait for modal to close
    await expect(page.locator('text=Add Emergency Contact').nth(1)).not.toBeVisible({ timeout: 10000 });
    
    // Verify contact was added
    await expect(page.locator(`text=${TEST_DATA.prefix} Emergency Contact`)).toBeVisible();
    await expect(page.locator('text=Spouse')).toBeVisible();
  });

  test('should switch to Financial Details tab', async ({ page }) => {
    if (!testEmployeeId) {
      test.skip();
      return;
    }
    
    // Click Financial Details tab
    await page.click('button[role="tab"]:has-text("Financial Details")');
    await page.waitForTimeout(500);
    
    // Check for financial details form
    const panel = page.locator('[role="tabpanel"]').first();
    await expect(panel.locator('text=NI Number')).toBeVisible();
    await expect(panel.locator('text=Bank Account Number')).toBeVisible();
    await expect(panel.locator('text=Sort Code')).toBeVisible();
    
    // Take screenshot
    await page.screenshot({ path: 'tests/screenshots/employee-financial-tab.png' });
  });

  test('should add financial details', async ({ page }) => {
    if (!testEmployeeId) {
      test.skip();
      return;
    }
    
    // Go to Financial Details tab
    await page.click('button[role="tab"]:has-text("Financial Details")');
    await page.waitForTimeout(500);
    
    // Fill in financial information
    await page.fill('input[name="ni_number"]', 'AB123456C');
    await page.fill('input[name="bank_account_number"]', '12345678');
    await page.fill('input[name="bank_sort_code"]', '12-34-56');
    await page.fill('input[name="bank_name"]', 'Test Bank');
    
    // Save
    await page.click('button:has-text("Save Financial Details")');
    
    // Check for success message
    await expect(page.locator('text=Financial details saved, Financial details updated').first()).toBeVisible({ timeout: 10000 });
  });

  test('should switch to Health Records tab', async ({ page }) => {
    if (!testEmployeeId) {
      test.skip();
      return;
    }
    
    // Click Health Records tab
    await page.click('button[role="tab"]:has-text("Health Records")');
    await page.waitForTimeout(500);
    
    // Check for health records form
    const panel = page.locator('[role="tabpanel"]').first();
    await expect(panel.locator('text=Doctor Details')).toBeVisible();
    await expect(panel.locator('text=Medical Conditions')).toBeVisible();
    await expect(panel.locator('text=Allergies')).toBeVisible();
  });

  test('should add health information', async ({ page }) => {
    if (!testEmployeeId) {
      test.skip();
      return;
    }
    
    // Go to Health Records tab
    await page.click('button[role="tab"]:has-text("Health Records")');
    await page.waitForTimeout(500);
    
    // Fill in health information
    await page.fill('input[name="doctor_name"]', 'Dr. Test');
    await page.fill('textarea[name="doctor_address"]', '123 Medical St\nHealth City');
    await page.fill('textarea[name="allergies"]', 'Test allergy');
    
    // Check a medical condition
    await page.check('input[name="has_diabetes"]');
    
    // Save
    await page.click('button:has-text("Save Health Records")');
    
    // Check for success message
    await expect(page.locator('text=Health records saved, Health records updated').first()).toBeVisible({ timeout: 10000 });
  });

  test('should navigate to edit page', async ({ page }) => {
    if (!testEmployeeId) {
      test.skip();
      return;
    }
    
    // Click Edit Employee button
    await page.click('a:has-text("Edit Employee")');
    
    // Should navigate to edit page
    await page.waitForURL(`**/employees/${testEmployeeId}/edit`);
    
    // Verify we're on edit page
    await expect(page.locator('h1')).toContainText('Edit Employee');
  });

  test('should handle notes and attachments section', async ({ page }) => {
    if (!testEmployeeId) {
      test.skip();
      return;
    }
    
    // Look for notes section
    await expect(page.locator('text=Notes & Attachments')).toBeVisible();
    
    // Check for add note form
    await expect(page.locator('button:has-text("Add Note")')).toBeVisible();
    
    // Add a test note
    await page.fill('textarea[placeholder*="Add a note"]', `${TEST_DATA.prefix} Test note added at ${new Date().toISOString()}`);
    await page.click('button:has-text("Add Note")');
    
    // Note should appear in the list
    await expect(page.locator(`text=${TEST_DATA.prefix} Test note`)).toBeVisible({ timeout: 10000 });
  });
});