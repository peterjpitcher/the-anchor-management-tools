'use server'

import { checkUserPermission } from '@/app/actions/rbac'
import { EventMarketingService, type EventMarketingMessage } from '@/services/event-marketing'
import { getErrorMessage } from '@/lib/errors'

export type { EventMarketingMessage }

export interface EventMarketingMessagesResult {
  success: boolean
  messages?: EventMarketingMessage[]
  error?: string
}

export async function getEventMarketingMessages(eventId: string): Promise<EventMarketingMessagesResult> {
  try {
    const canViewEvents = await checkUserPermission('events', 'view')
    if (!canViewEvents) {
      return { success: false, error: 'Insufficient permissions to view marketing messages' }
    }

    const messages = await EventMarketingService.getSentMessages(eventId)
    return { success: true, messages }
  } catch (error: unknown) {
    console.error('Unexpected error loading event marketing messages', error)
    return { success: false, error: getErrorMessage(error) }
  }
}
