// The /mgd page used to read the current return with its own getCurrentReturn()
// call. It now picks it out of getReturns() by the current MGD quarter (London
// date) and reads that quarter's collections in the same Promise.all. These
// tests pin the clock either side of quarter ends in both GMT and BST, so the
// London date decides the quarter under `npm test` and `npm run test:utc` alike.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'

const mocks = vi.hoisted(() => ({
  getReturns: vi.fn(),
  getCollections: vi.fn(),
  getCurrentReturn: vi.fn(),
  checkUserPermission: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT ${path}`)
  }),
}))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: mocks.checkUserPermission }))
vi.mock('@/app/actions/mgd', () => ({
  getReturns: mocks.getReturns,
  getCollections: mocks.getCollections,
  getCurrentReturn: mocks.getCurrentReturn,
}))
vi.mock('@/app/(authenticated)/mgd/_components/MgdClient', () => ({
  MgdClient: () => null,
}))

import MgdPage from '@/app/(authenticated)/mgd/page'

function returnRow(periodStart: string, periodEnd: string) {
  return {
    id: `return-${periodStart}`,
    period_start: periodStart,
    period_end: periodEnd,
    total_net_take: 0,
    total_mgd: 0,
    total_vat_on_supplier: 0,
    status: 'open',
    submitted_at: null,
    submitted_by: null,
    date_paid: null,
    machine_count: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    collection_count: 3,
  }
}

const RETURNS = [
  returnRow('2026-11-01', '2027-01-31'),
  returnRow('2026-08-01', '2026-10-31'),
  returnRow('2026-05-01', '2026-07-31'),
]

type PageProps = {
  initialReturn: unknown
  initialCollections: unknown
  initialCollectionsError: string | null
  initialReturns: unknown
}

async function renderPage(): Promise<PageProps> {
  const element = (await MgdPage()) as ReactElement<PageProps>
  return element.props
}

describe('MGD page current return', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.checkUserPermission.mockResolvedValue(true)
    mocks.getReturns.mockResolvedValue({ success: true, data: RETURNS })
    mocks.getCollections.mockResolvedValue({ success: true, data: [{ id: 'c1' }] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it.each([
    // 23:30 UTC on 31 October 2026 is 23:30 GMT in London: still Aug-Oct.
    ['2026-10-31T23:30:00Z', '2026-08-01', '2026-10-31'],
    // 00:30 UTC on 1 November 2026 is 00:30 GMT in London: Nov-Jan.
    ['2026-11-01T00:30:00Z', '2026-11-01', '2027-01-31'],
    // 23:30 UTC on 31 July 2026 is 00:30 BST on 1 August in London: Aug-Oct.
    ['2026-07-31T23:30:00Z', '2026-08-01', '2026-10-31'],
    // 22:30 UTC on 31 July 2026 is 23:30 BST on 31 July in London: May-Jul.
    ['2026-07-31T22:30:00Z', '2026-05-01', '2026-07-31'],
  ])('at %s shows the %s return without a second read', async (now, start, end) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(now))

    const props = await renderPage()

    expect(props.initialReturn).toEqual(RETURNS.find((r) => r.period_start === start))
    expect(props.initialReturns).toEqual(RETURNS)
    expect(props.initialCollections).toEqual([{ id: 'c1' }])
    expect(props.initialCollectionsError).toBeNull()
    expect(mocks.getCollections).toHaveBeenCalledWith(start, end)
    expect(mocks.getCurrentReturn).not.toHaveBeenCalled()
  })

  it('starts the collections read before the returns read has finished', async () => {
    let releaseReturns: (value: unknown) => void = () => {}
    mocks.getReturns.mockReturnValue(new Promise((resolve) => { releaseReturns = resolve }))

    const pending = MgdPage()
    await vi.waitFor(() => expect(mocks.getCollections).toHaveBeenCalledTimes(1))
    releaseReturns({ success: true, data: RETURNS })
    await pending
  })

  it('shows no current return and no collections when the quarter has no return yet', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2027-03-01T12:00:00Z'))

    const props = await renderPage()

    expect(props.initialReturn).toBeNull()
    expect(props.initialCollections).toEqual([])
    expect(props.initialCollectionsError).toBeNull()
  })

  it('shows a failed collections read as an error, not as no collections', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-18T12:00:00Z'))
    mocks.getCollections.mockResolvedValue({ error: 'read failed' })

    const props = await renderPage()

    expect(props.initialCollections).toEqual([])
    expect(props.initialCollectionsError).toBe('read failed')
  })

  it('redirects without the mgd view permission', async () => {
    mocks.checkUserPermission.mockResolvedValue(false)
    await expect(MgdPage()).rejects.toThrow('NEXT_REDIRECT /unauthorized')
    expect(mocks.getReturns).not.toHaveBeenCalled()
  })
})
