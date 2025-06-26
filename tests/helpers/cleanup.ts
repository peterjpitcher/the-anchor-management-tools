import { Page } from '@playwright/test';
import { TEST_DATA } from '../test-config';

/**
 * Helper functions for cleaning up test data
 */

export async function cleanupTestEmployees(page: Page) {
  console.log('Cleaning up test employees...');
  
  // Navigate to employees page
  await page.goto('/employees');
  await page.waitForLoadState('networkidle');
  
  // Search for test employees
  const searchInput = page.locator('input[placeholder*="Search"]');
  await searchInput.fill(TEST_DATA.prefix);
  await searchInput.press('Enter');
  await page.waitForTimeout(1000);
  
  // Check if any test employees exist
  const employeeRows = page.locator('tbody tr').filter({ 
    hasNot: page.locator('text=No employees found') 
  });
  
  const rowCount = await employeeRows.count();
  console.log(`Found ${rowCount} test employees to clean up`);
  
  // Delete each test employee
  for (let i = 0; i < rowCount; i++) {
    // Always get the first row since we're deleting them
    const row = employeeRows.first();
    
    // Click on the row to go to details
    await row.click();
    await page.waitForURL(/\/employees\/[a-f0-9-]+$/);
    
    // Look for delete button
    const deleteButton = page.locator('button:has-text("Delete Employee"), button:has-text("Delete")').first();
    if (await deleteButton.isVisible()) {
      await deleteButton.click();
      
      // Confirm deletion
      const confirmButton = page.locator('button:has-text("Confirm"), button:has-text("Delete")').last();
      if (await confirmButton.isVisible({ timeout: 2000 })) {
        await confirmButton.click();
      }
      
      // Wait for redirect back to list
      await page.waitForURL('**/employees', { timeout: 10000 });
      
      // Search again for remaining test employees
      await searchInput.fill(TEST_DATA.prefix);
      await searchInput.press('Enter');
      await page.waitForTimeout(1000);
    } else {
      console.log('Delete button not found, skipping...');
      // Go back to list
      await page.goto('/employees');
    }
  }
  
  console.log('Test employee cleanup complete');
}

export async function cleanupTestEvents(page: Page) {
  console.log('Cleaning up test events...');
  
  // Navigate to events page
  await page.goto('/events');
  await page.waitForLoadState('networkidle');
  
  // Search for test events
  const searchInput = page.locator('input[placeholder*="Search"]');
  if (await searchInput.isVisible()) {
    await searchInput.fill(TEST_DATA.prefix);
    await searchInput.press('Enter');
    await page.waitForTimeout(1000);
  }
  
  // Similar cleanup logic for events
  // ... implementation depends on events UI
}

export async function cleanupTestCustomers(page: Page) {
  console.log('Cleaning up test customers...');
  
  // Navigate to customers page
  await page.goto('/customers');
  await page.waitForLoadState('networkidle');
  
  // Search for test customers
  const searchInput = page.locator('input[placeholder*="Search"]');
  if (await searchInput.isVisible()) {
    await searchInput.fill(TEST_DATA.prefix);
    await searchInput.press('Enter');
    await page.waitForTimeout(1000);
  }
  
  // Similar cleanup logic for customers
  // ... implementation depends on customers UI
}

export async function cleanupAllTestData(page: Page) {
  console.log('Starting full test data cleanup...');
  
  try {
    await cleanupTestEmployees(page);
  } catch (error) {
    console.error('Error cleaning up employees:', error);
  }
  
  try {
    await cleanupTestEvents(page);
  } catch (error) {
    console.error('Error cleaning up events:', error);
  }
  
  try {
    await cleanupTestCustomers(page);
  } catch (error) {
    console.error('Error cleaning up customers:', error);
  }
  
  console.log('Test data cleanup complete');
}