import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// WARNING: This endpoint has NO security validation
// Only use for testing/debugging webhook issues
// DO NOT use this endpoint in production

export async function POST(request: NextRequest) {
  console.log('=== UNSECURED WEBHOOK ENDPOINT ===');
  console.log('WARNING: This endpoint should only be used for testing');
  
  try {
    // Get body
    const body = await request.text();
    const params = new URLSearchParams(body);
    const webhookData: Record<string, string> = {};
    params.forEach((value, key) => {
      webhookData[key] = value;
    });
    
    console.log('Webhook data received:', webhookData);
    
    // Get Supabase client
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (!supabaseUrl || !supabaseServiceRoleKey) {
      return NextResponse.json({ error: 'Missing Supabase configuration' }, { status: 500 });
    }
    
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
    
    // Process inbound message
    if (webhookData.Body && webhookData.From && webhookData.To) {
      console.log('Processing inbound message');
      
      const messageBody = webhookData.Body.trim();
      const fromNumber = webhookData.From;
      const toNumber = webhookData.To;
      const messageSid = webhookData.MessageSid || webhookData.SmsSid || 'TEST-' + Date.now();
      
      // Look for or create customer
      const { data: customers } = await supabase
        .from('customers')
        .select('*')
        .eq('mobile_number', fromNumber)
        .limit(1);
      
      let customer;
      if (!customers || customers.length === 0) {
        // Create new customer
        const { data: newCustomer, error: createError } = await supabase
          .from('customers')
          .insert({
            first_name: 'Test',
            last_name: `(${fromNumber})`,
            mobile_number: fromNumber,
            sms_opt_in: true
          })
          .select()
          .single();
        
        if (createError) {
          console.error('Failed to create customer:', createError);
          return NextResponse.json({ error: 'Failed to create customer' }, { status: 500 });
        }
        
        customer = newCustomer;
        console.log('Created test customer:', customer.id);
      } else {
        customer = customers[0];
        console.log('Found existing customer:', customer.id);
      }
      
      // Save message
      const { data: savedMessage, error: messageError } = await supabase
        .from('messages')
        .insert({
          customer_id: customer.id,
          direction: 'inbound',
          message_sid: messageSid,
          twilio_message_sid: messageSid,
          body: messageBody,
          status: 'received',
          twilio_status: 'received',
          from_number: fromNumber,
          to_number: toNumber,
          message_type: 'sms'
        })
        .select()
        .single();
      
      if (messageError) {
        console.error('Failed to save message:', messageError);
        return NextResponse.json({ error: 'Failed to save message' }, { status: 500 });
      }
      
      console.log('Message saved successfully:', savedMessage.id);
      return NextResponse.json({ 
        success: true, 
        messageId: savedMessage.id,
        customerId: customer.id,
        warning: 'This endpoint is unsecured and should only be used for testing'
      });
    }
    
    // Process status update
    if (webhookData.MessageStatus || webhookData.SmsStatus) {
      const messageSid = webhookData.MessageSid || webhookData.SmsSid;
      const messageStatus = webhookData.MessageStatus || webhookData.SmsStatus;
      
      console.log('Processing status update:', { sid: messageSid, status: messageStatus });
      
      const { error: updateError } = await supabase
        .from('messages')
        .update({
          twilio_status: messageStatus,
          error_code: webhookData.ErrorCode,
          error_message: webhookData.ErrorMessage,
          updated_at: new Date().toISOString()
        })
        .eq('twilio_message_sid', messageSid);
      
      if (updateError) {
        console.error('Failed to update message status:', updateError);
      }
      
      return NextResponse.json({ success: true });
    }
    
    return NextResponse.json({ 
      error: 'Unknown webhook type',
      receivedData: webhookData 
    });
    
  } catch (error: any) {
    console.error('Webhook error:', error);
    return NextResponse.json({ 
      error: error.message,
      stack: error.stack 
    }, { status: 500 });
  }
}