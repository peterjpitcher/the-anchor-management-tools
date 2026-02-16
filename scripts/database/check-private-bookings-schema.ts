#!/usr/bin/env tsx
/**
 * Check Private Bookings Schema
 *
 * Read-only diagnostics to determine whether guest_count / guest_badge columns
 * exist on the private_bookings table.
 *
 * Safety:
 * - No DB mutations.
 * - Fails closed on query/RPC errors (non-zero exit).
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

async function probeColumn(params: {
  supabase: ReturnType<typeof createAdminClient>
  table: string
  column: string
}): Promise<boolean> {
  const { error } = await params.supabase.from(params.table).select(params.column).limit(1)
  if (!error) {
    return true
  }

  const message = error.message || 'unknown database error'
  if (isMissingColumnError(message, params.column)) {
    return false
  }

  throw new Error(`Failed probing ${params.table}.${params.column}: ${message}`)
}

async function run() {
  if (process.argv.includes('--help')) {
    console.log(`
check-private-bookings-schema (read-only)

Usage:
  tsx scripts/database/check-private-bookings-schema.ts
`)
    return
  }

  console.log('🔍 Checking private_bookings table schema (read-only)...\n')

  const supabase = createAdminClient()

  const { error: pingError } = await supabase.from('private_bookings').select('id').limit(1)
  if (pingError) {
    throw new Error(`Failed to access private_bookings: ${pingError.message || 'unknown error'}`)
  }

  // Prefer `get_table_columns` when available (works even when table is empty).
  let columns: string[] | null = null
  const { data: rpcColumns, error: rpcError } = await supabase
    .rpc('get_table_columns', { table_name: 'private_bookings' })
    .select('*')

  if (!rpcError && Array.isArray(rpcColumns)) {
    const names = rpcColumns
      .map((row) => (row && typeof row === 'object' ? (row as any).column_name : null))
      .filter((name): name is string => typeof name === 'string' && name.length > 0)

    if (names.length > 0) {
      columns = names
      console.log(`✅ Found ${names.length} column(s) via get_table_columns()`)
    }
  }

  if (!columns) {
    const { data: sampleRows, error: sampleError } = await supabase
      .from('private_bookings')
      .select('*')
      .limit(1)

    if (sampleError) {
      throw new Error(`Failed sampling private_bookings: ${sampleError.message || 'unknown error'}`)
    }

    if (Array.isArray(sampleRows) && sampleRows.length > 0 && sampleRows[0] && typeof sampleRows[0] === 'object') {
      columns = Object.keys(sampleRows[0] as Record<string, unknown>)
      console.log(`✅ Inferred ${columns.length} column(s) from a sample row`)
    } else {
      console.log('ℹ️ private_bookings table is empty; falling back to column probes.')
    }
  }

  const guestCountExists = columns
    ? columns.includes('guest_count')
    : await probeColumn({ supabase, table: 'private_bookings', column: 'guest_count' })

  const guestBadgeExists = columns
    ? columns.includes('guest_badge')
    : await probeColumn({ supabase, table: 'private_bookings', column: 'guest_badge' })

  console.log('')
  console.log(`guest_count column: ${guestCountExists ? 'present' : 'missing'}`)
  console.log(`guest_badge column: ${guestBadgeExists ? 'present' : 'missing'}`)

  if (!guestCountExists && !guestBadgeExists) {
    throw new Error('Neither guest_count nor guest_badge columns appear to exist on private_bookings')
  }
}

run().catch((error) => markFailure('check-private-bookings-schema failed', error))
