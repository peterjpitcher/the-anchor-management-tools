import { describe, expect, it, vi } from 'vitest'
import { resolveParkingSmsEligibility } from '@/lib/parking/sms-safety'

function createSupabaseMock(result: { data: any; error: any }) {
  const maybeSingle = vi.fn().mockResolvedValue(result)
  const eq = vi.fn().mockReturnValue({ maybeSingle })
  const select = vi.fn().mockReturnValue({ eq })

  return {
    from: vi.fn((table: string) => {
      if (table !== 'customers') {
        throw new Error(`Unexpected table: ${table}`)
      }
      return { select }
    })
  } as any
}

describe('resolveParkingSmsEligibility', () => {
  it('allows sends when no customer id is provided', async () => {
    const supabase = createSupabaseMock({ data: null, error: null })
    const result = await resolveParkingSmsEligibility(supabase, null)

    expect(result).toEqual({ allowed: true })
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('fails closed when customer SMS preference lookup errors', async () => {
    const supabase = createSupabaseMock({
      data: null,
      error: { message: 'customer preference lookup failed' }
    })

    const result = await resolveParkingSmsEligibility(supabase, 'customer-1')
    expect(result).toEqual({
      allowed: false,
      reason: 'customer_lookup_failed',
      detail: 'customer preference lookup failed'
    })
  })

  it('fails closed when customer lookup affects no rows', async () => {
    const supabase = createSupabaseMock({
      data: null,
      error: null
    })

    const result = await resolveParkingSmsEligibility(supabase, 'customer-2')
    expect(result).toEqual({
      allowed: false,
      reason: 'customer_lookup_failed',
      detail: 'Customer SMS preference row not found'
    })
  })

  it('blocks opted-out customers', async () => {
    const supabase = createSupabaseMock({
      data: { sms_opt_in: false },
      error: null
    })

    const result = await resolveParkingSmsEligibility(supabase, 'customer-3')
    expect(result).toEqual({
      allowed: false,
      reason: 'customer_opted_out'
    })
  })

  it('allows opted-in customers', async () => {
    const supabase = createSupabaseMock({
      data: { sms_opt_in: true },
      error: null
    })

    const result = await resolveParkingSmsEligibility(supabase, 'customer-4')
    expect(result).toEqual({ allowed: true })
  })
})
