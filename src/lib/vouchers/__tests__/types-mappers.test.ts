import { describe, it, expect } from 'vitest'
import {
  mapTermsVersionRow,
  mapVoucherBatchRow,
  mapVoucherEventRow,
  mapVoucherReminderRow,
  mapVoucherRow,
  mapVoucherTypeRow,
} from '@/types/vouchers'
import type { VoucherReminderRow, VoucherRow } from '@/types/vouchers'

describe('voucher row mappers', () => {
  it('maps a full voucher row to camelCase without losing fields', () => {
    const row: VoucherRow = {
      id: 'v-1',
      voucher_number: 'AN-2607-0001',
      type_id: 'free-drink',
      batch_id: 'b-1',
      status: 'redeemed',
      value_pence: 1000,
      terms_version: 'v2.0',
      issued_at: '2026-07-01T19:00:00.000Z',
      issued_by: 'emp-1',
      issued_by_name: 'Sam Staff',
      issued_by_user_id: 'user-1',
      event_id: 'ev-1',
      won_at_label: 'Quiz Night',
      expiry_date: '2026-09-29',
      customer_id: 'cus-1',
      redeemed_at: '2026-07-20T20:00:00.000Z',
      redeemed_by: 'emp-2',
      redeemed_by_name: 'Riley Staff',
      redeemed_by_user_id: 'user-2',
      transaction_ref: 'T123',
      booking_ref: null,
      cancelled_at: null,
      cancelled_reason: null,
      replaced_by_id: null,
      replaces_id: null,
      created_at: '2026-06-30T10:00:00.000Z',
      updated_at: '2026-07-20T20:00:00.000Z',
    }

    const mapped = mapVoucherRow(row)
    expect(mapped).toEqual({
      id: 'v-1',
      voucherNumber: 'AN-2607-0001',
      typeId: 'free-drink',
      batchId: 'b-1',
      status: 'redeemed',
      valuePence: 1000,
      termsVersion: 'v2.0',
      issuedAt: '2026-07-01T19:00:00.000Z',
      issuedBy: 'emp-1',
      issuedByName: 'Sam Staff',
      issuedByUserId: 'user-1',
      eventId: 'ev-1',
      wonAtLabel: 'Quiz Night',
      expiryDate: '2026-09-29',
      customerId: 'cus-1',
      redeemedAt: '2026-07-20T20:00:00.000Z',
      redeemedBy: 'emp-2',
      redeemedByName: 'Riley Staff',
      redeemedByUserId: 'user-2',
      transactionRef: 'T123',
      bookingRef: null,
      cancelledAt: null,
      cancelledReason: null,
      replacedById: null,
      replacesId: null,
      createdAt: '2026-06-30T10:00:00.000Z',
      updatedAt: '2026-07-20T20:00:00.000Z',
    })
    // Same number of fields both sides: nothing dropped, nothing invented
    expect(Object.keys(mapped)).toHaveLength(Object.keys(row).length)
  })

  it('maps a reminder row to camelCase', () => {
    const row: VoucherReminderRow = {
      id: 'r-1',
      voucher_id: 'v-1',
      customer_id: 'cus-1',
      reminder_kind: 'pre_expiry',
      status: 'pending',
      scheduled_for: '2026-09-15',
      sent_at: null,
      message_sid: null,
      attempts: 0,
      last_error: null,
      created_at: '2026-07-01T19:00:00.000Z',
      updated_at: '2026-07-01T19:00:00.000Z',
    }

    expect(mapVoucherReminderRow(row)).toEqual({
      id: 'r-1',
      voucherId: 'v-1',
      customerId: 'cus-1',
      reminderKind: 'pre_expiry',
      status: 'pending',
      scheduledFor: '2026-09-15',
      sentAt: null,
      messageSid: null,
      attempts: 0,
      lastError: null,
      createdAt: '2026-07-01T19:00:00.000Z',
      updatedAt: '2026-07-01T19:00:00.000Z',
    })
  })

  it('maps type, terms, batch and event rows to camelCase', () => {
    expect(
      mapVoucherTypeRow({
        id: 'food-10',
        display_title: '£10 FOOD VOUCHER',
        cover_title: 'FOOD',
        value_pence: 1000,
        requires_booking: false,
        alcohol: false,
        entitlement_html: '<p>£10 off food</p>',
        hero: null,
        copy: null,
        sort_order: 3,
        active: true,
        created_at: '2026-07-30T00:00:00.000Z',
        updated_at: '2026-07-30T00:00:00.000Z',
      }).displayTitle
    ).toBe('£10 FOOD VOUCHER')

    expect(
      mapTermsVersionRow({
        version: 'v2.0',
        effective_from: '2026-07-30',
        clauses: [{ heading: 'Expiry', body: 'Vouchers expire on the printed date.' }],
        published_by: 'Peter',
        created_at: '2026-07-30T00:00:00.000Z',
      }).effectiveFrom
    ).toBe('2026-07-30')

    expect(
      mapVoucherBatchRow({
        id: 'b-1',
        created_at: '2026-07-30T00:00:00.000Z',
        created_by: 'user-1',
        created_by_name: 'Peter',
        note: null,
        terms_version: 'v2.0',
        type_definitions: { 'food-10': { displayTitle: '£10 FOOD VOUCHER' } },
        total_count: 40,
        pdf_status: 'ready',
        pdf_path: 'vouchers/b-1/render-1.pdf',
        pdf_bytes: 123456,
        pdf_pages: 80,
        render_attempts: 1,
        render_error: null,
        updated_at: '2026-07-30T00:05:00.000Z',
      }).pdfStatus
    ).toBe('ready')

    expect(
      mapVoucherEventRow({
        id: 'e-1',
        voucher_id: 'v-1',
        action: 'redeemed',
        actor_user_id: 'user-2',
        actor_employee_id: 'emp-2',
        actor_name: 'Riley Staff',
        source: 'foh',
        at: '2026-07-20T20:00:00.000Z',
        detail: { transaction_ref: 'T123' },
      }).actorName
    ).toBe('Riley Staff')
  })
})
