import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

/**
 * The customer merge actions (BK-164): managers only (customers delete), the preview never writes
 * an audit row, a real merge audits by id with no personal data, and a refusal reads in plain words.
 */

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn() }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { mergeCustomers, previewCustomerMerge } from '@/app/actions/customer-merge'

const KEEP = '0b5a3c1e-0000-4000-8000-00000000000a'
const DUP = '0b5a3c1e-0000-4000-8000-00000000000b'

const mockedPermission = checkUserPermission as unknown as Mock
const mockedAudit = logAuditEvent as unknown as Mock
const mockedCreateClient = createClient as unknown as Mock
const mockedCreateAdminClient = createAdminClient as unknown as Mock

const MERGED = {
  state: 'merged',
  keep_id: KEEP,
  merge_id: DUP,
  moved: { messages: 3, table_bookings: 2 },
  duplicates_dropped: { customer_label_assignments: 1 },
  left_behind: {},
  email_moved: true,
  sms_opted_out: true,
  whatsapp_opted_out: false,
}

describe('customer merge actions', () => {
  let rpc: Mock

  beforeEach(() => {
    vi.clearAllMocks()
    mockedPermission.mockResolvedValue(true)
    mockedCreateClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'manager-1', email: 'manager@example.com' } }, error: null }) },
    })
    rpc = vi.fn(async (_name: string, args: { p_dry_run: boolean }) => ({
      data: { ...MERGED, preview: args.p_dry_run },
      error: null,
    }))
    mockedCreateAdminClient.mockReturnValue({ rpc })
  })

  it('needs customers delete, which managers and super admins hold', async () => {
    mockedPermission.mockResolvedValue(false)

    expect(await mergeCustomers(DUP, KEEP)).toEqual({ error: 'Insufficient permissions' })
    expect(mockedPermission).toHaveBeenCalledWith('customers', 'delete', 'manager-1')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('previews as a dry run and writes no audit row', async () => {
    const result = await previewCustomerMerge(DUP, KEEP)

    expect(rpc).toHaveBeenCalledWith('merge_customers', { p_keep_id: KEEP, p_merge_id: DUP, p_dry_run: true })
    expect(result.success).toBe(true)
    expect(result.data?.preview).toBe(true)
    expect(mockedAudit).not.toHaveBeenCalled()
  })

  it('merges for real and audits both ids and the counts, with no personal data', async () => {
    const result = await mergeCustomers(DUP, KEEP)

    expect(rpc).toHaveBeenCalledWith('merge_customers', { p_keep_id: KEEP, p_merge_id: DUP, p_dry_run: false })
    expect(result.data?.preview).toBe(false)
    expect(mockedAudit).toHaveBeenCalledWith(expect.objectContaining({
      operation_type: 'merge',
      resource_type: 'customer',
      resource_id: KEEP,
      additional_info: expect.objectContaining({ merged_customer_id: DUP, kept_customer_id: KEEP, moved: MERGED.moved }),
    }))
  })

  it('reads a refusal in plain words and audits nothing', async () => {
    rpc.mockResolvedValue({ data: { state: 'blocked', reason: 'both_booked_same_event', count: 1 }, error: null })

    expect(await mergeCustomers(DUP, KEEP)).toEqual({
      error: 'Both records are booked on the same event. Cancel one of those bookings first.',
    })
    expect(mockedAudit).not.toHaveBeenCalled()
  })

  it('says nothing changed when the database refuses', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '23505', message: 'duplicate key' } })

    expect(await mergeCustomers(DUP, KEEP)).toEqual({ error: 'The merge did not go through, and nothing was changed. Try again.' })
  })

  it('refuses anything that is not two customer ids', async () => {
    expect(await mergeCustomers('not-an-id', KEEP)).toEqual({ error: 'Choose a customer to merge into.' })
    expect(rpc).not.toHaveBeenCalled()
  })
})
