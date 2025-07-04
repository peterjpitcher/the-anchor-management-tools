'use server'

import { getSupabaseAdminClient } from '@/lib/supabase-singleton';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import type { ActionFormState, NoteFormState, AttachmentFormState, DeleteState } from '@/types/actions';
import { getConstraintErrorMessage, isPostgrestError } from '@/lib/dbErrorHandler';
import { logAuditEvent, getCurrentUserForAudit } from '@/lib/auditLog';
import { checkUserPermission } from './rbac';

// Schemas
const employeeSchema = z.object({
  first_name: z.string().min(1, 'First name is required'),
  last_name: z.string().min(1, 'Last name is required'),
  email_address: z.string().email('Invalid email address'),
  job_title: z.string().min(1, 'Job title is required'),
  employment_start_date: z.string().min(1, 'Start date is required'),
  status: z.enum(['Active', 'Former']),
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

    const result = employeeSchema.safeParse(cleanedData);

    if (!result.success) {
        console.error('Validation errors:', result.error.flatten());
        return { type: 'error', message: 'Invalid form data.', errors: result.error.flatten().fieldErrors };
    }

    const supabase = getSupabaseAdminClient();

    const { data: newEmployee, error } = await supabase.from('employees').insert(result.data).select().single();
    
    // Audit log
    const userInfo = await getCurrentUserForAudit(supabase);
    
    if (error) {
        const message = isPostgrestError(error) ? getConstraintErrorMessage(error) : 'Database error';
        await logAuditEvent({
            ...userInfo,
            operationType: 'create',
            resourceType: 'employee',
            operationStatus: 'failure',
            errorMessage: message,
            newValues: result.data
        });
        return { type: 'error', message };
    }
    
    await logAuditEvent({
        ...userInfo,
        operationType: 'create',
        resourceType: 'employee',
        resourceId: newEmployee.employee_id,
        operationStatus: 'success',
        newValues: newEmployee
    });
    
    revalidatePath('/employees');
    redirect('/employees');
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

    // Get old values for audit
    const { data: oldEmployee } = await supabase
        .from('employees')
        .select('*')
        .eq('employee_id', employeeId)
        .maybeSingle();
    
    const { error } = await supabase.from('employees').update(result.data).eq('employee_id', employeeId);
    
    // Audit log
    const userInfo = await getCurrentUserForAudit(supabase);
    
    if (error) {
        const message = isPostgrestError(error) ? getConstraintErrorMessage(error) : 'Database error';
        await logAuditEvent({
            ...userInfo,
            operationType: 'update',
            resourceType: 'employee',
            resourceId: employeeId,
            operationStatus: 'failure',
            errorMessage: message,
            oldValues: oldEmployee,
            newValues: result.data
        });
        return { type: 'error', message };
    }
    
    await logAuditEvent({
        ...userInfo,
        operationType: 'update',
        resourceType: 'employee',
        resourceId: employeeId,
        operationStatus: 'success',
        oldValues: oldEmployee,
        newValues: result.data
    });

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
    
    const { error } = await supabase.from('employees').delete().eq('employee_id', employeeId);
    
    // Audit log
    const userInfo = await getCurrentUserForAudit(supabase);
    
    if (error) {
        const message = isPostgrestError(error) ? getConstraintErrorMessage(error) : 'Database error';
        await logAuditEvent({
            ...userInfo,
            operationType: 'delete',
            resourceType: 'employee',
            resourceId: employeeId,
            operationStatus: 'failure',
            errorMessage: message,
            oldValues: employee
        });
        return { type: 'error', message };
    }
    
    await logAuditEvent({
        ...userInfo,
        operationType: 'delete',
        resourceType: 'employee',
        resourceId: employeeId,
        operationStatus: 'success',
        oldValues: employee
    });
    
    revalidatePath('/employees');
    redirect('/employees');
}

// Server action to get a simplified list of employees for dropdowns
export async function getEmployeeList(): Promise<{ id: string; name: string; }[] | null> {
  const supabase = getSupabaseAdminClient();

  const { data, error } = await supabase
    .from('employees')
    .select('employee_id, first_name, last_name')
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
    
    const { error } = await supabase.from('employee_notes').insert(result.data);

    if (error) return { type: 'error', message: `Database error: ${error.message}` };

    revalidatePath(`/employees/${result.data.employee_id}`);
    return { type: 'success', message: 'Note added successfully.' };
}

// Attachment Actions
const ATTACHMENT_BUCKET_NAME = 'employee-attachments';

const addAttachmentSchema = z.object({
  employee_id: z.string().uuid(),
  attachment_file: z.instanceof(File)
    .refine(file => file.size > 0, "A file is required.")
    .refine(file => file.size < 10 * 1024 * 1024, "File size must be less than 10MB.")
    .refine(file => ['application/pdf', 'image/jpeg', 'image/png', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(file.type), "Invalid file type. Only PDF, JPG, PNG, and Word documents are allowed."),
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
  const userInfo = await getCurrentUserForAudit(supabase);
  await logAuditEvent({
    ...userInfo,
    operationType: 'upload',
    resourceType: 'attachment',
    resourceId: employee_id,
    operationStatus: 'success',
    newValues: {
      fileName: attachment_file.name,
      category_id,
      fileSize: attachment_file.size
    },
    additionalInfo: { storagePath }
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
  const userInfo = await getCurrentUserForAudit(supabase);
  await logAuditEvent({
    ...userInfo,
    operationType: 'view',
    resourceType: 'attachment',
    operationStatus: 'success',
    additionalInfo: { storagePath }
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

    const { error: dbError } = await supabase.from('employee_attachments').delete().eq('attachment_id', attachment_id);
    if (dbError) return { type: 'error', message: `Database error: ${dbError.message}` };

    revalidatePath(`/employees/${employee_id}`);
    return { type: 'success', message: 'Attachment deleted successfully.' };
}

const EmergencyContactSchema = z.object({
  employee_id: z.string().uuid(),
  name: z.string().min(1, 'Name is required'),
  relationship: z.union([z.string().min(1), z.null()]).optional(),
  phone_number: z.union([z.string().regex(/^(\+?44|0)?[0-9]{10,11}$/, 'Invalid UK phone number format'), z.null()]).optional(),
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

  const { employee_id, name, relationship, phone_number, address } = validatedFields.data;

  const supabase = getSupabaseAdminClient();
  
  const { error } = await supabase
    .from('employee_emergency_contacts')
    .insert([{ employee_id, name, relationship, phone_number, address }]);

  if (error) {
    console.error('Error adding emergency contact:', error);
    const message = isPostgrestError(error) ? getConstraintErrorMessage(error) : 'Database error: Could not add emergency contact.';
    return {
      type: 'error',
      message,
    };
  }

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
  ni_number: z.union([z.string().min(1), z.null()]).optional(),
  bank_account_number: z.union([z.string().regex(/^\d{8}$/, 'Account number must be 8 digits'), z.null()]).optional(),
  bank_sort_code: z.union([z.string().regex(/^\d{2}-?\d{2}-?\d{2}$/, 'Sort code must be in format XX-XX-XX'), z.null()]).optional(),
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

  revalidatePath(`/employees/${validatedFields.data.employee_id}`);
  return {
    type: 'success',
    message: 'Health record saved successfully.',
  };
}