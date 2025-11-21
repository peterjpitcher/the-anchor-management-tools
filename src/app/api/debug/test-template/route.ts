import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getMessageTemplate } from '@/lib/smsTemplates'

export async function GET(request: NextRequest) {
  try {
    // Get test parameters from query
    const searchParams = request.nextUrl.searchParams
    const eventId = searchParams.get('eventId') || '00000000-0000-0000-0000-000000000000'
    const templateType = searchParams.get('type') || 'bookingConfirmation'
    
    console.log('[API Debug] Testing template:', { eventId, templateType })
    
    // Test the RPC function directly
    const supabase = createAdminClient()
    const mappedType = templateType === 'bookingConfirmation' ? 'booking_confirmation' : 
                      templateType === 'reminderOnly' ? 'booking_reminder_confirmation' : 
                      templateType
    
    const { data: rpcResult, error: rpcError } = await supabase
      .rpc('get_message_template', {
        p_event_id: eventId,
        p_template_type: mappedType
      })
      .single()
// ... rest of file
    
    // Test the getMessageTemplate function
    const testVariables = {
      customer_name: 'Test Customer',
      first_name: 'Test',
      event_name: 'Test Event',
      event_date: '25th December',
      event_time: '7:00 PM',
      seats: '2',
      venue_name: 'The Anchor',
      contact_phone: '01753682707',
      booking_reference: 'TEST-123'
    }
    
    const templateResult = await getMessageTemplate(eventId, templateType, testVariables)
    
    // Check what templates exist
    const { data: templates } = await supabase
      .from('message_templates')
      .select('template_type, name, is_default, is_active')
      .eq('template_type', mappedType)
      .eq('is_active', true)
    
    return NextResponse.json({
      debug: {
        eventId,
        templateType,
        mappedType,
        envVarsPresent: {
          supabaseUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
          serviceRoleKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY
        }
      },
      rpcResult: {
        success: !rpcError,
        data: rpcResult,
        error: rpcError?.message
      },
      templateFunctionResult: {
        success: !!templateResult,
        result: templateResult
      },
      availableTemplates: templates
    })
  } catch (error) {
    console.error('[API Debug] Error:', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}