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
      ErrorCode: webhookData.ErrorCode,
      allData: webhookData
    });

    const supabase = getSupabaseAdminClient();
    if (!supabase) {
      console.error('Failed to initialize Supabase admin client');
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

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