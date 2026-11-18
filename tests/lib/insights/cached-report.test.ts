import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildFixtureReport } from './helpers/report-fixture'

const mocks = vi.hoisted(() => ({
  build: vi.fn(),
  admin: vi.fn(),
  canView: vi.fn(),
  cache: null as null | ReturnType<typeof import('./helpers/fake-next-cache').createFakeNextCache>,
}))

vi.mock('next/cache', async () => {
  const { createFakeNextCache } = await import('./helpers/fake-next-cache')
  mocks.cache = createFakeNextCache()
  return { unstable_cache: mocks.cache.unstable_cache, revalidateTag: vi.fn((tag: string) => mocks.cache?.revalidateTag(tag)) }
})
vi.mock('@/lib/insights/registry', () => ({ buildWeeklyInsights: mocks.build }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: mocks.admin }))
vi.mock('@/lib/insights/access', () => ({ currentUserCanViewInsights: mocks.canView }))

const APP_URL = 'https://management.example.test'
// 12:01:00 London (BST is over by November, so 12:01 UTC): one minute into a five-minute slot.
const START = new Date('2026-11-18T12:01:00Z')

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(START)
  mocks.build.mockReset()
  mocks.admin.mockReset()
  mocks.canView.mockReset()
  mocks.cache?.reset()
})

afterEach(() => {
  vi.useRealTimers()
})

async function load() {
  return import('@/lib/insights/cached-report')
}

describe('getCachedInsightsReport', () => {
  it('builds once, then serves the same report to a second render within five minutes', async () => {
    const report = buildFixtureReport()
    mocks.build.mockResolvedValue(report)
    const { getCachedInsightsReport } = await load()

    const first = await getCachedInsightsReport(APP_URL)
    vi.setSystemTime(new Date(START.getTime() + 3 * 60_000))
    const second = await getCachedInsightsReport(APP_URL)

    expect(mocks.build).toHaveBeenCalledTimes(1)
    // The cached copy survives the JSON round trip unchanged, including the ISO generatedAt.
    expect(second).toEqual(first)
    expect(second).toEqual(JSON.parse(JSON.stringify(report)))
    expect(typeof second.generatedAt).toBe('string')
  })

  it('builds with a signalled admin client and the current instant, never a stored clock', async () => {
    mocks.build.mockResolvedValue(buildFixtureReport())
    const { getCachedInsightsReport } = await load()
    await getCachedInsightsReport(APP_URL)
    const options = mocks.build.mock.calls[0][0]
    expect(options.appUrl).toBe(APP_URL)
    expect(options.now.getTime()).toBe(START.getTime())
    const signal = new AbortController().signal
    options.createDb(signal)
    expect(mocks.admin).toHaveBeenCalledWith({ signal })
  })

  it('rebuilds once the five-minute slot has passed, so figures are never more than five minutes old', async () => {
    mocks.build.mockResolvedValue(buildFixtureReport())
    const { getCachedInsightsReport } = await load()
    await getCachedInsightsReport(APP_URL)
    // 12:05:00 starts a new slot.
    vi.setSystemTime(new Date('2026-11-18T12:05:00Z'))
    await getCachedInsightsReport(APP_URL)
    expect(mocks.build).toHaveBeenCalledTimes(2)
  })

  it('never stores a report with a section that was not checked, so the next load retries it', async () => {
    const degraded = buildFixtureReport({ notChecked: ['parking'] })
    expect(degraded.notChecked).toEqual(['parking'])
    mocks.build.mockResolvedValueOnce(degraded).mockResolvedValueOnce(buildFixtureReport())
    const { getCachedInsightsReport } = await load()

    const first = await getCachedInsightsReport(APP_URL)
    expect(first).toBe(degraded)
    const second = await getCachedInsightsReport(APP_URL)
    expect(second.notChecked).toEqual([])
    expect(mocks.build).toHaveBeenCalledTimes(2)
    // The good one is kept.
    await getCachedInsightsReport(APP_URL)
    expect(mocks.build).toHaveBeenCalledTimes(2)
  })

  it('passes a build failure through and does not cache it', async () => {
    mocks.build.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(buildFixtureReport())
    const { getCachedInsightsReport } = await load()
    await expect(getCachedInsightsReport(APP_URL)).rejects.toThrow('boom')
    await getCachedInsightsReport(APP_URL)
    expect(mocks.build).toHaveBeenCalledTimes(2)
  })
})

describe('refreshInsightsReport', () => {
  it('clears the cached report for a super admin, so the next render rebuilds', async () => {
    mocks.build.mockResolvedValue(buildFixtureReport())
    mocks.canView.mockResolvedValue(true)
    const { getCachedInsightsReport } = await load()
    const { refreshInsightsReport } = await import('@/app/actions/insights')

    await getCachedInsightsReport(APP_URL)
    await expect(refreshInsightsReport()).resolves.toEqual({ success: true })
    await getCachedInsightsReport(APP_URL)
    expect(mocks.build).toHaveBeenCalledTimes(2)
  })

  it('refuses anyone who cannot view Insights and leaves the cache alone', async () => {
    mocks.build.mockResolvedValue(buildFixtureReport())
    mocks.canView.mockResolvedValue(false)
    const { revalidateTag } = await import('next/cache')
    const { getCachedInsightsReport } = await load()
    const { refreshInsightsReport } = await import('@/app/actions/insights')

    await getCachedInsightsReport(APP_URL)
    vi.mocked(revalidateTag).mockClear()
    await expect(refreshInsightsReport()).rejects.toThrow('Insufficient permissions')
    expect(revalidateTag).not.toHaveBeenCalled()
    await getCachedInsightsReport(APP_URL)
    expect(mocks.build).toHaveBeenCalledTimes(1)
  })
})
