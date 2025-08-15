import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

// Create screenshots directory
const screenshotsDir = path.join(process.cwd(), 'screenshots', new Date().toISOString().split('T')[0]);
if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}

test.describe('Capture Screenshots of All Pages', () => {
  // Authentication is handled by auth.setup.ts and reused via storageState

  test('Dashboard', async ({ page }) => {
    await page.goto('https://management.orangejelly.co.uk/');
    await page.waitForLoadState('networkidle');
    
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
    
    // Click on first event
    const firstEvent = await page.locator('table tbody tr').first().locator('a').first();
    if (await firstEvent.isVisible()) {
      await firstEvent.click();
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
    
    // Click on first customer
    const firstCustomer = await page.locator('table tbody tr').first().locator('a').first();
    if (await firstCustomer.isVisible()) {
      await firstCustomer.click();
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
    
    // Click on first employee
    const firstEmployee = await page.locator('table tbody tr').first().locator('a').first();
    if (await firstEmployee.isVisible()) {
      await firstEmployee.click();
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

  test('Mobile Navigation - Bottom Nav', async ({ page }) => {
    await page.goto('https://management.orangejelly.co.uk/');
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForLoadState('networkidle');
    
    // Capture bottom navigation
    await page.screenshot({ 
      path: path.join(screenshotsDir, '15-bottom-nav-mobile.png'),
      fullPage: false 
    });
    
    // Click More button if it exists
    const moreButton = await page.locator('button:has-text("More")');
    if (await moreButton.isVisible()) {
      await moreButton.click();
      await page.waitForTimeout(500); // Wait for drawer animation
      
      await page.screenshot({ 
        path: path.join(screenshotsDir, '16-more-drawer-mobile.png'),
        fullPage: false 
      });
    }
  });

  test('Table Bookings', async ({ page }) => {
    await page.goto('https://management.orangejelly.co.uk/table-bookings');
    await page.waitForLoadState('networkidle');
    
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
    await page.setViewportSize({ width: 375, height: 812 });
    
    // Type in search if available
    const searchInput = await page.locator('input[type="search"], input[placeholder*="Search"]').first();
    if (await searchInput.isVisible()) {
      await searchInput.fill('test');
      await page.waitForTimeout(1000); // Wait for debounce
      
      await page.screenshot({ 
        path: path.join(screenshotsDir, '18-search-active-mobile.png'),
        fullPage: true 
      });
    }
  });
});

// Summary test to list all screenshots
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