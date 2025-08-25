#!/usr/bin/env tsx

/**
 * Utility script to format Google Service Account JSON for use in environment variables
 * 
 * Usage:
 *   tsx scripts/format-google-service-account.ts path/to/service-account-key.json
 * 
 * Or pipe the JSON:
 *   cat service-account-key.json | tsx scripts/format-google-service-account.ts
 */

import { readFileSync } from 'fs'
import { formatServiceAccountForEnv } from '@/lib/google-calendar'

async function main() {
  try {
    let jsonContent: string

    // Check if input is piped
    if (!process.stdin.isTTY) {
      console.log('Reading from stdin...')
      jsonContent = ''
      
      process.stdin.setEncoding('utf8')
      
      for await (const chunk of process.stdin) {
        jsonContent += chunk
      }
    } else if (process.argv[2]) {
      // Read from file path
      const filePath = process.argv[2]
      console.log(`Reading from file: ${filePath}`)
      jsonContent = readFileSync(filePath, 'utf8')
    } else {
      console.error('Usage: tsx scripts/format-google-service-account.ts <path-to-service-account-key.json>')
      console.error('Or pipe the JSON: cat service-account-key.json | tsx scripts/format-google-service-account.ts')
      process.exit(1)
    }

    // Format the service account key
    formatServiceAccountForEnv(jsonContent)

    console.log('\n✅ Successfully formatted service account key!')
    console.log('\nNext steps:')
    console.log('1. Copy the GOOGLE_SERVICE_ACCOUNT_KEY line above')
    console.log('2. Paste it into your .env.local file')
    console.log('3. Also add your GOOGLE_CALENDAR_ID to .env.local')
    console.log('4. Restart your development server')

  } catch (error) {
    console.error('\n❌ Error formatting service account key:', error)
    console.error('\nCommon issues:')
    console.error('- Make sure the file contains valid JSON')
    console.error('- Ensure you downloaded the correct service account key from Google Cloud Console')
    console.error('- The file should have a "type": "service_account" field')
    process.exit(1)
  }
}

main()