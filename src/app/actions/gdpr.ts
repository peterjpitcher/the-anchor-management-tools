'use server'

import { createClient } from '@/lib/supabase/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { logAuditEvent } from './audit'

interface ExportData {
  profile: any
  customers: any[]
  bookings: any[]
  messages: any[]
  employees: any[]
  auditLogs: any[]
}

// Helper function to create Supabase admin client
function createAdminSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Missing Supabase configuration')
  }
  return createSupabaseClient(supabaseUrl, supabaseServiceRoleKey)
}

/**
 * Export all user data for GDPR compliance
 */
export async function exportUserData(userId?: string) {
  try {
    const supabase = await createClient()
    const adminClient = createAdminSupabaseClient()
    
    // Get current user if no userId provided
    const { data: { user } } = await supabase.auth.getUser()
    if (!user && !userId) {
      return { error: 'User not authenticated' }
    }
    
    const targetUserId = userId || user!.id
    
    // Check permission if exporting another user's data
    if (userId && userId !== user?.id) {
      // Only super admins can export other users' data
      const { data: profile } = await supabase
        .from('profiles')
        .select('system_role')
        .eq('id', user!.id)
        .single()
      
      if (profile?.system_role !== 'super_admin') {
        return { error: 'Insufficient permissions' }
      }
    }
    
    const exportData: ExportData = {
      profile: null,
      customers: [],
      bookings: [],
      messages: [],
      employees: [],
      auditLogs: []
    }
    
    // Export profile data
    const { data: profileData } = await adminClient
      .from('profiles')
      .select('*')
      .eq('id', targetUserId)
      .single()
    
    exportData.profile = profileData
    
    // Export customer data (if user has customer records)
    const { data: customers } = await adminClient
      .from('customers')
      .select('*')
      .eq('email_address', profileData?.email)
    
    exportData.customers = customers || []
    
    // Export bookings for those customers
    if (customers && customers.length > 0) {
      const customerIds = customers.map(c => c.id)
      const { data: bookings } = await adminClient
        .from('bookings')
        .select('*, event:events(*)')
        .in('customer_id', customerIds)
      
      exportData.bookings = bookings || []
    }
    
    // Export messages
    if (customers && customers.length > 0) {
      const customerIds = customers.map(c => c.id)
      const { data: messages } = await adminClient
        .from('messages')
        .select('*')
        .in('customer_id', customerIds)
      
      exportData.messages = messages || []
    }
    
    // Export employee data (if user is an employee)
    const { data: employees } = await adminClient
      .from('employees')
      .select('*')
      .eq('email_address', profileData?.email)
    
    exportData.employees = employees || []
    
    // Export audit logs for this user
    const { data: auditLogs } = await adminClient
      .from('audit_logs')
      .select('*')
      .eq('user_id', targetUserId)
      .order('created_at', { ascending: false })
      .limit(1000)
    
    exportData.auditLogs = auditLogs || []
    
    // Log the export
    await logAuditEvent({
      user_id: user?.id || targetUserId,
      operation_type: 'export',
      resource_type: 'user_data',
      resource_id: targetUserId,
      operation_status: 'success',
      additional_info: {
        exported_by: user?.id,
        record_counts: {
          profile: exportData.profile ? 1 : 0,
          customers: exportData.customers.length,
          bookings: exportData.bookings.length,
          messages: exportData.messages.length,
          employees: exportData.employees.length,
          auditLogs: exportData.auditLogs.length
        }
      }
    })
    
    // Return as JSON file
    const jsonData = JSON.stringify(exportData, null, 2)
    const fileName = `gdpr-export-${targetUserId}-${new Date().toISOString().split('T')[0]}.json`
    
    return {
      success: true,
      data: jsonData,
      fileName,
      mimeType: 'application/json'
    }
    
  } catch (error) {
    console.error('Error exporting user data:', error)
    return { error: 'Failed to export user data' }
  }
}

/**
 * Delete all user data (right to be forgotten)
 * Note: This is a destructive operation and should be carefully considered
 */
export async function deleteUserData(userId: string, confirmEmail: string) {
  try {
    const supabase = await createClient()
    const adminClient = createAdminSupabaseClient()
    
    // Get current user
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return { error: 'User not authenticated' }
    }
    
    // Only super admins can delete user data
    const { data: profile } = await supabase
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
    
    // Note: Actual deletion would happen here
    // For safety, we're only logging the request
    // Implement actual deletion based on your data retention policies
    
    return {
      success: true,
      message: 'User data deletion request has been logged. Manual review required.'
    }
    
  } catch (error) {
    console.error('Error deleting user data:', error)
    return { error: 'Failed to process deletion request' }
  }
}