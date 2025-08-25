#!/usr/bin/env tsx

/**
 * Script to check API key in database and debug authentication
 */

import { createClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'
import * as dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Load environment variables
dotenv.config({ path: join(__dirname, '..', '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing required environment variables')
  process.exit(1)
}

async function hashApiKey(key: string): Promise<string> {
  return createHash('sha256').update(key).digest('hex')
}

async function checkApiKey() {
  const supabase = createClient(supabaseUrl, supabaseServiceKey)
  
  const apiKey = 'anch_wzjjWLuMd5osCBUZA7YTAyIKagxI_oboVSXRyYiIHmg'
  console.log('🔍 Checking API Key:', apiKey)
  
  // Hash the key
  const keyHash = await hashApiKey(apiKey)
  console.log('🔐 Key hash:', keyHash)
  
  // First, let's see all API keys
  console.log('\n📋 All API keys in database:')
  const { data: allKeys, error: allError } = await supabase
    .from('api_keys')
    .select('id, name, key_hash, is_active, permissions, created_at, last_used_at')
  
  if (allError) {
    console.error('Error fetching keys:', allError)
    return
  }
  
  if (!allKeys || allKeys.length === 0) {
    console.log('❌ No API keys found in database!')
    console.log('\n💡 You need to generate an API key first:')
    console.log('   npx tsx scripts/generate-api-key.ts')
    return
  }
  
  console.log(`Found ${allKeys.length} key(s):`)
  allKeys.forEach(key => {
    console.log(`\n  - Name: ${key.name}`)
    console.log(`    ID: ${key.id}`)
    console.log(`    Active: ${key.is_active}`)
    console.log(`    Hash: ${key.key_hash}`)
    console.log(`    Permissions: ${JSON.stringify(key.permissions)}`)
    console.log(`    Created: ${key.created_at}`)
    console.log(`    Last used: ${key.last_used_at || 'Never'}`)
  })
  
  // Check if our specific key exists
  console.log('\n🔍 Looking for our specific key hash:', keyHash)
  const matchingKey = allKeys.find(k => k.key_hash === keyHash)
  
  if (matchingKey) {
    console.log('\n✅ Key found in database!')
    if (!matchingKey.is_active) {
      console.log('⚠️  BUT the key is NOT active! You need to activate it.')
    }
  } else {
    console.log('\n❌ Key NOT found in database!')
    console.log('The API key you\'re using doesn\'t match any stored hashes.')
    console.log('\n💡 Solutions:')
    console.log('1. Generate a new API key: npx tsx scripts/generate-api-key.ts')
    console.log('2. Or activate this key by inserting it into the database')
  }
  
  // Show how to insert the key if needed
  if (!matchingKey) {
    console.log('\n📝 To add this key to the database, run this SQL:')
    console.log(`
INSERT INTO api_keys (
  name,
  key_hash,
  permissions,
  rate_limit,
  is_active,
  created_at
) VALUES (
  'The Anchor Website',
  '${keyHash}',
  '["read:events", "read:menu", "read:business", "create:bookings"]'::jsonb,
  1000,
  true,
  NOW()
);
    `)
  }
}

checkApiKey().catch(console.error)