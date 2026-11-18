'use server'

import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { readBulkCustomerLabels, type BulkCustomerLabelsResult } from '@/lib/customers/bulk-labels'

export async function getBulkCustomerLabels(customerIds: string[]): Promise<BulkCustomerLabelsResult> {
  try {
    const canView = await checkUserPermission('customers', 'view')
    if (!canView) return { error: 'Permission denied' }

    const supabase = await createClient()

    // Get all assignments for the given customer IDs (label data joined inline)
    return await readBulkCustomerLabels(supabase, customerIds)
  } catch (error) {
    console.error('Error in getBulkCustomerLabels:', error)
    return { error: 'An unexpected error occurred' }
  }
}
