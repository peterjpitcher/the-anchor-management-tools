#!/usr/bin/env tsx

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

// Load environment variables
config({ path: '.env' })

async function listTables() {
  console.log('🔍 Listing Database Tables\n')
  
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
    // Query information schema to get all tables
    const { data: tables, error } = await supabase
      .rpc('get_tables_list')
    
    if (error) {
      // Try raw SQL query
      console.log('Trying direct SQL query...\n')
      
      const { data, error: sqlError } = await supabase
        .from('information_schema.tables')
        .select('table_schema, table_name')
        .eq('table_schema', 'public')
      
      if (sqlError) {
        // Try another approach - query pg_tables
        console.log('Trying pg_tables approach...\n')
        
        // List known tables by trying to access them
        const knownTables = [
          'events',
          'customers',
          'bookings',
          'employees',
          'messages',
          'private_bookings',
          'event_categories',
          'audit_logs',
          'jobs',
          'webhook_logs',
          'api_keys',
          'rbac_permissions',
          'rbac_roles',
          'rbac_user_roles',
          'customer_messaging_health',
          'employee_attachments',
          'supabase_migrations',
          'schema_migrations',
          'migrations',
          '_migrations'
        ]
        
        console.log('Checking known tables...\n')
        console.log('Table Name                    | Exists | Row Count')
        console.log('------------------------------|--------|----------')
        
        for (const tableName of knownTables) {
          try {
            const { count, error } = await supabase
              .from(tableName)
              .select('*', { count: 'exact', head: true })
            
            if (!error) {
              console.log(`${tableName.padEnd(30)}| ✅     | ${count || 0}`)
            } else {
              console.log(`${tableName.padEnd(30)}| ❌     | -`)
            }
          } catch (e) {
            console.log(`${tableName.padEnd(30)}| ❌     | -`)
          }
        }
        
        return
      }
      
      if (data && data.length > 0) {
        console.log('✅ Found tables in public schema:\n')
        data.forEach(table => {
          console.log(`- ${table.table_name}`)
        })
      }
    } else if (tables) {
      console.log('✅ Found tables:\n')
      console.log(tables)
    }
    
    // Also check for migration-related tables in other schemas
    console.log('\n📁 Checking for migration tables in other schemas...\n')
    
    const migrationSchemas = ['supabase_migrations', 'auth', 'storage', 'realtime']
    
    for (const schema of migrationSchemas) {
      try {
        const { data, error } = await supabase
          .from(`${schema}.schema_migrations`)
          .select('*', { count: 'exact', head: true })
        
        if (!error) {
          console.log(`✅ Found migrations table in ${schema} schema`)
        }
      } catch (e) {
        // Silent fail
      }
    }
    
  } catch (error) {
    console.error('❌ Failed to list tables:', error)
    process.exit(1)
  }
}

// Run the check
listTables()