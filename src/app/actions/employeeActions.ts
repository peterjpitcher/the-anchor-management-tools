'use server'

import { createAdminClient } from '@/lib/supabase/admin';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { ActionFormState, NoteFormState, AttachmentFormState, DeleteState } from '@/types/actions';
import { getConstraintErrorMessage, isPostgrestError } from '@/lib/dbErrorHandler';
import { MAX_FILE_SIZE } from '@/lib/constants';
import { logAuditEvent } from '@/app/actions/audit';
import { getCurrentUser } from '@/lib/audit-helpers';
import { checkUserPermission } from './rbac';
// Import services and schemas
import { 
  EmployeeService,
  employeeSchema,
  noteSchema,
  addAttachmentSchema,
  deleteAttachmentSchema,
  EmergencyContactSchema,
  FinancialDetailsSchema,
  HealthRecordSchema,
  RightToWorkSchema,
  ONBOARDING_CHECKLIST_FIELDS,
  ONBOARDING_FIELD_CONFIG,
  OnboardingChecklistField
	} from '@/services/employees';

const EMPLOYEE_ATTACHMENTS_BUCKET_NAME = 'employee-attachments';
const RIGHT_TO_WORK_ALLOWED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;
const EMPLOYEE_ATTACHMENT_ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
] as const;

function sanitizeFileName(name: string, fallback: string) {
  const sanitized = name
    .replace(/[^\w\s.-]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '');

  return sanitized || fallback;
}

// Helper to clean form data (moved from original actions)
function cleanFormDataForEmployee(formData: FormData, includeFiles = false) {
  const formDataEntries = Object.fromEntries(formData.entries());
  const cleanedData = Object.entries(formDataEntries).reduce((acc, [key, value]) => {
    // Convert empty strings to null for optional fields
    if (value === '' && [
      'date_of_birth',
      'address',
      'post_code',
      'phone_number',
      'mobile_number',
      'first_shift_date',
      'uniform_preference',
      'employment_end_date',
      'employment_end_date',
      'ni_number',
      'bank_account_number',
      'bank_sort_code',
      'bank_name',
      'payee_name',
      'branch_address',
      'doctor_name',
      'doctor_address',
      'allergies',
      'absence_or_treatment_details',
      'illness_history',
      'recent_treatment',
      'disability_reg_number',
      'disability_reg_expiry_date',
      'disability_details',
      'relationship',
      'document_reference',
      'document_details',
      'document_expiry_date',
      'follow_up_date',
      'verified_by_user_id',
      'check_method',
      'note'
    ].includes(key)) {
      acc[key] = null;
    } else if (key === 'document_photo' && !includeFiles) {
        // Skip file if not explicitly asked
    } else if ([
      'has_diabetes',
      'has_epilepsy',
      'has_skin_condition',
      'has_depressive_illness',
      'has_bowel_problems',
      'has_ear_problems',
      'is_registered_disabled',
      'has_allergies',
      'had_absence_over_2_weeks_last_3_years',
      'had_outpatient_treatment_over_3_months_last_3_years',
      'keyholder_status'
    ].includes(key)) {
        acc[key] = value === 'on' || value === 'true'; // Convert checkbox to boolean
    } else {
      acc[key] = value;
    }
    return acc;
  }, {} as Record<string, any>);
  return cleanedData;
}


// Employee Actions
export async function addEmployee(prevState: ActionFormState, formData: FormData): Promise<ActionFormState> {
    const hasPermission = await checkUserPermission('employees', 'create');
    if (!hasPermission) {
        return { type: 'error', message: 'Insufficient permissions to create employees.' };
    }

    const cleanedData = cleanFormDataForEmployee(formData);

    const financialFields = ['ni_number', 'payee_name', 'bank_name', 'bank_sort_code', 'bank_account_number', 'branch_address'];
    const healthFields = ['doctor_name', 'doctor_address', 'allergies', 'has_allergies', 'had_absence_over_2_weeks_last_3_years', 'had_outpatient_treatment_over_3_months_last_3_years', 'absence_or_treatment_details', 'illness_history', 'recent_treatment', 
        'has_diabetes', 'has_epilepsy', 'has_skin_condition', 'has_depressive_illness', 'has_bowel_problems', 
        'has_ear_problems', 'is_registered_disabled', 'disability_reg_number', 'disability_reg_expiry_date', 
        'disability_details'];
    
    const employeeMainData: Record<string, any> = {};
    const financialData: Record<string, any> = {};
    const healthData: Record<string, any> = {};

    Object.entries(cleanedData).forEach(([key, value]) => {
      if (financialFields.includes(key)) {
        financialData[key] = value;
      } else if (healthFields.includes(key)) {
        healthData[key] = value;
      } else {
        employeeMainData[key] = value;
      }
    });

    const result = employeeSchema.safeParse(employeeMainData);

    if (!result.success) {
        console.error('Validation errors:', result.error.flatten());
        return { type: 'error', message: 'Invalid form data.', errors: result.error.flatten().fieldErrors };
    }

    const userInfo = await getCurrentUser();
    
    try {
      const newEmployee = await EmployeeService.createEmployee({
        ...result.data,
        financial: Object.keys(financialData).length > 0 ? financialData : undefined,
        health: Object.keys(healthData).length > 0 ? healthData : undefined,
      });
      
      await logAuditEvent({
          ...(userInfo.user_id && { user_id: userInfo.user_id }),
          ...(userInfo.user_email && { user_email: userInfo.user_email }),
          operation_type: 'create',
          resource_type: 'employee',
          resource_id: newEmployee.employee_id,
          operation_status: 'success',
          new_values: newEmployee,
          additional_info: {
              employee_name: `${newEmployee.first_name} ${newEmployee.last_name}`,
              job_title: newEmployee.job_title,
              status: newEmployee.status,
              has_financial_details: Object.values(financialData).some(val => val !== null),
              has_health_record: Object.values(healthData).some(val => val !== null)
          }
      });
      
      revalidatePath('/employees');
      return { type: 'success', message: 'Employee created successfully.', employeeId: newEmployee.employee_id };
    } catch (error: any) {
        const message = isPostgrestError(error) ? getConstraintErrorMessage(error) : 'Database error';
        await logAuditEvent({
            ...(userInfo.user_id && { user_id: userInfo.user_id }),
            ...(userInfo.user_email && { user_email: userInfo.user_email }),
            operation_type: 'create',
            resource_type: 'employee',
            operation_status: 'failure',
            error_message: message,
            new_values: result.data
        });
        return { type: 'error', message };
    }
}

export async function updateEmployee(prevState: ActionFormState, formData: FormData): Promise<ActionFormState> {
    const hasPermission = await checkUserPermission('employees', 'edit');
    if (!hasPermission) {
        return { type: 'error', message: 'Insufficient permissions to update employees.' };
    }

    const employeeId = formData.get('employee_id') as string;
    
    const cleanedData = cleanFormDataForEmployee(formData);
    const { employee_id, ...dataToValidate } = cleanedData;
    
    const result = employeeSchema.safeParse(dataToValidate);
    
    if (!result.success) {
        console.error('Validation errors:', result.error.flatten());
        return { type: 'error', message: 'Invalid data provided. Please check your input and try again.', errors: result.error.flatten().fieldErrors };
    }

    const userInfo = await getCurrentUser();
    
    try {
      const { updatedEmployee, oldEmployee } = await EmployeeService.updateEmployee(employeeId, result.data);
      
      const changedFields: string[] = [];
      if (oldEmployee) {
          Object.keys(updatedEmployee).forEach(key => {
              if ((oldEmployee as any)[key] !== (updatedEmployee as any)[key]) {
                  changedFields.push(key);
              }
          });
      }
      
      await logAuditEvent({
          ...(userInfo.user_id && { user_id: userInfo.user_id }),
          ...(userInfo.user_email && { user_email: userInfo.user_email }),
          operation_type: 'update',
          resource_type: 'employee',
          resource_id: employeeId,
          operation_status: 'success',
          old_values: oldEmployee,
          new_values: updatedEmployee,
          additional_info: {
              fields_changed: changedFields
          }
      });

      revalidatePath(`/employees`);
      revalidatePath(`/employees/${employeeId}`);
      return { type: 'success', message: 'Employee updated successfully.', employeeId };
    } catch (error: any) {
        const message = isPostgrestError(error) ? getConstraintErrorMessage(error) : 'Database error';
        await logAuditEvent({
            ...(userInfo.user_id && { user_id: userInfo.user_id }),
            ...(userInfo.user_email && { user_email: userInfo.user_email }),
            operation_type: 'update',
            resource_type: 'employee',
            resource_id: employeeId,
            operation_status: 'failure',
            error_message: message,
            old_values: undefined, // oldEmployee could be large, only log new_values from action
            new_values: result.data
        });
        return { type: 'error', message };
    }
}

export async function deleteEmployee(prevState: DeleteState, formData: FormData): Promise<DeleteState> {
    const hasPermission = await checkUserPermission('employees', 'delete');
    if (!hasPermission) {
        return { type: 'error', message: 'Insufficient permissions to delete employees.' };
    }

    const employeeId = formData.get('employee_id') as string;
    if (!employeeId) return { type: 'error', message: 'Employee ID is missing.' };

    const userInfo = await getCurrentUser();
    
    try {
      const deletedEmployee = await EmployeeService.deleteEmployee(employeeId);
      
      await logAuditEvent({
          ...(userInfo.user_id && { user_id: userInfo.user_id }),
          ...(userInfo.user_email && { user_email: userInfo.user_email }),
          operation_type: 'delete',
          resource_type: 'employee',
          resource_id: employeeId,
          operation_status: 'success',
          old_values: deletedEmployee,
          additional_info: {
              employee_name: deletedEmployee ? `${deletedEmployee.first_name} ${deletedEmployee.last_name}` : 'Unknown',
              job_title: deletedEmployee?.job_title,
              status: deletedEmployee?.status
          }
      });
      
      revalidatePath('/employees');
      return { type: 'success', message: 'Employee deleted successfully' };
    } catch (error: any) {
        const message = isPostgrestError(error) ? getConstraintErrorMessage(error) : 'Database error';
        await logAuditEvent({
            ...(userInfo.user_id && { user_id: userInfo.user_id }),
            ...(userInfo.user_email && { user_email: userInfo.user_email }),
            operation_type: 'delete',
            resource_type: 'employee',
            resource_id: employeeId,
            operation_status: 'failure',
            error_message: message,
            old_values: undefined // Don't log potentially large old_values on failure
        });
        return { type: 'error', message };
    }
}

export async function getEmployeeList(): Promise<{ id: string; name: string; }[] | null> {
  // Permission check might be optional for a simple dropdown list,
  // but let's keep it consistent with other actions if needed for security
  // const hasPermission = await checkUserPermission('employees', 'view');
  // if (!hasPermission) { return null; } // Or return error if strict

  try {
    return await EmployeeService.getEmployeeList();
  } catch (error) {
    console.error('Error fetching employee list:', error);
    return null;
  }
}

// Note Actions
export async function addEmployeeNote(prevState: NoteFormState, formData: FormData): Promise<NoteFormState> {
    const hasPermission = await checkUserPermission('employees', 'edit');
    if (!hasPermission) {
        return { type: 'error', message: 'Insufficient permissions to add employee notes.' };
    }

    const cleanedData = cleanFormDataForEmployee(formData);
    const result = noteSchema.safeParse(cleanedData);
    if (!result.success) {
        return { type: 'error', message: 'Invalid data', errors: result.error.flatten().fieldErrors };
    }
    
    const userInfo = await getCurrentUser();
    const notePayload = {
        ...result.data,
        created_by_user_id: result.data.created_by_user_id ?? userInfo.user_id ?? undefined
    };
    
    try {
      await EmployeeService.addEmployeeNote(notePayload);

      await logAuditEvent({
          ...(userInfo.user_id && { user_id: userInfo.user_id }),
          ...(userInfo.user_email && { user_email: userInfo.user_email }),
          operation_type: 'add_note',
          resource_type: 'employee',
          resource_id: notePayload.employee_id,
          operation_status: 'success',
          additional_info: {
              note_preview: notePayload.note_text.substring(0, 100)
          }
      });

      revalidatePath(`/employees/${notePayload.employee_id}`);
      return { type: 'success', message: 'Note added successfully.' };
    } catch (error: any) {
      return { type: 'error', message: `Database error: ${error.message}` };
    }
}

// Attachment Actions
export async function createEmployeeAttachmentUploadUrl(
  employeeId: string,
  fileName: string,
  fileType: string,
  fileSize: number
): Promise<{ type: 'success'; path: string; token: string } | { type: 'error'; message: string }> {
  try {
    const { checkRateLimit } = await import('@/lib/rate-limit-server')
    await checkRateLimit('api', 10) // 10 uploads per minute
  } catch (error) {
    if (error instanceof Error && error.message.includes('Too many requests')) {
      return { type: 'error', message: 'Too many file uploads. Please try again later.' }
    }
  }

  const hasPermission = await checkUserPermission('employees', 'upload_documents')
  if (!hasPermission) {
    return { type: 'error', message: 'Insufficient permissions to upload employee documents.' }
  }

  const employeeIdResult = z.string().uuid().safeParse(employeeId)
  if (!employeeIdResult.success) {
    return { type: 'error', message: 'Invalid employee ID.' }
  }

  if (!EMPLOYEE_ATTACHMENT_ALLOWED_MIME_TYPES.includes(fileType as (typeof EMPLOYEE_ATTACHMENT_ALLOWED_MIME_TYPES)[number])) {
    return { type: 'error', message: 'Invalid file type. Only PDF, Word, JPG, PNG, and TXT files are allowed.' }
  }

  if (!Number.isFinite(fileSize) || fileSize <= 0) {
    return { type: 'error', message: 'Invalid file size.' }
  }

  if (fileSize >= MAX_FILE_SIZE) {
    return { type: 'error', message: 'File size must be less than 10MB.' }
  }

  const finalFileName = sanitizeFileName(fileName, 'unnamed_file')
  const uniqueFileName = `${employeeId}/${Date.now()}_${finalFileName}`

  const adminClient = createAdminClient()
  const { data, error } = await adminClient.storage
    .from(EMPLOYEE_ATTACHMENTS_BUCKET_NAME)
    .createSignedUploadUrl(uniqueFileName, { upsert: false })

  if (error || !data?.token) {
    return { type: 'error', message: error?.message || 'Failed to create signed upload URL.' }
  }

  return { type: 'success', path: data.path, token: data.token }
}

export async function createRightToWorkDocumentUploadUrl(
  employeeId: string,
  fileName: string,
  fileType: string,
  fileSize: number
): Promise<{ type: 'success'; path: string; token: string } | { type: 'error'; message: string }> {
  const hasPermission = await checkUserPermission('employees', 'edit')
  if (!hasPermission) {
    return { type: 'error', message: 'Insufficient permissions to upload right to work documents.' }
  }

  const employeeIdResult = z.string().uuid().safeParse(employeeId)
  if (!employeeIdResult.success) {
    return { type: 'error', message: 'Invalid employee ID.' }
  }

  if (!RIGHT_TO_WORK_ALLOWED_MIME_TYPES.includes(fileType as (typeof RIGHT_TO_WORK_ALLOWED_MIME_TYPES)[number])) {
    return { type: 'error', message: 'Only PDF, JPG, and PNG files are allowed.' }
  }

  if (!Number.isFinite(fileSize) || fileSize <= 0) {
    return { type: 'error', message: 'Invalid file size.' }
  }

  if (fileSize >= MAX_FILE_SIZE) {
    return { type: 'error', message: 'File size must be less than 10MB.' }
  }

  const finalFileName = sanitizeFileName(fileName, 'right_to_work_document')
  const uniqueFileName = `${employeeId}/rtw_${Date.now()}_${finalFileName}`

  const adminClient = createAdminClient()
  const { data, error } = await adminClient.storage
    .from(EMPLOYEE_ATTACHMENTS_BUCKET_NAME)
    .createSignedUploadUrl(uniqueFileName, { upsert: false })

  if (error || !data?.token) {
    return { type: 'error', message: error?.message || 'Failed to create signed upload URL.' }
  }

  return { type: 'success', path: data.path, token: data.token }
}

const employeeAttachmentRecordSchema = z.object({
  employee_id: z.string().uuid(),
  category_id: z.string().uuid('A valid category must be selected.'),
  storage_path: z.string().min(1),
  file_name: z.string().min(1),
  mime_type: z
    .string()
    .min(1)
    .refine(
      (value) => EMPLOYEE_ATTACHMENT_ALLOWED_MIME_TYPES.includes(value as (typeof EMPLOYEE_ATTACHMENT_ALLOWED_MIME_TYPES)[number]),
      'Invalid file type. Only PDF, Word, JPG, PNG, and TXT files are allowed.'
    ),
  file_size_bytes: z.preprocess(
    (value) => (typeof value === 'string' ? Number(value) : value),
    z.number().int().positive().max(MAX_FILE_SIZE - 1, 'File size must be less than 10MB.')
  ),
  description: z
    .preprocess((value) => (typeof value === 'string' && value.trim() === '' ? undefined : value), z.string().optional())
    .optional(),
})

export async function saveEmployeeAttachmentRecord(
  prevState: AttachmentFormState,
  formData: FormData
): Promise<AttachmentFormState> {
  const hasPermission = await checkUserPermission('employees', 'upload_documents')
  if (!hasPermission) {
    return { type: 'error', message: 'Insufficient permissions to upload employee documents.' }
  }

  const raw = Object.fromEntries(formData.entries())
  const parsed = employeeAttachmentRecordSchema.safeParse(raw)
  if (!parsed.success) {
    return { type: 'error', message: 'Validation failed.', errors: parsed.error.flatten().fieldErrors }
  }

  const { employee_id, category_id, storage_path, file_name, mime_type, file_size_bytes, description } = parsed.data
  if (!storage_path.startsWith(`${employee_id}/`)) {
    return { type: 'error', message: 'Invalid upload path.' }
  }

  const adminClient = createAdminClient()

  try {
    const { error: dbError } = await adminClient.from('employee_attachments').insert({
      employee_id,
      category_id,
      file_name,
      storage_path,
      mime_type,
      file_size_bytes,
      description: description || null,
    })

    if (dbError) {
      throw new Error(`Database insert failed: ${dbError.message}`)
    }

    const userInfo = await getCurrentUser()
    await logAuditEvent({
      ...(userInfo.user_id && { user_id: userInfo.user_id }),
      ...(userInfo.user_email && { user_email: userInfo.user_email }),
      operation_type: 'add_attachment',
      resource_type: 'employee',
      resource_id: employee_id,
      operation_status: 'success',
      additional_info: {
        file_name,
        category: category_id,
        file_size: file_size_bytes,
        storage_path,
      },
    })

    revalidatePath(`/employees/${employee_id}`)
    return { type: 'success', message: 'Attachment uploaded successfully!' }
  } catch (error: any) {
    console.error('Attachment record save error:', error)
    const { error: removeError } = await adminClient.storage.from(EMPLOYEE_ATTACHMENTS_BUCKET_NAME).remove([storage_path])
    if (removeError) {
      console.error(`Failed to clean up uploaded file '${storage_path}' after DB error`, removeError)
    }

    return { type: 'error', message: error?.message || 'An unexpected error occurred during upload.' }
  }
}

export async function addEmployeeAttachment(
  prevState: AttachmentFormState,
  formData: FormData
): Promise<AttachmentFormState> {
  try {
    const { checkRateLimit } = await import('@/lib/rate-limit-server')
    await checkRateLimit('api', 10) // 10 uploads per minute
  } catch (error) {
    if (error instanceof Error && error.message.includes('Too many requests')) {
      return { type: 'error', message: 'Too many file uploads. Please try again later.' };
    }
  }

  const hasPermission = await checkUserPermission('employees', 'upload_documents');
  if (!hasPermission) {
    return { type: 'error', message: 'Insufficient permissions to upload employee documents.' };
  }

  const cleanedData = cleanFormDataForEmployee(formData, true); // Pass true to include files
  const result = addAttachmentSchema.safeParse(cleanedData);
  if (!result.success) {
    console.log('Validation failed:', result.error.flatten().fieldErrors);
    return { type: 'error', message: "Validation failed.", errors: result.error.flatten().fieldErrors };
  }

  const { employee_id, attachment_file, category_id, description } = result.data;

  try {
    await EmployeeService.addEmployeeAttachment(employee_id, attachment_file, category_id, description);
    
    const userInfo = await getCurrentUser();
    await logAuditEvent({
      ...(userInfo.user_id && { user_id: userInfo.user_id }),
      ...(userInfo.user_email && { user_email: userInfo.user_email }),
      operation_type: 'add_attachment',
      resource_type: 'employee',
      resource_id: employee_id,
      operation_status: 'success',
      additional_info: {
        file_name: attachment_file.name,
        category: category_id,
        file_size: attachment_file.size,
        // storage_path: result.storagePath // Cannot expose storage path via action return
      }
    });
    
    revalidatePath(`/employees/${employee_id}`);
    return { type: 'success', message: 'Attachment uploaded successfully!' };
  } catch (error: any) {
    console.error('Attachment upload error:', error);
    return { type: 'error', message: error.message || 'An unexpected error occurred during upload.' };
  }
}

export async function getAttachmentSignedUrl(storagePath: string): Promise<{ url: string | null; error: string | null }> {
  const hasPermission = await checkUserPermission('employees', 'view_documents');
  if (!hasPermission) {
    return { url: null, error: 'Insufficient permissions to view employee documents.' };
  }

  try {
    const url = await EmployeeService.getAttachmentSignedUrl(storagePath);
    const userInfo = await getCurrentUser();
    await logAuditEvent({
      ...(userInfo.user_id && { user_id: userInfo.user_id }),
      ...(userInfo.user_email && { user_email: userInfo.user_email }),
      operation_type: 'view',
      resource_type: 'employee_attachment',
      resource_id: storagePath,
      operation_status: 'success',
      additional_info: {
        storage_path: storagePath
      }
    });
    return { url, error: null };
  } catch (error: any) {
    console.error('Error creating signed URL:', error);
    return { url: null, error: error.message };
  }
}

export async function deleteEmployeeAttachment(prevState: DeleteState, formData: FormData): Promise<DeleteState> {
    const hasPermission = await checkUserPermission('employees', 'delete_documents');
    if (!hasPermission) {
        return { type: 'error', message: 'Insufficient permissions to delete employee documents.' };
    }

    const cleanedData = cleanFormDataForEmployee(formData);
    const result = deleteAttachmentSchema.safeParse(cleanedData);
    if(!result.success){
        return { type: 'error', message: 'Invalid IDs provided.', errors: result.error.flatten().fieldErrors };
    }

    const { employee_id, attachment_id, storage_path } = result.data;
    
    try {
      const deletedAttachment = await EmployeeService.deleteEmployeeAttachment(attachment_id, storage_path);

      const userInfo = await getCurrentUser();
      await logAuditEvent({
          ...(userInfo.user_id && { user_id: userInfo.user_id }),
          ...(userInfo.user_email && { user_email: userInfo.user_email }),
          operation_type: 'delete_attachment',
          resource_type: 'employee',
          resource_id: employee_id,
          operation_status: 'success',
          additional_info: {
              file_name: deletedAttachment.file_name || 'Unknown',
              storage_path: storage_path
          }
      });

      revalidatePath(`/employees/${employee_id}`);
      return { type: 'success', message: 'Attachment deleted successfully.' };
    } catch (error: any) {
      console.error('Error deleting employee attachment:', error);
      return { type: 'error', message: error.message || 'Failed to delete attachment.' };
    }
}

export async function addEmergencyContact(
  prevState: ActionFormState | null,
  formData: FormData
): Promise<ActionFormState | null> {
  const hasPermission = await checkUserPermission('employees', 'edit');
  if (!hasPermission) {
    return {
      type: 'error',
      message: 'Insufficient permissions to add emergency contacts.',
    };
  }

  const cleanedData = cleanFormDataForEmployee(formData);
  const validatedFields = EmergencyContactSchema.safeParse(cleanedData);

  if (!validatedFields.success) {
    return {
      type: 'error',
      message: 'Validation failed.',
      errors: validatedFields.error.flatten().fieldErrors,
    };
  }

  try {
    await EmployeeService.addEmergencyContact(validatedFields.data);

    const userInfo = await getCurrentUser();
    await logAuditEvent({
      ...(userInfo.user_id && { user_id: userInfo.user_id }),
      ...(userInfo.user_email && { user_email: userInfo.user_email }),
      operation_type: 'update',
      resource_type: 'employee',
      resource_id: validatedFields.data.employee_id,
      operation_status: 'success',
      additional_info: {
        action: 'add_emergency_contact',
        contact_name: validatedFields.data.name,
        relationship: validatedFields.data.relationship,
        priority: validatedFields.data.priority
      }
    });

    revalidatePath(`/employees/${validatedFields.data.employee_id}`);
    return {
      type: 'success',
      message: 'Emergency contact added successfully.',
    };
  } catch (error: any) {
    console.error('Error adding emergency contact:', error);
    const message = isPostgrestError(error) ? getConstraintErrorMessage(error) : 'Database error: Could not add emergency contact.';
    return {
      type: 'error',
      message,
    };
  }
}

export async function upsertFinancialDetails(
  prevState: ActionFormState | null,
  formData: FormData
): Promise<ActionFormState | null> {
  const hasPermission = await checkUserPermission('employees', 'edit');
  if (!hasPermission) {
    return {
      type: 'error',
      message: 'Insufficient permissions to update financial details.',
    };
  }

  const cleanedData = cleanFormDataForEmployee(formData);
  const validatedFields = FinancialDetailsSchema.safeParse(cleanedData);

  if (!validatedFields.success) {
    return {
      type: 'error',
      message: 'Validation failed.',
      errors: validatedFields.error.flatten().fieldErrors,
    };
  }

  try {
    await EmployeeService.upsertFinancialDetails(validatedFields.data);

    const userInfo = await getCurrentUser();
    await logAuditEvent({
      ...(userInfo.user_id && { user_id: userInfo.user_id }),
      ...(userInfo.user_email && { user_email: userInfo.user_email }),
      operation_type: 'update',
      resource_type: 'employee',
      resource_id: validatedFields.data.employee_id,
      operation_status: 'success',
      additional_info: {
        action: 'update_financial_details',
        fields_updated: Object.keys(validatedFields.data).filter(k => k !== 'employee_id' && (validatedFields.data as any)[k] !== null)
      }
    });

    revalidatePath(`/employees/${validatedFields.data.employee_id}`);
    return {
      type: 'success',
      message: 'Financial details saved successfully.',
    };
  } catch (error: any) {
    console.error('Error upserting financial details:', error);
    const message = isPostgrestError(error) ? getConstraintErrorMessage(error) : 'Database error: Could not save financial details.';
    return {
      type: 'error',
      message,
    };
  }
}

export async function upsertHealthRecord(
  prevState: ActionFormState | null,
  formData: FormData
): Promise<ActionFormState | null> {
  const hasPermission = await checkUserPermission('employees', 'edit');
  if (!hasPermission) {
    return {
      type: 'error',
      message: 'Insufficient permissions to update health records.',
    };
  }

  const data: any = Object.fromEntries(formData.entries());

  const booleanFields = [
    'has_diabetes',
    'has_epilepsy',
    'has_skin_condition',
    'has_depressive_illness',
    'has_bowel_problems',
    'has_ear_problems',
    'is_registered_disabled',
    'has_allergies',
    'had_absence_over_2_weeks_last_3_years',
    'had_outpatient_treatment_over_3_months_last_3_years'
  ];
  booleanFields.forEach(field => {
    data[field] = data[field] === 'on';
  });

  // Keep dependent text fields consistent with checkbox state
  if (!data.has_allergies) {
    data.allergies = null;
  }

  if (!data.had_absence_over_2_weeks_last_3_years && !data.had_outpatient_treatment_over_3_months_last_3_years) {
    data.absence_or_treatment_details = null;
  }
  
  const optionalTextFields = [
    'doctor_name',
    'doctor_address',
    'allergies',
    'absence_or_treatment_details',
    'illness_history',
    'recent_treatment',
    'disability_reg_number',
    'disability_details'
  ];
  optionalTextFields.forEach(field => {
    if (data[field] === '') {
      data[field] = null;
    }
  });
  
  if (data.disability_reg_expiry_date === '') {
      data.disability_reg_expiry_date = null;
  }

  const validatedFields = HealthRecordSchema.safeParse(data);

  if (!validatedFields.success) {
    return {
      type: 'error',
      message: 'Validation failed.',
      errors: validatedFields.error.flatten().fieldErrors,
    };
  }

  try {
    await EmployeeService.upsertHealthRecord(validatedFields.data);

    const userInfo = await getCurrentUser();
    await logAuditEvent({
      ...(userInfo.user_id && { user_id: userInfo.user_id }),
      ...(userInfo.user_email && { user_email: userInfo.user_email }),
      operation_type: 'update',
      resource_type: 'employee',
      resource_id: validatedFields.data.employee_id,
      operation_status: 'success',
      additional_info: {
        action: 'update_health_records',
        fields_updated: Object.keys(validatedFields.data).filter(k => k !== 'employee_id')
      }
    });

    revalidatePath(`/employees/${validatedFields.data.employee_id}`);
    return {
      type: 'success',
      message: 'Health record saved successfully.',
    };
  } catch (error: any) {
    console.error('Error upserting health record:', error);
    const message = isPostgrestError(error) ? getConstraintErrorMessage(error) : 'Database error: Could not save health record.';
    return {
      type: 'error',
      message,
    };
  }
}

export async function upsertRightToWork(
  prevState: ActionFormState | null,
  formData: FormData
): Promise<ActionFormState | null> {
  const hasPermission = await checkUserPermission('employees', 'edit');
  if (!hasPermission) {
    return {
      type: 'error',
      message: 'Insufficient permissions to update right to work information.',
	    };
	  }

	  const photoStoragePathValue = formData.get('photo_storage_path')
	  const photoStoragePath =
	    typeof photoStoragePathValue === 'string' && photoStoragePathValue.trim().length > 0 ? photoStoragePathValue.trim() : null

	  const cleanedData = cleanFormDataForEmployee(formData, true); // Include files for this one
	  
	  // Handle file field - if it's an empty file, remove it from data before validation
	  if (cleanedData.document_photo && cleanedData.document_photo instanceof File && cleanedData.document_photo.size === 0) {
    delete cleanedData.document_photo;
  }

  const validatedFields = RightToWorkSchema.safeParse(cleanedData);

  if (!validatedFields.success) {
    return {
      type: 'error',
      message: 'Validation failed.',
      errors: validatedFields.error.flatten().fieldErrors,
	    };
	  }

	  try {
	    const userInfo = await getCurrentUser();
	    const currentUserId = userInfo.user_id ?? null;

	    if (photoStoragePath && !photoStoragePath.startsWith(`${validatedFields.data.employee_id}/`)) {
	      return {
	        type: 'error',
	        message: 'Invalid upload path.',
	      };
	    }

	    await EmployeeService.upsertRightToWork(
	      validatedFields.data.employee_id,
	      validatedFields.data,
	      currentUserId,
	      photoStoragePath
	    );

	    await logAuditEvent({
	      ...(userInfo.user_id && { user_id: userInfo.user_id }),
	      ...(userInfo.user_email && { user_email: userInfo.user_email }),
      operation_type: 'update',
      resource_type: 'employee',
      resource_id: validatedFields.data.employee_id,
      operation_status: 'success',
	      additional_info: {
	        action: 'update_right_to_work',
	        document_type: validatedFields.data.document_type,
	        verification_date: validatedFields.data.verification_date,
	        photo_uploaded: Boolean(validatedFields.data.document_photo || photoStoragePath),
	      }
	    });

    revalidatePath(`/employees/${validatedFields.data.employee_id}`);
    return {
      type: 'success',
      message: 'Right to work information saved successfully.',
    };
  } catch (error: any) {
    console.error('Error upserting right to work:', error);
    return {
      type: 'error',
      message: error.message || 'Database error: Could not save right to work information.',
    };
  }
}

export async function getRightToWorkPhotoUrl(photoPath: string): Promise<{ url: string | null; error: string | null }> {
  const hasPermission = await checkUserPermission('employees', 'view_documents');
  if (!hasPermission) {
    return { url: null, error: 'Insufficient permissions to view employee documents.' };
  }

  try {
    const url = await EmployeeService.getRightToWorkPhotoUrl(photoPath);
    return { url, error: null };
  } catch (error: any) {
    console.error('Error creating signed URL for right to work photo:', error);
    return { url: null, error: error.message };
  }
}

export async function deleteRightToWorkPhoto(employeeId: string): Promise<{ error?: string; success?: boolean }> {
  const hasPermission = await checkUserPermission('employees', 'edit');
  if (!hasPermission) {
    return { error: 'Insufficient permissions to delete employee documents.' };
  }

  try {
    await EmployeeService.deleteRightToWorkPhoto(employeeId);
    
    const userInfo = await getCurrentUser();
    await logAuditEvent({
      ...(userInfo.user_id && { user_id: userInfo.user_id }),
      ...(userInfo.user_email && { user_email: userInfo.user_email }),
      operation_type: 'delete',
      resource_type: 'employee_attachment',
      resource_id: employeeId,
      operation_status: 'success',
      additional_info: {
        attachment_type: 'right_to_work_photo',
        file_path: 'deleted' // Path is not available from service after delete
      }
    });
    
    revalidatePath(`/employees/${employeeId}`);
    return { success: true };
  } catch (error: any) {
    console.error('Error deleting right to work photo:', error);
    return { error: error.message || 'Failed to delete photo.' };
  }
}

export async function updateOnboardingChecklist(
  employeeId: string,
  field: string,
  checked: boolean
): Promise<{ error?: string; success?: boolean }> {
  const hasPermission = await checkUserPermission('employees', 'edit');
  if (!hasPermission) {
    return { error: 'Insufficient permissions to update onboarding checklist.' };
  }

  try {
    await EmployeeService.updateOnboardingChecklist(employeeId, field, checked);

    const userInfo = await getCurrentUser();
    await logAuditEvent({
      ...(userInfo.user_id && { user_id: userInfo.user_id }),
      ...(userInfo.user_email && { user_email: userInfo.user_email }),
      operation_type: 'update',
      resource_type: 'employee',
      resource_id: employeeId,
      operation_status: 'success',
      additional_info: {
        action: 'update_onboarding_checklist',
        field: field,
        checked: checked,
      }
    });

    revalidatePath(`/employees/${employeeId}`);
    return { success: true };
  } catch (error: any) {
    console.error('Error updating onboarding checklist:', error);
    return { error: error.message || 'Failed to update onboarding checklist.' };
  }
}

export async function getOnboardingProgress(
  employeeId: string
): Promise<{ data: { completed: number; total: number; percentage: number; items: Array<{ field: OnboardingChecklistField; label: string; completed: boolean; date: string | null }>; data: Record<string, any> | null } | null; error?: string }> {
  const hasPermission = await checkUserPermission('employees', 'view');
  if (!hasPermission) {
    return { data: null, error: 'Insufficient permissions to view onboarding progress.' };
  }

  try {
    const result = await EmployeeService.getOnboardingProgress(employeeId);
    return { data: result };
  } catch (error: any) {
    console.error('Error fetching onboarding progress:', error);
    return { data: null, error: error.message || 'Failed to fetch onboarding progress.' };
  }
}
