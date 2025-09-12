import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { withApiAuth, createApiResponse, createErrorResponse } from '@/lib/api/auth';
import { menuToSchema } from '@/lib/api/schema';

export async function GET(_request: NextRequest) {
  return withApiAuth(async (_req, _apiKey) => {
    const supabase = createAdminClient();
    
    const { data: sections, error } = await supabase
      .from('menu_sections')
      .select(`
        id,
        name,
        description,
        sort_order,
        items:menu_items(
          id,
          name,
          description,
          price,
          calories,
          dietary_info,
          allergens,
          is_available,
          is_special,
          available_from,
          available_until,
          image_url,
          sort_order
        )
      `)
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    if (error) {
      return createErrorResponse('Failed to fetch menu', 'DATABASE_ERROR', 500);
    }

    // Sort items within sections and filter available items
    const processedSections = sections?.map(section => ({
      ...section,
      items: section.items
        ?.filter((item: any) => item.is_available)
        .sort((a: any, b: any) => a.sort_order - b.sort_order),
    })) || [];

    const schemaMenu = menuToSchema(processedSections);

    return createApiResponse({
      menu: schemaMenu,
    });
  }, ['read:menu'], _request);
}

export async function OPTIONS(request: NextRequest) {
  return createApiResponse({}, 200);
}
