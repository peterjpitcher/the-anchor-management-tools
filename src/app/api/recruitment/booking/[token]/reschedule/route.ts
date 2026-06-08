import { NextRequest } from 'next/server'
import { createApiResponse, createErrorResponse } from '@/lib/api/auth'
import { rescheduleRecruitmentAppointment } from '@/services/recruitment'
import {
  generateRecruitmentAppointmentIcs,
  loadRecruitmentAppointment,
  syncRecruitmentAppointmentCalendar,
} from '@/lib/recruitment/calendar'
import { sendRecruitmentManagerAlert, sendRecruitmentTemplateEmail } from '@/lib/recruitment/communications'

type RouteContext = {
  params: Promise<{ token: string }>
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { token } = await context.params
    const body = await request.json().catch(() => null) as { slot_id?: string } | null
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
        alertBody: `${appointment.type === 'trial_shift' ? 'Trial shift' : 'Interview'} rescheduled to ${new Date(appointment.scheduled_start).toLocaleString('en-GB')} at ${appointment.location}.`,
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
