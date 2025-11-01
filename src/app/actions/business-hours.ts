'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { logAuditEvent } from '@/app/actions/audit'
import type { BusinessHours, SpecialHours } from '@/types/business-hours'
import type { User as SupabaseUser } from '@supabase/supabase-js'

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
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

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
  date: isoDateSchema,
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

type SettingsManagePermissionResult =
  | { error: string }
  | { user: SupabaseUser; admin: ReturnType<typeof createAdminClient> }

async function requireSettingsManagePermission(): Promise<SettingsManagePermissionResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Not authenticated' }
  }

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('user_has_permission', {
    p_user_id: user.id,
    p_module_name: 'settings',
    p_action: 'manage',
  })

  if (error) {
    console.error('Settings manage permission check failed:', error)
    return { error: 'Failed to verify permissions' }
  }

  if (data !== true) {
    return { error: 'Insufficient permissions to manage business hours' }
  }

  return { user, admin }
}

export async function getBusinessHours(): Promise<{ data?: BusinessHours[], error?: string }> {
  try {
    const permission = await requireSettingsManagePermission()
    if ('error' in permission) {
      return { error: permission.error }
    }

    const { admin } = permission

    const { data, error } = await admin
      .from('business_hours')
      .select('*')
      .order('day_of_week', { ascending: true })

    if (error) throw error

    return { data: (data || []) as BusinessHours[] }
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
    const permission = await requireSettingsManagePermission()
    if ('error' in permission) {
      return { error: permission.error }
    }

    const { user, admin } = permission

    const updates = []
    for (let dayOfWeek = 0; dayOfWeek <= 6; dayOfWeek++) {
      const dayData = {
        day_of_week: dayOfWeek,
        opens: formData.get(`opens_${dayOfWeek}`) as string || '',
        closes: formData.get(`closes_${dayOfWeek}`) as string || '',
        kitchen_opens: formData.get(`kitchen_opens_${dayOfWeek}`) as string || '',
        kitchen_closes: formData.get(`kitchen_closes_${dayOfWeek}`) as string || '',
        is_closed: formData.get(`is_closed_${dayOfWeek}`) === 'true',
      }

      const validationResult = businessHoursSchema.safeParse(dayData)
      if (!validationResult.success) {
        return {
          error: `Invalid data for ${
            ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dayOfWeek]
          }: ${validationResult.error.errors[0]?.message || 'Unknown error'}`,
        }
      }

      updates.push(validationResult.data)
    }

    const updatedData = updates.map((update) => ({
      ...update,
      opens: update.is_closed ? null : update.opens,
      closes: update.is_closed ? null : update.closes,
      kitchen_opens: update.is_closed ? null : update.kitchen_opens,
      kitchen_closes: update.is_closed ? null : update.kitchen_closes,
      updated_at: new Date().toISOString(),
    }))

    const { error } = await admin
      .from('business_hours')
      .upsert(updatedData, { onConflict: 'day_of_week' })

    if (error) throw error

    await logAuditEvent({
      user_id: user.id,
      ...(user.email && { user_email: user.email }),
      operation_type: 'update',
      resource_type: 'settings',
      resource_id: 'business_hours',
      operation_status: 'success',
      new_values: { updated_days: updates.length },
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
    const permission = await requireSettingsManagePermission()
    if ('error' in permission) {
      return { error: permission.error }
    }

    const { admin } = permission

    let query = admin
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
    const permission = await requireSettingsManagePermission()
    if ('error' in permission) {
      return { error: permission.error }
    }

    const { user, admin } = permission

    const startDateInput = (formData.get('date') as string) || ''
    const endDateInputRaw = (formData.get('end_date') as string) || startDateInput

    const startDateResult = isoDateSchema.safeParse(startDateInput)
    if (!startDateResult.success) {
      return { error: 'Invalid start date format' }
    }

    const endDateResult = isoDateSchema.safeParse(endDateInputRaw)
    if (!endDateResult.success) {
      return { error: 'Invalid end date format' }
    }

    const startDate = startDateResult.data
    const endDate = endDateResult.data

    if (endDate < startDate) {
      return { error: 'End date cannot be before start date' }
    }

    // Parse form data using the validated start date
    const rawData = {
      date: startDate,
      opens: (formData.get('opens') as string) || '',
      closes: (formData.get('closes') as string) || '',
      kitchen_opens: (formData.get('kitchen_opens') as string) || '',
      kitchen_closes: (formData.get('kitchen_closes') as string) || '',
      is_closed: formData.get('is_closed') === 'true',
      is_kitchen_closed: formData.get('is_kitchen_closed') === 'true',
      note: (formData.get('note') as string) || ''
    }

    // Validate core special hours fields
    const validationResult = specialHoursSchema.safeParse(rawData)
    if (!validationResult.success) {
      return { error: validationResult.error.errors[0].message }
    }

    const validatedData = validationResult.data

    const basePayload = {
      opens: validatedData.is_closed ? null : validatedData.opens,
      closes: validatedData.is_closed ? null : validatedData.closes,
      kitchen_opens:
        validatedData.is_closed || validatedData.is_kitchen_closed
          ? null
          : validatedData.kitchen_opens,
      kitchen_closes:
        validatedData.is_closed || validatedData.is_kitchen_closed
          ? null
          : validatedData.kitchen_closes,
      is_closed: validatedData.is_closed,
      is_kitchen_closed: validatedData.is_kitchen_closed,
      note: validatedData.note
    }

    const formatDate = (dateObj: Date) => {
      const year = dateObj.getFullYear()
      const month = `${dateObj.getMonth() + 1}`.padStart(2, '0')
      const day = `${dateObj.getDate()}`.padStart(2, '0')
      return `${year}-${month}-${day}`
    }

    const startDateObj = new Date(`${startDate}T00:00:00`)
    const endDateObj = new Date(`${endDate}T00:00:00`)

    const datesToCreate: string[] = []
    for (
      let current = new Date(startDateObj.getTime());
      current <= endDateObj;
      current.setDate(current.getDate() + 1)
    ) {
      datesToCreate.push(formatDate(current))
    }

    if (datesToCreate.length === 0) {
      return { error: 'Unable to determine dates for the requested range' }
    }

    const { data: existingDates, error: existingCheckError } = await admin
      .from('special_hours')
      .select('date')
      .in('date', datesToCreate)

    if (existingCheckError) {
      throw existingCheckError
    }

    if (existingDates && existingDates.length > 0) {
      const formattedDates = existingDates
        .map(({ date }) =>
          new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
          })
        )
        .join(', ')
      return { error: `Special hours already exist for ${formattedDates}` }
    }

    const payloads = datesToCreate.map((date) => ({
      ...basePayload,
      date
    }))

    const { data, error } = await admin
      .from('special_hours')
      .insert(payloads)
      .select()

    if (error) {
      throw error
    }

    const createdRecords = Array.isArray(data)
      ? data
      : data
        ? [data]
        : []

    // Log audit event
    await logAuditEvent({
      user_id: user.id,
      ...(user.email && { user_email: user.email }),
      operation_type: 'create',
      resource_type: 'settings',
      resource_id: 'special_hours',
      operation_status: 'success',
      new_values: {
        created_dates: datesToCreate,
        records: createdRecords
      }
    })

    revalidatePath('/settings/business-hours')
    revalidatePath('/api/business/hours')
    
    return { success: true, data: createdRecords }
  } catch (error) {
    console.error('Error creating special hours:', error)
    return { error: 'Failed to create special hours' }
  }
}

export async function updateSpecialHours(id: string, formData: FormData) {
  try {
    const permission = await requireSettingsManagePermission()
    if ('error' in permission) {
      return { error: permission.error }
    }

    const { user, admin } = permission

    const { data: oldData, error: loadError } = await admin
      .from('special_hours')
      .select('*')
      .eq('id', id)
      .single()

    if (loadError) {
      console.error('Error loading special hours before update:', loadError)
      return { error: 'Failed to load special hours' }
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

    const payload = {
      ...validationResult.data,
      opens: validationResult.data.is_closed ? null : validationResult.data.opens,
      closes: validationResult.data.is_closed ? null : validationResult.data.closes,
      kitchen_opens:
        validationResult.data.is_closed || validationResult.data.is_kitchen_closed
          ? null
          : validationResult.data.kitchen_opens,
      kitchen_closes:
        validationResult.data.is_closed || validationResult.data.is_kitchen_closed
          ? null
          : validationResult.data.kitchen_closes
    }

    // Update special hours
    const { data, error } = await admin
      .from('special_hours')
      .update({
        ...payload,
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
      ...(user.email && { user_email: user.email }),
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
    const permission = await requireSettingsManagePermission()
    if ('error' in permission) {
      return { error: permission.error }
    }

    const { user, admin } = permission

    const { data: oldData, error: loadError } = await admin
      .from('special_hours')
      .select('*')
      .eq('id', id)
      .single()

    if (loadError) {
      console.error('Error loading special hours before delete:', loadError)
      return { error: 'Failed to load special hours' }
    }

    // Delete special hours
    const { error } = await admin
      .from('special_hours')
      .delete()
      .eq('id', id)

    if (error) throw error

    // Log audit event
    await logAuditEvent({
      user_id: user.id,
      ...(user.email && { user_email: user.email }),
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
