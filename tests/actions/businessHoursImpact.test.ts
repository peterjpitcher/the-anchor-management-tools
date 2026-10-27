import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Review BK-076: after the hours change, the save returns the bookings the new hours leave out, for
 * the manager to check, and marking them as checked goes on the audit log.
 */

const state = vi.hoisted(() => ({ allowed: true }))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'user-1', email: 'manager@example.com' } } })) },
  })),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    rpc: vi.fn(async () => ({ data: state.allowed, error: null })),
    from: vi.fn(() => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { effective_from: '2027-01-04' }, error: null }) }) }),
    })),
  })),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn(async () => undefined) }))
vi.mock('@/services/business-hours', () => ({
  BusinessHoursService: {
    createSpecialHours: vi.fn(async () => ({ data: [{ id: 'sh-1' }], datesToCreate: ['2026-12-26', '2026-12-24', '2026-12-25'] })),
    updateSpecialHours: vi.fn(async () => ({ updated: { id: 'sh-1', date: '2026-12-25' }, oldData: { id: 'sh-1', date: '2026-12-25' } })),
    deleteSpecialHours: vi.fn(async () => ({ id: 'sh-1', date: '2026-12-31' })),
    updateBusinessHours: vi.fn(async () => ({ updatedCount: 7 })),
  },
}))
vi.mock('@/services/hours-impact', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/hours-impact')>()),
  checkHoursImpact: vi.fn(),
}))

import {
  acknowledgeHoursImpact,
  createSpecialHours,
  deleteSpecialHours,
  publishHoursVersion,
  updateBusinessHours,
} from '@/app/actions/business-hours'
import { checkHoursImpact } from '@/services/hours-impact'
import { logAuditEvent } from '@/app/actions/audit'

const IMPACT = {
  from: '2026-12-24',
  to: '2026-12-26',
  items: [{ kind: 'table_booking' as const, id: 'tb-1', reference: 'TB-1', label: 'Ann Diner', date: '2026-12-25', time: '13:00', guests: 6, reason: 'closed' as const }],
}

beforeEach(() => {
  vi.clearAllMocks()
  state.allowed = true
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-12-01T10:00:00.000Z'))
  vi.mocked(checkHoursImpact).mockResolvedValue({ impact: IMPACT })
})

describe('saving hours returns the bookings they leave out', () => {
  it('checks the dates special hours were set for', async () => {
    const result = await createSpecialHours(new FormData())

    expect(checkHoursImpact).toHaveBeenCalledWith('2026-12-24', '2026-12-26')
    expect(result).toMatchObject({ success: true, hoursImpact: IMPACT })
  })

  it('checks the date that goes back to its weekly hours when an exception is removed', async () => {
    await deleteSpecialHours('sh-1')
    expect(checkHoursImpact).toHaveBeenCalledWith('2026-12-31', '2026-12-31')
  })

  it('checks a year ahead after a weekly change, from a published schedule\'s own start', async () => {
    await updateBusinessHours(new FormData())
    expect(checkHoursImpact).toHaveBeenLastCalledWith('2026-12-01', '2027-12-01')

    await publishHoursVersion('version-1')
    expect(checkHoursImpact).toHaveBeenLastCalledWith('2027-01-04', '2028-01-04')
  })

  it('still reports the save when the check could not run', async () => {
    vi.mocked(checkHoursImpact).mockResolvedValue({ impactError: 'The hours were saved, but the bookings already taken could not be checked against them. Check the diary for these dates.' })
    const result = await createSpecialHours(new FormData())
    expect(result).toMatchObject({ success: true, hoursImpactError: expect.stringContaining('could not be checked') })
  })
})

describe('marking the list as checked', () => {
  it('records the bookings checked on the audit log', async () => {
    const result = await acknowledgeHoursImpact({
      from: IMPACT.from,
      to: IMPACT.to,
      items: IMPACT.items.map((item) => ({ kind: item.kind, id: item.id, date: item.date, reason: item.reason })),
    })

    expect(result).toEqual({ success: true })
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      resource_id: 'business_hours_impact',
      additional_info: expect.objectContaining({
        action: 'hours_change_bookings_checked', count: 1,
        items: [{ kind: 'table_booking', id: 'tb-1', date: '2026-12-25', reason: 'closed' }],
      }),
    }))
  })

  it('needs settings permission, and a real list', async () => {
    expect(await acknowledgeHoursImpact({ from: 'x', to: '2026-12-26', items: [] })).toEqual({ error: 'Nothing was recorded: the list was not valid.' })
    state.allowed = false
    expect(await acknowledgeHoursImpact({ from: IMPACT.from, to: IMPACT.to, items: [] })).toEqual({ error: 'Insufficient permissions to manage business hours' })
    expect(logAuditEvent).not.toHaveBeenCalled()
  })
})
