'use server'

import { createClient } from '@supabase/supabase-js'
import twilio from 'twilio'

export async function importMissedMessages(startDate: string, endDate: string) {
  try {
    // Check for required environment variables
    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
      return { error: 'Twilio credentials not configured' }
    }

    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return { error: 'Supabase credentials not configured' }
    }

    const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER || '+447700106752'

    // Initialize clients
    const twilioClient = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    )
    
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )

    console.log(`Fetching messages from ${startDate} to ${endDate}`)

    // Fetch messages from Twilio
    const messages = await twilioClient.messages.list({
      to: TWILIO_PHONE_NUMBER,
      dateSentAfter: new Date(startDate),
      dateSentBefore: new Date(endDate),
      limit: 1000
    })

    // Filter for inbound messages
    const inboundMessages = messages.filter(msg => 
      msg.direction === 'inbound' || 
      (msg.to === TWILIO_PHONE_NUMBER && msg.from !== TWILIO_PHONE_NUMBER)
    )

    console.log(`Found ${inboundMessages.length} inbound messages`)

    // Check which messages already exist
    const messageSids = inboundMessages.map(m => m.sid)
    const { data: existingMessages } = await supabase
      .from('messages')
      .select('twilio_message_sid')
      .in('twilio_message_sid', messageSids)

    const existingSids = new Set(existingMessages?.map(m => m.twilio_message_sid) || [])
    const newMessages = inboundMessages.filter(m => !existingSids.has(m.sid))

    // Import each new message
    let imported = 0
    let failed = 0
    const errors: string[] = []

    for (const twilioMessage of newMessages) {
      try {
        const phoneNumber = twilioMessage.from || ''
        
        // Find or create customer
        const { data: existingCustomer } = await supabase
          .from('customers')
          .select('*')
          .eq('mobile_number', phoneNumber)
          .single()

        let customerId: string

        if (existingCustomer) {
          customerId = existingCustomer.id
        } else {
          // Create new customer
          const { data: newCustomer, error: customerError } = await supabase
            .from('customers')
            .insert({
              first_name: 'Unknown',
              last_name: phoneNumber.replace(/\D/g, '').slice(-4),
              mobile_number: phoneNumber,
              sms_opt_in: true
            })
            .select()
            .single()

          if (customerError) {
            errors.push(`Failed to create customer for ${phoneNumber}: ${customerError.message}`)
            failed++
            continue
          }

          customerId = newCustomer.id
        }

        // Insert message
        const { error: messageError } = await supabase
          .from('messages')
          .insert({
            customer_id: customerId,
            direction: 'inbound',
            message_sid: twilioMessage.sid,
            twilio_message_sid: twilioMessage.sid,
            body: twilioMessage.body || '',
            status: twilioMessage.status,
            twilio_status: twilioMessage.status,
            from_number: twilioMessage.from || '',
            to_number: twilioMessage.to || '',
            message_type: 'sms',
            created_at: twilioMessage.dateCreated || twilioMessage.dateSent,
            sent_at: twilioMessage.dateSent,
            segments: twilioMessage.numSegments?.toString() || '1'
          })

        if (messageError) {
          errors.push(`Failed to insert message ${twilioMessage.sid}: ${messageError.message}`)
          failed++
        } else {
          imported++
        }

      } catch (error) {
        errors.push(`Error processing message ${twilioMessage.sid}: ${error}`)
        failed++
      }
    }

    return {
      success: true,
      summary: {
        totalFound: messages.length,
        inboundMessages: inboundMessages.length,
        alreadyInDatabase: existingSids.size,
        imported: imported,
        failed: failed
      },
      errors: errors.length > 0 ? errors : undefined
    }

  } catch (error) {
    console.error('Import failed:', error)
    return { error: `Import failed: ${error instanceof Error ? error.message : 'Unknown error'}` }
  }
}