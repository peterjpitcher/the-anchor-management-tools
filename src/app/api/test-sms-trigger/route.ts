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

export async function GET(request: NextRequest) {
  const supabase = getSupabaseAdminClient();
  
  if (!supabase) {
    return NextResponse.json({ error: 'Failed to initialize Supabase admin client' }, { status: 500 });
  }

  try {
    // Get the most recent outbound message
    const { data: message, error: fetchError } = await supabase
      .from('messages')
      .select('*')
      .eq('direction', 'outbound')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (fetchError || !message) {
      return NextResponse.json({ 
        error: 'No outbound messages found',
        fetchError 
      });
    }

    console.log('Found message:', message);

    // Get the customer before update
    const { data: customerBefore, error: customerError } = await supabase
      .from('customers')
      .select('sms_opt_in, sms_delivery_failures, last_successful_sms_at')
      .eq('id', message.customer_id)
      .single();

    console.log('Customer before update:', customerBefore);

    // Test 1: Update to delivered status
    const { error: updateError1 } = await supabase
      .from('messages')
      .update({ 
        twilio_status: 'delivered',
        delivered_at: new Date().toISOString()
      })
      .eq('id', message.id);

    if (updateError1) {
      return NextResponse.json({ 
        error: 'Failed to update message to delivered',
        updateError: updateError1 
      });
    }

    // Check customer after delivered update
    const { data: customerAfterDelivered } = await supabase
      .from('customers')
      .select('sms_opt_in, sms_delivery_failures, last_successful_sms_at')
      .eq('id', message.customer_id)
      .single();

    console.log('Customer after delivered update:', customerAfterDelivered);

    // Test 2: Update to failed status
    const { error: updateError2 } = await supabase
      .from('messages')
      .update({ 
        twilio_status: 'failed',
        error_code: '21211',
        error_message: 'Invalid phone number (test)',
        failed_at: new Date().toISOString()
      })
      .eq('id', message.id);

    // Check customer after failed update
    const { data: customerAfterFailed } = await supabase
      .from('customers')
      .select('*')
      .eq('id', message.customer_id)
      .single();

    console.log('Customer after failed update:', customerAfterFailed);

    return NextResponse.json({ 
      success: true,
      message: {
        id: message.id,
        customer_id: message.customer_id,
        status: message.status,
        twilio_status: message.twilio_status
      },
      customerUpdates: {
        before: customerBefore,
        afterDelivered: customerAfterDelivered,
        afterFailed: customerAfterFailed
      }
    });

  } catch (error) {
    console.error('Test trigger error:', error);
    return NextResponse.json({ 
      error: 'Test failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}