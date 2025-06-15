import { NextRequest, NextResponse } from 'next/server';

// Test endpoint to simulate an inbound SMS from Twilio
export async function POST(request: NextRequest) {
  console.log('=== TEST INBOUND SMS ===');
  
  // Get test data from request body
  const data = await request.json();
  const { phoneNumber, message = 'Test message from customer' } = data;
  
  if (!phoneNumber) {
    return NextResponse.json({ error: 'Phone number required' }, { status: 400 });
  }

  // Simulate Twilio webhook data
  const simulatedWebhookData = new URLSearchParams({
    MessageSid: `TEST${Date.now()}`,
    AccountSid: 'ACtest',
    From: phoneNumber,
    To: process.env.TWILIO_PHONE_NUMBER || '+447700000000',
    Body: message,
    NumMedia: '0'
  });

  // Call the actual webhook endpoint
  const webhookUrl = new URL('/api/webhooks/twilio', request.url);
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: simulatedWebhookData.toString()
  });

  const result = await response.json();
  
  return NextResponse.json({
    success: true,
    message: 'Test inbound SMS sent to webhook',
    webhookResponse: result,
    testData: {
      from: phoneNumber,
      body: message,
      messageSid: simulatedWebhookData.get('MessageSid')
    }
  });
}

// GET endpoint to check if test is available
export async function GET() {
  return NextResponse.json({
    message: 'Test endpoint ready',
    usage: 'POST with { phoneNumber: "+44...", message: "Test message" }',
    example: {
      phoneNumber: '+447700123456',
      message: 'STOP'
    }
  });
}