import { describe, it, expect, vi } from 'vitest'
import { fetchAllRows, type PagedReadResult } from '@/lib/supabase/paged-read'

type Row = { i: number }
type RunPage = (from: number, to: number) => Promise<PagedReadResult<Row>>

const page = (rows: number): PagedReadResult<Row> => ({
  data: Array.from({ length: rows }, (_, i) => ({ i })),
  error: null,
})

describe('fetchAllRows', () => {
  it('follows every page until a short page ends it', async () => {
    const runPage = vi.fn<RunPage>()
      .mockResolvedValueOnce(page(1000))
      .mockResolvedValueOnce(page(1000))
      .mockResolvedValueOnce(page(156))

    const rows = await fetchAllRows(runPage)

    expect(rows).toHaveLength(2156)
    expect(runPage).toHaveBeenCalledTimes(3)
    expect(runPage).toHaveBeenNthCalledWith(1, 0, 999)
    expect(runPage).toHaveBeenNthCalledWith(2, 1000, 1999)
    expect(runPage).toHaveBeenNthCalledWith(3, 2000, 2999)
  })

  it('never asks for more than 1000 rows in one request', async () => {
    const runPage = vi.fn<RunPage>().mockResolvedValue(page(3))

    await fetchAllRows(runPage, { pageSize: 5000 })

    expect(runPage).toHaveBeenCalledTimes(1)
    expect(runPage).toHaveBeenCalledWith(0, 999)
  })

  it('throws instead of returning a truncated result at the safety cap', async () => {
    const runPage = vi.fn<RunPage>().mockResolvedValue(page(1000))

    await expect(fetchAllRows(runPage, { maxRows: 2000, label: 'receipts' }))
      .rejects.toThrow(/receipts.*2000 row cap/)
    expect(runPage).toHaveBeenCalledTimes(2)
  })

  it('throws the underlying error', async () => {
    const runPage = vi.fn<RunPage>().mockResolvedValue({ data: null, error: { message: 'boom' } })

    await expect(fetchAllRows(runPage, { label: 'scores' })).rejects.toThrow(/scores.*boom/)
    expect(runPage).toHaveBeenCalledTimes(1)
  })

  it('treats a page with no rows as the end of the set', async () => {
    const runPage = vi.fn<RunPage>()
      .mockResolvedValueOnce(page(1000))
      .mockResolvedValueOnce({ data: null, error: null })

    const rows = await fetchAllRows(runPage)

    expect(rows).toHaveLength(1000)
    expect(runPage).toHaveBeenCalledTimes(2)
  })
})
