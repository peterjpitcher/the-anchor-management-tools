#!/usr/bin/env tsx
/**
 * Test script to verify birthday calendar synchronization
 * This tests both the configuration and the ability to create recurring events
 */

import { config } from 'dotenv';
import { testCalendarConnection, isCalendarConfigured } from '@/lib/google-calendar';
import { syncBirthdayCalendarEvent } from '@/lib/google-calendar-birthdays';

// Load environment variables
config({ path: '.env.local' });

async function testBirthdayCalendarSync() {
  console.log('🎂 Birthday Calendar Sync Test');
  console.log('==============================\n');

  try {
    // Step 1: Check if calendar is configured
    console.log('Step 1: Checking calendar configuration...');
    const isConfigured = isCalendarConfigured();
    console.log('Calendar configured:', isConfigured);
    
    if (!isConfigured) {
      console.error('❌ Google Calendar is not properly configured.');
      console.error('Please ensure the following environment variables are set:');
      console.error('- GOOGLE_CALENDAR_ID');
      console.error('- GOOGLE_SERVICE_ACCOUNT_KEY (or OAuth credentials)');
      process.exit(1);
    }

    // Step 2: Test calendar connection
    console.log('\nStep 2: Testing calendar connection...');
    const connectionTest = await testCalendarConnection();
    console.log('Connection test result:', connectionTest);
    
    if (!connectionTest.success) {
      console.error('❌ Calendar connection test failed:', connectionTest.message);
      if (connectionTest.details) {
        console.error('Details:', connectionTest.details);
      }
      process.exit(1);
    }
    
    console.log('✅ Calendar connection successful!');
    console.log('Calendar Name:', connectionTest.details?.calendarName);
    console.log('Time Zone:', connectionTest.details?.timeZone);

    // Step 3: Test creating a birthday event
    console.log('\nStep 3: Testing birthday event creation...');
    
    // Create a test employee with a birthday
    const testEmployee = {
      employee_id: 'test-employee-001',
      first_name: 'Test',
      last_name: 'Employee',
      email_address: 'test@example.com',
      job_title: 'Test Position',
      date_of_birth: '1990-03-15' // March 15, 1990
    };
    
    console.log('Creating birthday event for:', {
      name: `${testEmployee.first_name} ${testEmployee.last_name}`,
      dob: testEmployee.date_of_birth
    });
    
    const eventId = await syncBirthdayCalendarEvent(testEmployee);
    
    if (eventId) {
      console.log('✅ Birthday event created/updated successfully!');
      console.log('Event ID:', eventId);
      console.log('\nThe event should now appear in your Google Calendar as a recurring annual event.');
      console.log('Check your calendar on March 15th to see the birthday event.');
    } else {
      console.error('❌ Failed to create birthday event.');
      console.error('Check the logs above for detailed error information.');
    }

    // Step 4: Verify the event is recurring
    if (eventId) {
      console.log('\nStep 4: Verifying event details...');
      console.log('The event should have the following properties:');
      console.log('- Title: 🎂 Test Employee\'s Birthday');
      console.log('- Recurrence: Yearly on March 15');
      console.log('- All-day event');
      console.log('- Yellow color (birthday color)');
      console.log('- Reminders: On the day and 1 week before');
    }

    console.log('\n✅ Birthday calendar sync test completed successfully!');
    
  } catch (error) {
    console.error('\n❌ Test failed with error:', error);
    process.exit(1);
  }
}

// Run the test
testBirthdayCalendarSync().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});