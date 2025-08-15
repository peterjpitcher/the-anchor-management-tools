import { test } from '@playwright/test';

test('Debug single page with login', async ({ page }) => {
  // Go directly to dashboard
  await page.goto('https://management.orangejelly.co.uk/');
  
  console.log('Initial URL:', page.url());
  
  // If we're on login page, do the login
  if (page.url().includes('/auth/login')) {
    console.log('On login page, attempting to authenticate...');
    
    // Take screenshot of login page
    await page.screenshot({ path: 'screenshots/debug-1-login-page.png' });
    
    // Wait for page to be ready
    await page.waitForLoadState('networkidle');
    
    // Fill email using placeholder
    await page.getByPlaceholder(/email/i).fill('peter.pitcher@outlook.com');
    
    // Fill password using placeholder
    await page.getByPlaceholder(/password/i).fill('Pitcher1458955');
    
    // Take screenshot after filling
    await page.screenshot({ path: 'screenshots/debug-2-login-filled.png' });
    
    // Click sign in button
    await page.getByRole('button', { name: /sign in/i }).click();
    
    // Wait for navigation
    await page.waitForTimeout(5000); // Give it 5 seconds
    
    console.log('After login URL:', page.url());
    
    // Take screenshot after login attempt
    await page.screenshot({ path: 'screenshots/debug-3-after-login.png', fullPage: true });
  } else {
    console.log('Already logged in!');
    await page.screenshot({ path: 'screenshots/debug-logged-in.png', fullPage: true });
  }
  
  // Try to navigate to another page
  await page.goto('https://management.orangejelly.co.uk/events');
  await page.waitForLoadState('networkidle');
  
  console.log('Events page URL:', page.url());
  await page.screenshot({ path: 'screenshots/debug-4-events-page.png', fullPage: true });
});