#!/usr/bin/env tsx

/**
 * Script to test template loading against production
 */

import { config } from 'dotenv'
import { resolve } from 'path'

// Load environment variables
config({ path: resolve(__dirname, '../.env.local') })

const PRODUCTION_URL = 'https://management.orangejelly.co.uk'

async function testProductionTemplates() {
  console.log('🧪 Testing template loading in production...\n')

  try {
    // Test the debug endpoint
    const tests = [
      { type: 'bookingConfirmation', description: 'Booking with seats' },
      { type: 'reminderOnly', description: 'Reminder only (0 seats)' }
    ]

    for (const test of tests) {
      console.log(`\n📋 Testing ${test.description} (${test.type})...`)
      
      const response = await fetch(`${PRODUCTION_URL}/api/debug/test-template?type=${test.type}`)
      
      if (!response.ok) {
        console.error(`❌ Request failed: ${response.status} ${response.statusText}`)
        continue
      }

      const data = await response.json()
      
      console.log('\nDebug info:')
      console.log('- Template type:', data.debug?.templateType)
      console.log('- Mapped type:', data.debug?.mappedType)
      console.log('- Environment vars present:', data.debug?.envVarsPresent)
      
      console.log('\nRPC Result:')
      if (data.rpcResult?.success) {
        console.log('✅ RPC succeeded')
        console.log('- Content:', data.rpcResult.data?.content?.substring(0, 50) + '...')
      } else {
        console.log('❌ RPC failed:', data.rpcResult?.error)
      }
      
      console.log('\nTemplate Function Result:')
      if (data.templateFunctionResult?.success) {
        console.log('✅ Template function succeeded')
        console.log('- Result:', data.templateFunctionResult.result?.substring(0, 50) + '...')
      } else {
        console.log('❌ Template function failed')
      }
      
      console.log('\nAvailable Templates:')
      if (data.availableTemplates?.length > 0) {
        data.availableTemplates.forEach(t => {
          console.log(`- ${t.name} (default: ${t.is_default}, active: ${t.is_active})`)
        })
      } else {
        console.log('❌ No templates found')
      }
    }

    console.log('\n\n💡 Check the Vercel function logs for detailed debug output')
    console.log('   The logs will show exactly what\'s happening during template lookup')

  } catch (error) {
    console.error('❌ Error testing production:', error)
  }
}

// Run the test
testProductionTemplates()