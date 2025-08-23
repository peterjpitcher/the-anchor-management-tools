#!/usr/bin/env tsx

import { config } from 'dotenv'
import path from 'path'
import fs from 'fs'

// Load environment variables
config({ path: path.resolve(process.cwd(), '.env.local') })

console.log('=== Fixing Google Calendar Authentication Issue ===\n')

console.log('The issue appears to be related to Node.js v22 compatibility with the Google auth library.')
console.log('This is a known issue with certain cryptographic operations in Node.js v22.\n')

console.log('Solutions:\n')

console.log('1. **Quick Fix - Downgrade Node.js (Recommended for now):**')
console.log('   If possible, use Node.js v20 LTS instead of v22:')
console.log('   - Install nvm: curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash')
console.log('   - Install Node v20: nvm install 20')
console.log('   - Use Node v20: nvm use 20')
console.log('   - Restart your dev server: npm run dev\n')

console.log('2. **Alternative - Use OAuth2 instead of Service Account:**')
console.log('   Set up OAuth2 credentials in Google Cloud Console and use refresh tokens.')
console.log('   This method works with Node.js v22.\n')

console.log('3. **Production Environment:**')
console.log('   Check what Node.js version Vercel is using in production.')
console.log('   You can specify the Node.js version in package.json:')
console.log('   "engines": { "node": "20.x" }\n')

console.log('4. **Temporary Workaround:**')
console.log('   You can disable calendar sync temporarily by removing GOOGLE_CALENDAR_ID')
console.log('   from your environment variables. The app will continue to work without')
console.log('   calendar integration.\n')

// Check if we can create a compatibility patch
console.log('Checking current Node.js version:')
console.log(`Current version: ${process.version}`)

if (process.version.startsWith('v22')) {
  console.log('\n⚠️  You are running Node.js v22, which has known compatibility issues with')
  console.log('the Google auth library\'s cryptographic operations.')
  console.log('\nThe calendar sync will likely fail until you switch to Node.js v20.')
} else {
  console.log('\n✓ You are running a compatible Node.js version.')
}

// Test if the issue persists
async function testAuth() {
  try {
    const { google } = require('googleapis')
    const serviceAccountStr = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
    
    if (serviceAccountStr) {
      const serviceAccount = JSON.parse(serviceAccountStr)
      const auth = new google.auth.GoogleAuth({
        credentials: serviceAccount,
        scopes: ['https://www.googleapis.com/auth/calendar']
      })
      
      console.log('\nTesting authentication...')
      // This will trigger the error if it exists
      await auth.getClient()
      console.log('✓ Authentication test passed!')
    }
  } catch (error: any) {
    if (error.message?.includes('DECODER routines::unsupported')) {
      console.log('\n❌ Confirmed: The cryptographic error is present.')
      console.log('   Please use one of the solutions above.')
    } else {
      console.log('\n❌ Different error encountered:', error.message)
    }
  }
}

testAuth().catch(console.error)

console.log('\n=== Next Steps ===')
console.log('1. Switch to Node.js v20 using nvm')
console.log('2. Restart your development server')
console.log('3. Try creating a private booking again')
console.log('4. Check if calendar events are created successfully')