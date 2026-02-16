'use server'

import { checkUserPermission } from './rbac'
import { revalidatePath, revalidateTag } from 'next/cache'
import { MessageService } from '@/services/messages'
import { logger } from '@/lib/logger'

export async function getUnreadMessageCounts(customerIds?: string[]) {
  try {
    const canView = await checkUserPermission('messages', 'view')
    if (!canView) {
      return {}
    }

    return await MessageService.getUnreadCounts(customerIds);
  } catch (error) {
    logger.error('Error fetching unread counts', {
      error: error instanceof Error ? error : new Error(String(error)),
    })
    return {}
  }
}

export async function getTotalUnreadCount() {
  try {
    const canView = await checkUserPermission('messages', 'view')
    if (!canView) {
      return 0
    }

    return await MessageService.getTotalUnreadCount();
  } catch (error) {
    logger.error('Error fetching total unread badge', {
      error: error instanceof Error ? error : new Error(String(error)),
    })
    return 0
  }
}

export async function markMessagesAsRead(customerId: string) {
  try {
    const canView = await checkUserPermission('messages', 'view')
    if (!canView) {
      return { error: 'Insufficient permissions' }
    }

    await MessageService.markMessagesAsRead(customerId);
    
    // Revalidate all relevant pages
    revalidatePath('/messages')
    revalidatePath('/customers')
    revalidatePath(`/customers/${customerId}`)
    revalidatePath('/', 'layout') // This revalidates the navigation with unread counts
    revalidateTag('dashboard')
    revalidatePath('/dashboard')
    
    return { success: true }
  } catch (error: any) {
    logger.error('Error marking messages as read', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { customerId },
    })
    return { error: error.message || 'Failed to mark messages as read' }
  }
}

export async function sendSmsReply(customerId: string, message: string) {
  try {
    const hasSendPermission =
      (await checkUserPermission('messages', 'send')) ||
      (await checkUserPermission('messages', 'manage'))

    if (!hasSendPermission) {
      return { error: 'Insufficient permissions' }
    }

    const result = await MessageService.sendReply(customerId, message);
    return result;
  } catch (error: any) {
    logger.error('Failed to send SMS reply', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { customerId },
    })
    return { error: error.message || 'Failed to send message' }
  }
}
