import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

// Create screenshots directory with timestamp
const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
const screenshotsDir = path.join(process.cwd(), 'screenshots', `full-capture-${timestamp}`);
if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}

test.describe('Capture All Pages with Layout Analysis', () => {
  test('capture all pages in single session', async ({ page }) => {
    // Navigate to login page
    await page.goto('https://management.orangejelly.co.uk/auth/login');
    await page.waitForLoadState('networkidle');
    
    // Login
    console.log('Logging in...');
    await page.getByPlaceholder('you@example.com').fill('peter.pitcher@outlook.com');
    await page.getByPlaceholder('Enter your password').fill('Pitcher1458955');
    await page.getByRole('button', { name: 'Sign in' }).click();
    
    // Wait for navigation to dashboard
    await page.waitForURL((url) => !url.toString().includes('/auth/login'), {
      timeout: 30000,
      waitUntil: 'networkidle'
    });
    
    console.log('Login successful! Starting captures...');

    // Pages to capture
    const pages = [
      { name: 'dashboard', url: '/' },
      { name: 'events', url: '/events' },
      { name: 'customers', url: '/customers' },
      { name: 'messages', url: '/messages' },
      { name: 'private-bookings', url: '/private-bookings' },
      { name: 'employees', url: '/employees' },
      { name: 'invoices', url: '/invoices' },
      { name: 'settings', url: '/settings' },
      { name: 'add-event', url: '/events/new' },
      { name: 'add-customer', url: '/customers/new' },
      { name: 'table-bookings', url: '/table-bookings' },
      { name: 'vip-club', url: '/loyalty/admin' }
    ];

    for (const pageInfo of pages) {
      console.log(`Capturing ${pageInfo.name}...`);
      
      // Navigate to page
      await page.goto(`https://management.orangejelly.co.uk${pageInfo.url}`);
      await page.waitForLoadState('networkidle');
      
      // Wait a bit for dynamic content
      await page.waitForTimeout(1000);
      
      // Capture desktop view
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.screenshot({ 
        path: path.join(screenshotsDir, `${pageInfo.name}-desktop.png`),
        fullPage: true 
      });
      
      // Capture mobile view
      await page.setViewportSize({ width: 375, height: 812 });
      await page.screenshot({ 
        path: path.join(screenshotsDir, `${pageInfo.name}-mobile.png`),
        fullPage: true 
      });
      
      console.log(`✓ ${pageInfo.name} captured`);
    }

    console.log(`\n📸 All screenshots saved to: ${screenshotsDir}`);
    
    // Generate summary
    const files = fs.readdirSync(screenshotsDir);
    const summary = {
      date: new Date().toISOString(),
      directory: screenshotsDir,
      screenshots: files.sort(),
      total: files.length,
      pages: pages.map(p => p.name)
    };
    
    fs.writeFileSync(
      path.join(screenshotsDir, 'summary.json'),
      JSON.stringify(summary, null, 2)
    );
    
    console.log(`📊 Total screenshots: ${files.length}`);
  });
});