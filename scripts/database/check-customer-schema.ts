#!/usr/bin/env tsx

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '../../src/lib/supabase/admin'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const HARD_CAP = 5

function markFailure(message: string, error?: unknown) {
  process.exitCode = 1
  if (error) {
    console.error(`ERROR: ${message}`, error)
    return
  }
  console.error(`ERROR: ${message}`)
}

function parseBoundedInt(params: {
  argv: string[]
  flag: string
  defaultValue: number
  hardCap: number
}): number {
  const idx = params.argv.indexOf(params.flag)
  if (idx === -1) {
    return params.defaultValue
  }

  const raw = params.argv[idx + 1]
  const parsed = Number.parseInt(raw || '', 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${params.flag} must be a positive integer (got '${raw || ''}')`)
  }
  if (parsed > params.hardCap) {
    throw new Error(`${params.flag} too high (got ${parsed}, hard cap ${params.hardCap})`)
  }
  return parsed
}

function maskEmail(email: string): string {
  const at = email.indexOf('@')
  if (at <= 1) {
    return '***'
  }
  return `${email.slice(0, 1)}***${email.slice(at)}`
}

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 4) {
    return '***'
  }
  return `***${digits.slice(-4)}`
}

async function checkCustomerSchema() {
  const argv = process.argv
  if (argv.includes('--confirm')) {
    throw new Error('check-customer-schema is strictly read-only; do not pass --confirm.')
  }

  const showSample = argv.includes('--show-sample')
  const limit = parseBoundedInt({ argv, flag: '--limit', defaultValue: 1, hardCap: HARD_CAP })

  console.log('Checking customers schema...\n')
  console.log(`Show sample: ${showSample ? 'yes' : 'no'}`)
  console.log(`Limit: ${limit} (hard cap ${HARD_CAP})\n`)

  const supabase = createAdminClient()

  const { error: emailError } = await supabase.from('customers').select('email').limit(1)
  if (emailError) {
    if (emailError.message.includes('column') && emailError.message.includes('does not exist')) {
      console.log('Result: customers.email column is MISSING')
      return
    }
    throw new Error(`Query customers.email failed: ${emailError.message || 'unknown error'}`)
  }

  console.log('Result: customers.email column EXISTS')

  if (!showSample) {
    return
  }

  const { data: sampleRows, error: sampleError } = await supabase
    .from('customers')
    .select('id, email, mobile_number')
    .limit(limit)

  if (sampleError) {
    throw new Error(`Load customers sample failed: ${sampleError.message || 'unknown error'}`)
  }

  const rows = (sampleRows ?? []) as Array<{ id?: unknown; email?: unknown; mobile_number?: unknown }>
  if (rows.length === 0) {
    console.log('\nSample: no customers returned.')
    return
  }

  console.log('\nSample rows (PII masked):')
  rows.forEach((row) => {
    const emailRaw = typeof row.email === 'string' ? row.email : ''
    const phoneRaw = typeof row.mobile_number === 'string' ? row.mobile_number : ''
    console.log(
      `  - id=${String(row.id || 'unknown')} email=${emailRaw ? maskEmail(emailRaw) : 'none'} phone=${phoneRaw ? maskPhone(phoneRaw) : 'none'}`
    )
  })
}

void checkCustomerSchema().catch((error) => {
  markFailure('check-customer-schema failed.', error)
})
