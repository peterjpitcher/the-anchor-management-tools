'use server'

import { checkUserPermission } from './rbac'
import { createClient } from '@/lib/supabase/server' // Still needed for RLS for now (checkUserPermission uses it)
import type {
  Employee,
  EmployeeAttachment,
  EmployeeFinancialDetails,
  EmployeeHealthRecord,
  EmployeeEmergencyContact,
  EmployeeRightToWork,
  AttachmentCategory,
  EmployeeNote
} from '@/types/database'

export type { EmployeeNoteWithAuthor } from '@/services/employees';


import { EmployeeService, type EmployeeDetailData, type EmployeeEditData } from '@/services/employees'

export interface EmployeePermissions {
  canView: boolean
  canEdit: boolean
  canDelete: boolean
  canViewDocuments: boolean
  canUploadDocuments: boolean
  canDeleteDocuments: boolean
}

export interface AuditLogEntry {
  id: string
  created_at: string
  user_email: string | null
  operation_type: string
  resource_type: string
  resource_id: string
  operation_status: string
  old_values: Record<string, unknown> | null
  new_values: Record<string, unknown> | null
  additional_info: Record<string, unknown> | null
}

export interface EmployeeDetailResult {
  data?: EmployeeDetailData & { permissions: EmployeePermissions }
  error?: string
  notFound?: boolean
  unauthorized?: boolean
}

export interface EmployeeEditResult {
  data?: EmployeeEditData
  error?: string
  notFound?: boolean
  unauthorized?: boolean
}

export async function getEmployeeDetailData(employeeId: string): Promise<EmployeeDetailResult> {
  const [
    canView,
    canEdit,
    canDelete,
    canViewDocuments,
    canUploadDocuments,
    canDeleteDocuments,
  ] = await Promise.all([
    checkUserPermission('employees', 'view'),
    checkUserPermission('employees', 'edit'),
    checkUserPermission('employees', 'delete'),
    checkUserPermission('employees', 'view_documents'),
    checkUserPermission('employees', 'upload_documents'),
    checkUserPermission('employees', 'delete_documents'),
  ]);

  if (!canView) {
    return { unauthorized: true };
  }

  const permissions: EmployeePermissions = {
    canView,
    canEdit,
    canDelete,
    canViewDocuments,
    canUploadDocuments,
    canDeleteDocuments
  };

  try {
    const employeeData = await EmployeeService.getEmployeeByIdWithDetails(employeeId);
    
    // Filter attachments and categories based on permissions
    const filteredAttachments = canViewDocuments ? employeeData.attachments : [];
    const filteredCategories = canViewDocuments ? employeeData.attachmentCategories : [];
    
    return {
      data: {
        ...employeeData,
        attachments: filteredAttachments,
        attachmentCategories: filteredCategories,
        permissions
      }
    };
  } catch (error: any) {
    console.error('[employeeDetail] unexpected error', error);
    if (error.message === 'Employee not found.') {
      return { notFound: true };
    }
    return { error: error.message || 'Failed to load employee.' };
  }
}

export async function getEmployeeEditData(employeeId: string): Promise<EmployeeEditResult> {
  const [canEdit] = await Promise.all([
    checkUserPermission('employees', 'edit'),
  ]);

  if (!canEdit) {
    return { unauthorized: true };
  }

  try {
    const employeeData = await EmployeeService.getEmployeeByIdForEdit(employeeId);
    return { data: employeeData };
  } catch (error: any) {
    console.error('[employeeEdit] unexpected error', error);
    if (error.message === 'Employee not found.') {
      return { notFound: true };
    }
    return { error: error.message || 'Failed to load employee.' };
  }
}