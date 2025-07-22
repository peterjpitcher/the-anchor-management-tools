import { NextRequest, NextResponse } from 'next/server';
import { checkAvailability } from '@/app/actions/table-booking-availability';
import { verifyApiKey } from '@/lib/api-auth';
import { checkRateLimit, getClientIp, rateLimitConfigs } from '@/lib/rate-limiter';

export async function GET(request: NextRequest) {
  try {
    // Verify API key
    const apiKey = request.headers.get('x-api-key');
    if (!apiKey) {
      return NextResponse.json(
        { error: 'API key required' },
        { status: 401 }
      );
    }

    const { valid, error } = await verifyApiKey(apiKey, 'read:table_bookings');
    if (!valid) {
      return NextResponse.json(
        { error: error || 'Invalid API key' },
        { status: 401 }
      );
    }

    // Check rate limit
    const clientIp = await getClientIp();
    const rateLimitResult = await checkRateLimit(clientIp, rateLimitConfigs.checkAvailability);
    
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { 
          error: 'Too many availability requests. Please try again later.',
          retry_after: rateLimitResult.resetAt.toISOString()
        },
        { 
          status: 429,
          headers: {
            'X-RateLimit-Limit': rateLimitConfigs.checkAvailability.maxRequests.toString(),
            'X-RateLimit-Remaining': rateLimitResult.remaining.toString(),
            'X-RateLimit-Reset': rateLimitResult.resetAt.toISOString()
          }
        }
      );
    }

    // Get query parameters
    const searchParams = request.nextUrl.searchParams;
    const date = searchParams.get('date');
    const partySize = searchParams.get('party_size');
    const bookingType = searchParams.get('booking_type') as 'regular' | 'sunday_lunch' | null;

    // Validate parameters
    if (!date || !partySize) {
      return NextResponse.json(
        { error: 'Missing required parameters: date, party_size' },
        { status: 400 }
      );
    }

    const partySizeNum = parseInt(partySize);
    if (isNaN(partySizeNum) || partySizeNum < 1 || partySizeNum > 20) {
      return NextResponse.json(
        { error: 'Invalid party size. Must be between 1 and 20.' },
        { status: 400 }
      );
    }

    // Check availability
    const result = await checkAvailability(
      date,
      partySizeNum,
      bookingType || undefined
    );

    if (result.error) {
      return NextResponse.json(
        { error: result.error },
        { status: 500 }
      );
    }

    return NextResponse.json(result.data);
  } catch (error) {
    console.error('Availability API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}