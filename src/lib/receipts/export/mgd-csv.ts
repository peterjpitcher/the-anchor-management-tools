/**
 * MGD (Machine Games Duty) CSV generation for quarterly export.
 *
 * Uses getCalendarQuarterMgdOverlap to map the calendar quarter to the
 * overlapping HMRC MGD period, then queries mgd_collections for that range.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  formatDateDdMmYyyy,
  formatCurrency,
  buildCsvBuffer,
} from './csv-helpers'
import { getCalendarQuarterMgdOverlap } from '@/lib/mgd/quarterMapping'

export interface MgdCollectionRow {
  id: string
  collection_date: string
  net_take: number
  mgd_amount: number
  vat_on_supplier: number
}

export interface MgdSummary {
  periodStart: string
  periodEnd: string
  periodLabel: string
  totalCollections: number
  totalNetTake: number
  totalMgd: number
  totalVatOnSupplier: number
}

/**
 * Returns a short label for the MGD period, e.g. "FebApr" for Feb-Apr.
 */
function mgdPeriodShortLabel(periodStart: string, periodEnd: string): string {
  const startDate = new Date(periodStart + 'T00:00:00Z')
  const endDate = new Date(periodEnd + 'T00:00:00Z')
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[startDate.getUTCMonth()]}${months[endDate.getUTCMonth()]}`
}

/**
 * Returns a readable label for the MGD period, e.g. "1 Feb 2026 — 30 Apr 2026".
 */
function mgdPeriodLongLabel(periodStart: string, periodEnd: string): string {
  const startDate = new Date(periodStart + 'T00:00:00Z')
  const endDate = new Date(periodEnd + 'T00:00:00Z')
  const fmt = (d: Date): string =>
    d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
  return `${fmt(startDate)} \u2014 ${fmt(endDate)}`
}

/**
 * Queries MGD collections for the overlapping MGD period and returns a CSV buffer + summary.
 */
export async function buildMgdCsv(
  supabase: SupabaseClient,
  year: number,
  quarter: 1 | 2 | 3 | 4
): Promise<{ csv: Buffer; summary: MgdSummary; fileName: string; rows: MgdCollectionRow[] }> {
  const { periodStart, periodEnd } = getCalendarQuarterMgdOverlap(year, quarter)

  const { data: collections, error } = await supabase
    .from('mgd_collections')
    .select('id, collection_date, net_take, mgd_amount, vat_on_supplier')
    .gte('collection_date', periodStart)
    .lte('collection_date', periodEnd)
    .order('collection_date', { ascending: true })

  if (error) {
    console.error('Failed to fetch MGD collections for export:', error)
    throw new Error('Failed to load MGD data for export')
  }

  const rows = (collections ?? []) as MgdCollectionRow[]

  const totalCollections = rows.length
  const totalNetTake = rows.reduce((sum, c) => sum + Number(c.net_take), 0)
  const totalMgd = rows.reduce((sum, c) => sum + Number(c.mgd_amount), 0)
  const totalVatOnSupplier = rows.reduce((sum, c) => sum + Number(c.vat_on_supplier), 0)

  const periodLabel = mgdPeriodLongLabel(periodStart, periodEnd)
  const shortLabel = mgdPeriodShortLabel(periodStart, periodEnd)

  const summary: MgdSummary = {
    periodStart,
    periodEnd,
    periodLabel,
    totalCollections,
    totalNetTake,
    totalMgd,
    totalVatOnSupplier,
  }

  // Determine the year to use in the filename.
  // Use the year from periodStart (the year the MGD period begins).
  const periodYear = new Date(periodStart + 'T00:00:00Z').getUTCFullYear()
  const fileName = `MGD_${shortLabel}_${periodYear}.csv`

  // Build CSV rows
  const summaryRows: string[][] = [
    ['Quarter', `MGD Period: ${periodLabel}`],
    ['Total Collections', String(totalCollections)],
    ['Total Net Take (GBP)', formatCurrency(totalNetTake)],
    ['Total MGD 20% (GBP)', formatCurrency(totalMgd)],
    ['Total VAT on Supplier (GBP)', formatCurrency(totalVatOnSupplier)],
    [],
  ]

  const headerRow = [
    'Collection Date',
    'Net Take (\u00A3)',
    'MGD 20% (\u00A3)',
    'VAT on Supplier (\u00A3)',
  ]

  const dataRows = rows.map((c) => [
    formatDateDdMmYyyy(c.collection_date),
    Number(c.net_take).toFixed(2),
    Number(c.mgd_amount).toFixed(2),
    Number(c.vat_on_supplier).toFixed(2),
  ])

  const csvRows = [...summaryRows, headerRow, ...dataRows]
  const csv = buildCsvBuffer(csvRows)

  return { csv, summary, fileName, rows }
}
