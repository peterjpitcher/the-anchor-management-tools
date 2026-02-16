#!/usr/bin/env tsx

/**
 * Read-only diagnostics for employee table connectivity.
 *
 * This script used to insert/delete employee records using the service-role key.
 * Keep scripts in this repo strictly read-only by default to avoid accidental
 * production DB mutations during incident response.
 */

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertScriptQuerySucceeded } from '@/lib/script-mutation-safety'

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })
const SCRIPT_NAME = 'test-employee-creation'

async function readSample(params: {
  supabase: ReturnType<typeof createAdminClient>
  table: string
  columns: string
}) {
  const { data, error } = await supabase
    .from(params.table)
    .select(params.columns)
    .limit(1)
    .maybeSingle()

  return assertScriptQuerySucceeded({
    operation: `Read ${params.table}`,
    error,
    data,
    allowMissing: true,
  })
}

async function testEmployeeTables() {
  if (process.argv.includes('--confirm')) {
    throw new Error('This script is read-only and does not support --confirm.')
  }

  console.log('Employee table diagnostics (read-only)\n')

  const supabase = createAdminClient()

  const employees = await readSample({
    supabase,
    table: 'employees',
    columns: 'employee_id, first_name, last_name, status, created_at',
  })
  console.log('employees:', employees ? '✅ readable' : '✅ readable (no rows)')

  const financial = await readSample({
    supabase,
    table: 'employee_financial_details',
    columns: 'employee_id, ni_number, bank_name',
  })
  console.log(
    'employee_financial_details:',
    financial ? '✅ readable' : '✅ readable (no rows)',
  )

  const health = await readSample({
    supabase,
    table: 'employee_health_records',
    columns: 'employee_id, doctor_name, has_diabetes, is_registered_disabled',
  })
  console.log(
    'employee_health_records:',
    health ? '✅ readable' : '✅ readable (no rows)',
  )

  console.log('\n✅ Employee table diagnostics complete.')
}

testEmployeeTables().catch((error: unknown) => {
  console.error(`[${SCRIPT_NAME}] Fatal error:`, error)
  process.exitCode = 1
})
