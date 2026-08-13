/**
 * Imports the owner's curated business contact list from the enriched spreadsheet.
 *
 * The spreadsheet contains personal data and must never be committed to this repository.
 * Pass its path as an argument.
 *
 *   npx tsx scripts/one-off/import-marketing-contacts-xlsx.ts "/path/to/Anchor_Christmas_Contacts_ENRICHED.xlsx"
 *   npx tsx scripts/one-off/import-marketing-contacts-xlsx.ts "/path/to/file.xlsx" --commit
 *
 * Without --commit it is a dry run and writes nothing.
 *
 * Every contact lands as eligibility_status = 'pending_review'. Nothing can be sent to any
 * of them until a human records a subscriber type and a lawful basis, which is deliberate:
 * an email domain cannot tell you whether the subscriber is a limited company (no PECR
 * consent needed) or a sole trader (consent or a full soft opt-in needed).
 */

import path from 'node:path'

import dotenv from 'dotenv'
import ExcelJS from 'exceljs'

// Loaded before the service is imported, because the admin client reads the service-role key
// at module load and a bare tsx run does not pick up .env.local on its own.
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

import { importContacts } from '@/services/marketing-contacts'

const SOURCE_LABEL = 'Anchor_Christmas_Contacts_ENRICHED.xlsx'
const HEADER_ROW = 4

interface ParsedRow {
  rowNumber: number
  email: string
  contactName?: string
  companyName?: string
  tags: string[]
  sourceDetail: string
  notes?: string
}

/** "Freight & cargo" becomes "freight-cargo", so tags are safe to use as audience filters. */
function slugifyTag(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function cellText(row: ExcelJS.Row, column: number): string {
  const value = row.getCell(column).text
  return typeof value === 'string' ? value.trim() : ''
}

async function main(): Promise<void> {
  const filePath = process.argv[2]
  const commit = process.argv.includes('--commit')

  if (!filePath) {
    console.error('Usage: tsx scripts/one-off/import-marketing-contacts-xlsx.ts <path to xlsx> [--commit]')
    process.exit(1)
  }

  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(filePath)

  const sheet = workbook.getWorksheet('Contacts')
  if (!sheet) {
    console.error('No "Contacts" worksheet in that file.')
    process.exit(1)
  }

  const headerRow = sheet.getRow(HEADER_ROW)
  const headers: Record<string, number> = {}
  for (let column = 1; column <= sheet.columnCount; column++) {
    const label = (headerRow.getCell(column).text || '').trim().toLowerCase()
    if (label) headers[label] = column
  }

  const required = ['email', 'company']
  const missing = required.filter((name) => !Object.keys(headers).some((h) => h.startsWith(name)))
  if (missing.length) {
    console.error(`Missing expected column(s): ${missing.join(', ')}`)
    process.exit(1)
  }

  const columnFor = (prefix: string): number | undefined =>
    headers[Object.keys(headers).find((h) => h.startsWith(prefix)) ?? '']

  const emailColumn = columnFor('email')
  const companyColumn = columnFor('company')
  const contactColumn = columnFor('contact')
  const segmentColumn = columnFor('segment')
  const groupColumn = columnFor('group')
  const notesColumn = columnFor('notes from source')

  const rows: ParsedRow[] = []

  for (let index = HEADER_ROW + 1; index <= sheet.rowCount; index++) {
    const row = sheet.getRow(index)
    const email = emailColumn ? cellText(row, emailColumn) : ''
    const company = companyColumn ? cellText(row, companyColumn) : ''

    // Trailing blank rows and any row without an address are simply not contacts.
    if (!email || !email.includes('@')) continue

    const tags = [
      segmentColumn ? cellText(row, segmentColumn) : '',
      groupColumn ? cellText(row, groupColumn) : '',
    ]
      .filter(Boolean)
      .map(slugifyTag)
      .filter(Boolean)

    rows.push({
      rowNumber: index,
      email,
      contactName: contactColumn ? cellText(row, contactColumn) || undefined : undefined,
      companyName: company || undefined,
      tags,
      sourceDetail: SOURCE_LABEL,
      notes: notesColumn ? cellText(row, notesColumn) || undefined : undefined,
    })
  }

  const tagCounts = new Map<string, number>()
  for (const row of rows) {
    for (const tag of row.tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1)
  }

  console.warn(`Parsed ${rows.length} contacts from ${SOURCE_LABEL}`)
  console.warn('Tags:')
  for (const [tag, count] of [...tagCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.warn(`  ${tag}: ${count}`)
  }

  if (!commit) {
    console.warn('\nDry run. Nothing written. Re-run with --commit to import.')
    return
  }

  const result = await importContacts({ rows, filename: SOURCE_LABEL }, null)

  console.warn('\nImport complete.')
  console.warn(`  imported:        ${result.imported}`)
  console.warn(`  skipped:         ${result.skipped}`)
  console.warn(`  flagged freemail:${result.flaggedFreemail}`)
  console.warn(`  batch id:        ${result.batchId}`)
  console.warn('\nEvery contact is pending_review. Set eligibility in the Marketing section before any send.')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
