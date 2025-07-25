import { NextRequest } from 'next/server';
import { getSundayLunchMenu } from '@/app/actions/table-booking-menu';
import { withApiAuth, createApiResponse, createErrorResponse } from '@/lib/api/auth';

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

      // Get menu
      const result = await getSundayLunchMenu(date || undefined);

      if (result.error) {
        return createErrorResponse(
          result.error,
          'NOT_FOUND',
          404
        );
      }

      return createApiResponse(result.data);
    } catch (error) {
      console.error('Menu API error:', error);
      return createErrorResponse(
        'Internal server error',
        'INTERNAL_ERROR',
        500
      );
    }
  }, ['read:table_bookings'], request);
}