import { NextRequest } from 'next/server'
import { createApiResponse, createErrorResponse } from '@/lib/api/auth'
import {
  claimRecruitmentAppointmentSlot,
  formatRecruitmentAppointmentTime,
  previewRecruitmentBookingToken,
} from '@/services/recruitment'
import {
  generateRecruitmentAppointmentIcs,
  loadRecruitmentAppointment,
  syncRecruitmentAppointmentCalendar,
} from '@/lib/recruitment/calendar'
import {
  describeRecruitmentAppointmentCandidate,
  sendRecruitmentManagerAlert,
  sendRecruitmentTemplateEmail,
} from '@/lib/recruitment/communications'
import { guardPublicRecruitmentRequest } from '@/lib/recruitment/public-security'

type RouteContext = {
  params: Promise<{ token: string }>
}

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { token } = await context.params
    const guard = await guardPublicRecruitmentRequest(_request, token, {
      scope: 'recruitment-booking-preview',
      maxAttempts: 30,
    })
    if (guard) return guard

    const preview = await previewRecruitmentBookingToken(token)
    if (!preview.valid || !preview.application) {
      return createErrorResponse('Booking link is invalid or expired', 'BOOKING_TOKEN_INVALID', 404)
    }

    return createApiResponse({
      application: {
        id: preview.application.id,
        role_title: preview.application.job_posting?.title ?? 'The Anchor',
        appointment_type: preview.application.booking_token_type,
        candidate_first_name: preview.application.candidate?.first_name ?? null,
      },
      already_booked: preview.alreadyBooked,
      current_appointment: preview.currentAppointment,
      slots: preview.slots.map((slot: any) => ({
        id: slot.id,
        starts_at: slot.starts_at,
        ends_at: slot.ends_at,
        timezone: slot.timezone,
        location: slot.location,
      })),
    })
  } catch (error) {
    console.error('Recruitment booking preview failed', error)
    return createErrorResponse('Failed to load booking options', 'BOOKING_PREVIEW_FAILED', 500)
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { token } = await context.params
    const body = await request.json().catch(() => null) as { slot_id?: string; turnstile_token?: string } | null
    const guard = await guardPublicRecruitmentRequest(request, token, {
      scope: 'recruitment-booking-claim',
      requireTurnstile: true,
      turnstileToken: body?.turnstile_token ?? null,
    })
    if (guard) return guard

    const slotId = body?.slot_id
    if (!slotId) {
      return createErrorResponse('Slot ID is required', 'VALIDATION_ERROR', 400)
    }

    const appointmentId = await claimRecruitmentAppointmentSlot(token, slotId)
    const appointment = await loadRecruitmentAppointment(appointmentId)
    const ics = generateRecruitmentAppointmentIcs(appointment)

    const [calendarResult, emailResult] = await Promise.allSettled([
      syncRecruitmentAppointmentCalendar(appointmentId),
      sendRecruitmentTemplateEmail(
        appointment.application_id,
        appointment.type === 'trial_shift' ? 'trial_confirmation' : 'interview_confirmation',
        {
          appointmentId,
          attachments: [{
            name: 'the-anchor-recruitment.ics',
            content: Buffer.from(ics),
            contentType: 'text/calendar; charset=utf-8; method=REQUEST',
          }],
        }
      ),
      sendRecruitmentManagerAlert({
        applicationId: appointment.application_id,
        candidateId: appointment.candidate_id,
        alertType: appointment.type === 'trial_shift' ? 'trial booked' : 'interview booked',
        alertBody: `${describeRecruitmentAppointmentCandidate(appointment)} — ${appointmentSubjectLabel(appointment.type)} booked for ${formatRecruitmentAppointmentTime(appointment)} at ${appointment.location}. Booked by the candidate.`,
      }),
    ])

    return createApiResponse({
      appointment_id: appointmentId,
      calendar: calendarResult.status === 'fulfilled' ? calendarResult.value : { status: 'failed' },
      confirmation_email_sent: emailResult.status === 'fulfilled',
    }, 201, {}, request.method)
  } catch (error) {
    console.error('Recruitment slot claim failed', error)
    return createErrorResponse(
      error instanceof Error ? error.message : 'Failed to book appointment',
      'BOOKING_CLAIM_FAILED',
      409
    )
  }
}

function appointmentSubjectLabel(type: string | null | undefined) {
  return type === 'trial_shift' ? 'Trial shift' : 'Interview'
}
