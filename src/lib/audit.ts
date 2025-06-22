import { createClient } from '@/lib/supabase/server'

export type AuditAction = 
  | 'login'
  | 'logout'
  | 'create'
  | 'read'
  | 'update'
  | 'delete'
  | 'export'
  | 'document_access'
  | 'permission_change'
  | 'booking_status_change'
  | 'payment_recorded'
  | 'sms_sent'
  | 'sms_approved'

interface AuditEventData {
  action: AuditAction
  resource_type: string
  resource_id?: string
  details?: Record<string, unknown>
  ip_address?: string
  user_agent?: string
}

export async function logAuditEvent(data: AuditEventData) {
  const supabase = await createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return // Skip if no user context

  const { error } = await supabase.rpc('log_audit_event', {
    p_action: data.action,
    p_resource_type: data.resource_type,
    p_resource_id: data.resource_id || null,
    p_details: data.details || {},
    p_ip_address: data.ip_address || null,
    p_user_agent: data.user_agent || null
  })

  if (error) {
    console.error('Failed to log audit event:', error)
  }
}