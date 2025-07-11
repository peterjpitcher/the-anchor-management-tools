import { NextResponse } from 'next/server'
import { isCalendarConfigured } from '@/lib/google-calendar'

export async function GET() {
  try {
    const calendarId = process.env.GOOGLE_CALENDAR_ID
    const hasServiceAccount = !!process.env.GOOGLE_SERVICE_ACCOUNT_KEY
    
    let serviceAccountEmail = 'NOT FOUND'
    let projectId = 'NOT FOUND'
    
    if (hasServiceAccount) {
      try {
        const parsed = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY!)
        serviceAccountEmail = parsed.client_email || 'MISSING'
        projectId = parsed.project_id || 'MISSING'
      } catch (e) {
        serviceAccountEmail = 'PARSE ERROR'
      }
    }
    
    const isConfigured = isCalendarConfigured()
    
    return NextResponse.json({
      status: 'debug',
      nodeVersion: process.version,
      calendarId: calendarId || 'NOT SET',
      hasServiceAccount,
      serviceAccountEmail,
      projectId,
      isConfigured,
      instructions: !isConfigured ? [
        '1. Make sure GOOGLE_CALENDAR_ID is set in production env vars',
        '2. Make sure GOOGLE_SERVICE_ACCOUNT_KEY is set in production env vars',
        `3. Share the calendar (${calendarId}) with: ${serviceAccountEmail}`,
        '4. Grant "Make changes to events" permission when sharing'
      ] : []
    })
  } catch (error: any) {
    return NextResponse.json({
      error: error.message,
      stack: error.stack
    }, { status: 500 })
  }
}