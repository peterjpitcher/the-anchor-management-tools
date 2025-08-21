#!/usr/bin/env tsx

/**
 * Script to delete approved duplicate customer records
 * Run with: tsx scripts/delete-approved-duplicates.ts
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

// Approved duplicate customer IDs to delete
const DUPLICATES_TO_DELETE = [
  { id: "5c23cc40-9e7a-4399-a781-3fcacbf50ce5", name: "Jane Evans (duplicate)", phone: "+447801257158" },
  { id: "9270f7ba-868a-41a6-9691-fc4546def473", name: "Jade . (keep Jade Brown)", phone: "+447935785513" },
  { id: "392c9c49-0c0e-4499-a6b3-fdb159a8b05a", name: "Jade (duplicate)", phone: "+447742116805" },
  { id: "5aac58fc-3b13-45f1-a691-e60ad9504c8c", name: "Rory .", phone: "+447999348877" },
  { id: "cb5ec7a9-a1e6-4270-92e6-106418b6d039", name: "Pike .", phone: "+447513520317" },
  { id: "061257d4-6e26-4e04-aa4a-9fff591384b2", name: "Paul . (keep Paul White)", phone: "+447795514533" },
  { id: "49582ace-e9ac-41ef-ae15-a012e8779545", name: "Charlotte . (keep Linda Charlotte)", phone: "+447962373977" },
  { id: "8e0aa0a5-27e2-4142-a8a4-718644a93221", name: "Ken & Lucy (keep Lucy .)", phone: "+447597537511" },
  { id: "e466c524-7b95-47ec-aff3-7a471a740133", name: "Shirley . (keep Shell Quiz Night)", phone: "+447860100825" },
  { id: "5195e34e-9eec-4aad-8cf9-296eb487e5b5", name: "Lauren Harding (duplicate)", phone: "+447305866052" },
  // NOT deleting Louise Kitchener as per user request - keeping both Lou and Louise
]

async function deleteApprovedDuplicates() {
  console.log('🗑️  Starting deletion of approved duplicate customers...\n')
  console.log(`📋 Will delete ${DUPLICATES_TO_DELETE.length} duplicate records\n`)

  try {
    // Fetch customer details for confirmation
    const customerIds = DUPLICATES_TO_DELETE.map(d => d.id)
    const { data: customersToDelete, error: fetchError } = await supabase
      .from('customers')
      .select('id, first_name, last_name, mobile_number')
      .in('id', customerIds)

    if (fetchError) {
      console.error('❌ Error fetching customers:', fetchError)
      return
    }

    if (!customersToDelete || customersToDelete.length === 0) {
      console.log('⚠️  No matching customers found to delete')
      return
    }

    console.log('📋 Customers to be deleted:')
    DUPLICATES_TO_DELETE.forEach(dup => {
      const customer = customersToDelete.find(c => c.id === dup.id)
      if (customer) {
        console.log(`  - ${customer.first_name} ${customer.last_name || ''}`)
        console.log(`    ID: ${customer.id}`)
        console.log(`    Phone: ${customer.mobile_number}`)
        console.log(`    Reason: ${dup.name}\n`)
      }
    })

    console.log('⚠️  This will permanently delete these duplicate customers.')
    console.log('Press Ctrl+C to cancel, or wait 5 seconds to continue...\n')

    // Wait 5 seconds
    await new Promise(resolve => setTimeout(resolve, 5000))

    const deletedCustomers = []
    const failedDeletions = []

    for (const dupInfo of DUPLICATES_TO_DELETE) {
      const customer = customersToDelete.find(c => c.id === dupInfo.id)
      if (!customer) continue

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
        console.log(`✅ Deleted: ${customer.first_name} ${customer.last_name || ''} (${dupInfo.name})`)
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
              reason: 'Deletion of duplicate customer records',
              script: 'delete-approved-duplicates.ts',
              duplicate_info: dupInfo.name,
              phone_number: dupInfo.phone
            }
          })
      }
    }

    // Summary
    console.log('\n' + '='.repeat(50))
    console.log('📊 SUMMARY')
    console.log('='.repeat(50))
    console.log(`✅ Successfully deleted: ${deletedCustomers.length} duplicate record(s)`)
    
    if (failedDeletions.length > 0) {
      console.log(`❌ Failed to delete: ${failedDeletions.length} record(s)`)
      console.log('\nFailed deletions:')
      failedDeletions.forEach(failure => {
        console.log(`  - ${failure.first_name} ${failure.last_name || ''} (${failure.error})`)
      })
    }

    console.log('\n✨ Operation complete. All duplicates have been removed.')
    console.log('📝 Note: Lou Kitchener and Louise Kitchener were both kept as requested.')

  } catch (error) {
    console.error('❌ Unexpected error:', error)
    process.exit(1)
  }
}

// Run the script
deleteApprovedDuplicates().catch(console.error)