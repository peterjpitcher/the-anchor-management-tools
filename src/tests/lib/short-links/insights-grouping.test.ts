import { describe, it, expect } from 'vitest'
import { groupLinksIntoCampaigns } from '@/lib/short-links/insights-grouping'
import type { AnalyticsLinkRow } from '@/types/short-links'

function makeLink(overrides: Partial<AnalyticsLinkRow> = {}): AnalyticsLinkRow {
  return {
    id: 'link-1', shortCode: 'abc123', linkType: 'custom',
    destinationUrl: 'https://example.com', name: 'Test Link',
    parentLinkId: null, metadata: null, createdAt: null,
    totalClicks: 10, uniqueVisitors: 5, data: [],
    ...overrides,
  }
}

describe('groupLinksIntoCampaigns', () => {
  it('should classify a standalone link (no variants)', () => {
    const links = [makeLink({ id: 'standalone-1' })]
    const result = groupLinksIntoCampaigns(links)
    expect(result.campaigns).toHaveLength(0)
    expect(result.standalone).toHaveLength(1)
    expect(result.standalone[0].id).toBe('standalone-1')
  })

  it('should group parent + variants into a campaign', () => {
    const links = [
      makeLink({ id: 'parent-1', name: 'Easter Lunch', totalClicks: 0 }),
      makeLink({ id: 'variant-fb', parentLinkId: 'parent-1', metadata: { channel: 'facebook' }, totalClicks: 30, uniqueVisitors: 20 }),
      makeLink({ id: 'variant-sms', parentLinkId: 'parent-1', metadata: { channel: 'sms' }, totalClicks: 10, uniqueVisitors: 8 }),
    ]
    const result = groupLinksIntoCampaigns(links)
    expect(result.campaigns).toHaveLength(1)
    expect(result.standalone).toHaveLength(0)
    expect(result.campaigns[0].parent.name).toBe('Easter Lunch')
    expect(result.campaigns[0].variants).toHaveLength(2)
    expect(result.campaigns[0].totalClicks).toBe(40)
    expect(result.campaigns[0].topChannel?.label).toBe('Facebook')
  })

  it('should build channel totals across all campaigns', () => {
    const links = [
      makeLink({ id: 'p1' }),
      makeLink({ id: 'v1', parentLinkId: 'p1', metadata: { channel: 'facebook' }, totalClicks: 20 }),
      makeLink({ id: 'p2' }),
      makeLink({ id: 'v2', parentLinkId: 'p2', metadata: { channel: 'facebook' }, totalClicks: 15 }),
      makeLink({ id: 'v3', parentLinkId: 'p2', metadata: { channel: 'sms' }, totalClicks: 5 }),
    ]
    const result = groupLinksIntoCampaigns(links)
    expect(result.channelTotals.find(c => c.channel === 'facebook')?.clicks).toBe(35)
    expect(result.channelTotals.find(c => c.channel === 'sms')?.clicks).toBe(5)
  })

  it('should handle empty input', () => {
    const result = groupLinksIntoCampaigns([])
    expect(result.campaigns).toHaveLength(0)
    expect(result.standalone).toHaveLength(0)
    expect(result.channelTotals).toHaveLength(0)
  })

  it('should create synthetic parent for orphaned variants (parent not in response)', () => {
    // Parent has 0 clicks so it's excluded from the INNER JOIN analytics RPC.
    // Only variants appear in the response.
    const links = [
      makeLink({
        id: 'variant-fb',
        parentLinkId: 'missing-parent-id',
        name: 'Easter Lunch \u2014 Facebook',
        metadata: { channel: 'facebook', event_name: 'Easter Lunch' },
        destinationUrl: 'https://example.com/events/easter?utm_source=facebook',
        totalClicks: 30,
        uniqueVisitors: 20,
      }),
      makeLink({
        id: 'variant-sms',
        parentLinkId: 'missing-parent-id',
        metadata: { channel: 'sms', event_name: 'Easter Lunch' },
        destinationUrl: 'https://example.com/events/easter?utm_source=sms',
        totalClicks: 10,
        uniqueVisitors: 8,
      }),
    ]
    const result = groupLinksIntoCampaigns(links)
    expect(result.campaigns).toHaveLength(1)
    expect(result.standalone).toHaveLength(0)
    expect(result.campaigns[0].parent.id).toBe('missing-parent-id')
    expect(result.campaigns[0].parent.name).toBe('Easter Lunch')
    expect(result.campaigns[0].parent.destinationUrl).toBe('https://example.com/events/easter')
    expect(result.campaigns[0].totalClicks).toBe(40)
    expect(result.campaigns[0].variants).toHaveLength(2)
  })

  it('should sort campaigns by total clicks descending', () => {
    const links = [
      makeLink({ id: 'p1' }),
      makeLink({ id: 'v1', parentLinkId: 'p1', metadata: { channel: 'facebook' }, totalClicks: 10 }),
      makeLink({ id: 'p2' }),
      makeLink({ id: 'v2', parentLinkId: 'p2', metadata: { channel: 'sms' }, totalClicks: 50 }),
    ]
    const result = groupLinksIntoCampaigns(links)
    expect(result.campaigns[0].parent.id).toBe('p2')
    expect(result.campaigns[1].parent.id).toBe('p1')
  })
})
