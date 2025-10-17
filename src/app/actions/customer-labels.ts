'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { logAuditEvent } from './audit'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import type { User as SupabaseUser } from '@supabase/supabase-js'

// Validation schemas
const CustomerLabelSchema = z.object({
  name: z.string().min(1, 'Label name is required').max(255),
  description: z.string().optional(),
  color: z.string().regex(/^#[0-9A-F]{6}$/i, 'Invalid color format'),
  icon: z.string().optional(),
  auto_apply_rules: z.any().optional()
})

const AssignLabelSchema = z.object({
  customer_id: z.string().uuid(),
  label_id: z.string().uuid(),
  notes: z.string().optional()
})

type CustomerPermissionAction = 'view' | 'edit' | 'manage'

type CustomerPermissionResult =
  | { user: SupabaseUser; admin: ReturnType<typeof createAdminClient> }
  | { error: string }

async function requireCustomerPermission(action: CustomerPermissionAction): Promise<CustomerPermissionResult> {
  const supabase = await createClient()
  const {
    data: { user }
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Not authenticated' }
  }

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('user_has_permission', {
    p_user_id: user.id,
    p_module_name: 'customers',
    p_action: action
  })

  if (error) {
    console.error('Customer permission check failed:', error)
    return { error: 'Failed to verify permissions' }
  }

  if (data !== true) {
    return { error: 'Insufficient permissions' }
  }

  return { user, admin }
}

export interface CustomerLabel {
  id: string
  name: string
  description?: string
  color: string
  icon?: string
  auto_apply_rules?: any
  created_at: string
  updated_at: string
}

export interface CustomerLabelAssignment {
  id: string
  customer_id: string
  label_id: string
  assigned_at: string
  assigned_by?: string
  auto_assigned: boolean
  notes?: string
  label?: CustomerLabel
}

export async function getCustomerLabels(): Promise<{ data?: CustomerLabel[], error?: string }> {
  try {
    const permission = await requireCustomerPermission('view')
    if ('error' in permission) {
      return { error: permission.error }
    }

    const { admin } = permission

    const { data, error } = await admin
      .from('customer_labels')
      .select('*')
      .order('name')

    if (error) throw error

    return { data: (data || []) as CustomerLabel[] }
  } catch (error) {
    console.error('Error fetching customer labels:', error)
    return { error: 'Failed to fetch customer labels' }
  }
}

export async function createCustomerLabel(
  labelData: Omit<CustomerLabel, 'id' | 'created_at' | 'updated_at'>
): Promise<{ data?: CustomerLabel, error?: string }> {
  try {
    const permission = await requireCustomerPermission('manage')
    if ('error' in permission) {
      return { error: permission.error }
    }

    const { user, admin } = permission

    // Validate data
    const validatedData = CustomerLabelSchema.parse(labelData)

    const { data, error } = await admin
      .from('customer_labels')
      .insert(validatedData)
      .select()
      .single()

    if (error) throw error

    // Log audit event
    await logAuditEvent({
      user_id: user.id,
      ...(user.email && { user_email: user.email }),
      operation_type: 'create',
      resource_type: 'customer_label',
      resource_id: data.id,
      operation_status: 'success',
      new_values: { name: data.name }
    })

    revalidatePath('/customers')
    return { data }
  } catch (error) {
    console.error('Error creating customer label:', error)
    return { error: 'Failed to create customer label' }
  }
}

export async function updateCustomerLabel(
  id: string,
  labelData: Partial<Omit<CustomerLabel, 'id' | 'created_at' | 'updated_at'>>
): Promise<{ success?: boolean, error?: string }> {
  try {
    const permission = await requireCustomerPermission('manage')
    if ('error' in permission) {
      return { error: permission.error }
    }

    const { user, admin } = permission

    const { data: existing, error: fetchError } = await admin
      .from('customer_labels')
      .select('*')
      .eq('id', id)
      .maybeSingle()

    if (fetchError) {
      console.error('Error loading customer label before update:', fetchError)
      return { error: 'Failed to load customer label' }
    }

    if (!existing) {
      return { error: 'Customer label not found' }
    }

    const { data, error } = await admin
      .from('customer_labels')
      .update(labelData)
      .eq('id', id)
      .select()
      .single()

    if (error) throw error

    // Log audit event
    await logAuditEvent({
      user_id: user.id,
      ...(user.email && { user_email: user.email }),
      operation_type: 'update',
      resource_type: 'customer_label',
      resource_id: id,
      operation_status: 'success',
      old_values: existing,
      new_values: data
    })

    revalidatePath('/customers')
    return { success: true }
  } catch (error) {
    console.error('Error updating customer label:', error)
    return { error: 'Failed to update customer label' }
  }
}

export async function deleteCustomerLabel(id: string): Promise<{ success?: boolean, error?: string }> {
  try {
    const permission = await requireCustomerPermission('manage')
    if ('error' in permission) {
      return { error: permission.error }
    }

    const { user, admin } = permission

    const { data: label, error: fetchError } = await admin
      .from('customer_labels')
      .select('*')
      .eq('id', id)
      .maybeSingle()

    if (fetchError) {
      console.error('Error loading customer label before delete:', fetchError)
      return { error: 'Failed to load customer label' }
    }

    if (!label) {
      return { error: 'Customer label not found' }
    }

    const { error } = await admin
      .from('customer_labels')
      .delete()
      .eq('id', id)

    if (error) throw error

    // Log audit event
    await logAuditEvent({
      user_id: user.id,
      ...(user.email && { user_email: user.email }),
      operation_type: 'delete',
      resource_type: 'customer_label',
      resource_id: id,
      operation_status: 'success',
      old_values: { name: label.name }
    })

    revalidatePath('/customers')
    return { success: true }
  } catch (error) {
    console.error('Error deleting customer label:', error)
    return { error: 'Failed to delete customer label' }
  }
}

export async function assignLabelToCustomer(
  data: z.infer<typeof AssignLabelSchema>
): Promise<{ success?: boolean, error?: string }> {
  try {
    const permission = await requireCustomerPermission('edit')
    if ('error' in permission) {
      return { error: permission.error }
    }

    const { user, admin } = permission

    const validatedData = AssignLabelSchema.parse(data)

    const { error } = await admin
      .from('customer_label_assignments')
      .insert({
        ...validatedData,
        assigned_by: user?.id,
        auto_assigned: false
      })

    if (error) {
      if (error.code === '23505') {
        return { error: 'This label is already assigned to the customer' }
      }
      throw error
    }

    // Log audit event
    await logAuditEvent({
      user_id: user.id,
      ...(user.email && { user_email: user.email }),
      operation_type: 'assign_label',
      resource_type: 'customer',
      resource_id: validatedData.customer_id,
      operation_status: 'success',
      new_values: { label_id: validatedData.label_id }
    })

    revalidatePath('/customers')
    revalidatePath(`/customers/${validatedData.customer_id}`)
    return { success: true }
  } catch (error) {
    console.error('Error assigning label to customer:', error)
    return { error: 'Failed to assign label' }
  }
}

export async function removeLabelFromCustomer(
  customerId: string,
  labelId: string
): Promise<{ success?: boolean, error?: string }> {
  try {
    const permission = await requireCustomerPermission('edit')
    if ('error' in permission) {
      return { error: permission.error }
    }

    const { user, admin } = permission

    const { error } = await admin
      .from('customer_label_assignments')
      .delete()
      .eq('customer_id', customerId)
      .eq('label_id', labelId)

    if (error) throw error

    await logAuditEvent({
      user_id: user.id,
      ...(user.email && { user_email: user.email }),
      operation_type: 'remove_label',
      resource_type: 'customer',
      resource_id: customerId,
      operation_status: 'success',
      old_values: { label_id: labelId }
    })

    revalidatePath('/customers')
    revalidatePath(`/customers/${customerId}`)
    return { success: true }
  } catch (error) {
    console.error('Error removing label from customer:', error)
    return { error: 'Failed to remove label' }
  }
}

export async function getCustomerLabelAssignments(
  customerId: string
): Promise<{ data?: CustomerLabelAssignment[], error?: string }> {
  try {
    const permission = await requireCustomerPermission('view')
    if ('error' in permission) {
      return { error: permission.error }
    }

    const { admin } = permission

    const { data, error } = await admin
      .from('customer_label_assignments')
      .select(`
        *,
        label:customer_labels(*)
      `)
      .eq('customer_id', customerId)
      .order('assigned_at', { ascending: false })

    if (error) throw error

    return { data: (data || []) as CustomerLabelAssignment[] }
  } catch (error) {
    console.error('Error fetching customer label assignments:', error)
    return { error: 'Failed to fetch customer labels' }
  }
}

export async function applyLabelsRetroactively(): Promise<{ 
  data?: { customer_id: string, applied_labels: string[] }[], 
  error?: string 
}> {
  try {
    const permission = await requireCustomerPermission('manage')
    if ('error' in permission) {
      return { error: permission.error }
    }

    const { user, admin } = permission

    console.log('Backfilling customer category stats...')
    const { data: backfillData, error: backfillError } = await admin
      .rpc('backfill_customer_category_stats')
    
    if (backfillError) {
      console.error('Error backfilling customer stats:', backfillError)
      // Continue anyway - partial data is better than none
    } else {
      console.log(`Backfilled ${backfillData || 0} customer category stats`)
    }

    // Call the RPC function
    const { data, error } = await admin
      .rpc('apply_customer_labels_retroactively')

    if (error) throw error

    // Log audit event
    await logAuditEvent({
      user_id: user.id,
      ...(user.email && { user_email: user.email }),
      operation_type: 'apply_labels_retroactively',
      resource_type: 'customer_labels',
      resource_id: 'bulk',
      operation_status: 'success',
      additional_info: { 
        applied_badge: data?.length || 0,
        timestamp: new Date().toISOString()
      }
    })

    revalidatePath('/customers')
    return { data }
  } catch (error) {
    console.error('Error applying labels retroactively:', error)
    return { error: 'Failed to apply labels retroactively' }
  }
}

export async function bulkAssignLabel(
  labelId: string,
  customerIds: string[]
): Promise<{ success?: boolean, error?: string }> {
  try {
    const permission = await requireCustomerPermission('edit')
    if ('error' in permission) {
      return { error: permission.error }
    }

    const { user, admin } = permission

    // Prepare bulk insert data
    const assignments = customerIds.map(customerId => ({
      customer_id: customerId,
      label_id: labelId,
      assigned_by: user?.id,
      auto_assigned: false,
      notes: 'Bulk assigned'
    }))

    // Insert with conflict handling
    const { error } = await admin
      .from('customer_label_assignments')
      .upsert(assignments, { onConflict: 'customer_id,label_id' })

    if (error) throw error

    // Log audit event
    await logAuditEvent({
      user_id: user.id,
      ...(user.email && { user_email: user.email }),
      operation_type: 'bulk_assign_label',
      resource_type: 'customer_labels',
      resource_id: labelId,
      operation_status: 'success',
      additional_info: { 
        customer_badge: customerIds.length,
        customer_ids: customerIds
      }
    })

    revalidatePath('/customers')
    return { success: true }
  } catch (error) {
    console.error('Error bulk assigning label:', error)
    return { error: 'Failed to assign label to customers' }
  }
}
