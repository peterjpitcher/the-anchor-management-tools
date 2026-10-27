import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const applyStaffCapturedConsent = vi.hoisted(() => vi.fn())
vi.mock('@/services/consent', () => ({ ConsentService: { applyStaffCapturedConsent } }))
const loggerError = vi.hoisted(() => vi.fn())
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: loggerError, info: vi.fn() } }))

import { recordStaffReadOutConsent } from '@/lib/consent/staff-capture'

/**
 * Guests booked by staff get marketing texts only after staff read them the notice and record
 * their yes (owner decision D32, BK-079).
 */
describe('recordStaffReadOutConsent', () => {
  beforeEach(() => {
    applyStaffCapturedConsent.mockReset()
    loggerError.mockReset()
  })

  const base = {
    customerId: 'c1',
    actorUserId: 'staff-1',
    source: 'staff_table_booking' as const,
    relatedEntityType: 'table_booking' as const,
    relatedEntityId: 'tb-1',
  }

  it('records nothing unless staff ticked that the guest said yes', async () => {
    await recordStaffReadOutConsent({ ...base, saidYes: undefined })
    await recordStaffReadOutConsent({ ...base, saidYes: false })
    expect(applyStaffCapturedConsent).not.toHaveBeenCalled()
  })

  it('records the yes with the read-out notice, as given to staff', async () => {
    await recordStaffReadOutConsent({ ...base, saidYes: true })
    expect(applyStaffCapturedConsent).toHaveBeenCalledWith(
      'c1',
      { service_contact_notice_shown: true, marketing_sms_opt_in: true, notice_key: 'staff_read_out_v1' },
      'staff-1',
      { source: 'staff_table_booking', captureMethod: 'staff_verbal', relatedEntityType: 'table_booking', relatedEntityId: 'tb-1' }
    )
  })

  it('never fails the booking, and logs a failure where production can see it', async () => {
    applyStaffCapturedConsent.mockRejectedValue(new Error('database down'))
    await expect(recordStaffReadOutConsent({ ...base, saidYes: true })).resolves.toBeUndefined()
    expect(loggerError).toHaveBeenCalled()
  })
})

describe('every staff booking path offers the notice and records the yes', () => {
  it.each([
    ['src/app/api/foh/bookings/route.ts', "source: 'staff_table_booking'"],
    ['src/app/api/foh/event-bookings/route.ts', "source: 'staff_event_booking'"],
    ['src/app/actions/events.ts', "source: 'staff_event_booking'"],
    ['src/app/actions/event-check-in.ts', "source: 'staff_event_booking'"],
    ['src/app/actions/privateBookingActions.ts', "source: 'staff_private_booking'"],
  ])('%s records it', (file, source) => {
    const text = readFileSync(join(process.cwd(), file), 'utf8')
    expect(text).toContain('recordStaffReadOutConsent({')
    expect(text).toContain(source)
  })

  it.each([
    'src/app/(authenticated)/table-bookings/foh/components/FohCreateBookingModal.tsx',
    'src/app/(authenticated)/events/[id]/AddManualBookingForm.tsx',
    'src/app/(event-kiosk)/events/[id]/check-in/EventCheckInClient.tsx',
    'src/app/(authenticated)/private-bookings/new/page.tsx',
  ])('%s shows the notice', (file) => {
    expect(readFileSync(join(process.cwd(), file), 'utf8')).toContain('<StaffMarketingConsentField')
  })
})
