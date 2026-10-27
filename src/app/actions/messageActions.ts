'use server'

import { checkUserPermission } from './rbac'
import { logAuditEvent } from './audit'
import { createClient } from '@/lib/supabase/server'
import { revalidatePath, revalidateTag } from 'next/cache'
import { MessageService } from '@/services/messages'
import { logger } from '@/lib/logger'
import { getErrorMessage } from '@/lib/errors';

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
    const [canManage, canSendTransactional] = await Promise.all([
      checkUserPermission('messages', 'manage'),
      checkUserPermission('messages', 'send_transactional'),
    ])
    if (!canManage && !canSendTransactional) {
      return { error: 'Insufficient permissions' }
    }

    await MessageService.markMessagesAsRead(customerId);
    
    // Revalidate all relevant pages
    revalidatePath('/messages')
    revalidatePath('/customers')
    revalidatePath(`/customers/${customerId}`)
    revalidatePath('/', 'layout') // This revalidates the navigation with unread counts
    revalidateTag('dashboard')
    
    return { success: true }
  } catch (error: unknown) {
    logger.error('Error marking messages as read', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { customerId },
    })
    return { error: getErrorMessage(error) }
  }
}

export async function sendSmsReply(customerId: string, message: string) {
  try {
    const [canSend, canManage] = await Promise.all([
      checkUserPermission('messages', 'send_transactional'),
      checkUserPermission('messages', 'manage'),
    ])
    const hasSendPermission = canSend || canManage

    if (!hasSendPermission) {
      return { error: 'Insufficient permissions' }
    }

    // Who typed the reply is recorded on the message and in the audit log (BK-182).
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const result = await MessageService.sendReply(customerId, message, user?.id ?? null);
    if (user?.id) {
      await logAuditEvent({
        user_id: user.id,
        operation_type: 'message.reply_sent',
        resource_type: 'customer',
        resource_id: customerId,
        operation_status: result.success ? 'success' : 'failure',
        error_message: result.success ? undefined : result.error,
        additional_info: {
          customer_id: customerId,
          message_sid: result.success ? result.messageSid ?? null : null,
          message_length: message.length,
        },
      })
    }
    return result;
  } catch (error: unknown) {
    logger.error('Failed to send SMS reply', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { customerId },
    })
    return { error: getErrorMessage(error) }
  }
}
