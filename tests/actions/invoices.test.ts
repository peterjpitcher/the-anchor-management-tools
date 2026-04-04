import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

// ---------------------------------------------------------------------------
// Module mocks — must be declared before imports
// ---------------------------------------------------------------------------

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
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

vi.mock('@/lib/microsoft-graph', () => ({
  isGraphConfigured: vi.fn().mockReturnValue(false),
  sendInvoiceEmail: vi.fn(),
}))

vi.mock('@/lib/errors', () => ({
  getErrorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}))

vi.mock('@/services/invoices', () => ({
  InvoiceService: {
    getInvoices: vi.fn(),
    getInvoiceById: vi.fn(),
    createInvoice: vi.fn(),
    deleteInvoice: vi.fn(),
    updateInvoiceStatus: vi.fn(),
    recordPayment: vi.fn(),
    getInvoiceSummary: vi.fn(),
  },
  CreateInvoiceSchema: {
    parse: vi.fn(),
  },
}))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { checkUserPermission } from '@/app/actions/rbac'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAuditEvent } from '@/app/actions/audit'
import { InvoiceService, CreateInvoiceSchema } from '@/services/invoices'
import {
  getInvoices,
  getInvoice,
  createInvoice,
  deleteInvoice,
  updateInvoiceStatus,
  recordPayment,
} from '@/app/actions/invoices'

const mockedPermission = checkUserPermission as unknown as Mock
const mockedCreateClient = createClient as unknown as Mock
const mockedCreateAdminClient = createAdminClient as unknown as Mock
const mockedLogAuditEvent = logAuditEvent as unknown as Mock

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockSupabaseClient() {
  const client = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'user-1', email: 'staff@example.com' } },
        error: null,
      }),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          is: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    }),
  }
  mockedCreateClient.mockResolvedValue(client)
  return client
}

function buildFormData(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) {
    fd.set(k, v)
  }
  return fd
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Invoice actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // -----------------------------------------------------------------------
  // getInvoices
  // -----------------------------------------------------------------------

  describe('getInvoices', () => {
    it('should return permission error when user lacks invoices view', async () => {
      mockedPermission.mockResolvedValue(false)

      const result = await getInvoices()
      expect(result).toEqual({ error: 'You do not have permission to view invoices' })
    })

    it('should return invoices on success', async () => {
      mockedPermission.mockResolvedValue(true)

      const invoices = [{ id: 'inv-1' }, { id: 'inv-2' }]
      ;(InvoiceService.getInvoices as Mock).mockResolvedValue({ invoices, total: 2 })

      const result = await getInvoices()
      expect(result).toEqual({ invoices, total: 2 })
    })

    it('should return error when service throws', async () => {
      mockedPermission.mockResolvedValue(true)
      ;(InvoiceService.getInvoices as Mock).mockRejectedValue(new Error('DB timeout'))

      const result = await getInvoices()
      expect(result).toEqual({ error: 'DB timeout' })
    })
  })

  // -----------------------------------------------------------------------
  // getInvoice
  // -----------------------------------------------------------------------

  describe('getInvoice', () => {
    it('should return permission error when user lacks invoices view', async () => {
      mockedPermission.mockResolvedValue(false)

      const result = await getInvoice('inv-1')
      expect(result).toEqual({ error: 'You do not have permission to view invoices' })
    })

    it('should return invoice on success', async () => {
      mockedPermission.mockResolvedValue(true)
      const invoice = { id: 'inv-1', invoice_number: 'INV-001' }
      ;(InvoiceService.getInvoiceById as Mock).mockResolvedValue(invoice)

      const result = await getInvoice('inv-1')
      expect(result).toEqual({ invoice })
    })
  })

  // -----------------------------------------------------------------------
  // createInvoice
  // -----------------------------------------------------------------------

  describe('createInvoice', () => {
    it('should return permission error when user lacks invoices create', async () => {
      mockedPermission.mockResolvedValue(false)

      const formData = buildFormData({ vendor_id: 'v1' })
      const result = await createInvoice(formData)
      expect(result).toEqual({ error: 'You do not have permission to create invoices' })
    })

    it('should return error when user is not authenticated', async () => {
      mockedPermission.mockResolvedValue(true)

      const client = mockSupabaseClient()
      client.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: null,
      })

      const formData = buildFormData({ vendor_id: 'v1' })
      const result = await createInvoice(formData)
      expect(result).toEqual({ error: 'Unauthorized' })
    })

    it('should return error when line items are missing', async () => {
      mockedPermission.mockResolvedValue(true)
      mockSupabaseClient()

      ;(CreateInvoiceSchema.parse as Mock).mockReturnValue({
        vendor_id: 'v1',
        invoice_date: '2026-04-01',
        due_date: '2026-04-30',
      })

      const formData = buildFormData({
        vendor_id: 'v1',
        invoice_date: '2026-04-01',
        due_date: '2026-04-30',
      })
      // No line_items field
      const result = await createInvoice(formData)
      expect(result).toEqual({ error: 'Line items are required' })
    })

    it('should create invoice successfully and log audit', async () => {
      mockedPermission.mockResolvedValue(true)
      mockSupabaseClient()

      const invoice = { id: 'inv-new', invoice_number: 'INV-042', vendor_id: 'v1', total_amount: 100 }

      ;(CreateInvoiceSchema.parse as Mock).mockReturnValue({
        vendor_id: 'v1',
        invoice_date: '2026-04-01',
        due_date: '2026-04-30',
        invoice_discount_percentage: 0,
      })
      ;(InvoiceService.createInvoice as Mock).mockResolvedValue(invoice)

      const lineItems = [{ description: 'Service', quantity: 1, unit_price: 100, discount_percentage: 0, vat_rate: 20 }]

      const formData = buildFormData({
        vendor_id: 'v1',
        invoice_date: '2026-04-01',
        due_date: '2026-04-30',
        invoice_discount_percentage: '0',
        line_items: JSON.stringify(lineItems),
      })

      const result = await createInvoice(formData)
      expect(result).toEqual({ success: true, invoice })
      expect(mockedLogAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          operation_type: 'create',
          resource_type: 'invoice',
          resource_id: 'inv-new',
        }),
      )
    })
  })

  // -----------------------------------------------------------------------
  // deleteInvoice
  // -----------------------------------------------------------------------

  describe('deleteInvoice', () => {
    it('should return permission error when user lacks invoices delete', async () => {
      mockedPermission.mockResolvedValue(false)
      mockSupabaseClient()

      const formData = buildFormData({ invoiceId: 'inv-1' })
      const result = await deleteInvoice(formData)
      expect(result).toEqual({ error: 'You do not have permission to delete invoices' })
    })

    it('should return error when invoiceId is missing', async () => {
      mockedPermission.mockResolvedValue(true)
      mockSupabaseClient()

      const formData = buildFormData({})
      const result = await deleteInvoice(formData)
      expect(result).toEqual({ error: 'Invoice ID is required' })
    })

    it('should delete invoice successfully and log audit', async () => {
      mockedPermission.mockResolvedValue(true)
      mockSupabaseClient()

      ;(InvoiceService.deleteInvoice as Mock).mockResolvedValue({ invoice_number: 'INV-042' })

      const formData = buildFormData({ invoiceId: 'inv-1' })
      const result = await deleteInvoice(formData)
      expect(result).toEqual({ success: true })
      expect(mockedLogAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          operation_type: 'delete',
          resource_type: 'invoice',
        }),
      )
    })
  })

  // -----------------------------------------------------------------------
  // updateInvoiceStatus
  // -----------------------------------------------------------------------

  describe('updateInvoiceStatus', () => {
    it('should return permission error when user lacks invoices edit', async () => {
      mockedPermission.mockResolvedValue(false)
      mockSupabaseClient()

      const formData = buildFormData({ invoiceId: 'inv-1', status: 'sent' })
      const result = await updateInvoiceStatus(formData)
      expect(result).toEqual({ error: 'You do not have permission to update invoices' })
    })

    it('should return error when required fields are missing', async () => {
      mockedPermission.mockResolvedValue(true)
      mockSupabaseClient()

      const formData = buildFormData({})
      const result = await updateInvoiceStatus(formData)
      expect(result).toEqual({ error: 'Invoice ID and status are required' })
    })

    it('should reject invalid status value', async () => {
      mockedPermission.mockResolvedValue(true)
      mockSupabaseClient()

      const formData = buildFormData({ invoiceId: 'inv-1', status: 'bogus' })
      const result = await updateInvoiceStatus(formData)
      expect(result).toEqual({ error: 'Invalid status' })
    })

    it('should block payment statuses from this endpoint', async () => {
      mockedPermission.mockResolvedValue(true)
      mockSupabaseClient()

      const formData = buildFormData({ invoiceId: 'inv-1', status: 'paid' })
      const result = await updateInvoiceStatus(formData)
      expect(result).toEqual({ error: 'Payment statuses must be set through the payment recording flow' })
    })

    it('should update status successfully for valid non-payment status', async () => {
      mockedPermission.mockResolvedValue(true)
      const client = mockSupabaseClient()

      ;(InvoiceService.updateInvoiceStatus as Mock).mockResolvedValue({
        updatedInvoice: { invoice_number: 'INV-042' },
        oldStatus: 'draft',
      })

      const formData = buildFormData({ invoiceId: 'inv-1', status: 'sent' })
      const result = await updateInvoiceStatus(formData)
      expect(result).toEqual({ success: true })
    })
  })

  // -----------------------------------------------------------------------
  // recordPayment
  // -----------------------------------------------------------------------

  describe('recordPayment', () => {
    it('should return permission error when user lacks invoices edit', async () => {
      mockedPermission.mockResolvedValue(false)
      mockSupabaseClient()

      const formData = buildFormData({
        invoiceId: 'inv-1',
        paymentDate: '2026-04-01',
        amount: '100',
        paymentMethod: 'bank_transfer',
      })
      const result = await recordPayment(formData)
      expect(result).toEqual({ error: 'You do not have permission to record payments' })
    })

    it('should return error when required fields are missing', async () => {
      mockedPermission.mockResolvedValue(true)
      mockSupabaseClient()

      const formData = buildFormData({})
      const result = await recordPayment(formData)
      expect(result).toEqual({ error: 'Missing required fields' })
    })

    it('should reject zero or negative payment amount', async () => {
      mockedPermission.mockResolvedValue(true)
      mockSupabaseClient()

      const formData = buildFormData({
        invoiceId: 'inv-1',
        paymentDate: '2026-04-01',
        amount: '0',
        paymentMethod: 'bank_transfer',
      })
      const result = await recordPayment(formData)
      expect(result).toEqual({ error: 'Payment amount must be greater than zero' })
    })

    it('should reject invalid payment date', async () => {
      mockedPermission.mockResolvedValue(true)
      mockSupabaseClient()

      const formData = buildFormData({
        invoiceId: 'inv-1',
        paymentDate: 'not-a-date',
        amount: '100',
        paymentMethod: 'bank_transfer',
      })
      const result = await recordPayment(formData)
      expect(result).toEqual({ error: 'Payment date is invalid' })
    })

    it('should record payment successfully', async () => {
      mockedPermission.mockResolvedValue(true)

      const client = mockSupabaseClient()
      // Mock the invoice lookup before and after payment
      client.from = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            is: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { status: 'sent' },
                error: null,
              }),
            }),
          }),
        }),
      })

      const payment = { id: 'pay-1', amount: 100 }
      ;(InvoiceService.recordPayment as Mock).mockResolvedValue(payment)

      const formData = buildFormData({
        invoiceId: 'inv-1',
        paymentDate: '2026-04-01',
        amount: '100',
        paymentMethod: 'bank_transfer',
      })

      const result = await recordPayment(formData)
      expect(result).toHaveProperty('success', true)
      expect(result).toHaveProperty('payment', payment)
      expect(mockedLogAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          operation_type: 'create',
          resource_type: 'invoice_payment',
        }),
      )
    })
  })
})
