'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { headers } from 'next/headers'
import type { Database } from '@/types/database'

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
    const supabase = createAdminClient()
    const headersList = await headers()
    
    // Get client info
    const userAgent = headersList.get('user-agent') || 'Unknown'
    const forwardedFor = headersList.get('x-forwarded-for')
    const realIp = headersList.get('x-real-ip')
    const ip = forwardedFor?.split(',')[0] || realIp || 'Unknown'
    
    // If we have user_id but no user_email, try to look it up
    let user_email = params.user_email
  if (params.user_id && !user_email) {
      const { data: userResponse, error: userLookupError } = await supabase.auth.admin.getUserById(params.user_id)

      if (!userLookupError) {
        const email = userResponse?.user?.email
        if (email) {
          user_email = email
        }
      }
    }

    // Create audit log entry
    const payload = {
      user_id: params.user_id ?? null,
      user_email: user_email ?? null,
      operation_type: params.operation_type,
      resource_type: params.resource_type,
      resource_id: params.resource_id ?? null,
      operation_status: params.operation_status,
      error_message: params.error_message ?? null,
      old_values: params.old_values ?? null,
      new_values: params.new_values ?? null,
      additional_info: params.additional_info ?? null,
      ip_address: ip,
      user_agent: userAgent,
    } satisfies Database['public']['Tables']['audit_logs']['Insert']

    const { error } = await supabase
      .from('audit_logs')
      .insert(payload)

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
