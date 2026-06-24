import { describe, expect, it, vi } from 'vitest'
import {
  cancelRecruitmentAppointment,
  previewRecruitmentBookingToken,
} from '../recruitment'

function createBuilder(response: { data: unknown; error: unknown }) {
  const builder: Record<string, ReturnType<typeof vi.fn>> & {
    then?: Promise<{ data: unknown; error: unknown }>['then']
  } = {} as any

  for (const method of ['select', 'eq', 'gt', 'in', 'order', 'limit', 'update']) {
    builder[method] = vi.fn(() => builder)
  }

  builder.maybeSingle = vi.fn(() => Promise.resolve(response))
  builder.then = (resolve, reject) => Promise.resolve(response).then(resolve, reject)
  return builder
}

describe('recruitment booking token lifecycle', () => {
  it('does not return cancelled appointments as the current booking', async () => {
    const applicationBuilder = createBuilder({
      data: {
        id: 'application-1',
        candidate_id: 'candidate-1',
        booking_token_used_at: null,
        booking_token_type: 'interview',
        booking_token_expires_at: '2099-01-01T00:00:00.000Z',
      },
      error: null,
    })
    const appointmentBuilder = createBuilder({ data: null, error: null })
    const slotsBuilder = createBuilder({ data: [], error: null })
    const builders = [applicationBuilder, appointmentBuilder, slotsBuilder]
    const supabase = {
      from: vi.fn(() => {
        const next = builders.shift()
        if (!next) throw new Error('Unexpected query')
        return next
      }),
    }

    const preview = await previewRecruitmentBookingToken('candidate-token', supabase as any)

    expect(preview.valid).toBe(true)
    expect(preview.currentAppointment).toBeNull()
    expect(appointmentBuilder.in).toHaveBeenCalledWith('status', ['scheduled'])
  })

  it('clears booking_token_used_at when a candidate cancels their appointment', async () => {
    const appointmentBuilder = createBuilder({
      data: {
        id: 'appointment-1',
        application_id: 'application-1',
        candidate_id: 'candidate-1',
        slot_id: 'slot-1',
        scheduled_start: '2099-01-01T12:00:00.000Z',
      },
      error: null,
    })
    const appointmentUpdateBuilder = createBuilder({ data: null, error: null })
    const slotUpdateBuilder = createBuilder({ data: null, error: null })
    const applicationUpdateBuilder = createBuilder({ data: null, error: null })
    const builders = [
      appointmentBuilder,
      appointmentUpdateBuilder,
      slotUpdateBuilder,
      applicationUpdateBuilder,
    ]
    const supabase = {
      from: vi.fn(() => {
        const next = builders.shift()
        if (!next) throw new Error('Unexpected query')
        return next
      }),
      rpc: vi.fn().mockResolvedValue({ data: { id: 'application-1' }, error: null }),
    }

    const result = await cancelRecruitmentAppointment('candidate-token', supabase as any)

    expect(result).toMatchObject({
      success: true,
      appointmentId: 'appointment-1',
      applicationId: 'application-1',
      slotId: 'slot-1',
    })
    expect(appointmentUpdateBuilder.update).toHaveBeenCalledWith({ status: 'cancelled' })
    expect(slotUpdateBuilder.update).toHaveBeenCalledWith({ status: 'open' })
    expect(applicationUpdateBuilder.update).toHaveBeenCalledWith({ booking_token_used_at: null })
    expect(applicationUpdateBuilder.eq).toHaveBeenCalledWith('id', 'application-1')
    expect(applicationUpdateBuilder.eq).toHaveBeenCalledWith('booking_token_hash', expect.any(String))
    expect(supabase.rpc).toHaveBeenCalledWith('recruitment_transition_application_status_actor', expect.objectContaining({
      p_application_id: 'application-1',
      p_to_status: 'on_hold',
    }))
  })
})
