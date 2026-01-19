'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath, revalidateTag } from 'next/cache'
import { logAuditEvent } from './audit'
import { customerSchema } from '@/lib/validation'
import { checkUserPermission } from './rbac'
import type { User as SupabaseUser } from '@supabase/supabase-js'
import { CustomerService } from '@/services/customers'
import type { CreateCustomerInput } from '@/types/customers'

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

export async function createCustomer(formData: FormData) {
  try {
    const context = await requireCustomerManageContext()
    if ('error' in context) {
      return { error: context.error }
    }
    const { user } = context

    const rawData = {
      first_name: (formData.get('first_name') as string | null) ?? '',
      last_name: (formData.get('last_name') as string | null)?.trim() || undefined,
      mobile_number: (formData.get('mobile_number') as string | null)?.trim() || undefined,
      email: (formData.get('email') as string | null)?.trim() || undefined,
      sms_opt_in: formData.get('sms_opt_in') === 'on'
    }

    const validationResult = customerSchema.safeParse(rawData)
    if (!validationResult.success) {
      return { error: validationResult.error.errors[0].message }
    }

    const customer = await CustomerService.createCustomer({
      ...validationResult.data,
      mobile_number: validationResult.data.mobile_number! // Schema ensures this if valid
    })

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
    revalidateTag('dashboard')
    revalidatePath('/dashboard')
    return { success: true, data: customer }
  } catch (error) {
    console.error('Unexpected error creating customer:', error)
    const message = error instanceof Error ? error.message : 'An unexpected error occurred'
    return { error: message }
  }
}

export async function updateCustomer(id: string, formData: FormData) {
  try {
    const context = await requireCustomerManageContext()
    if ('error' in context) {
      return { error: context.error }
    }
    const { user } = context

    const rawData = {
      first_name: (formData.get('first_name') as string | null) ?? '',
      last_name: (formData.get('last_name') as string | null)?.trim() || undefined,
      mobile_number: (formData.get('mobile_number') as string | null)?.trim() || undefined,
      email: (formData.get('email') as string | null)?.trim() || undefined,
      sms_opt_in: formData.get('sms_opt_in') === 'on'
    }

    const validationResult = customerSchema.safeParse(rawData)
    if (!validationResult.success) {
      return { error: validationResult.error.errors[0].message }
    }

    const customer = await CustomerService.updateCustomer(id, {
      ...validationResult.data,
      mobile_number: validationResult.data.mobile_number!
    })

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
    revalidateTag('dashboard')
    revalidatePath('/dashboard')
    return { success: true, data: customer }
  } catch (error) {
    console.error('Unexpected error updating customer:', error)
    const message = error instanceof Error ? error.message : 'An unexpected error occurred'
    return { error: message }
  }
}

export async function deleteCustomer(id: string) {
  try {
    const context = await requireCustomerManageContext()
    if ('error' in context) {
      return { error: context.error }
    }
    const { user } = context

    const customer = await CustomerService.deleteCustomer(id)

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
    revalidateTag('dashboard')
    revalidatePath('/dashboard')
    return { success: true }
  } catch (error) {
    console.error('Unexpected error deleting customer:', error)
    const message = error instanceof Error ? error.message : 'An unexpected error occurred'
    return { error: message }
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
    const context = await requireCustomerManageContext()
    if ('error' in context) {
      return { error: context.error }
    }
    const { user } = context

    // Map input to Service input (ensure boolean for sms_opt_in)
    const serviceInput: CreateCustomerInput[] = entries.map(e => ({
      first_name: e.first_name,
      last_name: e.last_name,
      mobile_number: e.mobile_number,
      email: e.email,
      sms_opt_in: true
    }))

    const result = await CustomerService.importCustomers(serviceInput)

    if (result.created.length > 0) {
      await logAuditEvent({
        user_id: user.id,
        user_email: user.email,
        operation_type: 'bulk_create',
        resource_type: 'customer',
        operation_status: 'success',
        additional_info: {
          total_received: entries.length,
          created: result.created.length,
          skipped_invalid: result.skippedInvalid,
          skipped_duplicate_in_file: result.skippedDuplicates,
          skipped_existing: result.skippedExisting
        }
      })
    }

    revalidatePath('/customers')
    revalidateTag('dashboard')
    revalidatePath('/dashboard')

    return {
      success: true,
      created: result.created.length,
      skippedInvalid: result.skippedInvalid,
      skippedDuplicateInFile: result.skippedDuplicates,
      skippedExisting: result.skippedExisting
    }
  } catch (error) {
    console.error('Unexpected error importing customers:', error)
    const message = error instanceof Error ? error.message : 'An unexpected error occurred'
    return { error: message }
  }
}

export async function deleteTestCustomers() {
  try {
    const context = await requireCustomerManageContext()
    if ('error' in context) {
      return { error: context.error }
    }
    const { user } = context

    const result = await CustomerService.deleteTestCustomers()

    if (result.success && result.deletedCount > 0) {
      // Log the bulk operation
      await logAuditEvent({
        user_id: user.id,
        user_email: user.email,
        operation_type: 'bulk_delete',
        resource_type: 'customers',
        operation_status: result.failedCount ? 'failure' : 'success',
        additional_info: {
          total_deleted: result.deletedCount,
          failed_count: result.failedCount || 0,
          message: result.message
        }
      })
      
      // We don't log individual audits here to avoid spamming the log if thousands are deleted,
      // relying on the single bulk audit event. 
      // If individual audits were needed, the service could return the list of deleted items to loop over.
    }

    revalidatePath('/customers')
    revalidateTag('dashboard')
    revalidatePath('/dashboard')

    return result
  } catch (error) {
    console.error('Unexpected error deleting test customers:', error)
    const message = error instanceof Error ? error.message : 'An unexpected error occurred'
    return { error: message }
  }
}
