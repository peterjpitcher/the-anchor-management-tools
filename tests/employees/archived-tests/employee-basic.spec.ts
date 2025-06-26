import { test, expect } from '@playwright/test';
import { TEST_USERS } from '../test-config';

const TEST_CREDENTIALS = TEST_USERS.superAdmin;

test.describe('Employee Management - Basic Functionality', () => {
  test.beforeEach(async ({ page }) => {
    // Set longer timeout for navigation
    page.setDefaultTimeout(30000);
    
    // Login
    await page.goto('/');
    await page.fill('input[type="email"]', TEST_CREDENTIALS.email);
    await page.fill('input[type="password"]', TEST_CREDENTIALS.password);
    await page.click('button[type="submit"]:has-text("Sign in")');
    await page.waitForURL('**/dashboard');
  });

  test('can navigate to employee list', async ({ page }) => {
    await page.goto('/employees');
    
    // Verify we're on the employee page
    await expect(page.locator('h1')).toContainText('Employees', { timeout: 10000 });
    
    // Verify key elements exist
    await expect(page.locator('text=Add Employee')).toBeVisible();
    await expect(page.locator('button:has-text("Export")')).toBeVisible();
    
    // Take screenshot
    await page.screenshot({ 
      path: 'tests/screenshots/employee-basic-list.png',
      fullPage: true 
    });
    
    console.log('✅ Employee list page loads correctly');
  });

  test('can navigate to create employee form', async ({ page }) => {
    await page.goto('/employees');
    await page.click('text=Add Employee');
    
    // Verify we're on the create page
    await expect(page).toHaveURL(/\/employees\/new/);
    await expect(page.locator('h3')).toContainText('Add New Employee');
    
    // Verify form fields exist
    await expect(page.locator('input[name="first_name"]')).toBeVisible();
    await expect(page.locator('input[name="last_name"]')).toBeVisible();
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('button:has-text("Save Employee")')).toBeVisible();
    
    // Take screenshot
    await page.screenshot({ 
      path: 'tests/screenshots/employee-basic-create-form.png',
      fullPage: true 
    });
    
    console.log('✅ Employee create form loads correctly');
  });

  test('can view employee details', async ({ page }) => {
    await page.goto('/employees');
    
    // Wait for employee list to load
    await page.waitForSelector('tbody tr', { timeout: 10000 });
    
    // Click on first employee (if any exist)
    const firstEmployee = page.locator('tbody tr').first();
    const employeeCount = await page.locator('tbody tr').count();
    
    if (employeeCount > 0) {
      await firstEmployee.click();
      
      // Verify we navigated to employee detail page
      await expect(page).toHaveURL(/\/employees\/[a-f0-9-]+$/);
      
      // Verify tabs are visible
      await expect(page.locator('button[role="tab"]:has-text("Details")')).toBeVisible();
      await expect(page.locator('button[role="tab"]:has-text("Emergency Contacts")')).toBeVisible();
      
      // Take screenshot
      await page.screenshot({ 
        path: 'tests/screenshots/employee-basic-details.png',
        fullPage: true 
      });
      
      console.log('✅ Employee details page loads correctly');
    } else {
      console.log('⚠️  No employees found to test details page');
    }
  });

  test('search functionality works', async ({ page }) => {
    await page.goto('/employees');
    
    // Find search input
    const searchInput = page.locator('input[placeholder*="Search"]');
    await searchInput.fill('test search term');
    await searchInput.press('Enter');
    
    // Wait for search to complete
    await page.waitForTimeout(1000);
    
    // Page should still be functional (not crash)
    await expect(page.locator('h1')).toContainText('Employees');
    
    console.log('✅ Search functionality works without errors');
  });

  test('export modal opens', async ({ page }) => {
    await page.goto('/employees');
    
    // Click export button
    await page.click('button:has-text("Export")');
    
    // Verify modal appears
    await expect(page.locator('text=Export Employees')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=CSV')).toBeVisible();
    await expect(page.locator('text=JSON')).toBeVisible();
    
    // Take screenshot
    await page.screenshot({ 
      path: 'tests/screenshots/employee-basic-export-modal.png',
      fullPage: true 
    });
    
    // Close modal
    await page.keyboard.press('Escape');
    
    console.log('✅ Export modal works correctly');
  });
});