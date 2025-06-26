import { test, expect } from '@playwright/test';
import { TEST_USERS, TEST_DATA } from '../test-config';

const TEST_CREDENTIALS = TEST_USERS.superAdmin;

test.describe('Employee Management', () => {
  // Login once before all tests
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.fill('input[type="email"]', TEST_CREDENTIALS.email);
    await page.fill('input[type="password"]', TEST_CREDENTIALS.password);
    await page.click('button[type="submit"]:has-text("Sign in")');
    await page.waitForURL('**/dashboard');
  });

  test('should display employee list', async ({ page }) => {
    // Go to employees
    await page.goto('/employees');
    
    // Page should load
    await expect(page).toHaveURL(/\/employees/);
    
    // Should have a heading
    await expect(page.locator('h1, h2, h3').filter({ hasText: 'Employee' }).first()).toBeVisible();
    
    // Should have an add button
    await expect(page.getByRole('link', { name: /add.*employee/i }).or(page.getByRole('button', { name: /add.*employee/i }))).toBeVisible();
    
    // Should show some data or empty state
    const hasEmployees = await page.locator('tbody tr').count() > 0;
    const hasEmptyState = await page.getByText(/no.*employee/i).isVisible().catch(() => false);
    
    expect(hasEmployees || hasEmptyState).toBeTruthy();
  });

  test('should search for employees', async ({ page }) => {
    await page.goto('/employees');
    
    // Find search input
    const searchInput = page.locator('input[type="search"], input[placeholder*="earch"]').first();
    await expect(searchInput).toBeVisible();
    
    // Type search term
    await searchInput.fill('nonexistent12345');
    await searchInput.press('Enter');
    
    // Wait for results
    await page.waitForTimeout(1000);
    
    // Should show no results or filtered list
    const hasNoResults = await page.getByText(/no.*found|no.*result/i).isVisible().catch(() => false);
    const hasFilteredResults = await page.locator('tbody tr').count() === 0;
    
    expect(hasNoResults || hasFilteredResults).toBeTruthy();
  });

  test('should create a new employee', async ({ page }) => {
    await page.goto('/employees');
    
    // Click add employee
    await page.getByRole('link', { name: /add.*employee/i }).or(page.getByRole('button', { name: /add.*employee/i })).click();
    
    // Should be on create page
    await expect(page).toHaveURL(/\/employees\/new/);
    
    // Fill form with waits
    const timestamp = Date.now();
    const firstName = `${TEST_DATA.prefix} Test`;
    const lastName = `Employee ${timestamp}`;
    const email = `test.${timestamp}@example.com`;
    
    // Fill each field with a small delay
    await page.fill('input[name="first_name"]', firstName);
    await page.waitForTimeout(200);
    
    await page.fill('input[name="last_name"]', lastName);
    await page.waitForTimeout(200);
    
    await page.fill('input[name="email"]', email);
    await page.waitForTimeout(200);
    
    await page.fill('input[name="job_title"]', 'Test Position');
    await page.waitForTimeout(200);
    
    await page.fill('input[name="employment_start_date"]', new Date().toISOString().split('T')[0]);
    await page.waitForTimeout(200);
    
    // Submit
    await page.getByRole('button', { name: /save|create|add/i }).click();
    
    // Should either:
    // 1. Navigate away from /new page (success)
    // 2. Show error message (which we can read)
    await page.waitForTimeout(2000);
    
    const stillOnNewPage = page.url().includes('/new');
    if (stillOnNewPage) {
      // Check for error
      const error = await page.locator('[role="alert"], .error, .alert').textContent().catch(() => '');
      console.log('Form error:', error);
      throw new Error(`Failed to create employee: ${error}`);
    }
    
    // Success - we navigated away
    expect(page.url()).not.toContain('/new');
    console.log(`Created employee: ${firstName} ${lastName}`);
  });

  test('should view employee details', async ({ page }) => {
    await page.goto('/employees');
    
    // Get first employee row
    const firstEmployee = page.locator('tbody tr').first();
    const employeeCount = await page.locator('tbody tr').count();
    
    if (employeeCount === 0) {
      console.log('No employees to test');
      test.skip();
    }
    
    // Click on employee
    await firstEmployee.locator('a').first().click();
    
    // Should navigate to details page
    await expect(page).toHaveURL(/\/employees\/[a-f0-9-]+$/);
    
    // Should have tabs or sections
    const hasTabs = await page.locator('[role="tab"], .tab').count() > 0;
    const hasDetails = await page.getByText(/personal.*info|details|contact.*info/i).isVisible().catch(() => false);
    
    expect(hasTabs || hasDetails).toBeTruthy();
  });

  test('should edit employee', async ({ page }) => {
    await page.goto('/employees');
    
    // Get first employee
    const firstEmployeeLink = page.locator('tbody tr a').first();
    if (await firstEmployeeLink.count() === 0) {
      console.log('No employees to edit');
      test.skip();
    }
    
    // Go to employee details
    await firstEmployeeLink.click();
    await page.waitForURL(/\/employees\/[a-f0-9-]+$/);
    
    // Find edit button
    const editButton = page.getByRole('link', { name: /edit/i }).or(page.getByRole('button', { name: /edit/i }));
    await editButton.click();
    
    // Should be on edit page
    await expect(page).toHaveURL(/\/employees\/[a-f0-9-]+\/edit/);
    
    // Make a change
    const jobTitleInput = page.locator('input[name="job_title"]');
    await jobTitleInput.fill('Updated Position ' + Date.now());
    
    // Save
    await page.getByRole('button', { name: /save|update/i }).click();
    
    // Wait for save
    await page.waitForTimeout(2000);
    
    // Should have saved (no longer on edit page or shows success)
    const stillOnEditPage = page.url().includes('/edit');
    const hasSuccess = await page.getByText(/success|saved|updated/i).isVisible().catch(() => false);
    
    expect(!stillOnEditPage || hasSuccess).toBeTruthy();
  });

  test('should handle employee notes', async ({ page }) => {
    await page.goto('/employees');
    
    // Go to first employee
    const firstEmployeeLink = page.locator('tbody tr a').first();
    if (await firstEmployeeLink.count() === 0) {
      console.log('No employees for notes test');
      test.skip();
    }
    
    await firstEmployeeLink.click();
    await page.waitForURL(/\/employees\/[a-f0-9-]+$/);
    
    // Find notes section
    const noteInput = page.locator('textarea[placeholder*="note"], textarea[name*="note"]').first();
    if (await noteInput.count() === 0) {
      console.log('No note input found');
      test.skip();
    }
    
    // Add a note
    const noteText = `${TEST_DATA.prefix} Test note ${Date.now()}`;
    await noteInput.fill(noteText);
    
    // Submit note
    const addNoteButton = page.getByRole('button', { name: /add.*note|submit|save/i }).first();
    await addNoteButton.click();
    
    // Wait for note to appear
    await page.waitForTimeout(1000);
    
    // Note should be visible
    await expect(page.getByText(noteText)).toBeVisible();
  });

  test('should export employees', async ({ page }) => {
    await page.goto('/employees');
    
    // Click export
    const exportButton = page.getByRole('button', { name: /export/i });
    await exportButton.click();
    
    // Check for dropdown menu or modal
    const hasDropdown = await page.getByRole('menu').isVisible().catch(() => false);
    const hasModal = await page.getByText(/export.*employee/i).isVisible().catch(() => false);
    
    expect(hasDropdown || hasModal).toBeTruthy();
    
    // Should have format options
    const hasCSV = await page.getByText(/csv/i).isVisible().catch(() => false);
    const hasJSON = await page.getByText(/json/i).isVisible().catch(() => false);
    
    expect(hasCSV && hasJSON).toBeTruthy();
    
    // Close by clicking outside or escape
    await page.keyboard.press('Escape');
  });

  test('should handle emergency contacts', async ({ page }) => {
    await page.goto('/employees');
    
    // Go to first employee
    const firstEmployeeLink = page.locator('tbody tr a').first();
    if (await firstEmployeeLink.count() === 0) {
      console.log('No employees for emergency contact test');
      test.skip();
    }
    
    await firstEmployeeLink.click();
    await page.waitForURL(/\/employees\/[a-f0-9-]+$/);
    
    // Find emergency contacts tab
    const emergencyTab = page.locator('[role="tab"], .tab, button').filter({ hasText: /emergency/i }).first();
    if (await emergencyTab.count() > 0) {
      await emergencyTab.click();
      await page.waitForTimeout(500);
    }
    
    // Look for add emergency contact button
    const addContactButton = page.getByRole('button', { name: /add.*emergency|add.*contact/i }).first();
    if (await addContactButton.isVisible()) {
      await addContactButton.click();
      
      // Should show form or modal
      await expect(page.getByLabel(/name/i).first()).toBeVisible();
    }
  });
});

// Cleanup test
test.describe('Cleanup', () => {
  test('remove test employees', async ({ page }) => {
    await page.goto('/');
    await page.fill('input[type="email"]', TEST_CREDENTIALS.email);
    await page.fill('input[type="password"]', TEST_CREDENTIALS.password);
    await page.click('button[type="submit"]:has-text("Sign in")');
    await page.waitForURL('**/dashboard');
    
    await page.goto('/employees');
    
    // Search for test employees
    const searchInput = page.locator('input[type="search"], input[placeholder*="earch"]').first();
    await searchInput.fill(TEST_DATA.prefix);
    await searchInput.press('Enter');
    await page.waitForTimeout(1000);
    
    // Count test employees
    const testEmployees = await page.locator('tbody tr').count();
    console.log(`Found ${testEmployees} test employees to clean up`);
    
    // Note: Actual deletion would go here if delete functionality exists
  });
});