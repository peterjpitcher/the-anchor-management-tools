import { describe, expect, it, vi } from 'vitest'
import { buildMarketingSection, marketingSection } from '@/lib/insights/sections/marketing'
import { dedupeByEntity, sectionStatusOf } from '@/lib/insights/signals'
import type { InsightSignal, SectionBuildResult } from '@/lib/insights/types'
import { getCampaignStats, readCampaignDeliveryStats } from '@/services/marketing-campaigns'
import { FakeDb } from '../helpers/fake-db'
import { makeContext } from '../helpers/context'

// getCampaignStats creates its own client; point it at the fake so the thin wrapper can be
// checked against the same fixtures. Sections never use this: they read through ctx.db.
const adminDb = vi.hoisted(() => ({ current: null as unknown }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => adminDb.current }))

/** Fri 4 Dec 2026 06:00 London (GMT). Its 13-week window starts 28 Aug, after marketing began. */
const LATE = new Date('2026-12-04T06:00:00.000Z')
const APP = 'https://management.example.test'
const LONG_DASH = String.fromCharCode(0x2014)

type Row = Record<string, unknown>

interface CampaignSpec {
  id: string
  name?: string
  audience?: 'customer' | 'business'
  status?: string
  startedAt: string
  scheduledFor?: string
  sent?: number
  skipped?: number
  pending?: number
  bounced?: number
  opened?: number
  complained?: number
  clickers?: number
  unsubscribes?: number
}

function iso(value: string, addMinutes = 0): string {
  return new Date(Date.parse(value) + addMinutes * 60_000).toISOString()
}

function emptyDb(): FakeDb {
  return new FakeDb({
    marketing_campaigns: [],
    marketing_campaign_recipients: [],
    email_messages: [],
    customers: [],
    business_contacts: [],
    short_links: [],
    short_link_clicks: [],
  })
}

function table(db: FakeDb, name: string): Row[] {
  db.tables[name] ??= []
  return db.tables[name]
}

function pad(i: number): string {
  return String(i).padStart(4, '0')
}

/**
 * A campaign with `sent` recipients, each with its own message. Bounced messages are the last
 * ones and are never delivered. Recipients and unsubscribers carry an email and a name, so
 * tests can prove no personal detail reaches the report.
 */
function addCampaign(db: FakeDb, spec: CampaignSpec): void {
  const audience = spec.audience ?? 'customer'
  const sent = spec.sent ?? 240
  const bounced = spec.bounced ?? 0
  const delivered = sent - bounced
  const opened = spec.opened ?? Math.floor(delivered / 2)
  table(db, 'marketing_campaigns').push({
    id: spec.id,
    name: spec.name ?? `Campaign ${spec.id}`,
    status: spec.status ?? 'completed',
    audience_type: audience,
    scheduled_for: spec.scheduledFor ?? spec.startedAt,
    started_at: spec.startedAt,
  })
  const at = iso(spec.startedAt, 5)
  for (let i = 0; i < sent; i += 1) {
    const messageId = `${spec.id}-m${pad(i)}`
    table(db, 'marketing_campaign_recipients').push({
      id: `${spec.id}-r${pad(i)}`,
      campaign_id: spec.id,
      status: 'sent',
      skip_reason: null,
      email_message_id: messageId,
      email: `alice.example${i}@example.test`,
      contact_name: 'Alice Example',
    })
    const isBounced = i >= sent - bounced
    table(db, 'email_messages').push({
      id: messageId,
      marketing_campaign_id: spec.id,
      comm_type: 'marketing_campaign',
      delivered_at: isBounced ? null : at,
      opened_at: !isBounced && i < opened ? at : null,
      clicked_at: null,
      bounced_at: isBounced ? at : null,
      complained_at: !isBounced && i < (spec.complained ?? 0) ? at : null,
      failed_at: null,
    })
  }
  for (let i = 0; i < (spec.skipped ?? 0); i += 1) {
    table(db, 'marketing_campaign_recipients').push({
      id: `${spec.id}-s${pad(i)}`,
      campaign_id: spec.id,
      status: 'skipped',
      skip_reason: 'frequency_cap',
      email_message_id: null,
    })
  }
  for (let i = 0; i < (spec.pending ?? 0); i += 1) {
    table(db, 'marketing_campaign_recipients').push({
      id: `${spec.id}-p${pad(i)}`,
      campaign_id: spec.id,
      status: 'pending',
      skip_reason: null,
      email_message_id: null,
    })
  }
  const linkId = `${spec.id}-link`
  table(db, 'short_links').push({
    id: linkId,
    short_code: `sc-${spec.id}`,
    destination_url: 'https://www.the-anchor.pub/whats-on',
    metadata: { channel: 'marketing_email', campaign_id: spec.id },
    // The fake resolves a PostgREST JSON path such as metadata->>campaign_id as a plain key.
    'metadata->>campaign_id': spec.id,
  })
  for (let i = 0; i < (spec.clickers ?? 0); i += 1) {
    table(db, 'short_link_clicks').push({
      id: `${spec.id}-k${pad(i)}`,
      short_link_id: linkId,
      utm_content: `${spec.id}-r${pad(i)}`,
      clicked_at: iso(spec.startedAt, 60),
      device_type: 'desktop',
    })
  }
  for (let i = 0; i < (spec.unsubscribes ?? 0); i += 1) {
    if (audience === 'customer') {
      table(db, 'customers').push({ id: `${spec.id}-u${i}`, marketing_unsubscribe_campaign_id: spec.id, first_name: 'Bob', last_name: 'Private' })
    } else {
      table(db, 'business_contacts').push({ id: `${spec.id}-u${i}`, unsubscribe_campaign_id: spec.id, contact_name: 'Bob Private' })
    }
  }
}

function addScheduled(db: FakeDb, id: string, name: string, scheduledFor: string, audience: 'customer' | 'business' = 'customer'): void {
  table(db, 'marketing_campaigns').push({ id, name, status: 'scheduled', audience_type: audience, scheduled_for: scheduledFor, started_at: null })
}

/** Three earlier customer campaigns inside the 13-week window of LATE. */
function addHistory(db: FakeDb, prefix: string, spec: Omit<CampaignSpec, 'id' | 'startedAt'> | Array<Omit<CampaignSpec, 'id' | 'startedAt'>>): void {
  const dates = ['2026-10-02', '2026-10-16', '2026-11-06']
  dates.forEach((date, index) => {
    const each = Array.isArray(spec) ? spec[index] : spec
    addCampaign(db, { ...each, id: `${prefix}${index + 1}`, startedAt: `${date}T11:00:00.000Z` })
  })
}

function keys(result: SectionBuildResult): string[] {
  return result.signals.map((item) => item.key)
}

function signal(result: SectionBuildResult, key: string): InsightSignal {
  const found = result.signals.find((item) => item.key === key)
  if (!found) throw new Error(`No signal ${key}; have ${keys(result).join(', ')}`)
  return found
}

function assertPrintable(result: SectionBuildResult): void {
  const text = JSON.stringify(result)
  for (const bad of ['undefined', 'NaN', 'Invalid Date', 'Infinity', LONG_DASH, '!']) expect(text).not.toContain(bad)
}

describe('marketing section', () => {
  it('is registered as the marketing section', () => {
    expect(marketingSection).toMatchObject({ key: 'marketing', title: 'Marketing emails', path: '/marketing' })
  })

  it('says so plainly when nothing was sent and nothing is scheduled', async () => {
    const result = await buildMarketingSection(makeContext(emptyDb()))
    expect(result.headline).toBe('No campaigns this week and none scheduled.')
    expect(result.signals).toEqual([])
    expect(sectionStatusOf(result.signals)).toBe('green')
    expect(result.metrics[0]).toEqual({ label: 'Campaigns this week', value: '0' })
    expect(result.metrics).toContainEqual({ label: 'Next campaign', value: 'None scheduled' })
    expect(result.metrics).toContainEqual({ label: 'Bookings from email', value: 'Not measurable yet' })
    expect(result.notes).toEqual([])
    assertPrintable(result)
  })

  it('names the next scheduled campaign when none went out this week', async () => {
    const db = emptyDb()
    addScheduled(db, 'later', 'November round-up', '2026-11-01T09:00:00.000Z')
    addScheduled(db, 'soon', 'October round-up', '2026-09-30T07:00:00.000Z')
    addScheduled(db, 'b-soon', 'Christmas parties', '2026-10-02T07:30:00.000Z', 'business')
    // Sent in the week before this one: not this week's campaign.
    addCampaign(db, { id: 'old', startedAt: '2026-09-14T10:00:00.000Z' })
    const result = await buildMarketingSection(makeContext(db))
    expect(result.headline).toBe('No campaigns this week. Next: October round-up, Wed 30 Sep.')
    expect(result.metrics).toContainEqual({ label: 'Next campaign', value: 'October round-up', comparison: 'Wed 30 Sep, customer email' })
    expect(result.signals).toEqual([])
    expect(sectionStatusOf(result.signals)).toBe('green')
  })

  it('uses London dates for the week: 00:30 on Friday morning belongs to that Friday', async () => {
    const db = emptyDb()
    // 23:30 UTC on Thu 17 Sep is 00:30 BST on Fri 18 Sep: the first day of this week.
    addCampaign(db, { id: 'edge-in', name: 'Late night send', startedAt: '2026-09-17T23:30:00.000Z' })
    // 23:30 UTC on Thu 24 Sep is 00:30 BST today, so it is not this week yet.
    addCampaign(db, { id: 'edge-out', name: 'Today send', startedAt: '2026-09-24T23:30:00.000Z' })
    const result = await buildMarketingSection(makeContext(db))
    expect(result.lists.map((list) => list.title)).toEqual(['Late night send (customer email, first sent Fri 18 Sep)'])
    expect(JSON.stringify(result)).not.toContain('Today send')
  })

  it('shows one entry per campaign with rates against same-audience averages', async () => {
    const db = emptyDb()
    // Customer campaigns in the previous 4 weeks: 3 of 240 clicked (1.25%) and 12 of 240 (5%).
    addCampaign(db, { id: 'c1', startedAt: '2026-08-28T10:00:00.000Z', clickers: 3 })
    addCampaign(db, { id: 'c2', startedAt: '2026-09-11T13:00:00.000Z', clickers: 12 })
    // A business campaign with a far higher click rate must not move the customer average.
    addCampaign(db, { id: 'b1', audience: 'business', sent: 150, startedAt: '2026-09-07T07:30:00.000Z', clickers: 60 })
    addCampaign(db, { id: 'now', name: 'September supper club', startedAt: '2026-09-22T10:00:00.000Z', clickers: 6, unsubscribes: 2, opened: 110 })
    const result = await buildMarketingSection(makeContext(db))

    expect(result.headline).toBe('September supper club: 240 delivered, click rate 2.5% (4-week customer average 3.1%).')
    expect(result.metrics.slice(0, 4)).toEqual([
      { label: 'Campaigns this week', value: '1', comparison: '1 customer' },
      { label: 'Delivered', value: '240', comparison: 'of 240 sent' },
      { label: 'Click rate, September supper club', value: '2.5%', comparison: '4-week customer average 3.1%' },
      { label: 'Unsubscribes', value: '2', comparison: '0.8% of delivered' },
    ])
    expect(result.metrics).toContainEqual({ label: 'Bookings from email', value: 'Not measurable yet' })

    const [list] = result.lists
    expect(list.title).toBe('September supper club (customer email, first sent Tue 22 Sep)')
    const texts = list.items.map((item) => item.text)
    expect(texts[0]).toBe('Delivered 240 of 240 sent.')
    expect(texts).toContain('Click rate 2.5% (6 people clicked). Customer average: 2 weeks 5.0%, 4 weeks 3.1%, 13 weeks not enough history yet.')
    expect(texts).toContain('Click-to-open 5.5%. Customer average: 2 weeks 10.0%, 4 weeks 6.3%, 13 weeks not enough history yet.')
    expect(texts.some((text) => text.startsWith('Open rate 45.8% (indicative only).'))).toBe(true)
    expect(texts).toContain('No spam complaints.')
    expect(list.items.every((item) => item.href === `${APP}/marketing/campaigns/now`)).toBe(true)
    expect(result.notes).toContain('Marketing emails began on 16 Aug 2026, so there is not enough history yet for the 13-week comparison. The unsubscribe, click-rate and best-campaign checks start on 22 Nov 2026.')
    assertPrintable(result)
  })

  it('counts messages through each recipient, not every message tagged with the campaign', async () => {
    const db = emptyDb()
    addCampaign(db, { id: 'x', startedAt: '2026-09-22T10:00:00.000Z', sent: 60 })
    // A failed retry and a test send that no recipient points at: never counted.
    table(db, 'email_messages').push(
      { id: 'x-retry', marketing_campaign_id: 'x', comm_type: 'marketing_campaign', delivered_at: null, opened_at: null, clicked_at: null, bounced_at: '2026-09-22T10:05:00.000Z', complained_at: null, failed_at: '2026-09-22T10:05:00.000Z' },
      { id: 'x-test', marketing_campaign_id: 'x', comm_type: 'marketing_campaign_test', delivered_at: '2026-09-21T10:05:00.000Z', opened_at: null, clicked_at: null, bounced_at: '2026-09-21T10:05:00.000Z', complained_at: null, failed_at: null },
    )
    // A recipient whose message lost its campaign tag is still counted, read by id.
    table(db, 'marketing_campaign_recipients').push({ id: 'x-r9999', campaign_id: 'x', status: 'sent', skip_reason: null, email_message_id: 'x-untagged' })
    table(db, 'email_messages').push({ id: 'x-untagged', marketing_campaign_id: null, comm_type: 'marketing_campaign', delivered_at: '2026-09-22T10:05:00.000Z', opened_at: null, clicked_at: null, bounced_at: null, complained_at: null, failed_at: null })

    const read = await readCampaignDeliveryStats(makeContext(db).db, [{ id: 'x', audienceType: 'customer', scheduledFor: '2026-09-22T10:00:00.000Z' }])
    expect(read.get('x')).toMatchObject({ recipients: 61, sent: 61, delivered: 61, bounced: 0 })
  })

  it('counts unique human clickers over delivered, leaving out bots, early clicks and strangers', async () => {
    const db = emptyDb()
    addCampaign(db, { id: 'k', startedAt: '2026-09-22T10:00:00.000Z', sent: 100, clickers: 4 })
    table(db, 'short_link_clicks').push(
      // The same person clicking again is still one clicker.
      { id: 'k-k9001', short_link_id: 'k-link', utm_content: 'k-r0000', clicked_at: '2026-09-22T12:00:00.000Z', device_type: 'mobile' },
      // A bot, a click before the send (a test) and a click from someone not on this campaign.
      { id: 'k-k9002', short_link_id: 'k-link', utm_content: 'k-r0010', clicked_at: '2026-09-22T12:00:00.000Z', device_type: 'bot' },
      { id: 'k-k9003', short_link_id: 'k-link', utm_content: 'k-r0011', clicked_at: '2026-09-22T09:00:00.000Z', device_type: 'desktop' },
      { id: 'k-k9004', short_link_id: 'k-link', utm_content: 'someone-else', clicked_at: '2026-09-22T12:00:00.000Z', device_type: 'desktop' },
    )
    const read = await readCampaignDeliveryStats(makeContext(db).db, [{ id: 'k', audienceType: 'customer', scheduledFor: '2026-09-22T10:00:00.000Z' }])
    expect(read.get('k')?.engagement).toEqual({ clicks: 6, uniqueClickers: 4, filteredClicks: 2 })
    const result = await buildMarketingSection(makeContext(db))
    expect(result.metrics).toContainEqual(expect.objectContaining({ label: 'Click rate, Campaign k', value: '4.0%' }))
  })

  it('keeps getCampaignStats working as a thin wrapper, conversions included', async () => {
    const db = emptyDb()
    addCampaign(db, { id: 'w', audience: 'business', sent: 80, bounced: 2, clickers: 5, unsubscribes: 1, skipped: 3, startedAt: '2026-09-22T10:00:00.000Z' })
    adminDb.current = db.asDb()
    const stats = await getCampaignStats('w')
    expect(stats).toMatchObject({
      campaignId: 'w',
      recipients: 83,
      sent: 80,
      skipped: 3,
      skippedByReason: { frequency_cap: 3 },
      delivered: 78,
      bounced: 2,
      clicked: 5,
      unsubscribed: 1,
      rates: { bounceRate: 0.025, clickRate: 0.0625, unsubscribeRate: 0.0125 },
      engagement: { clicks: 5, uniqueClickers: 5, filteredClicks: 0, conversions: { bookings: 0, enquiries: 0, total: 0 }, conversionValue: null },
    })
  })

  describe('bounces and complaints', () => {
    it('raises red at 5% bounces with an action due before the next send to that list', async () => {
      const db = emptyDb()
      addScheduled(db, 'next-b', 'October business news', '2026-10-02T07:30:00.000Z', 'business')
      addScheduled(db, 'next-c', 'October round-up', '2026-09-30T07:00:00.000Z', 'customer')
      addCampaign(db, { id: 'b', name: 'Christmas parties', audience: 'business', sent: 156, bounced: 8, startedAt: '2026-09-21T07:30:00.000Z' })
      const result = await buildMarketingSection(makeContext(db))
      expect(signal(result, 'marketing.bounce_high.b')).toMatchObject({
        entity: 'marketing_campaign:b',
        rag: 'red',
        kind: 'issue',
        emailSafe: true,
        text: 'Christmas parties: bounce rate 5.1% (8 of 156 sent).',
        action: {
          text: 'Check list quality before the next business send: Christmas parties had a bounce rate 5.1% (8 of 156 sent)',
          href: `${APP}/marketing/campaigns/b`,
          target: 'record',
          dueDate: '2026-10-02',
          impact: 'customer',
        },
      })
      expect(keys(result)).not.toContain('marketing.bounce_or_complaint.b')
      expect(sectionStatusOf(result.signals)).toBe('red')
      expect(result.lists[0].items.find((item) => item.text.startsWith('Bounce rate'))?.rag).toBe('red')
    })

    it('raises amber at 2% bounces, and for any complaint, with the facts in one line', async () => {
      const db = emptyDb()
      addCampaign(db, { id: 'a', name: 'Quiz night', sent: 200, bounced: 5, complained: 1, startedAt: '2026-09-20T10:00:00.000Z' })
      addCampaign(db, { id: 'c', name: 'Sunday roast', sent: 200, complained: 2, startedAt: '2026-09-21T10:00:00.000Z' })
      const result = await buildMarketingSection(makeContext(db))
      expect(signal(result, 'marketing.bounce_or_complaint.a')).toMatchObject({
        rag: 'amber',
        kind: 'issue',
        text: 'Quiz night: bounce rate 2.5% (5 of 200 sent) and 1 spam complaint.',
        emailSafe: true,
      })
      expect(signal(result, 'marketing.bounce_or_complaint.a').action).toBeUndefined()
      expect(signal(result, 'marketing.bounce_or_complaint.c').text).toBe('Sunday roast: 2 spam complaints.')
      expect(sectionStatusOf(result.signals)).toBe('amber')
      expect(result.headline).toBe('2 campaigns this week, 395 delivered.')
    })

    it('keeps a complaint on a red campaign as its own supporting line', async () => {
      const db = emptyDb()
      addCampaign(db, { id: 'r', sent: 100, bounced: 6, complained: 1, startedAt: '2026-09-21T10:00:00.000Z' })
      const result = await buildMarketingSection(makeContext(db))
      expect(keys(result)).toEqual(['marketing.bounce_high.r', 'marketing.bounce_or_complaint.r'])
      expect(signal(result, 'marketing.bounce_or_complaint.r').text).toBe('Campaign r: 1 spam complaint.')
    })

    it('does not treat one bounce on a tiny frequency-capped send as a list problem', async () => {
      const db = emptyDb()
      addCampaign(db, { id: 't', sent: 4, bounced: 1, skipped: 249, startedAt: '2026-09-21T10:00:00.000Z' })
      const result = await buildMarketingSection(makeContext(db))
      expect(result.signals).toEqual([])
      expect(result.notes).toContain('1 campaign reached fewer than 50 people, so it is kept out of averages and best-campaign claims.')
      expect(result.lists[0].items.map((item) => item.text)).toContain('Delivered 3 of 4 sent; 249 skipped.')
    })
  })

  describe('early figures', () => {
    it('labels a campaign first sent in the last 24 hours and raises nothing for it', async () => {
      const db = emptyDb()
      // Thu 24 Sep 18:00 BST: twelve hours before the report.
      addCampaign(db, { id: 'e', name: 'Halloween party', sent: 100, bounced: 10, complained: 3, startedAt: '2026-09-24T17:00:00.000Z' })
      const result = await buildMarketingSection(makeContext(db))
      expect(result.signals).toEqual([])
      expect(result.headline).toBe('Halloween party (early figures): 90 delivered so far.')
      expect(result.lists[0].title).toBe('Halloween party (customer email, first sent Thu 24 Sep, early figures)')
      expect(result.lists[0].items[0].text).toBe('Delivered 90 of 100 sent so far.')
      expect(result.notes).toEqual(['Early figures for 1 campaign: still sending or first sent in the last 24 hours, so no checks are run on it yet.'])
      expect(result.metrics).toContainEqual(expect.objectContaining({ label: 'Click rate, Halloween party', comparison: 'early figures' }))
    })

    it('treats a campaign still sending as early, however long ago it started', async () => {
      const db = emptyDb()
      addCampaign(db, { id: 's', status: 'sending', sent: 100, bounced: 10, pending: 50, startedAt: '2026-09-21T10:00:00.000Z' })
      const result = await buildMarketingSection(makeContext(db))
      expect(result.signals).toEqual([])
      expect(result.lists[0].title).toContain('early figures')
    })

    it('treats a paused campaign as early only inside the first 24 hours', async () => {
      const db = emptyDb()
      // Thu 24 Sep 18:00 BST, paused with sends to go: twelve hours before the report.
      addCampaign(db, { id: 'pe', name: 'Halloween party', status: 'paused', sent: 100, bounced: 10, complained: 2, pending: 50, startedAt: '2026-09-24T17:00:00.000Z' })
      const result = await buildMarketingSection(makeContext(db))
      expect(result.signals).toEqual([])
      expect(result.headline).toBe('Halloween party (early figures): 90 delivered so far.')
      expect(result.lists[0].title).toBe('Halloween party (customer email, first sent Thu 24 Sep, early figures)')
    })
  })

  describe('paused part way', () => {
    it('still checks bounces on a campaign paused days ago, with the red action', async () => {
      const db = emptyDb()
      addScheduled(db, 'next-c', 'October round-up', '2026-09-30T07:00:00.000Z')
      // Mon 21 Sep 10:00 BST: 100 sent, 8 bounced, then paused with 140 still to send.
      addCampaign(db, { id: 'pz', name: 'Autumn menu', status: 'paused', sent: 100, bounced: 8, pending: 140, startedAt: '2026-09-21T09:00:00.000Z' })
      const result = await buildMarketingSection(makeContext(db))

      expect(signal(result, 'marketing.bounce_high.pz')).toMatchObject({
        entity: 'marketing_campaign:pz',
        rag: 'red',
        kind: 'issue',
        emailSafe: true,
        text: 'Autumn menu: bounce rate 8.0% (8 of 100 sent).',
        action: {
          text: 'Check list quality before the next customer send: Autumn menu had a bounce rate 8.0% (8 of 100 sent)',
          href: `${APP}/marketing/campaigns/pz`,
          target: 'record',
          dueDate: '2026-09-30',
          impact: 'customer',
        },
      })
      expect(sectionStatusOf(result.signals)).toBe('red')
      expect(result.headline).toBe('Autumn menu (paused part way): 92 delivered so far.')
      expect(JSON.stringify(result)).not.toContain('early figures')

      const [list] = result.lists
      expect(list.title).toBe('Autumn menu (customer email, first sent Mon 21 Sep, paused part way)')
      const texts = list.items.map((item) => item.text)
      expect(texts[0]).toBe('Delivered 92 of 100 sent so far.')
      expect(texts).toContain('Paused part way, so only the bounce and complaint checks are run, and it is kept out of averages and best-campaign claims.')
      expect(texts.some((text) => text.startsWith('Reached fewer than'))).toBe(false)
      // Partial click figures are shown without averages; the bounce rate is compared.
      expect(texts.find((text) => text.startsWith('Click rate'))).toBe('Click rate 0.0% (0 people clicked).')
      expect(texts.find((text) => text.startsWith('Bounce rate'))).toContain('Customer average:')
      expect(list.items.find((item) => item.text.startsWith('Bounce rate'))?.rag).toBe('red')

      expect(result.metrics).toContainEqual(expect.objectContaining({ label: 'Click rate, Autumn menu', comparison: 'paused part way' }))
      expect(result.notes).toEqual(['1 campaign paused part way: only the bounce and complaint checks are run on it, and it is kept out of averages and best-campaign claims.'])
      assertPrintable(result)
    })

    it('still raises amber for bounces of 2% or more and for complaints on a paused campaign', async () => {
      const db = emptyDb()
      addCampaign(db, { id: 'pa', name: 'Quiz night', status: 'paused', sent: 200, bounced: 5, complained: 1, pending: 40, startedAt: '2026-09-21T09:00:00.000Z' })
      const result = await buildMarketingSection(makeContext(db))
      expect(keys(result)).toEqual(['marketing.bounce_or_complaint.pa'])
      expect(signal(result, 'marketing.bounce_or_complaint.pa')).toMatchObject({
        rag: 'amber',
        emailSafe: true,
        text: 'Quiz night: bounce rate 2.5% (5 of 200 sent) and 1 spam complaint.',
      })
    })

    it('runs no click, unsubscribe or best-campaign check on partial figures', async () => {
      const build = async (status: string, pending: number): Promise<SectionBuildResult> => {
        const db = emptyDb()
        addHistory(db, 'h', { clickers: 12, unsubscribes: 1 })
        // Far fewer clicks and far more unsubscribes than usual.
        addCampaign(db, { id: 'low', status, pending, startedAt: '2026-12-01T11:00:00.000Z', clickers: 1, unsubscribes: 10 })
        // The best click rate in 13 weeks.
        addCampaign(db, { id: 'high', status, pending, startedAt: '2026-12-01T12:00:00.000Z', clickers: 40 })
        return buildMarketingSection(makeContext(db, LATE))
      }
      // The same figures on finished campaigns fire all three, so the paused case is not vacuous.
      expect(keys(await build('completed', 0))).toEqual([
        'marketing.unsubscribes_high.low',
        'marketing.clicks_low.low',
        'marketing.best_clicks.high',
      ])
      const paused = await build('paused', 30)
      expect(paused.signals).toEqual([])
      expect(paused.headline).toBe('2 campaigns this week (paused part way), 480 delivered.')
      expect(paused.notes).toEqual(['2 campaigns paused part way: only the bounce and complaint checks are run on them, and they are kept out of averages and best-campaign claims.'])
    })

    it('names the paused campaign in a mixed week headline', async () => {
      const db = emptyDb()
      addCampaign(db, { id: 'done', startedAt: '2026-09-21T09:00:00.000Z' })
      addCampaign(db, { id: 'held', status: 'paused', sent: 100, pending: 20, startedAt: '2026-09-22T09:00:00.000Z' })
      addCampaign(db, { id: 'new', startedAt: '2026-09-24T17:00:00.000Z' })
      const result = await buildMarketingSection(makeContext(db))
      expect(result.headline).toBe('3 campaigns this week (1 with early figures, 1 paused part way), 580 delivered.')
    })
  })

  describe('checks against the 13-week average', () => {
    it('does not run them before there are 13 weeks of history, and says when they start', async () => {
      const db = emptyDb()
      addCampaign(db, { id: 'h1', startedAt: '2026-08-28T10:00:00.000Z', clickers: 12, unsubscribes: 1 })
      addCampaign(db, { id: 'h2', startedAt: '2026-09-04T10:00:00.000Z', clickers: 12, unsubscribes: 1 })
      addCampaign(db, { id: 'h3', startedAt: '2026-09-11T10:00:00.000Z', clickers: 12, unsubscribes: 1 })
      // Far more unsubscribes and far fewer clicks than usual: would fire with enough history.
      addCampaign(db, { id: 'h4', startedAt: '2026-09-22T10:00:00.000Z', clickers: 1, unsubscribes: 10 })
      const result = await buildMarketingSection(makeContext(db))
      expect(result.signals).toEqual([])
      expect(result.notes).toContain('Marketing emails began on 16 Aug 2026, so there is not enough history yet for the 13-week comparison. The unsubscribe, click-rate and best-campaign checks start on 22 Nov 2026.')
    })

    it('flags unsubscribes at twice the usual rate with at least 3, with a record action', async () => {
      const db = emptyDb()
      addScheduled(db, 'next', 'December round-up', '2026-12-09T09:00:00.000Z')
      addHistory(db, 'u', { unsubscribes: 2 })
      addCampaign(db, { id: 'u4', name: 'Black Friday', startedAt: '2026-12-01T11:00:00.000Z', unsubscribes: 6 })
      const result = await buildMarketingSection(makeContext(db, LATE))
      expect(signal(result, 'marketing.unsubscribes_high.u4')).toMatchObject({
        entity: 'marketing_campaign:u4',
        rag: 'amber',
        kind: 'issue',
        emailSafe: true,
        text: 'Black Friday: 6 unsubscribes, 2.5% of delivered against 0.8% usually for customer emails over 13 weeks.',
        action: {
          text: 'Review frequency and content: Black Friday lost 6 subscribers, at least twice the usual rate',
          href: `${APP}/marketing/campaigns/u4`,
          target: 'record',
          dueDate: '2026-12-09',
          impact: 'customer',
        },
      })
      expect(result.notes).toEqual([])
    })

    it('needs at least 3 unsubscribes before it calls the rate high', async () => {
      const db = emptyDb()
      addHistory(db, 'u', { unsubscribes: 0 })
      addCampaign(db, { id: 'u4', startedAt: '2026-12-01T11:00:00.000Z', unsubscribes: 2 })
      const result = await buildMarketingSection(makeContext(db, LATE))
      expect(keys(result)).not.toContain('marketing.unsubscribes_high.u4')
    })

    it('flags a click rate 30% or more below the 13-week average when the gap is real', async () => {
      const db = emptyDb()
      addHistory(db, 'k', { clickers: 12 })
      addCampaign(db, { id: 'k4', name: 'Advent menu', startedAt: '2026-12-01T11:00:00.000Z', clickers: 4 })
      const result = await buildMarketingSection(makeContext(db, LATE))
      expect(signal(result, 'marketing.clicks_low.k4')).toMatchObject({
        rag: 'amber',
        kind: 'issue',
        emailSafe: true,
        text: 'Advent menu: click rate 1.7% against a 13-week customer average of 5.0%.',
      })
      expect(signal(result, 'marketing.clicks_low.k4').action).toBeUndefined()
    })

    it('does not call 2 clickers against 4 a drop', async () => {
      const db = emptyDb()
      addHistory(db, 'k', { clickers: 4 })
      addCampaign(db, { id: 'k4', startedAt: '2026-12-01T11:00:00.000Z', clickers: 2 })
      const result = await buildMarketingSection(makeContext(db, LATE))
      expect(keys(result)).not.toContain('marketing.clicks_low.k4')
    })

    it('celebrates the best click rate of any same-audience email in 13 weeks', async () => {
      const db = emptyDb()
      addHistory(db, 'w', [{ clickers: 4 }, { clickers: 5 }, { clickers: 6 }])
      // A business email with far more clicks is a different audience and does not compete.
      addCampaign(db, { id: 'biz', audience: 'business', sent: 150, startedAt: '2026-11-10T08:30:00.000Z', clickers: 60 })
      addCampaign(db, { id: 'w4', name: 'Christmas menu launch', startedAt: '2026-12-01T11:00:00.000Z', clickers: 10 })
      const result = await buildMarketingSection(makeContext(db, LATE))
      expect(signal(result, 'marketing.best_clicks.w4')).toMatchObject({
        rag: 'green',
        kind: 'win',
        emailSafe: true,
        text: 'Christmas menu launch had the best click rate of any customer email in 13 weeks: 4.2%.',
      })
      expect(signal(result, 'marketing.best_clicks.w4').action).toBeUndefined()
      expect(sectionStatusOf(result.signals)).toBe('green')
    })

    it('makes no best-campaign claim with fewer than 3 in the baseline, on a tie, or for a small send', async () => {
      const twoOnly = emptyDb()
      addCampaign(twoOnly, { id: 'w1', startedAt: '2026-10-02T11:00:00.000Z', clickers: 4 })
      addCampaign(twoOnly, { id: 'w2', startedAt: '2026-10-16T11:00:00.000Z', clickers: 5 })
      addCampaign(twoOnly, { id: 'w4', startedAt: '2026-12-01T11:00:00.000Z', clickers: 10 })
      expect(keys(await buildMarketingSection(makeContext(twoOnly, LATE)))).not.toContain('marketing.best_clicks.w4')

      const tie = emptyDb()
      addHistory(tie, 'w', { clickers: 6 })
      addCampaign(tie, { id: 'w4', startedAt: '2026-12-01T11:00:00.000Z', clickers: 6 })
      expect(keys(await buildMarketingSection(makeContext(tie, LATE)))).not.toContain('marketing.best_clicks.w4')

      const small = emptyDb()
      addHistory(small, 'w', { clickers: 2 })
      addCampaign(small, { id: 'w4', sent: 20, startedAt: '2026-12-01T11:00:00.000Z', clickers: 5 })
      expect(keys(await buildMarketingSection(makeContext(small, LATE)))).not.toContain('marketing.best_clicks.w4')
    })

    it('keeps small and still-sending campaigns out of the averages', async () => {
      const db = emptyDb()
      addHistory(db, 'a', { clickers: 12 })
      // Each would drag the average down if it were counted.
      addCampaign(db, { id: 'tiny', sent: 10, startedAt: '2026-11-20T11:00:00.000Z', clickers: 0 })
      addCampaign(db, { id: 'stuck', status: 'paused', sent: 200, pending: 40, startedAt: '2026-11-13T11:00:00.000Z', clickers: 0 })
      addCampaign(db, { id: 'now', startedAt: '2026-12-01T11:00:00.000Z', clickers: 12 })
      const result = await buildMarketingSection(makeContext(db, LATE))
      const item = result.lists[0].items.find((entry) => entry.text.startsWith('Click rate'))
      expect(item?.text).toBe('Click rate 5.0% (12 people clicked). Customer average: 2 weeks none to compare, 4 weeks 5.0%, 13 weeks 5.0%.')
    })
  })

  describe('late sends from last week', () => {
    /** Fri 2 Oct 2026 06:00 London (BST): this week 25 Sep to 1 Oct, last week 18 to 24 Sep. */
    const NEXT_FRIDAY = new Date('2026-10-02T05:00:00.000Z')
    const LATE_TEXT = 'Thursday send (sent Thu 24 Sep, too new to check last week)'

    function thursdaySend(db: FakeDb, startedAt = '2026-09-24T09:00:00.000Z'): void {
      // Thu 24 Sep 10:00 BST: 20 hours before that Friday's 06:00 report.
      addCampaign(db, { id: 'thu', name: 'Thursday send', sent: 240, bounced: 20, complained: 2, startedAt })
    }

    it('checks a Thursday send the next Friday, after it was too new to check at the first', async () => {
      const db = emptyDb()
      thursdaySend(db)

      const first = await buildMarketingSection(makeContext(db))
      expect(first.signals).toEqual([])
      expect(first.headline).toBe('Thursday send (early figures): 220 delivered so far.')

      const result = await buildMarketingSection(makeContext(db, NEXT_FRIDAY))
      expect(keys(result)).toEqual(['marketing.bounce_high.thu', 'marketing.bounce_or_complaint.thu'])
      expect(signal(result, 'marketing.bounce_high.thu')).toMatchObject({
        rag: 'red',
        kind: 'issue',
        emailSafe: true,
        text: `${LATE_TEXT}: bounce rate 8.3% (20 of 240 sent).`,
        action: {
          text: 'Check list quality before the next customer send: Thursday send (sent Thu 24 Sep) had a bounce rate 8.3% (20 of 240 sent)',
          href: `${APP}/marketing/campaigns/thu`,
          target: 'record',
          impact: 'customer',
        },
      })
      expect(signal(result, 'marketing.bounce_or_complaint.thu').text).toBe(`${LATE_TEXT}: 2 spam complaints.`)
      expect(sectionStatusOf(result.signals)).toBe('red')
      expect(result.headline).toBe('No campaigns this week and none scheduled. Also checked: Thursday send, first sent Thu 24 Sep, too new to check last week.')
      // Not one of this week's campaigns: this week's figures stay at none.
      expect(result.metrics[0]).toEqual({ label: 'Campaigns this week', value: '0' })
      expect(result.lists.map((list) => list.title)).toEqual(['Thursday send (customer email, first sent Thu 24 Sep, too new to check last week)'])
      expect(result.notes[0]).toBe('Thursday send was first sent on Thu 24 Sep, less than 24 hours before last week\'s report, so it is checked in this one. It is not counted in this week\'s figures.')
      assertPrintable(result)

      // A retried build later that Friday still checks it.
      const retried = await buildMarketingSection(makeContext(db, new Date('2026-10-02T07:00:00.000Z')))
      expect(keys(retried)).toContain('marketing.bounce_high.thu')
    })

    it('leaves a Thursday send before 06:00 to the Friday report that already checked it', async () => {
      const db = emptyDb()
      // Thu 24 Sep 05:30 BST: 24.5 hours old at that Friday's report, so checked there.
      thursdaySend(db, '2026-09-24T04:30:00.000Z')
      expect(keys(await buildMarketingSection(makeContext(db)))).toContain('marketing.bounce_high.thu')

      const result = await buildMarketingSection(makeContext(db, NEXT_FRIDAY))
      expect(result.signals).toEqual([])
      expect(result.headline).toBe('No campaigns this week and none scheduled.')
    })

    it('keeps this week\'s figures to this week and judges the late send against its own baseline', async () => {
      const db = emptyDb()
      thursdaySend(db)
      addCampaign(db, { id: 'tue', name: 'Tuesday send', sent: 100, clickers: 4, startedAt: '2026-09-29T10:00:00.000Z' })
      const result = await buildMarketingSection(makeContext(db, NEXT_FRIDAY))
      expect(result.headline).toBe('Tuesday send: 100 delivered, click rate 4.0% (4-week customer average 0.0%). Also checked: Thursday send, first sent Thu 24 Sep, too new to check last week.')
      expect(result.metrics.slice(0, 2)).toEqual([
        { label: 'Campaigns this week', value: '1', comparison: '1 customer' },
        { label: 'Delivered', value: '100', comparison: 'of 100 sent' },
      ])
      expect(result.lists.map((list) => list.title)).toEqual([
        'Tuesday send (customer email, first sent Tue 29 Sep)',
        'Thursday send (customer email, first sent Thu 24 Sep, too new to check last week)',
      ])
      // The late send is never its own baseline: nothing else was sent before it.
      expect(result.lists[1].items.find((item) => item.text.startsWith('Click rate'))?.text)
        .toBe('Click rate 0.0% (0 people clicked). Customer average: 2 weeks none to compare, 4 weeks none to compare, 13 weeks not enough history yet.')
    })

    it('counts several late sends in the headline and note', async () => {
      const db = emptyDb()
      thursdaySend(db)
      addCampaign(db, { id: 'thu-2', name: 'Evening send', sent: 240, startedAt: '2026-09-24T19:00:00.000Z' })
      const result = await buildMarketingSection(makeContext(db, NEXT_FRIDAY))
      expect(result.headline).toBe('No campaigns this week and none scheduled. Also checked: 2 campaigns first sent late last week, too new to check then.')
      expect(result.notes[0]).toBe('2 campaigns were first sent less than 24 hours before last week\'s report, so they are checked in this one. They are not counted in this week\'s figures.')
      expect(result.lists).toHaveLength(2)
      assertPrintable(result)
    })

    it('finds last week\'s report on the London clock across the October clock change', async () => {
      const db = emptyDb()
      // Thu 22 Oct 06:30 BST, 23.5 hours before the Fri 23 Oct 06:00 BST report.
      addCampaign(db, { id: 'thu', name: 'Thursday send', sent: 240, bounced: 20, startedAt: '2026-10-22T05:30:00.000Z' })
      expect((await buildMarketingSection(makeContext(db, new Date('2026-10-23T05:00:00.000Z')))).signals).toEqual([])
      // Fri 30 Oct 06:00 GMT: a week of elapsed time back would be 07:00 BST and miss it.
      const result = await buildMarketingSection(makeContext(db, new Date('2026-10-30T06:00:00.000Z')))
      expect(keys(result)).toEqual(['marketing.bounce_high.thu'])
    })
  })

  it('keeps one primary action per campaign when several rules fire', async () => {
    const db = emptyDb()
    addHistory(db, 'd', { unsubscribes: 1 })
    addCampaign(db, { id: 'd4', sent: 240, bounced: 15, startedAt: '2026-12-01T11:00:00.000Z', unsubscribes: 9 })
    const result = await buildMarketingSection(makeContext(db, LATE))
    expect(keys(result)).toEqual(['marketing.bounce_high.d4', 'marketing.unsubscribes_high.d4'])
    const deduped = dedupeByEntity(result.signals)
    expect(deduped.filter((item) => item.action).map((item) => item.key)).toEqual(['marketing.bounce_high.d4'])
    expect(deduped).toHaveLength(2)
  })

  it('never lets a recipient or unsubscriber detail reach the report', async () => {
    const db = emptyDb()
    addCampaign(db, { id: 'p', sent: 120, bounced: 8, complained: 1, clickers: 3, unsubscribes: 4, startedAt: '2026-09-21T10:00:00.000Z' })
    const result = await buildMarketingSection(makeContext(db))
    const text = JSON.stringify(result)
    for (const personal of ['alice', 'Alice', 'Bob', 'Private', '@example.test']) expect(text).not.toContain(personal)
    expect(result.signals.length).toBeGreaterThan(0)
    expect(result.signals.every((item) => item.emailSafe)).toBe(true)
    assertPrintable(result)
  })

  it('fails loudly on a read error rather than reporting zeros', async () => {
    const db = emptyDb()
    addCampaign(db, { id: 'f', startedAt: '2026-09-21T10:00:00.000Z' })
    db.fail('email_messages')
    await expect(buildMarketingSection(makeContext(db))).rejects.toThrow()
  })
})
