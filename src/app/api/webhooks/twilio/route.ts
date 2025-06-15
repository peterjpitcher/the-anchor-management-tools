import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import twilio from 'twilio';

// Create public Supabase client for logging (no auth required)
function getPublicSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  
  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('Missing Supabase URL or Anon Key');
    return null;
  }
  return createClient(supabaseUrl, supabaseAnonKey);
}

// Create Supabase admin client for database operations
function getSupabaseAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    console.error('Missing Supabase URL or Service Role Key for admin client.');
    return null;
  }
  return createClient(supabaseUrl, supabaseServiceRoleKey);
}

// Log webhook attempt to database
async function logWebhookAttempt(
  client: any,
  status: string,
  headers: Record<string, string>,
  body: string,
  params: Record<string, string>,
  error?: string,
  errorDetails?: any,
  additionalData?: any
) {
  try {
    const logEntry = {
      webhook_type: 'twilio',
      status,
      headers,
      body: body.substring(0, 10000), // Limit body size
      params,
      error_message: error,
      error_details: errorDetails,
      message_sid: params.MessageSid || params.SmsSid,
      from_number: params.From,
      to_number: params.To,
      message_body: params.Body?.substring(0, 1000), // Limit message size
      ...additionalData
    };
    
    const { error: logError } = await client
      .from('webhook_logs')
      .insert(logEntry);
      
    if (logError) {
      console.error('Failed to log webhook attempt:', logError);
    }
  } catch (e) {
    console.error('Exception while logging webhook:', e);
  }
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

  // Construct the full URL
  const url = request.url;
  
  // Parse form data for validation
  const params = new URLSearchParams(body);
  const paramsObject: Record<string, string> = {};
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
  const startTime = Date.now();
  console.log('=== TWILIO WEBHOOK START ===');
  console.log('Time:', new Date().toISOString());
  
  // Initialize variables for logging
  let body = '';
  let headers: Record<string, string> = {};
  let params: Record<string, string> = {};
  let publicClient: any = null;
  let adminClient: any = null;
  
  try {
    // Get headers
    headers = Object.fromEntries(request.headers.entries());
    console.log('Headers received:', headers);
    
    // Get public client for logging
    publicClient = getPublicSupabaseClient();
    if (!publicClient) {
      console.error('Failed to create public Supabase client');
    }
    
    // Get body
    body = await request.text();
    console.log('Body length:', body.length);
    console.log('Body preview:', body.substring(0, 200));
    
    // Parse parameters
    const formData = new URLSearchParams(body);
    formData.forEach((value, key) => {
      params[key] = value;
    });
    console.log('Parsed params:', params);
    
    // Log the initial webhook receipt
    if (publicClient) {
      await logWebhookAttempt(publicClient, 'received', headers, body, params);
    }
    
    // Verify signature in production
    if (process.env.NODE_ENV === 'production') {
      const isValid = verifyTwilioSignature(request, body);
      console.log('Signature validation result:', isValid);
      
      if (!isValid) {
        console.error('Invalid webhook signature');
        if (publicClient) {
          await logWebhookAttempt(publicClient, 'signature_failed', headers, body, params, 'Invalid Twilio signature');
        }
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    } else {
      console.log('Skipping signature validation (not production)');
    }
    
    // Get admin client for database operations
    adminClient = getSupabaseAdminClient();
    if (!adminClient) {
      const error = 'Failed to create admin Supabase client';
      console.error(error);
      if (publicClient) {
        await logWebhookAttempt(publicClient, 'error', headers, body, params, error);
      }
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
    
    // Determine webhook type and process
    if (params.Body && params.From && params.To) {
      console.log('Detected INBOUND SMS');
      return await handleInboundSMS(publicClient, adminClient, headers, body, params);
    } else if (params.MessageStatus || params.SmsStatus) {
      console.log('Detected STATUS UPDATE');
      return await handleStatusUpdate(publicClient, adminClient, headers, body, params);
    } else {
      console.log('Unknown webhook type');
      if (publicClient) {
        await logWebhookAttempt(publicClient, 'unknown_type', headers, body, params, 'Could not determine webhook type');
      }
      return NextResponse.json({ success: true, message: 'Unknown webhook type' });
    }
    
  } catch (error: any) {
    console.error('=== WEBHOOK ERROR ===');
    console.error('Error:', error);
    console.error('Stack:', error.stack);
    
    // Try to log the error
    if (publicClient) {
      await logWebhookAttempt(
        publicClient, 
        'exception', 
        headers, 
        body, 
        params, 
        error.message, 
        { stack: error.stack, name: error.name }
      );
    }
    
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  } finally {
    const duration = Date.now() - startTime;
    console.log(`=== WEBHOOK END (${duration}ms) ===`);
  }
}

async function handleInboundSMS(
  publicClient: any,
  adminClient: any,
  headers: Record<string, string>,
  body: string,
  params: Record<string, string>
) {
  console.log('=== PROCESSING INBOUND SMS ===');
  
  try {
    const messageBody = params.Body.trim();
    const fromNumber = params.From;
    const toNumber = params.To;
    const messageSid = params.MessageSid || params.SmsSid;
    
    console.log('Message details:', { from: fromNumber, to: toNumber, sid: messageSid, bodyLength: messageBody.length });
    
    // Look up or create customer
    let customer;
    
    // Try to find existing customer
    const phoneVariants = generatePhoneVariants(fromNumber);
    console.log('Searching for customer with phone variants:', phoneVariants);
    
    const orConditions = phoneVariants.map(variant => `mobile_number.eq.${variant}`).join(',');
    const { data: customers, error: customerError } = await adminClient
      .from('customers')
      .select('*')
      .or(orConditions)
      .limit(1);
    
    if (customerError) {
      throw new Error(`Customer lookup failed: ${customerError.message}`);
    }
    
    if (!customers || customers.length === 0) {
      console.log('No existing customer found, creating new one');
      
      // Create new customer
      const { data: newCustomer, error: createError } = await adminClient
        .from('customers')
        .insert({
          first_name: 'Unknown',
          last_name: `(${fromNumber})`,
          mobile_number: fromNumber,
          sms_opt_in: true
        })
        .select()
        .single();
      
      if (createError) {
        throw new Error(`Failed to create customer: ${createError.message}`);
      }
      
      customer = newCustomer;
      console.log('Created new customer:', customer.id);
    } else {
      customer = customers[0];
      console.log('Found existing customer:', customer.id);
    }
    
    // Check for opt-out keywords
    const stopKeywords = ['STOP', 'UNSUBSCRIBE', 'QUIT', 'CANCEL', 'END', 'STOPALL'];
    const messageUpper = messageBody.toUpperCase();
    const isOptOut = stopKeywords.some(keyword => messageUpper === keyword || messageUpper.startsWith(keyword + ' '));
    
    if (isOptOut) {
      console.log('Processing opt-out request');
      const { error: optOutError } = await adminClient
        .from('customers')
        .update({ sms_opt_in: false })
        .eq('id', customer.id);
      
      if (optOutError) {
        console.error('Failed to update opt-out status:', optOutError);
      }
    }
    
    // Save the message
    const messageData = {
      customer_id: customer.id,
      direction: 'inbound' as const,
      message_sid: messageSid,
      twilio_message_sid: messageSid,
      body: messageBody,
      status: 'received',
      twilio_status: 'received',
      from_number: fromNumber,
      to_number: toNumber,
      message_type: 'sms'
    };
    
    console.log('Saving message with data:', messageData);
    
    const { data: savedMessage, error: messageError } = await adminClient
      .from('messages')
      .insert(messageData)
      .select()
      .single();
    
    if (messageError) {
      throw new Error(`Failed to save message: ${messageError.message}`);
    }
    
    console.log('Message saved successfully:', savedMessage.id);
    
    // Log success
    if (publicClient) {
      await logWebhookAttempt(
        publicClient,
        'success',
        headers,
        body,
        params,
        null,
        null,
        { customer_id: customer.id, message_id: savedMessage.id }
      );
    }
    
    return NextResponse.json({ success: true, messageId: savedMessage.id });
    
  } catch (error: any) {
    console.error('Error in handleInboundSMS:', error);
    
    if (publicClient) {
      await logWebhookAttempt(
        publicClient,
        'error',
        headers,
        body,
        params,
        error.message,
        { stack: error.stack }
      );
    }
    
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

async function handleStatusUpdate(
  publicClient: any,
  adminClient: any,
  headers: Record<string, string>,
  body: string,
  params: Record<string, string>
) {
  console.log('=== PROCESSING STATUS UPDATE ===');
  
  try {
    const messageSid = params.MessageSid || params.SmsSid;
    const messageStatus = params.MessageStatus || params.SmsStatus;
    const errorCode = params.ErrorCode;
    const errorMessage = params.ErrorMessage;
    
    console.log('Status update:', { sid: messageSid, status: messageStatus, errorCode });
    
    if (!messageSid || !messageStatus) {
      throw new Error('Missing required fields: MessageSid or MessageStatus');
    }
    
    // Update message status
    const { data: message, error: updateError } = await adminClient
      .from('messages')
      .update({
        twilio_status: messageStatus,
        error_code: errorCode,
        error_message: errorMessage,
        updated_at: new Date().toISOString(),
        ...(messageStatus === 'delivered' && { delivered_at: new Date().toISOString() }),
        ...(messageStatus === 'failed' && { failed_at: new Date().toISOString() }),
        ...(messageStatus === 'sent' && { sent_at: new Date().toISOString() })
      })
      .eq('twilio_message_sid', messageSid)
      .select()
      .single();
    
    if (updateError) {
      console.error('Failed to update message:', updateError);
      // Don't throw - message might not exist yet
    }
    
    // Save status history
    const { error: historyError } = await adminClient
      .from('message_delivery_status')
      .insert({
        message_id: message?.id,
        status: messageStatus,
        error_code: errorCode,
        error_message: errorMessage,
        raw_webhook_data: params
      });
    
    if (historyError) {
      console.error('Failed to save status history:', historyError);
    }
    
    // Log success
    if (publicClient) {
      await logWebhookAttempt(
        publicClient,
        'success',
        headers,
        body,
        params,
        null,
        null,
        { message_id: message?.id }
      );
    }
    
    return NextResponse.json({ success: true });
    
  } catch (error: any) {
    console.error('Error in handleStatusUpdate:', error);
    
    if (publicClient) {
      await logWebhookAttempt(
        publicClient,
        'error',
        headers,
        body,
        params,
        error.message,
        { stack: error.stack }
      );
    }
    
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

function generatePhoneVariants(phone: string): string[] {
  const variants = [phone];
  const digitsOnly = phone.replace(/\D/g, '');
  
  // UK number handling
  if (phone.startsWith('+44') || digitsOnly.startsWith('44')) {
    variants.push('+44' + digitsOnly.substring(2));
    variants.push('44' + digitsOnly.substring(2));
    variants.push('0' + digitsOnly.substring(2));
  }
  
  if (phone.startsWith('0')) {
    variants.push('+44' + phone.substring(1));
    variants.push('44' + phone.substring(1));
  }
  
  return [...new Set(variants)];
}