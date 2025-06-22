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

    // Get the Twilio phone number(s) - could be multiple or messaging service
    const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER || '+447700106752'
    const MESSAGING_SERVICE_SID = process.env.TWILIO_MESSAGING_SERVICE_SID
    
    console.log('Using Twilio phone number:', TWILIO_PHONE_NUMBER)
    if (MESSAGING_SERVICE_SID) {
      console.log('Using Messaging Service SID:', MESSAGING_SERVICE_SID)
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

    console.log(`Fetching messages from ${startDate} to ${endDate}`)

    // Fetch ALL messages in the date range without filtering by phone number
    // This ensures we get messages sent via messaging service or any phone number
    let allMessages: any[] = []
    
    try {
      // Fetch with pagination to get ALL messages
      await twilioClient.messages.each({
        dateSentAfter: new Date(startDate),
        dateSentBefore: new Date(endDate),
        pageSize: 100
      }, (message) => {
        allMessages.push(message)
      })
    } catch (error) {
      console.error('Error fetching messages:', error)
      // Fallback to list method if each() fails
      allMessages = await twilioClient.messages.list({
        dateSentAfter: new Date(startDate),
        dateSentBefore: new Date(endDate),
        limit: 1000
      })
    }
    
    const messages = allMessages
    console.log(`Found ${messages.length} total messages from Twilio`)

    console.log(`Found ${messages.length} total messages`)

    // Separate inbound and outbound messages
    // Check multiple ways to identify your messages
    const yourPhoneNumbers = [TWILIO_PHONE_NUMBER]
    if (MESSAGING_SERVICE_SID) {
      // When using messaging service, the 'from' might be the service SID
      yourPhoneNumbers.push(MESSAGING_SERVICE_SID)
    }
    
    const inboundMessages = messages.filter(msg => 
      msg.direction === 'inbound'
    )
    
    const outboundMessages = messages.filter(msg => 
      msg.direction === 'outbound-api' || 
      msg.direction === 'outbound-call' || 
      msg.direction === 'outbound-reply' ||
      msg.direction === 'outbound'
    )

    console.log(`Found ${inboundMessages.length} inbound and ${outboundMessages.length} outbound messages`)

    // Check which messages already exist
    const combinedMessages = [...inboundMessages, ...outboundMessages]
    const messageSids = combinedMessages.map(m => m.sid)
    const { data: existingMessages } = await supabase
      .from('messages')
      .select('twilio_message_sid')
      .in('twilio_message_sid', messageSids)

    const existingSids = new Set(existingMessages?.map(m => m.twilio_message_sid) || [])
    const newMessages = combinedMessages.filter(m => !existingSids.has(m.sid))

    console.log(`${newMessages.length} messages need to be imported`)
    console.log(`${existingSids.size} messages already in database`)
    
    // Log sample of messages for debugging
    if (messages.length > 0) {
      console.log('Sample message:', {
        sid: messages[0].sid,
        direction: messages[0].direction,
        from: messages[0].from,
        to: messages[0].to,
        dateSent: messages[0].dateSent,
        body: messages[0].body?.substring(0, 50) + '...'
      })
    }

    // Get all unique phone numbers from new messages
    const phoneNumbers = new Set<string>()
    newMessages.forEach(msg => {
      const phone = msg.direction === 'inbound' ? msg.from : msg.to
      if (phone) phoneNumbers.add(phone)
    })

    // Batch fetch existing customers
    const { data: existingCustomers } = await supabase
      .from('customers')
      .select('*')
      .in('mobile_number', Array.from(phoneNumbers))

    // Create a map for quick lookup
    const customerMap = new Map(
      existingCustomers?.map(c => [c.mobile_number, c]) || []
    )

    // Prepare customers to create
    const customersToCreate = []
    for (const phone of phoneNumbers) {
      if (!customerMap.has(phone)) {
        customersToCreate.push({
          first_name: 'Unknown',
          last_name: phone.replace(/\D/g, '').slice(-4),
          mobile_number: phone,
          sms_opt_in: true
        })
      }
    }

    // Batch create new customers
    if (customersToCreate.length > 0) {
      const { data: newCustomers, error: createError } = await supabase
        .from('customers')
        .insert(customersToCreate)
        .select()

      if (createError) {
        console.error('Failed to create customers:', createError)
      } else if (newCustomers) {
        // Add new customers to the map
        newCustomers.forEach(c => customerMap.set(c.mobile_number, c))
      }
    }

    // Import each new message
    let imported = 0
    let failed = 0
    const errors: string[] = []
    const messagesToInsert = []

    for (const twilioMessage of newMessages) {
      try {
        // Determine if message is inbound or outbound based on direction field
        const isInbound = twilioMessage.direction === 'inbound'
        
        // For inbound: customer phone is 'from', for outbound: customer phone is 'to'
        const customerPhone = isInbound ? twilioMessage.from : twilioMessage.to
        
        if (!customerPhone) {
          errors.push(`No phone number found for message ${twilioMessage.sid}`)
          failed++
          continue
        }
        
        // Get customer from map
        const customer = customerMap.get(customerPhone)
        if (!customer) {
          errors.push(`Customer not found for ${customerPhone}`)
          failed++
          continue
        }

        const customerId = customer.id

        // Calculate cost for outbound messages
        let segments = 1
        let costUsd = 0
        if (!isInbound && twilioMessage.body) {
          segments = twilioMessage.numSegments || (twilioMessage.body.length <= 160 ? 1 : Math.ceil(twilioMessage.body.length / 153))
          costUsd = segments * 0.04 // Approximate UK SMS cost
        }

        // Collect message data for batch insert
        messagesToInsert.push({
          customer_id: customerId,
          direction: isInbound ? 'inbound' : 'outbound',
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
          segments: segments,
          cost_usd: costUsd,
          is_read: !isInbound // Mark outbound as read
        })

      } catch (error) {
        errors.push(`Error processing message ${twilioMessage.sid}: ${error}`)
        failed++
      }
    }

    // Batch insert all messages
    if (messagesToInsert.length > 0) {
      const { data: insertedMessages, error: batchError } = await supabase
        .from('messages')
        .insert(messagesToInsert)
        .select()

      if (batchError) {
        console.error('Failed to batch insert messages:', batchError)
        failed += messagesToInsert.length
        errors.push(`Failed to batch insert ${messagesToInsert.length} messages: ${batchError.message}`)
      } else {
        imported = insertedMessages?.length || 0
      }
    }

    return {
      success: true,
      summary: {
        totalFound: messages.length,
        inboundMessages: inboundMessages.length,
        outboundMessages: outboundMessages.length,
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