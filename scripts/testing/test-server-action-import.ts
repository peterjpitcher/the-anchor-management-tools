#!/usr/bin/env tsx

// Test if server actions can be imported and called from a script
// This simulates what happens in an API route

async function testServerActionImport() {
  console.log('Testing server action imports...\n');
  
  try {
    console.log('1. Attempting to import queueBookingConfirmationSMS...');
    const { queueBookingConfirmationSMS } = await import('../src/app/actions/table-booking-sms');
    console.log('   ✅ Import successful');
    console.log('   Type:', typeof queueBookingConfirmationSMS);
    
    // Check if it's actually callable
    if (typeof queueBookingConfirmationSMS === 'function') {
      console.log('   ✅ It is a function');
      
      // Try to call it with a fake booking ID
      console.log('\n2. Attempting to call the function with test data...');
      try {
        const result = await queueBookingConfirmationSMS('test-booking-id', true);
        console.log('   Result:', result);
      } catch (callError: any) {
        console.log('   ❌ Function call failed:', callError.message);
      }
    } else {
      console.log('   ❌ Not a function, actual type:', typeof queueBookingConfirmationSMS);
    }
    
  } catch (importError: any) {
    console.log('   ❌ Import failed:', importError.message);
    console.log('   Error type:', importError.constructor.name);
  }
  
  try {
    console.log('\n3. Attempting to import sendBookingConfirmationEmail...');
    const { sendBookingConfirmationEmail } = await import('../src/app/actions/table-booking-email');
    console.log('   ✅ Import successful');
    console.log('   Type:', typeof sendBookingConfirmationEmail);
  } catch (importError: any) {
    console.log('   ❌ Import failed:', importError.message);
  }
  
  console.log('\n4. Checking if this is a Next.js server context issue...');
  console.log('   NODE_ENV:', process.env.NODE_ENV);
  console.log('   Running in:', typeof window === 'undefined' ? 'Node.js' : 'Browser');
  
  console.log('\n5. Testing direct Twilio import (should work)...');
  try {
    const { sendSMS } = await import('../src/lib/twilio');
    console.log('   ✅ Twilio import successful');
    console.log('   Type:', typeof sendSMS);
  } catch (error: any) {
    console.log('   ❌ Twilio import failed:', error.message);
  }
}

testServerActionImport();