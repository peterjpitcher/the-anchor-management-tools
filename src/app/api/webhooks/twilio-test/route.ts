import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  console.log('=== TWILIO TEST WEBHOOK RECEIVED ===');
  
  try {
    // Log all headers
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key] = value;
    });
    console.log('Headers:', headers);
    
    // Get the raw body
    const body = await request.text();
    console.log('Raw body:', body);
    
    // Parse form data
    const formData = new URLSearchParams(body);
    const data: Record<string, string> = {};
    formData.forEach((value, key) => {
      data[key] = value;
    });
    
    console.log('Parsed data:', data);
    
    // Check what type of webhook this is
    const isInbound = !!(data.Body && data.From && data.To);
    const isStatusUpdate = !!(data.MessageStatus || data.SmsStatus);
    
    return NextResponse.json({ 
      success: true,
      receivedAt: new Date().toISOString(),
      type: isInbound ? 'inbound_message' : (isStatusUpdate ? 'status_update' : 'unknown'),
      data: {
        // Inbound fields
        body: data.Body,
        from: data.From,
        to: data.To,
        // Status fields
        messageSid: data.MessageSid || data.SmsSid,
        status: data.MessageStatus || data.SmsStatus,
        // All data
        allFields: Object.keys(data)
      }
    });
    
  } catch (error) {
    console.error('Error in test webhook:', error);
    return NextResponse.json({ 
      error: 'Failed to process', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    message: 'Twilio test webhook endpoint',
    purpose: 'Logs all incoming data to help debug webhook issues',
    usage: 'Configure Twilio to send webhooks here temporarily for testing'
  });
}