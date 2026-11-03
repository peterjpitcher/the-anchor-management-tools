// getHourlyRate and read failures (FF-46, FF-60).
//
// A failed read of the employee's rate overrides used to be treated as "no override", so the
// Pay tab showed the age-band rate as the current rate. And every lookup used .single(), which
// logs a 406 for each employee without a pay settings row or an override. A failed read is now
// returned as an error, and the optional rows are read with maybeSingle.
import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { getHourlyRate } from '@/lib/rota/pay-calculator'

const mockedCreateClient = createClient as unknown as ReturnType<typeof vi.fn>

type Result = { data: unknown; error: { code: string; message: string } | null }
type Call = { table: string; method: string }

/** A session client whose every query chain resolves to the result given for its table. */
function clientWith(results: Record<string, Result>) {
  const calls: Call[] = []
  const query = (table: string) => {
    const chain: object = new Proxy({}, {
      get(_target, property) {
        if (property === 'then') {
          const result = results[table] ?? { data: null, error: null }
          return (resolve: (value: unknown) => unknown) => resolve(result)
        }
        return () => {
          calls.push({ table, method: String(property) })
          return chain
        }
      },
    })
    return chain
  }
  mockedCreateClient.mockResolvedValue({ from: vi.fn((table: string) => query(table)) })
  return calls
}

const READ_FAILED = { code: '57014', message: 'canceling statement due to statement timeout' }

describe('getHourlyRate', () => {
  let consoleError: MockInstance

  beforeEach(() => {
    vi.clearAllMocks()
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('returns an error, not the age-band rate, when the override read fails', async () => {
    clientWith({
      employee_pay_settings: { data: null, error: null },
      employee_rate_overrides: { data: null, error: READ_FAILED },
      employees: { data: { date_of_birth: '2000-01-01' }, error: null },
      pay_age_bands: { data: [{ id: 'band-1', min_age: 21, max_age: null }], error: null },
      pay_band_rates: { data: { hourly_rate: 12.21 }, error: null },
    })

    const result = await getHourlyRate('employee-1', '2026-11-02')

    expect(result).toEqual({
      success: false,
      error: 'The current hourly rate could not be worked out because the individual rate overrides could not be loaded.',
    })
    consoleError.mockRestore()
  })

  it('returns an error when the pay settings read fails', async () => {
    clientWith({ employee_pay_settings: { data: null, error: READ_FAILED } })

    const result = await getHourlyRate('employee-1', '2026-11-02')

    expect(result.success).toBe(false)
    consoleError.mockRestore()
  })

  it('reads the optional rows with maybeSingle, never single', async () => {
    const calls = clientWith({
      employee_pay_settings: { data: null, error: null },
      employee_rate_overrides: { data: null, error: null },
      employees: { data: { date_of_birth: '2000-01-01' }, error: null },
      pay_age_bands: { data: [{ id: 'band-1', min_age: 21, max_age: null }], error: null },
      pay_band_rates: { data: { hourly_rate: 12.21 }, error: null },
    })

    const result = await getHourlyRate('employee-1', '2026-11-02')

    expect(result).toEqual({ success: true, data: { rate: 12.21, source: 'age_band' } })
    expect(calls.filter((call) => call.method === 'single')).toEqual([])
    expect(calls.filter((call) => call.method === 'maybeSingle').map((call) => call.table)).toEqual([
      'employee_pay_settings',
      'employee_rate_overrides',
      'employees',
      'pay_band_rates',
    ])
    consoleError.mockRestore()
  })

  it('returns the override when one is in force', async () => {
    clientWith({
      employee_pay_settings: { data: { pay_type: 'hourly' }, error: null },
      employee_rate_overrides: { data: { hourly_rate: 13.5 }, error: null },
    })

    const result = await getHourlyRate('employee-1', '2026-11-02')

    expect(result).toEqual({ success: true, data: { rate: 13.5, source: 'override' } })
    consoleError.mockRestore()
  })

  it('returns no rate for a salaried employee', async () => {
    clientWith({ employee_pay_settings: { data: { pay_type: 'salaried' }, error: null } })

    const result = await getHourlyRate('employee-1', '2026-11-02')

    expect(result).toEqual({ success: true, data: null })
    consoleError.mockRestore()
  })
})
