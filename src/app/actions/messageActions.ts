'use server'

import { checkUserPermission } from './rbac'
import { revalidatePath, revalidateTag } from 'next/cache'
import { MessageService } from '@/services/messages'

export async function getUnreadMessageCounts() {
  try {
    const canView = await checkUserPermission('messages', 'view')
    if (!canView) {
      return {}
    }

    return await MessageService.getUnreadCounts();
  } catch (error) {
    console.error('Error fetching unread counts:', error)
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
    console.error('Error fetching total unread badge: ', error)
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
    console.error('Error marking messages as read:', error)
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
    console.error('Failed to send SMS:', error)
    return { error: error.message || 'Failed to send message' }
  }
}
