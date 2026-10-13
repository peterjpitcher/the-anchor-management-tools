import { beforeEach, describe, expect, it, vi } from 'vitest'
import { schemaCheckedTable, type SchemaCheckedTable } from '../helpers/schemaCheckedTable'

/**
 * The vendor rate lookup behind the private booking items page.
 *
 * getVendorRate selected `typical_rate_normalized` from `vendors`. That is not a column: the
 * normalised rate is worked out in code from `typical_rate`. PostgREST answered 400 (42703), the
 * service threw, and the page was left with an empty price box and nothing to say why.
 *
 * `vendors` here is a stand-in that refuses a column the real table does not have.
 */

const state = vi.hoisted(() => ({ vendors: null as SchemaCheckedTable | null }))

function client() {
  return {
    from(table: string) {
      if (table === 'vendors' && state.vendors) return state.vendors.query()
      throw new Error(`Unexpected table: ${table}`)
    },
  }
}

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => client()) }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => client()) }))
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { getVendorRate } from '@/services/private-bookings/queries'

const VENDOR_ID = 'b2e1d2ef-0000-4000-8000-000000000001'

describe('getVendorRate', () => {
  beforeEach(() => {
    state.vendors = schemaCheckedTable('vendors', [
      { id: VENDOR_ID, name: 'Test DJ', service_type: 'entertainment', typical_rate: '£250 per night' },
      { id: 'b2e1d2ef-0000-4000-8000-000000000002', name: 'Test band', service_type: 'entertainment', typical_rate: '£90' },
    ])
  })

  it("returns the vendor's rate using only columns the vendors table has", async () => {
    const vendor = await getVendorRate(VENDOR_ID)

    expect(state.vendors?.log.map((query) => query.error)).toEqual([null])
    expect(vendor).toMatchObject({ id: VENDOR_ID, typical_rate: '£250 per night' })
  })

  it('returns nothing for a vendor that is not there', async () => {
    await expect(getVendorRate('b2e1d2ef-0000-4000-8000-00000000dead')).resolves.toBeNull()
  })
})
