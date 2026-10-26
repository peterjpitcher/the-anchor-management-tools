import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ConsentService.applyBookingContactConsent records what a booking told us about contact. It must
 * never switch marketing back on for someone who opted out (BK-077, owner decision D31):
 * record_customer_consent clears marketing_*_opted_out_at on any marketing opt-in, so a ticked box
 * on a later booking, or someone typing a regular's number, used to undo an unsubscribe.
 */

const rpc = vi.fn()
let customerRow: Record<string, unknown> | null = null

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    rpc,
    from: () => {
      const builder: Record<string, unknown> = {}
      builder.select = () => builder
      builder.eq = () => builder
      builder.maybeSingle = async () => ({ data: customerRow, error: null })
      return builder
    },
  }),
}))

import { ConsentService } from '@/services/consent'

type RecordedRow = { channel: string; purpose: string; status: string; legal_basis: string; capture_method: string; consent_text: string | null; update_summary: boolean; related_entity_id: string | null }

function recordedRows(): RecordedRow[] {
  return rpc.mock.calls
    .filter(([name]) => name === 'record_customer_consent')
    .map(([, args]) => ({
      channel: args.p_channel,
      purpose: args.p_purpose,
      status: args.p_status,
      legal_basis: args.p_legal_basis,
      capture_method: args.p_capture_method,
      consent_text: args.p_consent_text,
      update_summary: args.p_update_summary,
      related_entity_id: args.p_related_entity_id,
    }))
}

const everyTick = {
  service_contact_notice_shown: true,
  marketing_email_opt_in: true,
  marketing_sms_opt_in: true,
  whatsapp_opt_in: false,
  marketing_whatsapp_opt_in: true,
  consent_text_version: 'guest-comms-consent-v6',
}

const publicTable = {
  source: 'public_table_booking' as const,
  captureMethod: 'checkbox' as const,
  relatedEntityType: 'table_booking' as const,
  relatedEntityId: 'tb-1',
}

beforeEach(() => {
  rpc.mockReset()
  rpc.mockResolvedValue({ data: 'consent-id', error: null })
  customerRow = {
    id: 'c1',
    sms_opt_in: true,
    sms_status: 'active',
    marketing_sms_opt_in: false,
    whatsapp_opt_in: false,
    whatsapp_status: 'active',
    marketing_whatsapp_opt_in: false,
    marketing_email_opt_in: false,
    marketing_sms_opted_out_at: null,
    marketing_email_opted_out_at: null,
    marketing_whatsapp_opted_out_at: null,
  }
})

describe('applyBookingContactConsent never undoes an opt-out', () => {
  it('records the ticked marketing choices for a customer who never opted out', async () => {
    await ConsentService.applyBookingContactConsent('c1', everyTick, publicTable)
    const marketing = recordedRows().filter((row) => row.purpose === 'marketing' && row.status === 'opted_in')
    expect(marketing.map((row) => row.channel).sort()).toEqual(['email', 'sms', 'whatsapp'])
  })

  it('skips a marketing email opt-in after an unsubscribe', async () => {
    customerRow = { ...customerRow, marketing_email_opted_out_at: '2026-09-01T10:00:00Z' }
    await ConsentService.applyBookingContactConsent('c1', everyTick, publicTable)
    expect(recordedRows().some((row) => row.channel === 'email' && row.purpose === 'marketing' && row.status === 'opted_in')).toBe(false)
  })

  it('skips a marketing text opt-in after NOEVENTS, a STOP, or texts switched off', async () => {
    for (const refused of [
      { marketing_sms_opted_out_at: '2026-09-01T10:00:00Z' },
      { sms_status: 'opted_out', sms_opt_in: false },
      { sms_opt_in: false, sms_status: 'sms_deactivated' },
    ]) {
      rpc.mockClear()
      customerRow = { ...customerRow, ...refused }
      await ConsentService.applyBookingContactConsent('c1', everyTick, publicTable)
      expect(recordedRows().some((row) => row.channel === 'sms' && row.purpose === 'marketing' && row.status === 'opted_in')).toBe(false)
    }
  })

  it('skips a marketing WhatsApp opt-in after a WhatsApp opt-out', async () => {
    customerRow = { ...customerRow, marketing_whatsapp_opted_out_at: '2026-09-01T10:00:00Z' }
    await ConsentService.applyBookingContactConsent('c1', everyTick, publicTable)
    expect(recordedRows().some((row) => row.channel === 'whatsapp' && row.purpose === 'marketing' && row.status === 'opted_in')).toBe(false)
  })

  it('applies the same rule to a staff path', async () => {
    customerRow = { ...customerRow, marketing_sms_opted_out_at: '2026-09-01T10:00:00Z' }
    await ConsentService.applyStaffCapturedConsent(
      'c1',
      { service_contact_notice_shown: true, marketing_sms_opt_in: true },
      'staff-user',
      { source: 'staff_table_booking', captureMethod: 'staff_verbal', relatedEntityType: 'table_booking', relatedEntityId: 'tb-1' }
    )
    expect(recordedRows().some((row) => row.channel === 'sms' && row.purpose === 'marketing' && row.status === 'opted_in')).toBe(false)
  })
})
