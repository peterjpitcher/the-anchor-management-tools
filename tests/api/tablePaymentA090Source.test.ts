import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const tablePaymentPage = readFileSync(resolve(process.cwd(), 'src/app/g/[token]/table-payment/page.tsx'), 'utf8')
const tableBookingHelpers = readFileSync(resolve(process.cwd(), 'src/lib/table-bookings/bookings.ts'), 'utf8')

describe('A-090 table payment source guards', () => {
  it('does not trust ?state=paid before verifying the booking payment status', () => {
    const previewIndex = tablePaymentPage.indexOf('getTablePaymentPreviewByRawToken')
    const completedIndex = tablePaymentPage.indexOf("booking?.payment_status === 'completed'")

    expect(previewIndex).toBeGreaterThan(0)
    expect(completedIndex).toBeGreaterThan(previewIndex)
    expect(tablePaymentPage.slice(0, previewIndex)).not.toContain("state === 'paid'")
  })

  it('uses Europe/London for fallback hold end-of-day expiry', () => {
    expect(tableBookingHelpers).toContain('function endOfLondonBookingDay')
    expect(tableBookingHelpers).toContain("fromZonedTime(`${bookingDate}T23:59:59`, LONDON_TIMEZONE)")
  })

  it('removes the old public booking mock components', () => {
    expect(existsSync(resolve(process.cwd(), 'src/app/table-booking/_components/PublicBookingClient.tsx'))).toBe(false)
    expect(existsSync(resolve(process.cwd(), 'src/app/booking-confirmation/[token]/_components/BookingConfirmationClient.tsx'))).toBe(false)
  })
})
