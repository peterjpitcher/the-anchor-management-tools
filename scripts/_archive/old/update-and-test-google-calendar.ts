#!/usr/bin/env tsx

import * as fs from 'fs'
import * as path from 'path'
import { config } from 'dotenv'

// Load environment variables
const envPath = path.resolve(process.cwd(), '.env.local')
if (fs.existsSync(envPath)) {
  config({ path: envPath })
  console.log('✓ Loaded .env.local')
} else {
  console.log('✗ .env.local not found')
  process.exit(1)
}

console.log('\n=== Google Calendar Key Update and Test ===\n')

// Read the fixed service account JSON
const fixedKeyPath = path.join(process.cwd(), 'google-service-account-fixed.json')
if (!fs.existsSync(fixedKeyPath)) {
  console.log('✗ google-service-account-fixed.json not found')
  console.log('  Please make sure you have the fixed key file in your project root')
  process.exit(1)
}

console.log('✓ Found google-service-account-fixed.json')

// Read and parse the fixed key
const fixedKeyContent = fs.readFileSync(fixedKeyPath, 'utf8')
let serviceAccount: any
try {
  serviceAccount = JSON.parse(fixedKeyContent)
  console.log('✓ Successfully parsed fixed service account JSON')
} catch (error) {
  console.log('✗ Failed to parse fixed service account JSON:', error)
  process.exit(1)
}

// Convert to single-line JSON for .env.local
const singleLineJson = JSON.stringify(serviceAccount)
console.log('\n✓ Converted to single-line format for .env.local')

// Read current .env.local
const envContent = fs.readFileSync(envPath, 'utf8')
const lines = envContent.split('\n')

// Find and replace the GOOGLE_SERVICE_ACCOUNT_KEY line
let keyReplaced = false
const updatedLines = lines.map(line => {
  if (line.startsWith('GOOGLE_SERVICE_ACCOUNT_KEY=')) {
    keyReplaced = true
    return `GOOGLE_SERVICE_ACCOUNT_KEY=${singleLineJson}`
  }
  return line
})

// If key wasn't found, add it
if (!keyReplaced) {
  updatedLines.push(`GOOGLE_SERVICE_ACCOUNT_KEY=${singleLineJson}`)
  console.log('✓ Added GOOGLE_SERVICE_ACCOUNT_KEY to .env.local')
} else {
  console.log('✓ Updated GOOGLE_SERVICE_ACCOUNT_KEY in .env.local')
}

// Create backup of current .env.local
const backupPath = `${envPath}.backup-${Date.now()}`
fs.copyFileSync(envPath, backupPath)
console.log(`✓ Created backup: ${backupPath}`)

// Write updated .env.local
fs.writeFileSync(envPath, updatedLines.join('\n'))
console.log('✓ Updated .env.local with fixed key')

// Reload environment variables with the new key
delete process.env.GOOGLE_SERVICE_ACCOUNT_KEY
process.env.GOOGLE_SERVICE_ACCOUNT_KEY = singleLineJson
console.log('✓ Reloaded environment variables')

// Test the Google Calendar integration
console.log('\n=== Testing Google Calendar Integration ===\n')

import { testCalendarConnection } from '../src/lib/google-calendar'

;(async () => {
  try {
    const result = await testCalendarConnection()
    
    if (result.success) {
      console.log('✅ SUCCESS! Google Calendar is now working!')
      console.log('\nCalendar Details:')
      console.log('- Calendar Name:', result.details?.calendarName)
      console.log('- Time Zone:', result.details?.timeZone)
      console.log('\nGoogle Calendar integration is ready to use!')
      console.log('Private bookings will now sync to your calendar automatically.')
    } else {
      console.log('❌ Google Calendar test failed')
      console.log('Error:', result.message)
      if (result.details) {
        console.log('Details:', JSON.stringify(result.details, null, 2))
      }
      
      if (result.message.includes('Permission denied')) {
        console.log('\n📝 To fix this:')
        console.log('1. Go to Google Calendar')
        console.log('2. Find your calendar and click "Settings and sharing"')
        console.log('3. Under "Share with specific people", add:', serviceAccount.client_email)
        console.log('4. Grant "Make changes to events" permission')
      }
    }
  } catch (error: any) {
    console.log('❌ Test failed with error:', error.message)
    console.log('\nFull error:', error)
  }
})()