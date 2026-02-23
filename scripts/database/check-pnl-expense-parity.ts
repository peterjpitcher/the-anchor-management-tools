#!/usr/bin/env tsx

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '../../src/lib/supabase/admin'
import { PNL_METRICS, PNL_TIMEFRAMES } from '../../src/lib/pnl/constants'
import { FinancialService } from '../../src/services/financials'
import type { ReceiptExpenseCategory } from '../../src/types/database'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const RECEIPT_PAGE_SIZE = 1000
const INCLUDED_STATUSES = ['pending', 'completed', 'auto_completed', 'no_receipt_required', 'cant_find']

type ReceiptExpenseRow = {
  id: string
  transaction_date: string | null
  expense_category: ReceiptExpenseCategory | null
  amount_out: number | null
}

function markFailure(message: string, error?: unknown) {
  process.exitCode = 1
  if (error) {
    console.error(`ERROR: ${message}`, error)
    return
  }
  console.error(`ERROR: ${message}`)
}

function roundCurrency(value: number): number {
  return Number(value.toFixed(2))
}

function isFiniteOutgoingAmount(value: number | null): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function getTwelveMonthStartDate(): string {
  const days = PNL_TIMEFRAMES.find((item) => item.key === '12m')?.days ?? 365
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - (days - 1))
  return start.toISOString().slice(0, 10)
}

async function fetchReceiptExpenseRows(startDate: string): Promise<ReceiptExpenseRow[]> {
  const supabase = createAdminClient()
  const rows: ReceiptExpenseRow[] = []

  for (let from = 0; ; from += RECEIPT_PAGE_SIZE) {
    const to = from + RECEIPT_PAGE_SIZE - 1
    const { data, error } = await (supabase.from('receipt_transactions') as any)
      .select('id, transaction_date, expense_category, amount_out')
      .gte('transaction_date', startDate)
      .in('status', INCLUDED_STATUSES)
      .order('transaction_date', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to)

    if (error) {
      throw new Error(error.message || 'Failed to load receipt transactions for parity check')
    }

    if (!data?.length) {
      break
    }

    rows.push(...(data as ReceiptExpenseRow[]))

    if (data.length < RECEIPT_PAGE_SIZE) {
      break
    }
  }

  return rows
}

async function checkPnlExpenseParity() {
  const argv = process.argv
  if (argv.includes('--confirm')) {
    throw new Error('check-pnl-expense-parity is strictly read-only; do not pass --confirm.')
  }

  const expenseMetricMap = new Map<ReceiptExpenseCategory, string>()
  PNL_METRICS
    .filter((metric) => metric.type === 'expense' && metric.expenseCategory)
    .forEach((metric) => {
      expenseMetricMap.set(metric.expenseCategory as ReceiptExpenseCategory, metric.key)
    })

  const startDate = getTwelveMonthStartDate()
  const rows = await fetchReceiptExpenseRows(startDate)

  let fullPaginatedTotal = 0
  for (const row of rows) {
    if (!row.transaction_date || row.transaction_date < startDate) {
      continue
    }
    if (!row.expense_category || !expenseMetricMap.has(row.expense_category)) {
      continue
    }
    if (!isFiniteOutgoingAmount(row.amount_out)) {
      continue
    }
    fullPaginatedTotal += row.amount_out
  }

  const fullPaginatedRounded = roundCurrency(fullPaginatedTotal)
  const serviceData = await FinancialService.getPlDashboardData()
  const serviceRounded = roundCurrency(serviceData.expenseTotals['12m'] ?? 0)
  const delta = roundCurrency(serviceRounded - fullPaginatedRounded)

  console.log('P&L 12m expense parity check')
  console.log(`Start date: ${startDate}`)
  console.log(`Rows scanned: ${rows.length}`)
  console.log(`FinancialService 12m expenses: £${serviceRounded.toFixed(2)}`)
  console.log(`Direct paginated 12m expenses: £${fullPaginatedRounded.toFixed(2)}`)
  console.log(`Delta: £${delta.toFixed(2)}`)

  if (Math.abs(delta) > 0.01) {
    throw new Error(
      `Mismatch detected: FinancialService differs from direct paginated aggregation by £${delta.toFixed(2)}`
    )
  }

  console.log('PASS: FinancialService matches direct paginated 12m total.')
}

void checkPnlExpenseParity().catch((error) => {
  markFailure('check-pnl-expense-parity failed.', error)
})
