'use server'

import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { logAuditEvent } from '@/lib/auditLog'
import type { EventCategory, CategoryFormData, CategoryRegular, CrossCategorySuggestion } from '@/types/event-categories'

// Validation schema for event categories
const categorySchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name too long'),
  description: z.string().max(500, 'Description too long').optional(),
  color: z.string().regex(/^#[0-9A-F]{6}$/i, 'Invalid color format'),
  icon: z.string().min(1, 'Icon is required'),
  default_start_time: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Invalid time format').optional(),
  default_end_time: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Invalid time format').optional(),
  default_capacity: z.number().min(1).max(10000).optional(),
  default_reminder_hours: z.number().min(1).max(168), // Max 1 week
  default_price: z.number().min(0).max(99999.99).optional(),
  default_is_free: z.boolean().optional(),
  default_performer_type: z.enum(['MusicGroup', 'Person', 'TheaterGroup', 'DanceGroup', 'ComedyGroup', 'Organization', '']).optional(),
  default_event_status: z.enum(['scheduled', 'cancelled', 'postponed', 'rescheduled']).optional(),
  default_image_url: z.string().url().optional().nullable(),
  slug: z.string().regex(/^[a-z0-9-]*$/, 'Invalid slug format').optional(),
  meta_description: z.string().max(160, 'Meta description too long').optional(),
  is_active: z.boolean(),
  is_default: z.boolean().optional(),
  sort_order: z.number().min(0).optional()
})

export async function getEventCategories(): Promise<{ data?: EventCategory[], error?: string }> {
  try {
    const supabase = await createClient()
    
    const { data, error } = await supabase
      .from('event_categories')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })

    if (error) throw error

    return { data }
  } catch (error) {
    console.error('Error fetching event categories:', error)
    return { error: 'Failed to fetch event categories' }
  }
}

export async function getActiveEventCategories(): Promise<{ data?: EventCategory[], error?: string }> {
  try {
    const supabase = await createClient()
    
    const { data, error } = await supabase
      .from('event_categories')
      .select('*')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })

    if (error) throw error

    return { data }
  } catch (error) {
    console.error('Error fetching active event categories:', error)
    return { error: 'Failed to fetch event categories' }
  }
}

export async function createEventCategory(formData: CategoryFormData) {
  try {
    const supabase = await createClient()
    
    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return { error: 'Unauthorized' }
    }

    // Validate input
    const validationResult = categorySchema.safeParse(formData)
    if (!validationResult.success) {
      return { error: validationResult.error.errors[0].message }
    }

    const data = validationResult.data

    // Get the next sort order
    const { data: maxSortOrder } = await supabase
      .from('event_categories')
      .select('sort_order')
      .order('sort_order', { ascending: false })
      .limit(1)
      .single()

    const nextSortOrder = (maxSortOrder?.sort_order || 0) + 1

    // Generate slug if not provided
    const slug = data.slug || data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')

    // Create category
    const { data: category, error } = await supabase
      .from('event_categories')
      .insert({
        ...data,
        slug,
        sort_order: nextSortOrder,
        default_price: data.default_price ?? 0,
        default_is_free: data.default_is_free ?? true,
        default_event_status: data.default_event_status || 'scheduled'
      })
      .select()
      .single()

    if (error) {
      console.error('Category creation error:', error)
      return { error: 'Failed to create event category' }
    }

    // Log audit event
    await logAuditEvent({
      userId: user.id,
      userEmail: user.email!,
      operationType: 'create',
      resourceType: 'event',
      resourceId: category.id,
      operationStatus: 'success',
      newValues: category,
      additionalInfo: { type: 'event_category' }
    })

    revalidatePath('/settings/event-categories')
    return { success: true, data: category }
  } catch (error) {
    console.error('Unexpected error creating event category:', error)
    return { error: 'An unexpected error occurred' }
  }
}

export async function updateEventCategory(id: string, formData: CategoryFormData) {
  try {
    const supabase = await createClient()
    
    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return { error: 'Unauthorized' }
    }

    // Validate input
    const validationResult = categorySchema.safeParse(formData)
    if (!validationResult.success) {
      return { error: validationResult.error.errors[0].message }
    }

    const data = validationResult.data

    // Get old values for audit
    const { data: oldCategory } = await supabase
      .from('event_categories')
      .select('*')
      .eq('id', id)
      .single()

    // Generate slug if not provided
    const slug = data.slug || data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')

    // Update category
    const { data: category, error } = await supabase
      .from('event_categories')
      .update({
        ...data,
        slug,
        default_price: data.default_price ?? oldCategory?.default_price ?? 0,
        default_is_free: data.default_is_free ?? oldCategory?.default_is_free ?? true,
        default_event_status: data.default_event_status || oldCategory?.default_event_status || 'scheduled'
      })
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Category update error:', error)
      return { error: 'Failed to update event category' }
    }

    // Log audit event
    await logAuditEvent({
      userId: user.id,
      userEmail: user.email!,
      operationType: 'update',
      resourceType: 'event',
      resourceId: id,
      operationStatus: 'success',
      oldValues: oldCategory,
      newValues: category,
      additionalInfo: { type: 'event_category' }
    })

    revalidatePath('/settings/event-categories')
    return { success: true, data: category }
  } catch (error) {
    console.error('Unexpected error updating event category:', error)
    return { error: 'An unexpected error occurred' }
  }
}

export async function deleteEventCategory(id: string) {
  try {
    const supabase = await createClient()
    
    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return { error: 'Unauthorized' }
    }

    // Check if category is in use
    const { count } = await supabase
      .from('events')
      .select('*', { count: 'exact', head: true })
      .eq('category_id', id)

    if (count && count > 0) {
      return { error: 'Cannot delete category that is assigned to events' }
    }

    // Get category details for audit log
    const { data: category } = await supabase
      .from('event_categories')
      .select('*')
      .eq('id', id)
      .single()

    // Delete category
    const { error } = await supabase
      .from('event_categories')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Category deletion error:', error)
      return { error: 'Failed to delete event category' }
    }

    // Log audit event
    await logAuditEvent({
      userId: user.id,
      userEmail: user.email!,
      operationType: 'delete',
      resourceType: 'event',
      resourceId: id,
      operationStatus: 'success',
      oldValues: category,
      additionalInfo: { type: 'event_category' }
    })

    revalidatePath('/settings/event-categories')
    return { success: true }
  } catch (error) {
    console.error('Unexpected error deleting event category:', error)
    return { error: 'An unexpected error occurred' }
  }
}

export async function getCategoryRegulars(categoryId: string, daysBack: number = 90): Promise<{ data?: CategoryRegular[], error?: string }> {
  try {
    const supabase = await createClient()
    
    // Check if user has permission to view customer data
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return { error: 'Unauthorized' }
    }

    // Check if user is manager or admin
    const { data: hasPermission } = await supabase.rpc('user_has_permission', {
      p_user_id: user.id,
      p_resource: 'customers',
      p_action: 'view'
    })

    if (!hasPermission) {
      return { error: 'You do not have permission to view customer suggestions' }
    }

    const { data, error } = await supabase.rpc('get_category_regulars', {
      p_category_id: categoryId,
      p_days_back: daysBack
    })

    if (error) throw error

    return { data }
  } catch (error) {
    console.error('Error fetching category regulars:', error)
    return { error: 'Failed to fetch category regulars' }
  }
}

export async function getCrossCategorySuggestions(
  targetCategoryId: string, 
  sourceCategoryId: string, 
  limit: number = 20
): Promise<{ data?: CrossCategorySuggestion[], error?: string }> {
  try {
    const supabase = await createClient()
    
    // Check permissions
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return { error: 'Unauthorized' }
    }

    const { data: hasPermission } = await supabase.rpc('user_has_permission', {
      p_user_id: user.id,
      p_resource: 'customers',
      p_action: 'view'
    })

    if (!hasPermission) {
      return { error: 'You do not have permission to view customer suggestions' }
    }

    const { data, error } = await supabase.rpc('get_cross_category_suggestions', {
      p_target_category_id: targetCategoryId,
      p_source_category_id: sourceCategoryId,
      p_limit: limit
    })

    if (error) throw error

    return { data }
  } catch (error) {
    console.error('Error fetching cross category suggestions:', error)
    return { error: 'Failed to fetch suggestions' }
  }
}

export async function categorizeHistoricalEvents() {
  try {
    const supabase = await createClient()
    
    // Check if user is admin
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return { error: 'Unauthorized' }
    }

    const { data: count, error } = await supabase.rpc('categorize_historical_events')

    if (error) {
      console.error('RPC error:', error)
      throw error
    }

    console.log('Categorize result:', count)

    // Log audit event
    await logAuditEvent({
      userId: user.id,
      userEmail: user.email!,
      operationType: 'update',
      resourceType: 'event',
      resourceId: 'historical_categorization',
      operationStatus: 'success',
      additionalInfo: { events_categorized: count }
    })

    return { success: true, count: count || 0 }
  } catch (error) {
    console.error('Error categorizing historical events:', error)
    return { error: error instanceof Error ? error.message : 'Failed to categorize historical events' }
  }
}

export async function rebuildCustomerCategoryStats() {
  try {
    const supabase = await createClient()
    
    // Check if user is admin
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return { error: 'Unauthorized' }
    }

    const { data: count, error } = await supabase.rpc('rebuild_customer_category_stats')

    if (error) {
      console.error('RPC error:', error)
      throw error
    }

    console.log('Rebuild stats result:', count)

    // Log audit event
    await logAuditEvent({
      userId: user.id,
      userEmail: user.email!,
      operationType: 'update',
      resourceType: 'customer',
      resourceId: 'rebuild_stats',
      operationStatus: 'success',
      additionalInfo: { type: 'customer_category_stats', records_created: count }
    })

    return { success: true, count: count || 0 }
  } catch (error) {
    console.error('Error rebuilding customer category stats:', error)
    return { error: error instanceof Error ? error.message : 'Failed to rebuild customer category stats' }
  }
}

export async function getCustomerCategoryPreferences(customerId: string) {
  try {
    const supabase = await createClient()
    
    const { data, error } = await supabase
      .from('customer_category_stats')
      .select(`
        *,
        event_categories!inner(
          id,
          name,
          color,
          icon
        )
      `)
      .eq('customer_id', customerId)
      .order('times_attended', { ascending: false })

    if (error) throw error

    return { data }
  } catch (error) {
    console.error('Error fetching customer category preferences:', error)
    return { error: 'Failed to fetch customer preferences' }
  }
}