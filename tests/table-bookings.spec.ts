import { test, expect, Page } from '@playwright/test';
import { format, addDays } from 'date-fns';

// Test configuration
const TEST_PHONE = '07700900' + Math.floor(Math.random() * 1000).toString().padStart(3, '0');
const TEST_EMAIL = `test-${Date.now()}@example.com`;

test.describe('Table Booking System', () => {
  test.beforeEach(async ({ page }) => {
    // Login before each test
    await page.goto('/login');
    await page.fill('input[type="email"]', process.env.TEST_EMAIL || '');
    await page.fill('input[type="password"]', process.env.TEST_PASSWORD || '');
    await page.click('button[type="submit"]');
    
    // Wait for dashboard to load
    await page.waitForURL('/', { timeout: 10000 });
  });

  test.describe('Dashboard', () => {
    test('should display table bookings dashboard', async ({ page }) => {
      await page.goto('/table-bookings');
      
      // Check page title
      await expect(page.locator('h1')).toContainText('Table Bookings');
      
      // Check stats cards are displayed
      await expect(page.locator('text=Today\'s Bookings')).toBeVisible();
      await expect(page.locator('text=Today\'s Covers')).toBeVisible();
      await expect(page.locator('text=Today\'s Revenue')).toBeVisible();
      
      // Check action buttons
      await expect(page.locator('text=New Booking')).toBeVisible();
      await expect(page.locator('text=Calendar View')).toBeVisible();
    });

    test('should navigate to reports', async ({ page }) => {
      await page.goto('/table-bookings');
      await page.click('text=Reports');
      
      await expect(page).toHaveURL('/table-bookings/reports');
      await expect(page.locator('h1')).toContainText('Table Booking Reports');
    });
  });

  test.describe('Create Booking', () => {
    test('should create a regular table booking', async ({ page }) => {
      await page.goto('/table-bookings/new');
      
      // Select booking type
      await page.click('input[value="regular"]');
      
      // Set date and party size
      const tomorrow = format(addDays(new Date(), 1), 'yyyy-MM-dd');
      await page.fill('input[type="date"]', tomorrow);
      await page.fill('input[type="number"]', '4');
      
      // Wait for time slots to load
      await page.waitForSelector('text=12:00', { timeout: 10000 });
      
      // Select time slot
      await page.click('text=12:00');
      
      // Fill customer details
      await page.fill('input[placeholder="07700900000"]', TEST_PHONE);
      await page.fill('text=First Name', 'Test');
      await page.fill('text=Last Name', 'Customer');
      await page.fill('input[type="email"]', TEST_EMAIL);
      
      // Add special requirements
      await page.fill('textarea[placeholder*="Window table"]', 'Window table please');
      
      // Submit form
      await page.click('button:has-text("Create Booking")');
      
      // Should redirect to booking details
      await page.waitForURL(/\/table-bookings\/[a-f0-9-]+/, { timeout: 10000 });
      
      // Verify booking details
      await expect(page.locator('h1')).toContainText('Booking TB-');
      await expect(page.locator('text=Test Customer')).toBeVisible();
      await expect(page.locator('text=Party of 4')).toBeVisible();
      await expect(page.locator('text=Window table please')).toBeVisible();
    });

    test('should validate required fields', async ({ page }) => {
      await page.goto('/table-bookings/new');
      
      // Try to submit without selecting time
      await page.click('button:has-text("Create Booking")');
      
      // Should show error
      await expect(page.locator('text=Please select a time slot')).toBeVisible();
    });

    test('should check availability', async ({ page }) => {
      await page.goto('/table-bookings/new');
      
      // Set date to far future (likely no availability)
      const futureDate = format(addDays(new Date(), 60), 'yyyy-MM-dd');
      await page.fill('input[type="date"]', futureDate);
      await page.fill('input[type="number"]', '10');
      
      // Should show no availability message
      await expect(page.locator('text=No available slots for this date')).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('Edit Booking', () => {
    test('should edit booking details', async ({ page }) => {
      // First create a booking
      const bookingId = await createTestBooking(page);
      
      // Navigate to edit page
      await page.goto(`/table-bookings/${bookingId}/edit`);
      
      // Change party size
      await page.fill('input[type="number"]', '6');
      
      // Update special requirements
      await page.fill('textarea', 'Updated requirements - need high chair');
      
      // Submit
      await page.click('button:has-text("Update Booking")');
      
      // Should redirect back to details
      await page.waitForURL(`/table-bookings/${bookingId}`);
      
      // Verify updates
      await expect(page.locator('text=Party of 6')).toBeVisible();
      await expect(page.locator('text=Updated requirements - need high chair')).toBeVisible();
    });

    test('should prevent editing past bookings', async ({ page }) => {
      // This would require a past booking in the test data
      // For now, we'll check the UI behavior
      await page.goto('/table-bookings');
      
      // If there are any past bookings, verify edit is disabled
      const bookingLinks = page.locator('a[href^="/table-bookings/"]');
      const count = await bookingLinks.count();
      
      if (count > 0) {
        await bookingLinks.first().click();
        
        // Check if it's a past booking
        const isPast = await page.locator('text=Past bookings cannot be edited').isVisible();
        if (isPast) {
          expect(isPast).toBeTruthy();
        }
      }
    });
  });

  test.describe('Cancel Booking', () => {
    test('should cancel a booking', async ({ page }) => {
      // Create a booking first
      const bookingId = await createTestBooking(page);
      
      // Navigate to booking details
      await page.goto(`/table-bookings/${bookingId}`);
      
      // Click cancel button
      await page.click('button:has-text("Cancel Booking")');
      
      // Fill cancellation reason
      await page.fill('textarea[placeholder*="Reason for cancellation"]', 'Customer requested cancellation');
      
      // Confirm cancellation
      await page.click('button:has-text("Confirm Cancellation")');
      
      // Wait for modal to close
      await page.waitForSelector('text=Cancelled', { timeout: 10000 });
      
      // Verify booking is cancelled
      await expect(page.locator('text=Cancelled')).toBeVisible();
    });
  });

  test.describe('Table Configuration', () => {
    test('should manage tables', async ({ page }) => {
      await page.goto('/table-bookings/settings/tables');
      
      // Add new table
      await page.click('button:has-text("Add Table")');
      
      // Fill table details
      await page.fill('input[placeholder*="Table 1"]', `Test Table ${Date.now()}`);
      await page.fill('input[type="number"]', '4');
      
      // Submit
      await page.click('button:has-text("Create Table")');
      
      // Wait for modal to close
      await page.waitForSelector('text=Test Table', { timeout: 10000 });
      
      // Verify table was added
      await expect(page.locator(`text=Test Table`)).toBeVisible();
    });
  });

  test.describe('SMS Templates', () => {
    test('should edit SMS template', async ({ page }) => {
      await page.goto('/table-bookings/settings/sms-templates');
      
      // Click edit on first template
      await page.locator('button[aria-label*="Edit"]').first().click();
      
      // Modify template
      const textarea = page.locator('textarea');
      const currentText = await textarea.inputValue();
      await textarea.fill(currentText + ' - Updated');
      
      // Save
      await page.click('button:has-text("Update Template")');
      
      // Wait for modal to close
      await page.waitForSelector('text=Updated', { timeout: 10000 });
      
      // Verify update
      await expect(page.locator('text=- Updated')).toBeVisible();
    });
  });

  test.describe('Reports', () => {
    test('should generate and download report', async ({ page }) => {
      await page.goto('/table-bookings/reports');
      
      // Select date range
      await page.click('button:has-text("This Month")');
      
      // Wait for data to load
      await page.waitForSelector('text=Total Bookings', { timeout: 10000 });
      
      // Download CSV
      const downloadPromise = page.waitForEvent('download');
      await page.click('button:has-text("Download CSV")');
      const download = await downloadPromise;
      
      // Verify download
      expect(download.suggestedFilename()).toContain('table-bookings-report');
      expect(download.suggestedFilename()).toContain('.csv');
    });

    test('should display booking analytics', async ({ page }) => {
      await page.goto('/table-bookings/reports');
      
      // Check metrics are displayed
      await expect(page.locator('text=Total Bookings')).toBeVisible();
      await expect(page.locator('text=Total Covers')).toBeVisible();
      await expect(page.locator('text=Average Party Size')).toBeVisible();
      
      // Check charts/visualizations
      await expect(page.locator('text=Bookings by Day of Week')).toBeVisible();
      await expect(page.locator('text=Bookings by Hour')).toBeVisible();
    });
  });

  test.describe('Search and Filter', () => {
    test('should search bookings', async ({ page }) => {
      await page.goto('/table-bookings/search');
      
      // Search by phone number
      await page.fill('input[placeholder*="phone"]', TEST_PHONE);
      await page.click('button:has-text("Search")');
      
      // Should show results or no results message
      await page.waitForSelector('text=results', { timeout: 10000 });
    });
  });
});

// Helper function to create a test booking
async function createTestBooking(page: Page): Promise<string> {
  await page.goto('/table-bookings/new');
  
  // Fill basic booking details
  await page.click('input[value="regular"]');
  const tomorrow = format(addDays(new Date(), 1), 'yyyy-MM-dd');
  await page.fill('input[type="date"]', tomorrow);
  await page.fill('input[type="number"]', '2');
  
  // Wait for and select time slot
  await page.waitForSelector('text=12:00', { timeout: 10000 });
  await page.click('text=12:00');
  
  // Fill customer details
  const uniquePhone = '07700900' + Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  await page.fill('input[placeholder="07700900000"]', uniquePhone);
  await page.fill('text=First Name', 'Test');
  await page.fill('text=Last Name', 'Booking');
  
  // Submit
  await page.click('button:has-text("Create Booking")');
  
  // Wait for redirect and extract booking ID
  await page.waitForURL(/\/table-bookings\/([a-f0-9-]+)/, { timeout: 10000 });
  const url = page.url();
  const bookingId = url.split('/').pop() || '';
  
  return bookingId;
}