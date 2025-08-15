import { test as setup, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const authFile = 'playwright/.auth/user.json';

// Ensure auth directory exists
const authDir = path.dirname(authFile);
if (!fs.existsSync(authDir)) {
  fs.mkdirSync(authDir, { recursive: true });
}

setup('authenticate', async ({ page }) => {
  // Navigate to login page
  await page.goto('https://management.orangejelly.co.uk/auth/login');
  
  // Wait for the page to fully load
  await page.waitForLoadState('networkidle');
  
  // Debug: Take a screenshot of the login page
  await page.screenshot({ path: 'screenshots/login-debug.png' });
  
  // Try different selector strategies based on Playwright best practices
  try {
    // Method 1: Try using getByLabel (recommended)
    const emailByLabel = page.getByLabel(/email/i);
    if (await emailByLabel.isVisible()) {
      await emailByLabel.fill('peter.pitcher@outlook.com');
    } else {
      // Method 2: Try using placeholder
      const emailByPlaceholder = page.getByPlaceholder(/email/i);
      if (await emailByPlaceholder.isVisible()) {
        await emailByPlaceholder.fill('peter.pitcher@outlook.com');
      } else {
        // Method 3: Fallback to type selector
        await page.locator('input[type="email"]').fill('peter.pitcher@outlook.com');
      }
    }
    
    // Password field
    const passwordByLabel = page.getByLabel(/password/i);
    if (await passwordByLabel.isVisible()) {
      await passwordByLabel.fill('Pitcher1458955');
    } else {
      const passwordByPlaceholder = page.getByPlaceholder(/password/i);
      if (await passwordByPlaceholder.isVisible()) {
        await passwordByPlaceholder.fill('Pitcher1458955');
      } else {
        await page.locator('input[type="password"]').fill('Pitcher1458955');
      }
    }
    
    // Debug: Take screenshot after filling fields
    await page.screenshot({ path: 'screenshots/login-filled.png' });
    
    // Submit button - try multiple strategies
    const submitButton = page.getByRole('button', { name: /sign in|log in|login|submit/i });
    if (await submitButton.isVisible()) {
      await submitButton.click();
    } else {
      // Fallback to type selector
      await page.locator('button[type="submit"]').click();
    }
    
    // Wait for navigation to complete
    await page.waitForURL('https://management.orangejelly.co.uk/**', { 
      waitUntil: 'networkidle',
      timeout: 30000 
    });
    
    // Verify we're logged in by checking for a known element
    await expect(page).toHaveURL(/management\.orangejelly\.co\.uk\/(dashboard|events|customers)?/);
    
    // Save signed-in state to 'authFile'
    await page.context().storageState({ path: authFile });
    
    console.log('✅ Authentication successful! State saved to:', authFile);
    
  } catch (error) {
    console.error('❌ Authentication failed:', error);
    
    // Debug: Log page content
    const pageContent = await page.content();
    fs.writeFileSync('screenshots/login-page-html.html', pageContent);
    
    // Take error screenshot
    await page.screenshot({ path: 'screenshots/login-error.png', fullPage: true });
    
    throw error;
  }
});