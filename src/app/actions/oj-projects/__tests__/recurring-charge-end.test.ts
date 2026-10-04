import { beforeEach, describe, expect, it, vi } from 'vitest'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { endRecurringCharge, previewEndRecurringCharge, type EndChargePreview } from '../recurring-charges'

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn() }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn() }))

const id = '00000000-0000-4000-8000-000000000001'
const date = '2026-10-04'
const preview: EndChargePreview = { chargeId: id, endDate: date, preview: true, items: [], totalExVat: 0, totalIncVat: 0 }
const rpc = vi.fn()
const getUser = vi.fn()

describe('ending recurring charges', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    rpc.mockResolvedValue({ data: preview, error: null })
    vi.mocked(checkUserPermission).mockResolvedValue(true)
    vi.mocked(createClient).mockResolvedValue({ auth: { getUser }, rpc } as unknown as Awaited<ReturnType<typeof createClient>>)
  })

  it('previews through the database without mutation or revalidation', async () => {
    expect(await previewEndRecurringCharge(id, date)).toEqual({ preview })
    expect(rpc).toHaveBeenCalledWith('oj_end_recurring_charge', { p_charge_id: id, p_end_date: date, p_preview: true, p_expected: null })
    expect(checkUserPermission).toHaveBeenCalledWith('oj_projects', 'edit')
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('confirms the exact preview and revalidates after database success', async () => {
    const confirmed = { ...preview, preview: false }
    rpc.mockResolvedValue({ data: confirmed, error: null })
    expect(await endRecurringCharge(id, date, preview)).toEqual({ preview: confirmed })
    expect(rpc).toHaveBeenCalledWith('oj_end_recurring_charge', { p_charge_id: id, p_end_date: date, p_preview: false, p_expected: preview })
    expect(revalidatePath).toHaveBeenCalledExactlyOnceWith('/oj-projects/clients')
  })

  it('rejects unsigned users before permissions or RPC', async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    expect(await previewEndRecurringCharge(id, date)).toEqual({ error: 'Unauthorized' })
    expect(checkUserPermission).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('rejects users without edit permission', async () => {
    vi.mocked(checkUserPermission).mockResolvedValue(false)
    expect(await endRecurringCharge(id, date, preview)).toEqual({ error: 'You do not have permission to end recurring charges' })
    expect(rpc).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it.each([['invalid', date], [id, '2026-02-30'], [id, '04/10/2026']])('rejects invalid input %s %s before database access', async (chargeId, endDate) => {
    expect(await previewEndRecurringCharge(chargeId, endDate)).toHaveProperty('error')
    expect(createClient).not.toHaveBeenCalled()
  })

  it('reports an unapplied database update without claiming a change', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'function unavailable' } })
    expect(await endRecurringCharge(id, date, preview)).toEqual({ error: 'End charge is awaiting its database update. No charge has been changed.' })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('surfaces database conflicts and requires no revalidation', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'Charge changed since preview' } })
    expect(await endRecurringCharge(id, date, preview)).toEqual({ error: 'Charge changed since preview' })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('rejects absent database results', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    expect(await endRecurringCharge(id, date, preview)).toEqual({ error: 'No final charge preview returned' })
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})
