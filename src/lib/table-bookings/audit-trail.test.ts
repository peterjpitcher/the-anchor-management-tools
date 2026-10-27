import { describe, expect, it } from 'vitest'
import { auditEventLabel, buildBookingAuditTrail, type AuditLogRow } from './audit-trail'

/**
 * BK-038: the Audit Trail card read booking_audit, which nothing has written since 8 June 2026, so
 * every booking since showed "No audit events yet" while audit_logs held its moves, seatings,
 * messages and payments. The card now reads audit_logs, with the legacy rows beside them.
 */

function log(overrides: Partial<AuditLogRow>): AuditLogRow {
  return {
    id: 'log-1',
    operation_type: 'move_table',
    user_id: null,
    user_email: null,
    additional_info: null,
    new_values: null,
    old_values: null,
    created_at: '2026-10-25T18:00:00Z',
    ...overrides,
  }
}

describe('the booking audit trail', () => {
  it('reads audit_logs rows with plain labels, newest first', () => {
    const trail = buildBookingAuditTrail([
      log({ id: 'a', operation_type: 'create', created_at: '2026-10-25T17:00:00Z', additional_info: { source: 'admin', path: 'staff_booking' } }),
      log({ id: 'b', operation_type: 'table_booking.seated', user_email: 'foh@the-anchor.pub', user_id: 'u1', created_at: '2026-10-25T19:00:00Z' }),
      log({ id: 'c', operation_type: 'move_table', user_id: 'u2', created_at: '2026-10-25T18:00:00Z' }),
    ])

    expect(trail.map((entry) => [entry.label, entry.actor])).toEqual([
      ['Seated', 'foh@the-anchor.pub'],
      ['Table moved', 'Team member'],
      ['Booking created', 'System'],
    ])
    expect(trail[2].meta).toMatchObject({ source: 'admin', path: 'staff_booking' })
  })

  it('takes the status change from the values or the details recorded', () => {
    const [fromValues] = buildBookingAuditTrail([log({ operation_type: 'update', old_values: { status: 'confirmed' }, new_values: { status: 'cancelled' } })])
    expect([fromValues.old_status, fromValues.new_status]).toEqual(['confirmed', 'cancelled'])

    const [fromInfo] = buildBookingAuditTrail([log({ operation_type: 'update', additional_info: { status_from: 'pending_payment', status_to: 'confirmed' } })])
    expect([fromInfo.old_status, fromInfo.new_status]).toEqual(['pending_payment', 'confirmed'])
  })

  it('keeps the legacy booking_audit rows readable beside them', () => {
    const trail = buildBookingAuditTrail(
      [log({ id: 'new', operation_type: 'table_booking.left', created_at: '2026-10-25T21:00:00Z' })],
      [{ id: 7, event: 'booking_created', old_status: null, new_status: 'confirmed', meta: '{"actor_name":"Peter"}', created_at: '2026-06-01T12:00:00Z', created_by: 'u3' }],
    )

    expect(trail.map((entry) => [entry.id, entry.label, entry.actor])).toEqual([
      ['log:new', 'Marked as left', 'System'],
      ['legacy:7', 'Booking created', 'Peter'],
    ])
  })

  it('labels the events FOH and the crons write, and words any other event plainly', () => {
    expect(auditEventLabel('table_booking.auto_cancelled')).toBe('Cancelled: deposit not paid in time')
    expect(auditEventLabel('table_booking.deposit_waived')).toBe('Deposit waived')
    expect(auditEventLabel('payment.captured')).toBe('Deposit paid')
    expect(auditEventLabel('table_booking.something_new')).toBe('Something new')
  })
})

describe('a guest changing their own party size (BK-091)', () => {
  it('reads as the guest, not as the system', () => {
    const [entry] = buildBookingAuditTrail([
      log({
        operation_type: 'table_booking.party_size_changed_by_guest',
        additional_info: { source: 'guest_manage_link', previousPartySize: 4, newPartySize: 6 },
      }),
    ])

    expect(entry.label).toBe('Party size changed by the guest')
    expect(entry.actor).toBe('Guest')
  })
})
