import { describe, expect, it, vi } from 'vitest'
import { createRecruitmentAppointmentSlot } from '../recruitment'

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
})
