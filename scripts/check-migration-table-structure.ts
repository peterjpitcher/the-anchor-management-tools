#!/usr/bin/env tsx

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

// Load environment variables
config({ path: '.env' })

async function checkMigrationTableStructure() {
  console.log('🔍 Checking Migration Table Structures\n')
  
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ Missing required environment variables')
    process.exit(1)
  }
  
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
    // Query information schema to get column details for migration tables
    const migrationTables = ['supabase_migrations', 'schema_migrations', 'migrations', '_migrations']
    
    for (const tableName of migrationTables) {
      console.log(`\nTable: ${tableName}`)
      console.log('=' .repeat(50))
      
      // Try to get column information
      const { data: columns, error } = await supabase
        .rpc('get_table_columns', { table_name: tableName })
        .select('*')
      
      if (error) {
        // Try alternative approach - select with limit 0 to get column info
        const { data: sample, error: sampleError } = await supabase
          .from(tableName)
          .select('*')
          .limit(0)
        
        if (!sampleError) {
          // Get column names from the query
          console.log('Table exists but unable to get column details')
          
          // Try to insert a dummy record to see the structure
          const { error: insertError } = await supabase
            .from(tableName)
            .insert({})
            .select()
          
          if (insertError) {
            console.log('Error details:', insertError.message)
            if (insertError.message.includes('null value')) {
              // Parse required columns from error message
              console.log('Required columns based on error:', insertError.message)
            }
          }
        } else {
          console.log('Unable to access table')
        }
      } else if (columns && columns.length > 0) {
        console.log('Columns:')
        columns.forEach((col: any) => {
          console.log(`  - ${col.column_name}: ${col.data_type}`)
        })
      }
    }
    
    // Try to understand the expected format by attempting to query with specific columns
    console.log('\n\nTrying common migration table column patterns:')
    
    const commonPatterns = [
      { table: 'supabase_migrations', columns: ['version', 'inserted_at'] },
      { table: 'supabase_migrations', columns: ['name', 'executed_at'] },
      { table: 'supabase_migrations', columns: ['id', 'name', 'hash', 'executed_at'] },
      { table: 'schema_migrations', columns: ['version'] },
      { table: 'migrations', columns: ['id', 'name', 'batch', 'migration_time'] }
    ]
    
    for (const pattern of commonPatterns) {
      try {
        const { data, error } = await supabase
          .from(pattern.table)
          .select(pattern.columns.join(','))
          .limit(1)
        
        if (!error) {
          console.log(`\n✅ ${pattern.table} has columns: ${pattern.columns.join(', ')}`)
        }
      } catch (e) {
        // Silent fail
      }
    }
    
  } catch (error) {
    console.error('❌ Error checking migration table structure:', error)
    process.exit(1)
  }
}

// Run the check
checkMigrationTableStructure()