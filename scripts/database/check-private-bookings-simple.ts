#!/usr/bin/env tsx
/**
 * Check Private Bookings Schema (Simple Version)
 *
 * This script checks the database schema for the private_bookings table
 * to determine if guest_count or guest_badge column exists.
 */

import * as dotenv from 'dotenv'
import { resolve } from 'path'
import { createAdminClient } from '../../src/lib/supabase/admin'

dotenv.config({ path: resolve(process.cwd(), '.env.local') })

function markFailure(message: string, error?: unknown) {
  process.exitCode = 1
  if (error) {
    console.error(`❌ ${message}`, error)
    return
  }
  console.error(`❌ ${message}`)
}

function isMissingColumnError(message: string, column: string): boolean {
  const normalized = message.toLowerCase()
  const needle = column.toLowerCase()
  if (!normalized.includes(needle)) {
    return false
  }
  return (
    normalized.includes('does not exist') ||
    normalized.includes('could not find') ||
    normalized.includes('schema cache') ||
    normalized.includes('unknown column')
  )
}

async function probeColumn(supabase: any, table: string, column: string): Promise<boolean> {
  const { error } = await supabase.from(table).select(column).limit(1)
  if (!error) {
    return true
  }
  const message = error.message || 'unknown database error'
  if (isMissingColumnError(message, column)) {
    return false
  }
  throw new Error(`Failed probing ${table}.${column}: ${message}`)
}

async function checkSchema() {
  const argv = process.argv
  if (argv.includes('--help')) {
    console.log(`
check-private-bookings-simple (read-only)

Usage:
  ts-node scripts/database/check-private-bookings-simple.ts
`)
    return
  }

  console.log('Checking private_bookings table schema...\n')

  const supabase = createAdminClient()

  const { error: pingError } = await supabase.from('private_bookings').select('id').limit(1)
  if (pingError) {
    throw new Error(`Failed to access private_bookings: ${pingError.message || 'unknown error'}`)
  }

  const guestCountExists = await probeColumn(supabase, 'private_bookings', 'guest_count')
  const guestBadgeExists = await probeColumn(supabase, 'private_bookings', 'guest_badge')

  console.log(`guest_count column: ${guestCountExists ? 'present' : 'missing'}`)
  console.log(`guest_badge column: ${guestBadgeExists ? 'present' : 'missing'}`)

  if (!guestCountExists && !guestBadgeExists) {
    throw new Error('Neither guest_count nor guest_badge columns appear to exist on private_bookings')
  }
}

checkSchema().catch((error) => markFailure('check-private-bookings-simple failed', error))
