import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock all external dependencies before imports
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))
vi.mock('@/services/permission', () => ({
  PermissionService: {
    checkUserPermission: vi.fn(),
  },
}))
vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn(),
}))
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}))
vi.mock('@/services/cashing-up.service', () => ({
  CashingUpService: {},
}))

import { createClient } from '@/lib/supabase/server'
import { PermissionService } from '@/services/permission'
import { logAuditEvent } from '@/app/actions/audit'

type MaybeSingleResult = { data: unknown; error: unknown }

function createSupabaseMock(
  fetchResult: MaybeSingleResult,
  updateResult: MaybeSingleResult = { data: { id: 'session-1' }, error: null }
) {
  let maybeSingleCall = 0
  const chain: Record<string, ReturnType<typeof vi.fn>> = {}
  for (const method of ['select', 'update', 'eq', 'is']) {
    chain[method] = vi.fn().mockReturnValue(chain)
  }
  chain.maybeSingle = vi.fn().mockImplementation(() => {
    maybeSingleCall += 1
    return Promise.resolve(maybeSingleCall === 1 ? fetchResult : updateResult)
  })

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }),
    },
    from: vi.fn().mockReturnValue(chain),
    chain,
  }
}

describe('voidCashupSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(PermissionService.checkUserPermission).mockResolvedValue(true)
  })

  it('should reject when the user is not authenticated', async () => {
    const supabase = createSupabaseMock({ data: null, error: null })
    supabase.auth.getUser = vi.fn().mockResolvedValue({ data: { user: null } })
    vi.mocked(createClient).mockResolvedValue(supabase as never)

    const { voidCashupSession } = await import('../cashing-up')
    const result = await voidCashupSession({ sessionId: 'session-1', reason: 'entered twice' })

    expect(result).toEqual({ success: false, error: 'Unauthorized' })
  })

  it('should reject when the user lacks cashing_up manage permission', async () => {
    vi.mocked(PermissionService.checkUserPermission).mockResolvedValue(false)
    const supabase = createSupabaseMock({ data: null, error: null })
    vi.mocked(createClient).mockResolvedValue(supabase as never)

    const { voidCashupSession } = await import('../cashing-up')
    const result = await voidCashupSession({ sessionId: 'session-1', reason: 'entered twice' })

    expect(result).toEqual({ success: false, error: 'Forbidden' })
  })

  it('should require a non-empty reason', async () => {
    const supabase = createSupabaseMock({ data: null, error: null })
    vi.mocked(createClient).mockResolvedValue(supabase as never)

    const { voidCashupSession } = await import('../cashing-up')
    const result = await voidCashupSession({ sessionId: 'session-1', reason: '   ' })

    expect(result.success).toBe(false)
    expect(result.error).toContain('reason')
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('should error when the session does not exist', async () => {
    const supabase = createSupabaseMock({ data: null, error: null })
    vi.mocked(createClient).mockResolvedValue(supabase as never)

    const { voidCashupSession } = await import('../cashing-up')
    const result = await voidCashupSession({ sessionId: 'missing', reason: 'entered twice' })

    expect(result).toEqual({ success: false, error: 'Session not found' })
  })

  it('should error when the session is already voided', async () => {
    const supabase = createSupabaseMock({
      data: { id: 'session-1', status: 'draft', voided_at: '2026-07-01T00:00:00Z' },
      error: null,
    })
    vi.mocked(createClient).mockResolvedValue(supabase as never)

    const { voidCashupSession } = await import('../cashing-up')
    const result = await voidCashupSession({ sessionId: 'session-1', reason: 'entered twice' })

    expect(result).toEqual({ success: false, error: 'Session is already voided' })
  })

  it('should block voiding an approved session without approve permission', async () => {
    vi.mocked(PermissionService.checkUserPermission).mockImplementation(
      async (_module: string, action: string) => action !== 'approve'
    )
    const supabase = createSupabaseMock({
      data: { id: 'session-1', status: 'approved', voided_at: null },
      error: null,
    })
    vi.mocked(createClient).mockResolvedValue(supabase as never)

    const { voidCashupSession } = await import('../cashing-up')
    const result = await voidCashupSession({ sessionId: 'session-1', reason: 'entered twice' })

    expect(result.success).toBe(false)
    expect(result.error).toContain('approve')
  })

  it('should block voiding a locked session without unlock permission', async () => {
    vi.mocked(PermissionService.checkUserPermission).mockImplementation(
      async (_module: string, action: string) => action !== 'unlock'
    )
    const supabase = createSupabaseMock({
      data: { id: 'session-1', status: 'locked', voided_at: null },
      error: null,
    })
    vi.mocked(createClient).mockResolvedValue(supabase as never)

    const { voidCashupSession } = await import('../cashing-up')
    const result = await voidCashupSession({ sessionId: 'session-1', reason: 'entered twice' })

    expect(result.success).toBe(false)
    expect(result.error).toContain('unlock')
  })

  it('should void a draft session, stamp void fields and log an audit event', async () => {
    const supabase = createSupabaseMock({
      data: { id: 'session-1', status: 'draft', voided_at: null },
      error: null,
    })
    vi.mocked(createClient).mockResolvedValue(supabase as never)

    const { voidCashupSession } = await import('../cashing-up')
    const result = await voidCashupSession({ sessionId: 'session-1', reason: '  entered twice  ' })

    expect(result).toEqual({ success: true })
    expect(supabase.chain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        voided_by: 'user-1',
        void_reason: 'entered twice',
        voided_at: expect.any(String),
      })
    )
    // Concurrency guard: only rows not already voided may be updated
    expect(supabase.chain.is).toHaveBeenCalledWith('voided_at', null)
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        operation_type: 'void',
        resource_type: 'cashup_session',
        resource_id: 'session-1',
        operation_status: 'success',
      })
    )
  })
})
