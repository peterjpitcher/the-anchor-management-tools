import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { logger } from '@/lib/logger'
import { markCustomerNumberUndeliverable, undeliverableNumberReason } from '../undeliverable-number'
import { argsOf, createRecordingSupabase } from '../../../../tests/mocks/recordingSupabase'

describe('undeliverableNumberReason', () => {
  it('names the Twilio refusals that will refuse every later send to the number', () => {
    expect(undeliverableNumberReason(21211)).toBe('invalid_number')
    expect(undeliverableNumberReason('21211')).toBe('invalid_number')
    expect(undeliverableNumberReason(21614)).toBe('invalid_number')
    expect(undeliverableNumberReason('21612')).toBe('unreachable_number')
  })

  it('leaves every other failure alone, including an opt-out refusal and delivery failures', () => {
    for (const code of [21610, '21610', '30005', '30008', 20429, 'failed', null, undefined]) {
      expect(undeliverableNumberReason(code)).toBeNull()
    }
  })
})

describe('markCustomerNumberUndeliverable', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('stops texting an invalid number the way the delivery webhook does, with the reason recorded', async () => {
    const db = createRecordingSupabase({ tables: { customers: () => ({ data: null, error: null }) } })

    await markCustomerNumberUndeliverable(db.client as never, 'customer-1', 21211)

    const update = db.queries.find((query) => query.table === 'customers')!
    expect(argsOf(update, 'update')[0]?.[0]).toEqual({
      sms_status: 'sms_deactivated',
      sms_opt_in: false,
      sms_deactivated_at: expect.any(String),
      sms_deactivation_reason: 'invalid_number',
      last_sms_failure_reason: 'Invalid phone number format',
    })
    expect(argsOf(update, 'eq')).toContainEqual(['id', 'customer-1'])
    expect(warnSpy).toHaveBeenCalledWith('Stopped texting a number Twilio refused', expect.stringContaining('customer-1'))
  })

  it('records a number that cannot receive texts as unreachable', async () => {
    const db = createRecordingSupabase({ tables: { customers: () => ({ data: null, error: null }) } })

    await markCustomerNumberUndeliverable(db.client as never, 'customer-2', '21612')

    const update = db.queries.find((query) => query.table === 'customers')!
    expect(argsOf(update, 'update')[0]?.[0]).toEqual(
      expect.objectContaining({ sms_status: 'sms_deactivated', sms_opt_in: false, sms_deactivation_reason: 'unreachable_number' })
    )
  })

  it('touches nothing for a refusal that is not about the number', async () => {
    const db = createRecordingSupabase()

    await markCustomerNumberUndeliverable(db.client as never, 'customer-1', 21610)
    await markCustomerNumberUndeliverable(db.client as never, 'customer-1', 30005)

    expect(db.queries).toHaveLength(0)
  })

  it('never throws when the update fails, and logs the failure field by field', async () => {
    const db = createRecordingSupabase({
      tables: { customers: () => ({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }) },
    })

    await expect(markCustomerNumberUndeliverable(db.client as never, 'customer-1', '21612')).resolves.toBeUndefined()

    expect(logger.error).toHaveBeenCalledWith(
      'Failed to stop texting a number Twilio refused',
      expect.objectContaining({ metadata: expect.objectContaining({ customerId: 'customer-1', code: '57014' }) })
    )
    expect(warnSpy).not.toHaveBeenCalled()
  })
})
