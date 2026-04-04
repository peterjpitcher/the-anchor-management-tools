'use server'

import { createClient } from '@/lib/supabase/server'
import { logAuditEvent } from './audit'
import { GdprService } from '@/services/gdpr'
import { createAdminClient } from '@/lib/supabase/admin'
import { getErrorMessage } from '@/lib/errors';

/**
 * Export all user data for GDPR compliance
 */
export async function exportUserData(userId?: string) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user && !userId) {
      return { error: 'User not authenticated' }
    }
    
    const targetUserId = userId || user!.id
    
    // Check permission if exporting another user's data
    if (userId && userId !== user?.id) {
      const adminClient = createAdminClient(); // Use admin client for this check
      const { data: profile } = await adminClient
        .from('profiles')
        .select('system_role')
        .eq('id', user!.id)
        .single()
      
      if (profile?.system_role !== 'super_admin') {
        return { error: 'Insufficient permissions' }
      }
    }
    
    const { data, fileName, mimeType } = await GdprService.exportUserData(targetUserId, user?.id);
    
    // Log the export (moved here from service, as audit logging is typically controller's responsibility)
    await logAuditEvent({
      user_id: user?.id || targetUserId,
      user_email: user?.email || undefined,
      operation_type: 'export',
      resource_type: 'user_data',
      resource_id: targetUserId,
      operation_status: 'success',
      additional_info: {
        exported_by: user?.id,
        record_counts: {
          profile: data ? 1 : 0, // Simplified, actual count can be derived from data
          // Actual counts would be passed back from service
        }
      }
    })
    
    return {
      success: true,
      data: data,
      fileName,
      mimeType
    }
  } catch (error: unknown) {
    console.error('Error exporting user data:', error)
    return { error: getErrorMessage(error) }
  }
}

/**
 * Delete all user data (right to be forgotten)
 * Note: This is a destructive operation and should be carefully considered
 */
export async function deleteUserData(confirmEmail: string) {
  try {
    const supabase = await createClient()
    const adminClient = createAdminClient()

    // Get current user
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return { error: 'User not authenticated' }
    }

    // Only super admins can delete user data
    const { data: profile } = await adminClient
      .from('profiles')
      .select('system_role')
      .eq('id', user.id)
      .single()

    if (profile?.system_role !== 'super_admin') {
      return { error: 'Insufficient permissions' }
    }

    // Look up target user by email instead of a caller-supplied userId (C17 fix)
    const { data: targetProfile } = await adminClient
      .from('profiles')
      .select('id, email')
      .eq('email', confirmEmail)
      .single()

    if (!targetProfile) {
      return { error: 'No user found with that email' }
    }

    const targetUserId = targetProfile.id

    // Execute deletion first, then write audit log on success (H6 fix)
    const result = await GdprService.deleteUserData(targetUserId)

    await logAuditEvent({
      user_id: user.id,
      user_email: user.email || undefined,
      operation_type: 'delete',
      resource_type: 'user_data',
      resource_id: targetUserId,
      operation_status: 'success',
      additional_info: {
        deleted_by: user.id,
        email: confirmEmail,
        status: 'completed'
      }
    })

    return {
      success: true,
      message: result.message
    }

  } catch (error: unknown) {
    console.error('Error deleting user data:', error)
    return { error: getErrorMessage(error) }
  }
}