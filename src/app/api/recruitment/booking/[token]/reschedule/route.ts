import { NextRequest } from 'next/server'
import { createApiResponse, createErrorResponse } from '@/lib/api/auth'
import { formatRecruitmentAppointmentTime, rescheduleRecruitmentAppointment } from '@/services/recruitment'
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

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { token } = await context.params
    const body = await request.json().catch(() => null) as { slot_id?: string; turnstile_token?: string } | null
    const guard = await guardPublicRecruitmentRequest(request, token, {
      scope: 'recruitment-booking-reschedule',
      requireTurnstile: true,
      turnstileToken: body?.turnstile_token ?? null,
    })
    if (guard) return guard

    const slotId = body?.slot_id
    if (!slotId) {
      return createErrorResponse('Slot ID is required', 'VALIDATION_ERROR', 400)
    }

    const result = await rescheduleRecruitmentAppointment(token, slotId)
    const appointment = await loadRecruitmentAppointment(result.appointmentId)
    const ics = generateRecruitmentAppointmentIcs(appointment)

    const [calendarResult, emailResult] = await Promise.allSettled([
      syncRecruitmentAppointmentCalendar(result.appointmentId),
      sendRecruitmentTemplateEmail(
        appointment.application_id,
        appointment.type === 'trial_shift' ? 'trial_confirmation' : 'interview_confirmation',
        {
          appointmentId: result.appointmentId,
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
        alertType: appointment.type === 'trial_shift' ? 'trial rescheduled' : 'interview rescheduled',
        alertBody: `${describeRecruitmentAppointmentCandidate(appointment)} — ${appointment.type === 'trial_shift' ? 'Trial shift' : 'Interview'} rescheduled to ${formatRecruitmentAppointmentTime(appointment)} at ${appointment.location}. Rescheduled by the candidate.`,
      }),
    ])

    return createApiResponse({
      ...result,
      calendar: calendarResult.status === 'fulfilled' ? calendarResult.value : { status: 'failed' },
      confirmation_email_sent: emailResult.status === 'fulfilled',
    }, 200, {}, request.method)
  } catch (error) {
    return createErrorResponse(
      error instanceof Error ? error.message : 'Failed to reschedule appointment',
      'BOOKING_RESCHEDULE_FAILED',
      409
    )
  }
}
