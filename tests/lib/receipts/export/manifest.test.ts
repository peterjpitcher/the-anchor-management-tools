import { describe, expect, it } from 'vitest'
import Papa from 'papaparse'
import {
  buildExportManifest,
  buildManifestCsv,
  buildMissingFilesText,
  buildReceiptsSummaryCsv,
  manifestFingerprint,
  type ExportPayment,
} from '@/lib/receipts/export/manifest'

type FileSeed = { id: string; name?: string; hash?: string | null; source?: 'upload' | 'invoice' }

function payment(id: string, overrides: Record<string, unknown> = {}, files: FileSeed[] = []): ExportPayment {
  return {
    id,
    transaction_date: '2026-07-14',
    details: 'CARD PAYMENT TESCO',
    transaction_type: 'Card',
    vendor_name: 'Tesco',
    vendor_source: 'rule',
    expense_category: 'Total Staff',
    expense_category_source: 'manual',
    ai_confidence: null,
    amount_in: null,
    amount_out: 12.5,
    status: 'completed',
    notes: null,
    completed_reason: null,
    no_category_applies: false,
    source_type: 'bank',
    card_member: null,
    receipt_files: files.map((file) => ({
      id: file.id,
      transaction_id: id,
      storage_path: `2026/${file.id}.pdf`,
      file_name: file.name ?? `${file.id}.pdf`,
      content_hash: file.hash === undefined ? `hash-${file.id}` : file.hash,
      source: file.source ?? 'upload',
    })),
    ...overrides,
  } as unknown as ExportPayment
}

function parse(buffer: Buffer): string[][] {
  const text = buffer.toString('utf-8')
  expect(text.charCodeAt(0)).toBe(0xfeff)
  return Papa.parse<string[]>(text.slice(1)).data
}

const PERIOD = { year: 2026, quarter: 3 }
const NOW = new Date('2026-10-01T13:30:00Z')

describe('the manifest of a quarterly receipts pack', () => {
  it('lists every file of every payment, in the order they were read', () => {
    const manifest = buildExportManifest([
      payment('p1', {}, [{ id: 'f1' }, { id: 'f2', name: 'photo.JPG' }]),
      payment('p2'),
      payment('p3', { vendor_name: null, amount_out: null, amount_in: 40 }, [{ id: 'f3' }]),
    ])

    expect(manifest.payments.map((entry) => entry.id)).toEqual(['p1', 'p2', 'p3'])
    expect(manifest.files.map((file) => [file.transactionId, file.fileId, file.storagePath])).toEqual([
      ['p1', 'f1', '2026/f1.pdf'],
      ['p1', 'f2', '2026/f2.pdf'],
      ['p3', 'f3', '2026/f3.pdf'],
    ])
    expect(manifest.files[1].zipPath).toBe('receipts/2026-07-14 - £12.50 - Tesco - f2.jpg')
    expect(manifest.files[2].zipPath).toBe('receipts/2026-07-14 - £40.00 - Unknown Vendor - f3.pdf')
    // No two files share a place in the ZIP.
    expect(new Set(manifest.files.map((file) => file.zipPath)).size).toBe(manifest.files.length)
  })

  it('marks an uploaded file that sits on more than one payment', () => {
    const manifest = buildExportManifest([
      payment('p1', {}, [{ id: 'f1', hash: 'same' }]),
      payment('p2', {}, [{ id: 'f2', hash: 'same' }]),
      payment('p3', {}, [{ id: 'f3', hash: 'same' }, { id: 'f4', hash: 'other' }]),
    ])

    expect(manifest.files.map((file) => file.sharedWith)).toEqual([2, 2, 2, 0])
  })

  it('does not count the same file twice on one payment, or a file with no hash', () => {
    const manifest = buildExportManifest([
      payment('p1', {}, [{ id: 'f1', hash: 'same' }, { id: 'f2', hash: 'same' }]),
      payment('p2', {}, [{ id: 'f3', hash: null }]),
      payment('p3', {}, [{ id: 'f4', hash: null }]),
    ])

    expect(manifest.files.map((file) => file.sharedWith)).toEqual([0, 0, 0, 0])
  })

  it('never calls an invoice copy shared: one invoice paid in parts is expected', () => {
    const manifest = buildExportManifest([
      payment('p1', {}, [{ id: 'f1', hash: 'inv', source: 'invoice' }]),
      payment('p2', {}, [{ id: 'f2', hash: 'inv', source: 'invoice' }]),
    ])

    expect(manifest.files.map((file) => [file.source, file.sharedWith])).toEqual([
      ['invoice', 0],
      ['invoice', 0],
    ])
  })
})

describe('the fingerprint of a pack', () => {
  const base = [
    { id: 'p1', receipt_files: [{ id: 'f1' }, { id: 'f2' }] },
    { id: 'p2', receipt_files: [] },
  ]

  it('is the same whatever order the rows come back in', () => {
    const shuffled = [
      { id: 'p2', receipt_files: null },
      { id: 'p1', receipt_files: [{ id: 'f2' }, { id: 'f1' }] },
    ]

    expect(manifestFingerprint(shuffled)).toBe(manifestFingerprint(base))
  })

  it('changes when a file is added, removed or a payment arrives', () => {
    const print = manifestFingerprint(base)

    expect(manifestFingerprint([{ id: 'p1', receipt_files: [{ id: 'f1' }] }, base[1]])).not.toBe(print)
    expect(manifestFingerprint([base[0], { id: 'p2', receipt_files: [{ id: 'f9' }] }])).not.toBe(print)
    expect(manifestFingerprint([...base, { id: 'p3', receipt_files: [] }])).not.toBe(print)
    expect(manifestFingerprint([base[0]])).not.toBe(print)
  })
})

describe('the summary spreadsheet', () => {
  it('counts what the pack holds and what it is missing', () => {
    const manifest = buildExportManifest([
      payment('p1', {}, [{ id: 'f1' }, { id: 'f2' }]),
      payment('p2', { status: 'completed', completed_reason: 'Paid in cash,\nno till receipt' }),
      payment('p3', { status: 'pending', amount_out: null, amount_in: 100 }),
      payment('p4', { status: 'cant_find', amount_out: 7.5 }),
    ])
    const missing = [{ file: manifest.files[1], reason: 'Object not found' }]

    const rows = parse(buildReceiptsSummaryCsv(manifest, PERIOD, { now: NOW, missing }))
    const summary = Object.fromEntries(rows.slice(0, 13).map((row) => [row[0], row[1]]))

    expect(summary).toMatchObject({
      Quarter: 'Q3 2026',
      'Generated at (London time)': '01 Oct 2026, 14:30',
      'Total transactions': '4',
      'Total in (GBP)': '100.00',
      'Total out (GBP)': '32.50',
      Completed: '2',
      'Completed without a receipt': '1',
      "Can't find": '1',
      Pending: '1',
      'Receipt files in this pack': '1',
      'Receipt files missing from this pack': '1',
    })
  })

  it('writes one row per payment with its reason, its files and where its fields came from', () => {
    const manifest = buildExportManifest([
      payment('p1', { vendor_source: 'ai', expense_category_source: 'ai_accepted', ai_confidence: 88 }, [
        { id: 'f1', name: 'till.pdf' },
        { id: 'f2', name: 'card slip.jpg' },
      ]),
      payment('p2', {
        expense_category: null,
        no_category_applies: true,
        completed_reason: 'Paid in cash,\nno till receipt',
        notes: 'line one\r\nline two',
        source_type: 'amex',
        card_member: 'P PITCHER',
      }),
    ])

    const rows = parse(buildReceiptsSummaryCsv(manifest, PERIOD, { now: NOW }))
    const header = rows.find((row) => row[0] === 'Date') as string[]
    const data = rows.slice(rows.indexOf(header) + 1).filter((row) => row.length > 1)
    const cell = (row: string[], column: string) => row[header.indexOf(column)]

    expect(data).toHaveLength(2)
    expect(cell(data[0], 'Date')).toBe('14/07/2026')
    expect(cell(data[0], 'Vendor source')).toBe('AI')
    expect(cell(data[0], 'Expense category source')).toBe('AI, accepted')
    expect(cell(data[0], 'AI confidence')).toBe('88')
    expect(cell(data[0], 'Amount out (GBP)')).toBe('12.50')
    expect(cell(data[0], 'Has receipt')).toBe('Yes')
    expect(cell(data[0], 'Receipt files')).toBe('till.pdf; card slip.jpg')
    expect(cell(data[0], 'Source')).toBe('Bank')

    expect(cell(data[1], 'Expense category')).toBe('No category applies')
    expect(cell(data[1], 'Has receipt')).toBe('No')
    expect(cell(data[1], 'Completed reason')).toBe('Paid in cash, no till receipt')
    expect(cell(data[1], 'Notes')).toBe('line one line two')
    expect(cell(data[1], 'Source')).toBe('Amex')
    expect(cell(data[1], 'Cardholder')).toBe('P PITCHER')
  })

  it('does not let bank text start a formula', () => {
    const manifest = buildExportManifest([
      payment('p1', { details: '=cmd|calc', vendor_name: '+Evil', completed_reason: ' @reason', notes: '-1+2' }),
    ])

    const rows = parse(buildReceiptsSummaryCsv(manifest, PERIOD, { now: NOW }))
    const header = rows.find((row) => row[0] === 'Date') as string[]
    const row = rows[rows.indexOf(header) + 1]

    for (const column of ['Details', 'Vendor', 'Completed reason', 'Notes']) {
      expect(row[header.indexOf(column)].startsWith('\t')).toBe(true)
    }
  })
})

describe('MANIFEST.csv', () => {
  it('names every file and says which are not in the pack, and why', () => {
    const manifest = buildExportManifest([
      payment('p1', {}, [{ id: 'f1', hash: 'same' }, { id: 'f2', source: 'invoice', name: 'Invoice INV-0042.pdf' }]),
      payment('p2', {}, [{ id: 'f3', hash: 'same' }]),
    ])
    const missing = [{ file: manifest.files[2], reason: 'Object not found' }]

    const rows = parse(buildManifestCsv(manifest, PERIOD, { now: NOW, missing }))
    const head = Object.fromEntries(rows.slice(0, 6).map((row) => [row[0], row[1]]))
    const header = rows.find((row) => row[0] === 'File in pack') as string[]
    const data = rows.slice(rows.indexOf(header) + 1).filter((row) => row.length > 1)
    const cell = (row: string[], column: string) => row[header.indexOf(column)]

    expect(head).toMatchObject({
      Quarter: 'Q3 2026',
      Transactions: '2',
      'Files listed': '3',
      'Files in this pack': '2',
      'Files missing': '1',
    })
    expect(data).toHaveLength(3)
    expect(data.map((row) => cell(row, 'In pack'))).toEqual(['Yes', 'Yes', 'No'])
    expect(cell(data[2], 'Why not')).toBe('Object not found')
    expect(data.map((row) => cell(row, 'Kind'))).toEqual(['Receipt', 'Invoice copy', 'Receipt'])
    expect(cell(data[1], 'Original name')).toBe('Invoice INV-0042.pdf')
    expect(data.map((row) => cell(row, 'Also on other transactions'))).toEqual(['1', '', '1'])
    expect(data.map((row) => cell(row, 'Transaction reference'))).toEqual(['p1', 'p1', 'p2'])
    expect(cell(data[0], 'File in pack')).toBe(manifest.files[0].zipPath)
  })
})

describe('MISSING_FILES.txt', () => {
  it('says in plain words which payments are short of a file', () => {
    const manifest = buildExportManifest([
      payment('p1', { details: 'CARD PAYMENT\nTESCO  EXTRA' }, [{ id: 'f1', name: 'till.pdf' }]),
      payment('p2', { amount_out: null, amount_in: 1234.5 }, [{ id: 'f2', name: 'remittance.pdf' }]),
    ])

    const text = buildMissingFilesText(
      [
        { file: manifest.files[0], reason: 'Object not found' },
        { file: manifest.files[1], reason: 'The file is empty' },
      ],
      PERIOD
    )

    expect(text).toContain('Receipts pack for Q3 2026: 2 files could not be included.')
    expect(text).toContain('- 14/07/2026  CARD PAYMENT TESCO EXTRA  12.50')
    expect(text).toContain('    file: till.pdf')
    expect(text).toContain('    why: Object not found')
    expect(text).toContain('- 14/07/2026  CARD PAYMENT TESCO  1,234.50')
    expect(text).toContain('    why: The file is empty')
    expect(text.endsWith('\n')).toBe(true)
  })

  it('says "1 file" for one', () => {
    const manifest = buildExportManifest([payment('p1', {}, [{ id: 'f1' }])])

    expect(buildMissingFilesText([{ file: manifest.files[0], reason: 'x' }], PERIOD)).toContain('1 file could not be included.')
  })
})
