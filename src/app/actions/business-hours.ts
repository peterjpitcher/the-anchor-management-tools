'use server'

import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { checkUserPermission } from './rbac'
import { logAuditEvent } from '@/app/actions/audit'
import type { BusinessHours, SpecialHours } from '@/types/business-hours'

// Helper to validate time format
const timeSchema = z.preprocess(
  (val) => {
    if (val === '' || val === null || val === undefined) return null
    // If the time includes seconds, strip them off
    if (typeof val === 'string' && val.match(/^\d{1,2}:\d{2}:\d{2}$/)) {
      return val.substring(0, 5)
    }
    return val
  },
  z.union([
    z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/),
    z.null()
  ])
)

// Validation schema for business hours
const businessHoursSchema = z.object({
  day_of_week: z.number().min(0).max(6),
  opens: timeSchema,
  closes: timeSchema,
  kitchen_opens: timeSchema,
  kitchen_closes: timeSchema,
  is_closed: z.boolean()
})

// Validation schema for special hours
const specialHoursSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  opens: timeSchema,
  closes: timeSchema,
  kitchen_opens: timeSchema,
  kitchen_closes: timeSchema,
  is_closed: z.boolean(),
  is_kitchen_closed: z.boolean(),
  note: z.preprocess(
    (val) => (val === '' || val === null || val === undefined) ? null : val,
    z.union([z.string().max(500), z.null()])
  )
})

export async function getBusinessHours(): Promise<{ data?: BusinessHours[], error?: string }> {
  try {
    const supabase = await createClient()
    
    const { data, error } = await supabase
      .from('business_hours')
      .select('*')
      .order('day_of_week', { ascending: true })

    if (error) throw error

    return { data }
  } catch (error) {
    console.error('Error fetching business hours:', error)
    return { error: 'Failed to fetch business hours' }
  }
}

export async function getBusinessHoursByDay(dayOfWeek: number): Promise<{ data?: BusinessHours, error?: string }> {
  try {
    const supabase = await createClient()
    
    const { data, error } = await supabase
      .from('business_hours')
      .select('*')
      .eq('day_of_week', dayOfWeek)
      .single()

    if (error) throw error

    return { data }
  } catch (error) {
    console.error('Error fetching business hours for day:', error)
    return { error: 'Failed to fetch business hours' }
  }
}

export async function updateBusinessHours(formData: FormData) {
  try {
    // Check permission
    const hasPermission = await checkUserPermission('settings', 'manage')
    if (!hasPermission) {
      return { error: 'Insufficient permissions to manage business hours' }
    }

    const supabase = await createClient()
    
    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return { error: 'Unauthorized' }
    }

    // Parse form data for all days
    const updates = []
    for (let dayOfWeek = 0; dayOfWeek <= 6; dayOfWeek++) {
      const dayData = {
        day_of_week: dayOfWeek,
        opens: formData.get(`opens_${dayOfWeek}`) as string || '',
        closes: formData.get(`closes_${dayOfWeek}`) as string || '',
        kitchen_opens: formData.get(`kitchen_opens_${dayOfWeek}`) as string || '',
        kitchen_closes: formData.get(`kitchen_closes_${dayOfWeek}`) as string || '',
        is_closed: formData.get(`is_closed_${dayOfWeek}`) === 'true'
      }

      // Validate
      const validationResult = businessHoursSchema.safeParse(dayData)
      if (!validationResult.success) {
        console.error(`Validation error for ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dayOfWeek]}:`, validationResult.error.errors)
        console.error('Day data:', dayData)
        return { error: `Invalid data for ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dayOfWeek]}: ${validationResult.error.errors[0]?.message || 'Unknown error'}` }
      }

      updates.push(validationResult.data)
    }

    // Update all days in a single batch operation
    const updatedData = updates.map(update => ({
      ...update,
      updated_at: new Date().toISOString()
    }))

    const { error } = await supabase
      .from('business_hours')
      .upsert(updatedData, {
        onConflict: 'day_of_week'
      })

    if (error) throw error

    // Log audit event
    await logAuditEvent({
      user_id: user.id,
      user_email: user.email!,
      operation_type: 'update',
      resource_type: 'settings',
      resource_id: 'business_hours',
      operation_status: 'success',
      new_values: { updated_days: updates.length }
    })

    revalidatePath('/settings/business-hours')
    revalidatePath('/api/business/hours')
    
    return { success: true }
  } catch (error) {
    console.error('Error updating business hours:', error)
    return { error: 'Failed to update business hours' }
  }
}

export async function getSpecialHours(startDate?: string, endDate?: string): Promise<{ data?: SpecialHours[], error?: string }> {
  try {
    const supabase = await createClient()
    
    let query = supabase
      .from('special_hours')
      .select('*')
      .order('date', { ascending: true })

    if (startDate) {
      query = query.gte('date', startDate)
    }
    if (endDate) {
      query = query.lte('date', endDate)
    }

    const { data, error } = await query

    if (error) throw error

    return { data }
  } catch (error) {
    console.error('Error fetching special hours:', error)
    return { error: 'Failed to fetch special hours' }
  }
}

export async function createSpecialHours(formData: FormData) {
  try {
    // Check permission
    const hasPermission = await checkUserPermission('settings', 'manage')
    if (!hasPermission) {
      return { error: 'Insufficient permissions to manage special hours' }
    }

    const supabase = await createClient()
    
    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return { error: 'Unauthorized' }
    }

    // Parse form data
    const rawData = {
      date: formData.get('date') as string,
      opens: formData.get('opens') as string || '',
      closes: formData.get('closes') as string || '',
      kitchen_opens: formData.get('kitchen_opens') as string || '',
      kitchen_closes: formData.get('kitchen_closes') as string || '',
      is_closed: formData.get('is_closed') === 'true',
      is_kitchen_closed: formData.get('is_kitchen_closed') === 'true',
      note: formData.get('note') as string || ''
    }

    // Validate
    const validationResult = specialHoursSchema.safeParse(rawData)
    if (!validationResult.success) {
      return { error: validationResult.error.errors[0].message }
    }

    // Create special hours
    const { data, error } = await supabase
      .from('special_hours')
      .insert(validationResult.data)
      .select()
      .single()

    if (error) {
      if (error.code === '23505') { // Unique violation
        return { error: 'Special hours already exist for this date' }
      }
      throw error
    }

    // Log audit event
    await logAuditEvent({
      user_id: user.id,
      user_email: user.email!,
      operation_type: 'create',
      resource_type: 'settings',
      resource_id: 'special_hours',
      operation_status: 'success',
      new_values: data
    })

    revalidatePath('/settings/business-hours')
    revalidatePath('/api/business/hours')
    
    return { success: true, data }
  } catch (error) {
    console.error('Error creating special hours:', error)
    return { error: 'Failed to create special hours' }
  }
}

export async function updateSpecialHours(id: string, formData: FormData) {
  try {
    // Check permission
    const hasPermission = await checkUserPermission('settings', 'manage')
    if (!hasPermission) {
      return { error: 'Insufficient permissions to manage special hours' }
    }

    const supabase = await createClient()
    
    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return { error: 'Unauthorized' }
    }

    // Get old values for audit
    const { data: oldData } = await supabase
      .from('special_hours')
      .select('*')
      .eq('id', id)
      .single()

    // Parse form data
    const rawData = {
      date: formData.get('date') as string,
      opens: formData.get('opens') as string || '',
      closes: formData.get('closes') as string || '',
      kitchen_opens: formData.get('kitchen_opens') as string || '',
      kitchen_closes: formData.get('kitchen_closes') as string || '',
      is_closed: formData.get('is_closed') === 'true',
      is_kitchen_closed: formData.get('is_kitchen_closed') === 'true',
      note: formData.get('note') as string || ''
    }

    // Validate
    const validationResult = specialHoursSchema.safeParse(rawData)
    if (!validationResult.success) {
      return { error: validationResult.error.errors[0].message }
    }

    // Update special hours
    const { data, error } = await supabase
      .from('special_hours')
      .update({
        ...validationResult.data,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single()

    if (error) {
      if (error.code === '23505') { // Unique violation
        return { error: 'Special hours already exist for this date' }
      }
      throw error
    }

    // Log audit event
    await logAuditEvent({
      user_id: user.id,
      user_email: user.email!,
      operation_type: 'update',
      resource_type: 'settings',
      resource_id: 'special_hours',
      operation_status: 'success',
      old_values: oldData,
      new_values: data
    })

    revalidatePath('/settings/business-hours')
    revalidatePath('/api/business/hours')
    
    return { success: true, data }
  } catch (error) {
    console.error('Error updating special hours:', error)
    return { error: 'Failed to update special hours' }
  }
}

export async function deleteSpecialHours(id: string) {
  try {
    // Check permission
    const hasPermission = await checkUserPermission('settings', 'manage')
    if (!hasPermission) {
      return { error: 'Insufficient permissions to manage special hours' }
    }

    const supabase = await createClient()
    
    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return { error: 'Unauthorized' }
    }

    // Get data for audit
    const { data: oldData } = await supabase
      .from('special_hours')
      .select('*')
      .eq('id', id)
      .single()

    // Delete special hours
    const { error } = await supabase
      .from('special_hours')
      .delete()
      .eq('id', id)

    if (error) throw error

    // Log audit event
    await logAuditEvent({
      user_id: user.id,
      user_email: user.email!,
      operation_type: 'delete',
      resource_type: 'settings',
      resource_id: 'special_hours',
      operation_status: 'success',
      old_values: oldData
    })

    revalidatePath('/settings/business-hours')
    revalidatePath('/api/business/hours')
    
    return { success: true }
  } catch (error) {
    console.error('Error deleting special hours:', error)
    return { error: 'Failed to delete special hours' }
  }
}