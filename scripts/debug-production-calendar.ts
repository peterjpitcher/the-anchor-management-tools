#!/usr/bin/env tsx

// This script helps debug Google Calendar issues in production
// Run locally with production env vars to test

import { config } from 'dotenv'
import * as path from 'path'

// Load environment variables
const envPath = path.resolve(process.cwd(), '.env.production')
config({ path: envPath })

console.log('=== Google Calendar Production Debug ===\n')

// 1. Check if calendar ID is set
const calendarId = process.env.GOOGLE_CALENDAR_ID
console.log('1. Calendar ID Check:')
console.log(`   Calendar ID: ${calendarId ? calendarId : 'NOT SET'}`)
console.log()

// 2. Check if service account key is set
const serviceAccountKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
console.log('2. Service Account Key Check:')
console.log(`   Key exists: ${serviceAccountKey ? 'YES' : 'NO'}`)
if (serviceAccountKey) {
  console.log(`   Key length: ${serviceAccountKey.length} characters`)
}
console.log()

// 3. Parse and validate service account key
if (serviceAccountKey) {
  try {
    const parsed = JSON.parse(serviceAccountKey)
    console.log('3. Service Account Details:')
    console.log(`   Type: ${parsed.type}`)
    console.log(`   Project ID: ${parsed.project_id}`)
    console.log(`   Client Email: ${parsed.client_email}`)
    console.log(`   Private Key ID: ${parsed.private_key_id}`)
    console.log(`   Has Private Key: ${!!parsed.private_key}`)
    console.log()
    
    // This is the email that needs calendar access!
    console.log('⚠️  IMPORTANT: The calendar must be shared with this email:')
    console.log(`   ${parsed.client_email}`)
    console.log()
    
    // 4. Test authentication
    console.log('4. Testing Authentication...')
    const { google } = require('googleapis')
    
    try {
      const auth = new google.auth.GoogleAuth({
        credentials: parsed,
        scopes: ['https://www.googleapis.com/auth/calendar']
      })
      
      const client = await auth.getClient()
      console.log('   ✓ Authentication successful!')
      console.log()
      
      // 5. Test calendar access
      if (calendarId) {
        console.log('5. Testing Calendar Access...')
        const calendar = google.calendar({ version: 'v3', auth: client })
        
        try {
          const response = await calendar.calendars.get({
            calendarId: calendarId
          })
          
          console.log('   ✓ Calendar found!')
          console.log(`   Calendar Name: ${response.data.summary}`)
          console.log(`   Time Zone: ${response.data.timeZone}`)
          console.log()
          
          // Try to list events to verify write access
          console.log('6. Testing Event Access...')
          const eventsResponse = await calendar.events.list({
            calendarId: calendarId,
            maxResults: 1
          })
          
          console.log('   ✓ Can read events!')
          console.log()
          
          console.log('✅ Everything looks good! Calendar integration should work.')
          
        } catch (calendarError: any) {
          console.log('   ✗ Calendar access failed!')
          console.log(`   Error: ${calendarError.message}`)
          console.log()
          
          if (calendarError.code === 404) {
            console.log('📋 TO FIX THIS:')
            console.log('1. Go to Google Calendar')
            console.log('2. Find the calendar with ID:')
            console.log(`   ${calendarId}`)
            console.log('3. Go to Settings and sharing')
            console.log('4. Under "Share with specific people", add:')
            console.log(`   ${parsed.client_email}`)
            console.log('5. Grant "Make changes to events" permission')
            console.log('6. Click "Send"')
          }
        }
      }
      
    } catch (authError: any) {
      console.log('   ✗ Authentication failed!')
      console.log(`   Error: ${authError.message}`)
      
      if (authError.message.includes('PRIVATE KEY')) {
        console.log()
        console.log('📋 The private key format seems incorrect.')
        console.log('   Make sure the GOOGLE_SERVICE_ACCOUNT_KEY in production:')
        console.log('   - Has proper escaped newlines (\\n)')
        console.log('   - Is a single-line JSON string')
        console.log('   - Has "PRIVATE KEY" with a space')
      }
    }
    
  } catch (parseError) {
    console.log('3. ✗ Failed to parse service account key!')
    console.log('   The GOOGLE_SERVICE_ACCOUNT_KEY is not valid JSON.')
    console.log()
    console.log('📋 TO FIX THIS:')
    console.log('1. Make sure the key is properly formatted as a single-line JSON')
    console.log('2. Check that all quotes are properly escaped')
    console.log('3. Ensure newlines in the private key are escaped as \\n')
  }
} else {
  console.log('❌ No GOOGLE_SERVICE_ACCOUNT_KEY found!')
  console.log('   The service account key is missing from environment variables.')
}

console.log('\n=== Debug Complete ===')