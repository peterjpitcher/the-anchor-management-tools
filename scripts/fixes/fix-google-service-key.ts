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

console.log('\n=== Google Service Account Key Fixer ===\n')

if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
  console.log('✗ GOOGLE_SERVICE_ACCOUNT_KEY not found in environment')
  process.exit(1)
}

const keyString = process.env.GOOGLE_SERVICE_ACCOUNT_KEY

// Parse the JSON
let serviceAccount: any
try {
  serviceAccount = JSON.parse(keyString)
  console.log('✓ Successfully parsed service account JSON')
} catch (error) {
  console.log('✗ Failed to parse service account JSON:', error)
  process.exit(1)
}

// Fix the private key by converting escaped newlines to actual newlines
if (serviceAccount.private_key) {
  console.log('\nOriginal private key stats:')
  console.log('- Length:', serviceAccount.private_key.length)
  console.log('- Line count:', serviceAccount.private_key.split('\n').length)
  
  // Convert \n to actual newlines
  const fixedPrivateKey = serviceAccount.private_key.replace(/\\n/g, '\n')
  
  console.log('\nFixed private key stats:')
  console.log('- Length:', fixedPrivateKey.length)
  console.log('- Line count:', fixedPrivateKey.split('\n').length)
  
  // Update the service account object
  serviceAccount.private_key = fixedPrivateKey
  
  // Convert back to JSON string for .env.local
  const fixedJson = JSON.stringify(serviceAccount)
  
  console.log('\n✓ Fixed service account key generated!')
  console.log('\nTo fix your .env.local file:')
  console.log('1. Open .env.local in your editor')
  console.log('2. Replace the entire GOOGLE_SERVICE_ACCOUNT_KEY line with the following:')
  console.log('\n' + '='.repeat(80))
  console.log('GOOGLE_SERVICE_ACCOUNT_KEY=' + fixedJson)
  console.log('='.repeat(80) + '\n')
  
  // Test the fixed key
  console.log('Testing the fixed key...')
  const { google } = require('googleapis')
  
  try {
    const auth = new google.auth.GoogleAuth({
      credentials: serviceAccount,
      scopes: ['https://www.googleapis.com/auth/calendar']
    })
    
    console.log('✓ GoogleAuth instance created with fixed key')
    
    auth.getClient().then((client: any) => {
      console.log('✓ Auth client obtained successfully!')
      console.log('\nThe fixed key should work! Update your .env.local file with the output above.')
    }).catch((error: any) => {
      console.log('✗ Authentication still failed:', error.message)
      if (error.message.includes('ERR_OSSL_UNSUPPORTED')) {
        console.log('\nThe key format might still have issues. Try the alternative fix below.')
      }
    })
  } catch (error: any) {
    console.log('✗ Failed to create auth instance:', error.message)
  }
  
  // Alternative approach - save to a file
  console.log('\nAlternatively, you can use the service account JSON file directly:')
  const outputPath = path.join(process.cwd(), 'google-service-account-fixed.json')
  fs.writeFileSync(outputPath, JSON.stringify(serviceAccount, null, 2))
  console.log(`✓ Fixed service account saved to: ${outputPath}`)
  console.log('\nTo use the file instead of environment variable:')
  console.log('1. Update your .env.local to use the file path:')
  console.log(`   GOOGLE_APPLICATION_CREDENTIALS=${outputPath}`)
  console.log('2. Or convert it back to a single-line JSON for the environment variable')
  
} else {
  console.log('✗ No private_key field found in the service account')
}