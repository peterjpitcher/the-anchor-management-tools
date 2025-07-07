'use server'

import twilio from 'twilio'
import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'

export interface TwilioMessage {
  sid: string
  body: string
  direction: 'inbound' | 'outbound' | 'outbound-api' | 'outbound-call' | 'outbound-reply'
  status: string
  from: string
  to: string
  dateSent: Date | null
  dateCreated: Date
  errorCode: number | null
  errorMessage: string | null
  price: string | null
  priceUnit: string | null
  numSegments: string
}

export interface MessageComparison {
  twilioMessage: TwilioMessage
  dbMessage: {
    id: string
    message_sid: string
    body: string
    status: string
    created_at: string
  } | null
  isLogged: boolean
}

export async function fetchTwilioMessages(
  startDate: string,
  endDate: string,
  limit: number = 100
): Promise<{ messages?: MessageComparison[], error?: string }> {
  try {
    // Check permission
    const hasPermission = await checkUserPermission('messages', 'view')
    if (!hasPermission) {
      return { error: 'Insufficient permissions to view Twilio messages' }
    }

    const accountSid = process.env.TWILIO_ACCOUNT_SID
    const authToken = process.env.TWILIO_AUTH_TOKEN
    
    if (!accountSid || !authToken) {
      return { error: 'Twilio credentials not configured' }
    }

    const client = twilio(accountSid, authToken)
    
    // Fetch messages from Twilio
    const twilioMessages = await client.messages.list({
      dateSentAfter: new Date(startDate),
      dateSentBefore: new Date(endDate),
      limit: limit
    })

    // Get message SIDs for database lookup
    const messageSids = twilioMessages.map(msg => msg.sid)
    
    // Fetch corresponding messages from database
    const supabase = await createClient()
    const { data: dbMessages } = await supabase
      .from('messages')
      .select('id, message_sid, body, status, created_at')
      .in('message_sid', messageSids)

    // Create comparison data
    const comparisons: MessageComparison[] = twilioMessages.map(twilioMsg => {
      const dbMessage = dbMessages?.find(db => db.message_sid === twilioMsg.sid) || null
      
      return {
        twilioMessage: {
          sid: twilioMsg.sid,
          body: twilioMsg.body,
          direction: twilioMsg.direction,
          status: twilioMsg.status,
          from: twilioMsg.from,
          to: twilioMsg.to,
          dateSent: twilioMsg.dateSent,
          dateCreated: twilioMsg.dateCreated,
          errorCode: twilioMsg.errorCode,
          errorMessage: twilioMsg.errorMessage,
          price: twilioMsg.price,
          priceUnit: twilioMsg.priceUnit,
          numSegments: twilioMsg.numSegments
        },
        dbMessage,
        isLogged: !!dbMessage
      }
    })

    // Sort by date sent (newest first)
    comparisons.sort((a, b) => {
      const dateA = a.twilioMessage.dateSent || a.twilioMessage.dateCreated
      const dateB = b.twilioMessage.dateSent || b.twilioMessage.dateCreated
      return dateB.getTime() - dateA.getTime()
    })

    return { messages: comparisons }
  } catch (error) {
    console.error('Error fetching Twilio messages:', error)
    return { error: 'Failed to fetch Twilio messages' }
  }
}

export async function fetchUnloggedMessages(
  startDate: string,
  endDate: string
): Promise<{ count?: number, messages?: TwilioMessage[], error?: string }> {
  const result = await fetchTwilioMessages(startDate, endDate, 500)
  
  if (result.error || !result.messages) {
    return { error: result.error }
  }

  const unloggedMessages = result.messages
    .filter(comp => !comp.isLogged)
    .map(comp => comp.twilioMessage)

  return {
    count: unloggedMessages.length,
    messages: unloggedMessages.slice(0, 20) // Return first 20 unlogged messages
  }
}