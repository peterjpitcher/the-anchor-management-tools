import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

// Create screenshots directory
const screenshotsDir = path.join(process.cwd(), 'screenshots', new Date().toISOString().split('T')[0]);
if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}

test.describe('Capture Screenshots of All Pages', () => {
  test.beforeEach(async ({ page }) => {
    // First check if we're already logged in by trying to access a protected page
    await page.goto('https://management.orangejelly.co.uk/');
    
    // If redirected to login, perform login
    if (page.url().includes('/auth/login')) {
      console.log('Not logged in, performing authentication...');
      
      // Wait for page to be ready
      await page.waitForLoadState('networkidle');
      
      // Fill login form using best practices selectors
      await page.getByPlaceholder(/email/i).fill('peter.pitcher@outlook.com');
      await page.getByPlaceholder(/password/i).fill('Pitcher1458955');
      
      // Click sign in button
      await page.getByRole('button', { name: /sign in/i }).click();
      
      // Wait for successful login - check for navigation away from login page
      await page.waitForURL((url) => !url.toString().includes('/auth/login'), {
        timeout: 30000,
        waitUntil: 'networkidle'
      });
      
      console.log('Login successful, now on:', page.url());
    }
  });

  test('Dashboard', async ({ page }) => {
    await page.goto('https://management.orangejelly.co.uk/');
    await page.waitForLoadState('networkidle');
    
    // Verify we're not on login page
    expect(page.url()).not.toContain('/auth/login');
    
    // Desktop screenshot
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.screenshot({ 
      path: path.join(screenshotsDir, '01-dashboard-desktop.png'),
      fullPage: true 
    });
    
    // Mobile screenshot
    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({ 
      path: path.join(screenshotsDir, '01-dashboard-mobile.png'),
      fullPage: true 
    });
  });

  test('Events List', async ({ page }) => {
    await page.goto('https://management.orangejelly.co.uk/events');
    await page.waitForLoadState('networkidle');
    
    // Verify we're not on login page
    expect(page.url()).not.toContain('/auth/login');
    
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
  });

  test('Event Details', async ({ page }) => {
    await page.goto('https://management.orangejelly.co.uk/events');
    await page.waitForLoadState('networkidle');
    
    // Look for a link to an event detail page
    const eventLink = page.locator('a[href*="/events/"]:not([href="/events/new"])').first();
    
    if (await eventLink.count() > 0) {
      await eventLink.click();
      await page.waitForLoadState('networkidle');
      
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.screenshot({ 
        path: path.join(screenshotsDir, '03-event-details-desktop.png'),
        fullPage: true 
      });
      
      await page.setViewportSize({ width: 375, height: 812 });
      await page.screenshot({ 
        path: path.join(screenshotsDir, '03-event-details-mobile.png'),
        fullPage: true 
      });
    }
  });

  test('Customers List', async ({ page }) => {
    await page.goto('https://management.orangejelly.co.uk/customers');
    await page.waitForLoadState('networkidle');
    
    expect(page.url()).not.toContain('/auth/login');
    
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.screenshot({ 
      path: path.join(screenshotsDir, '04-customers-desktop.png'),
      fullPage: true 
    });
    
    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({ 
      path: path.join(screenshotsDir, '04-customers-mobile.png'),
      fullPage: true 
    });
  });

  test('Customer Details', async ({ page }) => {
    await page.goto('https://management.orangejelly.co.uk/customers');
    await page.waitForLoadState('networkidle');
    
    const customerLink = page.locator('a[href*="/customers/"]:not([href="/customers/new"])').first();
    
    if (await customerLink.count() > 0) {
      await customerLink.click();
      await page.waitForLoadState('networkidle');
      
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.screenshot({ 
        path: path.join(screenshotsDir, '05-customer-details-desktop.png'),
        fullPage: true 
      });
      
      await page.setViewportSize({ width: 375, height: 812 });
      await page.screenshot({ 
        path: path.join(screenshotsDir, '05-customer-details-mobile.png'),
        fullPage: true 
      });
    }
  });

  test('Messages', async ({ page }) => {
    await page.goto('https://management.orangejelly.co.uk/messages');
    await page.waitForLoadState('networkidle');
    
    expect(page.url()).not.toContain('/auth/login');
    
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.screenshot({ 
      path: path.join(screenshotsDir, '06-messages-desktop.png'),
      fullPage: true 
    });
    
    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({ 
      path: path.join(screenshotsDir, '06-messages-mobile.png'),
      fullPage: true 
    });
  });

  test('Private Bookings', async ({ page }) => {
    await page.goto('https://management.orangejelly.co.uk/private-bookings');
    await page.waitForLoadState('networkidle');
    
    expect(page.url()).not.toContain('/auth/login');
    
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.screenshot({ 
      path: path.join(screenshotsDir, '07-private-bookings-desktop.png'),
      fullPage: true 
    });
    
    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({ 
      path: path.join(screenshotsDir, '07-private-bookings-mobile.png'),
      fullPage: true 
    });
  });

  test('Employees', async ({ page }) => {
    await page.goto('https://management.orangejelly.co.uk/employees');
    await page.waitForLoadState('networkidle');
    
    expect(page.url()).not.toContain('/auth/login');
    
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.screenshot({ 
      path: path.join(screenshotsDir, '08-employees-desktop.png'),
      fullPage: true 
    });
    
    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({ 
      path: path.join(screenshotsDir, '08-employees-mobile.png'),
      fullPage: true 
    });
  });

  test('Employee Details', async ({ page }) => {
    await page.goto('https://management.orangejelly.co.uk/employees');
    await page.waitForLoadState('networkidle');
    
    const employeeLink = page.locator('a[href*="/employees/"]:not([href="/employees/new"])').first();
    
    if (await employeeLink.count() > 0) {
      await employeeLink.click();
      await page.waitForLoadState('networkidle');
      
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.screenshot({ 
        path: path.join(screenshotsDir, '09-employee-details-desktop.png'),
        fullPage: true 
      });
      
      await page.setViewportSize({ width: 375, height: 812 });
      await page.screenshot({ 
        path: path.join(screenshotsDir, '09-employee-details-mobile.png'),
        fullPage: true 
      });
    }
  });

  test('Invoices', async ({ page }) => {
    await page.goto('https://management.orangejelly.co.uk/invoices');
    await page.waitForLoadState('networkidle');
    
    expect(page.url()).not.toContain('/auth/login');
    
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.screenshot({ 
      path: path.join(screenshotsDir, '10-invoices-desktop.png'),
      fullPage: true 
    });
    
    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({ 
      path: path.join(screenshotsDir, '10-invoices-mobile.png'),
      fullPage: true 
    });
  });

  test('VIP Club', async ({ page }) => {
    await page.goto('https://management.orangejelly.co.uk/loyalty/admin');
    await page.waitForLoadState('networkidle');
    
    expect(page.url()).not.toContain('/auth/login');
    
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.screenshot({ 
      path: path.join(screenshotsDir, '11-vip-club-desktop.png'),
      fullPage: true 
    });
    
    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({ 
      path: path.join(screenshotsDir, '11-vip-club-mobile.png'),
      fullPage: true 
    });
  });

  test('Settings', async ({ page }) => {
    await page.goto('https://management.orangejelly.co.uk/settings');
    await page.waitForLoadState('networkidle');
    
    expect(page.url()).not.toContain('/auth/login');
    
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.screenshot({ 
      path: path.join(screenshotsDir, '12-settings-desktop.png'),
      fullPage: true 
    });
    
    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({ 
      path: path.join(screenshotsDir, '12-settings-mobile.png'),
      fullPage: true 
    });
  });

  test('Forms - Add Event', async ({ page }) => {
    await page.goto('https://management.orangejelly.co.uk/events/new');
    await page.waitForLoadState('networkidle');
    
    expect(page.url()).not.toContain('/auth/login');
    
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.screenshot({ 
      path: path.join(screenshotsDir, '13-add-event-desktop.png'),
      fullPage: true 
    });
    
    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({ 
      path: path.join(screenshotsDir, '13-add-event-mobile.png'),
      fullPage: true 
    });
  });

  test('Forms - Add Customer', async ({ page }) => {
    await page.goto('https://management.orangejelly.co.uk/customers/new');
    await page.waitForLoadState('networkidle');
    
    expect(page.url()).not.toContain('/auth/login');
    
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.screenshot({ 
      path: path.join(screenshotsDir, '14-add-customer-desktop.png'),
      fullPage: true 
    });
    
    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({ 
      path: path.join(screenshotsDir, '14-add-customer-mobile.png'),
      fullPage: true 
    });
  });

  test('Table Bookings', async ({ page }) => {
    await page.goto('https://management.orangejelly.co.uk/table-bookings');
    await page.waitForLoadState('networkidle');
    
    expect(page.url()).not.toContain('/auth/login');
    
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.screenshot({ 
      path: path.join(screenshotsDir, '17-table-bookings-desktop.png'),
      fullPage: true 
    });
    
    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({ 
      path: path.join(screenshotsDir, '17-table-bookings-mobile.png'),
      fullPage: true 
    });
  });

  test('Search and Filters', async ({ page }) => {
    await page.goto('https://management.orangejelly.co.uk/customers');
    await page.waitForLoadState('networkidle');
    
    expect(page.url()).not.toContain('/auth/login');
    
    await page.setViewportSize({ width: 375, height: 812 });
    
    // Look for search input
    const searchInput = page.locator('input[type="search"], input[placeholder*="Search"]').first();
    if (await searchInput.count() > 0) {
      await searchInput.fill('test');
      await page.waitForTimeout(1000); // Wait for search
      
      await page.screenshot({ 
        path: path.join(screenshotsDir, '18-search-active-mobile.png'),
        fullPage: true 
      });
    }
  });
});

// Summary test
test('Generate Screenshot Summary', async () => {
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
  
  console.log('\n📸 Screenshots captured successfully!');
  console.log(`📁 Location: ${screenshotsDir}`);
  console.log(`📊 Total: ${files.length} screenshots`);
  console.log('\nScreenshots:');
  files.sort().forEach(file => {
    console.log(`  - ${file}`);
  });
});