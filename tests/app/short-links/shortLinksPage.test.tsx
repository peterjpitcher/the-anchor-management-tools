import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'

const checkUserPermission = vi.fn()
const getShortLinks = vi.fn()
const getShortLinkVolumeAdvanced = vi.fn()
const redirect = vi.fn((path: string) => {
  throw new Error(`redirect:${path}`)
})

vi.mock('next/navigation', () => ({ redirect: (path: string) => redirect(path) }))
vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: (...args: unknown[]) => checkUserPermission(...args),
}))
vi.mock('@/app/actions/short-links', () => ({
  getShortLinks: (...args: unknown[]) => getShortLinks(...args),
  getShortLinkVolumeAdvanced: (...args: unknown[]) => getShortLinkVolumeAdvanced(...args),
}))
vi.mock('@/app/(authenticated)/short-links/_components/ShortLinksClient', () => ({
  ShortLinksClient: () => null,
}))

import ShortLinksPage from '@/app/(authenticated)/short-links/page'

describe('ShortLinksPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    checkUserPermission.mockResolvedValue(true)
    getShortLinks.mockResolvedValue({ success: true, data: [], total: 0, linkTotal: 0, page: 1, pageSize: 25 })
    getShortLinkVolumeAdvanced
      .mockResolvedValueOnce({
        success: true,
        data: [
          { name: 'Menu', destination_url: 'https://www.the-anchor.pub/food', total_clicks: 40, unique_visitors: 31, click_dates: ['2026-11-01'], click_counts: [40] },
          { name: 'Quiz', destination_url: 'https://www.the-anchor.pub/quiz', total_clicks: 10, unique_visitors: 8, click_dates: ['2026-11-01'], click_counts: [10] },
        ],
      })
      .mockResolvedValueOnce({
        success: true,
        data: [{ name: 'Old', destination_url: 'https://www.the-anchor.pub/old', total_clicks: 25, unique_visitors: 20 }],
      })
  })

  it('asks for month buckets and passes only the summed figures to the browser', async () => {
    const element = (await ShortLinksPage()) as ReactElement<Record<string, unknown>>

    expect(getShortLinkVolumeAdvanced).toHaveBeenCalledTimes(2)
    for (const [input] of getShortLinkVolumeAdvanced.mock.calls) {
      expect(input).toMatchObject({ granularity: 'month', include_bots: false, timezone: 'Europe/London' })
    }

    expect(element.props.volumeSummary).toEqual({
      totalClicks: 50,
      uniqueVisitors: 39,
      topDestination: { label: 'Menu', title: 'https://www.the-anchor.pub/food' },
    })
    expect(element.props.previousTotalClicks).toBe(25)
    expect(element.props).not.toHaveProperty('volume')
    expect(element.props).not.toHaveProperty('previousVolume')
    expect(JSON.stringify(element.props)).not.toContain('click_counts')
  })

  it('still sends a user without view permission away', async () => {
    checkUserPermission.mockImplementation(async (_module: string, action: string) => action !== 'view')
    await expect(ShortLinksPage()).rejects.toThrow('redirect:/unauthorized')
    expect(checkUserPermission).toHaveBeenCalledWith('short_links', 'view')
  })

  it('shows zeros when the analytics read fails', async () => {
    getShortLinkVolumeAdvanced.mockReset().mockResolvedValue({ error: 'Failed to load analytics' })
    const element = (await ShortLinksPage()) as ReactElement<Record<string, unknown>>
    expect(element.props.volumeSummary).toEqual({ totalClicks: 0, uniqueVisitors: 0, topDestination: { label: '-', title: '' } })
    expect(element.props.previousTotalClicks).toBe(0)
  })
})
