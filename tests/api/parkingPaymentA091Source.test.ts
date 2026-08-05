import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

function readRepoFile(path: string) {
  return readFileSync(join(process.cwd(), path), 'utf8')
}

describe('A-091 public parking payment source guards', () => {
  it('does not send PayPal cancellations to missing parking booking routes', () => {
    const actionSource = readRepoFile('src/app/actions/parking.ts')
    const apiSource = readRepoFile('src/app/api/parking/bookings/route.ts')

    expect(actionSource).not.toContain('/parking/bookings/${booking.id}?cancelled=true')
    expect(apiSource).not.toContain('/parking/bookings/${booking.id}?cancelled=true')
    expect(actionSource).toContain("parkingGuestUrl(appUrl, booking.id, 'cancelled')")
    expect(apiSource).toContain("parkingGuestUrl(appUrl, booking.id, 'cancelled')")
  })

  it('keeps branded public parking not-found and payment-error surfaces', () => {
    expect(existsSync(join(process.cwd(), 'src/app/parking/not-found.tsx'))).toBe(true)
    expect(existsSync(join(process.cwd(), 'src/app/parking/payment-error/page.tsx'))).toBe(true)
    // These two surfaces moved onto the shared guest design system, so the branding marker is
    // now the guest shell plus the sentence-case 'Guest parking' kicker rather than the old
    // 'Guest Parking' hero title. The guard still proves the same thing: neither surface may
    // regress to an unbranded default Next.js page.
    const notFoundSource = readRepoFile('src/app/parking/not-found.tsx')
    expect(notFoundSource).toContain('GuestShell')
    expect(notFoundSource).toContain('Guest parking')

    const paymentErrorSource = readRepoFile('src/app/parking/payment-error/page.tsx')
    expect(paymentErrorSource).toContain('GuestShell')
    expect(paymentErrorSource).toContain('Payment link incomplete')
  })
})
