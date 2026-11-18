import { describe, expect, it } from 'vitest'
import { summariseShortLinkVolume } from '@/lib/short-links/volume-summary'

describe('summariseShortLinkVolume', () => {
  it('sums clicks and unique visitors and picks the most clicked link', () => {
    const summary = summariseShortLinkVolume([
      { name: 'Quiz night', destination_url: 'https://www.the-anchor.pub/events/quiz', total_clicks: 12, unique_visitors: 9 },
      { name: 'Menu', destination_url: 'https://www.the-anchor.pub/food', total_clicks: '40', unique_visitors: '31' },
      { name: '', destination_url: 'https://example.com/x', total_clicks: 3, unique_visitors: 3 },
    ])

    expect(summary).toEqual({
      totalClicks: 55,
      uniqueVisitors: 43,
      topDestination: { label: 'Menu', title: 'https://www.the-anchor.pub/food' },
    })
  })

  it('labels an unnamed top link by its destination, without our own domain', () => {
    const summary = summariseShortLinkVolume([
      { name: null, destination_url: 'https://the-anchor.pub/whats-on?x=1', total_clicks: 5, unique_visitors: 2 },
    ])
    expect(summary.topDestination).toEqual({ label: '/whats-on?x=1', title: 'https://the-anchor.pub/whats-on?x=1' })
  })

  it('keeps the first row on a tie, as the function orders by clicks then short code', () => {
    const summary = summariseShortLinkVolume([
      { name: 'First', destination_url: 'https://a.example', total_clicks: 7, unique_visitors: 1 },
      { name: 'Second', destination_url: 'https://b.example', total_clicks: 7, unique_visitors: 1 },
    ])
    expect(summary.topDestination.label).toBe('First')
  })

  it('gives zeros and a dash for a failed or empty read', () => {
    const empty = { totalClicks: 0, uniqueVisitors: 0, topDestination: { label: '-', title: '' } }
    expect(summariseShortLinkVolume(null)).toEqual(empty)
    expect(summariseShortLinkVolume(undefined)).toEqual(empty)
    expect(summariseShortLinkVolume([])).toEqual(empty)
    expect(summariseShortLinkVolume({ error: 'x' })).toEqual(empty)
  })

  it('ignores junk rows and non-numeric figures', () => {
    const summary = summariseShortLinkVolume([null, 'x', { total_clicks: 'abc', unique_visitors: 2, name: 'A' }])
    expect(summary.totalClicks).toBe(0)
    expect(summary.uniqueVisitors).toBe(2)
  })
})
