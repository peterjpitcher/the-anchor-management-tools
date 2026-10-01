import { beforeEach, describe, expect, it, vi } from 'vitest'
import { appendExpenseImages } from '@/lib/receipts/export/expense-images'
import { createFakeDb } from '../../../helpers/fakeSupabaseDb'

/**
 * Expense receipt images in the quarterly pack. A failed read used to return "no images", so
 * the pack went out without them and said nothing.
 */

type Row = Record<string, unknown>

function fileRow(n: number, overrides: Row = {}): Row {
  return {
    id: `file-${String(n).padStart(5, '0')}`,
    expense_id: `expense-${String(n).padStart(5, '0')}`,
    storage_path: `expenses/${n}.jpg`,
    file_name: `photo-${n}.jpg`,
    mime_type: 'image/jpeg',
    uploaded_at: '2026-07-01T10:00:00Z',
    expense: { expense_date: '2026-07-01', company_ref: `Shop ${n}`, amount: 10 + n },
    ...overrides,
  }
}

function arrange(rows: Row[], missing: Record<string, string | Error> = {}) {
  const db = createFakeDb({ expense_files: rows })
  const downloads: string[] = []
  ;(db.client as unknown as { storage: unknown }).storage = {
    from: () => ({
      download: async (path: string) => {
        downloads.push(path)
        const problem = missing[path]
        if (problem instanceof Error) throw problem
        if (problem) return { data: null, error: { message: problem } }
        return { data: Buffer.from(`bytes of ${path}`), error: null }
      },
    }),
  }
  const appended: Array<{ name: string; bytes: string }> = []
  const archive = { append: (bytes: Buffer, options: { name: string }) => appended.push({ name: options.name, bytes: bytes.toString() }) }
  return { db, downloads, appended, archive: archive as any }
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('appendExpenseImages', () => {
  it('adds each image under a name built from the expense', async () => {
    const { db, appended, archive } = arrange([fileRow(1), fileRow(2, { file_name: 'scan.pdf', mime_type: 'application/pdf' })])

    const added = await appendExpenseImages(db.client as any, ['expense-00001', 'expense-00002'], archive)

    expect(added).toBe(2)
    expect(appended).toEqual([
      { name: 'expense-receipts/2026-07-01_Shop1_11.00.jpg', bytes: 'bytes of expenses/1.jpg' },
      { name: 'expense-receipts/2026-07-01_Shop2_12.00.pdf', bytes: 'bytes of expenses/2.jpg' },
    ])
  })

  it('asks for nothing when there are no expenses', async () => {
    const { db, downloads, archive } = arrange([fileRow(1)])

    await expect(appendExpenseImages(db.client as any, [], archive)).resolves.toBe(0)
    expect(downloads).toEqual([])
  })

  it('fails the pack when the list of images cannot be read: it does not ship a pack without them', async () => {
    const { db, appended, archive } = arrange([fileRow(1)])
    db.failNext({ table: 'expense_files', operation: 'select', message: 'timeout' })

    await expect(appendExpenseImages(db.client as any, ['expense-00001'], archive)).rejects.toThrow(
      'Failed to load expense receipt files for export.'
    )
    expect(appended).toEqual([])
  })

  it('reports each image it could not read, by the name it would have had, and adds the rest', async () => {
    const { db, appended, archive } = arrange([fileRow(1), fileRow(2), fileRow(3)], {
      'expenses/2.jpg': 'Object not found',
      'expenses/3.jpg': new Error('socket hang up'),
    })
    const missing: Array<[string, string]> = []

    const added = await appendExpenseImages(db.client as any, ['expense-00001', 'expense-00002', 'expense-00003'], archive, {
      onMissing: (name, reason) => missing.push([name, reason]),
    })

    expect(added).toBe(1)
    expect(appended.map((entry) => entry.name)).toEqual(['expense-receipts/2026-07-01_Shop1_11.00.jpg'])
    expect(missing.sort()).toEqual([
      ['2026-07-01_Shop2_12.00.jpg', 'Object not found'],
      ['2026-07-01_Shop3_13.00.jpg', 'socket hang up'],
    ])
  })

  it('reads every image when there are more expenses than one request can name', async () => {
    const rows = Array.from({ length: 450 }, (_, index) => fileRow(index))
    const { db, appended, archive } = arrange(rows)

    const added = await appendExpenseImages(db.client as any, rows.map((row) => row.expense_id as string), archive)

    expect(added).toBe(450)
    expect(new Set(appended.map((entry) => entry.name)).size).toBe(450)
  })

  it('reads every image of one batch when it has more than a thousand', async () => {
    const rows = Array.from({ length: 1200 }, (_, index) => fileRow(index, { expense_id: 'expense-00001' }))
    const { db, downloads, archive } = arrange(rows)

    const added = await appendExpenseImages(db.client as any, ['expense-00001'], archive)

    expect(added).toBe(1200)
    expect(downloads).toHaveLength(1200)
  })
})
