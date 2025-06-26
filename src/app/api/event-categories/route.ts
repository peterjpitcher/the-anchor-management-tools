import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { withApiAuth, createApiResponse, createErrorResponse } from '@/lib/api/auth';

export async function GET(_request: NextRequest) {
  return withApiAuth(async (_req, _apiKey) => {
    const supabase = createAdminClient();
    
    const { data: categories, error } = await supabase
      .from('event_categories')
      .select('*')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    if (error) {
      return createErrorResponse('Failed to fetch event categories', 'DATABASE_ERROR', 500);
    }

    const formattedCategories = categories?.map(category => ({
      id: category.id,
      name: category.name,
      description: category.description,
      color: category.color,
      icon: category.icon,
      default_start_time: category.default_start_time,
      default_capacity: category.default_capacity,
      default_reminder_hours: category.default_reminder_hours,
    })) || [];

    return createApiResponse({
      categories: formattedCategories,
      meta: {
        total: formattedCategories.length,
        lastUpdated: new Date().toISOString(),
      },
    });
  }, ['read:events'], _request);
}

export async function OPTIONS(request: NextRequest) {
  return createApiResponse({}, 200);
}