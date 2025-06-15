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

  // Get customer ID from query params
  const searchParams = request.nextUrl.searchParams;
  const customerId = searchParams.get('customerId') || 'ba19868e-5e0d-4fa0-a992-e54207e1c8c7'; // Default to your test customer

  try {
    // Reset customer SMS settings
    const { data, error } = await supabase
      .from('customers')
      .update({
        sms_opt_in: true,
        sms_delivery_failures: 0,
        last_sms_failure_reason: null,
        sms_deactivated_at: null,
        sms_deactivation_reason: null
      })
      .eq('id', customerId)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ 
        error: 'Failed to reset customer SMS settings',
        details: error.message 
      }, { status: 500 });
    }

    return NextResponse.json({ 
      success: true,
      message: 'Customer SMS settings reset successfully',
      customer: {
        id: data.id,
        name: `${data.first_name} ${data.last_name}`,
        mobile_number: data.mobile_number,
        sms_opt_in: data.sms_opt_in,
        sms_delivery_failures: data.sms_delivery_failures
      }
    });

  } catch (error) {
    console.error('Reset customer SMS error:', error);
    return NextResponse.json({ 
      error: 'Failed to reset customer SMS settings',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}