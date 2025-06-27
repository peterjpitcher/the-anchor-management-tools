import { Page } from '@playwright/test';
import { TEST_DATA } from '../test-config';
import { waitForLoadingComplete, deleteFromList } from './test-utils';

/**
 * Comprehensive cleanup utilities for all test data
 */

/**
 * Generic cleanup function for any module
 */
async function cleanupModule(
  page: Page,
  moduleName: string,
  url: string,
  options?: {
    searchSelector?: string;
    rowSelector?: string;
    deleteButtonText?: string;
    confirmButtonText?: string;
  }
): Promise<number> {
  console.log(`Cleaning up test ${moduleName}...`);
  
  try {
    // Navigate to module page
    await page.goto(url);
    await waitForLoadingComplete(page);
    
    // Delete all test items
    const deletedCount = await deleteFromList(page, TEST_DATA.prefix, options);
    
    console.log(`Deleted ${deletedCount} test ${moduleName}`);
    return deletedCount;
  } catch (error) {
    console.error(`Error cleaning up ${moduleName}:`, error);
    return 0;
  }
}

/**
 * Cleanup test employees
 */
export async function cleanupTestEmployees(page: Page): Promise<number> {
  return cleanupModule(page, 'employees', '/employees', {
    deleteButtonText: 'Delete Employee'
  });
}

/**
 * Cleanup test events
 */
export async function cleanupTestEvents(page: Page): Promise<number> {
  console.log('Cleaning up test events...');
  
  try {
    await page.goto('/events');
    await waitForLoadingComplete(page);
    
    // Search for test events
    const searchInput = page.locator('input[placeholder*="Search"]');
    if (await searchInput.isVisible()) {
      await searchInput.fill(TEST_DATA.prefix);
      await searchInput.press('Enter');
      await waitForLoadingComplete(page);
    }
    
    // Get all test event cards/items
    const eventItems = page.locator('.event-card, [data-testid="event-item"]').filter({
      hasText: TEST_DATA.prefix
    });
    
    const itemCount = await eventItems.count();
    let deletedCount = 0;
    
    for (let i = 0; i < itemCount; i++) {
      // Always get first item since we're deleting
      const item = eventItems.first();
      
      // Click to view details
      await item.click();
      await waitForLoadingComplete(page);
      
      // Look for delete/cancel button
      const deleteButton = page.locator('button:has-text("Delete Event"), button:has-text("Cancel Event")').first();
      if (await deleteButton.isVisible({ timeout: 5000 })) {
        await deleteButton.click();
        
        // Confirm deletion
        const confirmButton = page.locator('button:has-text("Confirm"), button:has-text("Yes")').last();
        if (await confirmButton.isVisible({ timeout: 2000 })) {
          await confirmButton.click();
          await waitForLoadingComplete(page);
          deletedCount++;
        }
      }
      
      // Go back to list
      await page.goto('/events');
      await waitForLoadingComplete(page);
      
      // Search again
      if (await searchInput.isVisible()) {
        await searchInput.fill(TEST_DATA.prefix);
        await searchInput.press('Enter');
        await waitForLoadingComplete(page);
      }
    }
    
    console.log(`Deleted ${deletedCount} test events`);
    return deletedCount;
  } catch (error) {
    console.error('Error cleaning up events:', error);
    return 0;
  }
}

/**
 * Cleanup test customers
 */
export async function cleanupTestCustomers(page: Page): Promise<number> {
  return cleanupModule(page, 'customers', '/customers', {
    deleteButtonText: 'Delete Customer'
  });
}

/**
 * Cleanup test private bookings
 */
export async function cleanupTestPrivateBookings(page: Page): Promise<number> {
  console.log('Cleaning up test private bookings...');
  
  try {
    await page.goto('/private-bookings');
    await waitForLoadingComplete(page);
    
    // Look for test bookings in the table or list
    const bookingRows = page.locator('tbody tr, .booking-item').filter({
      hasText: TEST_DATA.prefix
    });
    
    const rowCount = await bookingRows.count();
    let deletedCount = 0;
    
    for (let i = 0; i < rowCount; i++) {
      const row = bookingRows.first();
      
      // Click to view/edit
      await row.click();
      await waitForLoadingComplete(page);
      
      // Look for delete button
      const deleteButton = page.locator('button:has-text("Delete Booking"), button:has-text("Cancel Booking")').first();
      if (await deleteButton.isVisible({ timeout: 5000 })) {
        await deleteButton.click();
        
        // Confirm
        const confirmButton = page.locator('button:has-text("Confirm"), button:has-text("Yes")').last();
        if (await confirmButton.isVisible({ timeout: 2000 })) {
          await confirmButton.click();
          await waitForLoadingComplete(page);
          deletedCount++;
        }
      }
      
      // Return to list
      await page.goto('/private-bookings');
      await waitForLoadingComplete(page);
    }
    
    console.log(`Deleted ${deletedCount} test private bookings`);
    return deletedCount;
  } catch (error) {
    console.error('Error cleaning up private bookings:', error);
    return 0;
  }
}

/**
 * Cleanup test messages
 */
export async function cleanupTestMessages(page: Page): Promise<number> {
  console.log('Cleaning up test messages...');
  
  try {
    await page.goto('/messages');
    await waitForLoadingComplete(page);
    
    // Messages typically can't be deleted, but we can mark as read or archive
    // Count test messages for reporting
    const testMessages = page.locator('.message-item, tbody tr').filter({
      hasText: TEST_DATA.prefix
    });
    
    const messageCount = await testMessages.count();
    console.log(`Found ${messageCount} test messages (messages cannot be deleted)`);
    
    return 0; // Messages typically can't be deleted
  } catch (error) {
    console.error('Error checking messages:', error);
    return 0;
  }
}

/**
 * Cleanup all test data across all modules
 */
export async function cleanupAllTestData(page: Page): Promise<{
  total: number;
  details: Record<string, number>;
}> {
  console.log('Starting comprehensive test data cleanup...');
  
  const results = {
    employees: 0,
    events: 0,
    customers: 0,
    privateBookings: 0,
    messages: 0
  };
  
  // Clean up in order of dependencies (bookings before events/customers)
  try {
    results.privateBookings = await cleanupTestPrivateBookings(page);
  } catch (error) {
    console.error('Error cleaning up private bookings:', error);
  }
  
  try {
    results.events = await cleanupTestEvents(page);
  } catch (error) {
    console.error('Error cleaning up events:', error);
  }
  
  try {
    results.customers = await cleanupTestCustomers(page);
  } catch (error) {
    console.error('Error cleaning up customers:', error);
  }
  
  try {
    results.employees = await cleanupTestEmployees(page);
  } catch (error) {
    console.error('Error cleaning up employees:', error);
  }
  
  try {
    results.messages = await cleanupTestMessages(page);
  } catch (error) {
    console.error('Error checking messages:', error);
  }
  
  const total = Object.values(results).reduce((sum, count) => sum + count, 0);
  
  console.log('Test data cleanup complete:', results);
  console.log(`Total items cleaned: ${total}`);
  
  return { total, details: results };
}

/**
 * Cleanup specific test item by ID
 */
export async function cleanupTestItemById(
  page: Page,
  module: 'employees' | 'events' | 'customers' | 'private-bookings',
  itemId: string
): Promise<boolean> {
  try {
    // Navigate directly to item
    await page.goto(`/${module}/${itemId}`);
    await waitForLoadingComplete(page);
    
    // Look for delete button
    const deleteSelectors = [
      'button:has-text("Delete")',
      'button:has-text("Remove")',
      'button:has-text("Cancel")',
      '[data-testid="delete-button"]'
    ];
    
    for (const selector of deleteSelectors) {
      const deleteButton = page.locator(selector).first();
      if (await deleteButton.isVisible({ timeout: 2000 })) {
        await deleteButton.click();
        
        // Confirm
        const confirmButton = page.locator('button:has-text("Confirm"), button:has-text("Yes")').last();
        if (await confirmButton.isVisible({ timeout: 2000 })) {
          await confirmButton.click();
          await waitForLoadingComplete(page);
          return true;
        }
      }
    }
    
    return false;
  } catch (error) {
    console.error(`Error cleaning up ${module} item ${itemId}:`, error);
    return false;
  }
}

/**
 * Verify cleanup was successful
 */
export async function verifyCleanup(
  page: Page,
  module: 'employees' | 'events' | 'customers' | 'private-bookings' | 'messages'
): Promise<boolean> {
  const urls = {
    employees: '/employees',
    events: '/events',
    customers: '/customers',
    'private-bookings': '/private-bookings',
    messages: '/messages'
  };
  
  try {
    await page.goto(urls[module]);
    await waitForLoadingComplete(page);
    
    // Search for test data
    const searchInput = page.locator('input[placeholder*="Search"]');
    if (await searchInput.isVisible()) {
      await searchInput.fill(TEST_DATA.prefix);
      await searchInput.press('Enter');
      await waitForLoadingComplete(page);
    }
    
    // Check if any test items remain
    const testItems = page.locator('tbody tr, .card, .item').filter({
      hasText: TEST_DATA.prefix
    });
    
    const remainingCount = await testItems.count();
    
    if (remainingCount > 0) {
      console.warn(`Found ${remainingCount} remaining test items in ${module}`);
      return false;
    }
    
    return true;
  } catch (error) {
    console.error(`Error verifying cleanup for ${module}:`, error);
    return false;
  }
}