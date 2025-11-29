import { NextRequest } from 'next/server';
import { checkAvailability } from '@/app/actions/table-booking-availability';
import { withApiAuth, createApiResponse, createErrorResponse } from '@/lib/api/auth';

export const dynamic = 'force-dynamic';

// Handle CORS preflight
export async function OPTIONS(request: NextRequest) {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
      'Access-Control-Max-Age': '86400',
    },
  });
}

export async function GET(request: NextRequest) {
  return withApiAuth(async (req, apiKey) => {
    try {
      // Get query parameters
      const searchParams = request.nextUrl.searchParams;
    const date = searchParams.get('date');
    const partySize = searchParams.get('party_size');
    const bookingType = searchParams.get('booking_type') as 'regular' | 'sunday_lunch' | null;

      // Validate parameters
      if (!date || !partySize) {
        return createErrorResponse(
          'Missing required parameters: date, party_size',
          'VALIDATION_ERROR',
          400
        );
      }

      const partySizeNum = parseInt(partySize);
      if (isNaN(partySizeNum) || partySizeNum < 1 || partySizeNum > 20) {
        return createErrorResponse(
          'Invalid party size. Must be between 1 and 20.',
          'VALIDATION_ERROR',
          400
        );
      }

      // Check availability
      const result = await checkAvailability(
        date,
        partySizeNum,
        bookingType || undefined
      );

      if (result.error) {
        return createErrorResponse(
          result.error,
          'DATABASE_ERROR',
          500
        );
      }

      return createApiResponse(result.data, 200, {
        'Cache-Control': 'no-store, max-age=0'
      });
    } catch (error) {
      console.error('Availability API error:', error);
      return createErrorResponse(
        'Internal server error',
        'INTERNAL_ERROR',
        500
      );
    }
  }, ['read:table_bookings'], request);
}