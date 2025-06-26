import { test, expect } from '@playwright/test';
import { TEST_USERS, TEST_DATA, generateTestData } from '../test-config';

// Use superadmin for all tests
const TEST_CREDENTIALS = TEST_USERS.superAdmin;

test.describe('Employee List Page', () => {
  test.beforeEach(async ({ page }) => {
    // Login before each test
    await page.goto('/');
    await page.fill('input[type="email"]', TEST_CREDENTIALS.email);
    await page.fill('input[type="password"]', TEST_CREDENTIALS.password);
    await page.click('button[type="submit"]:has-text("Sign in")');
    await page.waitForURL('**/dashboard', { timeout: 30000 });
    
    // Navigate to employees page
    await page.goto('/employees');
    await page.waitForLoadState('networkidle');
    
    // Wait for the page to be fully loaded
    await page.waitForSelector('h1:has-text("Employees")', { timeout: 10000 });
  });

  test('should display employee list page correctly', async ({ page }) => {
    // Check page title
    await expect(page.locator('h1')).toContainText('Employees');
    
    // Check for key UI elements
    await expect(page.locator('text=Add Employee')).toBeVisible();
    await expect(page.locator('input[placeholder*="Search"]')).toBeVisible();
    
    // Check for filter buttons (they include counts)
    await expect(page.locator('button[class*="All"], button:has-text("All (")').first()).toBeVisible();
    await expect(page.locator('button[class*="Active"], button:has-text("Active (")').first()).toBeVisible();
    await expect(page.locator('button[class*="Former"], button:has-text("Former (")').first()).toBeVisible();
    
    // Check for export button
    await expect(page.locator('button:has-text("Export")').first()).toBeVisible();
    
    // Take screenshot
    await page.screenshot({ path: 'tests/screenshots/employee-list.png' });
  });

  test('should search for employees', async ({ page }) => {
    // Enter search term
    const searchInput = page.locator('input[placeholder*="Search"]');
    await searchInput.fill('test');
    await searchInput.press('Enter');
    
    // Wait for search to complete
    await page.waitForTimeout(1000);
    
    // Check that results are filtered (or no results message appears)
    const noResults = page.locator('text=No employees found');
    const employeeRows = page.locator('tr[role="row"]').filter({ hasNot: page.locator('th') });
    
    // Either we have results or a no results message
    const hasResults = await employeeRows.count() > 0;
    const hasNoResultsMessage = await noResults.isVisible();
    
    expect(hasResults || hasNoResultsMessage).toBeTruthy();
  });

  test('should filter by status', async ({ page }) => {
    // Click Active filter (includes count)
    await page.click('button:has-text("Active (")');
    await page.waitForTimeout(500);
    
    // Check that Active button is selected (usually has different styling)
    const activeButton = page.locator('button:has-text("Active (")').first();
    const activeClasses = await activeButton.getAttribute('class');
    expect(activeClasses).toContain('bg-'); // Some background color when active
    
    // Click Former filter
    await page.click('button:has-text("Former (")');
    await page.waitForTimeout(500);
    
    // Check that Former button is selected
    const formerButton = page.locator('button:has-text("Former (")').first();
    const formerClasses = await formerButton.getAttribute('class');
    expect(formerClasses).toContain('bg-');
  });

  test('should navigate to add employee page', async ({ page }) => {
    // Click Add Employee button
    await page.click('text=Add Employee');
    
    // Wait for navigation
    await page.waitForURL('**/employees/new');
    
    // Verify we're on the new employee page
    await expect(page.locator('h1')).toContainText('Add New Employee');
  });

  test('should open export modal', async ({ page }) => {
    // Click Export button
    await page.click('button:has-text("Export")');
    
    // Wait for modal to appear
    await expect(page.locator('text=Export Employees')).toBeVisible();
    
    // Check export format options
    await expect(page.locator('text=CSV')).toBeVisible();
    await expect(page.locator('text=JSON')).toBeVisible();
    
    // Check filter options in export modal
    await expect(page.locator('text=All Employees')).toBeVisible();
    await expect(page.locator('text=Active Only')).toBeVisible();
    await expect(page.locator('text=Former Only')).toBeVisible();
    
    // Close modal
    await page.keyboard.press('Escape');
    await expect(page.locator('text=Export Employees')).not.toBeVisible();
  });

  test('should handle empty state gracefully', async ({ page }) => {
    // Search for something that won't exist
    const searchInput = page.locator('input[placeholder*="Search"]');
    await searchInput.fill('[PLAYWRIGHT_TEST_NONEXISTENT]');
    await searchInput.press('Enter');
    
    // Wait for search
    await page.waitForTimeout(1000);
    
    // Should show no results message
    await expect(page.locator('text=No employees found')).toBeVisible();
  });

  test('should navigate to employee details when clicking on row', async ({ page }) => {
    // Get the first employee row (if any exist)
    const employeeRows = page.locator('tbody tr').filter({ hasNot: page.locator('text=No employees found') });
    const rowCount = await employeeRows.count();
    
    if (rowCount > 0) {
      // Click on the first employee row
      await employeeRows.first().click();
      
      // Should navigate to employee detail page
      await page.waitForURL(/\/employees\/[a-f0-9-]+$/);
      
      // Should show employee details tabs
      await expect(page.locator('text=Details')).toBeVisible();
      await expect(page.locator('text=Emergency Contacts')).toBeVisible();
    } else {
      // If no employees exist, skip this part of the test
      console.log('No employees found to test row click navigation');
    }
  });
});