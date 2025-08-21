#!/usr/bin/env tsx

/**
 * Script to delete all customers with 'test' in their first or last name
 * Run with: tsx scripts/delete-test-customers-direct.ts
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { resolve } from 'path'

// Load environment variables
dotenv.config({ path: resolve(process.cwd(), '.env.local') })

if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  console.error('❌ Missing NEXT_PUBLIC_SUPABASE_URL environment variable')
  process.exit(1)
}

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing SUPABASE_SERVICE_ROLE_KEY environment variable')
  process.exit(1)
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
)

async function deleteTestCustomers() {
  console.log('🔍 Starting deletion of test customers...')
  console.log('Looking for customers with "test" in first or last name (case-insensitive)\n')

  try {
    // Find all customers with 'test' in first or last name (case-insensitive)
    const { data: testCustomers, error: fetchError } = await supabase
      .from('customers')
      .select('id, first_name, last_name')
      .or('first_name.ilike.%test%,last_name.ilike.%test%')

    if (fetchError) {
      console.error('❌ Error fetching test customers:', fetchError)
      return
    }

    if (!testCustomers || testCustomers.length === 0) {
      console.log('✅ No test customers found')
      return
    }

    console.log(`📊 Found ${testCustomers.length} test customer(s) to delete:\n`)
    testCustomers.forEach(customer => {
      console.log(`  - ${customer.first_name} ${customer.last_name || ''} (ID: ${customer.id})`)
    })

    console.log('\n⚠️  This will permanently delete these customers and all their associated data.')
    console.log('Press Ctrl+C to cancel, or wait 5 seconds to continue...\n')

    // Wait 5 seconds to give user time to cancel
    await new Promise(resolve => setTimeout(resolve, 5000))

    const deletedCustomers = []
    const failedDeletions = []

    for (const customer of testCustomers) {
      // Delete customer (bookings will cascade delete due to foreign key constraints)
      const { error: deleteError } = await supabase
        .from('customers')
        .delete()
        .eq('id', customer.id)

      if (deleteError) {
        console.error(`❌ Failed to delete ${customer.first_name} ${customer.last_name}:`, deleteError.message)
        failedDeletions.push({
          ...customer,
          error: deleteError.message
        })
      } else {
        console.log(`✅ Deleted: ${customer.first_name} ${customer.last_name || ''}`)
        deletedCustomers.push(customer)

        // Log to audit_logs table
        await supabase
          .from('audit_logs')
          .insert({
            user_id: 'system-script',
            user_email: 'script@system',
            operation_type: 'delete',
            resource_type: 'customer',
            resource_id: customer.id,
            operation_status: 'success',
            old_values: customer,
            details: { 
              reason: 'Bulk deletion of test customers via script',
              script: 'delete-test-customers-direct.ts'
            }
          })
      }
    }

    // Log summary
    console.log('\n' + '='.repeat(50))
    console.log('📋 SUMMARY')
    console.log('='.repeat(50))
    console.log(`✅ Successfully deleted: ${deletedCustomers.length} customer(s)`)
    
    if (failedDeletions.length > 0) {
      console.log(`❌ Failed to delete: ${failedDeletions.length} customer(s)`)
      console.log('\nFailed deletions:')
      failedDeletions.forEach(failure => {
        console.log(`  - ${failure.first_name} ${failure.last_name || ''} (${failure.error})`)
      })
    }

    console.log('\n✨ Operation complete. All changes have been logged to the audit trail.')

  } catch (error) {
    console.error('❌ Unexpected error:', error)
    process.exit(1)
  }
}

// Run the script
deleteTestCustomers().catch(console.error)