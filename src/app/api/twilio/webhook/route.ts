// Redirect to the correct webhook endpoint
// Twilio is configured to use this URL, so we redirect to our actual endpoint

import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  console.log('=== WEBHOOK REDIRECT ===');
  console.log('Redirecting from /api/twilio/webhook to /api/webhooks/twilio');
  
  // Get the body and headers
  const body = await request.text();
  const headers = Object.fromEntries(request.headers.entries());
  
  // Forward to the correct endpoint
  const baseUrl = request.nextUrl.origin;
  const response = await fetch(`${baseUrl}/api/webhooks/twilio`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...headers
    },
    body: body
  });
  
  const result = await response.text();
  
  return new NextResponse(result, {
    status: response.status,
    headers: {
      'Content-Type': response.headers.get('Content-Type') || 'application/json'
    }
  });
}