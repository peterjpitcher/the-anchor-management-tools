import { NextResponse } from 'next/server'
import { testCalendarConnection, isCalendarConfigured } from '@/lib/google-calendar'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(_request: Request) {
  try {
    // Check authentication
    const supabase = createAdminClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }
    
    // Check if user has admin permissions
    const { data: profile } = await supabase
      .from('profiles')
      .select('system_role')
      .eq('id', user.id)
      .single()
    
    if (!profile || !['super_admin', 'manager'].includes(profile.system_role)) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      )
    }
    
    // Test calendar connection
    console.log('[API] Testing Google Calendar connection...')
    const result = await testCalendarConnection()
    
    // Add configuration status
    const configStatus = {
      isConfigured: isCalendarConfigured(),
      hasCalendarId: !!process.env.GOOGLE_CALENDAR_ID,
      calendarId: process.env.GOOGLE_CALENDAR_ID ? 
        (process.env.GOOGLE_CALENDAR_ID.length > 20 ? 
          `${process.env.GOOGLE_CALENDAR_ID.substring(0, 20)}...` : 
          process.env.GOOGLE_CALENDAR_ID) : 
        'NOT SET',
      authMethod: process.env.GOOGLE_SERVICE_ACCOUNT_KEY ? 
        'Service Account' : 
        (process.env.GOOGLE_REFRESH_TOKEN ? 'OAuth2' : 'None')
    }
    
    return NextResponse.json({
      ...result,
      configStatus,
      timestamp: new Date().toISOString()
    })
  } catch (error: any) {
    console.error('[API] Calendar test error:', error)
    return NextResponse.json(
      { 
        success: false,
        message: 'Internal server error',
        error: error.message 
      },
      { status: 500 }
    )
  }
}