import { beforeEach, describe, expect, it, vi } from 'vitest'

const recordOptOut = vi.hoisted(() => vi.fn())
vi.mock('@/services/consent', () => ({ ConsentService: { recordOptOut } }))
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }))

import { recordProviderSmsOptOut } from '@/lib/sms/provider-opt-out'

function db(smsStatus: string) {
  const builder: Record<string, unknown> = {}
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.maybeSingle = vi.fn(async () => ({ data: { id: 'c1', sms_status: smsStatus }, error: null }))
  return { from: vi.fn(() => builder) } as never
}

describe('recordProviderSmsOptOut (BK-080)', () => {
  beforeEach(() => recordOptOut.mockReset())

  it('records the STOP Twilio enforces when a send is refused with 21610', async () => {
    await recordProviderSmsOptOut(db('active'), 'c1', 21610)
    expect(recordOptOut).toHaveBeenCalledWith('c1', 'sms', 'direct_message', expect.objectContaining({ captureMethod: 'provider_event' }))
  })

  it('does nothing for any other refusal', async () => {
    await recordProviderSmsOptOut(db('active'), 'c1', 21211)
    expect(recordOptOut).not.toHaveBeenCalled()
  })

  it('does not record it twice', async () => {
    await recordProviderSmsOptOut(db('opted_out'), 'c1', '21610')
    expect(recordOptOut).not.toHaveBeenCalled()
  })
})
