import { NextRequest } from 'next/server';
import { getSundayLunchMenu } from '@/app/actions/table-booking-menu';
import { checkUserPermission } from '@/app/actions/rbac';
import { withApiAuth, createApiResponse, createErrorResponse } from '@/lib/api/auth';
import { createClient } from '@/lib/supabase/server';

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
  const apiKeyHeader =
    request.headers.get('x-api-key') ??
    request.headers.get('authorization');

  if (apiKeyHeader) {
    return withApiAuth(async () => {
      try {
        const searchParams = request.nextUrl.searchParams;
        const date = searchParams.get('date');

        const result = await getSundayLunchMenu(date || undefined);

        if (result.error) {
          return createErrorResponse(result.error, 'NOT_FOUND', 404);
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

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return createErrorResponse('Authentication required', 'UNAUTHORIZED', 401);
    }

    const hasPermission = await checkUserPermission(
      'table_bookings',
      'view',
      user.id
    );

    if (!hasPermission) {
      return createErrorResponse('Insufficient permissions', 'FORBIDDEN', 403);
    }

    const searchParams = request.nextUrl.searchParams;
    const date = searchParams.get('date');

    const result = await getSundayLunchMenu(date || undefined);

    if (result.error) {
      return createErrorResponse(result.error, 'NOT_FOUND', 404);
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
}
