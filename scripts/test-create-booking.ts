import * as dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// Dynamic imports to ensure env vars are loaded first
async function runTest() {
  const { createPrivateBooking } = await import('../src/app/actions/privateBookingActions');
  
  console.log('Starting create private booking test...');
  
  // Mock FormData
  const formData = new FormData();
  formData.append('customer_first_name', 'Test');
  formData.append('customer_last_name', 'User');
  formData.append('contact_phone', '07700900000');
  formData.append('contact_email', 'test@example.com');
  
  // Set date to tomorrow
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dateStr = tomorrow.toISOString().split('T')[0];
  
  formData.append('event_date', dateStr);
  formData.append('start_time', '18:00');
  formData.append('end_time', '23:00');
  formData.append('guest_count', '50');
  formData.append('event_type', 'Birthday');
  formData.append('source', 'website');
  
  try {
    const result = await createPrivateBooking(formData);
    
    console.log('Result:', result);
    
    if (result.error) {
      console.error('Test failed with error:', result.error);
    } else if (result.success) {
      console.log('Test passed! Booking created with ID:', result.data?.id);
    }
  } catch (err) {
    console.error('Unexpected error during test:', err);
  }
}

runTest();