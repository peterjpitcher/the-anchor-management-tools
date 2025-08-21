#!/usr/bin/env tsx

/**
 * Script to delete specific customers by ID
 * Run with: tsx scripts/delete-specific-customers.ts
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

// List of customer IDs to delete (system/utility accounts)
const CUSTOMERS_TO_DELETE = [
  "dd5a6d12-d7e8-4d6a-a4e1-981d7a95af36", // Menu Storage
  "709bf1fd-c1bf-4120-8a3e-4c16f886a92c", // Unknown 3166
  "70c6def5-81c3-43d8-a1c4-73501ac04e5f", // Jane Smith (suspicious test account)
]

async function deleteSpecificCustomers() {
  console.log('🗑️  Starting deletion of non-real customer accounts...\n')

  try {
    // Fetch customer details for confirmation
    const { data: customersToDelete, error: fetchError } = await supabase
      .from('customers')
      .select('id, first_name, last_name, mobile_number')
      .in('id', CUSTOMERS_TO_DELETE)

    if (fetchError) {
      console.error('❌ Error fetching customers:', fetchError)
      return
    }

    if (!customersToDelete || customersToDelete.length === 0) {
      console.log('✅ No matching customers found to delete')
      return
    }

    console.log('📋 Customers to be deleted:')
    customersToDelete.forEach(customer => {
      console.log(`  - ${customer.first_name} ${customer.last_name || ''} (ID: ${customer.id})`)
      console.log(`    Phone: ${customer.mobile_number || 'None'}`)
    })

    console.log('\n⚠️  This will permanently delete these customers and all their associated data.')
    console.log('Press Ctrl+C to cancel, or wait 5 seconds to continue...\n')

    // Wait 5 seconds
    await new Promise(resolve => setTimeout(resolve, 5000))

    const deletedCustomers = []
    const failedDeletions = []

    for (const customer of customersToDelete) {
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
              reason: 'Deletion of non-real/system customer accounts',
              script: 'delete-specific-customers.ts',
              category: customer.first_name?.includes('Menu') ? 'system_account' : 
                       customer.first_name?.includes('Unknown') ? 'unknown_account' :
                       'suspicious_test_account'
            }
          })
      }
    }

    // Summary
    console.log('\n' + '='.repeat(50))
    console.log('📊 SUMMARY')
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
deleteSpecificCustomers().catch(console.error)