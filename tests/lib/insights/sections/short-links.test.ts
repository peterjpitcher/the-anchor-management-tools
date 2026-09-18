import { describe, expect, it } from 'vitest'
import { buildShortLinksSection, shortLinksSection } from '@/lib/insights/sections/short-links'
import type { InsightSignal, SectionBuildResult } from '@/lib/insights/types'
import { FakeDb } from '../helpers/fake-db'
import { makeContext } from '../helpers/context'

/**
 * Default report instant: Friday 25 Sep 2026 06:00 London (05:00Z).
 *   this week         Fri 18 Sep to Thu 24 Sep
 *   last week         Fri 11 Sep to Thu 17 Sep
 *   previous 4 weeks  Fri 21 Aug to Thu 17 Sep
 *   previous 13 weeks Fri 19 Jun to Thu 17 Sep
 *   last 13 weeks     Fri 26 Jun to Thu 24 Sep
 * BST until 25 Oct, so a London day starts at 23:00Z the evening before.
 */

type Row = Record<string, unknown>

const THIS_WEEK = '2026-09-18'
const LAST_WEEK = '2026-09-11'
const PREVIOUS_4 = ['2026-08-21', '2026-08-28', '2026-09-04', '2026-09-11']
const PREVIOUS_13 = [
  '2026-06-19', '2026-06-26', '2026-07-03', '2026-07-10', '2026-07-17', '2026-07-24', '2026-07-31',
  '2026-08-07', '2026-08-14', '2026-08-21', '2026-08-28', '2026-09-04', '2026-09-11',
]
const INSIGHTS_HREF = 'https://management.example.test/short-links/insights'
const LONG_DASH = String.fromCharCode(0x2014)

let sequence = 0

/** A marketing link. Rows carry the columns the live table has, whatever the section selects. */
function link(id: string, overrides: Row = {}): Row {
  return {
    id,
    short_code: `code-${id}`,
    parent_link_id: null,
    link_type: 'promotion',
    name: `Link ${id}`,
    destination_url: `https://www.the-anchor.pub/${id}`,
    metadata: {},
    click_count: 0,
    created_by: null,
    expires_at: null,
    ...overrides,
  }
}

/** Clicks carry personal fields so the tests can prove none of them reach the output. */
function clicks(linkId: string, date: string, count: number, options: { device?: string | null; time?: string } = {}): Row[] {
  return Array.from({ length: count }, () => {
    sequence += 1
    return {
      id: `click-${String(sequence).padStart(7, '0')}`,
      short_link_id: linkId,
      clicked_at: `${date}T${options.time ?? '12:00:00'}.000Z`,
      device_type: options.device === undefined ? 'mobile' : options.device,
      ip_address: '203.0.113.77',
      city: 'Ashford',
      user_agent: 'Mozilla/5.0 fixture',
      referrer: 'https://facebook.com/fixture-person',
    }
  })
}

function each(linkId: string, dates: string[], count: number): Row[] {
  return dates.flatMap((date) => clicks(linkId, date, count))
}

async function build(links: Row[], clickRows: Row[], now?: Date): Promise<{ result: SectionBuildResult; db: FakeDb }> {
  const db = new FakeDb({ short_links: links, short_link_clicks: clickRows })
  const result = await buildShortLinksSection(makeContext(db, now))
  return { result, db }
}

function signal(result: SectionBuildResult, key: string): InsightSignal | undefined {
  return result.signals.find((item) => item.key === key)
}

function metric(result: SectionBuildResult, label: string): { value: string; comparison?: string } | undefined {
  return result.metrics.find((item) => item.label === label)
}

function listTexts(result: SectionBuildResult, title: string): string[] {
  return (result.lists.find((list) => list.title === title)?.items ?? []).map((item) => item.text)
}

function expectCleanText(result: SectionBuildResult): void {
  const text = JSON.stringify(result)
  for (const bad of ['undefined', 'NaN', 'Invalid Date', '!', LONG_DASH]) {
    expect(text).not.toContain(bad)
  }
  for (const personal of ['203.0.113', 'Ashford', 'fixture-person', 'Mozilla', '+4477']) {
    expect(text).not.toContain(personal)
  }
}

describe('short links section', () => {
  it('is registered as the short links section linking to the short link insights page', () => {
    expect(shortLinksSection).toMatchObject({ key: 'short_links', title: 'Short links', path: '/short-links/insights' })
    expect(shortLinksSection.build).toBe(buildShortLinksSection)
  })

  it('prints one line when there are no human clicks in 13 weeks', async () => {
    const { result, db } = await build([link('a')], [
      ...clicks('a', THIS_WEEK, 40, { device: 'bot' }),
      ...clicks('a', '2026-06-01', 30),
    ])
    expect(result).toEqual({
      headline: 'No human clicks on marketing short links in the last 13 weeks.',
      metrics: [],
      lists: [],
      signals: [],
      notes: ['Human clicks on marketing links only, grouped by campaign; email campaign, guest, booking, text and review links are left out.'],
    })
    // Bots and clicks before the window are filtered by the query, so no link is looked up.
    expect(db.calls.map((call) => call.table)).toEqual(['short_link_clicks'])
  })

  it('fails loudly when clicks or links cannot be read, so the section shows as not checked', async () => {
    const failingClicks = new FakeDb({ short_links: [link('a')], short_link_clicks: [] }).fail('short_link_clicks')
    await expect(buildShortLinksSection(makeContext(failingClicks))).rejects.toThrow(/insights short link clicks failed/)
    const failingLinks = new FakeDb({ short_links: [link('a')], short_link_clicks: clicks('a', THIS_WEEK, 5) }).fail('short_links')
    await expect(buildShortLinksSection(makeContext(failingLinks))).rejects.toThrow(/insights short links failed/)
  })

  it('counts human clicks only, on marketing links only', async () => {
    const links = [
      link('promo', { name: 'Quiz Night' }),
      link('email', { link_type: 'marketing_email', name: 'September newsletter' }),
      link('sms', { link_type: 'custom', metadata: { source: 'sms_auto_shortener' } }),
      link('pay', { link_type: 'custom', metadata: { source: 'sms_auto_shortener', guest_link_kind: 'table_payment', table_booking_id: 'tb-1', customer_id: 'c-1' } }),
      link('manage', { link_type: 'custom', metadata: { source: 'guest_link_builder', guest_link_kind: 'table_manage', guest_token_hash: 'hash' } }),
      link('confirm', { link_type: 'custom', metadata: { type: 'booking_confirmation', mobile_number: '+447700900123', event_id: 'e-1' } }),
      link('lunch-pay', { link_type: 'custom', metadata: { type: 'sunday_lunch_payment', booking_id: 'b-1', booking_reference: 'TB-1' } }),
      link('null-key', { link_type: 'custom', metadata: { customer_id: null } }),
      link('review-ask', { link_type: 'custom', metadata: { source: 'guest_review_ask' } }),
      link('google-review', { link_type: 'custom', metadata: { source: 'google_review_link', permanent: true } }),
      link('funnel', { link_type: 'custom', metadata: { purpose: 'review_feedback_funnel' } }),
      link('gpage', { link_type: 'custom', metadata: null, destination_url: 'https://g.page/r/fixture/review' }),
      link('writereview', { link_type: 'custom', metadata: null, destination_url: 'https://search.google.com/local/writereview?placeid=x' }),
      link('manual', { link_type: 'custom', name: 'Food menu QR', metadata: null, destination_url: 'https://www.the-anchor.pub/food-menu' }),
    ]
    const excluded = ['email', 'sms', 'pay', 'manage', 'confirm', 'lunch-pay', 'null-key', 'review-ask', 'google-review', 'funnel', 'gpage', 'writereview']
    const { result } = await build(links, [
      ...clicks('promo', THIS_WEEK, 50),
      ...clicks('promo', THIS_WEEK, 4, { device: null }),
      ...clicks('promo', THIS_WEEK, 2, { device: 'unknown' }),
      ...clicks('promo', THIS_WEEK, 3, { device: 'desktop' }),
      ...clicks('promo', THIS_WEEK, 90, { device: 'bot' }),
      ...clicks('manual', THIS_WEEK, 10),
      ...excluded.flatMap((id) => clicks(id, THIS_WEEK, 100)),
    ])
    expect(metric(result, 'Human clicks this week')?.value).toBe('69')
    expect(listTexts(result, 'Top links this week')).toEqual([
      'Quiz Night: 59 clicks, 86% of the total, new this week',
      'Food menu QR: 10 clicks, 14% of the total, new this week',
    ])
    expect(result.headline).toBe('69 human clicks on short links this week, new activity (none in the previous 4 weeks). Top link: Quiz Night with 86%.')
    expect(JSON.stringify(result)).not.toContain('newsletter')
    expectCleanText(result)
  })

  it('rolls variants up to the campaign at the top of the parent chain, under its name', async () => {
    const links = [
      link('root', { name: 'Quiz Night' }),
      link('meta', { parent_link_id: 'root', name: `Quiz Night ${LONG_DASH} Meta ads` }),
      link('ad-1', { link_type: 'custom', parent_link_id: 'meta', name: 'Quiz Night ad 1', metadata: { source: 'paid_media_api', channel: 'meta_ads' } }),
      link('ad-2', { link_type: 'custom', parent_link_id: 'meta', name: 'Quiz Night ad 2', metadata: { source: 'paid_media_api', channel: 'meta_ads' } }),
      link('sms-parent', { link_type: 'custom', name: 'Sunday Lunch', metadata: { source: 'sms_auto_shortener' } }),
      link('sms-variant', { parent_link_id: 'sms-parent', name: `Sunday Lunch ${LONG_DASH} Facebook`, metadata: { event_name: 'Sunday Lunch', channel: 'facebook' } }),
      link('solo', { name: `Live Sport ${LONG_DASH} poster` }),
    ]
    const { result, db } = await build(links, [
      ...clicks('ad-1', THIS_WEEK, 30),
      ...clicks('ad-2', '2026-09-20', 25),
      ...clicks('sms-variant', THIS_WEEK, 5),
      ...clicks('sms-parent', THIS_WEEK, 40),
      ...clicks('solo', THIS_WEEK, 20),
    ])
    expect(listTexts(result, 'Top links this week')).toEqual([
      'Quiz Night: 55 clicks, 69% of the total, new this week',
      'Live Sport, poster: 20 clicks, 25% of the total, new this week',
      'Sunday Lunch: 5 clicks, 6% of the total, new this week',
    ])
    expect(signal(result, 'short_links.win.root')).toEqual({
      key: 'short_links.win.root',
      entity: 'short_link:root',
      rag: 'green',
      kind: 'win',
      text: 'Quiz Night drew 69% of human clicks this week (55 of 80), after none in the previous 4 weeks.',
      emailSafe: true,
    })
    // The clicked links, then their unclicked parent, then the campaign root above it.
    expect(db.calls.filter((call) => call.table === 'short_links')).toHaveLength(3)
    expectCleanText(result)
  })

  it('adds the short code when two campaigns share a name', async () => {
    const links = [link('q1', { name: 'Quiz Night', short_code: 'qz0918' }), link('q2', { name: 'quiz night', short_code: 'qz0925' }), link('solo', { name: 'Live Music' })]
    const { result } = await build(links, [
      ...clicks('q1', THIS_WEEK, 12),
      ...clicks('q2', THIS_WEEK, 8),
      ...clicks('solo', THIS_WEEK, 4),
    ])
    expect(listTexts(result, 'Top links this week')).toEqual([
      'Quiz Night (qz0918): 12 clicks, 50% of the total, new this week',
      'quiz night (qz0925): 8 clicks, 33% of the total, new this week',
      'Live Music: 4 clicks, 17% of the total, new this week',
    ])
  })

  it('names a link without a name after its destination and clips long names', async () => {
    const longName = 'An extremely long campaign name that keeps going well past the sixty character limit'
    const links = [
      link('unnamed', { name: null, destination_url: 'https://www.the-anchor.pub/christmas-parties' }),
      link('long', { name: longName }),
    ]
    const { result } = await build(links, [...clicks('unnamed', THIS_WEEK, 6), ...clicks('long', THIS_WEEK, 4)])
    const texts = listTexts(result, 'Top links this week')
    expect(texts[0]).toBe('Christmas Parties: 6 clicks, 60% of the total, new this week')
    expect(texts[1]).toMatch(/^An extremely long campaign name that keeps going well past\.\.\.: 4 clicks/)
  })

  describe('wins', () => {
    it('marks a link with 30% or more of the clicks, when it has at least 50', async () => {
      const { result } = await build([link('a', { name: 'Steak Night' }), link('b', { name: 'Quiz Night' })], [
        ...each('a', PREVIOUS_4, 60),
        ...each('b', PREVIOUS_4, 140),
        ...clicks('a', THIS_WEEK, 60),
        ...clicks('b', THIS_WEEK, 140),
      ])
      expect(result.signals.map((item) => item.key)).toEqual(['short_links.win.b', 'short_links.win.a'])
      expect(signal(result, 'short_links.win.a')?.text).toBe('Steak Night drew 30% of human clicks this week (60 of 200).')
      expect(signal(result, 'short_links.win.b')?.text).toBe('Quiz Night drew 70% of human clicks this week (140 of 200).')
      expect(result.lists[0].items.map((item) => item.rag)).toEqual(['green', 'green'])
      expect(result.lists[0].items[1].text).toBe('Steak Night: 60 clicks, 30% of the total, 4-week average 60 a week')
    })

    it('does not crown a link with a large share of a quiet week', async () => {
      const { result } = await build([link('a'), link('b')], [
        ...each('a', PREVIOUS_4, 20),
        ...clicks('a', THIS_WEEK, 30),
        ...clicks('b', THIS_WEEK, 10),
      ])
      expect(result.signals).toEqual([])
    })

    it('marks a link gaining 50% or more on its own 4-week average, by at least 50 clicks', async () => {
      const { result } = await build([link('g', { name: 'Pizza Tuesday' }), link('h', { name: 'Sunday Lunch' })], [
        ...each('g', PREVIOUS_4, 40),
        ...each('h', PREVIOUS_4, 300),
        ...clicks('g', THIS_WEEK, 100),
        ...clicks('h', THIS_WEEK, 300),
      ])
      expect(signal(result, 'short_links.win.g')).toEqual({
        key: 'short_links.win.g',
        entity: 'short_link:g',
        rag: 'green',
        kind: 'win',
        text: 'Pizza Tuesday drew 100 human clicks this week, up from 40 a week over the previous 4 weeks.',
        emailSafe: true,
      })
      expect(listTexts(result, 'Top links this week')[1]).toBe('Pizza Tuesday: 100 clicks, 25% of the total, gaining on its 4-week average of 40 a week')
    })

    it('does not call a small or slight rise gaining', async () => {
      // 20 to 45 a week is up 125% but only 25 clicks; 80 to 115 is 35 clicks and only up 44%.
      const { result } = await build([link('small'), link('slight'), link('big')], [
        ...each('small', PREVIOUS_4, 20),
        ...each('slight', PREVIOUS_4, 80),
        ...each('big', PREVIOUS_4, 400),
        ...clicks('small', THIS_WEEK, 45),
        ...clicks('slight', THIS_WEEK, 115),
        ...clicks('big', THIS_WEEK, 400),
      ])
      expect(result.signals.map((item) => item.key)).toEqual(['short_links.win.big'])
    })

    it('marks a link with 50 or more clicks after none in the previous 4 weeks, together with its share', async () => {
      const { result } = await build([link('new', { name: 'Halloween Party' }), link('big', { name: 'Sunday Lunch' })], [
        ...each('big', PREVIOUS_4, 200),
        ...clicks('big', THIS_WEEK, 200),
        ...clicks('new', THIS_WEEK, 60),
        ...clicks('new', '2026-08-01', 30),
      ])
      expect(signal(result, 'short_links.win.new')?.text).toBe('Halloween Party drew 60 human clicks this week, after none in the previous 4 weeks.')

      const shared = await build([link('new', { name: 'Halloween Party' }), link('small', { name: 'Quiz Night' })], [
        ...each('small', PREVIOUS_4, 20),
        ...clicks('small', THIS_WEEK, 20),
        ...clicks('new', THIS_WEEK, 80),
      ])
      expect(signal(shared.result, 'short_links.win.new')?.text).toBe('Halloween Party drew 80% of human clicks this week (80 of 100), after none in the previous 4 weeks.')
    })

    it('shares a small baseline as a weekly figure, not a runaway percentage', async () => {
      const { result } = await build([link('ad', { name: 'Lunch and Dinner' })], [
        ...clicks('ad', '2026-09-01', 1),
        ...clicks('ad', THIS_WEEK, 352),
      ])
      expect(signal(result, 'short_links.win.ad')?.text).toBe('Lunch and Dinner drew 100% of human clicks this week (352 of 352), up from 0.3 a week over the previous 4 weeks.')
    })
  })

  describe('watch items', () => {
    it('raises amber when total clicks fall 40% or more on the 4-week average', async () => {
      const links = [link('a', { name: 'Quiz Night' }), link('b', { name: 'Steak Night' })]
      const { result } = await build(links, [
        ...each('a', PREVIOUS_4, 150),
        ...each('b', PREVIOUS_4, 50),
        ...clicks('a', THIS_WEEK, 80),
        ...clicks('b', THIS_WEEK, 20),
      ])
      expect(signal(result, 'short_links.total_drop')).toEqual({
        key: 'short_links.total_drop',
        rag: 'amber',
        kind: 'issue',
        text: 'Human clicks on short links fell to 100 this week, down 50% on the 4-week average of 200 a week.',
        emailSafe: true,
      })
      expect(result.headline).toBe('100 human clicks on short links this week, down 50% on the 4-week average of 200 a week. Top link: Quiz Night with 80%.')
      expect(metric(result, 'Human clicks this week')).toEqual({
        label: 'Human clicks this week',
        value: '100',
        comparison: 'down 50% on the 4-week average of 200 a week; 13-week average 62 a week',
      })
    })

    it('stays quiet on a 30% fall, and on a 45% fall of fewer than 50 clicks', async () => {
      const thirty = await build([link('a')], [...each('a', PREVIOUS_4, 200), ...clicks('a', THIS_WEEK, 140)])
      expect(thirty.result.signals.filter((item) => item.kind === 'issue')).toEqual([])
      expect(metric(thirty.result, 'Human clicks this week')?.comparison).toBe('down 30% on the 4-week average of 200 a week; 13-week average 62 a week')

      const small = await build([link('a')], [...each('a', PREVIOUS_4, 100), ...clicks('a', THIS_WEEK, 55)])
      expect(small.result.signals.filter((item) => item.kind === 'issue')).toEqual([])
    })

    it("raises amber for a link in last week's top 5 that fell 50% or more", async () => {
      const links = ['l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7'].map((id) => link(id, { name: `Campaign ${id}` }))
      const { result } = await build(links, [
        ...clicks('l1', LAST_WEEK, 200), ...clicks('l1', THIS_WEEK, 80),
        ...clicks('l2', LAST_WEEK, 180), ...clicks('l2', THIS_WEEK, 170),
        ...clicks('l3', LAST_WEEK, 120),
        ...clicks('l4', LAST_WEEK, 110), ...clicks('l4', THIS_WEEK, 120),
        ...clicks('l5', LAST_WEEK, 90), ...clicks('l5', THIS_WEEK, 50),
        // Sixth last week: its fall is not a top-5 loss.
        ...clicks('l6', LAST_WEEK, 85),
        ...clicks('l7', THIS_WEEK, 30),
      ])
      const losing = result.signals.filter((item) => item.key.startsWith('short_links.top_losing.'))
      expect(losing).toEqual([
        {
          key: 'short_links.top_losing.l1',
          entity: 'short_link:l1',
          rag: 'amber',
          kind: 'issue',
          text: 'Campaign l1 fell to 80 human clicks this week from 200 last week, down 60%.',
          emailSafe: true,
        },
        {
          key: 'short_links.top_losing.l3',
          entity: 'short_link:l3',
          rag: 'amber',
          kind: 'issue',
          text: 'Campaign l3 had no human clicks this week after 120 last week.',
          emailSafe: true,
        },
      ])
      // l5 fell 44%, by 40 clicks: not enough.
      expect(signal(result, 'short_links.top_losing.l5')).toBeUndefined()
      expect(signal(result, 'short_links.top_losing.l6')).toBeUndefined()
      expect(result.lists[0].items.find((item) => item.text.startsWith('Campaign l1'))?.rag).toBe('amber')
    })

    it('does not call a link gaining while it is falling against last week', async () => {
      const links = [link('fall', { name: 'Beer Festival' }), link('big', { name: 'Sunday Lunch' })]
      const { result } = await build(links, [
        // 4-week average 100 (all of it last week); 160 this week is up 60% on that, but down 60% on last week.
        ...clicks('fall', LAST_WEEK, 400),
        ...clicks('fall', THIS_WEEK, 160),
        ...each('big', PREVIOUS_4, 500),
        ...clicks('big', THIS_WEEK, 500),
      ])
      expect(signal(result, 'short_links.top_losing.fall')?.rag).toBe('amber')
      expect(signal(result, 'short_links.win.fall')).toBeUndefined()
      expect(result.lists[0].items.find((item) => item.text.startsWith('Beer Festival'))?.rag).toBe('amber')
    })

    it('raises no win for a falling link that still holds 30% or more of the week', async () => {
      const links = [link('fall', { name: 'Paid Campaign' }), link('other', { name: 'Quiz Night' })]
      const { result } = await build(links, [
        // 400 last week, 120 of this week's 220: down 70%, yet 55% of the week and above the floor.
        ...clicks('fall', LAST_WEEK, 400),
        ...clicks('fall', THIS_WEEK, 120),
        ...each('other', PREVIOUS_4, 100),
        ...clicks('other', THIS_WEEK, 100),
      ])
      expect(result.signals).toEqual([
        {
          key: 'short_links.top_losing.fall',
          entity: 'short_link:fall',
          rag: 'amber',
          kind: 'issue',
          text: 'Paid Campaign fell to 120 human clicks this week from 400 last week, down 70%.',
          emailSafe: true,
        },
        // Another link's win is untouched.
        {
          key: 'short_links.win.other',
          entity: 'short_link:other',
          rag: 'green',
          kind: 'win',
          text: 'Quiz Night drew 45% of human clicks this week (100 of 220).',
          emailSafe: true,
        },
      ])
      expect(result.signals.filter((item) => item.entity === 'short_link:fall' && item.kind === 'win')).toEqual([])
      // The share is still reported, on its amber row.
      expect(result.lists[0].items[0]).toEqual({
        text: 'Paid Campaign: 120 clicks, 55% of the total, 4-week average 100 a week',
        href: INSIGHTS_HREF,
        rag: 'amber',
      })
    })

    it('raises no win for a falling link that would have both a large share and a gain on its 4-week average', async () => {
      const links = [link('fall', { name: 'Paid Campaign' }), link('other', { name: 'Quiz Night' })]
      const { result } = await build(links, [
        // 160 of 260 (62%), up 60% on its 4-week average of 100, but down 60% on last week's 400.
        ...clicks('fall', LAST_WEEK, 400),
        ...clicks('fall', THIS_WEEK, 160),
        ...each('other', PREVIOUS_4, 100),
        ...clicks('other', THIS_WEEK, 100),
      ])
      expect(result.signals.map((item) => item.key)).toEqual(['short_links.top_losing.fall', 'short_links.win.other'])
      expect(result.signals.filter((item) => item.kind === 'win').map((item) => item.text)).toEqual([
        'Quiz Night drew 38% of human clicks this week (100 of 260).',
      ])
      expect(result.lists[0].items[0]).toMatchObject({
        text: 'Paid Campaign: 160 clicks, 62% of the total, gaining on its 4-week average of 100 a week',
        rag: 'amber',
      })
    })
  })

  it('shows the totals, trend and the top links over 13 weeks', async () => {
    const links = [link('a', { name: 'Quiz Night' }), link('b', { name: 'Steak Night' }), link('c', { name: 'Live Sport' }), link('d', { name: 'Old Poster' })]
    const { result } = await build(links, [
      // Quiz Night: 100 a week for 9 weeks, then 250 a week over the last 4.
      ...each('a', PREVIOUS_13.slice(0, 9), 100),
      ...each('a', PREVIOUS_4, 250),
      ...clicks('a', THIS_WEEK, 250),
      ...clicks('b', '2026-07-10', 300),
      ...clicks('c', THIS_WEEK, 40),
      // 19 Jun is in the 13-week baseline but not in the last 13 weeks.
      ...clicks('d', '2026-06-19', 30),
      ...clicks('d', '2026-06-26', 1),
    ])
    expect(result.metrics).toEqual([
      { label: 'Human clicks this week', value: '290', comparison: 'in line with the 4-week average of 250 a week; 13-week average 172 a week' },
      { label: 'Top link this week', value: 'Quiz Night', comparison: '250 clicks, 86% of the total' },
      { label: 'Trend over 13 weeks', value: 'Growing', comparison: '250 a week over the last 4 weeks against 172 a week over 13 weeks' },
      { label: 'Links clicked this week', value: '2', comparison: '1 last week' },
      { label: 'Human clicks, last 13 weeks', value: '2,391' },
    ])
    expect(listTexts(result, 'Top links over the last 13 weeks')).toEqual([
      'Quiz Night: 2,050 clicks, 86% of the 13-week total',
      'Steak Night: 300 clicks, 13% of the 13-week total',
      'Live Sport: 40 clicks, 2% of the 13-week total',
    ])
    expect(result.lists.every((list) => list.items.every((item) => item.href === INSIGHTS_HREF))).toBe(true)
    expect(result.notes).toEqual(['Human clicks on marketing links only, grouped by campaign; email campaign, guest, booking, text and review links are left out.'])
  })

  it('shows at most five links this week, most clicked first', async () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
    const { result } = await build(ids.map((id) => link(id, { name: `Link ${id}` })), ids.flatMap((id, index) => clicks(id, THIS_WEEK, 10 + index)))
    expect(listTexts(result, 'Top links this week').map((text) => text.split(':')[0])).toEqual(['Link g', 'Link f', 'Link e', 'Link d', 'Link c'])
    expect(metric(result, 'Links clicked this week')?.value).toBe('7')
  })

  it('says so when nothing was clicked this week but there was recent history', async () => {
    const { result } = await build([link('a')], each('a', PREVIOUS_4, 30))
    expect(result.headline).toBe('No human clicks on short links this week, against a 4-week average of 30 a week.')
    expect(result.lists[0]).toEqual({ title: 'Top links this week', items: [], emptyText: 'No human clicks this week.' })
    expect(metric(result, 'Top link this week')).toBeUndefined()
    // 0 against 30 a week is down 100% but only 30 clicks, below the floor of 50.
    expect(result.signals).toEqual([])
  })

  describe('history', () => {
    it('makes no comparison before four weeks of clicks exist, and still marks a dominant link', async () => {
      // Report on Fri 25 Jul 2025: clicks began on 14 Jul 2025, after the 4-week window and last week began.
      const now = new Date('2025-07-25T05:00:00Z')
      const { result } = await build([link('a', { name: 'Summer Fete' })], [
        ...clicks('a', '2025-07-14', 200),
        ...clicks('a', '2025-07-18', 100),
      ], now)
      expect(result.signals.map((item) => item.key)).toEqual(['short_links.win.a'])
      expect(signal(result, 'short_links.win.a')?.text).toBe('Summer Fete drew 100% of human clicks this week (100 of 100).')
      expect(result.notes[0]).toBe('Not enough short link history yet to compare with the 4-week average.')
      expect(metric(result, 'Human clicks this week')?.comparison).toBe('not enough history yet for the 4-week average')
      expect(metric(result, 'Trend over 13 weeks')).toEqual({ label: 'Trend over 13 weeks', value: 'Not enough history yet', comparison: undefined })
      expect(metric(result, 'Links clicked this week')?.comparison).toBeUndefined()
      expect(result.headline).toBe('100 human clicks on short links this week, not enough history yet for the 4-week average. Top link: Summer Fete with 100%.')
      expect(listTexts(result, 'Top links this week')).toEqual(['Summer Fete: 100 clicks, 100% of the total'])
      expectCleanText(result)
    })

    it('compares with 4 weeks but not 13 until 13 weeks of clicks exist', async () => {
      // Report on Fri 12 Sep 2025: the 4-week window starts 8 Aug, the 13-week one 6 Jun.
      const now = new Date('2025-09-12T05:00:00Z')
      const { result } = await build([link('a')], [
        ...each('a', ['2025-08-08', '2025-08-15', '2025-08-22', '2025-08-29'], 100),
        ...clicks('a', '2025-09-05', 100),
      ], now)
      expect(result.notes[0]).toBe('Not enough short link history yet for the 13-week average or trend.')
      expect(metric(result, 'Human clicks this week')?.comparison).toBe('in line with the 4-week average of 100 a week')
      expect(metric(result, 'Trend over 13 weeks')?.value).toBe('Not enough history yet')
    })
  })

  describe('London days', () => {
    it('counts a click after midnight London time in the day it happened in London', async () => {
      const { result } = await build([link('a')], [
        // 00:30 BST on Fri 18 Sep, the first minute of this week.
        ...clicks('a', '2026-09-17', 3, { time: '23:30:00' }),
        // 23:30 BST on Thu 17 Sep, last week.
        ...clicks('a', '2026-09-17', 2, { time: '22:30:00' }),
        // 00:30 BST today, Fri 25 Sep: after the report window.
        ...clicks('a', '2026-09-24', 7, { time: '23:30:00' }),
        // 00:30 BST on Fri 19 Jun, the first day of the 13-week baseline.
        ...clicks('a', '2026-06-18', 4, { time: '23:30:00' }),
        // 23:30 BST on Thu 18 Jun, before it.
        ...clicks('a', '2026-06-18', 6, { time: '22:30:00' }),
      ])
      expect(metric(result, 'Human clicks this week')?.value).toBe('3')
      expect(metric(result, 'Links clicked this week')?.comparison).toBe('1 last week')
      expect(metric(result, 'Human clicks, last 13 weeks')?.value).toBe('5')
      // 13-week average: (4 + 2) / 13 weeks.
      expect(metric(result, 'Human clicks this week')?.comparison).toContain('13-week average 0.5 a week')
    })

    it('keeps whole London days across the October clock change', async () => {
      // Fri 30 Oct 2026 06:00 GMT: this week is Fri 23 Oct to Thu 29 Oct, with 25 Oct 25 hours long.
      const now = new Date('2026-10-30T06:00:00Z')
      const { result } = await build([link('a')], [
        ...clicks('a', '2026-10-22', 2, { time: '23:30:00' }),
        ...clicks('a', '2026-10-29', 3, { time: '23:30:00' }),
        ...clicks('a', '2026-10-30', 5, { time: '00:30:00' }),
        ...clicks('a', '2026-10-22', 7, { time: '22:30:00' }),
      ], now)
      expect(metric(result, 'Human clicks this week')?.value).toBe('5')
      expect(metric(result, 'Links clicked this week')?.comparison).toBe('1 last week')
    })
  })

  it('reads every click through paged requests, with no silent cap', async () => {
    const { result, db } = await build([link('a')], clicks('a', THIS_WEEK, 1_250))
    expect(metric(result, 'Human clicks this week')?.value).toBe('1,250')
    expect(db.calls.filter((call) => call.table === 'short_link_clicks')).toHaveLength(2)
  })

  it('looks links up in chunks and keeps every signal email safe with no action', async () => {
    const ids = Array.from({ length: 160 }, (_, index) => `link-${String(index).padStart(3, '0')}`)
    const links = ids.map((id) => link(id, { name: `Poster ${id}` }))
    const { result, db } = await build(links, [
      ...ids.flatMap((id) => clicks(id, LAST_WEEK, 1)),
      ...clicks('link-000', LAST_WEEK, 300),
      ...clicks('link-001', THIS_WEEK, 120),
    ])
    expect(db.calls.filter((call) => call.table === 'short_links')).toHaveLength(2)
    expect(result.signals.length).toBeGreaterThan(0)
    for (const item of result.signals) {
      expect(item.emailSafe).toBe(true)
      expect(item.action).toBeUndefined()
      expect(item.key.startsWith('short_links.')).toBe(true)
    }
    expectCleanText(result)
  })
})
