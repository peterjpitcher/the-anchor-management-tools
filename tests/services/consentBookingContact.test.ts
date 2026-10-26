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

describe('applyBookingContactConsent stores the notice the guest saw (BK-080)', () => {
  const compactEvent = {
    service_contact_notice_shown: true,
    marketing_email_opt_in: false,
    marketing_sms_opt_in: false,
    whatsapp_opt_in: false,
    marketing_whatsapp_opt_in: false,
    consent_text_version: 'guest-comms-consent-v6',
    notice_key: 'event_compact_v6',
  }
  const publicEvent = {
    source: 'public_event_booking' as const,
    captureMethod: 'checkbox' as const,
    relatedEntityType: 'event_booking' as const,
    relatedEntityId: 'booking-1',
  }

  it('stores the compact notice wording on the service row, not the service-only wording', async () => {
    await ConsentService.applyBookingContactConsent('c1', compactEvent, publicEvent)
    const service = recordedRows().find((row) => row.purpose === 'service' && row.channel === 'sms')
    expect(service?.consent_text).toContain('send you the latest from The Anchor')
    expect(service?.consent_text).toContain('Reply NOEVENTS to stop texts')
    expect(service?.related_entity_id).toBe('booking-1')
  })

  it('records a soft opt-in for texts and email, without touching the tick-box flags', async () => {
    await ConsentService.applyBookingContactConsent('c1', compactEvent, publicEvent)
    const soft = recordedRows().filter((row) => row.legal_basis === 'soft_opt_in')
    expect(soft.map((row) => row.channel).sort()).toEqual(['email', 'sms'])
    for (const row of soft) {
      expect(row).toMatchObject({ purpose: 'marketing', status: 'opted_in', capture_method: 'service_notice', update_summary: false })
      expect(row.consent_text).toContain('send you the latest from The Anchor')
    }
  })

  it('records texts only for the quick-book notice, which takes no email', async () => {
    await ConsentService.applyBookingContactConsent('c1', { ...compactEvent, notice_key: 'table_quick_book_v1' }, publicEvent)
    expect(recordedRows().filter((row) => row.legal_basis === 'soft_opt_in').map((row) => row.channel)).toEqual(['sms'])
  })

  it('records no soft opt-in for the tick-box forms, which show the service notice only', async () => {
    await ConsentService.applyBookingContactConsent('c1', { ...compactEvent, notice_key: 'service_notice_v6' }, publicEvent)
    expect(recordedRows().some((row) => row.legal_basis === 'soft_opt_in')).toBe(false)
  })

  it('records no soft opt-in for someone who opted out', async () => {
    customerRow = { ...customerRow, marketing_sms_opted_out_at: '2026-09-01T10:00:00Z', marketing_email_opted_out_at: '2026-09-01T10:00:00Z' }
    await ConsentService.applyBookingContactConsent('c1', compactEvent, publicEvent)
    expect(recordedRows().some((row) => row.purpose === 'marketing')).toBe(false)
  })

  it('treats an unknown notice key as service-only', async () => {
    await ConsentService.applyBookingContactConsent('c1', { ...compactEvent, notice_key: 'brand_new_notice_v9' }, publicEvent)
    expect(recordedRows().some((row) => row.purpose === 'marketing')).toBe(false)
    expect(recordedRows().find((row) => row.purpose === 'service')?.consent_text).toContain('to manage this booking')
  })

  it('does not switch texts back on for a number Twilio refused as invalid or unreachable', async () => {
    for (const reason of ['invalid_number', 'unreachable_number']) {
      rpc.mockClear()
      customerRow = { ...customerRow, sms_status: 'sms_deactivated', sms_opt_in: false, sms_deactivation_reason: reason }
      await ConsentService.applyBookingContactConsent('c1', compactEvent, publicEvent)
      expect(recordedRows().some((row) => row.channel === 'sms' && row.purpose === 'service')).toBe(false)
    }
  })

  it('stores the read-out wording on a yes given to staff (D32)', async () => {
    await ConsentService.applyStaffCapturedConsent(
      'c1',
      { service_contact_notice_shown: true, marketing_sms_opt_in: true, notice_key: 'staff_read_out_v1' },
      'staff-user',
      { source: 'staff_table_booking', captureMethod: 'staff_verbal', relatedEntityType: 'table_booking', relatedEntityId: 'tb-1' }
    )
    const marketing = recordedRows().find((row) => row.purpose === 'marketing')
    expect(marketing).toMatchObject({ channel: 'sms', status: 'opted_in', legal_basis: 'consent', capture_method: 'staff_verbal' })
    expect(marketing?.consent_text).toContain('Can we also text you the latest from The Anchor')
    expect(recordedRows().some((row) => row.legal_basis === 'soft_opt_in')).toBe(false)
  })
})
