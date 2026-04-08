import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { withApiAuth, createApiResponse, createErrorResponse } from '@/lib/api/auth';
import { getSundayLunchMenuItems } from '@/lib/table-bookings/sunday-preorder';

export async function GET(_request: NextRequest) {
  return withApiAuth(async () => {
    const supabase = createAdminClient();
    const items = await getSundayLunchMenuItems(supabase);

    if (!items || items.length === 0) {
      return createErrorResponse('Sunday lunch menu is not available', 'NOT_FOUND', 404);
    }

    const mains = items
      .filter(item => item.item_type === 'main')
      .map(item => ({
        id: item.menu_dish_id,
        name: item.name,
        price: item.price,
        dietary_info: [],
        allergens: [],
        is_available: true,
      }));

    const sides = items
      .filter(item => item.item_type === 'side')
      .map(item => ({
        id: item.menu_dish_id,
        name: item.name,
        price: item.price,
        dietary_info: [],
        allergens: [],
        is_available: true,
        included: item.price === 0,
      }));

    return createApiResponse({
      mains,
      sides,
    });
  }, ['read:menu'], _request);
}
