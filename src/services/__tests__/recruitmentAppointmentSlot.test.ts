import { describe, expect, it, vi } from 'vitest'
import { createRecruitmentAppointmentSlot, createRecruitmentAppointmentSlots } from '../recruitment'

function createInsertMock() {
  const select = vi.fn().mockResolvedValue({ data: [], error: null })
  const insert = vi.fn((rows: any[]) => {
    select.mockResolvedValueOnce({
      data: rows.map((row, index) => ({
        id: `slot-${index + 1}`,
        status: 'open',
        ...row,
      })),
      error: null,
    })
    return { select }
  })
  const from = vi.fn(() => ({ insert }))

  return { supabase: { from }, from, insert, select }
}

describe('recruitment appointment slots', () => {
  it('rejects slot times outside quarter-hour increments', async () => {
    const supabase = { from: vi.fn() }

    await expect(createRecruitmentAppointmentSlot({
      type: 'interview',
      starts_at: '2099-01-01T10:07:00.000Z',
      ends_at: '2099-01-01T12:00:00.000Z',
      timezone: 'Europe/London',
      location: 'The Anchor',
    }, null, supabase as any)).rejects.toThrow('Appointment slot times must use 00, 15, 30 or 45 minutes.')

    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('splits interview availability into one-hour slots', async () => {
    const { supabase, insert } = createInsertMock()

    const slots = await createRecruitmentAppointmentSlots({
      type: 'interview',
      starts_at: '2099-01-01T12:00:00.000Z',
      ends_at: '2099-01-01T16:00:00.000Z',
      timezone: 'Europe/London',
      location: 'The Anchor',
    }, 'user-1', supabase as any)

    expect(slots).toHaveLength(4)
    expect(insert).toHaveBeenCalledWith([
      expect.objectContaining({ starts_at: '2099-01-01T12:00:00.000Z', ends_at: '2099-01-01T13:00:00.000Z' }),
      expect.objectContaining({ starts_at: '2099-01-01T13:00:00.000Z', ends_at: '2099-01-01T14:00:00.000Z' }),
      expect.objectContaining({ starts_at: '2099-01-01T14:00:00.000Z', ends_at: '2099-01-01T15:00:00.000Z' }),
      expect.objectContaining({ starts_at: '2099-01-01T15:00:00.000Z', ends_at: '2099-01-01T16:00:00.000Z' }),
    ])
  })

  it('rejects interview availability that cannot split into whole hours', async () => {
    const supabase = { from: vi.fn() }

    await expect(createRecruitmentAppointmentSlots({
      type: 'interview',
      starts_at: '2099-01-01T12:00:00.000Z',
      ends_at: '2099-01-01T13:45:00.000Z',
      timezone: 'Europe/London',
      location: 'The Anchor',
    }, null, supabase as any)).rejects.toThrow('Interview availability must be in whole one-hour blocks.')

    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('keeps trial shift availability as one slot', async () => {
    const { supabase, insert } = createInsertMock()

    const slots = await createRecruitmentAppointmentSlots({
      type: 'trial_shift',
      starts_at: '2099-01-01T12:00:00.000Z',
      ends_at: '2099-01-01T16:00:00.000Z',
      timezone: 'Europe/London',
      location: 'The Anchor',
    }, null, supabase as any)

    expect(slots).toHaveLength(1)
    expect(insert).toHaveBeenCalledWith([
      expect.objectContaining({
        starts_at: '2099-01-01T12:00:00.000Z',
        ends_at: '2099-01-01T16:00:00.000Z',
      }),
    ])
  })
})
