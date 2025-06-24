#!/usr/bin/env tsx

/**
 * Script to verify an API key exists and is active
 * Usage: npx tsx scripts/verify-api-key.ts <api-key>
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

async function verifyApiKey(apiKey: string) {
  const supabase = createClient(supabaseUrl, supabaseServiceKey)
  
  console.log('\n🔍 Verifying API Key:', apiKey)
  console.log('📊 Key prefix:', apiKey.substring(0, 10) + '...')
  
  // Hash the key
  const keyHash = await hashApiKey(apiKey)
  console.log('🔐 Key hash:', keyHash)
  
  // Look up the key
  const { data, error } = await supabase
    .from('api_keys')
    .select('*')
    .eq('key_hash', keyHash)
    .single()
  
  if (error) {
    console.error('\n❌ Error looking up key:', error.message)
    
    // Try to find any keys to help debug
    const { data: allKeys, error: allError } = await supabase
      .from('api_keys')
      .select('id, name, is_active, created_at')
    
    if (!allError && allKeys) {
      console.log('\n📋 Existing API keys in database:')
      allKeys.forEach(key => {
        console.log(`  - ${key.name} (ID: ${key.id}, Active: ${key.is_active}, Created: ${key.created_at})`)
      })
    }
    
    return
  }
  
  if (!data) {
    console.error('\n❌ API key not found in database')
    return
  }
  
  console.log('\n✅ API Key found!')
  console.log('📋 Key details:')
  console.log('  - Name:', data.name)
  console.log('  - ID:', data.id)
  console.log('  - Active:', data.is_active)
  console.log('  - Permissions:', data.permissions)
  console.log('  - Rate limit:', data.rate_limit, 'requests/hour')
  console.log('  - Created:', data.created_at)
  console.log('  - Last used:', data.last_used_at || 'Never')
  
  if (!data.is_active) {
    console.warn('\n⚠️  Warning: This API key is NOT active!')
  }
  
  // Check recent usage
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { count } = await supabase
    .from('api_usage')
    .select('*', { count: 'exact', head: true })
    .eq('api_key_id', data.id)
    .gte('created_at', oneHourAgo)
  
  console.log('\n📊 Usage in last hour:', count || 0, '/', data.rate_limit)
  
  // Test the authentication
  console.log('\n🧪 Testing authentication...')
  console.log('   Using X-API-Key header:', apiKey)
  
  const testUrl = 'http://localhost:3000/api/events?limit=1'
  console.log('   Test URL:', testUrl)
  
  try {
    const response = await fetch(testUrl, {
      headers: {
        'X-API-Key': apiKey,
      }
    })
    
    console.log('   Response status:', response.status)
    console.log('   Response headers:')
    console.log('     - Access-Control-Allow-Origin:', response.headers.get('access-control-allow-origin'))
    console.log('     - Access-Control-Allow-Headers:', response.headers.get('access-control-allow-headers'))
    
    if (response.ok) {
      const data = await response.json()
      console.log('\n✅ Authentication successful!')
      console.log('   Response preview:', JSON.stringify(data).substring(0, 100) + '...')
    } else {
      const error = await response.text()
      console.log('\n❌ Authentication failed!')
      console.log('   Error:', error)
    }
  } catch (err) {
    console.log('\n⚠️  Could not test authentication (is the server running?)')
    console.log('   Error:', err.message)
  }
}

// Get API key from command line
const apiKey = process.argv[2]

if (!apiKey) {
  console.error('❌ Please provide an API key as an argument')
  console.error('Usage: npx tsx scripts/verify-api-key.ts <api-key>')
  process.exit(1)
}

verifyApiKey(apiKey).catch(console.error)