/**
 * Expenses CSV generation for quarterly export.
 *
 * Queries expenses table for the calendar quarter and produces a CSV
 * with expense details and a summary header.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  escapeCsvCell,
  formatDateDdMmYyyy,
  formatCurrency,
  buildCsvBuffer,
} from './csv-helpers'

interface ExpenseRow {
  id: string
  expense_date: string
  company_ref: string
  justification: string
  amount: number
  vat_applicable: boolean
  vat_amount: number
  notes: string | null
  expense_files?: Array<{ id: string }> | null
}

export interface ExpensesSummary {
  totalEntries: number
  grossTotal: number
  vatTotal: number
}

/**
 * Queries expenses for the quarter and returns a CSV buffer + summary stats.
 */
export async function buildExpensesCsv(
  supabase: SupabaseClient,
  startDate: string,
  endDate: string,
  year: number,
  quarter: number
): Promise<{ csv: Buffer; summary: ExpensesSummary }> {
  const { data: expenses, error } = await supabase
    .from('expenses')
    .select('id, expense_date, company_ref, justification, amount, vat_applicable, vat_amount, notes, expense_files ( id )')
    .gte('expense_date', startDate)
    .lte('expense_date', endDate)
    .order('expense_date', { ascending: true })

  if (error) {
    console.error('Failed to fetch expenses for export:', error)
    throw new Error('Failed to load expenses data for export')
  }

  const rows = (expenses ?? []) as ExpenseRow[]

  const totalEntries = rows.length
  const grossTotal = rows.reduce((sum, e) => sum + Number(e.amount), 0)
  const vatTotal = rows.reduce((sum, e) => sum + (e.vat_applicable ? Number(e.vat_amount) : 0), 0)

  const summary: ExpensesSummary = { totalEntries, grossTotal, vatTotal }

  // Build CSV rows
  const summaryRows: string[][] = [
    ['Quarter', `Q${quarter} ${year}`],
    ['Total Entries', String(totalEntries)],
    ['Gross Total (GBP)', formatCurrency(grossTotal)],
    ['VAT Total (GBP)', formatCurrency(vatTotal)],
    [],
  ]

  const headerRow = [
    'Date',
    'Company',
    'Justification',
    'Amount (\u00A3)',
    'VAT Applicable',
    'VAT Amount (\u00A3)',
    'Has Receipt',
    'Notes',
  ]

  const dataRows = rows.map((expense) => {
    const hasReceipt = (expense.expense_files?.length ?? 0) > 0 ? 'Yes' : 'No'
    const notes = expense.notes?.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim() ?? ''

    return [
      formatDateDdMmYyyy(expense.expense_date),
      escapeCsvCell(expense.company_ref),
      escapeCsvCell(expense.justification),
      Number(expense.amount).toFixed(2),
      expense.vat_applicable ? 'Yes' : 'No',
      Number(expense.vat_amount).toFixed(2),
      hasReceipt,
      escapeCsvCell(notes),
    ]
  })

  const csvRows = [...summaryRows, headerRow, ...dataRows]
  const csv = buildCsvBuffer(csvRows)

  return { csv, summary }
}
