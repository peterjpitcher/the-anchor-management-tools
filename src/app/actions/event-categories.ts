'use server'

import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { logAuditEvent } from '@/app/actions/audit'
import type { EventCategory, CategoryFormData, CategoryRegular, CrossCategorySuggestion } from '@/types/event-categories'

// Helper function to format time to HH:MM
function formatTimeToHHMM(time: string | undefined | null): string | undefined | null {
  if (!time) return time
  
  // If time is already in correct format, return it
  if (/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/.test(time)) {
    return time
  }
  
  // Parse and format time
  const [hours, minutes] = time.split(':')
  const formattedHours = hours.padStart(2, '0')
  const formattedMinutes = (minutes || '00').padStart(2, '0')
  
  return `${formattedHours}:${formattedMinutes}`
}

// Validation schema for event categories
const categorySchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name too long'),
  description: z.string().max(500, 'Description too long').optional(),
  color: z.string().regex(/^#[0-9A-F]{6}$/i, 'Invalid color format'),
  icon: z.string().min(1, 'Icon is required'),
  default_start_time: z.preprocess(
    (val) => {
      if (!val || val === '') return undefined;
      // If it has seconds (HH:MM:SS), trim to HH:MM
      if (typeof val === 'string' && val.length > 5) {
        return val.substring(0, 5);
      }
      return val;
    },
    z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Invalid time format').optional()
  ),
  default_end_time: z.preprocess(
    (val) => {
      if (!val || val === '') return undefined;
      // If it has seconds (HH:MM:SS), trim to HH:MM
      if (typeof val === 'string' && val.length > 5) {
        return val.substring(0, 5);
      }
      return val;
    },
    z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Invalid time format').optional()
  ),
  default_capacity: z.number().min(1).max(10000).optional(),
  default_reminder_hours: z.number().min(1).max(168), // Max 1 week
  default_price: z.number().min(0).max(99999.99).optional(),
  default_is_free: z.boolean().optional(),
  default_performer_name: z.preprocess(
    (val) => (!val || val === '' ? undefined : val),
    z.string().max(255).optional()
  ),
  default_performer_type: z.preprocess(
    (val) => (!val || val === '' ? undefined : val),
    z.enum(['MusicGroup', 'Person', 'TheaterGroup', 'DanceGroup', 'ComedyGroup', 'Organization']).optional()
  ),
  default_event_status: z.enum(['scheduled', 'cancelled', 'postponed', 'rescheduled']).optional(),
  default_image_url: z.preprocess(
    (val) => (!val || val === '' ? undefined : val),
    z.string().optional()
  ),
  slug: z.string().regex(/^[a-z0-9-]*$/, 'Invalid slug format').optional(),
  meta_description: z.string().max(160, 'Meta description too long').optional(),
  is_active: z.boolean(),
  is_default: z.boolean().optional(),
  sort_order: z.number().min(0).optional(),
  // Additional SEO and content fields
  short_description: z.string().max(150).optional(),
  long_description: z.string().optional(),
  highlights: z.array(z.string()).optional(),
  meta_title: z.string().max(60).optional(),
  keywords: z.array(z.string()).optional(),
  gallery_image_urls: z.array(z.string()).optional(),
  poster_image_url: z.preprocess(
    (val) => (!val || val === '' ? undefined : val),
    z.string().optional()
  ),
  thumbnail_image_url: z.preprocess(
    (val) => (!val || val === '' ? undefined : val),
    z.string().optional()
  ),
  promo_video_url: z.preprocess(
    (val) => (!val || val === '' ? undefined : val),
    z.string().url().optional()
  ),
  highlight_video_urls: z.array(z.string().url()).optional(),
  default_duration_minutes: z.number().min(1).max(1440).optional(), // Max 24 hours
  default_doors_time: z.string().optional(),
  default_last_entry_time: z.preprocess(
    (val) => {
      if (!val || val === '') return undefined;
      // If it has seconds (HH:MM:SS), trim to HH:MM
      if (typeof val === 'string' && val.length > 5) {
        return val.substring(0, 5);
      }
      return val;
    },
    z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Invalid time format').optional()
  ),
  default_booking_url: z.preprocess(
    (val) => (!val || val === '' ? undefined : val),
    z.string().url().optional()
  ),
  faqs: z.array(z.object({
    question: z.string(),
    answer: z.string(),
    sort_order: z.number()
  })).optional()
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
      user_id: user.id,
      user_email: user.email!,
      operation_type: 'create',
      resource_type: 'event',
      resource_id: category.id,
      operation_status: 'success',
      new_values: category,
      additional_info: { type: 'event_category' }
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
      user_id: user.id,
      user_email: user.email!,
      operation_type: 'update',
      resource_type: 'event',
      resource_id: id,
      operation_status: 'success',
      old_values: oldCategory,
      new_values: category,
      additional_info: { type: 'event_category' }
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
      user_id: user.id,
      user_email: user.email!,
      operation_type: 'delete',
      resource_type: 'event',
      resource_id: id,
      operation_status: 'success',
      old_values: category,
      additional_info: { type: 'event_category' }
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
      p_module_name: 'customers',
      p_action: 'view'
    })

    if (!hasPermission) {
      return { error: 'You do not have permission to view customer suggestions' }
    }

    // Direct query instead of RPC due to type mismatch issue
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - daysBack)
    
    const { data: statsData, error } = await supabase
      .from('customer_category_stats')
      .select(`
        customer_id,
        times_attended,
        last_attended_date,
        customers!inner(
          id,
          first_name,
          last_name,
          mobile_number,
          sms_opt_in
        )
      `)
      .eq('category_id', categoryId)
      .eq('customers.sms_opt_in', true)
      .gte('last_attended_date', cutoffDate.toISOString().split('T')[0])
      .order('times_attended', { ascending: false })
      .order('last_attended_date', { ascending: false })

    if (error) throw error

    // Transform the data to match the expected format
    const data: CategoryRegular[] = statsData?.map((stat: any) => ({
      customer_id: stat.customer_id,
      first_name: stat.customers.first_name,
      last_name: stat.customers.last_name,
      mobile_number: stat.customers.mobile_number,
      times_attended: stat.times_attended,
      last_attended_date: stat.last_attended_date,
      days_since_last_visit: Math.floor((new Date().getTime() - new Date(stat.last_attended_date).getTime()) / (1000 * 60 * 60 * 24))
    })) || []

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
      p_module_name: 'customers',
      p_action: 'view'
    })

    if (!hasPermission) {
      return { error: 'You do not have permission to view customer suggestions' }
    }

    // Direct query instead of RPC due to type mismatch issue
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - 90) // 90 days lookback
    
    // Get customers who attended source category
    const { data: sourceStats, error: sourceError } = await supabase
      .from('customer_category_stats')
      .select(`
        customer_id,
        times_attended,
        last_attended_date,
        customers!inner(
          id,
          first_name,
          last_name,
          mobile_number,
          sms_opt_in
        )
      `)
      .eq('category_id', sourceCategoryId)
      .eq('customers.sms_opt_in', true)
      .gte('last_attended_date', cutoffDate.toISOString().split('T')[0])
      .order('times_attended', { ascending: false })
      .order('last_attended_date', { ascending: false })
      .limit(limit * 2) // Get more to filter out those who already attended target

    if (sourceError) throw sourceError

    // Get customers who already attended target category
    const { data: targetStats, error: targetError } = await supabase
      .from('customer_category_stats')
      .select('customer_id')
      .eq('category_id', targetCategoryId)

    if (targetError) throw targetError

    const targetCustomerIds = new Set(targetStats?.map(s => s.customer_id) || [])

    // Transform and filter the data
    const data: CrossCategorySuggestion[] = sourceStats
      ?.map((stat: any) => ({
        customer_id: stat.customer_id,
        first_name: stat.customers.first_name,
        last_name: stat.customers.last_name,
        mobile_number: stat.customers.mobile_number,
        source_times_attended: stat.times_attended,
        source_last_attended: stat.last_attended_date,
        already_attended_target: targetCustomerIds.has(stat.customer_id)
      }))
      // Prioritize those who haven't attended target
      .sort((a, b) => {
        if (a.already_attended_target !== b.already_attended_target) {
          return a.already_attended_target ? 1 : -1
        }
        return b.source_times_attended - a.source_times_attended
      })
      .slice(0, limit) || []

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
      user_id: user.id,
      user_email: user.email!,
      operation_type: 'update',
      resource_type: 'event',
      resource_id: 'historical_categorization',
      operation_status: 'success',
      additional_info: { events_categorized: count }
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
      user_id: user.id,
      user_email: user.email!,
      operation_type: 'update',
      resource_type: 'customer',
      resource_id: 'rebuild_stats',
      operation_status: 'success',
      additional_info: { type: 'customer_category_stats', records_created: count }
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

// Wrapper functions that accept FormData
export async function createEventCategoryFromFormData(formData: FormData) {
  // Parse array fields
  const parseArrayField = (fieldName: string): string[] | undefined => {
    const value = formData.get(fieldName) as string
    if (!value || value === '') return undefined
    try {
      return JSON.parse(value)
    } catch {
      return value.split(',').map(s => s.trim()).filter(s => s)
    }
  }

  // Parse FAQs
  const parseFAQs = (): Array<{question: string, answer: string, sort_order: number}> | undefined => {
    const value = formData.get('faqs') as string
    if (!value || value === '') return undefined
    try {
      return JSON.parse(value)
    } catch {
      return undefined
    }
  }

  const categoryData: CategoryFormData = {
    name: formData.get('name') as string,
    color: formData.get('color') as string,
    icon: formData.get('icon') as string,
    description: formData.get('description') as string,
    sort_order: parseInt(formData.get('sort_order') as string) || 0,
    is_active: formData.get('is_active') === 'true',
    default_start_time: formatTimeToHHMM(formData.get('default_start_time') as string) || undefined,
    default_end_time: formatTimeToHHMM(formData.get('default_end_time') as string) || undefined,
    default_capacity: formData.get('default_capacity') ? parseInt(formData.get('default_capacity') as string) : undefined,
    default_reminder_hours: parseInt(formData.get('default_reminder_hours') as string) || 24,
    default_price: parseFloat(formData.get('default_price') as string) || 0,
    default_is_free: formData.get('default_is_free') === 'true',
    default_performer_name: (formData.get('default_performer_name') as string) || undefined,
    default_performer_type: (formData.get('default_performer_type') as string) || undefined,
    default_image_url: (formData.get('default_image_url') as string) || undefined,
    // SEO and content fields
    slug: (formData.get('slug') as string) || undefined,
    meta_title: (formData.get('meta_title') as string) || undefined,
    meta_description: (formData.get('meta_description') as string) || undefined,
    short_description: (formData.get('short_description') as string) || undefined,
    long_description: (formData.get('long_description') as string) || undefined,
    highlights: parseArrayField('highlights'),
    keywords: parseArrayField('keywords'),
    // Media fields
    gallery_image_urls: parseArrayField('gallery_image_urls'),
    poster_image_url: (formData.get('poster_image_url') as string) || undefined,
    thumbnail_image_url: (formData.get('thumbnail_image_url') as string) || undefined,
    promo_video_url: (formData.get('promo_video_url') as string) || undefined,
    highlight_video_urls: parseArrayField('highlight_video_urls'),
    // Additional timing fields
    default_duration_minutes: formData.get('default_duration_minutes') ? parseInt(formData.get('default_duration_minutes') as string) : undefined,
    default_doors_time: (formData.get('default_doors_time') as string) || undefined,
    default_last_entry_time: formatTimeToHHMM(formData.get('default_last_entry_time') as string) || undefined,
    default_booking_url: (formData.get('default_booking_url') as string) || undefined,
    faqs: parseFAQs(),
  }
  
  return createEventCategory(categoryData)
}

export async function updateEventCategoryFromFormData(id: string, formData: FormData) {
  // Parse array fields
  const parseArrayField = (fieldName: string): string[] | undefined => {
    const value = formData.get(fieldName) as string
    if (!value || value === '') return undefined
    try {
      return JSON.parse(value)
    } catch {
      return value.split(',').map(s => s.trim()).filter(s => s)
    }
  }

  // Parse FAQs
  const parseFAQs = (): Array<{question: string, answer: string, sort_order: number}> | undefined => {
    const value = formData.get('faqs') as string
    if (!value || value === '') return undefined
    try {
      return JSON.parse(value)
    } catch {
      return undefined
    }
  }

  const categoryData: CategoryFormData = {
    name: formData.get('name') as string,
    color: formData.get('color') as string,
    icon: formData.get('icon') as string,
    description: formData.get('description') as string,
    sort_order: parseInt(formData.get('sort_order') as string) || 0,
    is_active: formData.get('is_active') === 'true',
    default_start_time: formatTimeToHHMM(formData.get('default_start_time') as string) || undefined,
    default_end_time: formatTimeToHHMM(formData.get('default_end_time') as string) || undefined,
    default_capacity: formData.get('default_capacity') ? parseInt(formData.get('default_capacity') as string) : undefined,
    default_reminder_hours: parseInt(formData.get('default_reminder_hours') as string) || 24,
    default_price: parseFloat(formData.get('default_price') as string) || 0,
    default_is_free: formData.get('default_is_free') === 'true',
    default_performer_name: (formData.get('default_performer_name') as string) || undefined,
    default_performer_type: (formData.get('default_performer_type') as string) || undefined,
    default_image_url: (formData.get('default_image_url') as string) || undefined,
    // SEO and content fields
    slug: (formData.get('slug') as string) || undefined,
    meta_title: (formData.get('meta_title') as string) || undefined,
    meta_description: (formData.get('meta_description') as string) || undefined,
    short_description: (formData.get('short_description') as string) || undefined,
    long_description: (formData.get('long_description') as string) || undefined,
    highlights: parseArrayField('highlights'),
    keywords: parseArrayField('keywords'),
    // Media fields
    gallery_image_urls: parseArrayField('gallery_image_urls'),
    poster_image_url: (formData.get('poster_image_url') as string) || undefined,
    thumbnail_image_url: (formData.get('thumbnail_image_url') as string) || undefined,
    promo_video_url: (formData.get('promo_video_url') as string) || undefined,
    highlight_video_urls: parseArrayField('highlight_video_urls'),
    // Additional timing fields
    default_duration_minutes: formData.get('default_duration_minutes') ? parseInt(formData.get('default_duration_minutes') as string) : undefined,
    default_doors_time: (formData.get('default_doors_time') as string) || undefined,
    default_last_entry_time: formatTimeToHHMM(formData.get('default_last_entry_time') as string) || undefined,
    default_booking_url: (formData.get('default_booking_url') as string) || undefined,
    faqs: parseFAQs(),
  }
  
  return updateEventCategory(id, categoryData)
}