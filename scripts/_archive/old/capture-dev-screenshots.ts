import puppeteer from 'puppeteer';
import { promises as fs } from 'fs';
import path from 'path';

const DEV_URL = 'http://localhost:3000';
const SCREENSHOT_DIR = path.join(process.cwd(), 'screenshots', 'development');

// Same pages as production
const PAGES_TO_CAPTURE = [
  { path: '/auth/login', name: 'login', waitForSelector: 'form' },
  { path: '/dashboard', name: 'dashboard', requiresAuth: true, waitForSelector: '[class*="grid"]' },
  { path: '/events', name: 'events-list', requiresAuth: true, waitForSelector: 'table, [class*="grid"]' },
  { path: '/events/new', name: 'events-new', requiresAuth: true, waitForSelector: 'form' },
  { path: '/customers', name: 'customers-list', requiresAuth: true, waitForSelector: 'table' },
  { path: '/customers/new', name: 'customers-new', requiresAuth: true, waitForSelector: 'form' },
  { path: '/employees', name: 'employees-list', requiresAuth: true, waitForSelector: 'table' },
  { path: '/invoices', name: 'invoices-list', requiresAuth: true, waitForSelector: 'table' },
  { path: '/private-bookings', name: 'private-bookings-list', requiresAuth: true, waitForSelector: 'table' },
  { path: '/messages', name: 'messages', requiresAuth: true, waitForSelector: '[class*="container"], [class*="card"]' },
  { path: '/settings', name: 'settings', requiresAuth: true, waitForSelector: '[class*="grid"]' },
];

// Get credentials from environment
const EMAIL = process.env.TEST_EMAIL || '';
const PASSWORD = process.env.TEST_PASSWORD || '';

async function ensureDirectoryExists(dir: string) {
  try {
    await fs.access(dir);
  } catch {
    await fs.mkdir(dir, { recursive: true });
  }
}

async function captureScreenshots() {
  if (!EMAIL || !PASSWORD) {
    console.error('❌ Please set TEST_EMAIL and TEST_PASSWORD environment variables');
    process.exit(1);
  }

  console.log('🚀 Starting development screenshot capture...');
  console.log(`📍 URL: ${DEV_URL}`);
  
  await ensureDirectoryExists(SCREENSHOT_DIR);

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: {
      width: 1920,
      height: 1080
    }
  });

  try {
    const page = await browser.newPage();
    
    // Check if dev server is running
    try {
      await page.goto(DEV_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (e) {
      console.error('❌ Could not connect to development server at', DEV_URL);
      console.error('   Error:', e.message);
      console.error('   Please ensure "npm run dev" is running');
      process.exit(1);
    }

    // First, log in
    console.log('🔐 Logging in...');
    await page.goto(`${DEV_URL}/auth/login`, { waitUntil: 'networkidle0' });
    
    // Fill login form - using the correct field names
    await page.type('input[name="login-email"]', EMAIL);
    await page.type('input[name="login-password"]', PASSWORD);
    await page.click('button[type="submit"]');
    
    // Wait for navigation after login
    await page.waitForNavigation({ waitUntil: 'networkidle0' });
    console.log('✅ Logged in successfully');

    // Capture each page
    for (const pageConfig of PAGES_TO_CAPTURE) {
      if (!pageConfig.requiresAuth || pageConfig.path === '/auth/login') {
        // For login page, open in new incognito context
        if (pageConfig.path === '/auth/login') {
          const context = await browser.createBrowserContext();
          const incognitoPage = await context.newPage();
          await incognitoPage.goto(`${DEV_URL}${pageConfig.path}`, { waitUntil: 'networkidle0' });
          
          if (pageConfig.waitForSelector) {
            await incognitoPage.waitForSelector(pageConfig.waitForSelector, { timeout: 10000 }).catch(() => {});
          }
          
          await incognitoPage.screenshot({
            path: path.join(SCREENSHOT_DIR, `${pageConfig.name}.png`),
            fullPage: true
          });
          
          console.log(`📸 Captured: ${pageConfig.name}`);
          await context.close();
          continue;
        }
      }

      console.log(`📄 Navigating to ${pageConfig.path}...`);
      await page.goto(`${DEV_URL}${pageConfig.path}`, { waitUntil: 'networkidle0' });
      
      // Wait for content to load
      if (pageConfig.waitForSelector) {
        try {
          await page.waitForSelector(pageConfig.waitForSelector, { timeout: 10000 });
        } catch (e) {
          console.warn(`⚠️  Selector not found for ${pageConfig.name}, continuing anyway...`);
        }
      }
      
      // Take screenshot
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `${pageConfig.name}.png`),
        fullPage: true
      });
      
      console.log(`📸 Captured: ${pageConfig.name}`);
      
      // Small delay between pages
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Also capture mobile versions
    console.log('\n📱 Capturing mobile versions...');
    await page.setViewport({ width: 375, height: 812 });
    
    const mobilePagesToCapture = [
      { path: '/dashboard', name: 'dashboard-mobile' },
      { path: '/events', name: 'events-list-mobile' },
      { path: '/customers', name: 'customers-list-mobile' },
    ];

    for (const pageConfig of mobilePagesToCapture) {
      await page.goto(`${DEV_URL}${pageConfig.path}`, { waitUntil: 'networkidle0' });
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `${pageConfig.name}.png`),
        fullPage: true
      });
      console.log(`📸 Captured: ${pageConfig.name}`);
    }

    console.log('\n✅ Screenshot capture complete!');
    console.log(`📁 Screenshots saved to: ${SCREENSHOT_DIR}`);
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await browser.close();
  }
}

// Run the script
captureScreenshots().catch(console.error);