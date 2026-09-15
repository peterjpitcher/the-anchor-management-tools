import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({}),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn(),
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/services/vendors', () => ({
  VendorService: {
    createVendor: vi.fn(),
    updateVendor: vi.fn(),
  },
}))

import { createVendor, updateVendor } from '@/app/actions/vendors'
import { logAuditEvent } from '@/app/actions/audit'
import { checkUserPermission } from '@/app/actions/rbac'
import { VendorService } from '@/services/vendors'

function vendorForm(fields: Record<string, string> = {}): FormData {
  const formData = new FormData()
  formData.set('name', 'Example Vendor Limited')
  formData.set('payment_terms', '7')

  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value)
  }

  return formData
}

function savedVendor(paypalPaymentsEnabled: boolean) {
  return {
    id: 'vendor-1',
    name: 'Example Vendor Limited',
    paypal_payments_enabled: paypalPaymentsEnabled,
  }
}

describe('vendor PayPal setting actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(checkUserPermission).mockResolvedValue(true)
  })

  it('fails closed when a create caller omits the setting', async () => {
    vi.mocked(VendorService.createVendor).mockResolvedValue(savedVendor(false) as never)

    const result = await createVendor(vendorForm())

    expect(result.error).toBeUndefined()
    expect(VendorService.createVendor).toHaveBeenCalledWith(
      expect.objectContaining({ paypal_payments_enabled: false }),
    )
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        new_values: expect.objectContaining({ paypal_payments_enabled: false }),
      }),
    )
  })

  it('creates a vendor with PayPal enabled only for an explicit true value', async () => {
    vi.mocked(VendorService.createVendor).mockResolvedValue(savedVendor(true) as never)

    await createVendor(vendorForm({ paypal_payments_enabled: 'true' }))

    expect(VendorService.createVendor).toHaveBeenCalledWith(
      expect.objectContaining({ paypal_payments_enabled: true }),
    )
  })

  it('updates and audits an enabled PayPal setting', async () => {
    vi.mocked(VendorService.updateVendor).mockResolvedValue(savedVendor(true) as never)

    await updateVendor(vendorForm({
      vendorId: 'vendor-1',
      paypal_payments_enabled: 'true',
    }))

    expect(VendorService.updateVendor).toHaveBeenCalledWith(
      'vendor-1',
      expect.objectContaining({ paypal_payments_enabled: true }),
    )
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        new_values: expect.objectContaining({ paypal_payments_enabled: true }),
      }),
    )
  })

  it('does not treat the string false as enabled', async () => {
    vi.mocked(VendorService.updateVendor).mockResolvedValue(savedVendor(false) as never)

    await updateVendor(vendorForm({
      vendorId: 'vendor-1',
      paypal_payments_enabled: 'false',
    }))

    expect(VendorService.updateVendor).toHaveBeenCalledWith(
      'vendor-1',
      expect.objectContaining({ paypal_payments_enabled: false }),
    )
  })
})
