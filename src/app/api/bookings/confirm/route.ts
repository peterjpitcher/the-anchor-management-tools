import { NextRequest } from 'next/server';
import { createApiResponse } from '@/lib/api/auth';

const BOOKING_METHOD_DEPRECATED_MESSAGE =
  'Event bookings are now handled via external booking links. Please use the event bookingUrl (booking_url) instead.';

export async function POST(_request: NextRequest) {
  return createApiResponse(
    {
      success: false,
      error: {
        code: 'BOOKING_METHOD_DEPRECATED',
        message: BOOKING_METHOD_DEPRECATED_MESSAGE,
      },
    },
    410,
    {
      'Cache-Control': 'no-store, max-age=0',
    }
  );
}

export async function OPTIONS(_request: NextRequest) {
  return createApiResponse(
    { success: true, data: {} },
    200,
    {
      'Cache-Control': 'no-store, max-age=0',
    }
  );
}
