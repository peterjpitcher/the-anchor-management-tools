'use server'

import { getSupabaseAdminClient } from '@/lib/supabase-singleton';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { ActionFormState, NoteFormState, AttachmentFormState, DeleteState } from '@/types/actions';
import { getConstraintErrorMessage, isPostgrestError } from '@/lib/dbErrorHandler';
import { logAuditEvent } from '@/app/actions/audit';
import { getCurrentUser } from '@/lib/audit-helpers';
import { checkUserPermission } from './rbac';
import { syncBirthdayCalendarEvent, deleteBirthdayCalendarEvent } from '@/lib/google-calendar-birthdays';
import { getTodayIsoDate } from '@/lib/dateUtils';

// Schemas
const employeeSchema = z.object({
  first_name: z.string().min(1, 'First name is required'),
  last_name: z.string().min(1, 'Last name is required'),
  email_address: z.string().email('Invalid email address'),
  job_title: z.string().min(1, 'Job title is required'),
  employment_start_date: z.string().min(1, 'Start date is required'),
  status: z.enum(['Active', 'Former', 'Prospective']),
  date_of_birth: z.union([z.string().min(1), z.null()]).optional(),
  address: z.union([z.string().min(1), z.null()]).optional(),
  phone_number: z.union([z.string().min(1), z.null()]).optional(),
  employment_end_date: z.union([z.string().min(1), z.null()]).optional(),
});

const noteSchema = z.object({
    note_text: z.string().min(1, 'Note text cannot be empty.'),
    employee_id: z.string().uuid(),
    created_by_user_id: z.string().uuid().optional(),
});


const deleteAttachmentSchema = z.object({
    employee_id: z.string().uuid(),
    attachment_id: z.string().uuid(),
    storage_path: z.string().min(1),
});

// Employee Actions
export async function addEmployee(prevState: ActionFormState, formData: FormData): Promise<ActionFormState> {
    // Check permission
    const hasPermission = await checkUserPermission('employees', 'create');
    if (!hasPermission) {
        return { type: 'error', message: 'Insufficient permissions to create employees.' };
    }

    // Extract form data and clean up empty strings
    const formDataEntries = Object.fromEntries(formData.entries());
    const cleanedData = Object.entries(formDataEntries).reduce((acc, [key, value]) => {
        // Convert empty strings to null for optional fields
        if (value === '' && ['date_of_birth', 'address', 'phone_number', 'employment_end_date'].includes(key)) {
            acc[key] = null;
        } else {
            acc[key] = value;
        }
        return acc;
    }, {} as Record<string, any>);

    // Extract additional data that will be handled separately
    const financialFields = ['ni_number', 'payee_name', 'bank_name', 'bank_sort_code', 'bank_account_number', 'branch_address'];
    const healthFields = ['doctor_name', 'doctor_address', 'allergies', 'illness_history', 'recent_treatment', 
        'has_diabetes', 'has_epilepsy', 'has_skin_condition', 'has_depressive_illness', 'has_bowel_problems', 
        'has_ear_problems', 'is_registered_disabled', 'disability_reg_number', 'disability_reg_expiry_date', 
        'disability_details'];
    
    const financialData: any = {};
    const healthData: any = {};
    
    // Separate financial and health data
    Object.entries(cleanedData).forEach(([key, value]) => {
        if (financialFields.includes(key)) {
            financialData[key] = value === '' ? null : value;
            delete cleanedData[key];
        } else if (healthFields.includes(key)) {
            // Handle boolean fields properly (checkboxes send 'on' when checked)
            if (['has_diabetes', 'has_epilepsy', 'has_skin_condition', 'has_depressive_illness', 
                'has_bowel_problems', 'has_ear_problems', 'is_registered_disabled'].includes(key)) {
                healthData[key] = value === 'on' || value === 'true' || value === true;
            } else {
                healthData[key] = value === '' ? null : value;
            }
            delete cleanedData[key];
        }
    });
    

    const result = employeeSchema.safeParse(cleanedData);

    if (!result.success) {
        console.error('Validation errors:', result.error.flatten());
        return { type: 'error', message: 'Invalid form data.', errors: result.error.flatten().fieldErrors };
    }

    // Get current user for audit logging
    const userInfo = await getCurrentUser();
    
    const supabase = getSupabaseAdminClient();

    // Start transaction-like operations
    const { data: newEmployee, error } = await supabase.from('employees').insert(result.data).select().single();
    
    if (error) {
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
    
    const employeeId = newEmployee.employee_id;
    
    // Create financial details if provided
    if (Object.values(financialData).some(val => val !== null)) {
        const { error: financialError } = await supabase
            .from('employee_financial_details')
            .insert({ employee_id: employeeId, ...financialData });
            
        if (financialError) {
            console.error('Failed to create financial details:', financialError);
        }
    }
    
    // Create health record if provided
    if (Object.values(healthData).some(val => val !== null)) {
        const { error: healthError } = await supabase
            .from('employee_health_records')
            .insert({ employee_id: employeeId, ...healthData });
            
        if (healthError) {
            console.error('Failed to create health record:', healthError);
        }
    }
    
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
    
    // Sync birthday to Google Calendar if employee has date of birth and is active
    if (newEmployee.date_of_birth && newEmployee.status === 'Active') {
        try {
            await syncBirthdayCalendarEvent(newEmployee);
        } catch (error) {
            console.error('Failed to sync birthday to calendar:', error);
            // Don't fail the employee creation if calendar sync fails
        }
    }
    
    revalidatePath('/employees');
    return { type: 'success', message: 'Employee created successfully.', employeeId: newEmployee.employee_id };
}

export async function updateEmployee(prevState: ActionFormState, formData: FormData): Promise<ActionFormState> {
    // Check permission
    const hasPermission = await checkUserPermission('employees', 'edit');
    if (!hasPermission) {
        return { type: 'error', message: 'Insufficient permissions to update employees.' };
    }

    const employeeId = formData.get('employee_id') as string;
    
    // Extract form data and clean up empty strings
    const formDataEntries = Object.fromEntries(formData.entries());
    const cleanedData = Object.entries(formDataEntries).reduce((acc, [key, value]) => {
        // Convert empty strings to null for optional fields
        if (value === '' && ['date_of_birth', 'address', 'phone_number', 'employment_end_date'].includes(key)) {
            acc[key] = null;
        } else {
            acc[key] = value;
        }
        return acc;
    }, {} as Record<string, any>);
    
    // Remove employee_id from data to be validated and updated
    const { employee_id, ...dataToValidate } = cleanedData;
    
    const result = employeeSchema.safeParse(dataToValidate);
    
    if (!result.success) {
        console.error('Validation errors:', result.error.flatten());
        return { type: 'error', message: 'Invalid data provided. Please check your input and try again.', errors: result.error.flatten().fieldErrors };
    }

    const supabase = getSupabaseAdminClient();

    // Get current user for audit logging
    const userInfo = await getCurrentUser();
    
    // Get old values for audit
    const { data: oldEmployee } = await supabase
        .from('employees')
        .select('*')
        .eq('employee_id', employeeId)
        .maybeSingle();
    
    const { error } = await supabase.from('employees').update(result.data).eq('employee_id', employeeId);
    
    if (error) {
        const message = isPostgrestError(error) ? getConstraintErrorMessage(error) : 'Database error';
        await logAuditEvent({
            ...(userInfo.user_id && { user_id: userInfo.user_id }),
        ...(userInfo.user_email && { user_email: userInfo.user_email }),
            operation_type: 'update',
            resource_type: 'employee',
            resource_id: employeeId,
            operation_status: 'failure',
            error_message: message,
            old_values: oldEmployee,
            new_values: result.data
        });
        return { type: 'error', message };
    }
    
    // Determine what fields changed
    const changedFields: string[] = [];
    if (oldEmployee) {
        Object.keys(result.data).forEach(key => {
            if ((oldEmployee as any)[key] !== (result.data as any)[key]) {
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
        new_values: result.data,
        additional_info: {
            fields_changed: changedFields
        }
    });

    // Handle birthday calendar sync based on status and date of birth changes
    const statusChanged = oldEmployee && oldEmployee.status !== result.data.status;
    const dobChanged = oldEmployee && oldEmployee.date_of_birth !== result.data.date_of_birth;
    
    if (statusChanged || dobChanged) {
        try {
            // If employee became former or date of birth was removed, delete calendar events
            if (result.data.status === 'Former' || !result.data.date_of_birth) {
                await deleteBirthdayCalendarEvent(employeeId);
            } 
            // If employee is active and has date of birth, sync calendar event
            else if (result.data.status === 'Active' && result.data.date_of_birth) {
                await syncBirthdayCalendarEvent({
                    ...oldEmployee,
                    ...result.data,
                    employee_id: employeeId
                });
            }
        } catch (error) {
            console.error('Failed to update birthday calendar:', error);
            // Don't fail the employee update if calendar sync fails
        }
    }

    revalidatePath(`/employees`);
    revalidatePath(`/employees/${employeeId}`);
    return { type: 'success', message: 'Employee updated successfully.', employeeId };
}

export async function deleteEmployee(prevState: DeleteState, formData: FormData): Promise<DeleteState> {
    // Check permission
    const hasPermission = await checkUserPermission('employees', 'delete');
    if (!hasPermission) {
        return { type: 'error', message: 'Insufficient permissions to delete employees.' };
    }

    const employeeId = formData.get('employee_id') as string;
    if (!employeeId) return { type: 'error', message: 'Employee ID is missing.' };

    const supabase = getSupabaseAdminClient();

    // Get employee details for audit
    const { data: employee } = await supabase
        .from('employees')
        .select('*')
        .eq('employee_id', employeeId)
        .maybeSingle();
    
    // Get current user for audit logging
    const userInfo = await getCurrentUser();
    
    const { error } = await supabase.from('employees').delete().eq('employee_id', employeeId);
    
    if (error) {
        const message = isPostgrestError(error) ? getConstraintErrorMessage(error) : 'Database error';
        await logAuditEvent({
            ...(userInfo.user_id && { user_id: userInfo.user_id }),
        ...(userInfo.user_email && { user_email: userInfo.user_email }),
            operation_type: 'delete',
            resource_type: 'employee',
            resource_id: employeeId,
            operation_status: 'failure',
            error_message: message,
            old_values: employee
        });
        return { type: 'error', message };
    }
    
    await logAuditEvent({
        ...(userInfo.user_id && { user_id: userInfo.user_id }),
        ...(userInfo.user_email && { user_email: userInfo.user_email }),
        operation_type: 'delete',
        resource_type: 'employee',
        resource_id: employeeId,
        operation_status: 'success',
        old_values: employee,
        additional_info: {
            employee_name: employee ? `${employee.first_name} ${employee.last_name}` : 'Unknown',
            job_title: employee?.job_title,
            status: employee?.status
        }
    });
    
    // Delete birthday calendar events if employee had a date of birth
    if (employee?.date_of_birth) {
        try {
            await deleteBirthdayCalendarEvent(employeeId);
        } catch (error) {
            console.error('Failed to delete birthday from calendar:', error);
            // Don't fail the employee deletion if calendar sync fails
        }
    }
    
    revalidatePath('/employees');
    return { type: 'success', message: 'Employee deleted successfully' };
}

// Server action to get a simplified list of employees for dropdowns
export async function getEmployeeList(): Promise<{ id: string; name: string; }[] | null> {
  const supabase = getSupabaseAdminClient();

  const { data, error } = await supabase
    .from('employees')
    .select('employee_id, first_name, last_name')
    .eq('status', 'Active')  // Only show active employees in dropdowns
    .order('last_name')
    .order('first_name');

  if (error) {
    console.error('Error fetching employee list:', error);
    return null;
  }

  return data.map(emp => ({ id: emp.employee_id, name: `${emp.first_name} ${emp.last_name}` }));
}

// Note Actions
export async function addEmployeeNote(prevState: NoteFormState, formData: FormData): Promise<NoteFormState> {
    // Check permission
    const hasPermission = await checkUserPermission('employees', 'edit');
    if (!hasPermission) {
        return { type: 'error', message: 'Insufficient permissions to add employee notes.' };
    }

    const result = noteSchema.safeParse(Object.fromEntries(formData.entries()));
    if (!result.success) {
        return { type: 'error', message: 'Invalid data', errors: result.error.flatten().fieldErrors };
    }
    
    const supabase = getSupabaseAdminClient();
    const userInfo = await getCurrentUser();

    const notePayload = {
        ...result.data,
        created_by_user_id: result.data.created_by_user_id ?? userInfo.user_id ?? null
    };
    
    const { data: newNote, error } = await supabase.from('employee_notes').insert(notePayload).select().single();

    if (error) return { type: 'error', message: `Database error: ${error.message}` };

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
}

// Attachment Actions
const ATTACHMENT_BUCKET_NAME = 'employee-attachments';

const addAttachmentSchema = z.object({
  employee_id: z.string().uuid(),
  attachment_file: z.instanceof(File)
    .refine(file => file.size > 0, "A file is required.")
    .refine(file => file.size < 10 * 1024 * 1024, "File size must be less than 10MB.")
    .refine(
      file => [
        'application/pdf',
        'image/jpeg',
        'image/png',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'text/plain'
      ].includes(file.type),
      "Invalid file type. Only PDF, JPG, PNG, Word documents, and TXT files are allowed."
    ),
  category_id: z.string().uuid("A valid category must be selected."),
  description: z.string().optional(),
});

export async function addEmployeeAttachment(
  prevState: AttachmentFormState,
  formData: FormData
): Promise<AttachmentFormState> {
  // Rate limit file uploads
  try {
    const { checkRateLimit } = await import('@/lib/rate-limit-server')
    await checkRateLimit('api', 10) // 10 uploads per minute
  } catch (error) {
    if (error instanceof Error && error.message.includes('Too many requests')) {
      return { type: 'error', message: 'Too many file uploads. Please try again later.' };
    }
  }

  // Check permission
  const hasPermission = await checkUserPermission('employees', 'upload_documents');
  if (!hasPermission) {
    return { type: 'error', message: 'Insufficient permissions to upload employee documents.' };
  }

  // 1. Validate form data
  const result = addAttachmentSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!result.success) {
    console.log('Validation failed:', result.error.flatten().fieldErrors);
    return { type: 'error', message: "Validation failed.", errors: result.error.flatten().fieldErrors };
  }

  const { employee_id, attachment_file, category_id, description } = result.data;
  const supabase = getSupabaseAdminClient();

  // 2. Upload file to Supabase Storage
  // Sanitize filename: remove special characters, keep only alphanumeric, dots, dashes, and underscores
  const sanitizedFileName = attachment_file.name
    .replace(/[^\w\s.-]/g, '') // Remove special characters except word chars, spaces, dots, and dashes
    .replace(/\s+/g, '_') // Replace spaces with underscores
    .replace(/_+/g, '_') // Replace multiple underscores with single
    .replace(/^[._-]+|[._-]+$/g, ''); // Remove leading/trailing dots, underscores, or dashes
  
  // Ensure filename isn't empty after sanitization
  const finalFileName = sanitizedFileName || 'unnamed_file';
  
  const uniqueFileName = `${employee_id}/${Date.now()}_${finalFileName}`;
  const { data: uploadData, error: uploadError } = await supabase.storage
    .from(ATTACHMENT_BUCKET_NAME)
    .upload(uniqueFileName, attachment_file, { upsert: false }); // upsert: false is crucial

  if (uploadError) {
    console.error('Error uploading file to storage:', uploadError);
    return { type: 'error', message: `Storage upload failed: ${uploadError.message}` };
  }

  // 3. Use the canonical path from the API response
  const storagePath = uploadData.path;
  console.log(`File successfully uploaded to storage at path: ${storagePath}`);

  // 4. Insert metadata into DB with orphan cleanup
  try {
    const { error: dbError } = await supabase.from('employee_attachments').insert({
      employee_id: employee_id,
      category_id: category_id,
      file_name: attachment_file.name,
      storage_path: storagePath, // Use the correct path
      mime_type: attachment_file.type,
      file_size_bytes: attachment_file.size,
      description: description,
    });

    if (dbError) {
      // This will be caught by the catch block
      throw new Error(`Database insert failed: ${dbError.message}`);
    }

  } catch (error) {
    console.error('Database insert failed after file upload. Initiating cleanup.', error);
    const { error: removeError } = await supabase.storage.from(ATTACHMENT_BUCKET_NAME).remove([storagePath]);

    if (removeError) {
      console.error(`CRITICAL ALERT: Failed to remove orphaned file '${storagePath}'. Manual cleanup required.`, removeError);
    } else {
      console.log(`Orphaned file '${storagePath}' successfully removed.`);
    }
    
    return { type: 'error', message: `Failed to save attachment details to the database.` };
  }

  // Audit log success
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
      storage_path: storagePath
    }
  });
  
  console.log(`Attachment metadata for '${storagePath}' successfully saved to DB.`);
  revalidatePath(`/employees/${employee_id}`);
  return { type: 'success', message: 'Attachment uploaded successfully!' };
}

export async function getAttachmentSignedUrl(storagePath: string): Promise<{ url: string | null; error: string | null }> {
  // Check permission
  const hasPermission = await checkUserPermission('employees', 'view_documents');
  if (!hasPermission) {
    return { url: null, error: 'Insufficient permissions to view employee documents.' };
  }

  const supabase = getSupabaseAdminClient();

  const { data, error } = await supabase.storage
    .from(ATTACHMENT_BUCKET_NAME)
    .createSignedUrl(storagePath, 60 * 5); // URL valid for 5 minutes

  if (error) {
    console.error('Error creating signed URL:', error);
    return { url: null, error: error.message };
  }

  // Audit log attachment access
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
  
  return { url: data.signedUrl, error: null };
}

export async function deleteEmployeeAttachment(prevState: DeleteState, formData: FormData): Promise<DeleteState> {
    // Check permission
    const hasPermission = await checkUserPermission('employees', 'delete_documents');
    if (!hasPermission) {
        return { type: 'error', message: 'Insufficient permissions to delete employee documents.' };
    }

    const result = deleteAttachmentSchema.safeParse(Object.fromEntries(formData.entries()));
    if(!result.success){
        return { type: 'error', message: 'Invalid IDs provided.', errors: result.error.flatten().fieldErrors };
    }

    const { employee_id, attachment_id, storage_path } = result.data;
    const supabase = getSupabaseAdminClient();

    const { error: storageError } = await supabase.storage
        .from(ATTACHMENT_BUCKET_NAME)
        .remove([storage_path]);
    
    if (storageError) return { type: 'error', message: `Storage error: ${storageError.message}` };

    // Get attachment details for audit before deletion
    const { data: attachment } = await supabase
        .from('employee_attachments')
        .select('file_name')
        .eq('attachment_id', attachment_id)
        .single();

    const { error: dbError } = await supabase.from('employee_attachments').delete().eq('attachment_id', attachment_id);
    if (dbError) return { type: 'error', message: `Database error: ${dbError.message}` };

    // Audit log
    const userInfo = await getCurrentUser();
    await logAuditEvent({
        ...(userInfo.user_id && { user_id: userInfo.user_id }),
        ...(userInfo.user_email && { user_email: userInfo.user_email }),
        operation_type: 'delete_attachment',
        resource_type: 'employee',
        resource_id: employee_id,
        operation_status: 'success',
        additional_info: {
            file_name: attachment?.file_name || 'Unknown',
            storage_path: storage_path
        }
    });

    revalidatePath(`/employees/${employee_id}`);
    return { type: 'success', message: 'Attachment deleted successfully.' };
}

const EmergencyContactSchema = z.object({
  employee_id: z.string().uuid(),
  name: z.string().min(1, 'Name is required'),
  relationship: z.union([z.string().min(1), z.null()]).optional(),
  phone_number: z.union([z.string().regex(/^(\+?44|0)?[0-9]{10,11}$/, 'Invalid UK phone number format'), z.null()]).optional(),
  priority: z.enum(['Primary', 'Secondary', 'Other']).optional(),
  address: z.union([z.string().min(1), z.null()]).optional(),
});

export async function addEmergencyContact(
  prevState: ActionFormState | null,
  formData: FormData
): Promise<ActionFormState | null> {
  // Check permission
  const hasPermission = await checkUserPermission('employees', 'edit');
  if (!hasPermission) {
    return {
      type: 'error',
      message: 'Insufficient permissions to add emergency contacts.',
    };
  }

  // Extract form data and clean up empty strings
  const formDataEntries = Object.fromEntries(formData.entries());
  const cleanedData = Object.entries(formDataEntries).reduce((acc, [key, value]) => {
    // Convert empty strings to null for optional fields
    if (value === '' && ['relationship', 'phone_number', 'address'].includes(key)) {
      acc[key] = null;
    } else {
      acc[key] = value;
    }
    return acc;
  }, {} as Record<string, any>);

  const validatedFields = EmergencyContactSchema.safeParse(cleanedData);

  if (!validatedFields.success) {
    return {
      type: 'error',
      message: 'Validation failed.',
      errors: validatedFields.error.flatten().fieldErrors,
    };
  }

  const { employee_id, name, relationship, phone_number, priority, address } = validatedFields.data;

  const supabase = getSupabaseAdminClient();
  
  const { error } = await supabase
    .from('employee_emergency_contacts')
    .insert([{ employee_id, name, relationship, phone_number, priority, address }]);

  if (error) {
    console.error('Error adding emergency contact:', error);
    const message = isPostgrestError(error) ? getConstraintErrorMessage(error) : 'Database error: Could not add emergency contact.';
    return {
      type: 'error',
      message,
    };
  }

  // Audit log
  const userInfo = await getCurrentUser();
  await logAuditEvent({
    ...(userInfo.user_id && { user_id: userInfo.user_id }),
    ...(userInfo.user_email && { user_email: userInfo.user_email }),
    operation_type: 'update',
    resource_type: 'employee',
    resource_id: employee_id,
    operation_status: 'success',
    additional_info: {
      action: 'add_emergency_contact',
      contact_name: name,
      relationship: relationship,
      priority: priority
    }
  });

  revalidatePath(`/employees/${employee_id}`);
  return {
    type: 'success',
    message: 'Emergency contact added successfully.',
  };
}

// ==================================================================
// Financial Details Actions
// ==================================================================

const FinancialDetailsSchema = z.object({
  employee_id: z.string().uuid(),
  ni_number: z.union([
    z.string().regex(/^[A-Z]{2}\d{6}[A-Z]$/, 'NI number must be in format: AA123456A'),
    z.null()
  ]).optional(),
  bank_account_number: z.union([
    z.string().regex(/^\d{8}$/, 'Account number must be exactly 8 digits'),
    z.null()
  ]).optional(),
  bank_sort_code: z.union([
    z.string().transform(val => {
      // Remove any existing dashes and add them in the correct places
      const cleaned = val.replace(/\D/g, '');
      if (cleaned.length === 6) {
        return `${cleaned.slice(0, 2)}-${cleaned.slice(2, 4)}-${cleaned.slice(4, 6)}`;
      }
      return val;
    }).pipe(z.string().regex(/^\d{2}-\d{2}-\d{2}$/, 'Sort code must be 6 digits')),
    z.null()
  ]).optional(),
  bank_name: z.union([z.string().min(1), z.null()]).optional(),
  payee_name: z.union([z.string().min(1), z.null()]).optional(),
  branch_address: z.union([z.string().min(1), z.null()]).optional(),
});

export async function upsertFinancialDetails(
  prevState: ActionFormState | null,
  formData: FormData
): Promise<ActionFormState | null> {
  // Check permission
  const hasPermission = await checkUserPermission('employees', 'edit');
  if (!hasPermission) {
    return {
      type: 'error',
      message: 'Insufficient permissions to update financial details.',
    };
  }

  // Extract form data and clean up empty strings
  const formDataEntries = Object.fromEntries(formData.entries());
  const cleanedData = Object.entries(formDataEntries).reduce((acc, [key, value]) => {
    // Convert empty strings to null for optional fields
    if (value === '' && key !== 'employee_id') {
      acc[key] = null;
    } else {
      acc[key] = value;
    }
    return acc;
  }, {} as Record<string, any>);

  const validatedFields = FinancialDetailsSchema.safeParse(cleanedData);

  if (!validatedFields.success) {
    return {
      type: 'error',
      message: 'Validation failed.',
      errors: validatedFields.error.flatten().fieldErrors,
    };
  }

  const supabase = getSupabaseAdminClient();
  
  const { error } = await supabase
    .from('employee_financial_details')
    .upsert(validatedFields.data, { onConflict: 'employee_id' });

  if (error) {
    console.error('Error upserting financial details:', error);
    const message = isPostgrestError(error) ? getConstraintErrorMessage(error) : 'Database error: Could not save financial details.';
    return {
      type: 'error',
      message,
    };
  }

  // Audit log
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
}


// ==================================================================
// Health Record Actions
// ==================================================================

const HealthRecordSchema = z.object({
  employee_id: z.string().uuid(),
  doctor_name: z.union([z.string().min(1), z.null()]).optional(),
  doctor_address: z.union([z.string().min(1), z.null()]).optional(),
  allergies: z.union([z.string().min(1), z.null()]).optional(),
  illness_history: z.union([z.string().min(1), z.null()]).optional(),
  recent_treatment: z.union([z.string().min(1), z.null()]).optional(),
  has_diabetes: z.boolean(),
  has_epilepsy: z.boolean(),
  has_skin_condition: z.boolean(),
  has_depressive_illness: z.boolean(),
  has_bowel_problems: z.boolean(),
  has_ear_problems: z.boolean(),
  is_registered_disabled: z.boolean(),
  disability_reg_number: z.union([z.string().min(1), z.null()]).optional(),
  disability_reg_expiry_date: z.union([z.string().min(1), z.null()]).optional(),
  disability_details: z.union([z.string().min(1), z.null()]).optional(),
});

export async function upsertHealthRecord(
  prevState: ActionFormState | null,
  formData: FormData
): Promise<ActionFormState | null> {
  // Check permission
  const hasPermission = await checkUserPermission('employees', 'edit');
  if (!hasPermission) {
    return {
      type: 'error',
      message: 'Insufficient permissions to update health records.',
    };
  }

  const data: any = Object.fromEntries(formData.entries());

  // Convert checkbox values from 'on' to boolean
  const booleanFields = [
    'has_diabetes', 'has_epilepsy', 'has_skin_condition', 'has_depressive_illness',
    'has_bowel_problems', 'has_ear_problems', 'is_registered_disabled'
  ];
  booleanFields.forEach(field => {
    data[field] = data[field] === 'on';
  });
  
  // Handle empty strings for optional text fields
  const optionalTextFields = ['doctor_name', 'doctor_address', 'allergies', 'illness_history', 
                              'recent_treatment', 'disability_reg_number', 'disability_details'];
  optionalTextFields.forEach(field => {
    if (data[field] === '') {
      data[field] = null;
    }
  });
  
  // Handle empty date string
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

  const supabase = getSupabaseAdminClient();
  
  const { error } = await supabase
    .from('employee_health_records')
    .upsert(validatedFields.data, { onConflict: 'employee_id' });

  if (error) {
    console.error('Error upserting health record:', error);
    const message = isPostgrestError(error) ? getConstraintErrorMessage(error) : 'Database error: Could not save health record.';
    return {
      type: 'error',
      message,
    };
  }

  // Audit log
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
}

// Right to Work schemas and actions
const RIGHT_TO_WORK_DOCUMENT_TYPES = [
  'Passport',
  'Biometric Residence Permit',
  'Share Code',
  'Other',
  'List A',
  'List B'
] as const

const RightToWorkSchema = z.object({
  employee_id: z.string().uuid(),
  document_type: z.enum(RIGHT_TO_WORK_DOCUMENT_TYPES),
  document_details: z.union([z.string().min(1), z.null()]).optional(),
  verification_date: z.string().min(1, 'Verification date is required'),
  document_expiry_date: z.union([z.string().min(1), z.null()]).optional(),
  follow_up_date: z.union([z.string().min(1), z.null()]).optional(),
  verified_by_user_id: z.union([z.string().uuid(), z.null()]).optional(),
  document_photo: z.instanceof(File)
    .refine(file => file.size > 0, "File is empty")
    .refine(file => file.size < 10 * 1024 * 1024, "File size must be less than 10MB")
    .refine(file => ['image/jpeg', 'image/png', 'application/pdf'].includes(file.type), "Only JPG, PNG, and PDF files are allowed")
    .optional(),
});

export async function upsertRightToWork(
  prevState: ActionFormState | null,
  formData: FormData
): Promise<ActionFormState | null> {
  // Check permission
  const hasPermission = await checkUserPermission('employees', 'edit');
  if (!hasPermission) {
    return {
      type: 'error',
      message: 'Insufficient permissions to update right to work information.',
    };
  }

  const data: any = Object.fromEntries(formData.entries());
  
  // Handle empty strings for optional fields
  ['document_details', 'document_expiry_date', 'follow_up_date', 'verified_by_user_id'].forEach(field => {
    if (data[field] === '') {
      data[field] = null;
    }
  });

  // Handle file field - if it's an empty file, remove it from data
  if (data.document_photo && data.document_photo instanceof File && data.document_photo.size === 0) {
    delete data.document_photo;
  }

  const validatedFields = RightToWorkSchema.safeParse(data);

  if (!validatedFields.success) {
    return {
      type: 'error',
      message: 'Validation failed.',
      errors: validatedFields.error.flatten().fieldErrors,
    };
  }

  const supabase = getSupabaseAdminClient();
  
  // Get current user ID for verified_by_user_id if not provided
  if (!validatedFields.data.verified_by_user_id) {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      validatedFields.data.verified_by_user_id = user.id;
    }
  }
  
  // Handle file upload if provided
  let photoStoragePath: string | null = null;
  const documentPhoto = validatedFields.data.document_photo;
  
  if (documentPhoto && documentPhoto.size > 0) {
    // Check if there's an existing photo to delete
    const { data: existingRecord } = await supabase
      .from('employee_right_to_work')
      .select('photo_storage_path')
      .eq('employee_id', validatedFields.data.employee_id)
      .single();
      
    // Upload new photo
    const sanitizedFileName = documentPhoto.name
      .replace(/[^\w\s.-]/g, '')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^[._-]+|[._-]+$/g, '');
    
    const finalFileName = sanitizedFileName || 'right_to_work_document';
    const uniqueFileName = `${validatedFields.data.employee_id}/rtw_${Date.now()}_${finalFileName}`;
    
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from(ATTACHMENT_BUCKET_NAME)
      .upload(uniqueFileName, documentPhoto, { upsert: false });
      
    if (uploadError) {
      console.error('Error uploading right to work document:', uploadError);
      return {
        type: 'error',
        message: `Failed to upload document photo: ${uploadError.message}`,
      };
    }
    
    photoStoragePath = uploadData.path;
    
    // Delete old photo if exists
    if (existingRecord?.photo_storage_path) {
      const { error: deleteError } = await supabase.storage
        .from(ATTACHMENT_BUCKET_NAME)
        .remove([existingRecord.photo_storage_path]);
        
      if (deleteError) {
        console.error('Error deleting old right to work photo:', deleteError);
      }
    }
  }
  
  // Prepare data for database update
  const { document_photo, ...dataToSave } = validatedFields.data;
  const dataForDb: any = {
    ...dataToSave,
    ...(photoStoragePath ? { photo_storage_path: photoStoragePath } : {})
  };
  
  const { error } = await supabase
    .from('employee_right_to_work')
    .upsert(dataForDb, { onConflict: 'employee_id' });

  if (error) {
    console.error('Error upserting right to work:', error);
    
    // Clean up uploaded file if database update failed
    if (photoStoragePath) {
      await supabase.storage.from(ATTACHMENT_BUCKET_NAME).remove([photoStoragePath]);
    }
    
    return {
      type: 'error',
      message: 'Database error: Could not save right to work information.',
    };
  }

  // Audit log
  const userInfo = await getCurrentUser();
  await logAuditEvent({
    ...(userInfo.user_id && { user_id: userInfo.user_id }),
    ...(userInfo.user_email && { user_email: userInfo.user_email }),
    operation_type: 'update',
    resource_type: 'employee',
    resource_id: validatedFields.data.employee_id,
    operation_status: 'success',
    additional_info: {
      action: 'update_right_to_work',
      document_type: dataForDb.document_type,
      verification_date: dataForDb.verification_date,
      photo_uploaded: photoStoragePath ? true : false
    }
  });

  revalidatePath(`/employees/${validatedFields.data.employee_id}`);
  return {
    type: 'success',
    message: 'Right to work information saved successfully.',
  };
}

// Get signed URL for right to work photo
export async function getRightToWorkPhotoUrl(photoPath: string): Promise<{ url: string | null; error: string | null }> {
  // Check permission
  const hasPermission = await checkUserPermission('employees', 'view_documents');
  if (!hasPermission) {
    return { url: null, error: 'Insufficient permissions to view employee documents.' };
  }

  const supabase = getSupabaseAdminClient();

  const { data, error } = await supabase.storage
    .from(ATTACHMENT_BUCKET_NAME)
    .createSignedUrl(photoPath, 60 * 5); // URL valid for 5 minutes

  if (error) {
    console.error('Error creating signed URL for right to work photo:', error);
    return { url: null, error: error.message };
  }

  return { url: data.signedUrl, error: null };
}

// Delete right to work photo
export async function deleteRightToWorkPhoto(employeeId: string): Promise<{ error?: string; success?: boolean }> {
  // Check permission
  const hasPermission = await checkUserPermission('employees', 'edit');
  if (!hasPermission) {
    return { error: 'Insufficient permissions to delete employee documents.' };
  }

  const supabase = getSupabaseAdminClient();
  
  // Get current photo path
  const { data: rightToWork, error: fetchError } = await supabase
    .from('employee_right_to_work')
    .select('photo_storage_path')
    .eq('employee_id', employeeId)
    .single();
    
  if (fetchError || !rightToWork?.photo_storage_path) {
    return { error: 'No photo found to delete.' };
  }
  
  // Delete from storage
  const { error: storageError } = await supabase.storage
    .from(ATTACHMENT_BUCKET_NAME)
    .remove([rightToWork.photo_storage_path]);
    
  if (storageError) {
    console.error('Error deleting right to work photo from storage:', storageError);
    return { error: 'Failed to delete photo from storage.' };
  }
  
  // Update database record
  const { error: dbError } = await supabase
    .from('employee_right_to_work')
    .update({ photo_storage_path: null })
    .eq('employee_id', employeeId);
    
  if (dbError) {
    console.error('Error updating right to work record:', dbError);
    return { error: 'Failed to update database record.' };
  }
  
  // Audit log
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
      file_path: rightToWork.photo_storage_path
    }
  });
  
  revalidatePath(`/employees/${employeeId}`);
  return { success: true };
}

// Onboarding Checklist action

const ONBOARDING_CHECKLIST_FIELDS = [
  'wheniwork_invite_sent',
  'private_whatsapp_added',
  'team_whatsapp_added',
  'till_system_setup',
  'training_flow_setup',
  'employment_agreement_drafted',
  'employee_agreement_accepted'
] as const

type OnboardingChecklistField = typeof ONBOARDING_CHECKLIST_FIELDS[number]

const ONBOARDING_FIELD_CONFIG: Record<OnboardingChecklistField, { label: string; dateField: string }> = {
  wheniwork_invite_sent: { label: 'WhenIWork Invite Sent', dateField: 'wheniwork_invite_date' },
  private_whatsapp_added: { label: 'Added to Private WhatsApp', dateField: 'private_whatsapp_date' },
  team_whatsapp_added: { label: 'Added to Team WhatsApp', dateField: 'team_whatsapp_date' },
  till_system_setup: { label: 'Till System Setup', dateField: 'till_system_setup_date' },
  training_flow_setup: { label: 'Training in Flow Setup', dateField: 'training_flow_setup_date' },
  employment_agreement_drafted: { label: 'Employment Agreement Drafted', dateField: 'employment_agreement_drafted_date' },
  employee_agreement_accepted: { label: 'Employee Agreement Accepted', dateField: 'employee_agreement_accepted_date' }
}

export async function updateOnboardingChecklist(
  employeeId: string,
  field: string,
  checked: boolean
): Promise<{ error?: string; success?: boolean }> {
  // Check permission
  const hasPermission = await checkUserPermission('employees', 'edit');
  if (!hasPermission) {
    return { error: 'Insufficient permissions to update onboarding checklist.' };
  }

  if (!ONBOARDING_CHECKLIST_FIELDS.includes(field as OnboardingChecklistField)) {
    return { error: 'Unsupported onboarding checklist field.' };
  }

  const checklistField = field as OnboardingChecklistField;
  const checklistConfig = ONBOARDING_FIELD_CONFIG[checklistField];

  const supabase = getSupabaseAdminClient();
  
  // Build the update object dynamically
  const updateData: any = { employee_id: employeeId };
  
  // Set the boolean field
  const isChecked = Boolean(checked);
  updateData[checklistField] = isChecked;

  const dateField = checklistConfig?.dateField;
  if (dateField) {
    if (isChecked) {
      updateData[dateField] =
        dateField === 'employee_agreement_accepted_date' ? new Date().toISOString() : getTodayIsoDate();
    } else {
      updateData[dateField] = null;
    }
  }
  
  const { error } = await supabase
    .from('employee_onboarding_checklist')
    .upsert(updateData, { onConflict: 'employee_id' });

  if (error) {
    console.error('Error updating onboarding checklist:', error);
    return { error: 'Failed to update onboarding checklist.' };
  }

  // Audit log
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
      ...updateData
    }
  });

  revalidatePath(`/employees/${employeeId}`);
  return { success: true };
}

// Get onboarding progress
export async function getOnboardingProgress(
  employeeId: string
): Promise<{ data: { completed: number; total: number; percentage: number; items: Array<{ field: OnboardingChecklistField; label: string; completed: boolean; date: string | null }>; data: Record<string, any> | null } | null; error?: string }> {
  const canView = await checkUserPermission('employees', 'view');
  if (!canView) {
    return { data: null, error: 'Insufficient permissions to view onboarding progress.' };
  }

  const supabase = getSupabaseAdminClient();

  const { data, error } = await supabase
    .from('employee_onboarding_checklist')
    .select('*')
    .eq('employee_id', employeeId)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error('Error fetching onboarding progress:', error);
    return { data: null, error: 'Failed to fetch onboarding progress.' };
  }

  const record = (data ?? null) as Record<string, any> | null;

  const items = ONBOARDING_CHECKLIST_FIELDS.map((field) => {
    const config = ONBOARDING_FIELD_CONFIG[field];
    return {
      field,
      label: config.label,
      completed: Boolean(record?.[field]),
      date: record ? (record[config.dateField] ?? null) : null
    };
  });

  const completedCount = items.filter((item) => item.completed).length;
  const total = items.length;
  const percentage = total === 0 ? 0 : Math.round((completedCount / total) * 100);

  return {
    data: {
      completed: completedCount,
      total,
      percentage,
      items,
      data: record
    }
  };
}
