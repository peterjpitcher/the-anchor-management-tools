import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn(),
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn(),
}))

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { createOJClient, deleteOJClient, updateOJClient } from '@/app/actions/oj-projects/clients'
import { upsertVendorBillingSettings } from '@/app/actions/oj-projects/vendor-settings'

const mockedCreateClient = vi.mocked(createClient)
const mockedPermission = vi.mocked(checkUserPermission)
const mockedAudit = vi.mocked(logAuditEvent)
const mockedRevalidatePath = vi.mocked(revalidatePath)

function form(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [key, value] of Object.entries(fields)) fd.set(key, value)
  return fd
}

const user = { id: 'user-1', email: 'manager@test.com' }

describe('OJ client CRUD actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedPermission.mockResolvedValue(true)
    mockedAudit.mockResolvedValue(undefined)
  })

  it('creates a client with OJ permission, audit and revalidation', async () => {
    const insert = vi.fn((payload) => ({
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({
          data: { id: '550e8400-e29b-41d4-a716-446655440000', ...payload },
          error: null,
        }),
      })),
    }))

    mockedCreateClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
      from: vi.fn((table: string) => {
        expect(table).toBe('invoice_vendors')
        return { insert }
      }),
    } as any)

    const result = await createOJClient(form({
      name: 'Acme Ltd',
      email: 'accounts@acme.test',
      payment_terms: '14',
    }))

    expect(result.success).toBe(true)
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Acme Ltd',
      email: 'accounts@acme.test',
      payment_terms: 14,
      is_active: true,
    }))
    expect(mockedAudit).toHaveBeenCalledWith(expect.objectContaining({
      operation_type: 'create',
      resource_type: 'oj_client',
    }))
    expect(mockedRevalidatePath).toHaveBeenCalledWith('/oj-projects/clients')
  })

  it('updates a client and records old and new values', async () => {
    const before = { id: '550e8400-e29b-41d4-a716-446655440000', name: 'Old Name' }
    const update = vi.fn((payload) => ({
      eq: vi.fn(() => ({
        select: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: before.id, ...payload },
            error: null,
          }),
        })),
      })),
    }))
    const select = vi.fn(() => ({
      eq: vi.fn(() => ({
        maybeSingle: vi.fn().mockResolvedValue({ data: before, error: null }),
      })),
    }))

    mockedCreateClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
      from: vi.fn(() => ({ select, update })),
    } as any)

    const result = await updateOJClient(form({
      id: before.id,
      name: 'New Name',
      payment_terms: '30',
    }))

    expect(result.success).toBe(true)
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ name: 'New Name' }))
    expect(mockedAudit).toHaveBeenCalledWith(expect.objectContaining({
      operation_type: 'update',
      old_values: before,
      new_values: expect.objectContaining({ name: 'New Name' }),
    }))
  })

  it('deactivates clients with linked projects instead of hard deleting', async () => {
    const update = vi.fn(() => ({
      eq: vi.fn(() => ({
        select: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: '550e8400-e29b-41d4-a716-446655440000', name: 'Acme Ltd' },
            error: null,
          }),
        })),
      })),
    }))

    mockedCreateClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
      from: vi.fn((table: string) => {
        if (table === 'oj_projects') {
          return { select: vi.fn(() => ({ eq: vi.fn(() => ({ limit: vi.fn().mockResolvedValue({ data: [{ id: 'project-1' }], error: null }) })) })) }
        }
        if (table === 'invoices') {
          return { select: vi.fn(() => ({ eq: vi.fn(() => ({ is: vi.fn(() => ({ limit: vi.fn().mockResolvedValue({ data: [], error: null }) })) })) })) }
        }
        return { update }
      }),
    } as any)

    const result = await deleteOJClient(form({ id: '550e8400-e29b-41d4-a716-446655440000' }))

    expect(result).toMatchObject({ success: true, action: 'deactivate' })
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ is_active: false }))
    expect(mockedAudit).toHaveBeenCalledWith(expect.objectContaining({
      operation_type: 'deactivate',
      resource_type: 'oj_client',
    }))
  })
})

describe('OJ vendor billing settings action', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedPermission.mockResolvedValue(true)
    mockedAudit.mockResolvedValue(undefined)
  })

  it('audits and revalidates billing settings updates', async () => {
    const before = {
      vendor_id: '550e8400-e29b-41d4-a716-446655440000',
      billing_mode: 'full',
      hourly_rate_ex_vat: 75,
    }
    const saved = {
      ...before,
      billing_mode: 'cap',
      monthly_cap_inc_vat: 600,
      vat_rate: 20,
      mileage_rate: 0.55,
      retainer_included_hours_per_month: 8,
      statement_mode: true,
    }
    const upsert = vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({ data: saved, error: null }),
      })),
    }))
    const select = vi.fn(() => ({
      eq: vi.fn(() => ({
        maybeSingle: vi.fn().mockResolvedValue({ data: before, error: null }),
      })),
    }))

    mockedCreateClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
      from: vi.fn((table: string) => {
        expect(table).toBe('oj_vendor_billing_settings')
        return { select, upsert }
      }),
    } as any)

    const result = await upsertVendorBillingSettings(form({
      vendor_id: '550e8400-e29b-41d4-a716-446655440000',
      billing_mode: 'cap',
      monthly_cap_inc_vat: '600',
      hourly_rate_ex_vat: '90',
      vat_rate: '20',
      mileage_rate: '0.55',
      retainer_included_hours_per_month: '8',
      statement_mode: 'true',
    }))

    expect(result.success).toBe(true)
    expect(upsert).toHaveBeenCalled()
    expect(mockedAudit).toHaveBeenCalledWith(expect.objectContaining({
      operation_type: 'update',
      resource_type: 'oj_vendor_billing_settings',
      old_values: before,
      new_values: saved,
    }))
    expect(mockedRevalidatePath).toHaveBeenCalledWith('/oj-projects/entries')
  })
})
