#!/usr/bin/env tsx

/**
 * Script to analyze duplicate customers in detail
 * Run with: tsx scripts/analyze-duplicates-detailed.ts
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

async function analyzeDuplicatesDetailed() {
  console.log('🔍 Analyzing duplicate customers in detail...\n')

  try {
    // Get all customers with their full details
    const { data: allCustomers, error } = await supabase
      .from('customers')
      .select(`
        id,
        first_name,
        last_name,
        mobile_number,
        sms_opt_in,
        created_at,
        messaging_status,
        sms_delivery_failures,
        last_successful_sms_at,
        table_booking_count,
        no_show_count,
        bookings (count)
      `)
      .order('created_at')

    if (error) {
      console.error('❌ Error fetching customers:', error)
      return
    }

    // Track duplicates by phone number
    const phoneMap = new Map()
    
    allCustomers?.forEach(customer => {
      if (customer.mobile_number) {
        if (!phoneMap.has(customer.mobile_number)) {
          phoneMap.set(customer.mobile_number, [])
        }
        phoneMap.get(customer.mobile_number).push(customer)
      }
    })

    // Find actual duplicates (more than 1 entry per phone)
    const duplicates = Array.from(phoneMap.entries())
      .filter(([phone, customers]) => customers.length > 1)
      .map(([phone, customers]) => ({ phone, customers }))

    if (duplicates.length === 0) {
      console.log('✅ No duplicate phone numbers found')
      return
    }

    console.log(`📊 Found ${duplicates.length} phone numbers with multiple customer records\n`)
    console.log('=' * 80)

    let duplicateNumber = 1
    for (const { phone, customers } of duplicates) {
      console.log(`\n📱 DUPLICATE SET #${duplicateNumber}: Phone ${phone}`)
      console.log('-'.repeat(80))
      
      customers.forEach((customer, index) => {
        const bookingCount = customer.bookings?.[0]?.count || 0
        console.log(`\n  Entry ${index + 1}:`)
        console.log(`    ID: ${customer.id}`)
        console.log(`    Name: "${customer.first_name}" "${customer.last_name || '(no last name)'}"`)
        console.log(`    SMS Opt-in: ${customer.sms_opt_in ? 'Yes' : 'No'}`)
        console.log(`    Messaging Status: ${customer.messaging_status || 'active'}`)
        console.log(`    SMS Delivery Failures: ${customer.sms_delivery_failures || 0}`)
        console.log(`    Total Event Bookings: ${bookingCount}`)
        console.log(`    Table Booking Count: ${customer.table_booking_count || 0}`)
        console.log(`    No Show Count: ${customer.no_show_count || 0}`)
        console.log(`    Last Successful SMS: ${customer.last_successful_sms_at ? new Date(customer.last_successful_sms_at).toLocaleDateString('en-GB') : 'Never'}`)
        console.log(`    Created: ${new Date(customer.created_at).toLocaleDateString('en-GB')} at ${new Date(customer.created_at).toLocaleTimeString('en-GB')}`)
      })
      
      console.log(`\n  📝 Recommendation:`)
      
      // Make smart recommendations based on data
      const hasBookings = customers.filter(c => (c.bookings?.[0]?.count || 0) > 0)
      const hasTableBookings = customers.filter(c => (c.table_booking_count || 0) > 0)
      const hasFullName = customers.filter(c => c.last_name && c.last_name !== '.')
      const hasSuccessfulSMS = customers.filter(c => c.last_successful_sms_at)
      
      if (hasBookings.length === 1) {
        console.log(`    → Keep Entry ${customers.indexOf(hasBookings[0]) + 1} (has ${hasBookings[0].bookings[0].count} event bookings)`)
      } else if (hasBookings.length > 1) {
        const mostBookings = hasBookings.reduce((prev, current) => 
          (current.bookings[0].count > prev.bookings[0].count) ? current : prev
        )
        console.log(`    → Keep Entry ${customers.indexOf(mostBookings) + 1} (has most event bookings: ${mostBookings.bookings[0].count})`)
      } else if (hasTableBookings.length === 1) {
        console.log(`    → Keep Entry ${customers.indexOf(hasTableBookings[0]) + 1} (has ${hasTableBookings[0].table_booking_count} table bookings)`)
      } else if (hasTableBookings.length > 1) {
        const mostTableBookings = hasTableBookings.reduce((prev, current) => 
          ((current.table_booking_count || 0) > (prev.table_booking_count || 0)) ? current : prev
        )
        console.log(`    → Keep Entry ${customers.indexOf(mostTableBookings) + 1} (has most table bookings: ${mostTableBookings.table_booking_count})`)
      } else if (hasSuccessfulSMS.length === 1) {
        console.log(`    → Keep Entry ${customers.indexOf(hasSuccessfulSMS[0]) + 1} (has SMS history)`)
      } else if (hasFullName.length === 1) {
        console.log(`    → Keep Entry ${customers.indexOf(hasFullName[0]) + 1} (has complete name)`)
      } else {
        // Keep the oldest entry
        console.log(`    → Keep Entry 1 (oldest entry)`)
      }
      
      duplicateNumber++
    }

    console.log('\n' + '='.repeat(80))
    console.log('\n📋 SUMMARY')
    console.log(`Total duplicate sets: ${duplicates.length}`)
    console.log(`Total duplicate records: ${duplicates.reduce((acc, d) => acc + d.customers.length - 1, 0)}`)
    
    console.log('\n💡 To delete specific customers, use:')
    console.log('   tsx scripts/delete-customers-by-id.ts <customer_id1> <customer_id2> ...')

  } catch (error) {
    console.error('❌ Unexpected error:', error)
    process.exit(1)
  }
}

// Run the script
analyzeDuplicatesDetailed().catch(console.error)