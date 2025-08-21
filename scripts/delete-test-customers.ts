#!/usr/bin/env tsx

/**
 * Script to delete all customers with 'test' in their first or last name
 * Run with: tsx scripts/delete-test-customers.ts
 */

import { deleteTestCustomers } from '@/app/actions/customers'

async function main() {
  console.log('🔍 Starting deletion of test customers...')
  console.log('Looking for customers with "test" in first or last name (case-insensitive)\n')

  try {
    const result = await deleteTestCustomers()

    if (result.error) {
      console.error('❌ Error:', result.error)
      process.exit(1)
    }

    if (result.success) {
      console.log(`✅ ${result.message}`)
      
      if (result.deletedCount > 0) {
        console.log('\n📋 Deleted customers:')
        result.deletedCustomers.forEach((customer: any) => {
          console.log(`  - ${customer.name} (ID: ${customer.id})`)
        })
      }
    } else {
      console.log(`⚠️  ${result.message}`)
      
      if (result.deletedCount > 0) {
        console.log('\n✅ Successfully deleted:')
        result.deletedCustomers.forEach((customer: any) => {
          console.log(`  - ${customer.name} (ID: ${customer.id})`)
        })
      }
      
      if (result.failedCount > 0) {
        console.log('\n❌ Failed to delete:')
        result.failedDeletions.forEach((failure: any) => {
          console.log(`  - ${failure.name} (ID: ${failure.id})`)
          console.log(`    Error: ${failure.error}`)
        })
      }
    }

    console.log('\n✨ Operation complete. All changes have been logged to the audit trail.')
  } catch (error) {
    console.error('❌ Unexpected error:', error)
    process.exit(1)
  }
}

// Run the script
main().catch(console.error)