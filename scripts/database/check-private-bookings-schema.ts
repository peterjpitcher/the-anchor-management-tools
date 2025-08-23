#!/usr/bin/env tsx
/**
 * Check Private Bookings Schema
 * 
 * This script checks the database schema for the private_bookings table
 * to determine if guest_count or guest_badge column exists.
 */

import { createClient } from '@/lib/supabase/server'

async function checkSchema() {
  console.log('🔍 Checking private_bookings table schema...\n')

  const supabase = await createClient()

  // Query to get column information
  const { data: columns, error } = await supabase
    .rpc('get_table_columns', { table_name: 'private_bookings' })
    .select()

  if (error) {
    // Try alternative approach
    const { data, error: selectError } = await supabase
      .from('private_bookings')
      .select('*')
      .limit(1)

    if (selectError) {
      console.error('❌ Error fetching schema:', selectError)
      return
    }

    if (data && data.length > 0) {
      console.log('✅ Private bookings table columns:')
      console.log(Object.keys(data[0]))
      
      console.log('\n🔍 Checking for guest-related columns:')
      const guestColumns = Object.keys(data[0]).filter(col => 
        col.toLowerCase().includes('guest')
      )
      
      if (guestColumns.length > 0) {
        console.log('Found guest columns:', guestColumns)
      } else {
        console.log('No guest-related columns found')
      }
    } else {
      console.log('ℹ️ No data in private_bookings table to analyze')
      
      // Try to insert and see what error we get
      console.log('\n🧪 Testing insert to discover schema...')
      const { error: insertError } = await supabase
        .from('private_bookings')
        .insert({
          guest_badge: 10,
          guest_count: 10
        })
        .select()
        
      if (insertError) {
        console.log('Insert error message:', insertError.message)
        if (insertError.message.includes('guest_badge')) {
          console.log('❌ guest_badge column does not exist')
        }
        if (insertError.message.includes('guest_count')) {
          console.log('❌ guest_count column does not exist')
        }
      }
    }
  } else {
    console.log('✅ Private bookings table columns:', columns)
  }
}

checkSchema().catch(console.error)