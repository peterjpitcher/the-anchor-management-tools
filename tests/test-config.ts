/**
 * Test configuration and credentials
 * 
 * IMPORTANT: Update these with real test credentials before running tests
 */

export const TEST_USERS = {
  superAdmin: {
    email: 'peter.pitcher@outlook.com',
    password: 'Pitcher1458955',
    role: 'super_admin'
  }
};

export const TEST_DATA = {
  // Prefix for all test data to make cleanup easier
  prefix: '[PLAYWRIGHT_TEST]',
  
  // Test phone numbers (UK test range)
  phoneNumbers: {
    valid: '07700900123',
    invalid: '123456',
    international: '+447700900456'
  },
  
  // Test event data
  event: {
    title: '[PLAYWRIGHT_TEST] Test Event',
    category: 'test-category',
    capacity: 50,
    price: 25.00
  },
  
  // Test customer data
  customer: {
    name: '[PLAYWRIGHT_TEST] John Doe',
    email: 'playwright.test@example.com',
    phone: '07700900789'
  }
};

// Helper to generate unique test data
export function generateTestData(type: 'event'): typeof TEST_DATA.event & { title: string };
export function generateTestData(type: 'customer'): typeof TEST_DATA.customer & { name: string; email: string };
export function generateTestData(type: 'employee'): { name: string; email: string };
export function generateTestData(type: 'event' | 'customer' | 'employee') {
  const timestamp = Date.now();
  
  switch (type) {
    case 'event':
      return {
        ...TEST_DATA.event,
        title: `${TEST_DATA.prefix} Test Event ${timestamp}`
      };
    case 'customer':
      return {
        ...TEST_DATA.customer,
        name: `${TEST_DATA.prefix} Customer ${timestamp}`,
        email: `playwright.test.${timestamp}@example.com`
      };
    case 'employee':
      return {
        name: `${TEST_DATA.prefix} Employee ${timestamp}`,
        email: `playwright.emp.${timestamp}@example.com`
      };
    default:
      throw new Error(`Unknown test data type: ${type}`);
  }
}

// URLs for different sections
export const URLS = {
  dashboard: '/dashboard',
  events: '/events',
  customers: '/customers',
  employees: '/employees',
  messages: '/messages',
  privateBookings: '/private-bookings',
  settings: '/settings'
};