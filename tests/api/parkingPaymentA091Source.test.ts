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
    expect(readRepoFile('src/app/parking/not-found.tsx')).toContain('Guest Parking')
    expect(readRepoFile('src/app/parking/payment-error/page.tsx')).toContain('Payment link incomplete')
  })
})
