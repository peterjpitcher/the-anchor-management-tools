import { test, expect } from '@playwright/test';
import { format, addDays } from 'date-fns';
import crypto from 'crypto';

// Generate test API key hash
const TEST_API_KEY = 'test-api-key-' + Date.now();
const TEST_API_KEY_HASH = crypto.createHash('sha256').update(TEST_API_KEY).digest('hex');

test.describe('Table Booking API Tests', () => {
  let apiKey: string;

  test.beforeAll(async ({ request }) => {
    // In a real test environment, you would create a test API key in the database
    // For now, we'll assume one exists or skip these tests
    apiKey = process.env.TEST_API_KEY || TEST_API_KEY;
  });

  test.describe('Availability Endpoint', () => {
    test('should check availability for regular booking', async ({ request }) => {
      const tomorrow = format(addDays(new Date(), 1), 'yyyy-MM-dd');
      
      const response = await request.get('/api/table-bookings/availability', {
        headers: {
          'x-api-key': apiKey,
        },
        params: {
          date: tomorrow,
          party_size: '4',
          booking_type: 'regular'
        }
      });

      expect(response.status()).toBe(200);
      
      const data = await response.json();
      expect(data).toHaveProperty('available');
      expect(data).toHaveProperty('time_slots');
      expect(Array.isArray(data.time_slots)).toBeTruthy();
    });

    test('should return 400 for invalid party size', async ({ request }) => {
      const tomorrow = format(addDays(new Date(), 1), 'yyyy-MM-dd');
      
      const response = await request.get('/api/table-bookings/availability', {
        headers: {
          'x-api-key': apiKey,
        },
        params: {
          date: tomorrow,
          party_size: '25', // Too large
          booking_type: 'regular'
        }
      });

      expect(response.status()).toBe(400);
      
      const data = await response.json();
      expect(data).toHaveProperty('error');
    });

    test('should require API key', async ({ request }) => {
      const tomorrow = format(addDays(new Date(), 1), 'yyyy-MM-dd');
      
      const response = await request.get('/api/table-bookings/availability', {
        params: {
          date: tomorrow,
          party_size: '4',
        }
      });

      expect(response.status()).toBe(401);
    });

    test('should handle rate limiting', async ({ request }) => {
      const tomorrow = format(addDays(new Date(), 1), 'yyyy-MM-dd');
      
      // Make multiple rapid requests
      const requests = Array(70).fill(null).map(() => 
        request.get('/api/table-bookings/availability', {
          headers: {
            'x-api-key': apiKey,
          },
          params: {
            date: tomorrow,
            party_size: '2',
          }
        })
      );

      const responses = await Promise.all(requests);
      
      // Some requests should be rate limited
      const rateLimited = responses.some(r => r.status() === 429);
      expect(rateLimited).toBeTruthy();
      
      // Check rate limit headers
      const limitedResponse = responses.find(r => r.status() === 429);
      if (limitedResponse) {
        expect(limitedResponse.headers()['x-ratelimit-limit']).toBeDefined();
        expect(limitedResponse.headers()['retry-after']).toBeDefined();
      }
    });
  });

  test.describe('Create Booking Endpoint', () => {
    test('should create a regular booking', async ({ request }) => {
      const tomorrow = format(addDays(new Date(), 1), 'yyyy-MM-dd');
      const uniquePhone = '07700900' + Math.floor(Math.random() * 1000).toString().padStart(3, '0');
      
      const response = await request.post('/api/table-bookings', {
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        data: {
          booking_type: 'regular',
          date: tomorrow,
          time: '12:00',
          party_size: 4,
          customer: {
            first_name: 'API',
            last_name: 'Test',
            mobile_number: uniquePhone,
            email: `api-test-${Date.now()}@example.com`,
            sms_opt_in: true
          },
          special_requirements: 'API test booking'
        }
      });

      expect(response.status()).toBe(201);
      
      const data = await response.json();
      expect(data).toHaveProperty('booking');
      expect(data.booking).toHaveProperty('booking_reference');
      expect(data.booking.booking_reference).toMatch(/^TB-\d{4}-/);
      expect(data.booking.status).toBe('confirmed');
    });

    test('should create Sunday lunch booking with menu', async ({ request }) => {
      // Find next Sunday
      const today = new Date();
      const daysUntilSunday = (7 - today.getDay()) % 7 || 7;
      const nextSunday = format(addDays(today, daysUntilSunday), 'yyyy-MM-dd');
      const uniquePhone = '07700900' + Math.floor(Math.random() * 1000).toString().padStart(3, '0');
      
      const response = await request.post('/api/table-bookings', {
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        data: {
          booking_type: 'sunday_lunch',
          date: nextSunday,
          time: '13:00',
          party_size: 2,
          customer: {
            first_name: 'Sunday',
            last_name: 'Lunch',
            mobile_number: uniquePhone,
            email: `sunday-${Date.now()}@example.com`,
            sms_opt_in: true
          },
          menu_selections: [
            {
              custom_item_name: 'Roasted Chicken',
              item_type: 'main',
              quantity: 2,
              price_at_booking: 14.99
            }
          ]
        }
      });

      expect(response.status()).toBe(201);
      
      const data = await response.json();
      expect(data.booking.status).toBe('pending_payment');
      expect(data.booking.requires_payment).toBeTruthy();
      expect(data).toHaveProperty('payment_url');
    });

    test('should validate required fields', async ({ request }) => {
      const response = await request.post('/api/table-bookings', {
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        data: {
          booking_type: 'regular',
          // Missing required fields
        }
      });

      expect(response.status()).toBe(400);
      
      const data = await response.json();
      expect(data).toHaveProperty('error');
    });
  });

  test.describe('Search Bookings Endpoint', () => {
    test('should search by phone number', async ({ request }) => {
      const response = await request.get('/api/table-bookings', {
        headers: {
          'x-api-key': apiKey,
        },
        params: {
          phone: '07700900',
        }
      });

      expect(response.status()).toBe(200);
      
      const data = await response.json();
      expect(data).toHaveProperty('bookings');
      expect(Array.isArray(data.bookings)).toBeTruthy();
    });

    test('should search by reference', async ({ request }) => {
      const response = await request.get('/api/table-bookings', {
        headers: {
          'x-api-key': apiKey,
        },
        params: {
          reference: 'TB-2024',
        }
      });

      expect(response.status()).toBe(200);
      
      const data = await response.json();
      expect(data).toHaveProperty('bookings');
    });

    test('should search by date range', async ({ request }) => {
      const startDate = format(new Date(), 'yyyy-MM-dd');
      const endDate = format(addDays(new Date(), 7), 'yyyy-MM-dd');
      
      const response = await request.get('/api/table-bookings', {
        headers: {
          'x-api-key': apiKey,
        },
        params: {
          start_date: startDate,
          end_date: endDate,
        }
      });

      expect(response.status()).toBe(200);
      
      const data = await response.json();
      expect(data).toHaveProperty('bookings');
    });
  });

  test.describe('Webhook Security', () => {
    test('should reject webhook without signature', async ({ request }) => {
      const response = await request.post('/api/webhooks/paypal/table-bookings', {
        headers: {
          'Content-Type': 'application/json',
        },
        data: {
          event_type: 'PAYMENT.CAPTURE.COMPLETED',
          resource: {}
        }
      });

      expect(response.status()).toBe(401);
    });
  });

  test.describe('Error Handling', () => {
    test('should handle malformed JSON', async ({ request }) => {
      const response = await request.post('/api/table-bookings', {
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        data: 'invalid json',
      });

      expect(response.status()).toBe(400);
    });

    test('should handle database errors gracefully', async ({ request }) => {
      const response = await request.post('/api/table-bookings', {
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        data: {
          booking_type: 'regular',
          date: '2024-13-45', // Invalid date
          time: '25:99', // Invalid time
          party_size: 4,
          customer: {
            first_name: 'Test',
            last_name: 'Error',
            mobile_number: '07700900000',
          }
        }
      });

      expect(response.status()).toBeGreaterThanOrEqual(400);
      expect(response.status()).toBeLessThan(500);
    });
  });
});