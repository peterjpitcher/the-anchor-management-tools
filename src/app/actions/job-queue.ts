'use server'

import { jobQueue } from '@/lib/unified-job-queue'
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
    const BATCH_SIZE = 50
    const jobIds: string[] = []

    // Split customers into batches
    for (let i = 0; i < customerIds.length; i += BATCH_SIZE) {
      const batch = customerIds.slice(i, i + BATCH_SIZE)

      const result = await jobQueue.enqueue(
        'send_bulk_sms',
        {
          customerIds: batch,
          message,
          eventId,
          categoryId
        }
      )

      if (!result.success || !result.jobId) {
        return { error: result.error || 'Failed to queue bulk SMS job' }
      }

      jobIds.push(result.jobId)
    }

    return { success: true, jobId: jobIds[0] } // Return first job ID for reference
  } catch (error) {
    console.error('Error enqueueing bulk SMS job:', error)
    return { error: 'Failed to queue bulk SMS job' }
  }
}
