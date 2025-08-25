import puppeteer from 'puppeteer';
import { promises as fs } from 'fs';
import path from 'path';

const PRODUCTION_URL = 'https://management.orangejelly.co.uk';
const SCREENSHOT_DIR = path.join(process.cwd(), 'screenshots', 'production');

// Pages to capture
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

// Get credentials from environment or prompt
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

  console.log('🚀 Starting production screenshot capture...');
  
  await ensureDirectoryExists(SCREENSHOT_DIR);

  const browser = await puppeteer.launch({
    headless: false, // Set to false to see what's happening
    defaultViewport: {
      width: 1920,
      height: 1080
    }
  });

  try {
    const page = await browser.newPage();
    
    // First, log in
    console.log('🔐 Logging in...');
    await page.goto(`${PRODUCTION_URL}/auth/login`, { waitUntil: 'networkidle0' });
    
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
          await incognitoPage.goto(`${PRODUCTION_URL}${pageConfig.path}`, { waitUntil: 'networkidle0' });
          
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
      await page.goto(`${PRODUCTION_URL}${pageConfig.path}`, { waitUntil: 'networkidle0' });
      
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

    // Also capture mobile versions of key pages
    console.log('\n📱 Capturing mobile versions...');
    await page.setViewport({ width: 375, height: 812 }); // iPhone X size
    
    const mobilePagesToCapture = [
      { path: '/dashboard', name: 'dashboard-mobile' },
      { path: '/events', name: 'events-list-mobile' },
      { path: '/customers', name: 'customers-list-mobile' },
    ];

    for (const pageConfig of mobilePagesToCapture) {
      await page.goto(`${PRODUCTION_URL}${pageConfig.path}`, { waitUntil: 'networkidle0' });
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, `${pageConfig.name}.png`),
        fullPage: true
      });
      console.log(`📸 Captured: ${pageConfig.name}`);
    }

    console.log('\n✅ Screenshot capture complete!');
    console.log(`📁 Screenshots saved to: ${SCREENSHOT_DIR}`);
    
    // Generate comparison HTML
    await generateComparisonHTML();
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await browser.close();
  }
}

async function generateComparisonHTML() {
  const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Production Screenshots - Anchor Management Tools</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      margin: 0;
      padding: 20px;
      background: #f5f5f5;
    }
    .container {
      max-width: 1400px;
      margin: 0 auto;
    }
    h1 {
      color: #333;
      margin-bottom: 30px;
    }
    .screenshot-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
      gap: 20px;
      margin-bottom: 40px;
    }
    .screenshot-card {
      background: white;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      overflow: hidden;
    }
    .screenshot-header {
      padding: 15px;
      background: #f8f9fa;
      border-bottom: 1px solid #e9ecef;
    }
    .screenshot-title {
      font-weight: 600;
      color: #495057;
      margin: 0;
    }
    .screenshot-image {
      width: 100%;
      height: auto;
      display: block;
    }
    .section-title {
      font-size: 1.5rem;
      margin: 40px 0 20px;
      color: #333;
    }
    .note {
      background: #fff3cd;
      border: 1px solid #ffeaa7;
      border-radius: 4px;
      padding: 15px;
      margin-bottom: 30px;
      color: #856404;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Production Screenshots - Anchor Management Tools</h1>
    
    <div class="note">
      <strong>📸 Captured on:</strong> ${new Date().toLocaleString()}<br>
      <strong>🌐 URL:</strong> ${PRODUCTION_URL}<br>
      <strong>📱 Viewports:</strong> Desktop (1920x1080) and Mobile (375x812)
    </div>

    <h2 class="section-title">Desktop Views</h2>
    <div class="screenshot-grid">
      ${PAGES_TO_CAPTURE.filter(p => !p.name.includes('mobile')).map(page => `
        <div class="screenshot-card">
          <div class="screenshot-header">
            <h3 class="screenshot-title">${page.name.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</h3>
            <small>${page.path}</small>
          </div>
          <img src="${page.name}.png" alt="${page.name}" class="screenshot-image" />
        </div>
      `).join('')}
    </div>

    <h2 class="section-title">Mobile Views</h2>
    <div class="screenshot-grid">
      <div class="screenshot-card">
        <div class="screenshot-header">
          <h3 class="screenshot-title">Dashboard Mobile</h3>
        </div>
        <img src="dashboard-mobile.png" alt="Dashboard Mobile" class="screenshot-image" />
      </div>
      <div class="screenshot-card">
        <div class="screenshot-header">
          <h3 class="screenshot-title">Events List Mobile</h3>
        </div>
        <img src="events-list-mobile.png" alt="Events List Mobile" class="screenshot-image" />
      </div>
      <div class="screenshot-card">
        <div class="screenshot-header">
          <h3 class="screenshot-title">Customers List Mobile</h3>
        </div>
        <img src="customers-list-mobile.png" alt="Customers List Mobile" class="screenshot-image" />
      </div>
    </div>
  </div>
</body>
</html>
  `;

  await fs.writeFile(path.join(SCREENSHOT_DIR, 'index.html'), htmlContent);
  console.log(`\n📄 Comparison HTML generated at: ${path.join(SCREENSHOT_DIR, 'index.html')}`);
}

// Run the script
captureScreenshots().catch(console.error);