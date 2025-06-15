import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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

export async function POST(request: NextRequest) {
  console.log('=== DIRECT WEBHOOK TEST ===');
  
  const { phoneNumber, message = 'Test message' } = await request.json();
  
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: 'Failed to initialize database' }, { status: 500 });
  }

  // Clean phone number - remove all non-digits
  let digitsOnly = phoneNumber.replace(/\D/g, '');
  
  // Create variants for UK numbers
  const phoneVariants = [
    phoneNumber, // Original input
  ];
  
  // If it starts with 0, also try with +44
  if (phoneNumber.startsWith('0')) {
    phoneVariants.push('+44' + phoneNumber.substring(1)); // +447990587315
    phoneVariants.push('44' + phoneNumber.substring(1));  // 447990587315
  }
  
  // If it's just digits starting with 0
  if (digitsOnly.startsWith('0')) {
    phoneVariants.push('+44' + digitsOnly.substring(1)); // +447990587315
  }
  
  // If it starts with 44, try with + and with 0
  if (digitsOnly.startsWith('44')) {
    phoneVariants.push('+' + digitsOnly); // +447990587315
    phoneVariants.push('0' + digitsOnly.substring(2)); // 07990587315
  }
  
  // If it starts with +44, also try without + and with 0
  if (phoneNumber.startsWith('+44')) {
    phoneVariants.push(phoneNumber.substring(1)); // 447990587315
    phoneVariants.push('0' + phoneNumber.substring(3)); // 07990587315
  }
  
  // Look up customer with any variant
  const orConditions = phoneVariants.map(variant => `mobile_number.eq.${variant}`).join(',');
  const { data: customers, error: customerError } = await supabase
    .from('customers')
    .select('*')
    .or(orConditions)
    .limit(1);

  if (customerError) {
    return NextResponse.json({ 
      error: 'Failed to lookup customer', 
      details: customerError.message 
    }, { status: 500 });
  }

  if (!customers || customers.length === 0) {
    return NextResponse.json({ 
      error: 'No customer found',
      searchedFor: phoneVariants,
      originalInput: phoneNumber
    }, { status: 404 });
  }

  const customer = customers[0];
  
  // Try to save message
  const messageData: any = {
    customer_id: customer.id,
    direction: 'inbound',
    message_sid: `TEST${Date.now()}`,
    twilio_message_sid: `TEST${Date.now()}`,
    body: message,
    status: 'received',
    twilio_status: 'received',
    created_at: new Date().toISOString()
  };

  // Try with optional fields
  try {
    const { error: insertError } = await supabase
      .from('messages')
      .insert({
        ...messageData,
        from_number: phoneNumber,
        to_number: process.env.TWILIO_PHONE_NUMBER || '+447700000000',
        message_type: 'sms'
      });

    if (insertError) {
      // Try without optional fields
      const { error: fallbackError } = await supabase
        .from('messages')
        .insert(messageData);

      if (fallbackError) {
        return NextResponse.json({ 
          error: 'Failed to save message',
          details: fallbackError.message,
          triedWithOptionalFields: true,
          firstError: insertError.message
        }, { status: 500 });
      }
      
      return NextResponse.json({
        success: true,
        message: 'Message saved (without optional fields)',
        customer: { 
          id: customer.id, 
          name: `${customer.first_name} ${customer.last_name}`,
          phone: customer.mobile_number 
        }
      });
    }
  } catch (e) {
    return NextResponse.json({ 
      error: 'Exception during save',
      details: e instanceof Error ? e.message : 'Unknown error'
    }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    message: 'Message saved successfully',
    customer: { 
      id: customer.id, 
      name: `${customer.first_name} ${customer.last_name}`,
      phone: customer.phone
    }
  });
}

export async function GET() {
  return NextResponse.json({
    message: 'Direct webhook test endpoint',
    usage: 'POST with { phoneNumber: "07700123456", message: "Test" }',
    note: 'This bypasses Twilio signature validation for testing'
  });
}