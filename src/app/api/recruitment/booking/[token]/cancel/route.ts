import { NextRequest } from 'next/server'
import { createApiResponse, createErrorResponse } from '@/lib/api/auth'
import { cancelRecruitmentAppointment } from '@/services/recruitment'
import { deleteRecruitmentAppointmentCalendarEvent, loadRecruitmentAppointment } from '@/lib/recruitment/calendar'
import {
  describeRecruitmentAppointmentCandidate,
  sendRecruitmentManagerAlert,
} from '@/lib/recruitment/communications'
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
      // Name the candidate so the alert is actionable from the inbox. Best-effort
      // like the calendar cleanup above: the cancellation is already committed, so
      // a failed lookup falls back to the generic wording rather than erroring.
      const cancelledBy = await loadRecruitmentAppointment(result.appointmentId)
        .then(describeRecruitmentAppointmentCandidate)
        .catch(() => 'A candidate')

      await sendRecruitmentManagerAlert({
        applicationId: result.applicationId,
        candidateId: result.candidateId,
        alertType: 'appointment cancelled',
        alertBody: `${cancelledBy} cancelled a recruitment appointment. Review whether to rebook or close the application.`,
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
