'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { logAuditEvent } from './audit'
import { customerSchema, formatPhoneForStorage } from '@/lib/validation'
import { getConstraintErrorMessage, isPostgrestError } from '@/lib/dbErrorHandler'

export async function createCustomer(formData: FormData) {
  try {
    const supabase = await createClient()
    
    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return { error: 'Unauthorized' }
    }

    // Parse and validate form data
    const emailInput = formData.get('email')
    const rawData = {
      first_name: formData.get('first_name') as string,
      last_name: (formData.get('last_name') as string | null)?.trim() || undefined,
      mobile_number: (formData.get('mobile_number') as string | null)?.trim() || undefined,
      email: typeof emailInput === 'string' && emailInput.trim() !== '' ? emailInput.trim() : undefined,
      sms_opt_in: formData.get('sms_opt_in') === 'on'
    }

    const validationResult = customerSchema.safeParse(rawData)
    if (!validationResult.success) {
      return { error: validationResult.error.errors[0].message }
    }

    const data = validationResult.data

    if (data.email) {
      data.email = data.email.toLowerCase();
    }

    // Standardize phone number to E.164 format if provided
    if (data.mobile_number) {
      try {
        data.mobile_number = formatPhoneForStorage(data.mobile_number)
      } catch (error) {
        return { error: 'Invalid UK phone number format' }
      }
    }

    // Check for duplicate phone number
    const { data: existing } = await supabase
      .from('customers')
      .select('id')
      .eq('mobile_number', data.mobile_number)
      .single()

    if (existing) {
      return { error: 'A customer with this phone number already exists' }
    }

    // Create customer
    const { data: customer, error } = await supabase
      .from('customers')
      .insert(data)
      .select()
      .single()

    if (error) {
      console.error('Customer creation error:', error)
      if (isPostgrestError(error)) {
        return { error: getConstraintErrorMessage(error) }
      }
      return { error: 'Failed to create customer' }
    }

    // Log audit event
    await logAuditEvent({
      user_id: user.id,
      user_email: user.email,
      operation_type: 'create',
      resource_type: 'customer',
      resource_id: customer.id,
      operation_status: 'success',
      new_values: customer
    })

    revalidatePath('/customers')
    return { success: true, data: customer }
  } catch (error) {
    console.error('Unexpected error creating customer:', error)
    return { error: 'An unexpected error occurred' }
  }
}

export async function updateCustomer(id: string, formData: FormData) {
  try {
    const supabase = await createClient()
    
    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return { error: 'Unauthorized' }
    }

    // Parse and validate form data
    const emailInput = formData.get('email')
    const rawData = {
      first_name: formData.get('first_name') as string,
      last_name: (formData.get('last_name') as string | null)?.trim() || undefined,
      mobile_number: (formData.get('mobile_number') as string | null)?.trim() || undefined,
      email: typeof emailInput === 'string' && emailInput.trim() !== '' ? emailInput.trim() : undefined,
      sms_opt_in: formData.get('sms_opt_in') === 'on'
    }

    const validationResult = customerSchema.safeParse(rawData)
    if (!validationResult.success) {
      return { error: validationResult.error.errors[0].message }
    }

    const data = validationResult.data

    if (data.email) {
      data.email = data.email.toLowerCase();
    }

    // Standardize phone number to E.164 format if provided
    if (data.mobile_number) {
      try {
        data.mobile_number = formatPhoneForStorage(data.mobile_number)
      } catch (error) {
        return { error: 'Invalid UK phone number format' }
      }
    }

    // Check for duplicate phone number (excluding current customer)
    const { data: existing } = await supabase
      .from('customers')
      .select('id')
      .eq('mobile_number', data.mobile_number)
      .neq('id', id)
      .single()

    if (existing) {
      return { error: 'A customer with this phone number already exists' }
    }

    // Update customer
    const { data: customer, error } = await supabase
      .from('customers')
      .update(data)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Customer update error:', error)
      if (isPostgrestError(error)) {
        return { error: getConstraintErrorMessage(error) }
      }
      return { error: 'Failed to update customer' }
    }

    // Log audit event
    await logAuditEvent({
      user_id: user.id,
      user_email: user.email,
      operation_type: 'update',
      resource_type: 'customer',
      resource_id: id,
      operation_status: 'success',
      new_values: customer
    })

    revalidatePath('/customers')
    revalidatePath(`/customers/${id}`)
    return { success: true, data: customer }
  } catch (error) {
    console.error('Unexpected error updating customer:', error)
    return { error: 'An unexpected error occurred' }
  }
}

export async function deleteCustomer(id: string) {
  try {
    const supabase = await createClient()
    
    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return { error: 'Unauthorized' }
    }

    // Get customer details for audit log
    const { data: customer } = await supabase
      .from('customers')
      .select('first_name, last_name')
      .eq('id', id)
      .single()

    // Delete customer (bookings will cascade delete)
    const { error } = await supabase
      .from('customers')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Customer deletion error:', error)
      return { error: 'Failed to delete customer' }
    }

    // Log audit event
    if (customer) {
      await logAuditEvent({
        user_id: user.id,
        user_email: user.email,
        operation_type: 'delete',
        resource_type: 'customer',
        resource_id: id,
        operation_status: 'success',
        old_values: customer
      })
    }

    revalidatePath('/customers')
    return { success: true }
  } catch (error) {
    console.error('Unexpected error deleting customer:', error)
    return { error: 'An unexpected error occurred' }
  }
}

export async function deleteTestCustomers() {
  try {
    const supabase = await createClient()
    
    // Get the authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return { error: 'Unauthorized' }
    }

    // Find all customers with 'test' in first or last name (case-insensitive)
    const { data: testCustomers, error: fetchError } = await supabase
      .from('customers')
      .select('id, first_name, last_name')
      .or('first_name.ilike.%test%,last_name.ilike.%test%')

    if (fetchError) {
      console.error('Error fetching test customers:', fetchError)
      return { error: 'Failed to fetch test customers' }
    }

    if (!testCustomers || testCustomers.length === 0) {
      return { success: true, deletedCount: 0, message: 'No test customers found' }
    }

    // Delete each test customer
    const deletedCustomers = []
    const failedDeletions = []

    for (const customer of testCustomers) {
      // Delete customer (bookings will cascade delete)
      const { error: deleteError } = await supabase
        .from('customers')
        .delete()
        .eq('id', customer.id)

      if (deleteError) {
        console.error(`Failed to delete customer ${customer.id}:`, deleteError)
        failedDeletions.push({
          id: customer.id,
          name: `${customer.first_name} ${customer.last_name}`,
          error: deleteError.message
        })
      } else {
        deletedCustomers.push({
          id: customer.id,
          name: `${customer.first_name} ${customer.last_name}`
        })

        // Log audit event for each deletion
        await logAuditEvent({
          user_id: user.id,
          user_email: user.email,
          operation_type: 'delete',
          resource_type: 'customer',
          resource_id: customer.id,
          operation_status: 'success',
          old_values: customer,
          additional_info: { reason: 'Bulk deletion of test customers' }
        })
      }
    }

    // Log summary audit event
    await logAuditEvent({
      user_id: user.id,
      user_email: user.email,
      operation_type: 'bulk_delete',
      resource_type: 'customers',
      operation_status: failedDeletions.length > 0 ? 'failure' : 'success',
      additional_info: {
        total_found: testCustomers.length,
        deleted_count: deletedCustomers.length,
        failed_count: failedDeletions.length,
        deleted_customers: deletedCustomers,
        failed_deletions: failedDeletions
      }
    })

    revalidatePath('/customers')

    if (failedDeletions.length > 0) {
      return {
        success: false,
        deletedCount: deletedCustomers.length,
        failedCount: failedDeletions.length,
        deletedCustomers,
        failedDeletions,
        message: `Deleted ${deletedCustomers.length} test customers. Failed to delete ${failedDeletions.length} customers.`
      }
    }

    return {
      success: true,
      deletedCount: deletedCustomers.length,
      deletedCustomers,
      message: `Successfully deleted ${deletedCustomers.length} test customers`
    }
  } catch (error) {
    console.error('Unexpected error deleting test customers:', error)
    return { error: 'An unexpected error occurred' }
  }
}