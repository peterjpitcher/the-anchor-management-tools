#!/usr/bin/env tsx
/**
 * Birthday calendar sync diagnostic (read-only).
 *
 * Safety:
 * - Strictly read-only; does not support `--confirm`.
 * - Does not create/update any calendar events.
 * - Fails closed on configuration/connection errors (non-zero exit).
 */

import { config } from 'dotenv'
import { testCalendarConnection, isCalendarConfigured } from '@/lib/google-calendar'

// Load environment variables
config({ path: '.env.local' })

const SCRIPT_NAME = 'test-birthday-calendar-sync'

type Args = {
  confirm: boolean
}

function parseArgs(argv: string[] = process.argv): Args {
  const rest = argv.slice(2)
  return { confirm: rest.includes('--confirm') }
}

async function testBirthdayCalendarSync() {
  const args = parseArgs(process.argv)
  if (args.confirm) {
    throw new Error(`[${SCRIPT_NAME}] This script is read-only and does not support --confirm`)
  }

  console.log(`[${SCRIPT_NAME}] read-only starting`)

  try {
    // Step 1: Check if calendar is configured
    console.log('Step 1: Checking calendar configuration...');
    const isConfigured = isCalendarConfigured();
    console.log('Calendar configured:', isConfigured);
    
    if (!isConfigured) {
      throw new Error(
        'Google Calendar is not properly configured. Ensure GOOGLE_CALENDAR_ID and GOOGLE_SERVICE_ACCOUNT_KEY (or OAuth credentials) are set.'
      )
    }

    // Step 2: Test calendar connection
    console.log('\nStep 2: Testing calendar connection...');
    const connectionTest = await testCalendarConnection();
    console.log('Connection test result:', connectionTest);
    
    if (!connectionTest.success) {
      throw new Error(`Calendar connection test failed: ${connectionTest.message}`)
    }
    
    console.log('Calendar connection successful.')
    console.log('Calendar Name:', connectionTest.details?.calendarName);
    console.log('Time Zone:', connectionTest.details?.timeZone);

    // Intentionally read-only: we do not attempt calendar writes from scripts.
    console.log('\nStep 3: Skipping birthday event creation (read-only)');
    console.log('This script does not create or update any calendar events.')
    console.log('If you need to validate birthday event creation, use a controlled non-script flow in the app.')
    console.log(`\n[${SCRIPT_NAME}] Completed successfully.`)
    
  } catch (error) {
    console.error(`\n[${SCRIPT_NAME}] Failed`, error)
    throw error
  }
}

// Run the test
testBirthdayCalendarSync().catch((error) => {
  console.error(`[${SCRIPT_NAME}] Fatal error`, error)
  process.exitCode = 1
})
