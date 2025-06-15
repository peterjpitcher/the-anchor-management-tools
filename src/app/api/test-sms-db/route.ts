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
  console.log('Test SMS DB endpoint called');
  
  const supabase = getSupabaseAdminClient();
  
  if (!supabase) {
    return NextResponse.json({ 
      error: 'Failed to initialize Supabase admin client',
      env: {
        hasUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
        hasKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY
      }
    }, { status: 500 });
  }

  try {
    // Test 1: Check if messages table exists
    const { data: tableCheck, error: tableError } = await supabase
      .from('messages')
      .select('id')
      .limit(1);
    
    console.log('Table check:', { data: tableCheck, error: tableError });

    // Test 2: Get a test customer
    const { data: customers, error: customerError } = await supabase
      .from('customers')
      .select('id, first_name, last_name, mobile_number, sms_opt_in, sms_delivery_failures')
      .limit(1)
      .single();
    
    console.log('Customer check:', { data: customers, error: customerError });

    if (!customers) {
      return NextResponse.json({ 
        error: 'No customers found to test with',
        customerError 
      });
    }

    // Test 3: Try to insert a test message
    const testMessage = {
      customer_id: customers.id,
      direction: 'outbound' as const,
      message_sid: `TEST_${Date.now()}`,
      twilio_message_sid: `TEST_${Date.now()}`,
      body: 'Test message from debug endpoint',
      status: 'test',
      twilio_status: 'queued'
    };

    console.log('Attempting to insert test message:', testMessage);

    const { data: insertResult, error: insertError } = await supabase
      .from('messages')
      .insert(testMessage)
      .select()
      .single();

    console.log('Insert result:', { data: insertResult, error: insertError });

    // Test 4: Count messages
    const { count, error: countError } = await supabase
      .from('messages')
      .select('*', { count: 'exact', head: true });

    return NextResponse.json({ 
      success: true,
      tests: {
        tableExists: !tableError,
        customerFound: !!customers,
        customer: customers,
        testMessageInserted: !insertError,
        insertedMessage: insertResult,
        insertError: insertError,
        totalMessageCount: count
      }
    });

  } catch (error) {
    console.error('Test endpoint error:', error);
    return NextResponse.json({ 
      error: 'Test failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

// Also create a POST endpoint to test with actual SMS data
export async function POST(request: NextRequest) {
  const supabase = getSupabaseAdminClient();
  
  if (!supabase) {
    return NextResponse.json({ error: 'Failed to initialize Supabase admin client' }, { status: 500 });
  }

  try {
    const body = await request.json();
    
    // Insert the message
    const { data, error } = await supabase
      .from('messages')
      .insert(body)
      .select()
      .single();

    return NextResponse.json({ 
      success: !error,
      data,
      error: error?.message
    });

  } catch (error) {
    return NextResponse.json({ 
      error: 'Failed to insert message',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}