'use server'

import { AuditService, type AuditLogParams } from '@/services/audit';

export async function logAuditEvent(params: AuditLogParams) {
  await AuditService.logAuditEvent(params);
}

// Legacy function for backward compatibility
export async function logAuditEventLegacy(
  userId: string,
  action: string,
  details: Record<string, any> = {}
) {
  // Parse action into operation_type and resource_type
  const [resourceType, operationType] = action.split('.')
  
  await AuditService.logAuditEvent({
    user_id: userId,
    operation_type: operationType || 'unknown',
    resource_type: resourceType || 'unknown',
    operation_status: 'success',
    additional_info: details
  })
}