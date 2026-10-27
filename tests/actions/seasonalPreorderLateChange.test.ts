import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  checkUserPermission: vi.fn(),
  logAuditEvent: vi.fn(),
  loadPreorderOrder: vi.fn(),
  savePreorderCover: vi.fn(),
  syncPreorderCovers: vi.fn(),
  isPreorderEnabled: vi.fn(),
  getPreorderCutoff: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: mocks.checkUserPermission }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: mocks.logAuditEvent }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'user-1', email: 'staff@example.com' } } }) },
  }),
}))
vi.mock('@/lib/table-bookings/preorder', () => ({
  loadPreorderOrder: mocks.loadPreorderOrder,
  savePreorderCover: mocks.savePreorderCover,
  syncPreorderCovers: mocks.syncPreorderCovers,
  isPreorderEnabled: mocks.isPreorderEnabled,
}))
vi.mock('@/components/features/table-bookings/preorder/cutoff', () => ({ getPreorderCutoff: mocks.getPreorderCutoff }))

import { saveSeasonalPreorderCovers } from '@/components/features/table-bookings/preorder/actions'

/**
 * BK-051, owner decision D21: guests and staff can change Christmas choices until the cutoff; after
 * it a manager can still record a change, flagged as late. Before this the form locked for
 * everyone, while the escalation email told the manager to take the choices by telephone.
 */
describe('saveSeasonalPreorderCovers after the cutoff', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.isPreorderEnabled.mockResolvedValue(true)
    mocks.savePreorderCover.mockResolvedValue({})
    mocks.loadPreorderOrder.mockResolvedValue({
      tableBookingId: 'booking-1',
      bookingReference: 'TB-FIXTURE',
      bookingDate: '2026-11-10',
      requiresPreorder: true,
      hasGuestSeats: true,
      preorderCutoffDays: 7,
      covers: [{ id: 'cover-1', ordinal: 1 }],
    })
    mocks.getPreorderCutoff.mockReturnValue({ closesAt: new Date('2026-11-03T12:00:00.000Z'), closed: true })
  })

  const save = () =>
    saveSeasonalPreorderCovers('booking-1', [{ coverId: 'cover-1', selections: [{ course: 'main', menuItemId: 'dish-1' }] }])

  it('lets a manager record a change, audited as late', async () => {
    mocks.checkUserPermission.mockImplementation(async (_module: string, action: string) => action === 'edit' || action === 'manage')

    const result = await save()

    expect(result).toEqual({ success: true })
    expect(mocks.savePreorderCover).toHaveBeenCalledTimes(1)
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        resource_type: 'table_booking_preorder',
        additional_info: expect.objectContaining({ booking_reference: 'TB-FIXTURE', late_change: true }),
      }),
    )
  })

  it('refuses anyone who is not a manager, and writes nothing', async () => {
    mocks.checkUserPermission.mockImplementation(async (_module: string, action: string) => action === 'edit')

    const result = await save()

    expect(result.error).toMatch(/a manager has to record any change now/)
    expect(mocks.savePreorderCover).not.toHaveBeenCalled()
  })

  it('does not mark a save before the cutoff as late', async () => {
    mocks.getPreorderCutoff.mockReturnValue({ closesAt: new Date('2026-11-03T12:00:00.000Z'), closed: false })
    mocks.checkUserPermission.mockResolvedValue(true)

    await save()

    const auditInfo = mocks.logAuditEvent.mock.calls[0][0].additional_info
    expect(auditInfo.late_change).toBeUndefined()
  })
})
