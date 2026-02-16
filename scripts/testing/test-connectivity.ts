#!/usr/bin/env tsx

import dotenv from 'dotenv'
import path from 'path'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

function assertReadOnlyScript(argv: string[] = process.argv.slice(2)): void {
  if (argv.includes('--confirm')) {
    throw new Error('test-connectivity is read-only and does not support --confirm.')
  }
}

async function run(): Promise<void> {
  assertReadOnlyScript()

  console.log('Connectivity diagnostics (read-only)\n')

  console.log('1) Checking environment variables...')
  const requiredVars = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'NEXT_PUBLIC_APP_URL',
    'NEXT_PUBLIC_CONTACT_PHONE_NUMBER',
    'CRON_SECRET',
  ]

  const optionalVars = [
    'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN',
    'TWILIO_PHONE_NUMBER',
    'SKIP_TWILIO_SIGNATURE_VALIDATION',
  ]

  const missingRequired = requiredVars.filter((varName) => !process.env[varName])
  for (const varName of requiredVars) {
    console.log(`${missingRequired.includes(varName) ? 'MISSING' : 'OK'} ${varName}`)
  }

  console.log('\nOptional variables:')
  for (const varName of optionalVars) {
    console.log(`${process.env[varName] ? 'OK' : 'SKIP'} ${varName}`)
  }

  if (missingRequired.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missingRequired.join(', ')} (check .env.local)`
    )
  }

  console.log('\n2) Testing Supabase connectivity (service role)...')
  const adminSupabase = createAdminClient()

  const { error: eventsError, count: eventsCount } = await adminSupabase
    .from('events')
    .select('*', { count: 'exact', head: true })

  if (eventsError) {
    throw new Error(`Supabase events count query failed: ${eventsError.message}`)
  }

  console.log(`OK Supabase reachable. events count: ${eventsCount ?? 'unknown'}`)

  console.log('\n3) Testing Supabase auth admin...')
  const { data: usersData, error: usersError } = await adminSupabase.auth.admin.listUsers({
    page: 1,
    perPage: 1,
  })

  if (usersError) {
    throw new Error(`Supabase auth.admin.listUsers failed: ${usersError.message}`)
  }

  console.log(`OK Auth admin reachable. Returned ${usersData?.users?.length ?? 0} user(s).`)

  console.log('\n4) Testing RLS behavior (anon key)...')
  const anonSupabase = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { error: anonError } = await anonSupabase.from('events').select('id').limit(1)
  if (!anonError) {
    console.error('RLS check: anonymous read succeeded (expected denial).')
    process.exitCode = 1
  } else if ((anonError as any).code === 'PGRST301') {
    console.log('OK RLS check: anonymous access denied.')
  } else {
    console.error(`RLS check: unexpected error: ${(anonError as any).message || String(anonError)}`)
    process.exitCode = 1
  }

  console.log('\n5) Rate limiting configuration note...')
  console.log('Supabase provides built-in auth and API rate limiting (plan-dependent).')

  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    console.log('\n6) Testing Twilio connectivity...')
    try {
      const twilioModule: any = await import('twilio')
      const twilioFactory = twilioModule?.default ?? twilioModule
      const twilioClient = twilioFactory(
        process.env.TWILIO_ACCOUNT_SID,
        process.env.TWILIO_AUTH_TOKEN
      )

      const account = await twilioClient.api
        .accounts(process.env.TWILIO_ACCOUNT_SID)
        .fetch()

      console.log(`OK Twilio reachable. Account status: ${account.status}`)
    } catch (twilioError: any) {
      console.error(`Twilio connection failed: ${twilioError?.message || String(twilioError)}`)
      process.exitCode = 1
    }
  }

  console.log('\n✅ Connectivity diagnostics completed.')
}

run().catch((error) => {
  console.error('Fatal error:', error)
  process.exitCode = 1
})
