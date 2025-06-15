import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET() {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (!supabaseUrl || !supabaseServiceRoleKey) {
      return NextResponse.json({ error: 'Missing Supabase configuration' }, { status: 500 });
    }
    
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
    
    // Test messages query
    const { data: messages, error } = await supabase
      .from('messages')
      .select('*')
      .order('created_at', { ascending: false });
    
    // Test customers query
    const { data: customers, error: customersError } = await supabase
      .from('customers')
      .select('*')
      .order('created_at', { ascending: false });
    
    return NextResponse.json({
      messages: {
        count: messages?.length || 0,
        data: messages,
        error: error?.message
      },
      customers: {
        count: customers?.length || 0,
        data: customers?.slice(0, 3), // Just first 3 for debugging
        error: customersError?.message
      }
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}