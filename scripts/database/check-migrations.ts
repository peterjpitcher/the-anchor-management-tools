#!/usr/bin/env tsx

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

// Load environment variables
config({ path: '.env' })

async function checkMigrations() {
  console.log('🔍 Checking Applied Database Migrations\n')
  
  // Check required environment variables
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ Missing required environment variables')
    console.error('Please ensure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set')
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
    // Query the supabase_migrations table
    console.log('Querying supabase_migrations table...\n')
    
    const { data: migrations, error } = await supabase
      .from('supabase_migrations')
      .select('*')
      .order('inserted_at', { ascending: true })
    
    if (error) {
      console.error('❌ Error querying migrations table:', error)
      
      // Try alternative table name
      console.log('\nTrying alternative table name: schema_migrations...')
      const { data: altMigrations, error: altError } = await supabase
        .from('schema_migrations')
        .select('*')
        .order('inserted_at', { ascending: true })
      
      if (altError) {
        console.error('❌ Error querying alternative table:', altError)
        throw new Error('Could not access migrations table')
      }
      
      if (altMigrations && altMigrations.length > 0) {
        console.log('✅ Found migrations in schema_migrations table:\n')
        displayMigrations(altMigrations)
      }
    } else if (migrations && migrations.length > 0) {
      console.log(`✅ Found ${migrations.length} applied migrations:\n`)
      displayMigrations(migrations)
    } else {
      console.log('⚠️  No migrations found in the database')
    }
    
    // Also check local migration files
    console.log('\n📁 Checking local migration files...\n')
    const { execSync } = require('child_process')
    
    try {
      const localMigrations = execSync('ls -la supabase/migrations/*.sql 2>/dev/null || echo "No migration files found"', { encoding: 'utf-8' })
      console.log('Local migration files:')
      console.log(localMigrations)
    } catch (e) {
      console.log('No local migration files found or unable to list them')
    }
    
  } catch (error) {
    console.error('❌ Failed to check migrations:', error)
    process.exit(1)
  }
}

function displayMigrations(migrations: any[]) {
  // Display in a table format
  console.log('Migration Name                                          | Applied At')
  console.log('------------------------------------------------------|---------------------------')
  
  migrations.forEach(migration => {
    const name = migration.name || migration.version || 'Unknown'
    const appliedAt = migration.inserted_at || migration.executed_at || migration.created_at || 'Unknown'
    const formattedDate = new Date(appliedAt).toLocaleString()
    
    console.log(`${name.padEnd(54)} | ${formattedDate}`)
  })
  
  console.log('\nTotal migrations applied:', migrations.length)
}

// Run the check
checkMigrations()