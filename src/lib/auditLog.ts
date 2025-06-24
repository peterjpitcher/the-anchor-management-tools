import { createClient } from '@supabase/supabase-js';
import { headers } from 'next/headers';

export type AuditOperationType = 
  | 'login'
  | 'logout'
  | 'create'
  | 'update'
  | 'delete'
  | 'view'
  | 'export'
  | 'upload'
  | 'download'
  | 'failed_access';

export type AuditResourceType = 
  | 'employee'
  | 'customer'
  | 'booking'
  | 'event'
  | 'financial_details'
  | 'health_records'
  | 'attachment'
  | 'message'
  | 'auth'
  | 'settings';

interface AuditLogOptions {
  userId?: string | null;
  userEmail?: string | null;
  operationType: AuditOperationType;
  resourceType: AuditResourceType;
  resourceId?: string;
  operationStatus: 'success' | 'failure';
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  errorMessage?: string;
  additionalInfo?: Record<string, unknown>;
}

function getSupabaseServiceClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase configuration for audit logging');
    return null;
  }
  
  return createClient(supabaseUrl, supabaseServiceKey);
}

async function getClientInfo() {
  try {
    const headersList = await headers();
    const forwardedFor = headersList.get('x-forwarded-for');
    const realIp = headersList.get('x-real-ip');
    const userAgent = headersList.get('user-agent');
    
    const ipAddress = forwardedFor?.split(',')[0] || realIp || null;
    
    return {
      ipAddress,
      userAgent
    };
  } catch {
    // Headers might not be available in all contexts
    return {
      ipAddress: null,
      userAgent: null
    };
  }
}

export async function logAuditEvent(options: AuditLogOptions): Promise<void> {
  try {
    const supabase = getSupabaseServiceClient();
    if (!supabase) {
      console.error('Audit logging failed: No Supabase client');
      return;
    }
    
    const { ipAddress, userAgent } = await getClientInfo();
    
    // Remove sensitive data from values before logging
    const sanitizedOldValues = options.oldValues ? sanitizeForAudit(options.oldValues) : null;
    const sanitizedNewValues = options.newValues ? sanitizeForAudit(options.newValues) : null;
    
    const { error } = await supabase.rpc('log_audit_event', {
      p_user_id: options.userId || null,
      p_user_email: options.userEmail || null,
      p_operation_type: options.operationType,
      p_resource_type: options.resourceType,
      p_resource_id: options.resourceId || null,
      p_operation_status: options.operationStatus,
      p_ip_address: ipAddress,
      p_user_agent: userAgent,
      p_old_values: sanitizedOldValues,
      p_new_values: sanitizedNewValues,
      p_error_message: options.errorMessage || null,
      p_additional_info: options.additionalInfo || null
    });
    
    if (error) {
      console.error('Failed to write audit log:', error);
    }
  } catch (error) {
    // Audit logging should never cause the main operation to fail
    console.error('Audit logging error:', error);
  }
}

/**
 * Remove sensitive fields from data before logging
 */
function sanitizeForAudit(data: unknown): unknown {
  if (!data) return null;
  
  // Fields to exclude from audit logs
  const sensitiveFields = [
    'password',
    'bank_account_number',
    'bank_sort_code',
    'ni_number',
    'medical_conditions',
    'medications',
    'allergies'
  ];
  
  // Deep clone the object
  const sanitized = JSON.parse(JSON.stringify(data));
  
  // Remove sensitive fields
  for (const field of sensitiveFields) {
    if (field in sanitized) {
      // Keep the field but mask the value
      if (field === 'bank_account_number' && sanitized[field]) {
        sanitized[field] = '****' + sanitized[field].slice(-4);
      } else if (field === 'bank_sort_code' && sanitized[field]) {
        sanitized[field] = '**-**-**';
      } else if (field === 'ni_number' && sanitized[field]) {
        sanitized[field] = '****' + sanitized[field].slice(-4);
      } else {
        sanitized[field] = '[REDACTED]';
      }
    }
  }
  
  return sanitized;
}

/**
 * Helper to get current user info for audit logging
 */
export async function getCurrentUserForAudit(supabase: any) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    return {
      userId: user?.id || null,
      userEmail: user?.email || null
    };
  } catch {
    return {
      userId: null,
      userEmail: null
    };
  }
}