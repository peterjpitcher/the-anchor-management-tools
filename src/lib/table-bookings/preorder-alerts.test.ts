import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  logAuditEvent: vi.fn(),
  sendEmail: vi.fn(),
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

vi.mock('@/app/actions/audit', () => ({ logAuditEvent: mocks.logAuditEvent }))
vi.mock('@/lib/email/emailService', () => ({ sendEmail: mocks.sendEmail }))
vi.mock('@/lib/logger', () => ({ logger: mocks.logger }))
vi.mock('@/lib/env', () => ({ getAppUrl: () => 'https://management.example.com' }))

import { PREORDER_MANAGER_EMAIL, reportPreorderSaveFailure } from './preorder-alerts'

const FAILURE = {
  tableBookingId: 'booking-1',
  bookingReference: 'TB-FIXTURE',
  bookingDate: '2026-12-05',
  requestedCovers: 4,
  savedCovers: 1,
  error: 'connection reset',
}

// BK-059: a failed pre-order save must reach a person, not a silent warning.
describe('reportPreorderSaveFailure', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.logAuditEvent.mockResolvedValue(undefined)
    mocks.sendEmail.mockResolvedValue({ success: true })
  })

  it('writes a failure audit row and emails the manager, naming the booking and the counts', async () => {
    await reportPreorderSaveFailure(FAILURE)

    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        resource_type: 'table_booking_preorder',
        resource_id: 'booking-1',
        operation_status: 'failure',
        error_message: 'connection reset',
        additional_info: expect.objectContaining({ booking_reference: 'TB-FIXTURE', requested_covers: 4, saved_covers: 1 }),
      }),
    )
    const email = mocks.sendEmail.mock.calls[0][0]
    expect(email.to).toBe(PREORDER_MANAGER_EMAIL)
    expect(email.subject).toBe('Food choices did not save: TB-FIXTURE')
    expect(email.text).toContain('sent food choices for 4 guests, but 1 saved')
    expect(email.html).toContain('https://management.example.com/table-bookings/booking-1')
  })

  it('still emails when the audit write fails, and never throws', async () => {
    mocks.logAuditEvent.mockRejectedValueOnce(new Error('audit down'))

    await expect(reportPreorderSaveFailure(FAILURE)).resolves.toBeUndefined()
    expect(mocks.sendEmail).toHaveBeenCalled()
    expect(mocks.logger.error).toHaveBeenCalled()
  })

  it('logs an error when the email cannot be sent', async () => {
    mocks.sendEmail.mockResolvedValueOnce({ success: false, error: 'provider down' })

    await reportPreorderSaveFailure(FAILURE)

    expect(mocks.logger.error).toHaveBeenCalledWith(
      'Could not email the manager about a failed pre-order save',
      expect.anything(),
    )
  })
})
