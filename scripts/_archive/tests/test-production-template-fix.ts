#!/usr/bin/env tsx

/**
 * Test SMS template loading fix in production
 */

import { config } from 'dotenv'
import { resolve } from 'path'

// Load environment variables
config({ path: resolve(__dirname, '../.env.local') })

const PRODUCTION_URL = 'https://management.orangejelly.co.uk'

async function testProductionTemplateFix() {
  console.log('🧪 Testing SMS template fix in production...\n')

  try {
    // Test 1: Test with undefined eventId (most common issue)
    console.log('Test 1: Debug endpoint with reminderOnly template')
    console.log('================================================')
    
    const response1 = await fetch(`${PRODUCTION_URL}/api/debug/test-template?type=reminderOnly`)
    
    if (!response1.ok) {
      console.error(`❌ Request failed: ${response1.status} ${response1.statusText}`)
    } else {
      const data1 = await response1.json()
      
      console.log('Template Function Result:')
      if (data1.templateFunctionResult?.success) {
        console.log('✅ Template loaded successfully')
        console.log('Result:', data1.templateFunctionResult.result)
      } else {
        console.log('❌ Template loading failed')
      }
    }
    
    console.log('\n')
    
    // Test 2: Test booking confirmation
    console.log('Test 2: Debug endpoint with bookingConfirmation template')
    console.log('=======================================================')
    
    const response2 = await fetch(`${PRODUCTION_URL}/api/debug/test-template?type=bookingConfirmation`)
    
    if (!response2.ok) {
      console.error(`❌ Request failed: ${response2.status} ${response2.statusText}`)
    } else {
      const data2 = await response2.json()
      
      console.log('Template Function Result:')
      if (data2.templateFunctionResult?.success) {
        console.log('✅ Template loaded successfully')
        console.log('Result:', data2.templateFunctionResult.result)
      } else {
        console.log('❌ Template loading failed')
      }
    }
    
    console.log('\n💡 Note: Once deployed, the system will use your database templates instead of hard-coded ones.')
    console.log('   The fix handles cases where no event context is available (like from customer pages).')
    
  } catch (error) {
    console.error('❌ Error testing production:', error)
  }
}

// Run the test
testProductionTemplateFix()