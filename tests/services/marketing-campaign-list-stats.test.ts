import { describe, expect, it, vi } from 'vitest'

import { getCampaignListStats, getCampaignStats } from '@/services/marketing-campaigns'
import { MARKETING_CAMPAIGN_LIST_COLUMNS, mapMarketingCampaignListItem } from '@/types/marketing'
import { FakeDb } from '../lib/insights/helpers/fake-db'

// Both paths create their own admin client; point them at the same in-memory fixture.
const adminDb = vi.hoisted(() => ({ current: null as unknown }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => adminDb.current }))

type Row = Record<string, unknown>

const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const C = '00000000-0000-4000-8000-00000000000c'
const DRAFT = '00000000-0000-4000-8000-00000000000d'
const UNKNOWN = '00000000-0000-4000-8000-0000000000ff'

function iso(value: string, addMinutes = 0): string {
  return new Date(Date.parse(value) + addMinutes * 60_000).toISOString()
}

interface Spec {
  id: string
  audience: 'customer' | 'business'
  scheduledFor: string | null
  sent: number
  bounced?: number
  opened?: number
  skipped?: number
  failed?: number
  clickers?: number
  unsubscribes?: number
}

/**
 * Several campaigns in one fixture, so the batch path has a chance to bleed one campaign's
 * messages, clicks or unsubscribes into another's figures.
 */
function buildDb(): FakeDb {
  const tables: Record<string, Row[]> = {
    marketing_campaigns: [],
    marketing_campaign_recipients: [],
    email_messages: [],
    customers: [],
    business_contacts: [],
    short_links: [],
    short_link_clicks: [],
    analytics_events: [],
    marketing_conversions: [],
  }

  const add = (spec: Spec): void => {
    tables.marketing_campaigns.push({
      id: spec.id,
      name: `Campaign ${spec.id.slice(-1)}`,
      subject: 'Subject',
      preheader: 'Preheader',
      status: spec.sent > 0 ? 'completed' : 'draft',
      kind: 'one_off',
      audience_type: spec.audience,
      audience: { include_tags: [], exclude_tags: [] },
      link_map: {},
      utm_campaign: null,
      scheduled_for: spec.scheduledFor,
      created_at: '2026-09-01T09:00:00.000Z',
      updated_at: '2026-09-01T09:00:00.000Z',
    })
    const at = iso(spec.scheduledFor ?? '2026-09-01T09:00:00.000Z', 5)
    const bounced = spec.bounced ?? 0
    for (let i = 0; i < spec.sent; i += 1) {
      const isBounced = i >= spec.sent - bounced
      tables.marketing_campaign_recipients.push({ id: `${spec.id}-r${i}`, campaign_id: spec.id, status: 'sent', skip_reason: null, email_message_id: `${spec.id}-m${i}` })
      tables.email_messages.push({
        id: `${spec.id}-m${i}`,
        marketing_campaign_id: spec.id,
        delivered_at: isBounced ? null : at,
        opened_at: !isBounced && i < (spec.opened ?? 0) ? at : null,
        clicked_at: null,
        bounced_at: isBounced ? at : null,
        complained_at: null,
        failed_at: null,
      })
    }
    for (let i = 0; i < (spec.skipped ?? 0); i += 1) {
      tables.marketing_campaign_recipients.push({ id: `${spec.id}-s${i}`, campaign_id: spec.id, status: 'skipped', skip_reason: i % 2 ? 'frequency_cap' : 'suppressed', email_message_id: null })
    }
    for (let i = 0; i < (spec.failed ?? 0); i += 1) {
      tables.marketing_campaign_recipients.push({ id: `${spec.id}-f${i}`, campaign_id: spec.id, status: 'failed', skip_reason: null, email_message_id: null })
    }
    tables.short_links.push({
      id: `${spec.id}-link`,
      short_code: `sc-${spec.id.slice(-1)}`,
      destination_url: 'https://www.the-anchor.pub/whats-on',
      metadata: { channel: 'marketing_email', campaign_id: spec.id },
      // The fake resolves a PostgREST JSON path such as metadata->>campaign_id as a plain key.
      'metadata->>campaign_id': spec.id,
    })
    for (let i = 0; i < (spec.clickers ?? 0); i += 1) {
      tables.short_link_clicks.push({ id: `${spec.id}-k${i}`, short_link_id: `${spec.id}-link`, utm_content: `${spec.id}-r${i}`, clicked_at: iso(at, 60), device_type: 'desktop' })
    }
    for (let i = 0; i < (spec.unsubscribes ?? 0); i += 1) {
      if (spec.audience === 'customer') tables.customers.push({ id: `${spec.id}-u${i}`, marketing_unsubscribe_campaign_id: spec.id })
      else tables.business_contacts.push({ id: `${spec.id}-u${i}`, unsubscribe_campaign_id: spec.id })
    }
  }

  add({ id: A, audience: 'customer', scheduledFor: '2026-10-01T09:00:00.000Z', sent: 120, bounced: 3, opened: 50, skipped: 5, failed: 2, clickers: 9, unsubscribes: 2 })
  add({ id: B, audience: 'business', scheduledFor: '2026-10-08T09:00:00.000Z', sent: 60, bounced: 1, opened: 0, skipped: 1, clickers: 4, unsubscribes: 3 })
  add({ id: C, audience: 'customer', scheduledFor: null, sent: 15, opened: 7, clickers: 2, unsubscribes: 1 })
  add({ id: DRAFT, audience: 'business', scheduledFor: null, sent: 0 })

  tables.short_link_clicks.push(
    // A bot on A, a click on B's link before B was sent (a test), and a recipient of A
    // clicking B's link: none may count as a clicker anywhere.
    { id: 'x-bot', short_link_id: `${A}-link`, utm_content: `${A}-r20`, clicked_at: '2026-10-01T12:00:00.000Z', device_type: 'bot' },
    { id: 'x-early', short_link_id: `${B}-link`, utm_content: `${B}-r10`, clicked_at: '2026-10-08T08:00:00.000Z', device_type: 'desktop' },
    { id: 'x-cross', short_link_id: `${B}-link`, utm_content: `${A}-r30`, clicked_at: '2026-10-08T12:00:00.000Z', device_type: 'desktop' },
  )
  // A message of A that lost its campaign tag is still counted for A, read by id.
  tables.marketing_campaign_recipients.push({ id: `${A}-r999`, campaign_id: A, status: 'sent', skip_reason: null, email_message_id: `${A}-untagged` })
  tables.email_messages.push({ id: `${A}-untagged`, marketing_campaign_id: null, delivered_at: '2026-10-01T09:05:00.000Z', opened_at: '2026-10-01T09:06:00.000Z', clicked_at: null, bounced_at: null, complained_at: null, failed_at: null })
  // A failed retry tagged with B that no recipient points at: never counted.
  tables.email_messages.push({ id: `${B}-retry`, marketing_campaign_id: B, delivered_at: '2026-10-08T09:05:00.000Z', opened_at: null, clicked_at: null, bounced_at: null, complained_at: null, failed_at: null })

  return new FakeDb(tables)
}

describe('getCampaignListStats', () => {
  it('gives every campaign exactly the figures the per-campaign path gives, minus conversions', async () => {
    const db = buildDb()
    adminDb.current = db.asDb()

    const batch = await getCampaignListStats([A, B, C, DRAFT, UNKNOWN, A])

    expect(Object.keys(batch).sort()).toEqual([A, B, C, DRAFT].sort())
    for (const id of [A, B, C, DRAFT]) {
      const single = await getCampaignStats(id)
      const { conversions: _conversions, conversionValue: _conversionValue, ...engagement } = single.engagement
      expect(batch[id]).toEqual({ ...single, engagement })
    }

    // Spot-check that the fixture exercises what it is meant to.
    expect(batch[A]).toMatchObject({ sent: 121, delivered: 118, opened: 51, clicked: 9, unsubscribed: 2, failed: 2, skipped: 5 })
    expect(batch[B]).toMatchObject({ sent: 60, delivered: 59, clicked: 4, unsubscribed: 3 })
    expect(batch[C]).toMatchObject({ sent: 15, clicked: 2, unsubscribed: 1 })
    expect(batch[DRAFT]).toMatchObject({ recipients: 0, sent: 0, rates: { deliveredRate: 0 } })
  })

  it('reads the campaigns once and never reads conversions', async () => {
    const db = buildDb()
    adminDb.current = db.asDb()

    await getCampaignListStats([A, B, C])

    expect(db.calls.filter((call) => call.table === 'marketing_campaigns')).toHaveLength(1)
    expect(db.calls.some((call) => call.table === 'analytics_events' || call.table === 'marketing_conversions')).toBe(false)
  })

  it('returns nothing and reads nothing for an empty list', async () => {
    const db = buildDb()
    adminDb.current = db.asDb()

    expect(await getCampaignListStats([])).toEqual({})
    expect(db.calls).toHaveLength(0)
  })

  it('throws when the campaign read fails, so the action reports it', async () => {
    const db = buildDb().fail('marketing_campaigns', 'Campaign read unavailable')
    adminDb.current = db.asDb()

    await expect(getCampaignListStats([A])).rejects.toThrow('Campaign read unavailable')
  })
})

describe('mapMarketingCampaignListItem', () => {
  it('maps a row holding only the list columns', () => {
    const columns = MARKETING_CAMPAIGN_LIST_COLUMNS.split(',').map((column) => column.trim())
    const row = {
      id: A, name: 'October news', subject: 'Hello', status: 'completed', kind: 'lifecycle',
      audience_type: 'customer', scheduled_for: null, created_at: '2026-09-01T09:00:00.000Z',
    }
    expect(Object.keys(row).sort()).toEqual([...columns].sort())

    const summary = { recipients: 3, pending: 0, sending: 0, sent: 2, failed: 0, skipped: 1, needsReview: 0 }
    expect(mapMarketingCampaignListItem(row, summary)).toEqual({
      id: A, name: 'October news', subject: 'Hello', status: 'completed', kind: 'lifecycle',
      audienceType: 'customer', scheduledFor: null, createdAt: '2026-09-01T09:00:00.000Z', summary,
    })
    expect(mapMarketingCampaignListItem({ ...row, kind: null, audience_type: 'other' }, summary)).toMatchObject({ kind: 'one_off', audienceType: 'business' })
  })
})
