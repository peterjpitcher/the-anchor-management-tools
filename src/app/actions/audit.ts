'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { headers } from 'next/headers'

interface AuditLogParams {
  user_id?: string;
  user_email?: string;
  operation_type: string;
  resource_type: string;
  resource_id?: string;
  operation_status: 'success' | 'failure';
  error_message?: string;
  old_values?: Record<string, any>;
  new_values?: Record<string, any>;
  additional_info?: Record<string, any>;
}

export async function logAuditEvent(params: AuditLogParams) {
  try {
    const supabase = await createAdminClient()
    const headersList = await headers()
    
    // Get client info
    const userAgent = headersList.get('user-agent') || 'Unknown'
    const forwardedFor = headersList.get('x-forwarded-for')
    const realIp = headersList.get('x-real-ip')
    const ip = forwardedFor?.split(',')[0] || realIp || 'Unknown'
    
    // If we have user_id but no user_email, try to look it up
    let user_email = params.user_email
    if (params.user_id && !user_email) {
      const { data: userData } = await supabase
        .from('auth.users')
        .select('email')
        .eq('id', params.user_id)
        .single()
      
      if (userData?.email) {
        user_email = userData.email
      }
    }

    // Create audit log entry
    const { error } = await supabase
      .from('audit_logs')
      .insert({
        ...params,
        user_email,
        ip_address: ip,
        user_agent: userAgent
      })

    if (error) {
      console.error('Failed to create audit log:', error)
    }
  } catch (error) {
    console.error('Exception in audit logging:', error)
  }
}

// Legacy function for backward compatibility
export async function logAuditEventLegacy(
  userId: string,
  action: string,
  details: Record<string, any> = {}
) {
  // Parse action into operation_type and resource_type
  const [resourceType, operationType] = action.split('.')
  
  await logAuditEvent({
    user_id: userId,
    operation_type: operationType || 'unknown',
    resource_type: resourceType || 'unknown',
    operation_status: 'success',
    additional_info: details
  })
}