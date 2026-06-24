import { describe, expect, it } from 'vitest'
import { parseBulkMessageCustomerIds } from '@/lib/bulk-messages/customer-selection'

describe('parseBulkMessageCustomerIds', () => {
  it('parses comma-separated customer IDs', () => {
    expect(parseBulkMessageCustomerIds('cust-1,cust-2')).toEqual(['cust-1', 'cust-2'])
  })

  it('trims, deduplicates, and drops empty IDs', () => {
    expect(parseBulkMessageCustomerIds([' cust-1 ', '', 'cust-2,cust-1,,'])).toEqual([
      'cust-1',
      'cust-2',
    ])
  })
})
