#!/usr/bin/env tsx

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

// Load environment variables
config({ path: '.env' })

async function queryPrivateBookingsData() {
  console.log('🔍 Querying Private Bookings Data\n')
  
  // Check required environment variables
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ Missing required environment variables')
    process.exit(1)
  }
  
  // Create Supabase client with service role key
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  )
  
  try {
    // Query venue_spaces table
    console.log('📍 VENUE SPACES\n')
    console.log('================\n')
    
    const { data: venueSpaces, error: venueError } = await supabase
      .from('venue_spaces')
      .select('*')
      .order('display_order', { ascending: true })
    
    if (venueError) {
      console.log('❌ venue_spaces table not found, trying alternative names...')
      
      // Try alternative table names
      const alternativeNames = ['spaces', 'event_spaces', 'private_spaces', 'rental_spaces']
      for (const tableName of alternativeNames) {
        const { data, error } = await supabase
          .from(tableName)
          .select('*')
          .limit(1)
        
        if (!error) {
          console.log(`✅ Found table: ${tableName}`)
          const { data: spaces } = await supabase
            .from(tableName)
            .select('*')
          console.log(JSON.stringify(spaces, null, 2))
          break
        }
      }
    } else if (venueSpaces) {
      console.log(`Found ${venueSpaces.length} venue spaces:\n`)
      venueSpaces.forEach((space, index) => {
        console.log(`${index + 1}. ${space.name || 'Unnamed Space'}`)
        console.log(`   - Capacity: ${space.capacity || 'Not specified'}`)
        console.log(`   - Description: ${space.description || 'No description'}`)
        console.log(`   - Features: ${space.features || 'No features listed'}`)
        console.log(`   - Active: ${space.is_active ? 'Yes' : 'No'}`)
        console.log('')
      })
    }
    
    // Query catering_packages table
    console.log('\n🍽️  CATERING PACKAGES\n')
    console.log('===================\n')
    
    const { data: cateringPackages, error: cateringError } = await supabase
      .from('catering_packages')
      .select('*')
      .eq('is_active', true)
      .order('display_order', { ascending: true })
    
    if (cateringError) {
      console.log('❌ catering_packages table not found, trying alternative names...')
      
      // Try alternative names
      const alternativeNames = ['catering', 'catering_options', 'food_packages', 'menu_packages']
      for (const tableName of alternativeNames) {
        const { data, error } = await supabase
          .from(tableName)
          .select('*')
          .limit(1)
        
        if (!error) {
          console.log(`✅ Found table: ${tableName}`)
          const { data: packages } = await supabase
            .from(tableName)
            .select('*')
          console.log(JSON.stringify(packages, null, 2))
          break
        }
      }
    } else if (cateringPackages) {
      console.log(`Found ${cateringPackages.length} catering packages:\n`)
      cateringPackages.forEach((pkg, index) => {
        console.log(`${index + 1}. ${pkg.name || 'Unnamed Package'}`)
        console.log(`   - Type: ${pkg.type || 'Not specified'}`)
        console.log(`   - Description: ${pkg.description || 'No description'}`)
        console.log(`   - Includes: ${pkg.includes || 'Details not specified'}`)
        console.log(`   - Min Order: ${pkg.minimum_order || 'No minimum'}`)
        console.log('')
      })
    }
    
    // Query vendors table
    console.log('\n👥 PREFERRED VENDORS\n')
    console.log('==================\n')
    
    const { data: vendors, error: vendorsError } = await supabase
      .from('vendors')
      .select('*')
      .eq('is_active', true)
      .order('category', { ascending: true })
    
    if (vendorsError) {
      console.log('❌ vendors table not found, trying alternative names...')
      
      // Try alternative names
      const alternativeNames = ['preferred_vendors', 'suppliers', 'partners', 'service_providers']
      for (const tableName of alternativeNames) {
        const { data, error } = await supabase
          .from(tableName)
          .select('*')
          .limit(1)
        
        if (!error) {
          console.log(`✅ Found table: ${tableName}`)
          const { data: vendorList } = await supabase
            .from(tableName)
            .select('*')
          console.log(JSON.stringify(vendorList, null, 2))
          break
        }
      }
    } else if (vendors) {
      console.log(`Found ${vendors.length} vendors:\n`)
      
      // Group vendors by category
      const vendorsByCategory = vendors.reduce((acc, vendor) => {
        const category = vendor.category || 'Other'
        if (!acc[category]) acc[category] = []
        acc[category].push(vendor)
        return acc
      }, {} as Record<string, any[]>)
      
      Object.entries(vendorsByCategory).forEach(([category, vendorList]) => {
        console.log(`\n${category}:`)
        vendorList.forEach(vendor => {
          console.log(`  - ${vendor.name || 'Unnamed Vendor'}`)
          console.log(`    Services: ${vendor.services || 'Not specified'}`)
          console.log(`    Contact: ${vendor.contact_info || 'No contact info'}`)
        })
      })
    }
    
    // Query private_bookings table for additional info
    console.log('\n\n📅 PRIVATE BOOKINGS INFO\n')
    console.log('======================\n')
    
    const { data: privateBookings, error: bookingsError } = await supabase
      .from('private_bookings')
      .select('*')
      .limit(5)
      .order('created_at', { ascending: false })
    
    if (!bookingsError && privateBookings) {
      console.log(`Sample of recent private bookings (${privateBookings.length} shown):\n`)
      
      // Extract unique features/services mentioned
      const features = new Set<string>()
      const services = new Set<string>()
      
      privateBookings.forEach(booking => {
        if (booking.requirements) features.add(booking.requirements)
        if (booking.catering_requirements) services.add('Catering')
        if (booking.av_requirements) services.add('AV Equipment')
        if (booking.setup_requirements) services.add('Custom Setup')
      })
      
      if (features.size > 0) {
        console.log('Common Requirements/Features Requested:')
        Array.from(features).forEach(feature => {
          console.log(`  - ${feature}`)
        })
      }
      
      if (services.size > 0) {
        console.log('\nCommon Services:')
        Array.from(services).forEach(service => {
          console.log(`  - ${service}`)
        })
      }
    }
    
    // Try to find any configuration or settings tables
    console.log('\n\n⚙️  CHECKING FOR CONFIGURATION TABLES\n')
    console.log('===================================\n')
    
    const configTables = [
      'venue_config',
      'venue_settings',
      'private_booking_settings',
      'booking_configuration',
      'system_settings'
    ]
    
    for (const tableName of configTables) {
      const { data, error } = await supabase
        .from(tableName)
        .select('*')
        .limit(5)
      
      if (!error && data) {
        console.log(`✅ Found ${tableName}:`)
        console.log(JSON.stringify(data, null, 2))
        console.log('')
      }
    }
    
    console.log('\n✅ Data query complete!')
    
  } catch (error) {
    console.error('❌ Failed to query data:', error)
    process.exit(1)
  }
}

// Run the query
queryPrivateBookingsData()