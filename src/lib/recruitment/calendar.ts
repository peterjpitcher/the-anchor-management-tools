import type { SupabaseClient } from '@supabase/supabase-js'
import { google } from 'googleapis'
import { createAdminClient } from '@/lib/supabase/admin'
import { getErrorCode } from '@/lib/errors'
import { getOAuth2Client } from '@/lib/google-calendar'
import { getSharedOperationsCalendarId } from '@/lib/google-calendar-targets'
import { RECRUITMENT_RIGHT_TO_WORK_WORDING, recruitmentSenderEmail } from '@/lib/recruitment/contact'

type GenericClient = SupabaseClient<any, 'public', any>

const VENUE_LOCATION = 'The Anchor, Horton Road, Stanwell Moor, Surrey TW19 6AQ'
const RECRUITMENT_TIMEZONE = 'Europe/London'

const calendar = google.calendar('v3')

// Recruitment interviews/trials sync to a dedicated interview calendar if configured,
// otherwise the shared operations calendar that events and private bookings already use.
function getRecruitmentCalendarId(): string {
  const interviewId = process.env.GOOGLE_CALENDAR_INTERVIEW_ID?.trim()
  if (interviewId) return interviewId
  return getSharedOperationsCalendarId()
}

function isRecruitmentCalendarConfigured(): boolean {
  const hasAuth = Boolean(
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY ||
    (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN)
  )
  return hasAuth && Boolean(getRecruitmentCalendarId())
}

function escapeIcsText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
}

function formatIcsUtc(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    'T',
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
    'Z',
  ].join('')
}

function appointmentSubject(appointment: any): string {
  const label = appointment.type === 'trial_shift' ? 'Trial shift' : 'Interview'
  const candidate = appointment.candidate
  const name = [candidate?.first_name, candidate?.last_name].filter(Boolean).join(' ') || candidate?.email || 'candidate'
  return `${label}: ${name}`
}

function appointmentDescription(appointment: any): string {
  const posting = appointment.application?.job_posting
  const label = appointment.type === 'trial_shift' ? 'trial shift' : 'interview'
  const rightToWork = RECRUITMENT_RIGHT_TO_WORK_WORDING
  const trialText = appointment.type === 'trial_shift'
    ? '\n\nTrial note: short unpaid trial, paired with a team member, with a complimentary meal and soft drink.'
    : ''
  const candidate = appointment.candidate
  const contact = [
    candidate?.email ? `Email: ${candidate.email}` : '',
    candidate?.phone || candidate?.phone_e164 ? `Phone: ${candidate?.phone || candidate?.phone_e164}` : '',
  ].filter(Boolean).join('\n')

  return [
    `Recruitment ${label} for ${posting?.title || 'The Anchor'}.`,
    contact,
    rightToWork,
    trialText.trim(),
  ].filter(Boolean).join('\n\n')
}

// Build the Google Calendar event body for an appointment. Exported for unit tests.
export function buildRecruitmentCalendarEvent(appointment: any) {
  return {
    summary: appointmentSubject(appointment),
    description: appointmentDescription(appointment),
    start: {
      dateTime: appointment.scheduled_start,
      timeZone: appointment.timezone || RECRUITMENT_TIMEZONE,
    },
    end: {
      dateTime: appointment.scheduled_end,
      timeZone: appointment.timezone || RECRUITMENT_TIMEZONE,
    },
    location: appointment.location || VENUE_LOCATION,
    // Grape for interviews, banana for trial shifts, so the two read differently in the calendar.
    colorId: appointment.type === 'trial_shift' ? '5' : '3',
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'email', minutes: 24 * 60 },
        { method: 'popup', minutes: 60 },
      ],
    },
  }
}

export function generateRecruitmentAppointmentIcs(appointment: any): string {
  const start = new Date(appointment.scheduled_start)
  const end = new Date(appointment.scheduled_end)
  const uid = `recruitment-${appointment.id}@the-anchor`
  const subject = escapeIcsText(appointmentSubject(appointment))
  const description = escapeIcsText(appointmentDescription(appointment))
  const location = escapeIcsText(appointment.location || VENUE_LOCATION)
  const organizerEmail = recruitmentSenderEmail()
  // Bump SEQUENCE on each reschedule so an updated invite supersedes the original
  // event in attendees' calendar clients (the UID is stable per appointment).
  const sequence = Number.isFinite(appointment.reschedule_count) ? appointment.reschedule_count : 0
  // Add the candidate as an ATTENDEE so the .ics attachment adds the event to
  // their calendar with an RSVP, not just as a standalone block.
  const candidateEmail = appointment.candidate?.email
  const candidateName = [appointment.candidate?.first_name, appointment.candidate?.last_name]
    .filter(Boolean)
    .join(' ')
  const attendeeCn = (candidateName || candidateEmail || '').replace(/[\\";:,\n]/g, ' ').trim()
  const attendeeLine = candidateEmail
    ? `ATTENDEE;CN=${attendeeCn};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${candidateEmail}`
    : null

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//The Anchor//Recruitment//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${formatIcsUtc(new Date())}`,
    `DTSTART:${formatIcsUtc(start)}`,
    `DTEND:${formatIcsUtc(end)}`,
    `SUMMARY:${subject}`,
    `LOCATION:${location}`,
    `DESCRIPTION:${description}`,
    `ORGANIZER;CN=The Anchor Recruitment:mailto:${organizerEmail}`,
    attendeeLine,
    'STATUS:CONFIRMED',
    `SEQUENCE:${sequence}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean).join('\r\n')
}

export async function loadRecruitmentAppointment(
  appointmentId: string,
  supabase: GenericClient = createAdminClient()
) {
  const { data, error } = await supabase
    .from('recruitment_candidate_appointments')
    .select('*, candidate:recruitment_candidates(*), application:recruitment_applications(*, job_posting:recruitment_job_postings(*))')
    .eq('id', appointmentId)
    .maybeSingle()

  if (error) throw error
  if (!data) throw new Error('Appointment not found.')
  return data
}

// Create or update the Google Calendar event for an appointment, mirroring the
// private-bookings lifecycle (insert when there is no stored id, update otherwise,
// and fall back to insert if the stored event has been removed).
export async function syncRecruitmentAppointmentCalendar(
  appointmentId: string,
  supabase: GenericClient = createAdminClient()
) {
  const appointment = await loadRecruitmentAppointment(appointmentId, supabase)

  if (!isRecruitmentCalendarConfigured()) {
    await supabase
      .from('recruitment_candidate_appointments')
      .update({
        calendar_sync_status: 'ics_fallback',
        calendar_last_error: 'Google Calendar is not configured',
      })
      .eq('id', appointmentId)
    return { status: 'ics_fallback' as const, error: 'Google Calendar is not configured' }
  }

  try {
    const auth = await getOAuth2Client()
    const calendarId = getRecruitmentCalendarId()
    const requestBody = buildRecruitmentCalendarEvent(appointment)
    const existingEventId = appointment.calendar_event_id as string | null

    let response
    if (existingEventId) {
      try {
        response = await calendar.events.update({ auth: auth as any, calendarId, eventId: existingEventId, requestBody })
      } catch (error) {
        const code = getErrorCode(error)
        if (code !== 404 && code !== 410) throw error
        // The stored event no longer exists — create a fresh one.
        response = await calendar.events.insert({ auth: auth as any, calendarId, requestBody })
      }
    } else {
      response = await calendar.events.insert({ auth: auth as any, calendarId, requestBody })
    }

    const eventId = response.data.id ?? existingEventId ?? null
    await supabase
      .from('recruitment_candidate_appointments')
      .update({
        calendar_event_id: eventId,
        calendar_sync_status: 'synced',
        calendar_last_error: null,
      })
      .eq('id', appointmentId)

    return { status: 'synced' as const, eventId }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await supabase
      .from('recruitment_candidate_appointments')
      .update({
        calendar_sync_status: 'failed',
        calendar_last_error: message,
      })
      .eq('id', appointmentId)

    return { status: 'failed' as const, error: message }
  }
}

export async function deleteRecruitmentAppointmentCalendarEvent(
  appointmentId: string,
  supabase: GenericClient = createAdminClient()
) {
  const appointment = await loadRecruitmentAppointment(appointmentId, supabase)
  if (!appointment.calendar_event_id) {
    return { deleted: false, reason: 'not_synced' }
  }
  if (!isRecruitmentCalendarConfigured()) {
    return { deleted: false, reason: 'not_configured' }
  }

  try {
    const auth = await getOAuth2Client()
    const calendarId = getRecruitmentCalendarId()
    try {
      await calendar.events.delete({ auth: auth as any, calendarId, eventId: appointment.calendar_event_id })
    } catch (error) {
      const code = getErrorCode(error)
      // Already gone — treat as deleted; rethrow anything else.
      if (code !== 404 && code !== 410) throw error
    }

    await supabase
      .from('recruitment_candidate_appointments')
      .update({
        calendar_event_id: null,
        calendar_sync_status: 'pending',
        calendar_last_error: null,
      })
      .eq('id', appointmentId)

    return { deleted: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await supabase
      .from('recruitment_candidate_appointments')
      .update({
        calendar_sync_status: 'failed',
        calendar_last_error: message,
      })
      .eq('id', appointmentId)
    return { deleted: false, reason: message }
  }
}

export async function retryRecruitmentCalendarSync(limit = 25, supabase: GenericClient = createAdminClient()) {
  const { data, error } = await supabase
    .from('recruitment_candidate_appointments')
    .select('id')
    .in('calendar_sync_status', ['pending', 'failed', 'ics_fallback'])
    .eq('status', 'scheduled')
    .gte('scheduled_start', new Date().toISOString())
    .order('scheduled_start', { ascending: true })
    .limit(limit)

  if (error) throw error

  const results = []
  for (const row of data ?? []) {
    results.push(await syncRecruitmentAppointmentCalendar(row.id, supabase))
  }

  const { data: deletionRows, error: deletionError } = await supabase
    .from('recruitment_candidate_appointments')
    .select('id')
    .eq('status', 'cancelled')
    .not('calendar_event_id', 'is', null)
    .order('scheduled_start', { ascending: true })
    .limit(limit)

  if (deletionError) throw deletionError

  const deletionResults = []
  for (const row of deletionRows ?? []) {
    deletionResults.push(await deleteRecruitmentAppointmentCalendarEvent(row.id, supabase))
  }

  return {
    processed: results.length,
    synced: results.filter(result => result.status === 'synced').length,
    fallback: results.filter(result => result.status === 'ics_fallback').length,
    deletionProcessed: deletionResults.length,
    deleted: deletionResults.filter(result => result.deleted).length,
    deletionFailed: deletionResults.filter(result => !result.deleted).length,
  }
}
