import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { VendorService } from '@/services/vendors'
import { EventCategoryService } from '@/services/event-categories'
import { CustomerService } from '@/services/customers'
import { ShortLinkService } from '@/services/short-links'
import { EventService } from '@/services/events'
import { InvoiceService } from '@/services/invoices'

const mockedCreateClient = createClient as unknown as Mock
const mockedCreateAdminClient = createAdminClient as unknown as Mock

describe('Mutation race/row-effect guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('VendorService.deleteVendor throws not-found when deactivation update affects no rows', async () => {
    const invoicesLimit = vi.fn().mockResolvedValue({ data: [{ id: 'inv-1' }], error: null })
    const invoicesIs = vi.fn().mockReturnValue({ limit: invoicesLimit })
    const invoicesEq = vi.fn().mockReturnValue({ is: invoicesIs })

    const deactivateMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const deactivateSelect = vi.fn().mockReturnValue({ maybeSingle: deactivateMaybeSingle })
    const deactivateEq = vi.fn().mockReturnValue({ select: deactivateSelect })

    mockedCreateClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table === 'invoices') {
          return {
            select: vi.fn().mockReturnValue({ eq: invoicesEq }),
          }
        }

        if (table === 'invoice_vendors') {
          return {
            update: vi.fn().mockReturnValue({ eq: deactivateEq }),
            delete: vi.fn(),
          }
        }

        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    await expect(VendorService.deleteVendor('vendor-1')).rejects.toThrow('Vendor not found')
  })

  it('VendorService.updateVendor throws not-found when update affects no rows', async () => {
    const updateMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybeSingle })
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect })

    mockedCreateClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table !== 'invoice_vendors') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          update: vi.fn().mockReturnValue({ eq: updateEq }),
        }
      }),
    })

    await expect(
      VendorService.updateVendor('vendor-1', {
        name: 'Band Co',
        payment_terms: 30,
      })
    ).rejects.toThrow('Vendor not found')
  })

  it('EventCategoryService.deleteCategory throws not-found when delete affects no rows', async () => {
    const usageEq = vi.fn().mockResolvedValue({ count: 0, error: null })

    const loadMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: 'cat-1', name: 'Jazz' },
      error: null,
    })
    const loadEq = vi.fn().mockReturnValue({ maybeSingle: loadMaybeSingle })

    const deleteMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const deleteSelect = vi.fn().mockReturnValue({ maybeSingle: deleteMaybeSingle })
    const deleteEq = vi.fn().mockReturnValue({ select: deleteSelect })

    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'events') {
          return {
            select: vi.fn().mockReturnValue({ eq: usageEq }),
          }
        }

        if (table === 'event_categories') {
          return {
            select: vi.fn().mockReturnValue({ eq: loadEq }),
            delete: vi.fn().mockReturnValue({ eq: deleteEq }),
          }
        }

        throw new Error(`Unexpected table: ${table}`)
      }),
    })

    await expect(EventCategoryService.deleteCategory('cat-1')).rejects.toThrow('Event category not found')
  })

  it('CustomerService.deleteCustomer throws not-found when prefetch returns no customer', async () => {
    const fetchMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const fetchEq = vi.fn().mockReturnValue({ maybeSingle: fetchMaybeSingle })

    mockedCreateClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table !== 'customers') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          select: vi.fn().mockReturnValue({ eq: fetchEq }),
          delete: vi.fn(),
        }
      }),
    })

    await expect(CustomerService.deleteCustomer('customer-1')).rejects.toThrow('Customer not found')
  })

  it('CustomerService.toggleSmsOptIn throws not-found when update affects no rows', async () => {
    const fetchMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'customer-1',
        sms_opt_in: true,
        sms_status: 'active',
        marketing_sms_opt_in: false,
        sms_delivery_failures: 0,
        sms_deactivated_at: null,
        sms_deactivation_reason: null,
      },
      error: null,
    })
    const fetchEq = vi.fn().mockReturnValue({ maybeSingle: fetchMaybeSingle })

    const updateMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybeSingle })
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect })

    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table !== 'customers') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          select: vi.fn().mockReturnValue({ eq: fetchEq }),
          update: vi.fn().mockReturnValue({ eq: updateEq }),
        }
      }),
    })

    await expect(CustomerService.toggleSmsOptIn('customer-1', false)).rejects.toThrow('Customer not found')
  })

  it('CustomerService.toggleSmsOptIn updates sms_status and marketing flags when opting out', async () => {
    const fetchMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'customer-1',
        sms_opt_in: true,
        sms_status: 'active',
        marketing_sms_opt_in: true,
        sms_delivery_failures: 2,
        sms_deactivated_at: null,
        sms_deactivation_reason: null,
      },
      error: null,
    })
    const fetchEq = vi.fn().mockReturnValue({ maybeSingle: fetchMaybeSingle })

    const updateMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: 'customer-1' },
      error: null,
    })
    const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybeSingle })
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect })

    let capturedUpdatePayload: any = null
    const update = vi.fn((payload: Record<string, unknown>) => {
      capturedUpdatePayload = payload
      return { eq: updateEq }
    })

    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table !== 'customers') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          select: vi.fn().mockReturnValue({ eq: fetchEq }),
          update,
        }
      }),
    })

    const result = await CustomerService.toggleSmsOptIn('customer-1', false)

    expect(capturedUpdatePayload).toEqual(
      expect.objectContaining({
        sms_opt_in: false,
        sms_status: 'opted_out',
        marketing_sms_opt_in: false,
        sms_deactivated_at: null,
        sms_deactivation_reason: null,
      }),
    )
    expect(result.newValues).toEqual(
      expect.objectContaining({
        sms_opt_in: false,
        sms_status: 'opted_out',
        marketing_sms_opt_in: false,
      }),
    )
  })

  it('CustomerService.toggleSmsOptIn marks sms_status active and clears deactivation when opting back in', async () => {
    const fetchMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'customer-1',
        sms_opt_in: false,
        sms_status: 'opted_out',
        marketing_sms_opt_in: false,
        sms_delivery_failures: 4,
        sms_deactivated_at: '2026-02-01T00:00:00.000Z',
        sms_deactivation_reason: 'delivery_failures',
      },
      error: null,
    })
    const fetchEq = vi.fn().mockReturnValue({ maybeSingle: fetchMaybeSingle })

    const updateMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: 'customer-1' },
      error: null,
    })
    const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybeSingle })
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect })

    let capturedUpdatePayload: any = null
    const update = vi.fn((payload: Record<string, unknown>) => {
      capturedUpdatePayload = payload
      return { eq: updateEq }
    })

    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table !== 'customers') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          select: vi.fn().mockReturnValue({ eq: fetchEq }),
          update,
        }
      }),
    })

    const result = await CustomerService.toggleSmsOptIn('customer-1', true)

    expect(capturedUpdatePayload).toEqual(
      expect.objectContaining({
        sms_opt_in: true,
        sms_status: 'active',
        sms_delivery_failures: 0,
        sms_deactivated_at: null,
        sms_deactivation_reason: null,
      }),
    )
    expect(capturedUpdatePayload).not.toHaveProperty('marketing_sms_opt_in')

    expect(result.newValues).toEqual(
      expect.objectContaining({
        sms_opt_in: true,
        sms_status: 'active',
        marketing_sms_opt_in: false,
        sms_delivery_failures: 0,
        sms_deactivated_at: null,
        sms_deactivation_reason: null,
      }),
    )
  })

  it('CustomerService.updateCustomer throws not-found when update affects no rows', async () => {
    const updateMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybeSingle })
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect })

    mockedCreateClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table !== 'customers') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          update: vi.fn().mockReturnValue({ eq: updateEq }),
        }
      }),
    })

    await expect(
      CustomerService.updateCustomer('customer-1', { first_name: 'Pat' })
    ).rejects.toThrow('Customer not found')
  })

  it('ShortLinkService.deleteShortLink throws not-found when delete affects no rows', async () => {
    const fetchMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'link-1',
        short_code: 'abc123',
        destination_url: 'https://example.com',
      },
      error: null,
    })
    const fetchEq = vi.fn().mockReturnValue({ maybeSingle: fetchMaybeSingle })

    const deleteMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const deleteSelect = vi.fn().mockReturnValue({ maybeSingle: deleteMaybeSingle })
    const deleteEq = vi.fn().mockReturnValue({ select: deleteSelect })

    mockedCreateClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table !== 'short_links') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          select: vi.fn().mockReturnValue({ eq: fetchEq }),
          delete: vi.fn().mockReturnValue({ eq: deleteEq }),
        }
      }),
    })

    await expect(ShortLinkService.deleteShortLink('link-1')).rejects.toThrow('Short link not found')
  })

  it('EventService.deleteEvent throws not-found when delete affects no rows after prefetch', async () => {
    const fetchSingle = vi.fn().mockResolvedValue({
      data: {
        name: 'Live Jazz',
        date: '2026-03-01',
      },
      error: null,
    })
    const fetchEq = vi.fn().mockReturnValue({ single: fetchSingle })

    const deleteMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const deleteSelect = vi.fn().mockReturnValue({ maybeSingle: deleteMaybeSingle })
    const deleteEq = vi.fn().mockReturnValue({ select: deleteSelect })

    mockedCreateClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table !== 'events') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          select: vi.fn().mockReturnValue({ eq: fetchEq }),
          delete: vi.fn().mockReturnValue({ eq: deleteEq }),
        }
      }),
    })

    await expect(EventService.deleteEvent('event-1')).rejects.toThrow('Event not found')
  })

  it('InvoiceService.deleteCatalogItem throws not-found when soft-delete update affects no rows', async () => {
    const updateMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybeSingle })
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect })

    mockedCreateClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table !== 'line_item_catalog') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          update: vi.fn().mockReturnValue({ eq: updateEq }),
        }
      }),
    })

    await expect(InvoiceService.deleteCatalogItem('catalog-1')).rejects.toThrow('Catalog item not found')
  })

  it('InvoiceService.updateCatalogItem throws not-found when update affects no rows', async () => {
    const updateMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybeSingle })
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect })

    mockedCreateClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table !== 'line_item_catalog') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          update: vi.fn().mockReturnValue({ eq: updateEq }),
        }
      }),
    })

    await expect(
      InvoiceService.updateCatalogItem('catalog-1', { name: 'Updated Item' })
    ).rejects.toThrow('Catalog item not found')
  })
})
