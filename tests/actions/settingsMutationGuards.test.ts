import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn(),
}))

import { checkUserPermission } from '@/app/actions/rbac'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { updateAttachmentCategory } from '@/app/actions/attachmentCategories'
import { updateCustomerLabel } from '@/app/actions/customer-labels'
import { updateSiteSettings } from '@/app/actions/site-settings'
import { deleteApiKey, revokeApiKey } from '@/app/(authenticated)/settings/api-keys/actions'

const mockedPermission = checkUserPermission as unknown as Mock
const mockedCreateClient = createClient as unknown as Mock
const mockedCreateAdminClient = createAdminClient as unknown as Mock

describe('Settings and label mutation guards', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedPermission.mockResolvedValue(true)
  })

  it('returns category-not-found when attachment-category update affects no rows after prefetch', async () => {
    const fetchMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        category_id: 'cat-1',
        category_name: 'VIP',
        email_on_upload: false,
      },
      error: null,
    })
    const fetchEq = vi.fn().mockReturnValue({ maybeSingle: fetchMaybeSingle })

    const updateMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybeSingle })
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect })

    mockedCreateClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table !== 'attachment_categories') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          select: vi.fn().mockReturnValue({ eq: fetchEq }),
          update: vi.fn().mockReturnValue({ eq: updateEq }),
        }
      }),
    })

    const result = await updateAttachmentCategory({
      id: 'cat-1',
      name: 'VIP Guests',
    })

    expect(result).toEqual({ error: 'Category not found' })
  })

  it('returns label-not-found when customer-label update affects no rows after prefetch', async () => {
    mockedCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1', email: 'owner@example.com' } },
        }),
      },
    })

    const fetchMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: 'label-1', name: 'VIP', color: '#FFFFFF' },
      error: null,
    })
    const fetchEq = vi.fn().mockReturnValue({ maybeSingle: fetchMaybeSingle })

    const updateMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybeSingle })
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect })

    mockedCreateAdminClient.mockReturnValue({
      rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
      from: vi.fn((table: string) => {
        if (table !== 'customer_labels') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          select: vi.fn().mockReturnValue({ eq: fetchEq }),
          update: vi.fn().mockReturnValue({ eq: updateEq }),
        }
      }),
    })

    const result = await updateCustomerLabel('label-1', { name: 'Regular' })

    expect(result).toEqual({ error: 'Customer label not found' })
  })

  it('returns api-key-not-found when revoke update affects no rows after prefetch', async () => {
    mockedCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1', email: 'owner@example.com' } },
        }),
      },
    })

    const fetchMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: 'key-1', is_active: true },
      error: null,
    })
    const fetchEq = vi.fn().mockReturnValue({ maybeSingle: fetchMaybeSingle })

    const updateMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybeSingle })
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect })

    mockedCreateAdminClient.mockReturnValue({
      rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
      from: vi.fn((table: string) => {
        if (table !== 'api_keys') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          select: vi.fn().mockReturnValue({ eq: fetchEq }),
          update: vi.fn().mockReturnValue({ eq: updateEq }),
        }
      }),
    })

    const result = await revokeApiKey('key-1')

    expect(result).toEqual({ error: 'API key not found' })
  })

  it('deletes an API key after permission and prefetch checks', async () => {
    mockedCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1', email: 'owner@example.com' } },
        }),
      },
    })

    const fetchMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'key-1',
        name: 'Website',
        description: null,
        permissions: ['read:events'],
        rate_limit: 1000,
        is_active: false,
      },
      error: null,
    })
    const fetchEq = vi.fn().mockReturnValue({ maybeSingle: fetchMaybeSingle })
    const deleteEq = vi.fn().mockResolvedValue({ error: null })
    const deleteFn = vi.fn().mockReturnValue({ eq: deleteEq })

    mockedCreateAdminClient.mockReturnValue({
      rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
      from: vi.fn((table: string) => {
        if (table !== 'api_keys') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          select: vi.fn().mockReturnValue({ eq: fetchEq }),
          delete: deleteFn,
        }
      }),
    })

    const result = await deleteApiKey('key-1')

    expect(result).toEqual({ success: true })
    expect(deleteFn).toHaveBeenCalled()
    expect(deleteEq).toHaveBeenCalledWith('id', 'key-1')
  })

  it('rejects invalid site settings before updating the database', async () => {
    const update = vi.fn()
    mockedCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1', email: 'owner@example.com' } },
        }),
      },
      from: vi.fn(() => ({ update })),
    })

    const formData = new FormData()
    formData.set('id', 'site-1')
    formData.set('name', 'The Anchor')
    formData.set('email', 'not-an-email')
    formData.set('website', 'https://the-anchor.pub')
    formData.set('default_party_size', '2')
    formData.set('booking_duration_mins', '90')
    formData.set('advance_booking_days', '30')
    formData.set('deposit_amount', '-1')
    formData.set('min_group_size_deposit', '7')
    formData.set('currency', 'GBP')
    formData.set('reminder_hours_before', '24')

    const result = await updateSiteSettings(formData)

    expect(result.error).toBeTruthy()
    expect(update).not.toHaveBeenCalled()
  })

  it('updates site settings with validated numeric and email fields', async () => {
    const eq = vi.fn().mockResolvedValue({ error: null })
    const update = vi.fn().mockReturnValue({ eq })
    mockedCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1', email: 'owner@example.com' } },
        }),
      },
      from: vi.fn(() => ({ update })),
    })

    const formData = new FormData()
    formData.set('id', 'site-1')
    formData.set('name', 'The Anchor')
    formData.set('phone', '01234')
    formData.set('email', 'pub@example.com')
    formData.set('website', 'https://the-anchor.pub')
    formData.set('address', 'High Street')
    formData.set('default_party_size', '4')
    formData.set('booking_duration_mins', '120')
    formData.set('advance_booking_days', '90')
    formData.set('deposit_amount', '25.50')
    formData.set('min_group_size_deposit', '8')
    formData.set('currency', 'GBP')
    formData.set('reminder_hours_before', '48')
    formData.set('admin_email', 'manager@example.com')
    formData.set('cc_email', '')

    const result = await updateSiteSettings(formData)

    expect(result).toEqual({ success: true })
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      default_party_size: 4,
      deposit_amount: 25.5,
      min_group_size_deposit: 8,
      admin_email: 'manager@example.com',
      cc_email: null,
    }))
    expect(eq).toHaveBeenCalledWith('id', 'site-1')
  })
})
