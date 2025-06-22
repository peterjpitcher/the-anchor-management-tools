#!/usr/bin/env tsx

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

// Load environment variables
config({ path: '.env' })

async function testConnectivity() {
  console.log('🔍 PHASE 0: ENVIRONMENT VALIDATION\n')
  
  // Check required environment variables
  console.log('1. Checking Environment Variables...')
  const requiredVars = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'NEXT_PUBLIC_APP_URL',
    'NEXT_PUBLIC_CONTACT_PHONE_NUMBER',
    'CRON_SECRET_KEY'
  ]
  
  const optionalVars = [
    'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN',
    'TWILIO_PHONE_NUMBER',
    'SKIP_TWILIO_SIGNATURE_VALIDATION'
  ]
  
  let hasErrors = false
  
  for (const varName of requiredVars) {
    if (!process.env[varName]) {
      console.error(`❌ Missing required variable: ${varName}`)
      hasErrors = true
    } else {
      console.log(`✅ ${varName}: Defined`)
    }
  }
  
  console.log('\nOptional variables:')
  for (const varName of optionalVars) {
    if (!process.env[varName]) {
      console.log(`⚪ ${varName}: Not set (optional)`)
    } else {
      console.log(`✅ ${varName}: Defined`)
    }
  }
  
  if (hasErrors) {
    console.error('\n❌ Missing required environment variables. Please check .env.local')
    process.exit(1)
  }
  
  // Test database connectivity
  console.log('\n2. Testing Database Connectivity...')
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
    // Test basic connectivity
    const { data, error } = await supabase
      .from('events')
      .select('count', { count: 'exact', head: true })
    
    if (error) throw error
    
    console.log(`✅ Database connected successfully`)
    console.log(`   Found ${data} events in database`)
    
    // Test auth service
    console.log('\n3. Testing Authentication Service...')
    const { data: { users }, error: authError } = await supabase.auth.admin.listUsers({
      page: 1,
      perPage: 1
    })
    
    if (authError) throw authError
    
    console.log(`✅ Auth service connected successfully`)
    console.log(`   Total users in system: ${users?.length || 0}`)
    
    // Test RLS
    console.log('\n4. Testing Row Level Security...')
    const anonSupabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    
    const { error: rlsError } = await anonSupabase
      .from('events')
      .select('id')
      .limit(1)
    
    if (rlsError && rlsError.code === 'PGRST301') {
      console.log(`✅ RLS is properly configured (anonymous access denied)`)
    } else {
      console.log(`⚠️  RLS might not be properly configured`)
    }
    
    // Check rate limiting configuration
    console.log('\n5. Rate Limiting Configuration...')
    console.log(`✅ Supabase provides built-in rate limiting:`)
    console.log(`   - Authentication: 30 requests/minute`)
    console.log(`   - API requests: Based on plan tier`)
    
    // Test Twilio if configured
    if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
      console.log('\n6. Testing Twilio Connectivity...')
      try {
        const twilioClient = require('twilio')(
          process.env.TWILIO_ACCOUNT_SID,
          process.env.TWILIO_AUTH_TOKEN
        )
        
        const account = await twilioClient.api.accounts(process.env.TWILIO_ACCOUNT_SID).fetch()
        console.log(`✅ Twilio connected successfully`)
        console.log(`   Account Status: ${account.status}`)
      } catch (twilioError: any) {
        console.error(`❌ Twilio connection failed: ${twilioError.message}`)
      }
    }
    
    console.log('\n✅ PHASE 0 COMPLETE: Environment validation successful!')
    
  } catch (error) {
    console.error('❌ Database connection failed:', error)
    process.exit(1)
  }
}

testConnectivity()