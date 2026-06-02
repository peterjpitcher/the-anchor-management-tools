import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { backfillSmsPromoContextMessageId } from '../promo-context'

const mockCreateAdminClient = vi.mocked(createAdminClient)

function buildUpdateMock(result: { data?: unknown[] | null; error?: { message: string } | null } = {}) {
  const builder: {
    eq: ReturnType<typeof vi.fn>
    is: ReturnType<typeof vi.fn>
    select: ReturnType<typeof vi.fn>
  } = {
    eq: vi.fn(),
    is: vi.fn(),
    select: vi.fn().mockResolvedValue({
      data: result.data ?? [{ id: 'context-1' }],
      error: result.error ?? null,
    }),
  }

  builder.eq.mockReturnValue(builder)
  builder.is.mockReturnValue(builder)

  const update = vi.fn().mockReturnValue(builder)
  const from = vi.fn().mockReturnValue({ update })
  mockCreateAdminClient.mockReturnValue({ from } as never)

  return { builder, from, update }
}

describe('backfillSmsPromoContextMessageId', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('updates unlinked event promo context rows for the logged message', async () => {
    const { builder, from, update } = buildUpdateMock()

    const result = await backfillSmsPromoContextMessageId({
      customerId: 'customer-1',
      to: '+447700900123',
      messageId: 'message-1',
      metadata: {
        event_id: 'event-1',
        template_key: 'event_reminder_promo_3d',
        marketing: true,
      },
    })

    expect(result).toEqual({ skipped: false, updated: 1 })
    expect(from).toHaveBeenCalledWith('sms_promo_context')
    expect(update).toHaveBeenCalledWith({ message_id: 'message-1' })
    expect(builder.eq.mock.calls).toEqual([
      ['customer_id', 'customer-1'],
      ['event_id', 'event-1'],
      ['template_key', 'event_reminder_promo_3d'],
      ['phone_number', '+447700900123'],
    ])
    expect(builder.is).toHaveBeenCalledWith('message_id', null)
    expect(builder.select).toHaveBeenCalledWith('id')
  })

  it('skips non-marketing or non-event-promo messages', async () => {
    const result = await backfillSmsPromoContextMessageId({
      customerId: 'customer-1',
      to: '+447700900123',
      messageId: 'message-1',
      metadata: {
        event_id: 'event-1',
        template_key: 'booking_confirmation',
        marketing: true,
      },
    })

    expect(result).toEqual({ skipped: true, updated: 0 })
    expect(mockCreateAdminClient).not.toHaveBeenCalled()
  })
})
