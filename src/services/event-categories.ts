import { createAdminClient } from '@/lib/supabase/admin';
import type { CategoryFormData } from '@/types/event-categories';

export class EventCategoryService {
  static async createCategory(input: CategoryFormData) {
    const admin = createAdminClient();

    const { data: maxSortOrder, error: sortOrderError } = await admin
      .from('event_categories')
      .select('sort_order')
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (sortOrderError) {
      throw new Error('Failed to load event category order');
    }

    const nextSortOrder = (maxSortOrder?.sort_order || 0) + 1;

    const slug = input.slug || input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

    const { data: category, error } = await admin
      .from('event_categories')
      .insert({
        ...input,
        slug,
        sort_order: nextSortOrder,
        default_price: input.default_price ?? 0,
        default_is_free: input.default_is_free ?? true,
        default_event_status: input.default_event_status || 'scheduled',
      })
      .select()
      .single();

    if (error) {
      console.error('Category creation error:', error);
      throw new Error('Failed to create event category');
    }

    return category;
  }

  static async updateCategory(id: string, input: CategoryFormData) {
    const admin = createAdminClient();

    const { data: oldCategory, error: loadError } = await admin
      .from('event_categories')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (loadError || !oldCategory) {
      throw new Error('Event category not found');
    }

    const slug = input.slug || input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

    const { data: category, error } = await admin
      .from('event_categories')
      .update({
        ...input,
        slug,
        default_price: input.default_price ?? oldCategory.default_price ?? 0,
        default_is_free: input.default_is_free ?? oldCategory.default_is_free ?? true,
        default_event_status: input.default_event_status || oldCategory.default_event_status || 'scheduled',
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Category update error:', error);
      throw new Error('Failed to update event category');
    }

    return { category, oldCategory };
  }

  static async deleteCategory(id: string) {
    const admin = createAdminClient();

    const { count, error: usageError } = await admin
      .from('events')
      .select('*', { count: 'exact', head: true })
      .eq('category_id', id);

    if (usageError) {
      throw new Error('Failed to validate event category usage');
    }

    if (typeof count === 'number' && count > 0) {
      throw new Error('Cannot delete category that is assigned to events');
    }

    const { data: category, error: loadError } = await admin
      .from('event_categories')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (loadError) {
      throw new Error('Failed to load event category');
    }
    if (!category) {
      throw new Error('Event category not found');
    }

    const { data: deletedCategory, error } = await admin
      .from('event_categories')
      .delete()
      .eq('id', id)
      .select('*')
      .maybeSingle();
    
    if (error) {
      throw new Error('Failed to delete event category');
    }
    if (!deletedCategory) {
      throw new Error('Event category not found');
    }

    return category;
  }
}
