import { google } from 'googleapis'
import type { PrivateBooking } from '@/types/private-bookings'

// Initialize the calendar API
const calendar = google.calendar('v3')

// Helper function to safely parse JSON with proper escaping
function parseServiceAccountKey(jsonString: string): any {
  try {
    // First attempt: try parsing as-is
    const parsed = JSON.parse(jsonString)
    
    // Fix escaped newlines in private key if needed
    if (parsed.private_key && typeof parsed.private_key === 'string') {
      // Check if the private key has escaped newlines that need to be converted
      if (parsed.private_key.includes('\\n') && !parsed.private_key.includes('\n')) {
        console.log('[Google Calendar] Converting escaped newlines in private key')
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
          console.log('[Google Calendar] Converting escaped newlines in private key')
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
            console.log('[Google Calendar] Converting escaped newlines in private key')
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

// Initialize OAuth2 client
async function getOAuth2Client() {
  console.log('[Google Calendar] Getting OAuth2 client...')
  
  try {
    // Check for OAuth2 configuration first
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URL
    )

    // Use service account if available (recommended for server-to-server)
    if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
      console.log('[Google Calendar] Using service account authentication')
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
        
        const auth = new google.auth.GoogleAuth({
          credentials: serviceAccount,
          scopes: ['https://www.googleapis.com/auth/calendar']
        })
        
        console.log('[Google Calendar] Service account initialized:', {
          clientEmail: serviceAccount.client_email,
          projectId: serviceAccount.project_id
        })
        
        const client = await auth.getClient()
        console.log('[Google Calendar] Auth client obtained successfully')
        return client
      } catch (error: any) {
        console.error('Error initializing Google Service Account:', error)
        throw new Error(`Failed to initialize Google Calendar with service account: ${error.message || error}`)
      }
    }

    // Otherwise use OAuth2 with refresh token
    if (process.env.GOOGLE_REFRESH_TOKEN) {
      console.log('[Google Calendar] Using OAuth2 with refresh token')
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
function combineDateAndTime(date: string, time: string): string {
  // Ensure we have valid inputs
  if (!date || !time) throw new Error('Date and time are required')
  
  // Parse the date (YYYY-MM-DD) and time (HH:MM or HH:MM:SS)
  const [year, month, day] = date.split('-')
  const timeParts = time.split(':')
  const hour = timeParts[0].padStart(2, '0')
  const minute = timeParts[1].padStart(2, '0')
  const second = timeParts[2] ? timeParts[2].padStart(2, '0') : '00'
  
  // Create an ISO-like datetime string without timezone conversion
  // This represents the exact time entered, which will be interpreted
  // in the timezone specified in the Google Calendar event (Europe/London)
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour}:${minute}:${second}`
}

// Format booking details for calendar description
function formatBookingDetails(booking: PrivateBooking): string {
  const details = [
    `Customer: ${booking.customer_name}`,
    booking.contact_phone ? `Phone: ${booking.contact_phone}` : '',
    booking.contact_email ? `Email: ${booking.contact_email}` : '',
    booking.guest_count ? `Guests: ${booking.guest_count}` : '',
    booking.event_type ? `Type: ${booking.event_type}` : '',
    '',
    `Booking Status: ${booking.status}`,
    booking.deposit_paid_date ? '✓ Deposit Paid' : '⚠️ Deposit Required (£250)',
    '',
    'View booking: ' + process.env.NEXT_PUBLIC_APP_URL + '/private-bookings/' + booking.id
  ].filter(Boolean).join('\n')
  
  return details
}

// Create or update calendar event
export async function syncCalendarEvent(booking: PrivateBooking): Promise<string | null> {
  console.log('[Google Calendar] Starting calendar sync for booking:', {
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

    console.log('[Google Calendar] Getting auth client...')
    const auth = await getOAuth2Client()
    const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary'
    console.log('[Google Calendar] Using calendar ID:', calendarId)

    const startDateTime = combineDateAndTime(booking.event_date, booking.start_time)
    const endDateTime = booking.end_time 
      ? combineDateAndTime(booking.event_date, booking.end_time)
      : combineDateAndTime(booking.event_date, booking.start_time) // Default to 1 hour if no end time
    
    const event = {
      summary: formatEventTitle(booking),
      description: formatBookingDetails(booking),
      start: {
        dateTime: startDateTime,
        timeZone: 'Europe/London',
      },
      end: {
        dateTime: endDateTime,
        timeZone: 'Europe/London',
      },
      location: 'The Anchor Pub',
      colorId: getEventColor(booking.status),
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'email', minutes: 24 * 60 }, // 1 day before
          { method: 'popup', minutes: 60 }, // 1 hour before
        ],
      },
    }
    
    console.log('[Google Calendar] Event object prepared:', {
      summary: event.summary,
      startDateTime,
      endDateTime,
      colorId: event.colorId
    })

    let response
    
    if (booking.calendar_event_id) {
      // Update existing event
      console.log('[Google Calendar] Updating existing event:', booking.calendar_event_id)
      response = await calendar.events.update({
        auth: auth as any,
        calendarId,
        eventId: booking.calendar_event_id,
        requestBody: event,
      })
      console.log('[Google Calendar] Event updated successfully:', response.data.id)
    } else {
      // Create new event
      console.log('[Google Calendar] Creating new event...')
      response = await calendar.events.insert({
        auth: auth as any,
        calendarId,
        requestBody: event,
      })
      console.log('[Google Calendar] Event created successfully:', {
        id: response.data.id,
        link: response.data.htmlLink
      })
    }

    return response.data.id || null
  } catch (error: any) {
    // Provide more detailed error information
    console.error('[Google Calendar] Sync failed:', {
      errorCode: error.code,
      errorMessage: error.message,
      errorDetails: error.errors,
      stack: error.stack
    })
    
    if (error.message?.includes('authentication')) {
      console.error('[Google Calendar] Authentication error:', error.message)
      console.error('Please check your Google Calendar configuration in environment variables.')
    } else if (error.code === 404) {
      console.error('[Google Calendar] Calendar not found. Please check GOOGLE_CALENDAR_ID:', process.env.GOOGLE_CALENDAR_ID)
      console.error('Ensure the calendar exists and is accessible by the service account.')
    } else if (error.code === 403) {
      console.error('[Google Calendar] Permission denied. Service account email:', error.email)
      console.error('Please ensure the service account has been granted access to the calendar.')
      console.error('1. Go to Google Calendar settings')
      console.error('2. Find the calendar and click "Settings and sharing"')
      console.error('3. Under "Share with specific people", add the service account email')
      console.error('4. Grant "Make changes to events" permission')
    } else if (error.code === 400) {
      console.error('[Google Calendar] Bad request. Check the event data format.')
      console.error('Error details:', error.errors)
    } else {
      console.error('[Google Calendar] Unexpected error:', error.message || error)
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
    const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary'
    
    await calendar.events.delete({
      auth: auth as any,
      calendarId,
      eventId,
    })
    
    return true
  } catch (error: any) {
    // Handle specific errors
    if (error.code === 404) {
      // Event not found - this is okay, it may have been deleted already
      console.warn('Calendar event not found (may have been deleted already)')
      return true
    } else if (error.code === 410) {
      // Event was already deleted
      console.warn('Calendar event was already deleted')
      return true
    } else if (error.message?.includes('authentication')) {
      console.error('Google Calendar authentication error during delete:', error.message)
    } else {
      console.error('Error deleting calendar event:', error.message || error)
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
  const hasCalendarId = !!process.env.GOOGLE_CALENDAR_ID
  const hasServiceAccount = !!process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  const hasOAuth = !!(
    process.env.GOOGLE_CLIENT_ID && 
    process.env.GOOGLE_CLIENT_SECRET && 
    process.env.GOOGLE_REFRESH_TOKEN
  )
  
  console.log('[Google Calendar] Configuration check:', {
    hasCalendarId,
    calendarId: process.env.GOOGLE_CALENDAR_ID ? `${process.env.GOOGLE_CALENDAR_ID.substring(0, 10)}...` : 'NOT SET',
    hasServiceAccount,
    hasOAuth,
    isConfigured: hasCalendarId && (hasServiceAccount || hasOAuth)
  })
  
  return hasCalendarId && (hasServiceAccount || hasOAuth)
}

// Helper function to format a service account JSON for environment variable
// This is useful for converting a downloaded service account key file
export function formatServiceAccountForEnv(serviceAccountJson: string | object): string {
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

    console.log('Formatted service account key for .env.local:')
    console.log('GOOGLE_SERVICE_ACCOUNT_KEY=' + formatted)
    console.log('')
    console.log('Copy the line above to your .env.local file')
    
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
  console.log('[Google Calendar] Testing calendar connection...')
  
  try {
    if (!isCalendarConfigured()) {
      return {
        success: false,
        message: 'Google Calendar is not configured. Please check environment variables.',
        details: {
          hasCalendarId: !!process.env.GOOGLE_CALENDAR_ID,
          hasAuth: !!(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || 
                     (process.env.GOOGLE_CLIENT_ID && 
                      process.env.GOOGLE_CLIENT_SECRET && 
                      process.env.GOOGLE_REFRESH_TOKEN))
        }
      }
    }

    const auth = await getOAuth2Client()
    const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary'
    
    console.log('[Google Calendar] Testing calendar access for:', calendarId)
    
    // Try to get calendar details
    try {
      const calendarResponse = await calendar.calendars.get({
        auth: auth as any,
        calendarId: calendarId
      })
      
      console.log('[Google Calendar] Calendar access successful:', {
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
      
      console.log('[Google Calendar] Successfully listed events:', {
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
          message: `Calendar not found: ${calendarId}. Please check GOOGLE_CALENDAR_ID.`,
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
  } catch (error: any) {
    console.error('[Google Calendar] Connection test failed:', error)
    return {
      success: false,
      message: `Failed to connect: ${error.message}`,
      details: { error: error.message }
    }
  }
}