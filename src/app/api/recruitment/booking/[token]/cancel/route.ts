import { NextRequest } from 'next/server'
import { createApiResponse, createErrorResponse } from '@/lib/api/auth'
import { cancelRecruitmentAppointment } from '@/services/recruitment'
import { deleteRecruitmentAppointmentCalendarEvent } from '@/lib/recruitment/calendar'
import { sendRecruitmentManagerAlert } from '@/lib/recruitment/communications'
import { guardPublicRecruitmentRequest } from '@/lib/recruitment/public-security'

type RouteContext = {
  params: Promise<{ token: string }>
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { token } = await context.params
    const guard = await guardPublicRecruitmentRequest(request, token, {
      scope: 'recruitment-booking-cancel',
      requireTurnstile: true,
    })
    if (guard) return guard

    const result = await cancelRecruitmentAppointment(token)
    if (result.appointmentId) {
      // Best-effort: the cancellation is already committed, so a calendar-cleanup
      // failure (or a transient DB read while loading the appointment) must not turn
      // a successful cancel into a 409 for the candidate.
      await deleteRecruitmentAppointmentCalendarEvent(result.appointmentId).catch(error => {
        console.error('Recruitment cancellation calendar delete failed', error)
      })
      await sendRecruitmentManagerAlert({
        applicationId: result.applicationId,
        candidateId: result.candidateId,
        alertType: 'appointment cancelled',
        alertBody: 'A candidate cancelled a recruitment appointment. Review whether to rebook or close the application.',
      }).catch(error => {
        console.error('Recruitment cancellation alert failed', error)
      })
    }
    return createApiResponse(result, 200, {}, request.method)
  } catch (error) {
    return createErrorResponse(
      error instanceof Error ? error.message : 'Failed to cancel appointment',
      'BOOKING_CANCEL_FAILED',
      409
    )
  }
}
