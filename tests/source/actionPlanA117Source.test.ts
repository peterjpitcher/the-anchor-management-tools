import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function read(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('A-117 remaining polish source guards', () => {
  it('keeps dashboard today drill-down rows keyboard-clickable', () => {
    const source = read('src/app/(authenticated)/dashboard/_components/DashboardClient.tsx')

    expect(source).toContain('return item.href ?')
    expect(source).toContain('href={item.href}')
  })

  it('keeps right-to-work document deletion on the DS confirmation path', () => {
    const source = read('src/components/features/employees/RightToWorkTab.tsx')

    expect(source).toContain('ConfirmDialog')
    expect(source).not.toContain('confirm(')
    expect(source).not.toContain('alert(')
  })

  it('keeps leave allowance progress safe when allowance is zero', () => {
    const source = read('src/app/(authenticated)/rota/leave/LeaveManagerClient.tsx')

    expect(source).toContain('allowance > 0 ? Math.min')
    expect(source).not.toContain('usage.count / usage.allowance')
  })

  it('keeps staff open-shift requests as an explicit confirmation step', () => {
    const source = read('src/app/(staff-portal)/portal/shifts/OpenShiftRequestButton.tsx')

    expect(source).toContain('Confirm you want to ask to work this shift.')
    expect(source).toContain('Confirm request')
  })

  it('rate-limits employee onboarding token routes before invite validation', () => {
    const source = read('src/middleware.ts')
    const rateLimitIndex = source.indexOf('applyOnboardingTokenRateLimit(request)')
    const supabaseIndex = source.indexOf('createServerClient(')

    expect(rateLimitIndex).toBeGreaterThan(-1)
    expect(supabaseIndex).toBeGreaterThan(-1)
    expect(rateLimitIndex).toBeLessThan(supabaseIndex)
    expect(source).toContain('getOnboardingTokenFromPath')
  })

  it('checks PayPal parking capture amount and currency before marking payment paid', () => {
    const source = read('src/app/api/webhooks/paypal/parking/route.ts')
    const mismatchIndex = source.indexOf('PayPal capture amount or currency mismatch')
    const updateIndex = source.indexOf(".update({\n      status: 'paid'")

    expect(mismatchIndex).toBeGreaterThan(-1)
    expect(updateIndex).toBeGreaterThan(-1)
    expect(mismatchIndex).toBeLessThan(updateIndex)
  })
})
