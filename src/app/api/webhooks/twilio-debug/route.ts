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
  console.log('=== TWILIO DEBUG WEBHOOK CALLED ===');
  
  try {
    // Get the raw body
    const body = await request.text();
    console.log('Raw body received:', body);
    
    // Parse the form data
    const formData = new URLSearchParams(body);
    const webhookData: Record<string, string> = {};
    formData.forEach((value, key) => {
      webhookData[key] = value;
    });
    
    console.log('Parsed webhook data:', JSON.stringify(webhookData, null, 2));
    
    // Log key fields
    console.log('Key fields:', {
      MessageSid: webhookData.MessageSid || webhookData.SmsSid,
      MessageStatus: webhookData.MessageStatus || webhookData.SmsStatus,
      To: webhookData.To,
      From: webhookData.From,
      ErrorCode: webhookData.ErrorCode,
      ErrorMessage: webhookData.ErrorMessage
    });
    
    const supabase = getSupabaseAdminClient();
    if (!supabase) {
      console.error('Failed to initialize Supabase admin client');
      return NextResponse.json({ 
        error: 'Internal server error',
        debug: 'Failed to initialize Supabase admin client' 
      }, { status: 500 });
    }
    
    const messageSid = webhookData.MessageSid || webhookData.SmsSid;
    
    // Try to find the message
    console.log('Looking for message with SID:', messageSid);
    
    const { data: message, error: fetchError } = await supabase
      .from('messages')
      .select('*')
      .eq('message_sid', messageSid)
      .single();
      
    console.log('Message lookup result:', { message, error: fetchError });
    
    // Also check if messages table exists and has data
    const { data: messageCount, error: countError } = await supabase
      .from('messages')
      .select('id', { count: 'exact', head: true });
      
    console.log('Messages table count:', { count: messageCount, error: countError });
    
    return NextResponse.json({ 
      success: true,
      debug: {
        webhookReceived: true,
        messageSid,
        messageFound: !!message,
        messageCount,
        webhookData: webhookData
      }
    });
    
  } catch (error) {
    console.error('Error in debug webhook:', error);
    return NextResponse.json({ 
      error: 'Internal server error',
      debug: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

// GET endpoint to test if webhook is accessible
export async function GET(request: NextRequest) {
  console.log('Debug webhook GET called');
  
  const supabase = getSupabaseAdminClient();
  
  // Test database connection
  let dbTest = { connected: false, error: null as any };
  if (supabase) {
    const { data, error } = await supabase
      .from('messages')
      .select('id', { count: 'exact', head: true });
    dbTest = { connected: !error, error };
  }
  
  return NextResponse.json({ 
    message: 'Twilio debug webhook is active',
    timestamp: new Date().toISOString(),
    environment: {
      hasSupabaseUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
      hasSupabaseKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      hasTwilioAuth: !!process.env.TWILIO_AUTH_TOKEN
    },
    database: dbTest
  });
}