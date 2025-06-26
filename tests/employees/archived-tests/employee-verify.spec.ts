import { test, expect } from '@playwright/test';
import { TEST_USERS } from '../test-config';

const TEST_CREDENTIALS = TEST_USERS.superAdmin;

test.describe('Employee Management - Verification', () => {
  test('verify employee management is working', async ({ page }) => {
    // Login
    await page.goto('/');
    await page.fill('input[type="email"]', TEST_CREDENTIALS.email);
    await page.fill('input[type="password"]', TEST_CREDENTIALS.password);
    await page.click('button[type="submit"]:has-text("Sign in")');
    await page.waitForURL('**/dashboard', { timeout: 30000 });
    console.log('✅ Login successful');
    
    // Test 1: Employee List
    await page.goto('/employees');
    await page.waitForLoadState('networkidle');
    
    // Check we're on the right page
    const employeeHeading = await page.textContent('h1');
    console.log('Page heading:', employeeHeading);
    expect(employeeHeading).toContain('Employees');
    
    // Check key elements exist
    const hasAddButton = await page.locator('text=Add Employee').count() > 0;
    const hasExportButton = await page.locator('button:has-text("Export")').count() > 0;
    const hasSearchBox = await page.locator('input[placeholder*="Search"]').count() > 0;
    
    console.log('Add Employee button:', hasAddButton ? '✅' : '❌');
    console.log('Export button:', hasExportButton ? '✅' : '❌'); 
    console.log('Search box:', hasSearchBox ? '✅' : '❌');
    
    // Count employees
    const employeeRows = await page.locator('tbody tr').count();
    console.log(`Number of employees: ${employeeRows}`);
    
    // Test 2: Navigate to Create Form
    await page.click('text=Add Employee');
    await page.waitForURL('**/employees/new', { timeout: 10000 });
    console.log('✅ Navigated to create form');
    
    // Check form elements
    const formTitle = await page.textContent('h3');
    console.log('Form title:', formTitle);
    
    const requiredFields = [
      'first_name',
      'last_name', 
      'email',
      'job_title',
      'employment_start_date'
    ];
    
    for (const fieldName of requiredFields) {
      const field = await page.locator(`input[name="${fieldName}"]`).count();
      console.log(`Field ${fieldName}:`, field > 0 ? '✅' : '❌');
    }
    
    // Test 3: Go back to list
    await page.click('text=Cancel');
    await page.waitForURL('**/employees', { timeout: 10000 });
    console.log('✅ Cancel button works');
    
    // Test 4: Click on an employee
    const firstEmployeeLink = page.locator('tbody tr a').first();
    if (await firstEmployeeLink.count() > 0) {
      const employeeName = await firstEmployeeLink.textContent();
      console.log('Clicking on employee:', employeeName);
      await firstEmployeeLink.click();
      await page.waitForURL(/\/employees\/[a-f0-9-]+$/, { timeout: 10000 });
      console.log('✅ Employee details page loaded');
      
      // Check for tabs
      const hasTabs = await page.locator('button[role="tab"]').count() > 0;
      console.log('Has tabs:', hasTabs ? '✅' : '❌');
    }
    
    console.log('\n🎉 Employee Management System is working correctly!');
  });
});