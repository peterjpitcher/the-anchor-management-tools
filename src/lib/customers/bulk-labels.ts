import type { createClient } from '@/lib/supabase/server'
import type { CustomerLabelAssignment } from '@/app/actions/customer-labels'

export type BulkCustomerLabelsResult = {
  assignments?: Record<string, CustomerLabelAssignment[]>
  error?: string
}

/**
 * Reads the label assignments for a set of customers, grouped by customer id.
 *
 * This does NO permission check. It exists so a caller that has already checked
 * `customers:view` (the customer list) does not pay for a second check through the
 * exported `getBulkCustomerLabels` action, which keeps its own check for every other
 * caller. Never call it from a path that has not checked that permission first.
 */
export async function readBulkCustomerLabels(
  supabase: Awaited<ReturnType<typeof createClient>>,
  customerIds: string[]
): Promise<BulkCustomerLabelsResult> {
  const { data: assignments, error: assignmentsError } = await supabase
    .from('customer_label_assignments')
    .select(`
        *,
        label:customer_labels(*)
      `)
    .in('customer_id', customerIds)

  if (assignmentsError) {
    console.error('Error fetching assignments:', assignmentsError)
    return { error: 'Failed to fetch label assignments' }
  }

  const assignmentsByCustomer: Record<string, CustomerLabelAssignment[]> = {}
  assignments?.forEach(assignment => {
    if (!assignmentsByCustomer[assignment.customer_id]) {
      assignmentsByCustomer[assignment.customer_id] = []
    }
    assignmentsByCustomer[assignment.customer_id].push(assignment)
  })

  return { assignments: assignmentsByCustomer }
}
