import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

// Create screenshots directory with timestamp
const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
const screenshotsDir = path.join(process.cwd(), 'screenshots', `capture-${timestamp}`);
if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}

test.describe.serial('Capture All Screenshots', () => {
  // Use serial mode to maintain session across tests
  let isLoggedIn = false;

  test.beforeEach(async ({ page }) => {
    if (!isLoggedIn) {
      // Navigate to login page
      await page.goto('https://management.orangejelly.co.uk/auth/login');
      await page.waitForLoadState('networkidle');
      
      // Check if we're on login page
      if (page.url().includes('/auth/login')) {
        console.log('Logging in...');
        
        // Use the actual placeholder text from the page
        await page.getByPlaceholder('you@example.com').fill('peter.pitcher@outlook.com');
        await page.getByPlaceholder('Enter your password').fill('Pitcher1458955');
        
        // Click the Sign in button
        await page.getByRole('button', { name: 'Sign in' }).click();
        
        // Wait for navigation away from login page
        await page.waitForURL((url) => !url.toString().includes('/auth/login'), {
          timeout: 30000,
          waitUntil: 'networkidle'
        });
        
        isLoggedIn = true;
        console.log('Login successful!');
      }
    }
  });

  test('Dashboard', async ({ page }) => {
    await page.goto('https://management.orangejelly.co.uk/');
    await page.waitForLoadState('networkidle');
    
    // Desktop
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.screenshot({ 
      path: path.join(screenshotsDir, '01-dashboard-desktop.png'),
      fullPage: true 
    });
    
    // Mobile
    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({ 
      path: path.join(screenshotsDir, '01-dashboard-mobile.png'),
      fullPage: true 
    });
    console.log('✓ Dashboard screenshots captured');
  });

  test('Events', async ({ page }) => {
    await page.goto('https://management.orangejelly.co.uk/events');
    await page.waitForLoadState('networkidle');
    
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.screenshot({ 
      path: path.join(screenshotsDir, '02-events-desktop.png'),
      fullPage: true 
    });
    
    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({ 
      path: path.join(screenshotsDir, '02-events-mobile.png'),
      fullPage: true 
    });
    console.log('✓ Events screenshots captured');
  });

  test('Customers', async ({ page }) => {
    await page.goto('https://management.orangejelly.co.uk/customers');
    await page.waitForLoadState('networkidle');
    
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.screenshot({ 
      path: path.join(screenshotsDir, '03-customers-desktop.png'),
      fullPage: true 
    });
    
    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({ 
      path: path.join(screenshotsDir, '03-customers-mobile.png'),
      fullPage: true 
    });
    console.log('✓ Customers screenshots captured');
  });

  test('Messages', async ({ page }) => {
    await page.goto('https://management.orangejelly.co.uk/messages');
    await page.waitForLoadState('networkidle');
    
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.screenshot({ 
      path: path.join(screenshotsDir, '04-messages-desktop.png'),
      fullPage: true 
    });
    
    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({ 
      path: path.join(screenshotsDir, '04-messages-mobile.png'),
      fullPage: true 
    });
    console.log('✓ Messages screenshots captured');
  });

  test('Private Bookings', async ({ page }) => {
    await page.goto('https://management.orangejelly.co.uk/private-bookings');
    await page.waitForLoadState('networkidle');
    
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.screenshot({ 
      path: path.join(screenshotsDir, '05-private-bookings-desktop.png'),
      fullPage: true 
    });
    
    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({ 
      path: path.join(screenshotsDir, '05-private-bookings-mobile.png'),
      fullPage: true 
    });
    console.log('✓ Private Bookings screenshots captured');
  });

  test('Employees', async ({ page }) => {
    await page.goto('https://management.orangejelly.co.uk/employees');
    await page.waitForLoadState('networkidle');
    
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.screenshot({ 
      path: path.join(screenshotsDir, '06-employees-desktop.png'),
      fullPage: true 
    });
    
    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({ 
      path: path.join(screenshotsDir, '06-employees-mobile.png'),
      fullPage: true 
    });
    console.log('✓ Employees screenshots captured');
  });

  test('Invoices', async ({ page }) => {
    await page.goto('https://management.orangejelly.co.uk/invoices');
    await page.waitForLoadState('networkidle');
    
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.screenshot({ 
      path: path.join(screenshotsDir, '07-invoices-desktop.png'),
      fullPage: true 
    });
    
    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({ 
      path: path.join(screenshotsDir, '07-invoices-mobile.png'),
      fullPage: true 
    });
    console.log('✓ Invoices screenshots captured');
  });

  test('Settings', async ({ page }) => {
    await page.goto('https://management.orangejelly.co.uk/settings');
    await page.waitForLoadState('networkidle');
    
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.screenshot({ 
      path: path.join(screenshotsDir, '08-settings-desktop.png'),
      fullPage: true 
    });
    
    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({ 
      path: path.join(screenshotsDir, '08-settings-mobile.png'),
      fullPage: true 
    });
    console.log('✓ Settings screenshots captured');
  });

  test('Add Event Form', async ({ page }) => {
    await page.goto('https://management.orangejelly.co.uk/events/new');
    await page.waitForLoadState('networkidle');
    
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.screenshot({ 
      path: path.join(screenshotsDir, '09-add-event-desktop.png'),
      fullPage: true 
    });
    
    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({ 
      path: path.join(screenshotsDir, '09-add-event-mobile.png'),
      fullPage: true 
    });
    console.log('✓ Add Event Form screenshots captured');
  });

  test('Add Customer Form', async ({ page }) => {
    await page.goto('https://management.orangejelly.co.uk/customers/new');
    await page.waitForLoadState('networkidle');
    
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.screenshot({ 
      path: path.join(screenshotsDir, '10-add-customer-desktop.png'),
      fullPage: true 
    });
    
    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({ 
      path: path.join(screenshotsDir, '10-add-customer-mobile.png'),
      fullPage: true 
    });
    console.log('✓ Add Customer Form screenshots captured');
  });

  test('Table Bookings', async ({ page }) => {
    await page.goto('https://management.orangejelly.co.uk/table-bookings');
    await page.waitForLoadState('networkidle');
    
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.screenshot({ 
      path: path.join(screenshotsDir, '11-table-bookings-desktop.png'),
      fullPage: true 
    });
    
    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({ 
      path: path.join(screenshotsDir, '11-table-bookings-mobile.png'),
      fullPage: true 
    });
    console.log('✓ Table Bookings screenshots captured');
  });

  test('VIP Club', async ({ page }) => {
    await page.goto('https://management.orangejelly.co.uk/loyalty/admin');
    await page.waitForLoadState('networkidle');
    
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.screenshot({ 
      path: path.join(screenshotsDir, '12-vip-club-desktop.png'),
      fullPage: true 
    });
    
    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({ 
      path: path.join(screenshotsDir, '12-vip-club-mobile.png'),
      fullPage: true 
    });
    console.log('✓ VIP Club screenshots captured');
  });

  test.afterAll(async () => {
    console.log(`\n📸 All screenshots saved to: ${screenshotsDir}`);
    
    // Generate summary
    const files = fs.readdirSync(screenshotsDir);
    const summary = {
      date: new Date().toISOString(),
      directory: screenshotsDir,
      screenshots: files.sort(),
      total: files.length
    };
    
    fs.writeFileSync(
      path.join(screenshotsDir, 'summary.json'),
      JSON.stringify(summary, null, 2)
    );
    
    console.log(`📊 Total screenshots: ${files.length}`);
  });
});