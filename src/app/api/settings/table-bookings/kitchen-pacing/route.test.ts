import { describe, it, expect, beforeEach, vi } from 'vitest'
import { PATCH } from './route'
import { NextRequest } from 'next/server'
import { requireSettingsManagePermission } from '@/lib/settings/api-auth'
import { AuditService } from '@/services/audit'

vi.mock('@/lib/settings/api-auth', () => ({
  requireSettingsManagePermission: vi.fn(),
}))
vi.mock('@/services/audit', () => ({
  AuditService: { logAuditEvent: vi.fn().mockResolvedValue(undefined) },
}))

const VALID_BODY = {
  enabled: true,
  window_minutes: 30,
  pace_covers_regular: 25,
  pace_covers_sunday: 20,
  walk_in_reserve_regular: 6,
  walk_in_reserve_sunday: 6,
}

const makeRequest = (body: unknown) =>
  new NextRequest('http://localhost/api/settings/table-bookings/kitchen-pacing', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

const createSupabaseMock = (upsertError: unknown = null) => {
  // getKitchenPacingSettings -> .from().select().in() resolves to { data, error }
  const inFn = vi.fn().mockResolvedValue({ data: [], error: null })
  const select = vi.fn().mockReturnValue({ in: inFn })
  // saveKitchenPacingSettings -> .from().upsert() resolves to { error }
  const upsert = vi.fn().mockResolvedValue({ error: upsertError })

  const from = vi.fn().mockImplementation((table: string) => {
    if (table === 'system_settings') {
      return { select, upsert }
    }
    return { select, upsert }
  })

  return { from, _select: select, _in: inFn, _upsert: upsert }
}

const mockAuthSuccess = (dbMock: Record<string, unknown> = {}) => {
  vi.mocked(requireSettingsManagePermission).mockResolvedValueOnce({
    ok: true,
    userId: 'user-1',
    supabase: dbMock as unknown as Awaited<ReturnType<typeof requireSettingsManagePermission>>['supabase'],
  } as unknown as Awaited<ReturnType<typeof requireSettingsManagePermission>>)
}

const mockAuthFail = () => {
  vi.mocked(requireSettingsManagePermission).mockResolvedValueOnce({
    ok: false,
    response: new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }),
  } as unknown as Awaited<ReturnType<typeof requireSettingsManagePermission>>)
}

describe('PATCH /api/settings/table-bookings/kitchen-pacing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 403 when auth fails', async () => {
    mockAuthFail()
    const res = await PATCH(makeRequest(VALID_BODY))
    expect(res.status).toBe(403)
  })

  it('returns 400 for an invalid payload (out-of-range window)', async () => {
    mockAuthSuccess(createSupabaseMock())
    const res = await PATCH(makeRequest({ ...VALID_BODY, window_minutes: 7 }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/window/i)
  })

  it('returns 400 for a malformed pace value', async () => {
    mockAuthSuccess(createSupabaseMock())
    const res = await PATCH(makeRequest({ ...VALID_BODY, pace_covers_regular: 0 }))
    expect(res.status).toBe(400)
  })

  it('returns 200, persists via upsert, and audit-logs on a valid payload', async () => {
    const db = createSupabaseMock()
    mockAuthSuccess(db)

    const res = await PATCH(makeRequest(VALID_BODY))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data).toMatchObject({
      enabled: true,
      window_minutes: 30,
      pace_covers_regular: 25,
      pace_covers_sunday: 20,
      walk_in_reserve_regular: 6,
      walk_in_reserve_sunday: 6,
    })

    expect(db.from).toHaveBeenCalledWith('system_settings')
    expect(db._upsert).toHaveBeenCalledTimes(1)
    expect(AuditService.logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        operation_type: 'update',
        resource_type: 'kitchen_pacing_settings',
        operation_status: 'success',
      })
    )
  })

  it('returns 500 when the upsert fails', async () => {
    mockAuthSuccess(createSupabaseMock({ message: 'db down' }))
    const res = await PATCH(makeRequest(VALID_BODY))
    expect(res.status).toBe(500)
  })
})
