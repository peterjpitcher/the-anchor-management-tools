import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import twilio from 'twilio';

// Create Supabase admin client
function getSupabaseAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    console.error('Missing Supabase URL or Service Role Key for admin client.');
    return null;
  }
  return createClient(supabaseUrl, supabaseServiceRoleKey);
}

// Verify Twilio webhook signature
function verifyTwilioSignature(request: NextRequest, body: string): boolean {
  const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
  if (!twilioAuthToken) {
    console.error('TWILIO_AUTH_TOKEN not configured');
    return false;
  }

  const twilioSignature = request.headers.get('X-Twilio-Signature');
  if (!twilioSignature) {
    console.error('Missing X-Twilio-Signature header');
    return false;
  }

  const url = request.url;
  
  // Parse body to get parameters
  const params = new URLSearchParams(body);
  const paramsObject: { [key: string]: string } = {};
  params.forEach((value, key) => {
    paramsObject[key] = value;
  });

  // Verify the signature
  return twilio.validateRequest(
    twilioAuthToken,
    twilioSignature,
    url,
    paramsObject
  );
}

// Handle inbound SMS messages from customers
async function handleInboundSMS(supabase: any, webhookData: Record<string, string>) {
  console.log('=== HANDLING INBOUND SMS ===');
  
  const messageBody = webhookData.Body.trim();
  const fromNumber = webhookData.From;
  const toNumber = webhookData.To;
  const messageSid = webhookData.MessageSid || webhookData.SmsSid;
  
  console.log('Inbound message details:', {
    from: fromNumber,
    to: toNumber,
    body: messageBody,
    sid: messageSid
  });

  // Clean phone number - remove all non-digits
  let digitsOnly = fromNumber.replace(/\D/g, '');
  
  // Create variants for UK numbers - database stores as +447990587315
  const phoneVariants = [
    fromNumber, // Original from Twilio
  ];
  
  // Twilio might send +447990587315, we need to match database format
  if (fromNumber.startsWith('+44')) {
    phoneVariants.push(fromNumber); // Already in correct format
    phoneVariants.push(fromNumber.substring(1)); // 447990587315
    phoneVariants.push('0' + fromNumber.substring(3)); // 07990587315
  }
  
  // If Twilio sends without +
  if (digitsOnly.startsWith('44')) {
    phoneVariants.push('+' + digitsOnly); // +447990587315 (database format)
    phoneVariants.push(digitsOnly); // 447990587315
    phoneVariants.push('0' + digitsOnly.substring(2)); // 07990587315
  }
  
  // If Twilio sends UK format starting with 0
  if (fromNumber.startsWith('0')) {
    phoneVariants.push('+44' + fromNumber.substring(1)); // +447990587315 (database format)
    phoneVariants.push('44' + fromNumber.substring(1)); // 447990587315
  }
  
  // Look up customer with any variant
  const orConditions = phoneVariants.map(variant => `mobile_number.eq.${variant}`).join(',');
  const { data: customers, error: customerError } = await supabase
    .from('customers')
    .select('*')
    .or(orConditions)
    .limit(1);

  if (customerError) {
    console.error('Error looking up customer:', customerError);
    return NextResponse.json({ error: 'Failed to lookup customer' }, { status: 500 });
  }

  if (!customers || customers.length === 0) {
    console.log('No customer found for phone number:', fromNumber);
    // Note: customer_id is required, so we'll skip saving unmatched messages for now
    console.log('Skipping save for unmatched inbound message (no customer_id)');
    return NextResponse.json({ success: true, message: 'Message received but not saved (no customer match)' });
  }

  const customer = customers[0];
  console.log('Found customer:', { id: customer.id, name: customer.first_name + ' ' + customer.last_name });

  // Check for STOP/UNSUBSCRIBE keywords
  const stopKeywords = ['STOP', 'UNSUBSCRIBE', 'QUIT', 'CANCEL', 'END', 'STOPALL'];
  const messageUpper = messageBody.toUpperCase();
  
  if (stopKeywords.some(keyword => messageUpper === keyword || messageUpper.startsWith(keyword + ' '))) {
    console.log('Processing opt-out request');
    
    // Update customer's SMS opt-in status
    const { error: updateError } = await supabase
      .from('customers')
      .update({ 
        sms_opt_in: false,
        updated_at: new Date().toISOString()
      })
      .eq('id', customer.id);

    if (updateError) {
      console.error('Failed to update customer opt-in status:', updateError);
    } else {
      console.log('Customer opted out successfully');
    }
  }

  // Save the inbound message
  const messageData: any = {
    customer_id: customer.id,
    direction: 'inbound',
    message_sid: messageSid,
    twilio_message_sid: messageSid,
    body: messageBody,
    status: 'received',
    twilio_status: 'received',
    created_at: new Date().toISOString()
  };

  // Add optional fields that might not exist in the schema yet
  // These will be ignored if the columns don't exist
  try {
    messageData.from_number = fromNumber;
    messageData.to_number = toNumber;
    messageData.message_type = 'sms';
  } catch (e) {
    console.log('Optional fields may not exist in schema yet');
  }

  const { error: insertError } = await supabase
    .from('messages')
    .insert(messageData);

  if (insertError) {
    console.error('Failed to save inbound message:', insertError);
    return NextResponse.json({ error: 'Failed to save message' }, { status: 500 });
  }

  console.log('Inbound message saved successfully');
  
  // TODO: Future enhancements
  // - Send automated response for HELP keyword
  // - Notify admin of inbound messages
  // - Parse booking changes/cancellations
  
  return NextResponse.json({ success: true });
}

export async function POST(request: NextRequest) {
  console.log('=== TWILIO WEBHOOK RECEIVED ===');
  console.log('Headers:', Object.fromEntries(request.headers.entries()));
  
  try {
    // Get the raw body for signature verification
    const body = await request.text();
    console.log('Raw body:', body);
    
    // Verify the webhook signature (in production)
    if (process.env.NODE_ENV === 'production') {
      const isValid = verifyTwilioSignature(request, body);
      console.log('Signature validation:', { isValid, env: process.env.NODE_ENV });
      if (!isValid) {
        console.error('Invalid Twilio webhook signature');
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    } else {
      console.log('Skipping signature validation in development');
    }

    // Parse the form data
    const formData = new URLSearchParams(body);
    const webhookData: Record<string, string> = {};
    formData.forEach((value, key) => {
      webhookData[key] = value;
    });

    console.log('Twilio webhook data:', {
      MessageSid: webhookData.MessageSid,
      MessageStatus: webhookData.MessageStatus,
      Body: webhookData.Body,
      From: webhookData.From,
      To: webhookData.To,
      ErrorCode: webhookData.ErrorCode,
      allData: webhookData
    });

    const supabase = getSupabaseAdminClient();
    if (!supabase) {
      console.error('Failed to initialize Supabase admin client');
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    // Check if this is an inbound message (has Body and From fields)
    if (webhookData.Body && webhookData.From && webhookData.To) {
      console.log('Processing INBOUND SMS message');
      return handleInboundSMS(supabase, webhookData);
    }

    // Otherwise, process as a status update
    console.log('Processing message status update');
    
    // Extract key fields from webhook
    const messageSid = webhookData.MessageSid || webhookData.SmsSid;
    const messageStatus = webhookData.MessageStatus || webhookData.SmsStatus;
    const errorCode = webhookData.ErrorCode;
    const errorMessage = webhookData.ErrorMessage;

    if (!messageSid || !messageStatus) {
      console.error('Missing required fields in webhook data');
      return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    }

    // Find the message by Twilio SID
    let { data: message, error: fetchError } = await supabase
      .from('messages')
      .select('*')
      .eq('message_sid', messageSid)
      .single();

    if (fetchError || !message) {
      console.error('Message not found for SID:', messageSid, fetchError);
      console.log('Attempting to find by twilio_message_sid instead...');
      
      // Try finding by twilio_message_sid as well
      const { data: messageAlt, error: fetchErrorAlt } = await supabase
        .from('messages')
        .select('*')
        .eq('twilio_message_sid', messageSid)
        .single();
      
      if (fetchErrorAlt || !messageAlt) {
        console.error('Message still not found by twilio_message_sid:', fetchErrorAlt);
        // Don't return error - Twilio might retry. Just log and return success.
        return NextResponse.json({ success: true });
      }
      
      message = messageAlt;
    }

    // Map Twilio status to our enum
    const statusMap: Record<string, string> = {
      'queued': 'queued',
      'sending': 'sending',
      'sent': 'sent',
      'delivered': 'delivered',
      'undelivered': 'undelivered',
      'failed': 'failed',
      'read': 'read',
      'received': 'received'
    };

    const mappedStatus = statusMap[messageStatus.toLowerCase()] || messageStatus.toLowerCase();

    // Update the message with the new status
    const updateData: any = {
      twilio_status: mappedStatus,
      status: messageStatus,
      updated_at: new Date().toISOString()
    };

    // Add timestamp based on status
    if (mappedStatus === 'sent') {
      updateData.sent_at = new Date().toISOString();
    } else if (mappedStatus === 'delivered') {
      updateData.delivered_at = new Date().toISOString();
    } else if (mappedStatus === 'failed' || mappedStatus === 'undelivered') {
      updateData.failed_at = new Date().toISOString();
      updateData.error_code = errorCode || null;
      updateData.error_message = errorMessage || null;
    }

    // Add price information if available
    if (webhookData.Price) {
      updateData.price = parseFloat(webhookData.Price);
      updateData.price_unit = webhookData.PriceUnit || 'USD';
    }

    const { error: updateError } = await supabase
      .from('messages')
      .update(updateData)
      .eq('id', message.id);

    if (updateError) {
      console.error('Failed to update message:', updateError);
      return NextResponse.json({ error: 'Failed to update message' }, { status: 500 });
    }

    // Insert status history record
    const { error: historyError } = await supabase
      .from('message_delivery_status')
      .insert({
        message_id: message.id,
        status: mappedStatus,
        error_code: errorCode || null,
        error_message: errorMessage || null,
        raw_webhook_data: webhookData
      });

    if (historyError) {
      console.error('Failed to insert status history:', historyError);
      // Don't return error - main update succeeded
    }

    console.log('Successfully processed Twilio webhook for message:', message.id);
    
    // Return success response to Twilio
    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('Error processing Twilio webhook:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// Handle Twilio's webhook validation GET request
export async function GET(request: NextRequest) {
  return NextResponse.json({ 
    message: 'Twilio webhook endpoint is active',
    timestamp: new Date().toISOString()
  });
}