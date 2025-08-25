#!/usr/bin/env tsx

import { config } from 'dotenv'
import path from 'path'
import crypto from 'crypto'

// Load environment variables
config({ path: path.resolve(process.cwd(), '.env.local') })

function validateServiceAccountKey() {
  console.log('=== Validating Google Service Account Key ===\n')

  const serviceAccountKeyStr = process.env.GOOGLE_SERVICE_ACCOUNT_KEY

  if (!serviceAccountKeyStr) {
    console.log('❌ GOOGLE_SERVICE_ACCOUNT_KEY is not set in environment variables')
    return
  }

  try {
    console.log('1. Parsing JSON...')
    const serviceAccount = JSON.parse(serviceAccountKeyStr)
    console.log('   ✓ JSON is valid')
    console.log('')

    console.log('2. Checking required fields:')
    const requiredFields = ['type', 'project_id', 'private_key_id', 'private_key', 'client_email', 'client_id', 'auth_uri', 'token_uri']
    let allFieldsPresent = true
    
    for (const field of requiredFields) {
      if (serviceAccount[field]) {
        console.log(`   ✓ ${field}: Present`)
      } else {
        console.log(`   ✗ ${field}: Missing`)
        allFieldsPresent = false
      }
    }
    console.log('')

    if (!allFieldsPresent) {
      console.log('❌ Some required fields are missing')
      return
    }

    console.log('3. Validating private key format:')
    const privateKey = serviceAccount.private_key
    
    // Check if private key has proper format
    if (!privateKey.includes('-----BEGIN PRIVATE KEY-----') || !privateKey.includes('-----END PRIVATE KEY-----')) {
      console.log('   ✗ Private key does not have proper BEGIN/END markers')
      return
    }
    console.log('   ✓ Private key has proper BEGIN/END markers')

    // Check for proper newline escaping
    const newlineCount = (privateKey.match(/\\n/g) || []).length
    console.log(`   ✓ Found ${newlineCount} escaped newlines in private key`)

    // Try to create a sign object with the private key
    console.log('')
    console.log('4. Testing private key cryptography:')
    try {
      const sign = crypto.createSign('RSA-SHA256')
      sign.update('test')
      
      // Replace escaped newlines with actual newlines for crypto operations
      const cleanPrivateKey = privateKey.replace(/\\n/g, '\n')
      sign.end()
      const signature = sign.sign(cleanPrivateKey)
      
      console.log('   ✓ Private key is valid for cryptographic operations')
      console.log(`   ✓ Generated test signature: ${signature.toString('base64').substring(0, 20)}...`)
    } catch (cryptoError: any) {
      console.log('   ✗ Private key validation failed:', cryptoError.message)
      console.log('')
      console.log('   Common causes:')
      console.log('   - Private key is corrupted or incomplete')
      console.log('   - Private key encoding is incorrect')
      console.log('   - The key was not properly converted to single-line format')
      console.log('')
      console.log('   Solution:')
      console.log('   1. Download a fresh service account key from Google Cloud Console')
      console.log('   2. Use the format script: tsx scripts/format-google-service-account.ts <key-file>')
      console.log('   3. Copy the formatted output to your .env.local file')
    }

    console.log('')
    console.log('5. Service account details:')
    console.log(`   Email: ${serviceAccount.client_email}`)
    console.log(`   Project: ${serviceAccount.project_id}`)
    console.log(`   Key ID: ${serviceAccount.private_key_id}`)

  } catch (error: any) {
    console.log('❌ Error validating service account key:', error.message)
    console.log('')
    console.log('Make sure the GOOGLE_SERVICE_ACCOUNT_KEY is properly formatted as a single line with escaped newlines')
  }
}

validateServiceAccountKey()