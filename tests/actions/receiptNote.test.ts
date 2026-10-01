import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}))

vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn(),
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn(),
}))

vi.mock('@/lib/audit-helpers', () => ({
  getCurrentUser: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/unified-job-queue', () => ({
  jobQueue: { enqueue: vi.fn().mockResolvedValue({ success: true }) },
}))

import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { getCurrentUser } from '@/lib/audit-helpers'
import { createAdminClient } from '@/lib/supabase/admin'
import { updateReceiptNote } from '@/app/actions/receipts'
import { createFakeDb } from '../helpers/fakeSupabaseDb'

const mockedPermission = checkUserPermission as unknown as Mock
const mockedAudit = logAuditEvent as unknown as Mock
const mockedCurrentUser = getCurrentUser as unknown as Mock
const mockedCreateAdminClient = createAdminClient as unknown as Mock

const USER = { user_id: '22222222-2222-4222-8222-222222222222', user_email: 'user@example.com' }
const TX = '55555555-5555-4555-8555-555555555555'

function arrange() {
  const db = createFakeDb({
    receipt_transactions: [{ id: TX, status: 'completed', notes: null, marked_method: 'receipt_upload' }],
  })
  mockedCreateAdminClient.mockReturnValue(db.client)
  return db
}

describe('updateReceiptNote action', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedPermission.mockResolvedValue(true)
    mockedCurrentUser.mockResolvedValue(USER)
  })

  it('refuses a user who cannot manage receipts, and writes nothing', async () => {
    mockedPermission.mockResolvedValue(false)
    const db = arrange()

    const result = await updateReceiptNote({ transactionId: TX, note: 'hello' })

    expect(result).toEqual({ error: 'Insufficient permissions' })
    expect(mockedPermission).toHaveBeenCalledWith('receipts', 'manage')
    expect(db.writes).toHaveLength(0)
    expect(mockedAudit).not.toHaveBeenCalled()
  })

  it('refuses when nobody is signed in', async () => {
    mockedCurrentUser.mockResolvedValue({ user_id: null, user_email: null })
    arrange()

    await expect(updateReceiptNote({ transactionId: TX, note: 'hello' })).rejects.toThrow('Unauthorized')
  })

  it('saves the note and audits it with the user who saved it', async () => {
    const db = arrange()

    const result = await updateReceiptNote({ transactionId: TX, note: 'Chased supplier' })

    expect(result.success).toBe(true)
    expect(db.rows('receipt_transactions')[0]).toMatchObject({
      notes: 'Chased supplier',
      status: 'completed',
      marked_method: 'receipt_upload',
    })
    expect(mockedAudit).toHaveBeenCalledTimes(1)
    expect(mockedAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: USER.user_id,
        user_email: USER.user_email,
        operation_type: 'update_note',
        resource_type: 'receipt_transaction',
        resource_id: TX,
        operation_status: 'success',
      })
    )
  })

  it('does not audit a save that failed', async () => {
    const db = arrange()
    db.failNext({ table: 'receipt_transactions', operation: 'update', message: 'write refused' })

    const result = await updateReceiptNote({ transactionId: TX, note: 'hello' })

    expect(result).toEqual({ error: 'Failed to save the note.' })
    expect(mockedAudit).not.toHaveBeenCalled()
  })
})
