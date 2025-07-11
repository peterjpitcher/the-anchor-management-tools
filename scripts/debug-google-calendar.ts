#!/usr/bin/env tsx

import * as fs from 'fs'
import * as path from 'path'
import { config } from 'dotenv'
import { google } from 'googleapis'

// Load environment variables
const envPath = path.resolve(process.cwd(), '.env.local')
if (fs.existsSync(envPath)) {
  config({ path: envPath })
  console.log('✓ Loaded .env.local')
} else {
  console.log('✗ .env.local not found')
  process.exit(1)
}

console.log('\n=== Google Calendar Debug Script ===\n')

// Check Node.js version
console.log('Node.js version:', process.version)
console.log('Node.js OpenSSL version:', process.versions.openssl)

// Check environment variables
console.log('\n1. Checking environment variables:')
console.log('   GOOGLE_CALENDAR_ID:', process.env.GOOGLE_CALENDAR_ID ? '✓ Set' : '✗ Not set')
console.log('   GOOGLE_SERVICE_ACCOUNT_KEY:', process.env.GOOGLE_SERVICE_ACCOUNT_KEY ? '✓ Set' : '✗ Not set')

if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
  console.log('\n✗ GOOGLE_SERVICE_ACCOUNT_KEY not found in environment')
  process.exit(1)
}

// Analyze the service account key
console.log('\n2. Analyzing service account key:')
const keyString = process.env.GOOGLE_SERVICE_ACCOUNT_KEY

// Check key format
console.log('   Key length:', keyString.length, 'characters')
console.log('   Starts with {:', keyString.startsWith('{'))
console.log('   Ends with }:', keyString.endsWith('}'))

// Check for common issues
const hasLiteralNewlines = keyString.includes('\n')
const hasEscapedNewlines = keyString.includes('\\n')
console.log('   Contains literal newlines (\\n):', hasLiteralNewlines)
console.log('   Contains escaped newlines (\\\\n):', hasEscapedNewlines)

// Try parsing the key
let serviceAccount: any = null
let parseError: string | null = null

try {
  serviceAccount = JSON.parse(keyString)
  console.log('\n3. Successfully parsed service account JSON')
} catch (error: any) {
  parseError = error.message
  console.log('\n3. Failed to parse service account JSON:', error.message)
  
  // Try to extract and examine the private key
  const privateKeyMatch = keyString.match(/"private_key"\s*:\s*"([^"]+)"/s)
  if (privateKeyMatch) {
    const privateKey = privateKeyMatch[1]
    console.log('\n   Extracted private key details:')
    console.log('   - Length:', privateKey.length)
    console.log('   - Has BEGIN header:', privateKey.includes('BEGIN'))
    console.log('   - Has END footer:', privateKey.includes('END'))
    console.log('   - Contains literal \\n:', privateKey.includes('\n'))
    console.log('   - Contains escaped \\\\n:', privateKey.includes('\\n'))
  }
}

// If parsing succeeded, analyze the service account
if (serviceAccount) {
  console.log('\n4. Service account details:')
  console.log('   Type:', serviceAccount.type)
  console.log('   Project ID:', serviceAccount.project_id)
  console.log('   Private key ID:', serviceAccount.private_key_id)
  console.log('   Client email:', serviceAccount.client_email)
  console.log('   Client ID:', serviceAccount.client_id)
  console.log('   Auth URI:', serviceAccount.auth_uri)
  console.log('   Token URI:', serviceAccount.token_uri)
  console.log('   Auth provider:', serviceAccount.auth_provider_x509_cert_url)
  console.log('   Client cert URL:', serviceAccount.client_x509_cert_url)
  
  // Analyze private key
  if (serviceAccount.private_key) {
    const privateKey = serviceAccount.private_key
    console.log('\n5. Private key analysis:')
    console.log('   Length:', privateKey.length, 'characters')
    console.log('   Starts with BEGIN:', privateKey.startsWith('-----BEGIN'))
    console.log('   Ends with END:', privateKey.endsWith('-----\n') || privateKey.endsWith('-----'))
    console.log('   Line count:', privateKey.split('\n').length)
    
    // Check if key has proper newlines
    const lines = privateKey.split('\n')
    console.log('   First line:', lines[0])
    console.log('   Last line:', lines[lines.length - 1] || lines[lines.length - 2])
  } else {
    console.log('\n5. ✗ No private_key field found')
  }
  
  // Try to authenticate
  console.log('\n6. Attempting authentication:')
  ;(async () => {
    try {
      const auth = new google.auth.GoogleAuth({
        credentials: serviceAccount,
        scopes: ['https://www.googleapis.com/auth/calendar']
      })
      
      console.log('   ✓ GoogleAuth instance created')
      
      const client = await auth.getClient()
      console.log('   ✓ Auth client obtained')
      
      // Try to get an access token
      const accessToken = await client.getAccessToken()
      console.log('   ✓ Access token obtained:', accessToken.token ? 'Yes' : 'No')
      
      // Try to access calendar
      const calendar = google.calendar({ version: 'v3', auth: client })
      const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary'
      
      console.log('\n7. Testing calendar access:')
      console.log('   Calendar ID:', calendarId)
      
      try {
        const response = await calendar.calendars.get({ calendarId })
        console.log('   ✓ Calendar accessed successfully')
        console.log('   Calendar name:', response.data.summary)
        console.log('   Time zone:', response.data.timeZone)
      } catch (calError: any) {
        console.log('   ✗ Calendar access failed:', calError.message)
        if (calError.code === 404) {
          console.log('   → Calendar not found. Check GOOGLE_CALENDAR_ID')
        } else if (calError.code === 403) {
          console.log('   → Permission denied. Share calendar with:', serviceAccount.client_email)
        }
      }
      
    } catch (authError: any) {
      console.log('   ✗ Authentication failed:', authError.message)
      console.log('\n   Error details:')
      console.log('   Code:', authError.code)
      console.log('   Stack:', authError.stack?.split('\n').slice(0, 5).join('\n'))
      
      if (authError.message.includes('ERR_OSSL_UNSUPPORTED')) {
        console.log('\n   ⚠️  ERR_OSSL_UNSUPPORTED detected!')
        console.log('   This usually means the private key format is incorrect.')
        console.log('   Common causes:')
        console.log('   - Missing or incorrect newline characters in the private key')
        console.log('   - Double-escaped newlines (\\\\n instead of \\n)')
        console.log('   - The key was corrupted during copy/paste')
      }
    }
  })().catch(console.error)
} else {
  console.log('\n4. Cannot analyze service account - parsing failed')
  console.log('\n   Attempting to fix common issues:')
  
  // Try different parsing strategies
  const strategies = [
    {
      name: 'Replace literal newlines',
      transform: (s: string) => s.replace(/\n/g, '\\n').replace(/\r/g, '\\r')
    },
    {
      name: 'Fix private key newlines',
      transform: (s: string) => {
        return s.replace(/"private_key"\s*:\s*"([^"]+)"/g, (match, key) => {
          const fixed = key.replace(/\n/g, '\\n').replace(/\r/g, '\\r')
          return `"private_key":"${fixed}"`
        })
      }
    },
    {
      name: 'Unescape double-escaped newlines',
      transform: (s: string) => s.replace(/\\\\n/g, '\\n')
    }
  ]
  
  for (const strategy of strategies) {
    console.log(`\n   Trying: ${strategy.name}`)
    try {
      const transformed = strategy.transform(keyString)
      const parsed = JSON.parse(transformed)
      console.log('   ✓ Success! This strategy works.')
      console.log('\n   To fix your .env.local, use this format:')
      console.log('   GOOGLE_SERVICE_ACCOUNT_KEY=' + transformed.substring(0, 100) + '...')
      break
    } catch (e) {
      console.log('   ✗ Failed')
    }
  }
}

console.log('\n=== End of debug script ===\n')