'use server'

import { revalidatePath, revalidateTag } from 'next/cache'
import { CommunicationsService } from '@/services/communications'

export async function linkUnmatchedCommunicationAction(formData: FormData) {
  const unmatchedId = String(formData.get('unmatchedId') ?? '').trim()
  const customerId = String(formData.get('customerId') ?? '').trim()

  if (!unmatchedId || !customerId) {
    return { error: 'Missing communication or customer' }
  }

  try {
    await CommunicationsService.linkUnmatchedCommunication(unmatchedId, customerId)
    revalidatePath('/messages')
    revalidatePath('/messages/holding')
    revalidatePath(`/customers/${customerId}`)
    revalidateTag('dashboard')
    return { success: true }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to link communication' }
  }
}

export async function ignoreUnmatchedCommunicationAction(formData: FormData) {
  const unmatchedId = String(formData.get('unmatchedId') ?? '').trim()

  if (!unmatchedId) {
    return { error: 'Missing communication' }
  }

  try {
    await CommunicationsService.ignoreUnmatchedCommunication(unmatchedId)
    revalidatePath('/messages')
    revalidatePath('/messages/holding')
    revalidateTag('dashboard')
    return { success: true }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to ignore communication' }
  }
}
