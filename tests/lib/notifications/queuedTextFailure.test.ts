// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb, type FakeDb } from '../../helpers/fakeSupabaseDb'

const mocks = vi.hoisted(() => ({ client: null as unknown }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => mocks.client }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { markQueuedTextUndelivered } from '@/lib/notifications/deferred-text-failure'

const QUEUED_AT = '2026-11-13T21:44:41.871Z'
let db: FakeDb

function seed(deliveries: Record<string, unknown>[]): void {
  db = createFakeDb({ notification_deliveries: deliveries, notification_attempts: [] })
  mocks.client = db.client
}

const delivery = (overrides: Record<string, unknown> = {}) => ({
  id: 'd-1',
  customer_id: 'cust-1',
  template_key: 'table_booking_confirmed',
  selected_channel: 'sms',
  final_status: 'sent',
  created_at: '2026-11-13T21:44:40.720Z',
  metadata: { has_sms: true },
  ...overrides,
})

const failure = { customerId: 'cust-1', templateKey: 'table_booking_confirmed', queuedAt: QUEUED_AT, error: 'This number is not eligible to receive SMS messages' }

describe('a queued text that fails for good', () => {
  beforeEach(() => vi.clearAllMocks())

  it('marks the delivery it belonged to as undelivered, keeping what was recorded', async () => {
    seed([delivery()])

    expect(await markQueuedTextUndelivered(failure)).toBe(true)

    const row = db.rows('notification_deliveries')[0]
    expect(row.final_status).toBe('failed')
    expect(row.selected_channel).toBeNull()
    expect(row.metadata).toEqual({ has_sms: true, undelivered_reason: 'queued_text_failed' })
    expect(db.rows('notification_attempts')[0]).toMatchObject({
      delivery_id: 'd-1',
      channel: 'sms',
      status: 'failed',
      error: failure.error,
    })
  })

  it('leaves alone a delivery whose email got through, another guest, another message and an older one', async () => {
    seed([
      delivery({ id: 'emailed', selected_channel: 'email' }),
      delivery({ id: 'other-guest', customer_id: 'cust-2' }),
      delivery({ id: 'other-message', template_key: 'table_booking_confirm_reminder' }),
      delivery({ id: 'yesterday', created_at: '2026-11-12T21:44:40.000Z' }),
    ])

    expect(await markQueuedTextUndelivered(failure)).toBe(false)
    expect(db.rows('notification_deliveries').every((row) => row.final_status === 'sent')).toBe(true)
    expect(db.writes).toEqual([])
  })

  it('does nothing without a customer, a template or a queue time', async () => {
    seed([delivery()])

    expect(await markQueuedTextUndelivered({ ...failure, customerId: null })).toBe(false)
    expect(await markQueuedTextUndelivered({ ...failure, templateKey: null })).toBe(false)
    expect(await markQueuedTextUndelivered({ ...failure, queuedAt: 'not a date' })).toBe(false)
    expect(db.writes).toEqual([])
  })

  it('never throws when the lookup fails', async () => {
    seed([delivery()])
    db.failNext({ table: 'notification_deliveries', operation: 'select', message: 'connection reset' })

    expect(await markQueuedTextUndelivered(failure)).toBe(false)
  })
})
