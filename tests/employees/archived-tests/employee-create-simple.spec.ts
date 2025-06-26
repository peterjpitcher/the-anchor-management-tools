import { test, expect } from '@playwright/test';
import { TEST_USERS, TEST_DATA } from '../test-config';
import { fillFormField, waitForFormReady } from '../helpers/form-helpers';

// Use superadmin for all tests
const TEST_CREDENTIALS = TEST_USERS.superAdmin;

test.describe('Employee Create - Simple Tests', () => {
  test.beforeEach(async ({ page }) => {
    // Login
    await page.goto('/');
    await page.fill('input[type="email"]', TEST_CREDENTIALS.email);
    await page.fill('input[type="password"]', TEST_CREDENTIALS.password);
    await page.click('button[type="submit"]:has-text("Sign in")');
    await page.waitForURL('**/dashboard');
    
    // Go to create employee page
    await page.goto('/employees/new');
    await waitForFormReady(page);
  });

  test('should fill and submit employee form step by step', async ({ page }) => {
    const timestamp = Date.now();
    
    // Step 1: Fill first name
    console.log('Filling first name...');
    await fillFormField(page, 'input[name="first_name"]', `${TEST_DATA.prefix} Test`);
    await page.waitForTimeout(200);
    
    // Step 2: Fill last name  
    console.log('Filling last name...');
    await fillFormField(page, 'input[name="last_name"]', `Employee ${timestamp}`);
    await page.waitForTimeout(200);
    
    // Step 3: Fill email
    console.log('Filling email...');
    await fillFormField(page, 'input[name="email"]', `test.${timestamp}@example.com`);
    await page.waitForTimeout(200);
    
    // Step 4: Fill job title
    console.log('Filling job title...');
    await fillFormField(page, 'input[name="job_title"]', 'Test Position');
    await page.waitForTimeout(200);
    
    // Step 5: Fill start date
    console.log('Filling start date...');
    const today = new Date().toISOString().split('T')[0];
    await fillFormField(page, 'input[name="employment_start_date"]', today);
    await page.waitForTimeout(200);
    
    // Take screenshot of filled form
    await page.screenshot({ 
      path: 'tests/screenshots/employee-create-simple-filled.png',
      fullPage: true 
    });
    
    // Step 6: Submit form
    console.log('Submitting form...');
    const saveButton = page.locator('button:has-text("Save Employee")');
    
    // Check button is enabled
    const isDisabled = await saveButton.isDisabled();
    console.log('Save button disabled?', isDisabled);
    
    if (!isDisabled) {
      await saveButton.click();
      
      // Wait for navigation or error
      console.log('Waiting for response...');
      const response = await Promise.race([
        page.waitForURL(/\/employees(?:\/[a-f0-9-]+)?/, { timeout: 15000 })
          .then(() => 'navigated'),
        page.waitForSelector('[role="alert"]', { timeout: 15000 })
          .then(() => 'error'),
        page.waitForTimeout(15000).then(() => 'timeout')
      ]);
      
      console.log('Response:', response);
      
      if (response === 'navigated') {
        console.log('Success! New URL:', page.url());
        await page.screenshot({ 
          path: 'tests/screenshots/employee-create-simple-success.png',
          fullPage: true 
        });
      } else if (response === 'error') {
        const errorText = await page.locator('[role="alert"]').textContent();
        console.log('Error:', errorText);
        await page.screenshot({ 
          path: 'tests/screenshots/employee-create-simple-error.png',
          fullPage: true 
        });
        throw new Error(`Form error: ${errorText}`);
      } else {
        console.log('Timeout waiting for response');
        await page.screenshot({ 
          path: 'tests/screenshots/employee-create-simple-timeout.png',
          fullPage: true 
        });
        throw new Error('Form submission timeout');
      }
    } else {
      await page.screenshot({ 
        path: 'tests/screenshots/employee-create-simple-disabled.png',
        fullPage: true 
      });
      throw new Error('Save button is disabled');
    }
  });

  test('should show validation for empty required fields', async ({ page }) => {
    // Try to submit without filling anything
    const saveButton = page.locator('button:has-text("Save Employee")');
    await saveButton.click();
    
    // Should still be on the same page
    await page.waitForTimeout(1000);
    expect(page.url()).toContain('/employees/new');
    
    // Check if any field shows as invalid
    const firstNameInput = page.locator('input[name="first_name"]');
    const hasValidationError = await firstNameInput.evaluate((el: HTMLInputElement) => {
      return !el.validity.valid || el.classList.contains('error') || el.getAttribute('aria-invalid') === 'true';
    });
    
    expect(hasValidationError).toBeTruthy();
  });

  test('should verify all required fields are present', async ({ page }) => {
    // Check all required fields exist
    const requiredFields = [
      { selector: 'input[name="first_name"]', label: 'First Name' },
      { selector: 'input[name="last_name"]', label: 'Last Name' },
      { selector: 'input[name="email"]', label: 'Email' },
      { selector: 'input[name="job_title"]', label: 'Job Title' },
      { selector: 'input[name="employment_start_date"]', label: 'Start Date' },
      { selector: 'select[name="status"]', label: 'Status' }
    ];
    
    for (const field of requiredFields) {
      const element = page.locator(field.selector);
      await expect(element).toBeVisible({ timeout: 5000 });
      console.log(`✓ Found ${field.label} field`);
      
      // Check if marked as required
      const isRequired = await element.getAttribute('required');
      const hasAsterisk = await page.locator(`label:has-text("${field.label} *")`).count() > 0;
      
      if (isRequired !== null || hasAsterisk) {
        console.log(`  - ${field.label} is marked as required`);
      }
    }
  });
});