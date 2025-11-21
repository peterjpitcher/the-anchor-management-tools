'use server'

import { createClient } from '@/lib/supabase/server'
import { logAuditEvent } from './audit'
import { getTodayIsoDate } from '@/lib/dateUtils'
import { GdprService } from '@/services/gdpr'
import { createAdminClient } from '@/lib/supabase/admin' // Needed for admin client creation if not used directly
import type { User as SupabaseUser } from '@supabase/supabase-js'

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
  } catch (error: any) {
    console.error('Error exporting user data:', error)
    return { error: error.message || 'Failed to export user data' }
  }
}

/**
 * Delete all user data (right to be forgotten)
 * Note: This is a destructive operation and should be carefully considered
 */
export async function deleteUserData(userId: string, confirmEmail: string) {
  try {
    const supabase = await createClient()
    const adminClient = createAdminClient(); // Use admin client
    
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
    
    // Verify the user to be deleted
    const { data: targetProfile } = await adminClient
      .from('profiles')
      .select('email')
      .eq('id', userId)
      .single()
    
    if (!targetProfile || targetProfile.email !== confirmEmail) {
      return { error: 'Email confirmation does not match' }
    }
    
    // Log the deletion request first
    await logAuditEvent({
      user_id: user.id,
      user_email: user.email || undefined,
      operation_type: 'delete',
      resource_type: 'user_data',
      resource_id: userId,
      operation_status: 'success',
      additional_info: {
        deleted_by: user.id,
        email: confirmEmail,
        status: 'initiated'
      }
    })
    
    const result = await GdprService.deleteUserData(userId);
    
    return {
      success: true,
      message: result.message
    }
    
  } catch (error: any) {
    console.error('Error deleting user data:', error)
    return { error: error.message || 'Failed to process deletion request' }
  }
}