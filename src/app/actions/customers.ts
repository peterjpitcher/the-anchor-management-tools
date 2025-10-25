'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { logAuditEvent } from './audit'
import { customerSchema, formatPhoneForStorage, optionalEmailSchema } from '@/lib/validation'
import { getConstraintErrorMessage, isPostgrestError } from '@/lib/dbErrorHandler'
import { checkUserPermission } from './rbac'
import type { User as SupabaseUser } from '@supabase/supabase-js'

type CustomerFormData = {
  first_name: string
  last_name?: string
  mobile_number?: string
  email?: string
  sms_opt_in: boolean
}

type CustomerFormResult =
  | { error: string }
  | { data: CustomerFormData }

type ManageContext =
  | { error: string }
  | {
      supabase: Awaited<ReturnType<typeof createClient>>
      user: SupabaseUser
    }

async function requireCustomerManageContext(): Promise<ManageContext> {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return { error: 'Unauthorized' }
  }

  const canManage = await checkUserPermission('customers', 'manage', user.id)
  if (!canManage) {
    return { error: 'Insufficient permissions' }
  }

  return { supabase, user }
}

function parseCustomerFormData(formData: FormData): CustomerFormResult {
  const emailInput = formData.get('email')
  const rawData = {
    first_name: (formData.get('first_name') as string | null) ?? '',
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

  const email = data.email ? data.email.toLowerCase() : undefined
  let mobileNumber: string | undefined

  if (data.mobile_number) {
    try {
      mobileNumber = formatPhoneForStorage(data.mobile_number)
    } catch {
      return { error: 'Invalid UK phone number format' }
    }
  }

  const normalized: CustomerFormData = {
    first_name: data.first_name,
    last_name: data.last_name ?? undefined,
    mobile_number: mobileNumber,
    email,
    sms_opt_in: data.sms_opt_in
  }

  return { data: normalized }
}

function toCustomerPayload(data: {
  first_name: string
  last_name?: string
  mobile_number?: string
  email?: string
  sms_opt_in: boolean
}) {
  return {
    ...data,
    last_name: data.last_name ?? null,
    email: data.email ?? null
  }
}

export async function createCustomer(formData: FormData) {
  try {
    const context = await requireCustomerManageContext()
    if ('error' in context) {
      return { error: context.error }
    }
    const { supabase, user } = context

    const parsed = parseCustomerFormData(formData)
    if ('error' in parsed) {
      return { error: parsed.error }
    }

    const data = parsed.data
    if (data.mobile_number) {
      const { data: existing } = await supabase
        .from('customers')
        .select('id')
        .eq('mobile_number', data.mobile_number)
        .maybeSingle()

      if (existing) {
        return { error: 'A customer with this phone number already exists' }
      }
    }

    // Create customer
    const { data: customer, error } = await supabase
      .from('customers')
      .insert(toCustomerPayload(data))
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
    const context = await requireCustomerManageContext()
    if ('error' in context) {
      return { error: context.error }
    }
    const { supabase, user } = context

    const parsed = parseCustomerFormData(formData)
    if ('error' in parsed) {
      return { error: parsed.error }
    }

    const data = parsed.data

    if (data.mobile_number) {
      const { data: existing } = await supabase
        .from('customers')
        .select('id')
        .eq('mobile_number', data.mobile_number)
        .neq('id', id)
        .maybeSingle()

      if (existing) {
        return { error: 'A customer with this phone number already exists' }
      }
    }

    // Update customer
    const { data: customer, error } = await supabase
      .from('customers')
      .update(toCustomerPayload(data))
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
    const context = await requireCustomerManageContext()
    if ('error' in context) {
      return { error: context.error }
    }
    const { supabase, user } = context

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

interface ImportCustomerInput {
  first_name: string
  last_name?: string
  mobile_number: string
  email?: string
}

export async function importCustomers(entries: ImportCustomerInput[]) {
  try {
    if (!entries || entries.length === 0) {
      return { error: 'No customers provided' }
    }

    const context = await requireCustomerManageContext()
    if ('error' in context) {
      return { error: context.error }
    }
    const { supabase, user } = context

    const preparedCustomers: Array<{
      first_name: string
      last_name: string | null
      email: string | null
      mobile_number: string
      sms_opt_in: boolean
    }> = []
    const seenPhones = new Set<string>()
    let invalidCount = 0
    let duplicateInFileCount = 0

    for (const entry of entries) {
      const firstName = (entry.first_name || '').trim()
      if (!firstName) {
        invalidCount++
        continue
      }

      const rawPhone = (entry.mobile_number || '').trim()
      if (!rawPhone) {
        invalidCount++
        continue
      }

      let formattedPhone: string
      try {
        formattedPhone = formatPhoneForStorage(rawPhone)
      } catch {
        invalidCount++
        continue
      }

      if (seenPhones.has(formattedPhone)) {
        duplicateInFileCount++
        continue
      }

      seenPhones.add(formattedPhone)
      const emailInput = (entry.email || '').trim()
      let normalizedEmail: string | null = null
      if (emailInput) {
        const emailResult = optionalEmailSchema.safeParse(emailInput.toLowerCase())
        if (!emailResult.success || !emailResult.data) {
          invalidCount++
          continue
        }
        normalizedEmail = emailResult.data
      }
      preparedCustomers.push({
        first_name: firstName,
        last_name: entry.last_name ? entry.last_name.trim() || null : null,
        email: normalizedEmail,
        mobile_number: formattedPhone,
        sms_opt_in: true,
      })
    }

    if (preparedCustomers.length === 0) {
      return {
        error: 'No valid customers to import',
        skippedInvalid: invalidCount,
        skippedDuplicates: duplicateInFileCount,
      }
    }

    let existingSet = new Set<string>()
    if (seenPhones.size > 0) {
      const { data: existing, error: existingError } = await supabase
        .from('customers')
        .select('mobile_number')
        .in('mobile_number', Array.from(seenPhones))

      if (existingError) {
        console.error('Failed to check existing customers during import:', existingError)
        return { error: 'Failed to verify existing customers' }
      }

      existingSet = new Set((existing || []).map((row: { mobile_number: string }) => row.mobile_number))
    }

    let skippedExistingCount = 0
    const customersToInsert = preparedCustomers.filter((customer) => {
      if (existingSet.has(customer.mobile_number)) {
        skippedExistingCount++
        return false
      }
      return true
    })

    let insertedCustomers: Array<{ id: string; first_name: string; last_name: string | null; email: string | null; mobile_number: string }> = []
    if (customersToInsert.length > 0) {
      const insertPayload = customersToInsert.map((customer) => ({
        ...customer,
        email: customer.email,
      }))
      const { data: inserted, error: insertError } = await supabase
        .from('customers')
        .insert(insertPayload)
        .select('id, first_name, last_name, email, mobile_number')

      if (insertError) {
        console.error('Customer import insertion error:', insertError)
        return { error: 'Failed to import customers' }
      }

      insertedCustomers = inserted || []

      for (const customer of insertedCustomers) {
        await logAuditEvent({
          user_id: user.id,
          user_email: user.email,
          operation_type: 'create',
          resource_type: 'customer',
          resource_id: customer.id,
          operation_status: 'success',
          new_values: customer,
          additional_info: { imported: true }
        })
      }
    }

    await logAuditEvent({
      user_id: user.id,
      user_email: user.email,
      operation_type: 'bulk_create',
      resource_type: 'customer',
      operation_status: 'success',
      additional_info: {
        total_received: entries.length,
        created: insertedCustomers.length,
        skipped_invalid: invalidCount,
        skipped_duplicate_in_file: duplicateInFileCount,
        skipped_existing: skippedExistingCount
      }
    })

    revalidatePath('/customers')

    return {
      success: true,
      created: insertedCustomers.length,
      skippedInvalid: invalidCount,
      skippedDuplicateInFile: duplicateInFileCount,
      skippedExisting: skippedExistingCount
    }
  } catch (error) {
    console.error('Unexpected error importing customers:', error)
    return { error: 'An unexpected error occurred' }
  }
}

export async function deleteTestCustomers() {
  try {
    const context = await requireCustomerManageContext()
    if ('error' in context) {
      return { error: context.error }
    }
    const { supabase, user } = context

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
