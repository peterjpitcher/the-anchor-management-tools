import type { SupabaseClient } from '@supabase/supabase-js'
import { Client } from '@microsoft/microsoft-graph-client'
import { ClientSecretCredential } from '@azure/identity'
import { createAdminClient } from '@/lib/supabase/admin'
import { isGraphConfigured } from '@/lib/microsoft-graph'

type GenericClient = SupabaseClient<any, 'public', any>

const VENUE_LOCATION = 'The Anchor, Horton Road, Stanwell Moor, Surrey TW19 6AQ'

function getRecruitmentGraphSender(): string {
  return process.env.RECRUITMENT_FROM_EMAIL || 'peter@orangejelly.co.uk'
}

function getGraphClient() {
  const credential = new ClientSecretCredential(
    process.env.MICROSOFT_TENANT_ID!,
    process.env.MICROSOFT_CLIENT_ID!,
    process.env.MICROSOFT_CLIENT_SECRET!
  )

  return Client.initWithMiddleware({
    authProvider: {
      getAccessToken: async () => {
        const token = await credential.getToken('https://graph.microsoft.com/.default')
        return token?.token || ''
      },
    },
  })
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
  const rightToWork = 'Please bring proof of your right to work in the UK.'
  const trialText = appointment.type === 'trial_shift'
    ? '\n\nTrial note: short unpaid trial, paired with a team member, with a complimentary meal and soft drink.'
    : ''

  return [
    `Recruitment ${label} for ${posting?.title || 'The Anchor'}.`,
    rightToWork,
    trialText.trim(),
  ].filter(Boolean).join('\n\n')
}

export function generateRecruitmentAppointmentIcs(appointment: any): string {
  const start = new Date(appointment.scheduled_start)
  const end = new Date(appointment.scheduled_end)
  const uid = `recruitment-${appointment.id}@the-anchor`
  const subject = escapeIcsText(appointmentSubject(appointment))
  const description = escapeIcsText(appointmentDescription(appointment))
  const location = escapeIcsText(appointment.location || VENUE_LOCATION)
  const organizerEmail = getRecruitmentGraphSender()

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
    'STATUS:CONFIRMED',
    'SEQUENCE:0',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')
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

export async function syncRecruitmentAppointmentCalendar(
  appointmentId: string,
  supabase: GenericClient = createAdminClient()
) {
  const appointment = await loadRecruitmentAppointment(appointmentId, supabase)
  const senderEmail = getRecruitmentGraphSender()

  if (!isGraphConfigured()) {
    await supabase
      .from('recruitment_candidate_appointments')
      .update({
        calendar_sync_status: 'ics_fallback',
        calendar_last_error: 'Microsoft Graph is not configured',
      })
      .eq('id', appointmentId)
    return { status: 'ics_fallback' as const, error: 'Microsoft Graph is not configured' }
  }

  try {
    const client = getGraphClient()
    const candidate = appointment.candidate
    const attendees = candidate?.email
      ? [{
          emailAddress: {
            address: candidate.email,
            name: [candidate.first_name, candidate.last_name].filter(Boolean).join(' ') || candidate.email,
          },
          type: 'required',
        }]
      : []

    const eventPayload = {
      subject: appointmentSubject(appointment),
      body: {
        contentType: 'Text',
        content: appointmentDescription(appointment),
      },
      start: {
        dateTime: appointment.scheduled_start,
        timeZone: appointment.timezone || 'Europe/London',
      },
      end: {
        dateTime: appointment.scheduled_end,
        timeZone: appointment.timezone || 'Europe/London',
      },
      location: {
        displayName: appointment.location || VENUE_LOCATION,
      },
      attendees,
      allowNewTimeProposals: true,
      isReminderOn: true,
      reminderMinutesBeforeStart: 1440,
    }

    const response = appointment.calendar_event_id
      ? await client
          .api(`/users/${senderEmail}/events/${appointment.calendar_event_id}`)
          .patch(eventPayload)
      : await client
          .api(`/users/${senderEmail}/events`)
          .post(eventPayload)

    await supabase
      .from('recruitment_candidate_appointments')
      .update({
        calendar_event_id: response?.id ?? appointment.calendar_event_id ?? null,
        calendar_sync_status: 'synced',
        calendar_last_error: null,
      })
      .eq('id', appointmentId)

    return { status: 'synced' as const, eventId: response?.id ?? appointment.calendar_event_id ?? null }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await supabase
      .from('recruitment_candidate_appointments')
      .update({
        calendar_sync_status: 'ics_fallback',
        calendar_last_error: message,
      })
      .eq('id', appointmentId)

    return { status: 'ics_fallback' as const, error: message }
  }
}

export async function deleteRecruitmentAppointmentCalendarEvent(
  appointmentId: string,
  supabase: GenericClient = createAdminClient()
) {
  const appointment = await loadRecruitmentAppointment(appointmentId, supabase)
  if (!appointment.calendar_event_id || !isGraphConfigured()) {
    return { deleted: false, reason: 'not_synced' }
  }

  try {
    const client = getGraphClient()
    await client
      .api(`/users/${getRecruitmentGraphSender()}/events/${appointment.calendar_event_id}`)
      .delete()

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

  return {
    processed: results.length,
    synced: results.filter(result => result.status === 'synced').length,
    fallback: results.filter(result => result.status === 'ics_fallback').length,
  }
}

