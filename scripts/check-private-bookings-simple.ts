#!/usr/bin/env tsx
/**
 * Check Private Bookings Schema (Simple Version)
 * 
 * This script checks the database schema for the private_bookings table
 * to determine if guest_count or guest_badge column exists.
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

// Load environment variables
dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('❌ Missing Supabase environment variables')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function checkSchema() {
  console.log('🔍 Checking private_bookings table schema...\n')

  // Try to fetch one record to see the schema
  const { data, error } = await supabase
    .from('private_bookings')
    .select('*')
    .limit(1)

  if (error) {
    console.error('❌ Error fetching data:', error.message)
    
    // Try inserting to see what columns are expected
    console.log('\n🧪 Testing insert to discover schema...')
    const { error: insertError } = await supabase
      .from('private_bookings')
      .insert({
        customer_id: '00000000-0000-0000-0000-000000000000',
        venue: 'Test',
        event_date: '2025-12-31',
        start_time: '12:00',
        guest_count: 10
      })
      
    if (insertError) {
      console.log('Insert error:', insertError.message)
      
      // Try with guest_badge instead
      const { error: badgeError } = await supabase
        .from('private_bookings')
        .insert({
          customer_id: '00000000-0000-0000-0000-000000000000',
          venue: 'Test',
          event_date: '2025-12-31',
          start_time: '12:00',
          guest_badge: 10
        })
        
      if (badgeError) {
        console.log('Badge insert error:', badgeError.message)
      }
    }
    return
  }

  if (data && data.length > 0) {
    const columns = Object.keys(data[0])
    console.log('✅ Private bookings table columns:')
    columns.forEach(col => console.log(`  - ${col}`))
    
    console.log('\n🔍 Checking for guest-related columns:')
    const guestColumns = columns.filter(col => 
      col.toLowerCase().includes('guest')
    )
    
    if (guestColumns.length > 0) {
      console.log('✅ Found guest columns:', guestColumns.join(', '))
    } else {
      console.log('❌ No guest-related columns found')
    }
    
    // Check if guest_count exists
    if (columns.includes('guest_count')) {
      console.log('✅ guest_count column exists')
    } else {
      console.log('❌ guest_count column does NOT exist')
    }
    
    // Check if guest_badge exists
    if (columns.includes('guest_badge')) {
      console.log('✅ guest_badge column exists')
    } else {
      console.log('❌ guest_badge column does NOT exist')
    }
  } else {
    console.log('ℹ️ No data in private_bookings table')
    console.log('Creating a test record to discover schema...')
    
    // Try to create a record with guest_count
    const { data: newData, error: createError } = await supabase
      .from('private_bookings')
      .select('*')
      .limit(0)
      
    if (!createError && newData) {
      console.log('Schema discovered from empty select:', Object.keys(newData))
    }
  }
}

checkSchema().catch(console.error)