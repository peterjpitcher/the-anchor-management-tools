import { test, expect } from '@playwright/test';
import { TEST_USERS } from '../test-config';

// Using super admin for basic login test
const TEST_CREDENTIALS = TEST_USERS.superAdmin;

test.describe('Authentication', () => {
  test('should login and logout successfully', async ({ page }) => {
    // Step 1: Navigate to the login page
    await test.step('Navigate to login page', async () => {
      await page.goto('/');
      
      // Wait for the page to load
      await page.waitForLoadState('networkidle');
      
      // Check if we're on the login page
      await expect(page).toHaveURL(/.*auth/);
      await expect(page.locator('h2')).toContainText('Sign in to your account');
    });

    // Step 2: Fill in login credentials
    await test.step('Fill login form', async () => {
      // Find and fill email input
      await page.fill('input[type="email"]', TEST_CREDENTIALS.email);
      
      // Find and fill password input
      await page.fill('input[type="password"]', TEST_CREDENTIALS.password);
      
      // Take a screenshot before submitting
      await page.screenshot({ path: 'tests/screenshots/login-form-filled.png' });
    });

    // Step 3: Submit login form
    await test.step('Submit login and verify redirect', async () => {
      // Click the sign in button
      await page.click('button[type="submit"]:has-text("Sign in")');
      
      // Wait for navigation to dashboard
      await page.waitForURL('**/dashboard', { timeout: 30000 });
      
      // Verify we're on the dashboard
      await expect(page).toHaveURL(/.*dashboard/);
      
      // Look for user menu or dashboard elements
      await expect(page.locator('text=Dashboard')).toBeVisible();
    });

    // Step 4: Verify user is logged in
    await test.step('Verify logged in state', async () => {
      // Look for common dashboard elements or user indicators
      // Try multiple possible selectors for the user menu
      const userMenuSelectors = [
        'button:has-text("' + TEST_CREDENTIALS.email + '")',
        'button[aria-label*="User menu"]',
        'button[aria-label*="Account menu"]',
        'button:has-text("Sign out")',
        '[data-testid="user-menu"]',
        'button.user-menu',
        'div:has-text("' + TEST_CREDENTIALS.email + '")'
      ];
      
      let userMenuFound = false;
      for (const selector of userMenuSelectors) {
        try {
          const element = page.locator(selector).first();
          if (await element.isVisible({ timeout: 2000 })) {
            userMenuFound = true;
            break;
          }
        } catch {
          // Continue trying other selectors
        }
      }
      
      // If no user menu found, at least verify we're on dashboard
      if (!userMenuFound) {
        console.log('User menu not found, checking for dashboard elements');
        await expect(page.locator('text=Dashboard, text=Today\'s Events, text=Statistics').first()).toBeVisible({ timeout: 10000 });
      }
      
      // Take a screenshot of logged in state
      await page.screenshot({ path: 'tests/screenshots/dashboard-logged-in.png' });
    });

    // Step 5: Test logout
    await test.step('Logout successfully', async () => {
      // Try to find and click user menu or sign out directly
      const signOutSelectors = [
        'button:has-text("Sign out")',
        'a:has-text("Sign out")',
        'button:has-text("Log out")',
        'a:has-text("Log out")',
        '[data-testid="sign-out"]'
      ];
      
      // First try to open user menu if it exists
      const menuSelectors = [
        'button:has-text("' + TEST_CREDENTIALS.email + '")',
        'button[aria-label*="User menu"]',
        'button[aria-label*="Account menu"]',
        '[data-testid="user-menu"]'
      ];
      
      let menuClicked = false;
      for (const selector of menuSelectors) {
        try {
          const menu = page.locator(selector).first();
          if (await menu.isVisible({ timeout: 1000 })) {
            await menu.click();
            menuClicked = true;
            await page.waitForTimeout(500); // Wait for dropdown
            break;
          }
        } catch {
          continue;
        }
      }
      
      // Now try to find and click sign out
      let signedOut = false;
      for (const selector of signOutSelectors) {
        try {
          const signOut = page.locator(selector).first();
          if (await signOut.isVisible({ timeout: 2000 })) {
            await signOut.click();
            signedOut = true;
            break;
          }
        } catch {
          continue;
        }
      }
      
      if (!signedOut) {
        throw new Error('Could not find sign out button');
      }
      
      // Wait for redirect to login page
      await page.waitForURL(/.*auth/, { timeout: 30000 });
      
      // Verify we're back on login page
      await expect(page.locator('h2')).toContainText('Sign in to your account');
    });
  });

  test('should show error with invalid credentials', async ({ page }) => {
    await page.goto('/');
    
    // Fill in invalid credentials
    await page.fill('input[type="email"]', 'invalid@example.com');
    await page.fill('input[type="password"]', 'wrongpassword');
    
    // Submit form
    await page.click('button[type="submit"]:has-text("Sign in")');
    
    // Wait for error message - check for various possible error texts or alert element
    const errorSelectors = [
      'text=Invalid login credentials',
      'text=Invalid email or password',
      'text=Authentication failed',
      'text=Invalid credentials',
      'text=Login failed',
      '[role="alert"]',
      '.error-message',
      '.alert-error',
      'div[class*="error"]'
    ];
    
    let errorFound = false;
    for (const selector of errorSelectors) {
      try {
        const element = page.locator(selector).first();
        if (await element.isVisible({ timeout: 2000 })) {
          errorFound = true;
          console.log(`Found error with selector: ${selector}`);
          break;
        }
      } catch {
        continue;
      }
    }
    
    expect(errorFound).toBeTruthy();
    
    // Verify we're still on login page
    await expect(page).toHaveURL(/.*auth/);
  });

  test('should require email and password', async ({ page }) => {
    await page.goto('/');
    
    // Try to submit empty form
    await page.click('button[type="submit"]:has-text("Sign in")');
    
    // Check for HTML5 validation or custom validation messages
    const emailInput = page.locator('input[type="email"]');
    const passwordInput = page.locator('input[type="password"]');
    
    // Check if browser shows required field validation
    const emailValidity = await emailInput.evaluate((el: HTMLInputElement) => el.validity.valueMissing);
    const passwordValidity = await passwordInput.evaluate((el: HTMLInputElement) => el.validity.valueMissing);
    
    expect(emailValidity || passwordValidity).toBeTruthy();
  });
});