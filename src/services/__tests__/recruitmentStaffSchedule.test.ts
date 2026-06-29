import { describe, expect, it, vi } from 'vitest'
import { scheduleRecruitmentAppointmentByStaff } from '../recruitment'

describe('scheduleRecruitmentAppointmentByStaff', () => {
  it('schedules an interview atomically through the staff RPC and returns the appointment id', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 'appointment-1', error: null })
    const supabase = { rpc } as any

    const appointmentId = await scheduleRecruitmentAppointmentByStaff({
      applicationId: 'application-1',
      slotId: 'slot-1',
      appointmentType: 'interview',
      actorUserId: 'user-1',
    }, supabase)

    expect(appointmentId).toBe('appointment-1')
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('recruitment_staff_schedule_appointment', expect.objectContaining({
      p_slot_id: 'slot-1',
      p_application_id: 'application-1',
      p_actor_user_id: 'user-1',
      p_appointment_type: 'interview',
      p_booking_token_hash: expect.any(String),
      p_token_expires_at: expect.any(String),
    }))
  })

  it('passes trial_shift through to the RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 'appointment-2', error: null })
    const supabase = { rpc } as any

    await scheduleRecruitmentAppointmentByStaff({
      applicationId: 'application-1',
      slotId: 'slot-9',
      appointmentType: 'trial_shift',
      actorUserId: 'user-1',
    }, supabase)

    expect(rpc).toHaveBeenCalledWith('recruitment_staff_schedule_appointment', expect.objectContaining({
      p_appointment_type: 'trial_shift',
    }))
  })

  it('does not perform any pre-claim status transition or token write outside the RPC', async () => {
    // The atomic RPC owns the status transition + token write; the service must not
    // touch recruitment_applications directly (the old, non-atomic behaviour).
    const rpc = vi.fn().mockResolvedValue({ data: 'appointment-3', error: null })
    const from = vi.fn(() => { throw new Error('Unexpected direct table access') })
    const supabase = { rpc, from } as any

    await scheduleRecruitmentAppointmentByStaff({
      applicationId: 'application-1',
      slotId: 'slot-1',
      appointmentType: 'interview',
      actorUserId: 'user-1',
    }, supabase)

    expect(from).not.toHaveBeenCalled()
  })

  it('propagates a claim failure from the RPC (so a failed schedule rolls back atomically)', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'Slot is no longer available' } })
    const supabase = { rpc } as any

    await expect(scheduleRecruitmentAppointmentByStaff({
      applicationId: 'application-1',
      slotId: 'slot-1',
      appointmentType: 'interview',
      actorUserId: 'user-1',
    }, supabase)).rejects.toMatchObject({ message: 'Slot is no longer available' })
  })
})
