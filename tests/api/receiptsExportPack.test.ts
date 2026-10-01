// @vitest-environment node
import JSZip from 'jszip'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The quarterly receipts pack, opened and read: every file is in it or named as missing, the
 * read is paged, a quarter that moves while the pack is built is refused, and taking a pack is
 * recorded.
 */

type Row = Record<string, any>

const mocks = vi.hoisted(() => ({
  state: {
    /** What each read of the quarter returns. The last entry is reused once the list runs out. */
    reads: [] as Row[][],
    readCount: 0,
    ranges: [] as Array<[number, number]>,
    selects: [] as string[],
    failRead: null as number | null,
    roles: [] as Array<{ roles: { name: string } }>,
    objects: new Map<string, Uint8Array | null>(),
    downloads: [] as string[],
  },
  checkUserPermission: vi.fn(),
  getUser: vi.fn(),
  logAuditEvent: vi.fn(),
  buildQuarterMileageFiles: vi.fn(),
  appendExpenseImages: vi.fn(),
  appendClaimSummaryPdf: vi.fn(),
}))

vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: mocks.checkUserPermission }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: mocks.logAuditEvent }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser } }) }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const chain: Row = {}
      let select = ''
      let range: [number, number] = [0, 999]
      for (const method of ['gte', 'lte', 'order', 'eq']) chain[method] = () => chain
      chain.select = (columns: string) => {
        select = columns
        return chain
      }
      chain.range = (from: number, to: number) => {
        range = [from, to]
        return chain
      }
      chain.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
        const answer = () => {
          if (table === 'user_roles') return { data: mocks.state.roles, error: null }
          if (table !== 'receipt_transactions') return { data: [], error: null }
          // A new read of the quarter starts at row zero.
          if (range[0] === 0) mocks.state.readCount += 1
          mocks.state.ranges.push(range)
          mocks.state.selects.push(select)
          if (mocks.state.failRead === mocks.state.readCount) return { data: null, error: { message: 'timeout' } }
          const rows = mocks.state.reads[Math.min(mocks.state.readCount, mocks.state.reads.length) - 1] ?? []
          return { data: rows.slice(range[0], range[1] + 1), error: null }
        }
        return Promise.resolve(answer()).then(resolve, reject)
      }
      return chain
    },
    storage: {
      from: () => ({
        download: async (path: string) => {
          mocks.state.downloads.push(path)
          if (!mocks.state.objects.has(path)) return { data: null, error: { message: 'Object not found' } }
          const bytes = mocks.state.objects.get(path)
          if (bytes === null) throw new Error('socket hang up')
          return { data: Buffer.from(bytes as Uint8Array), error: null }
        },
      }),
    },
  }),
}))
vi.mock('@/lib/receipts/export/oj-project-invoices', () => ({
  loadOjProjectInvoicesPaidInQuarter: vi.fn().mockResolvedValue([]),
  appendOjProjectInvoices: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/receipts/export', () => ({
  buildQuarterMileageFiles: mocks.buildQuarterMileageFiles,
  buildExpensesCsv: vi.fn().mockResolvedValue({
    csv: Buffer.from('expenses'),
    summary: { totalEntries: 0, grossTotal: 0, vatTotal: 0, expenseIds: ['e-1'] },
    rows: [],
  }),
  buildMgdCsv: vi.fn().mockResolvedValue({ csv: Buffer.from('mgd'), fileName: 'MGD_Q3_2026.csv', summary: {}, rows: [] }),
  appendExpenseImages: mocks.appendExpenseImages,
  appendClaimSummaryPdf: mocks.appendClaimSummaryPdf,
}))

import { GET } from '@/app/api/receipts/export/route'

function file(id: string, overrides: Row = {}): Row {
  return { id, storage_path: `2026/${id}`, file_name: `${id}.pdf`, content_hash: `hash-${id}`, source: 'upload', ...overrides }
}

function payment(id: string, files: Row[] = [], overrides: Row = {}): Row {
  return {
    id,
    transaction_date: '2026-07-14',
    details: `CARD PAYMENT ${id}`,
    transaction_type: 'Card',
    vendor_name: 'Tesco',
    vendor_source: 'rule',
    expense_category: null,
    expense_category_source: null,
    ai_confidence: null,
    amount_in: null,
    amount_out: 12.5,
    status: files.length ? 'completed' : 'pending',
    notes: null,
    completed_reason: null,
    no_category_applies: false,
    source_type: 'bank',
    card_member: null,
    receipt_files: files.map((entry) => ({ ...entry, transaction_id: id })),
    ...overrides,
  }
}

function quarter(payments: Row[], store = true) {
  mocks.state.reads = [payments]
  if (!store) return
  for (const entry of payments) {
    for (const stored of entry.receipt_files) mocks.state.objects.set(stored.storage_path, new TextEncoder().encode(`bytes of ${stored.id}`))
  }
}

function get(query = 'year=2026&quarter=3') {
  return GET(new Request(`http://localhost/api/receipts/export?${query}`) as never)
}

async function unzip(response: Response): Promise<{ names: string[]; text: (name: string) => Promise<string> }> {
  const zip = await JSZip.loadAsync(Buffer.from(await response.arrayBuffer()))
  return {
    names: Object.keys(zip.files).sort(),
    text: async (name: string) => {
      const entry = zip.file(name)
      if (!entry) throw new Error(`Not in the pack: ${name}`)
      return entry.async('string')
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  Object.assign(mocks.state, { reads: [], readCount: 0, ranges: [], selects: [], failRead: null, roles: [], downloads: [] })
  mocks.state.objects = new Map()
  mocks.checkUserPermission.mockImplementation(async (module: string, action: string) => module === 'receipts' && action === 'export')
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'peter@example.test' } } })
  mocks.appendExpenseImages.mockResolvedValue(0)
  mocks.appendClaimSummaryPdf.mockResolvedValue(undefined)
})

describe('GET /api/receipts/export', () => {
  it('refuses someone who may not export, and reads nothing', async () => {
    mocks.checkUserPermission.mockResolvedValue(false)

    const response = await get()

    expect(response.status).toBe(403)
    expect(mocks.state.readCount).toBe(0)
    expect(mocks.logAuditEvent).not.toHaveBeenCalled()
  })

  it.each(['year=2026&quarter=5', 'year=1999&quarter=1', 'quarter=1', 'year=abc&quarter=1'])('refuses "%s"', async (query) => {
    const response = await get(query)

    expect(response.status).toBe(400)
    expect(mocks.state.readCount).toBe(0)
  })

  it('ships every file, a summary and a manifest that lists the lot', async () => {
    quarter([payment('p1', [file('f1'), file('f2', { file_name: 'slip.JPG' })]), payment('p2'), payment('p3', [file('f3')])])

    const response = await get()
    const pack = await unzip(response)

    expect(response.status).toBe(200)
    expect(response.headers.get('X-Receipts-Missing-Files')).toBe('0')
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="receipts_q3_2026.zip"')
    expect(pack.names).toEqual([
      'MANIFEST.csv',
      'Receipts_Q3_2026.csv',
      'receipts/2026-07-14 - £12.50 - Tesco - f1.pdf',
      'receipts/2026-07-14 - £12.50 - Tesco - f2.jpg',
      'receipts/2026-07-14 - £12.50 - Tesco - f3.pdf',
    ].sort())
    await expect(pack.text('receipts/2026-07-14 - £12.50 - Tesco - f2.jpg')).resolves.toBe('bytes of f2')

    const manifest = await pack.text('MANIFEST.csv')
    expect(manifest).toContain('Files listed,3')
    expect(manifest).toContain('Files in this pack,3')
    expect(manifest).toContain('Files missing,0')
    const summary = await pack.text('Receipts_Q3_2026.csv')
    expect(summary).toContain('Total transactions,3')
    expect(summary).toContain('Receipt files in this pack,3')
  })

  it('names a file it could not read, in the pack and in the response, and still ships the rest', async () => {
    quarter([payment('p1', [file('f1'), file('f2'), file('f3'), file('f4')])])
    mocks.state.objects.delete('2026/f2')
    mocks.state.objects.set('2026/f3', new Uint8Array())
    mocks.state.objects.set('2026/f4', null)

    const response = await get()
    const pack = await unzip(response)

    expect(response.status).toBe(200)
    expect(response.headers.get('X-Receipts-Missing-Files')).toBe('3')
    expect(pack.names).toContain('MISSING_FILES.txt')
    expect(pack.names.filter((name) => name.startsWith('receipts/'))).toEqual([
      'receipts/2026-07-14 - £12.50 - Tesco - f1.pdf',
    ])

    const missing = await pack.text('MISSING_FILES.txt')
    expect(missing).toContain('3 files could not be included')
    expect(missing).toContain('file: f2.pdf')
    expect(missing).toContain('why: Object not found')
    expect(missing).toContain('why: The stored file is empty.')
    expect(missing).toContain('why: socket hang up')

    const manifest = await pack.text('MANIFEST.csv')
    expect(manifest).toContain('Files in this pack,1')
    expect(manifest).toContain('Files missing,3')
    expect(await pack.text('Receipts_Q3_2026.csv')).toContain('Receipt files missing from this pack,3')
  })

  it('reads a busy quarter in pages, so the pack is not cut at a thousand transactions', async () => {
    const payments = Array.from({ length: 2300 }, (_, index) => payment(`p-${String(index).padStart(4, '0')}`))
    payments[2299] = payment('p-2299', [file('late')])
    quarter(payments)

    const response = await get()
    const pack = await unzip(response)

    expect(response.status).toBe(200)
    expect(await pack.text('Receipts_Q3_2026.csv')).toContain('Total transactions,2300')
    expect(pack.names).toContain('receipts/2026-07-14 - £12.50 - Tesco - late.pdf')
    // Two reads of the quarter (the pack, then the re-check), three pages each.
    expect(mocks.state.ranges).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ])
  })

  it('refuses to ship a pack when the quarter changed while it was being built', async () => {
    const first = [payment('p1', [file('f1')]), payment('p2')]
    quarter(first)
    // By the re-check, someone has attached a receipt to the second transaction.
    mocks.state.reads.push([first[0], payment('p2', [file('f9')])])

    const response = await get()

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'The quarter changed while the pack was being built. Please try again.' })
    expect(mocks.logAuditEvent).not.toHaveBeenCalled()
  })

  it('refuses to ship a pack when a transaction arrived, or went, while it was being built', async () => {
    quarter([payment('p1')])
    mocks.state.reads.push([payment('p1'), payment('p2')])
    expect((await get()).status).toBe(409)

    Object.assign(mocks.state, { readCount: 0 })
    quarter([payment('p1'), payment('p2')])
    mocks.state.reads.push([payment('p1')])
    expect((await get()).status).toBe(409)
  })

  it('fails, and ships nothing, when the quarter cannot be read or cannot be re-checked', async () => {
    quarter([payment('p1', [file('f1')])])
    mocks.state.failRead = 1
    const first = await get()
    expect(first.status).toBe(500)
    await expect(first.json()).resolves.toEqual({ error: 'Failed to load transactions for export.' })
    expect(mocks.state.downloads).toEqual([])

    Object.assign(mocks.state, { readCount: 0, failRead: 2 })
    const second = await get()
    expect(second.status).toBe(500)
    await expect(second.json()).resolves.toEqual({ error: 'Failed to load transactions for export.' })
    expect(mocks.logAuditEvent).not.toHaveBeenCalled()
  })

  it('records who took the pack, for which quarter and what it held', async () => {
    quarter([payment('p1', [file('f1'), file('f2')]), payment('p2')])
    mocks.state.objects.delete('2026/f2')

    const response = await get()
    const bytes = Buffer.from(await response.arrayBuffer()).length

    expect(mocks.logAuditEvent).toHaveBeenCalledTimes(1)
    expect(mocks.logAuditEvent.mock.calls[0][0]).toEqual({
      user_id: 'user-1',
      user_email: 'peter@example.test',
      operation_type: 'export',
      resource_type: 'receipts_quarter_pack',
      resource_id: '2026-Q3',
      operation_status: 'success',
      additional_info: {
        year: 2026,
        quarter: 3,
        transactions: 2,
        files_listed: 2,
        files_included: 1,
        files_missing: 1,
        expense_images_missing: 0,
        oj_project_invoices: 0,
        included_mileage: false,
        included_claim_summary: false,
        bytes,
      },
    })
  })

  it('still hands over the pack when the audit entry cannot be written', async () => {
    quarter([payment('p1')])
    mocks.logAuditEvent.mockRejectedValue(new Error('audit table is down'))

    expect((await get()).status).toBe(200)
  })

  it('lists expense images that could not be included, for a super admin', async () => {
    quarter([payment('p1', [file('f1')])])
    mocks.state.roles = [{ roles: { name: 'super_admin' } }]
    mocks.appendExpenseImages.mockImplementation(async (_supabase: unknown, _ids: unknown, _archive: unknown, options: Row) => {
      options.onMissing('expenses/Lunch 2026-07-01.jpg', 'Object not found')
      return 0
    })

    const response = await get()
    const pack = await unzip(response)

    expect(response.headers.get('X-Receipts-Missing-Files')).toBe('1')
    const missing = await pack.text('MISSING_FILES.txt')
    expect(missing).toContain('Expense receipt images that could not be included:')
    expect(missing).toContain('- expenses/Lunch 2026-07-01.jpg')
    // No receipt file was missing, so that heading is not there.
    expect(missing).not.toContain('Receipts pack for Q3 2026')
    expect(mocks.logAuditEvent.mock.calls[0][0].additional_info).toMatchObject({ expense_images_missing: 1, included_claim_summary: true })
  })

  it('says so, in the pack, when the quarter is empty', async () => {
    quarter([])

    const pack = await unzip(await get())

    expect(pack.names).toEqual(['README.txt', 'Receipts_Q3_2026.csv'])
    await expect(pack.text('README.txt')).resolves.toBe('No transactions found for this quarter.')
  })
})
