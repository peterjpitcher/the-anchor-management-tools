import { test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

// Create screenshots directory
const screenshotsDir = path.join(process.cwd(), 'screenshots', 'login-mobile-ux');
if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}

test.describe('Capture Login Page Screenshots', () => {
  test('Login Page - Mobile and Desktop', async ({ page }) => {
    await page.goto('https://management.orangejelly.co.uk/auth/login');
    await page.waitForLoadState('networkidle');
    
    // Desktop screenshot
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.screenshot({ 
      path: path.join(screenshotsDir, 'login-desktop.png'),
      fullPage: true 
    });
    
    // Tablet screenshot
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.screenshot({ 
      path: path.join(screenshotsDir, 'login-tablet.png'),
      fullPage: true 
    });
    
    // Mobile screenshot - iPhone 12 size
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ 
      path: path.join(screenshotsDir, 'login-mobile-iphone12.png'),
      fullPage: true 
    });
    
    // Mobile screenshot - Small phone
    await page.setViewportSize({ width: 375, height: 667 });
    await page.screenshot({ 
      path: path.join(screenshotsDir, 'login-mobile-small.png'),
      fullPage: true 
    });
    
    // Check if form is mobile-optimized
    await page.setViewportSize({ width: 375, height: 812 });
    
    // Focus on email input to check keyboard
    await page.click('input[name="email"]');
    await page.screenshot({ 
      path: path.join(screenshotsDir, 'login-mobile-keyboard.png'),
      fullPage: false 
    });
    
    console.log(`\n✅ Screenshots saved to: ${screenshotsDir}`);
    console.log('Screenshots captured:');
    const files = fs.readdirSync(screenshotsDir);
    files.forEach(file => console.log(`  - ${file}`));
  });
});