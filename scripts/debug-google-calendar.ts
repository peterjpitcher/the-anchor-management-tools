#!/usr/bin/env tsx

import { isCalendarConfigured } from '@/lib/google-calendar'
import { config } from 'dotenv'
import path from 'path'

// Load environment variables
config({ path: path.resolve(process.cwd(), '.env.local') })

console.log('=== Google Calendar Configuration Debug ===\n')

// Check environment variables
console.log('1. Environment Variables Check:')
console.log('   GOOGLE_CALENDAR_ID:', process.env.GOOGLE_CALENDAR_ID ? `✓ Set (${process.env.GOOGLE_CALENDAR_ID})` : '✗ Not set')
console.log('   GOOGLE_SERVICE_ACCOUNT_KEY:', process.env.GOOGLE_SERVICE_ACCOUNT_KEY ? '✓ Set' : '✗ Not set')
console.log('   GOOGLE_CLIENT_ID:', process.env.GOOGLE_CLIENT_ID ? '✓ Set' : '✗ Not set')
console.log('   GOOGLE_CLIENT_SECRET:', process.env.GOOGLE_CLIENT_SECRET ? '✓ Set' : '✗ Not set')
console.log('   GOOGLE_REFRESH_TOKEN:', process.env.GOOGLE_REFRESH_TOKEN ? '✓ Set' : '✗ Not set')
console.log('')

// Check if calendar is configured
console.log('2. Calendar Configuration Status:')
console.log('   isCalendarConfigured():', isCalendarConfigured() ? '✓ Yes' : '✗ No')
console.log('')

// Try to parse service account key if present
if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
  console.log('3. Service Account Key Validation:')
  try {
    const serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY)
    console.log('   ✓ Valid JSON')
    console.log('   Type:', serviceAccount.type || 'Not specified')
    console.log('   Project ID:', serviceAccount.project_id || 'Not specified')
    console.log('   Client Email:', serviceAccount.client_email || 'Not specified')
    console.log('   Private Key:', serviceAccount.private_key ? '✓ Present' : '✗ Missing')
    console.log('   Private Key ID:', serviceAccount.private_key_id ? '✓ Present' : '✗ Missing')
  } catch (error) {
    console.log('   ✗ Invalid JSON:', error instanceof Error ? error.message : 'Unknown error')
    console.log('   Tip: Make sure the entire JSON is on one line with escaped newlines (\\n)')
  }
  console.log('')
}

// Check calendar ID format
if (process.env.GOOGLE_CALENDAR_ID) {
  console.log('4. Calendar ID Format Check:')
  const calendarId = process.env.GOOGLE_CALENDAR_ID
  
  if (calendarId === 'primary') {
    console.log('   ✓ Using primary calendar')
  } else if (calendarId.includes('@')) {
    if (calendarId.endsWith('@group.calendar.google.com')) {
      console.log('   ✓ Valid calendar ID format (group calendar)')
    } else if (calendarId.includes('@gmail.com') || calendarId.includes('@googlemail.com')) {
      console.log('   ✓ Valid calendar ID format (user calendar)')
    } else {
      console.log('   ⚠️  Unusual calendar ID format, but might still be valid')
    }
  } else {
    console.log('   ⚠️  Calendar ID doesn\'t look like an email address')
    console.log('   Expected format: either "primary" or "calendar-id@group.calendar.google.com"')
  }
  console.log('')
}

// Provide setup instructions if not configured
if (!isCalendarConfigured()) {
  console.log('=== Setup Instructions ===\n')
  console.log('To enable Google Calendar integration, you need either:')
  console.log('')
  console.log('Option 1: Service Account (Recommended for server-to-server):')
  console.log('1. Create a service account in Google Cloud Console')
  console.log('2. Download the JSON key file')
  console.log('3. Convert it to a single line: cat key.json | jq -c . | pbcopy')
  console.log('4. Add to .env.local: GOOGLE_SERVICE_ACCOUNT_KEY=<paste here>')
  console.log('5. Set GOOGLE_CALENDAR_ID to your calendar ID or "primary"')
  console.log('6. Share your calendar with the service account email (with "Make changes to events" permission)')
  console.log('')
  console.log('Option 2: OAuth2 (For user-specific calendars):')
  console.log('1. Set up OAuth2 credentials in Google Cloud Console')
  console.log('2. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN')
  console.log('3. Set GOOGLE_CALENDAR_ID to your calendar ID or "primary"')
}

console.log('\n=== Common Issues ===\n')
console.log('1. "Calendar not found" - Make sure the calendar ID is correct')
console.log('2. "Permission denied" - Share the calendar with the service account email')
console.log('3. "Invalid JSON" - Ensure the service account key is properly escaped')
console.log('4. Events not appearing - Check that events are being created in the correct calendar')
console.log('5. Wrong timezone - Events are created in Europe/London timezone by default')

process.exit(0)