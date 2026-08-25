import { describe, expect, it } from 'vitest'
import { buildCustomerSearchFilter } from './customerSearchFilters'

describe('buildCustomerSearchFilter', () => {
  it('searches local UK phone numbers in raw and E.164 columns', () => {
    const filter = buildCustomerSearchFilter('07700 900123')

    expect(filter).toContain('mobile_number.ilike.')
    expect(filter).toContain('mobile_e164.ilike.')
    expect(filter).toContain('+447700900123')
  })

  it('keeps a multi-part surname together', () => {
    const filter = buildCustomerSearchFilter('Adam Lloyd Jones')

    expect(filter).toContain('first_name.ilike."%adam%"')
    expect(filter).toContain('last_name.ilike."%lloyd jones%"')
  })

  it('quotes PostgREST filter values', () => {
    const filter = buildCustomerSearchFilter('O"Brien')

    expect(filter).toContain('\\"')
  })
})
