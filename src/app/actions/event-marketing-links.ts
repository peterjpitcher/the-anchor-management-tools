'use server'

import { checkUserPermission } from '@/app/actions/rbac'
import { EventMarketingService, type EventMarketingLink } from '@/services/event-marketing'
import { EVENT_MARKETING_CHANNELS, type EventMarketingChannelKey } from '@/lib/event-marketing-links'
import { getErrorMessage } from '@/lib/errors';

export type { EventMarketingLink }

export interface EventMarketingLinksResult {
  success: boolean
  links?: EventMarketingLink[]
  error?: string
}

export async function generateEventMarketingLinks(eventId: string): Promise<EventMarketingLinksResult> {
  try {
    const canManageEvents = await checkUserPermission('events', 'manage')
    if (!canManageEvents) {
      return { success: false, error: 'Insufficient permissions to manage marketing links' }
    }

    const links = await EventMarketingService.generateLinks(eventId)
    return { success: true, links }
  } catch (error: unknown) {
    console.error('Unexpected error generating marketing links', error)
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function getEventMarketingLinks(eventId: string): Promise<EventMarketingLinksResult> {
  try {
    const canViewEvents = await checkUserPermission('events', 'view')
    if (!canViewEvents) {
      return { success: false, error: 'Insufficient permissions to view marketing links' }
    }

    const links = await EventMarketingService.getLinks(eventId)
    return { success: true, links }
  } catch (error: unknown) {
    console.error('Unexpected error loading marketing links', error)
    return { success: false, error: getErrorMessage(error) }
  }
}

export async function regenerateEventMarketingLinks(eventId: string): Promise<EventMarketingLinksResult> {
  return generateEventMarketingLinks(eventId)
}

export async function generateSingleMarketingLink(
  eventId: string,
  channel: EventMarketingChannelKey
): Promise<{ success?: boolean; error?: string; link?: EventMarketingLink }> {
  try {
    const canManageEvents = await checkUserPermission('events', 'manage')
    if (!canManageEvents) {
      return { error: 'Insufficient permissions to manage marketing links' }
    }

    const channelConfig = EVENT_MARKETING_CHANNELS.find(c => c.key === channel)
    if (!channelConfig || channelConfig.tier !== 'on_demand') {
      return { error: 'This channel is generated automatically' }
    }

    const link = await EventMarketingService.generateSingleLink(eventId, channel)
    return { success: true, link }
  } catch (error: unknown) {
    const message = error instanceof Error ? getErrorMessage(error) : 'Unexpected error generating link'
    console.error('Unexpected error generating single marketing link', error)
    return { error: message }
  }
}