import { describe, expect, it } from 'vitest'
import {
  buildTwilioLogBackfillPlaceholderCustomerInsert,
  isTwilioLogBackfillCustomerCreationEnabled,
  isTwilioLogBackfillMutationEnabled,
  parseTwilioLogBackfillArgs,
  requireScriptLimit,
} from '@/lib/twilio-log-backfill-script-safety'

describe('twilio log backfill script safety', () => {
  it('defaults to dry-run with no mutation flags', () => {
    const args = parseTwilioLogBackfillArgs(['node', 'script', './twilio.csv'])
    expect(args).toEqual({
      filePath: './twilio.csv',
      confirm: false,
      dryRun: true,
      limit: null,
      allowCreateCustomers: false,
      createCustomersLimit: null,
    })
  })

  it('enables mutation only with --confirm and RUN_TWILIO_LOG_BACKFILL_MUTATION', () => {
    expect(
      isTwilioLogBackfillMutationEnabled(['node', 'script', 'file.csv'], {
        RUN_TWILIO_LOG_BACKFILL_MUTATION: 'true',
      } as any)
    ).toBe(false)

    expect(
      isTwilioLogBackfillMutationEnabled(['node', 'script', 'file.csv', '--confirm'], {} as any)
    ).toBe(false)

    expect(
      isTwilioLogBackfillMutationEnabled(
        ['node', 'script', 'file.csv', '--confirm', '--dry-run'],
        {
          RUN_TWILIO_LOG_BACKFILL_MUTATION: 'true',
        } as any
      )
    ).toBe(false)

    expect(
      isTwilioLogBackfillMutationEnabled(['node', 'script', 'file.csv', '--confirm'], {
        RUN_TWILIO_LOG_BACKFILL_MUTATION: 'true',
      } as any)
    ).toBe(true)
  })

  it('enables customer creation only with explicit flag and customer-create gate', () => {
    expect(
      isTwilioLogBackfillCustomerCreationEnabled(
        ['node', 'script', 'file.csv', '--confirm', '--allow-create-customers'],
        {
          RUN_TWILIO_LOG_BACKFILL_MUTATION: 'true',
        } as any
      )
    ).toBe(false)

    expect(
      isTwilioLogBackfillCustomerCreationEnabled(
        ['node', 'script', 'file.csv', '--confirm', '--allow-create-customers'],
        {
          RUN_TWILIO_LOG_BACKFILL_MUTATION: 'true',
          RUN_TWILIO_LOG_BACKFILL_CREATE_CUSTOMERS: 'true',
        } as any
      )
    ).toBe(true)
  })

  it('requires explicit capped limits in mutation modes', () => {
    expect(() =>
      requireScriptLimit({ label: '--limit', value: null, hardCap: 1000 })
    ).toThrow('--limit is required')

    expect(() =>
      requireScriptLimit({ label: '--limit', value: 1001, hardCap: 1000 })
    ).toThrow('--limit exceeds hard cap (max 1000)')

    expect(requireScriptLimit({ label: '--limit', value: 20, hardCap: 1000 })).toBe(20)
  })

  it('builds placeholder customers as SMS-deactivated and opted out', () => {
    const payload = buildTwilioLogBackfillPlaceholderCustomerInsert({
      phoneE164: '+447700900123',
      fallbackName: 'Alex Smith',
      now: new Date('2026-02-15T00:00:00.000Z'),
    })

    expect(payload).toEqual({
      first_name: 'Alex',
      last_name: 'Smith',
      mobile_number: '+447700900123',
      mobile_e164: '+447700900123',
      mobile_number_raw: '+447700900123',
      sms_opt_in: false,
      marketing_sms_opt_in: false,
      sms_status: 'sms_deactivated',
      sms_deactivated_at: '2026-02-15T00:00:00.000Z',
      sms_deactivation_reason: 'twilio_log_backfill_placeholder',
    })
  })
})

