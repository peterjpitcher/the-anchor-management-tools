import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import * as path from 'path'

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing environment variables. Please check .env.local')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function applyCustomerLabelsMigration() {
  console.log('=== Applying Customer Labels Migration ===\n')

  try {
    // Read the migration file
    const fs = require('fs')
    const migrationPath = path.join(__dirname, '../supabase/migrations/20250706160000_add_customer_labels.sql')
    const migrationSql = fs.readFileSync(migrationPath, 'utf8')

    // Split by semicolons and execute each statement
    const statements = migrationSql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'))

    console.log(`Found ${statements.length} SQL statements to execute\n`)

    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i] + ';'
      
      // Skip comments
      if (statement.trim().startsWith('--')) continue

      // Extract a description from the statement
      let description = 'Executing statement'
      if (statement.includes('CREATE TABLE')) {
        const match = statement.match(/CREATE TABLE[^(]*\s+(\S+)/i)
        if (match) description = `Creating table ${match[1]}`
      } else if (statement.includes('CREATE INDEX')) {
        const match = statement.match(/CREATE INDEX[^(]*\s+(\S+)/i)
        if (match) description = `Creating index ${match[1]}`
      } else if (statement.includes('CREATE POLICY')) {
        const match = statement.match(/CREATE POLICY\s+"([^"]+)"/i)
        if (match) description = `Creating policy: ${match[1]}`
      } else if (statement.includes('INSERT INTO')) {
        const match = statement.match(/INSERT INTO\s+(\S+)/i)
        if (match) description = `Inserting data into ${match[1]}`
      } else if (statement.includes('CREATE OR REPLACE FUNCTION')) {
        const match = statement.match(/CREATE OR REPLACE FUNCTION[^(]*"([^"]+)"/i)
        if (match) description = `Creating function ${match[1]}`
      }

      console.log(`${i + 1}/${statements.length}: ${description}...`)

      let error
      try {
        const result = await supabase.rpc('query', { query: statement })
        error = result.error
      } catch (err) {
        error = err
      }
      
      if (error) {
        // Try direct execution as fallback
        console.log('   Retrying with direct execution...')
        const response = await fetch(`${supabaseUrl}/rest/v1/rpc/query`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`
          },
          body: JSON.stringify({ query: statement })
        })

        if (!response.ok) {
          const errorText = await response.text()
          console.error(`   ✗ Failed: ${errorText}`)
          // Continue with other statements
        } else {
          console.log('   ✓ Success')
        }
      } else {
        console.log('   ✓ Success')
      }
    }

    console.log('\n=== Testing Customer Labels ===\n')

    // Test that tables were created
    const { data: labels, error: labelsError } = await supabase
      .from('customer_labels')
      .select('*')
      .limit(5)

    if (labelsError) {
      console.error('Error fetching labels:', labelsError)
    } else {
      console.log(`Found ${labels?.length || 0} customer labels:`)
      labels?.forEach(l => console.log(`  - ${l.name} (${l.color})`))
    }

    // Apply labels retroactively
    console.log('\n=== Applying Labels Retroactively ===\n')
    
    const { data: results, error: retroError } = await supabase
      .rpc('apply_customer_labels_retroactively')

    if (retroError) {
      console.error('Error applying labels:', retroError)
    } else {
      console.log(`Applied labels to ${results?.length || 0} customers`)
    }

  } catch (error) {
    console.error('Migration failed:', error)
  }

  process.exit(0)
}

applyCustomerLabelsMigration().catch(console.error)