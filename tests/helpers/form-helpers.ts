import { Page } from '@playwright/test';

/**
 * Helper functions for form interactions
 */

/**
 * Fill a form field reliably with proper waits and retries
 */
export async function fillFormField(
  page: Page, 
  selector: string, 
  value: string,
  options?: { 
    clickFirst?: boolean;
    clearFirst?: boolean;
    pressTab?: boolean;
  }
) {
  const opts = { clickFirst: true, clearFirst: false, pressTab: false, ...options };
  
  // Wait for the field to be visible and enabled
  const field = page.locator(selector);
  await field.waitFor({ state: 'visible', timeout: 10000 });
  
  // Click to focus if requested
  if (opts.clickFirst) {
    await field.click();
    await page.waitForTimeout(100); // Small delay after click
  }
  
  // Clear field if requested
  if (opts.clearFirst) {
    await field.clear();
  }
  
  // Type the value
  await field.fill(value);
  
  // Press tab to move to next field if requested
  if (opts.pressTab) {
    await page.keyboard.press('Tab');
  }
  
  // Verify the value was set
  const actualValue = await field.inputValue();
  if (actualValue !== value) {
    console.warn(`Field ${selector} has value "${actualValue}" instead of "${value}"`);
    // Try again
    await field.clear();
    await field.type(value, { delay: 50 });
  }
}

/**
 * Select an option from a dropdown reliably
 */
export async function selectOption(
  page: Page,
  selector: string,
  value: string
) {
  const select = page.locator(selector);
  await select.waitFor({ state: 'visible', timeout: 10000 });
  await select.selectOption(value);
  
  // Verify selection
  const selectedValue = await select.inputValue();
  if (selectedValue !== value) {
    console.warn(`Select ${selector} has value "${selectedValue}" instead of "${value}"`);
  }
}

/**
 * Wait for form to be ready by checking multiple indicators
 */
export async function waitForFormReady(page: Page) {
  // Wait for no more network activity
  await page.waitForLoadState('networkidle');
  
  // Wait for common form indicators
  await Promise.race([
    page.waitForSelector('button[type="submit"]', { state: 'visible' }),
    page.waitForSelector('button:has-text("Save")', { state: 'visible' }),
    page.waitForSelector('input[type="submit"]', { state: 'visible' })
  ]).catch(() => {}); // Ignore if none found
  
  // Additional small delay for JavaScript initialization
  await page.waitForTimeout(500);
}

/**
 * Submit form and wait for response
 */
export async function submitFormAndWait(
  page: Page,
  submitButtonSelector: string,
  options?: {
    successUrl?: RegExp;
    errorSelector?: string;
    timeout?: number;
  }
) {
  const opts = {
    timeout: 30000,
    ...options
  };
  
  // Click submit button
  const submitButton = page.locator(submitButtonSelector);
  await submitButton.click();
  
  // Wait for response
  const waitPromises: Promise<any>[] = [];
  
  if (opts.successUrl) {
    waitPromises.push(page.waitForURL(opts.successUrl, { timeout: opts.timeout }));
  }
  
  if (opts.errorSelector) {
    waitPromises.push(page.waitForSelector(opts.errorSelector, { timeout: opts.timeout }));
  }
  
  // Also wait for common success/error indicators
  waitPromises.push(
    page.waitForSelector('text=/success|created|saved|added/i', { timeout: opts.timeout }),
    page.waitForSelector('[role="alert"]', { timeout: opts.timeout }),
    page.waitForSelector('.error, .alert-error', { timeout: opts.timeout })
  );
  
  // Wait for any of these conditions
  try {
    await Promise.race(waitPromises);
  } catch (error) {
    console.log('No clear success/error indicator found after form submission');
  }
  
  // Give a moment for any animations
  await page.waitForTimeout(500);
}

/**
 * Check if form has validation errors
 */
export async function hasValidationErrors(page: Page): Promise<boolean> {
  // Check for HTML5 validation
  const invalidFields = await page.locator('input:invalid, select:invalid, textarea:invalid').count();
  if (invalidFields > 0) {
    return true;
  }
  
  // Check for custom error messages
  const errorMessages = await page.locator('.error-message, .field-error, [role="alert"]').count();
  if (errorMessages > 0) {
    return true;
  }
  
  // Check if we're still on the same page (form didn't submit)
  const currentUrl = page.url();
  await page.waitForTimeout(1000);
  return page.url() === currentUrl;
}