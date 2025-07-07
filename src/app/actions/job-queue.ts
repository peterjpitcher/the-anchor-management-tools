'use server'

import { jobQueue } from '@/lib/background-jobs'
import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from './rbac'

export async function enqueueBulkSMSJob(
  customerIds: string[], 
  message: string,
  eventId?: string,
  categoryId?: string
) {
  // Check permission
  const hasPermission = await checkUserPermission('messages', 'send')
  if (!hasPermission) {
    return { error: 'Insufficient permissions to send messages' }
  }

  // Get current user
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    return { error: 'User not authenticated' }
  }

  try {
    const jobId = await jobQueue.enqueue(
      'send_bulk_sms',
      { 
        customerIds, 
        message,
        eventId,
        categoryId
      }
    )
    
    return { success: true, jobId }
  } catch (error) {
    console.error('Error enqueueing bulk SMS job:', error)
    return { error: 'Failed to queue bulk SMS job' }
  }
}