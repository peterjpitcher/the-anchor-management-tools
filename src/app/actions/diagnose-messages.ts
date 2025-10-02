'use server'

import { createClient } from '@supabase/supabase-js'
import twilio from 'twilio'
import { checkUserPermission } from '@/app/actions/rbac'

export async function diagnoseMessages(date: string) {
  try {
    const hasPermission = await checkUserPermission('messages', 'manage')
    if (!hasPermission) {
      return { error: 'You do not have permission to diagnose message delivery' }
    }

    // Check for required environment variables
    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
      return { error: 'Twilio credentials not configured' }
    }

    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return { error: 'Supabase credentials not configured' }
    }

    // Initialize clients
    const twilioClient = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    )
    
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )

    console.log(`Diagnosing messages for ${date}`)

    // Fetch messages from Twilio for the specific date
    const startDate = new Date(date)
    const endDate = new Date(date)
    endDate.setDate(endDate.getDate() + 1)

    const twilioMessages = await twilioClient.messages.list({
      dateSentAfter: startDate,
      dateSentBefore: endDate,
      limit: 1000
    })

    console.log(`Found ${twilioMessages.length} messages in Twilio for ${date}`)

    // Get all message SIDs
    const twilioSids = twilioMessages.map(m => m.sid)

    // Check which ones are in the database
    const { data: dbMessages } = await supabase
      .from('messages')
      .select('twilio_message_sid, created_at, direction, from_number, to_number')
      .in('twilio_message_sid', twilioSids)

    const dbSids = new Set(dbMessages?.map(m => m.twilio_message_sid) || [])

    // Find missing messages
    const missingMessages = twilioMessages.filter(m => !dbSids.has(m.sid))

    // Group by direction
    const outboundMissing = missingMessages.filter((m: any) => 
      m.direction === 'outbound-api' || 
      m.direction === 'outbound-call' || 
      m.direction === 'outbound-reply' ||
      m.direction === 'outbound'
    )

    const inboundMissing = missingMessages.filter((m: any) => m.direction === 'inbound')

    return {
      success: true,
      summary: {
        date: date,
        twilioTotal: twilioMessages.length,
        inDatabase: dbSids.size,
        missing: missingMessages.length,
        missingOutbound: outboundMissing.length,
        missingInbound: inboundMissing.length
      },
      missingMessages: missingMessages.map(m => ({
        sid: m.sid,
        direction: m.direction,
        from: m.from,
        to: m.to,
        body: m.body?.substring(0, 50) + '...',
        dateSent: m.dateSent
      }))
    }
  } catch (error) {
    console.error('Diagnosis failed:', error)
    return { error: `Diagnosis failed: ${error instanceof Error ? error.message : 'Unknown error'}` }
  }
}
