'use server'

import { createClient } from '@/lib/supabase/server'
import { CustomerLabel, CustomerLabelAssignment } from '@/app/actions/customer-labels'

export async function getBulkCustomerLabels(customerIds: string[]): Promise<{
  labels?: CustomerLabel[],
  assignments?: Record<string, CustomerLabelAssignment[]>,
  error?: string
}> {
  try {
    const supabase = await createClient()
    
    // Get all labels
    const { data: labels, error: labelsError } = await supabase
      .from('customer_labels')
      .select('*')
      .order('name')
    
    if (labelsError) {
      console.error('Error fetching labels:', labelsError)
      return { error: 'Failed to fetch labels' }
    }
    
    // Get all assignments for the given customer IDs
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
    
    // Group assignments by customer ID
    const assignmentsByCustomer: Record<string, CustomerLabelAssignment[]> = {}
    assignments?.forEach(assignment => {
      if (!assignmentsByCustomer[assignment.customer_id]) {
        assignmentsByCustomer[assignment.customer_id] = []
      }
      assignmentsByCustomer[assignment.customer_id].push(assignment)
    })
    
    return { 
      labels: labels || [], 
      assignments: assignmentsByCustomer 
    }
  } catch (error) {
    console.error('Error in getBulkCustomerLabels:', error)
    return { error: 'An unexpected error occurred' }
  }
}