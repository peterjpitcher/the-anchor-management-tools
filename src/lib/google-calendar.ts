import { google } from 'googleapis'
import { addHours } from 'date-fns'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import type { PrivateBooking } from '@/types/private-bookings'
import { getErrorMessage, getErrorCode, getErrorDetails } from '@/lib/errors'
import { formatCalendarIdForLog, getSharedOperationsCalendarId } from '@/lib/google-calendar-targets'
import { logger } from '@/lib/logger'
import { shiftIsoDate } from '@/lib/dateUtils'
import { resolveAccessTimes } from '@/lib/private-bookings/access-times'

// Initialize the calendar API
const calendar = google.calendar('v3')
const CALENDAR_TIME_ZONE = 'Europe/London'
const RFC3339_FORMAT = "yyyy-MM-dd'T'HH:mm:ssXXX"

// Helper function to safely parse JSON with proper escaping
function parseServiceAccountKey(jsonString: string): any {
  try {
    // First attempt: try parsing as-is
    const parsed = JSON.parse(jsonString)

    // Fix escaped newlines in private key if needed
    if (parsed.private_key && typeof parsed.private_key === 'string') {
      // Check if the private key has escaped newlines that need to be converted
      if (parsed.private_key.includes('\\n') && !parsed.private_key.includes('\n')) {
        logger.info('[Google Calendar] Converting escaped newlines in private key')
        parsed.private_key = parsed.private_key.replace(/\\n/g, '\n')
      }
    }

    return parsed
  } catch (firstError) {
    try {
      // Second attempt: handle common issues with newlines and quotes
      // Replace actual newlines with escaped newlines
      const escapedJson = jsonString
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\t/g, '\\t')

      const parsed = JSON.parse(escapedJson)

      // Fix escaped newlines in private key if needed
      if (parsed.private_key && typeof parsed.private_key === 'string') {
        if (parsed.private_key.includes('\\n') && !parsed.private_key.includes('\n')) {
          logger.info('[Google Calendar] Converting escaped newlines in private key')
          parsed.private_key = parsed.private_key.replace(/\\n/g, '\n')
        }
      }

      return parsed
    } catch (secondError) {
      // Third attempt: handle private key format issues
      try {
        // Sometimes the private key has unescaped newlines within the key itself
        // This regex finds the private_key field and properly escapes it
        const fixedJson = jsonString.replace(
          /"private_key"\s*:\s*"([^"]+)"/g,
          (match, key) => {
            const escapedKey = key
              .replace(/\n/g, '\\n')
              .replace(/\r/g, '\\r')
              .replace(/\t/g, '\\t')
              .replace(/"/g, '\\"')
            return `"private_key":"${escapedKey}"`
          }
        )

        const parsed = JSON.parse(fixedJson)

        // Fix escaped newlines in private key if needed
        if (parsed.private_key && typeof parsed.private_key === 'string') {
          if (parsed.private_key.includes('\\n') && !parsed.private_key.includes('\n')) {
            logger.info('[Google Calendar] Converting escaped newlines in private key')
            parsed.private_key = parsed.private_key.replace(/\\n/g, '\n')
          }
        }

        return parsed
      } catch (thirdError) {
        // If all attempts fail, provide helpful error message
        console.error('Failed to parse Google Service Account Key.')
        console.error('Please ensure your GOOGLE_SERVICE_ACCOUNT_KEY environment variable contains valid JSON.')
        console.error('Common issues:')
        console.error('1. Newlines in the private key must be actual newlines, not \\n literal characters')
        console.error('2. The entire JSON must be valid and properly formatted')
        console.error('3. Check for any unescaped quotes within string values')
        console.error('')
        console.error('To fix ERR_OSSL_UNSUPPORTED errors:')
        console.error('Run: tsx scripts/fix-google-service-key.ts')
        console.error('')
        console.error('Example format:')
        console.error('{"type":"service_account","private_key":"-----BEGIN PRIVATE KEY-----\\nMIIE...\\n-----END PRIVATE KEY-----\\n",...}')

        const errorMessage = firstError instanceof Error ? firstError.message : 'Unknown error'
        throw new Error(`Invalid Google Service Account Key format: ${errorMessage}`)
      }
    }
  }
}

function getDelegatedCalendarUser(): string | undefined {
  const delegate = process.env.GOOGLE_CALENDAR_DELEGATE_EMAIL || process.env.GOOGLE_CALENDAR_IMPERSONATE_EMAIL
  const trimmed = delegate?.trim()
  return trimmed || undefined
}

function canInviteCalendarAttendees(): boolean {
  const hasOAuth = Boolean(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_REFRESH_TOKEN
  )
  if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    return Boolean(getDelegatedCalendarUser())
  }
  return hasOAuth
}

function isServiceAccountAttendeeError(error: unknown): boolean {
  const message = getErrorMessage(error)
  return getErrorCode(error) === 403 && /service accounts/i.test(message) && /invite attendees/i.test(message)
}

function getInterviewCalendarId(): string {
  const interviewId = process.env.GOOGLE_CALENDAR_INTERVIEW_ID
  if (interviewId?.trim()) return interviewId.trim()
  return getSharedOperationsCalendarId()
}

// Initialize OAuth2 client
export async function getOAuth2Client() {
  logger.info('[Google Calendar] Getting OAuth2 client')

  try {
    // Check for OAuth2 configuration first
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URL
    )

    // Use service account if available (recommended for server-to-server)
    if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
      logger.info('[Google Calendar] Using service account authentication')
      try {
        const serviceAccount = parseServiceAccountKey(process.env.GOOGLE_SERVICE_ACCOUNT_KEY)

        // Validate required fields
        if (!serviceAccount.type || serviceAccount.type !== 'service_account') {
          throw new Error('Invalid service account: type must be "service_account"')
        }
        if (!serviceAccount.private_key) {
          throw new Error('Invalid service account: missing private_key')
        }
        if (!serviceAccount.client_email) {
          throw new Error('Invalid service account: missing client_email')
        }

      const delegatedUser = getDelegatedCalendarUser()
      if (delegatedUser) {
        console.warn('[Google Calendar] Using service account with domain-wide delegation:', {
          delegatedUser
        })
        const auth = new google.auth.JWT({
          email: serviceAccount.client_email,
          key: serviceAccount.private_key,
          scopes: ['https://www.googleapis.com/auth/calendar'],
          subject: delegatedUser,
        })
        await auth.authorize()
        return auth
      }

        const auth = new google.auth.GoogleAuth({
          credentials: serviceAccount,
          scopes: ['https://www.googleapis.com/auth/calendar']
        })

        logger.info('[Google Calendar] Service account initialized', {
          metadata: {
            clientEmail: serviceAccount.client_email,
            projectId: serviceAccount.project_id
          }
        })

        const client = await auth.getClient()
        logger.info('[Google Calendar] Auth client obtained successfully')
        return client
      } catch (error: unknown) {
        console.error('Error initializing Google Service Account: ', error)
        throw new Error(`Failed to initialize Google Calendar with service account: ${getErrorMessage(error)}`)
      }
    }

    // Otherwise use OAuth2 with refresh token
    if (process.env.GOOGLE_REFRESH_TOKEN) {
      console.warn('[Google Calendar] Using OAuth2 with refresh token')
      oauth2Client.setCredentials({
        refresh_token: process.env.GOOGLE_REFRESH_TOKEN
      })
      return oauth2Client
    }

    // No valid authentication method available
    throw new Error(
      'Google Calendar authentication not configured. ' +
      'Please provide either GOOGLE_SERVICE_ACCOUNT_KEY or ' +
      'GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN'
    )
  } catch (error) {
    console.error('Error in getOAuth2Client:', error)
    throw error
  }
}

// Format event title based on status
function formatEventTitle(booking: PrivateBooking): string {
  const statusPrefix = booking.status.toUpperCase()
  const bookingRef = booking.id.slice(0, 8)
  return `[${statusPrefix}] - ${bookingRef} - ${booking.customer_name} @ The Anchor`
}

// Combine date and time strings
function normalizeTime(time: string): string {
  const [hourRaw = '00', minuteRaw = '00', secondRaw] = time.split(':')
  const hour = hourRaw.padStart(2, '0')
  const minute = minuteRaw.padStart(2, '0')
  const second = (secondRaw ?? '00').padStart(2, '0')
  return `${hour}:${minute}:${second}`
}

/**
 * The instant a London wall-clock time is reached on a date, or on the next date for a time after
 * midnight. The next day is found on the calendar first and only then turned into an instant: adding
 * 24 hours to the instant put a 02:00 finish an hour early on the night the clocks go back and an
 * hour late on the night they go forward, on the UTC server only (BK-209).
 */
export function combineDateAndTime(date: string, time: string, nextDay = false): Date {
  if (!date || !time) throw new Error('Date and time are required')
  const [year, month, day] = date.slice(0, 10).split('-')
  const normalizedDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  const calendarDate = nextDay ? shiftIsoDate(normalizedDate, 1) : normalizedDate
  if (!calendarDate) throw new Error(`Not a calendar date: ${date}`)
  return fromZonedTime(`${calendarDate}T${normalizeTime(time)}`, CALENDAR_TIME_ZONE)
}

function formatForCalendar(date: Date): string {
  return formatInTimeZone(date, CALENDAR_TIME_ZONE, RFC3339_FORMAT)
}

/** The calendar's deposit line, from what the booking really holds (BK-156). */
export function describeCalendarDeposit(booking: Pick<PrivateBooking, 'deposit_amount' | 'deposit_paid_date' | 'deposit_waived' | 'deposit_confirmed_at'>): string {
  if (booking.deposit_paid_date) return 'Deposit: paid'
  if (booking.deposit_waived === true) return 'Deposit: waived'
  const amount = Number(booking.deposit_amount ?? 0)
  if (!Number.isFinite(amount) || amount <= 0) return 'Deposit: none'
  const pounds = `£${Number.isInteger(amount) ? amount.toFixed(0) : amount.toFixed(2)}`
  // A new booking's deposit waits for staff to confirm it (owner decision, 11 September 2026).
  if (booking.deposit_confirmed_at === null) return `Deposit: ${pounds}, to be confirmed`
  return `Deposit: ${pounds} due`
}

function clock(time: string | null | undefined): string | null {
  if (!time) return null
  const match = /^(\d{1,2}):(\d{2})/.exec(time)
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : null
}

/** "18:00 to 23:30", with the day named when the finish is after midnight. */
function describeTimes(booking: PrivateBooking): string | null {
  const start = clock(booking.start_time)
  if (!start) return null
  const end = clock(booking.end_time)
  if (!end) return `Times: from ${start}`
  return `Times: ${start} to ${end}${booking.end_time_next_day ? ' (next day)' : ''}`
}

function describeAccess(booking: PrivateBooking): string | null {
  const access = resolveAccessTimes(booking)
  const label = (window: { time: string | null; isDefault: boolean; dayOffset: number }): string | null => {
    if (!window.time) return null
    const day = window.dayOffset > 0 ? ' (next day)' : window.dayOffset < 0 ? ' (day before)' : ''
    return `${window.time}${day}${window.isDefault ? ' (standard hour)' : ''}`
  }
  const setup = label(access.setup)
  const cleardown = label(access.cleardown)
  if (!setup && !cleardown) return null
  return `Access: setup from ${setup ?? 'to be confirmed'}, cleared by ${cleardown ?? 'to be confirmed'}`
}

/** A website enquiry that gave no time is held at 12:00; it is not a lunchtime booking (BK-156). */
function isTimelessEnquiry(booking: PrivateBooking): boolean {
  return booking.source === 'website' && clock(booking.start_time) === '12:00' && !booking.end_time
}

/**
 * The calendar description: who, how many, which rooms, the times with setup and cleardown, and
 * the deposit as the booking holds it (BK-156). It said "Deposit Required (£250)" for every
 * unpaid booking, waived or not, and named no room.
 */
export function formatBookingDetails(booking: PrivateBooking, rooms: string[] = []): string {
  const details = [
    `Customer: ${booking.customer_name}`,
    booking.contact_phone ? `Phone: ${booking.contact_phone}` : '',
    booking.contact_email ? `Email: ${booking.contact_email}` : '',
    booking.guest_count ? `Guests: ${booking.guest_count}` : '',
    booking.event_type ? `Type: ${booking.event_type}` : '',
    rooms.length > 0 ? `Rooms: ${rooms.join(', ')}` : 'Rooms: none booked yet',
    isTimelessEnquiry(booking) ? 'Enquiry, time not given' : describeTimes(booking) ?? '',
    isTimelessEnquiry(booking) ? '' : describeAccess(booking) ?? '',
    '',
    `Booking Status: ${booking.status}`,
    describeCalendarDeposit(booking),
    '',
    'View booking: ' + process.env.NEXT_PUBLIC_APP_URL + '/private-bookings/' + booking.id
  ].filter(Boolean).join('\n')

  return details
}

/**
 * The deposit, access times and rooms as stored now. Callers pass bookings read with different
 * column lists, and a missing deposit_waived must not read as "not waived". If the read fails
 * the booking is described as passed.
 */
async function readCalendarFacts(booking: PrivateBooking): Promise<{ booking: PrivateBooking; rooms: string[] }> {
  try {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    const { data, error } = await createAdminClient()
      .from('private_bookings')
      .select('id, deposit_amount, deposit_paid_date, deposit_waived, deposit_confirmed_at, setup_date, setup_time, cleardown_time, source, items:private_booking_items(space_id, display_order, space:venue_spaces(name))')
      .eq('id', booking.id)
      .maybeSingle()
    if (error || !data) throw new Error(error?.message ?? 'booking not found')
    const { items, ...facts } = data as Record<string, unknown> & {
      items?: Array<{ space_id: string | null; space: { name?: string | null } | Array<{ name?: string | null }> | null }> | null
    }
    const rooms = Array.from(new Set(
      (items ?? [])
        .filter((item) => item.space_id)
        .map((item) => (Array.isArray(item.space) ? item.space[0]?.name : item.space?.name)?.trim())
        .filter((name): name is string => Boolean(name)),
    ))
    return { booking: { ...booking, ...(facts as Partial<PrivateBooking>) }, rooms }
  } catch (error) {
    logger.error('Google Calendar: could not read the booking\'s rooms and deposit; describing it as passed', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { bookingId: booking.id },
    })
    return { booking, rooms: [] }
  }
}

// Create or update calendar event
export async function syncCalendarEvent(booking: PrivateBooking): Promise<string | null> {
  const calendarId = getSharedOperationsCalendarId()

  console.warn('[Google Calendar] Starting calendar sync for booking:', {
    bookingId: booking.id,
    status: booking.status,
    eventDate: booking.event_date,
    startTime: booking.start_time,
    endTime: booking.end_time,
    existingEventId: booking.calendar_event_id
  })

  try {
    // Check if calendar is configured before attempting to sync
    if (!isCalendarConfigured()) {
      console.warn('[Google Calendar] Not configured. Skipping calendar sync.')
      return null
    }

    if (!booking.start_time || !booking.event_date) {
      console.error('[Google Calendar] Cannot sync: missing date/time', {
        hasStartTime: !!booking.start_time,
        hasEventDate: !!booking.event_date
      })
      return null
    }

    console.warn('[Google Calendar] Getting auth client...')
    const auth = await getOAuth2Client()
    console.warn('[Google Calendar] Using calendar ID:', calendarId)

    const startUtc = combineDateAndTime(booking.event_date, booking.start_time)
    let endUtc = booking.end_time
      ? combineDateAndTime(booking.event_date, booking.end_time, booking.end_time_next_day)
      : addHours(startUtc, 1)
    if (endUtc.getTime() <= startUtc.getTime()) {
      console.warn('[Google Calendar] End time is not after start time. Using 1 hour duration.', {
        bookingId: booking.id,
        startTime: booking.start_time,
        endTime: booking.end_time,
        endTimeNextDay: booking.end_time_next_day,
      })
      endUtc = addHours(startUtc, 1)
    }
    const startDateTime = formatForCalendar(startUtc)
    const endDateTime = formatForCalendar(endUtc)

    const facts = await readCalendarFacts(booking)
    const event = {
      summary: formatEventTitle(booking),
      description: formatBookingDetails(facts.booking, facts.rooms),
      start: {
        dateTime: startDateTime,
        timeZone: CALENDAR_TIME_ZONE,
      },
      end: {
        dateTime: endDateTime,
        timeZone: CALENDAR_TIME_ZONE,
      },
      // The venue is "The Anchor" (website SSOT §1; owner's decision, 14 October 2026). An
      // existing entry picks this up the next time its booking is synced.
      location: 'The Anchor',
      colorId: getEventColor(booking.status),
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'email', minutes: 24 * 60 }, // 1 day before
          { method: 'popup', minutes: 60 }, // 1 hour before
        ],
      },
    }

    console.warn('[Google Calendar] Event object prepared:', {
      summary: event.summary,
      startDateTime,
      endDateTime,
      colorId: event.colorId
    })

    let response

    if (booking.calendar_event_id) {
      // Update existing event
      console.warn('[Google Calendar] Updating existing event:', booking.calendar_event_id)
      try {
        response = await calendar.events.update({
          auth: auth as InstanceType<typeof google.auth.OAuth2>,
          calendarId,
          eventId: booking.calendar_event_id,
          requestBody: event,
        })
        console.warn('[Google Calendar] Event updated successfully:', response.data.id)
      } catch (error: unknown) {
        const code = getErrorCode(error)
        if (code !== 404 && code !== 410) {
          throw error
        }

        console.warn('[Google Calendar] Existing event not found. Creating a new event.', {
          bookingId: booking.id,
          missingEventId: booking.calendar_event_id,
          code,
        })

        response = await calendar.events.insert({
          auth: auth as InstanceType<typeof google.auth.OAuth2>,
          calendarId,
          requestBody: event,
        })

        console.warn('[Google Calendar] Event created successfully:', {
          id: response.data.id,
          link: response.data.htmlLink,
        })
      }
    } else {
      // Create new event
      console.warn('[Google Calendar] Creating new event...')
      response = await calendar.events.insert({
        auth: auth as any,
        calendarId,
        requestBody: event,
      })
      console.warn('[Google Calendar] Event created successfully:', {
        id: response.data.id,
        link: response.data.htmlLink
      })
    }

    return response.data.id || null
  } catch (error: unknown) {
    // Provide more detailed error information
    const errorMsg = getErrorMessage(error)
    const errorCode = getErrorCode(error)
    console.error('[Google Calendar] Sync failed:', {
      errorCode,
      errorMessage: errorMsg,
      errorDetails: getErrorDetails(error),
      stack: error instanceof Error ? error.stack : undefined
    })

    if (errorMsg.includes('authentication')) {
      console.error('[Google Calendar] Authentication error:', errorMsg)
      console.error('Please check your Google Calendar configuration in environment variables.')
    } else if (errorCode === 404) {
      console.error('[Google Calendar] Calendar not found. Please check shared operations calendar:', calendarId)
      console.error('Ensure the calendar exists and is accessible by the service account.')
    } else if (errorCode === 403) {
      const email = typeof error === 'object' && error !== null && 'email' in error ? (error as { email: string }).email : 'unknown'
      console.error('[Google Calendar] Permission denied. Service account email:', email)
      console.error('Please ensure the service account has been granted access to the calendar.')
      console.error('1. Go to Google Calendar settings')
      console.error('2. Find the calendar and click "Settings and sharing"')
      console.error('3. Under "Share with specific people", add the service account email')
      console.error('4. Grant "Make changes to events" permission')
    } else if (errorCode === 400) {
      console.error('[Google Calendar] Bad request. Check the event data format.')
      console.error('Error details:', getErrorDetails(error))
    } else {
      console.error('[Google Calendar] Unexpected error:', errorMsg)
    }

    // Don't throw the error, just return null to allow the booking to proceed
    return null
  }
}

// Delete calendar event
export async function deleteCalendarEvent(eventId: string): Promise<boolean> {
  try {
    // Check if calendar is configured before attempting to delete
    if (!isCalendarConfigured()) {
      console.warn('Google Calendar is not configured. Skipping calendar delete.')
      return true // Return true to not block the operation
    }

    const auth = await getOAuth2Client()
    const calendarId = getSharedOperationsCalendarId()

    await calendar.events.delete({
      auth: auth as any,
      calendarId,
      eventId,
    })

    return true
  } catch (error: unknown) {
    // Handle specific errors
    const code = getErrorCode(error)
    if (code === 404) {
      // Event not found - this is okay, it may have been deleted already
      console.warn('Calendar event not found (may have been deleted already)')
      return true
    } else if (code === 410) {
      // Event was already deleted
      console.warn('Calendar event was already deleted')
      return true
    } else {
      const msg = getErrorMessage(error)
      if (msg.includes('authentication')) {
        console.error('Google Calendar authentication error during delete:', msg)
      } else {
        console.error('Error deleting calendar event:', msg)
      }
    }

    // Return false for actual errors, but don't throw to avoid blocking operations
    return false
  }
}

// Get color ID based on booking status
function getEventColor(status: string): string {
  const colors: Record<string, string> = {
    'draft': '8', // Gray
    'confirmed': '10', // Green
    'completed': '9', // Blue
    'cancelled': '11', // Red
  }
  return colors[status] || '8'
}

// Check if calendar integration is configured
export function isCalendarConfigured(): boolean {
  const calendarId = getSharedOperationsCalendarId()
  const hasCalendarId = !!calendarId
  const hasServiceAccount = !!process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  const hasOAuth = !!(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_REFRESH_TOKEN
  )
  const isConfigured = hasCalendarId && (hasServiceAccount || hasOAuth)

  console.warn('[Google Calendar] Configuration check:', {
    hasCalendarId,
    calendarId: formatCalendarIdForLog(calendarId),
    hasServiceAccount,
    hasOAuth,
    isConfigured
  })

  return isConfigured
}

function isInterviewCalendarConfigured(): boolean {
  const hasInterviewCalendarId = !!process.env.GOOGLE_CALENDAR_INTERVIEW_ID
  const calendarId = getSharedOperationsCalendarId()
  const hasCalendarId = !!calendarId
  const hasServiceAccount = !!process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  const hasOAuth = !!(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_REFRESH_TOKEN
  )
  const calendarIdValue = getInterviewCalendarId()
  const calendarLabel = formatCalendarIdForLog(calendarIdValue)
  const isConfigured = (hasInterviewCalendarId || hasCalendarId) && (hasServiceAccount || hasOAuth)

  console.warn('[Google Calendar] Interview configuration check:', {
    hasInterviewCalendarId,
    hasCalendarId,
    calendarId: calendarLabel,
    hasServiceAccount,
    hasOAuth,
    isConfigured
  })

  return isConfigured
}

async function verifyInterviewCalendarAccess(auth: any, calendarId: string): Promise<string | null> {
  try {
    await calendar.calendars.get({ auth, calendarId })
    return null
  } catch (error: unknown) {
    const code = getErrorCode(error)
    if (code === 404) {
      return 'Interview scheduled, but the Ops calendar was not found or is not shared with the service account. Check GOOGLE_CALENDAR_INTERVIEW_ID and calendar sharing.'
    }
    if (code === 403) {
      return 'Interview scheduled, but access to the Ops calendar was denied. Share it with the service account (Make changes to events).'
    }
    const fallback = code ? `Calendar error (${code}).` : 'Calendar access check failed.'
    return `Interview scheduled, but Google Calendar access failed. ${fallback}`
  }
}

// Helper function to format a service account JSON for environment variable
// This is useful for converting a downloaded service account key file
function formatServiceAccountForEnv(serviceAccountJson: string | object): string {
  try {
    // Parse if string, otherwise use as is
    const serviceAccount = typeof serviceAccountJson === 'string'
      ? JSON.parse(serviceAccountJson)
      : serviceAccountJson

    // Convert back to string with proper escaping
    const formatted = JSON.stringify(serviceAccount)
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t')

    console.warn('Formatted service account key for .env.local:')
    console.warn('GOOGLE_SERVICE_ACCOUNT_KEY=' + formatted)
    console.warn('Copy the line above to your .env.local file')

    return formatted
  } catch (error) {
    console.error('Error formatting service account key:', error)
    throw new Error('Invalid service account JSON format')
  }
}

// Test calendar connection and permissions
export async function testCalendarConnection(): Promise<{
  success: boolean
  message: string
  details?: any
}> {
  console.warn('[Google Calendar] Testing calendar connection...')

  try {
    if (!isCalendarConfigured()) {
      return {
        success: false,
        message: 'Google Calendar is not configured. Please check environment variables.',
        details: {
          hasCalendarId: !!getSharedOperationsCalendarId(),
          hasAuth: !!(process.env.GOOGLE_SERVICE_ACCOUNT_KEY ||
            (process.env.GOOGLE_CLIENT_ID &&
              process.env.GOOGLE_CLIENT_SECRET &&
              process.env.GOOGLE_REFRESH_TOKEN))
        }
      }
    }

    const auth = await getOAuth2Client()
    const calendarId = getSharedOperationsCalendarId()

    console.warn('[Google Calendar] Testing calendar access for:', calendarId)

    // Try to get calendar details
    try {
      const calendarResponse = await calendar.calendars.get({
        auth: auth as any,
        calendarId: calendarId
      })

      console.warn('[Google Calendar] Calendar access successful:', {
        summary: calendarResponse.data.summary,
        timeZone: calendarResponse.data.timeZone
      })

      // Since we can access the calendar, we assume we have appropriate permissions
      // The calendar.calendars.get() would fail if we didn't have access

      return {
        success: true,
        message: 'Calendar connection successful',
        details: {
          calendarName: calendarResponse.data.summary,
          timeZone: calendarResponse.data.timeZone
        }
      }

      // Try to list recent events to verify read access
      const eventsResponse = await calendar.events.list({
        auth: auth as any,
        calendarId: calendarId,
        maxResults: 5,
        orderBy: 'startTime',
        singleEvents: true,
        timeMin: new Date().toISOString()
      })

      console.warn('[Google Calendar] Successfully listed events:', {
        count: eventsResponse.data.items?.length || 0
      })

      return {
        success: true,
        message: 'Calendar connection successful with write access',
        details: {
          calendarName: calendarResponse.data.summary,
          timeZone: calendarResponse.data.timeZone,
          upcomingEvents: eventsResponse.data.items?.length || 0
        }
      }
    } catch (calendarError: any) {
      console.error('[Google Calendar] Calendar access error:', {
        code: calendarError.code,
        message: calendarError.message,
        errors: calendarError.errors
      })

      if (calendarError.code === 404) {
        return {
          success: false,
          message: `Calendar not found: ${calendarId}. Please check the shared operations calendar.`,
          details: { calendarId, errorCode: 404 }
        }
      } else if (calendarError.code === 403) {
        return {
          success: false,
          message: 'Permission denied. Please share the calendar with the service account.',
          details: {
            calendarId,
            errorCode: 403,
            hint: 'Share your calendar with the service account email and grant "Make changes to events" permission'
          }
        }
      } else {
        return {
          success: false,
          message: `Calendar error: ${calendarError.message}`,
          details: {
            calendarId,
            errorCode: calendarError.code,
            errorDetails: calendarError.errors
          }
        }
      }
    }
  } catch (error: unknown) {
    console.error('[Google Calendar] Connection test failed:', error)
    const msg = getErrorMessage(error)
    return {
      success: false,
      message: `Failed to connect: ${msg}`,
      details: { error: msg }
    }
  }
}
// Helper to get interview specific color (e.g. Lavender/Purple for interviews)
function getInterviewEventColor(): string {
  return '3'; // Grape
}

interface InterviewEventOptions {
  summary?: string
  candidateName?: string
  jobTitle?: string
  start: Date
  end?: Date
  durationMinutes?: number
  description?: string
  location?: string
  attendees?: Array<{ email: string; name?: string }>
}

interface InterviewEventResult {
  id: string | null
  htmlLink: string | null
  warning?: string | null
}

async function createInterviewEvent(options: InterviewEventOptions): Promise<InterviewEventResult | null> {
  const {
    candidateName,
    jobTitle,
    start: startTime,
    durationMinutes = 60,
    description,
    location = 'The Anchor Pub',
    summary,
    end,
    attendees = []
  } = options

  console.warn('[Google Calendar] Creating interview event:', {
    candidateName,
    jobTitle,
    startTime,
    durationMinutes
  })

  try {
    if (!isInterviewCalendarConfigured()) {
      console.warn('[Google Calendar] Not configured. Skipping interview creation.')
      return null
    }

    const auth = await getOAuth2Client()
    const calendarId = getInterviewCalendarId()
    const accessWarning = await verifyInterviewCalendarAccess(auth, calendarId)
    if (accessWarning) {
      console.warn('[Google Calendar] Interview calendar access check failed:', {
        calendarId: formatCalendarIdForLog(calendarId),
        message: accessWarning
      })
      return { id: null, htmlLink: null, warning: accessWarning }
    }

    // Determine end time: explicit end > duration > default 60m
    let endUtc: Date
    if (end) {
      endUtc = end
    } else {
      endUtc = addHours(startTime, durationMinutes / 60)
    }

    const startDateTime = formatForCalendar(startTime)
    const endDateTime = formatForCalendar(endUtc)

    const finalSummary = summary || `Interview: ${candidateName} - ${jobTitle}`
    const finalDescription = description || `Interview for ${jobTitle} position.\nCandidate: ${candidateName}`

    const event: any = {
      summary: finalSummary,
      description: finalDescription,
      start: {
        dateTime: startDateTime,
        timeZone: CALENDAR_TIME_ZONE,
      },
      end: {
        dateTime: endDateTime,
        timeZone: CALENDAR_TIME_ZONE,
      },
      location: location,
      colorId: getInterviewEventColor(),
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'popup', minutes: 30 },
        ],
      },
    }

    const eventAttendees = attendees
      .filter((attendee) => attendee?.email)
      .map((attendee) => ({
        email: attendee.email,
        displayName: attendee.name,
      }))

    const allowAttendees = canInviteCalendarAttendees()
    let warning: string | null = null

    if (!allowAttendees && eventAttendees.length > 0) {
      warning = 'Interview scheduled, but attendee invites were not sent. Configure Google Calendar domain-wide delegation or OAuth to send invites.'
    }

    const requestBody: any = { ...event }
    if (allowAttendees && eventAttendees.length > 0) {
      requestBody.attendees = eventAttendees
    }

    const insertEvent = async (body: any, sendUpdates: boolean) => {
      const options: any = {
        auth: auth as any,
        calendarId,
        requestBody: body,
      }
      if (sendUpdates) {
        options.sendUpdates = 'all'
      }
      return calendar.events.insert(options)
    }

    let response
    try {
      response = await insertEvent(requestBody, allowAttendees && eventAttendees.length > 0)
    } catch (error: unknown) {
      if (allowAttendees && eventAttendees.length > 0 && isServiceAccountAttendeeError(error)) {
        warning = 'Interview scheduled, but attendee invites were not sent. Configure Google Calendar domain-wide delegation or OAuth to send invites.'
        response = await insertEvent(event, false)
      } else {
        throw error
      }
    }

    console.warn('[Google Calendar] Interview event created:', response.data.id)
    return {
      id: response.data.id || null,
      htmlLink: response.data.htmlLink || null,
      warning,
    }

  } catch (error: unknown) {
    console.error('[Google Calendar] Interview creation failed:', error)
    return null
  }
}
