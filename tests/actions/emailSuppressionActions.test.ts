/**
 * Staff clearing a block on an address.
 *
 * Before this existed nothing anywhere removed a row from `email_suppressions`, so every
 * address that ever bounced was blocked for good. The two halves of the block live in
 * different tables, and clearing one without the other leaves the guest unreachable while
 * the screen says the block has gone.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const getUser = vi.hoisted(() => vi.fn())
const createClient = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase/server', () => ({ createClient }))

const createAdminClient = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }))

const checkUserPermission = vi.hoisted(() => vi.fn())
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission }))

const logAuditEvent = vi.hoisted(() => vi.fn())
vi.mock('@/app/actions/audit', () => ({ logAuditEvent }))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

function buildAdmin(options: {
  customer: Record<string, unknown> | null
  suppression?: { reason: string } | null
}) {
  const suppressionDeleteEq = vi.fn().mockResolvedValue({ error: null })
  const customerUpdateEq = vi.fn().mockResolvedValue({ error: null })
  const customerUpdate = vi.fn().mockReturnValue({ eq: customerUpdateEq })

  createAdminClient.mockReturnValue({
    from: vi.fn((table: string) => {
      if (table === 'customers') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: options.customer, error: null }),
            }),
          }),
          update: customerUpdate,
        }
      }
      if (table === 'email_suppressions') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: options.suppression ?? null, error: null }),
            }),
          }),
          delete: vi.fn().mockReturnValue({ eq: suppressionDeleteEq }),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    }),
  })

  return { suppressionDeleteEq, customerUpdate }
}

describe('customer email block actions', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    getUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'staff@example.com' } } })
    createClient.mockResolvedValue({ auth: { getUser } })
    checkUserPermission.mockResolvedValue(true)
  })

  it('reports the suppression and the deactivation together', async () => {
    buildAdmin({
      customer: {
        email: 'Guest@Example.com',
        email_status: 'bounced',
        email_deactivated_at: '2026-06-01T10:00:00.000Z',
        email_delivery_failures: 3,
        last_email_failure_reason: 'Mailbox unavailable',
        marketing_email_opt_in: true,
        marketing_email_opted_out_at: null,
      },
      suppression: { reason: 'bounce' },
    })

    const { getCustomerEmailBlock } = await import('@/app/actions/emailSuppressionActions')
    const result = await getCustomerEmailBlock('customer-1')

    expect(result.block).toMatchObject({
      suppressed: true,
      suppressionReason: 'bounce',
      emailStatus: 'bounced',
      deactivatedAt: '2026-06-01T10:00:00.000Z',
      deliveryFailures: 3,
      marketingOptIn: true,
    })
  })

  it('reports an unsubscribed guest as unsubscribed', async () => {
    buildAdmin({
      customer: {
        email: 'guest@example.com',
        email_status: 'valid',
        email_deactivated_at: null,
        email_delivery_failures: 0,
        last_email_failure_reason: null,
        marketing_email_opt_in: false,
        marketing_email_opted_out_at: '2026-08-01T10:00:00.000Z',
      },
      suppression: null,
    })

    const { getCustomerEmailBlock } = await import('@/app/actions/emailSuppressionActions')
    const result = await getCustomerEmailBlock('customer-1')

    expect(result.block).toMatchObject({
      suppressed: false,
      marketingOptIn: false,
      marketingOptedOutAt: '2026-08-01T10:00:00.000Z',
    })
  })

  it('clears both halves of the block', async () => {
    const admin = buildAdmin({
      customer: {
        email: 'Guest@Example.com',
        email_status: 'bounced',
        email_deactivated_at: '2026-06-01T10:00:00.000Z',
      },
    })

    const { clearCustomerEmailBlock } = await import('@/app/actions/emailSuppressionActions')
    const result = await clearCustomerEmailBlock('customer-1')

    expect(result).toEqual({ success: true })
    // Matched on the lower-cased address, the way the suppression table stores it.
    expect(admin.suppressionDeleteEq).toHaveBeenCalledWith('email', 'guest@example.com')
    expect(admin.customerUpdate).toHaveBeenCalledWith({
      email_status: 'unknown',
      email_deactivated_at: null,
      email_delivery_failures: 0,
      last_email_failure_reason: null,
    })
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ operation_status: 'success', resource_type: 'customer_email_block' })
    )
  })

  it('leaves marketing consent alone, so an unsubscribe survives the clear', async () => {
    const admin = buildAdmin({
      customer: { email: 'guest@example.com', email_status: 'bounced', email_deactivated_at: null },
    })

    const { clearCustomerEmailBlock } = await import('@/app/actions/emailSuppressionActions')
    await clearCustomerEmailBlock('customer-1')

    const payload = admin.customerUpdate.mock.calls[0][0]
    expect(payload).not.toHaveProperty('marketing_email_opt_in')
    expect(payload).not.toHaveProperty('marketing_email_opted_out_at')
  })

  it('refuses without the contact preferences permission, and says so on the record', async () => {
    buildAdmin({ customer: { email: 'guest@example.com' } })
    checkUserPermission.mockResolvedValue(false)

    const { clearCustomerEmailBlock } = await import('@/app/actions/emailSuppressionActions')
    const result = await clearCustomerEmailBlock('customer-1')

    expect(result.error).toBe('Insufficient permissions to update contact preferences')
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ operation_status: 'failure', error_message: 'Insufficient permissions' })
    )
  })

  it('refuses to read without the view permission', async () => {
    buildAdmin({ customer: { email: 'guest@example.com' } })
    checkUserPermission.mockResolvedValue(false)

    const { getCustomerEmailBlock } = await import('@/app/actions/emailSuppressionActions')
    const result = await getCustomerEmailBlock('customer-1')

    expect(result.error).toBe('Insufficient permissions to view contact preferences')
    expect(result.block).toBeUndefined()
  })
})
