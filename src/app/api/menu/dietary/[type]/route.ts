import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { withApiAuth, createApiResponse, createErrorResponse } from '@/lib/api/auth';
import { SCHEMA_AVAILABILITY, SCHEMA_DIET } from '@/lib/api/schema';

const VALID_DIETARY_TYPES = ['vegetarian', 'vegan', 'gluten-free', 'halal', 'kosher'];

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ type: string }> }
) {
  return withApiAuth(async (req, apiKey) => {
    const params = await context.params;
    const dietaryType = params.type.toLowerCase();
    
    if (!VALID_DIETARY_TYPES.includes(dietaryType)) {
      return createErrorResponse(
        `Invalid dietary type. Valid types: ${VALID_DIETARY_TYPES.join(', ')}`,
        'INVALID_PARAMETER',
        400
      );
    }

    const supabase = createAdminClient();
    
    const { data: items, error } = await supabase
      .from('menu_items')
      .select(`
        id,
        name,
        description,
        price,
        price_currency,
        calories,
        dietary_info,
        allergens,
        image_url,
        section:menu_sections!inner(
          id,
          name,
          sort_order
        )
      `)
      .eq('is_available', true)
      .contains('dietary_info', [dietaryType])
      .order('section.sort_order', { ascending: true });

    if (error) {
      return createErrorResponse('Failed to fetch menu items', 'DATABASE_ERROR', 500);
    }

    // Group items by section
    const sections = items?.reduce((acc: any[], item: any) => {
      const sectionName = item.section?.name || 'Other';
      let section = acc.find(s => s.name === sectionName);
      
      if (!section) {
        section = {
          '@type': 'MenuSection',
          name: sectionName,
          items: [],
        };
        acc.push(section);
      }
      
      section.items.push({
        '@type': 'MenuItem',
        id: item.id,
        name: item.name,
        description: item.description,
        offers: {
          '@type': 'Offer',
          price: item.price.toString(),
          priceCurrency: item.price_currency || 'GBP',
          availability: SCHEMA_AVAILABILITY.IN_STOCK,
        },
        nutrition: item.calories ? {
          '@type': 'NutritionInformation',
          calories: `${item.calories} calories`,
        } : undefined,
        dietary_info: item.dietary_info || [],
        allergens: item.allergens || [],
        image: item.image_url,
      });
      
      return acc;
    }, []) || [];

    return createApiResponse({
      dietary_type: dietaryType,
      menu_sections: sections,
      meta: {
        total_items: items?.length || 0,
        lastUpdated: new Date().toISOString(),
      },
    });
  }, ['read:menu'], request);
}

export async function OPTIONS(request: NextRequest) {
  return createApiResponse({}, 200);
}