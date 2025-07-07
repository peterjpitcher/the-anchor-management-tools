'use server'

import { JobQueue } from '@/lib/job-queue'
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
    const jobQueue = new JobQueue()
    const { success, jobId, error } = await jobQueue.enqueue(
      'send_bulk_sms',
      { 
        customerIds, 
        message,
        eventId,
        categoryId
      },
      user.id
    )
    
    if (success && jobId) {
      return { success: true, jobId }
    } else {
      return { error: error || 'Failed to queue bulk SMS job' }
    }
  } catch (error) {
    console.error('Error enqueueing bulk SMS job:', error)
    return { error: 'Failed to queue bulk SMS job' }
  }
}