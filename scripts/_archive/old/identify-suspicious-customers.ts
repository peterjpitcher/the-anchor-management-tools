#!/usr/bin/env tsx

/**
 * Script to identify suspicious or non-real customer entries
 * Run with: tsx scripts/identify-suspicious-customers.ts
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

async function identifySuspiciousCustomers() {
  console.log('🔍 Analyzing customer database for suspicious entries...\n')

  try {
    // Get all customers
    const { data: allCustomers, error } = await supabase
      .from('customers')
      .select('id, first_name, last_name, mobile_number')
      .order('first_name')

    if (error) {
      console.error('❌ Error fetching customers:', error)
      return
    }

    const suspicious = []
    const duplicates = []
    const systemAccounts = []
    
    // Track phone numbers for duplicate detection
    const phoneMap = new Map()

    allCustomers?.forEach(customer => {
      const fullName = `${customer.first_name} ${customer.last_name || ''}`.trim()
      
      // Check for system/utility accounts
      if (customer.first_name?.toLowerCase().includes('menu') ||
          customer.first_name?.toLowerCase().includes('storage') ||
          customer.first_name?.toLowerCase().includes('unknown') ||
          customer.first_name?.toLowerCase() === 'unknown') {
        systemAccounts.push(customer)
      }
      
      // Check for generic test-like names with suspicious phone patterns
      else if (customer.first_name === 'Jane' && customer.last_name === 'Smith' && 
               customer.mobile_number?.includes('900123')) {
        suspicious.push(customer)
      }
      
      // Track duplicates by phone number
      if (customer.mobile_number) {
        if (phoneMap.has(customer.mobile_number)) {
          const existing = phoneMap.get(customer.mobile_number)
          duplicates.push({
            customer1: existing,
            customer2: customer,
            phone: customer.mobile_number
          })
        } else {
          phoneMap.set(customer.mobile_number, customer)
        }
      }
    })

    // Display results
    console.log('=' * 60)
    console.log('📊 ANALYSIS RESULTS')
    console.log('=' * 60)

    if (systemAccounts.length > 0) {
      console.log('\n🤖 SYSTEM/UTILITY ACCOUNTS (Recommended for deletion):')
      systemAccounts.forEach(c => {
        console.log(`  - ${c.first_name} ${c.last_name || ''} (ID: ${c.id})`)
        console.log(`    Phone: ${c.mobile_number || 'None'}`)
      })
    }

    if (suspicious.length > 0) {
      console.log('\n⚠️  SUSPICIOUS ENTRIES (Review recommended):')
      suspicious.forEach(c => {
        console.log(`  - ${c.first_name} ${c.last_name || ''} (ID: ${c.id})`)
        console.log(`    Phone: ${c.mobile_number || 'None'}`)
      })
    }

    if (duplicates.length > 0) {
      console.log('\n👥 DUPLICATE PHONE NUMBERS (May need merging):')
      duplicates.forEach(dup => {
        console.log(`  Phone: ${dup.phone}`)
        console.log(`    - ${dup.customer1.first_name} ${dup.customer1.last_name || ''} (ID: ${dup.customer1.id})`)
        console.log(`    - ${dup.customer2.first_name} ${dup.customer2.last_name || ''} (ID: ${dup.customer2.id})`)
      })
    }

    // Offer to delete system accounts
    if (systemAccounts.length > 0) {
      console.log('\n' + '=' * 60)
      console.log('🗑️  DELETION OPTIONS')
      console.log('=' * 60)
      console.log('\nWould you like to delete the system/utility accounts?')
      console.log('Run: tsx scripts/delete-specific-customers.ts')
      console.log('\nCustomer IDs to delete:')
      systemAccounts.forEach(c => {
        console.log(`"${c.id}", // ${c.first_name} ${c.last_name || ''}`)
      })
    }

    console.log('\n✅ Analysis complete!')
    console.log(`Total customers analyzed: ${allCustomers?.length || 0}`)
    console.log(`System accounts found: ${systemAccounts.length}`)
    console.log(`Suspicious entries found: ${suspicious.length}`)
    console.log(`Duplicate phone numbers found: ${duplicates.length}`)

  } catch (error) {
    console.error('❌ Unexpected error:', error)
    process.exit(1)
  }
}

// Run the script
identifySuspiciousCustomers().catch(console.error)