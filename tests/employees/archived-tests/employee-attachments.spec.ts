import { test, expect } from '@playwright/test';
import { TEST_USERS, TEST_DATA } from '../test-config';
import path from 'path';

// Use superadmin for all tests
const TEST_CREDENTIALS = TEST_USERS.superAdmin;

test.describe('Employee Attachments', () => {
  let testEmployeeId: string | null = null;
  
  test.beforeAll(async ({ browser }) => {
    // Create a test employee for attachment testing
    const page = await browser.newPage();
    
    // Login
    await page.goto('/');
    await page.fill('input[type="email"]', TEST_CREDENTIALS.email);
    await page.fill('input[type="password"]', TEST_CREDENTIALS.password);
    await page.click('button[type="submit"]:has-text("Sign in")');
    await page.waitForURL('**/dashboard');
    
    // Create employee
    await page.goto('/employees/new');
    const timestamp = Date.now();
    await page.fill('input[name="first_name"]', `${TEST_DATA.prefix} Attach`);
    await page.fill('input[name="last_name"]', `Test ${timestamp}`);
    await page.fill('input[name="email"]', `playwright.attach.${timestamp}@example.com`);
    await page.fill('input[name="job_title"]', 'Test Position');
    await page.fill('input[name="employment_start_date"]', new Date().toISOString().split('T')[0]);
    await page.selectOption('select[name="status"]', 'Active');
    
    await page.click('button:has-text("Add Employee")');
    await page.waitForURL(/\/employees\/([a-f0-9-]+)/, { timeout: 30000 });
    
    // Extract employee ID
    const url = page.url();
    const match = url.match(/\/employees\/([a-f0-9-]+)$/);
    if (match) {
      testEmployeeId = match[1];
      console.log(`Created test employee for attachments with ID: ${testEmployeeId}`);
    }
    
    await page.close();
  });
  
  test.beforeEach(async ({ page }) => {
    // Login before each test
    await page.goto('/');
    await page.fill('input[type="email"]', TEST_CREDENTIALS.email);
    await page.fill('input[type="password"]', TEST_CREDENTIALS.password);
    await page.click('button[type="submit"]:has-text("Sign in")');
    await page.waitForURL('**/dashboard');
    
    // Navigate to employee details page
    if (testEmployeeId) {
      await page.goto(`/employees/${testEmployeeId}`);
      await page.waitForLoadState('networkidle');
    }
  });

  test('should display attachments section', async ({ page }) => {
    if (!testEmployeeId) {
      test.skip();
      return;
    }
    
    // Look for attachments section
    await expect(page.locator('text=Documents')).toBeVisible();
    
    // Check for upload button
    await expect(page.locator('button:has-text("Upload Document"), button:has-text("Add Attachment")').first()).toBeVisible();
    
    // Should show empty state or document list
    const hasEmptyState = await page.locator('text=No documents uploaded').isVisible().catch(() => false);
    const hasDocumentList = await page.locator('text=File Name').isVisible().catch(() => false);
    
    expect(hasEmptyState || hasDocumentList).toBeTruthy();
  });

  test('should open upload modal', async ({ page }) => {
    if (!testEmployeeId) {
      test.skip();
      return;
    }
    
    // Click upload button
    await page.click('button:has-text("Upload Document"), button:has-text("Add Attachment")');
    
    // Modal should appear
    await expect(page.locator('text=Upload Document, Add Attachment').nth(1)).toBeVisible();
    
    // Check for form fields
    await expect(page.locator('text=Select File')).toBeVisible();
    await expect(page.locator('text=Category')).toBeVisible();
    
    // Check category options
    const categorySelect = page.locator('select[name="category"]');
    await expect(categorySelect).toBeVisible();
    
    // Close modal
    await page.keyboard.press('Escape');
    await expect(page.locator('text=Upload Document, Add Attachment').nth(1)).not.toBeVisible();
  });

  test('should upload a test document', async ({ page }) => {
    if (!testEmployeeId) {
      test.skip();
      return;
    }
    
    // Click upload button
    await page.click('button:has-text("Upload Document"), button:has-text("Add Attachment")');
    
    // Wait for modal
    await expect(page.locator('text=Upload Document, Add Attachment').nth(1)).toBeVisible();
    
    // Create a test file content
    const testFileName = `${TEST_DATA.prefix}-test-document-${Date.now()}.txt`;
    const testFileContent = `This is a test document for employee attachment testing.\nCreated at: ${new Date().toISOString()}`;
    
    // Set file input (create file on the fly)
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: testFileName,
      mimeType: 'text/plain',
      buffer: Buffer.from(testFileContent)
    });
    
    // Select category
    await page.selectOption('select[name="category"]', 'contract');
    
    // Submit
    await page.click('button:has-text("Upload")');
    
    // Wait for modal to close and file to appear
    await expect(page.locator('text=Upload Document, Add Attachment').nth(1)).not.toBeVisible({ timeout: 30000 });
    
    // Verify file appears in the list
    await expect(page.locator(`text=${testFileName}`)).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=contract')).toBeVisible();
    
    // Take screenshot
    await page.screenshot({ path: 'tests/screenshots/employee-attachment-uploaded.png' });
  });

  test('should upload multiple document types', async ({ page }) => {
    if (!testEmployeeId) {
      test.skip();
      return;
    }
    
    const documentTypes = [
      { category: 'cv', fileName: `${TEST_DATA.prefix}-cv-${Date.now()}.txt` },
      { category: 'certification', fileName: `${TEST_DATA.prefix}-cert-${Date.now()}.txt` },
      { category: 'id', fileName: `${TEST_DATA.prefix}-id-${Date.now()}.txt` }
    ];
    
    for (const doc of documentTypes) {
      // Click upload button
      await page.click('button:has-text("Upload Document"), button:has-text("Add Attachment")');
      
      // Wait for modal
      await expect(page.locator('text=Upload Document, Add Attachment').nth(1)).toBeVisible();
      
      // Upload file
      const fileInput = page.locator('input[type="file"]');
      await fileInput.setInputFiles({
        name: doc.fileName,
        mimeType: 'text/plain',
        buffer: Buffer.from(`Test ${doc.category} document content`)
      });
      
      // Select category
      await page.selectOption('select[name="category"]', doc.category);
      
      // Submit
      await page.click('button:has-text("Upload")');
      
      // Wait for modal to close
      await expect(page.locator('text=Upload Document, Add Attachment').nth(1)).not.toBeVisible({ timeout: 30000 });
      
      // Wait a bit between uploads
      await page.waitForTimeout(1000);
    }
    
    // Verify all files are listed
    for (const doc of documentTypes) {
      await expect(page.locator(`text=${doc.fileName}`)).toBeVisible();
    }
  });

  test('should handle upload errors gracefully', async ({ page }) => {
    if (!testEmployeeId) {
      test.skip();
      return;
    }
    
    // Click upload button
    await page.click('button:has-text("Upload Document"), button:has-text("Add Attachment")');
    
    // Try to submit without selecting a file
    await page.click('button:has-text("Upload")');
    
    // Should show validation or stay on modal
    await expect(page.locator('text=Upload Document, Add Attachment').nth(1)).toBeVisible();
    
    // File input should be required
    const fileInput = page.locator('input[type="file"]');
    const isRequired = await fileInput.getAttribute('required');
    expect(isRequired !== null).toBeTruthy();
  });

  test('should delete an attachment', async ({ page }) => {
    if (!testEmployeeId) {
      test.skip();
      return;
    }
    
    // First, upload a file to delete
    await page.click('button:has-text("Upload Document"), button:has-text("Add Attachment")');
    
    const deleteFileName = `${TEST_DATA.prefix}-to-delete-${Date.now()}.txt`;
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: deleteFileName,
      mimeType: 'text/plain',
      buffer: Buffer.from('This file will be deleted')
    });
    
    await page.selectOption('select[name="category"]', 'other');
    await page.click('button:has-text("Upload")');
    await expect(page.locator('text=Upload Document, Add Attachment').nth(1)).not.toBeVisible({ timeout: 30000 });
    
    // Wait for file to appear
    await expect(page.locator(`text=${deleteFileName}`)).toBeVisible({ timeout: 10000 });
    
    // Find and click delete button for this file
    const fileRow = page.locator('tr', { has: page.locator(`text=${deleteFileName}`) });
    const deleteButton = fileRow.locator('button:has-text("Delete"), button[aria-label*="Delete"]').first();
    await deleteButton.click();
    
    // Confirm deletion if there's a confirmation dialog
    const confirmButton = page.locator('button:has-text("Confirm"), button:has-text("Delete")').last();
    if (await confirmButton.isVisible({ timeout: 2000 })) {
      await confirmButton.click();
    }
    
    // File should be removed from the list
    await expect(page.locator(`text=${deleteFileName}`)).not.toBeVisible({ timeout: 10000 });
  });

  test('should display file size and upload date', async ({ page }) => {
    if (!testEmployeeId) {
      test.skip();
      return;
    }
    
    // Check if there are any files in the list
    const fileRows = page.locator('tbody tr').filter({ 
      hasNot: page.locator('text=No documents uploaded') 
    });
    
    const rowCount = await fileRows.count();
    if (rowCount > 0) {
      // Check first file row for expected columns
      const firstRow = fileRows.first();
      
      // Should have file size (e.g., "1.2 KB", "15 B")
      await expect(firstRow.locator('text=/\\d+\\s*(B|KB|MB)/')).toBeVisible();
      
      // Should have date (various formats possible)
      const datePattern = /\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2}|Today|Yesterday/;
      await expect(firstRow.locator(`text=/${datePattern}/`)).toBeVisible();
    }
  });
});