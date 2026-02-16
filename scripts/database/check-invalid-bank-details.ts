#!/usr/bin/env tsx

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '../../src/lib/supabase/admin'
import { assertScriptQuerySucceeded } from '../../src/lib/script-mutation-safety'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

function markFailure(message: string, error?: unknown) {
  process.exitCode = 1
  if (error) {
    console.error(`❌ ${message}`, error)
    return
  }
  console.error(`❌ ${message}`)
}

// UK bank validation patterns from the migration
const accountNumberRegex = /^[0-9]{8}$/
const sortCodeRegex = /^[0-9]{2}-?[0-9]{2}-?[0-9]{2}$/

async function checkInvalidBankDetails() {
  const argv = process.argv
  if (argv.includes('--confirm')) {
    throw new Error('check-invalid-bank-details is strictly read-only; do not pass --confirm.')
  }

  const supabase = createAdminClient()

  console.log('Checking for employees with invalid bank details...\n')

  // Get all employee financial details
  const { data: financialDetailsRows, error } = await supabase
    .from('employee_financial_details')
    .select(
      `
        id,
        employee_id,
        bank_account_number,
        bank_sort_code,
        employees!inner(first_name, last_name)
      `
    )
    .order('created_at', { ascending: true })

  const financialDetails = (assertScriptQuerySucceeded({
    operation: 'Load employee financial details',
    error,
    data: financialDetailsRows ?? [],
    allowMissing: true
  }) ?? []) as Array<{
    employee_id: string | null
    bank_account_number: string | null
    bank_sort_code: string | null
    employees: { first_name: string | null; last_name: string | null } | null
  }>

  const invalidDetails: Array<{
    employeeId: string
    accountNumber: string | null
    sortCode: string | null
    employeeName: string
    issues: string[]
  }> = []

  for (const detail of financialDetails) {
    const employeeId = detail.employee_id || 'unknown'
    const employeeName = detail.employees
      ? `${detail.employees.first_name || ''} ${detail.employees.last_name || ''}`.trim() || 'unknown'
      : 'unknown'

    const issues: string[] = []

    // Check account number
    if (detail.bank_account_number && !accountNumberRegex.test(detail.bank_account_number)) {
      issues.push(`Invalid account number: "${detail.bank_account_number}" (should be 8 digits)`)
    }

    // Check sort code
    if (detail.bank_sort_code && !sortCodeRegex.test(detail.bank_sort_code)) {
      issues.push(`Invalid sort code: "${detail.bank_sort_code}" (should be XX-XX-XX or XXXXXX)`)
    }

    if (issues.length > 0) {
      invalidDetails.push({
        employeeId,
        employeeName,
        accountNumber: detail.bank_account_number,
        sortCode: detail.bank_sort_code,
        issues
      })
    }
  }

  console.log(`Total financial records: ${financialDetails.length}`)
  console.log(`Records with invalid bank details: ${invalidDetails.length}\n`)

  if (invalidDetails.length > 0) {
    process.exitCode = 1

    console.log('Invalid bank details found:')
    console.log('=====================================')

    invalidDetails.forEach((detail, index) => {
      console.log(`\n${index + 1}. ${detail.employeeName} (Employee ID: ${detail.employeeId})`)

      detail.issues.forEach((issue) => {
        console.log(`   - ${issue}`)

        if (issue.includes('account number') && detail.accountNumber) {
          const cleaned = detail.accountNumber.replace(/[^0-9]/g, '')
          console.log(`     Suggested: "${cleaned}" (${cleaned.length} digits)`)

          if (cleaned.length < 8) {
            console.log(`     WARNING: Account number too short (${cleaned.length} digits, need 8)`)
          } else if (cleaned.length > 8) {
            console.log(`     WARNING: Account number too long (${cleaned.length} digits, need 8)`)
            console.log(`     Maybe try: "${cleaned.substring(0, 8)}" or "${cleaned.substring(cleaned.length - 8)}"`)
          }
        }

        if (issue.includes('sort code') && detail.sortCode) {
          const cleaned = detail.sortCode.replace(/[^0-9]/g, '')

          if (cleaned.length === 6) {
            const formatted = `${cleaned.substring(0, 2)}-${cleaned.substring(2, 4)}-${cleaned.substring(4, 6)}`
            console.log(`     Suggested: "${formatted}"`)
          } else {
            console.log(`     WARNING: Sort code has wrong length (${cleaned.length} digits, need 6)`)
          }
        }
      })
    })

    console.log('\n=====================================')
    console.log('\nTo fix these issues, you can either:')
    console.log('1. Run the cleanup script to auto-fix bank details')
    console.log('2. Update the migration to clean data before applying constraints')
    console.log('3. Manually fix the bank details in the database')
    console.log('\nNote: UK bank account numbers should be exactly 8 digits')
    console.log('      UK sort codes should be 6 digits (formatted as XX-XX-XX)')
  } else {
    console.log('✅ All bank details are valid!')
  }

  if (process.exitCode === 1) {
    console.log('\n❌ Bank details check completed with failures.')
  } else {
    console.log('\n✅ Bank details check complete!')
  }
}

void checkInvalidBankDetails().catch((error) => {
  markFailure('check-invalid-bank-details failed.', error)
})
