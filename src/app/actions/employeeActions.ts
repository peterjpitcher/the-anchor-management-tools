'use server'

import { createClient } from '@supabase/supabase-js';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { Employee, EmployeeNote, EmployeeAttachment } from '@/types/database';
import { cookies } from 'next/headers';
import { createServerActionClient } from '@supabase/auth-helpers-nextjs';
import { supabase } from '@/lib/supabase';
import { z } from 'zod';
import type { ActionFormState, NoteFormState, AttachmentFormState, DeleteState } from '@/types/actions';

function getSupabaseAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    console.error('Missing Supabase URL or Service Role Key for admin client.');
    return null;
  }
  return createClient(supabaseUrl, supabaseServiceRoleKey);
}

// Schemas
const employeeSchema = z.object({
  first_name: z.string().min(1, 'First name is required'),
  last_name: z.string().min(1, 'Last name is required'),
  email_address: z.string().email('Invalid email address'),
  job_title: z.string().min(1, 'Job title is required'),
  employment_start_date: z.string().min(1, 'Start date is required'),
  status: z.enum(['Active', 'Former']),
  date_of_birth: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  phone_number: z.string().optional().nullable(),
  employment_end_date: z.string().optional().nullable(),
});

const noteSchema = z.object({
    note_text: z.string().min(1, 'Note text cannot be empty.'),
    employee_id: z.string().uuid(),
});

const attachmentSchema = z.object({
  attachment_file: z.instanceof(File).refine(file => file.size > 0, "A file is required."),
  category_id: z.string().uuid("A valid category must be selected."),
  description: z.string().optional(),
});

const deleteAttachmentSchema = z.object({
    employee_id: z.string().uuid(),
    attachment_id: z.string().uuid(),
    storage_path: z.string().min(1),
});

// Generic helper
async function handleFormAction<T extends z.ZodType<any, any>>(
    formData: FormData,
    schema: T,
    action: (data: z.infer<T>) => Promise<ActionFormState>
): Promise<ActionFormState> {
    const rawData = Object.fromEntries(formData.entries());
    const result = schema.safeParse(rawData);

    if (!result.success) {
        return {
            type: 'error',
            message: 'Invalid form data.',
            errors: result.error.flatten().fieldErrors,
        };
    }
    return action(result.data);
}

// Employee Actions
export async function addEmployee(prevState: ActionFormState, formData: FormData): Promise<ActionFormState> {
    const result = employeeSchema.safeParse(Object.fromEntries(formData.entries()));

    if (!result.success) {
        return { type: 'error', message: 'Invalid form data.', errors: result.error.flatten().fieldErrors };
    }

    const supabase = getSupabaseAdminClient();
    if (!supabase) return { type: 'error', message: 'Database connection failed.' };

    const { error } = await supabase.from('employees').insert(result.data);
    if (error) return { type: 'error', message: `Database error: ${error.message}` };
    
    revalidatePath('/employees');
    redirect('/employees');
}

export async function updateEmployee(prevState: ActionFormState, formData: FormData): Promise<ActionFormState> {
    const employeeId = formData.get('employee_id') as string;
    const result = employeeSchema.safeParse(Object.fromEntries(formData.entries()));
    
    if (!result.success) {
        return { type: 'error', message: 'Invalid form data.', errors: result.error.flatten().fieldErrors };
    }

    const supabase = getSupabaseAdminClient();
    if (!supabase) return { type: 'error', message: 'Database connection failed.' };

    const { error } = await supabase.from('employees').update(result.data).eq('employee_id', employeeId);
    
    if (error) return { type: 'error', message: `Database error: ${error.message}` };

    revalidatePath(`/employees`);
    revalidatePath(`/employees/${employeeId}`);
    return { type: 'success', message: 'Employee updated successfully.' };
}

export async function deleteEmployee(prevState: DeleteState, formData: FormData): Promise<DeleteState> {
    const employeeId = formData.get('employee_id') as string;
    if (!employeeId) return { type: 'error', message: 'Employee ID is missing.' };

    const supabase = getSupabaseAdminClient();
    if (!supabase) return { type: 'error', message: 'Database connection failed.' };

    const { error } = await supabase.from('employees').delete().eq('employee_id', employeeId);
    if (error) return { type: 'error', message: `Database error: ${error.message}` };
    
    revalidatePath('/employees');
    redirect('/employees');
}

// Server action to get a simplified list of employees for dropdowns
export async function getEmployeeList(): Promise<{ id: string; name: string; }[] | null> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    console.error('getEmployeeList: Database connection failed.');
    return null;
  }

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
    const result = noteSchema.safeParse(Object.fromEntries(formData.entries()));
    if (!result.success) {
        return { type: 'error', message: 'Invalid data', errors: result.error.flatten().fieldErrors };
    }
    
    const supabase = getSupabaseAdminClient();
    if (!supabase) return { type: 'error', message: 'Database connection failed.' };
    
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
  // 1. Validate form data
  const result = addAttachmentSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!result.success) {
    console.log('Validation failed:', result.error.flatten().fieldErrors);
    return { type: 'error', message: "Validation failed.", errors: result.error.flatten().fieldErrors };
  }

  const { employee_id, attachment_file, category_id, description } = result.data;
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return { type: 'error', message: 'Database connection failed.' };
  }

  // 2. Upload file to Supabase Storage
  const uniqueFileName = `${employee_id}/${Date.now()}_${attachment_file.name.replace(/\s/g, '_')}`;
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

  console.log(`Attachment metadata for '${storagePath}' successfully saved to DB.`);
  revalidatePath(`/employees/${employee_id}`);
  return { type: 'success', message: 'Attachment uploaded successfully!' };
}

export async function getAttachmentSignedUrl(storagePath: string): Promise<{ url: string | null; error: string | null }> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return { url: null, error: 'Database connection failed.' };
  }

  const { data, error } = await supabase.storage
    .from(ATTACHMENT_BUCKET_NAME)
    .createSignedUrl(storagePath, 60 * 5); // URL valid for 5 minutes

  if (error) {
    console.error('Error creating signed URL:', error);
    return { url: null, error: error.message };
  }

  return { url: data.signedUrl, error: null };
}

export async function deleteEmployeeAttachment(prevState: DeleteState, formData: FormData): Promise<DeleteState> {
    const result = deleteAttachmentSchema.safeParse(Object.fromEntries(formData.entries()));
    if(!result.success){
        return { type: 'error', message: 'Invalid IDs provided.', errors: result.error.flatten().fieldErrors };
    }

    const { employee_id, attachment_id, storage_path } = result.data;
    const supabase = getSupabaseAdminClient();
    if (!supabase) return { type: 'error', message: 'Database connection failed.' };

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
  relationship: z.string().optional(),
  phone_number: z.string().optional(),
  address: z.string().optional(),
});

export async function addEmergencyContact(
  prevState: ActionFormState | null,
  formData: FormData
): Promise<ActionFormState | null> {
  const validatedFields = EmergencyContactSchema.safeParse(
    Object.fromEntries(formData.entries())
  );

  if (!validatedFields.success) {
    return {
      type: 'error',
      message: 'Validation failed.',
      errors: validatedFields.error.flatten().fieldErrors,
    };
  }

  const { employee_id, name, relationship, phone_number, address } = validatedFields.data;

  const { error } = await supabase
    .from('employee_emergency_contacts')
    .insert([{ employee_id, name, relationship, phone_number, address }]);

  if (error) {
    console.error('Error adding emergency contact:', error);
    return {
      type: 'error',
      message: 'Database error: Could not add emergency contact.',
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
  ni_number: z.string().optional(),
  bank_account_number: z.string().optional(),
  bank_sort_code: z.string().optional(),
  bank_name: z.string().optional(),
  payee_name: z.string().optional(),
  branch_address: z.string().optional(),
});

export async function upsertFinancialDetails(
  prevState: ActionFormState | null,
  formData: FormData
): Promise<ActionFormState | null> {
  const validatedFields = FinancialDetailsSchema.safeParse(
    Object.fromEntries(formData.entries())
  );

  if (!validatedFields.success) {
    return {
      type: 'error',
      message: 'Validation failed.',
      errors: validatedFields.error.flatten().fieldErrors,
    };
  }

  const { error } = await supabase
    .from('employee_financial_details')
    .upsert(validatedFields.data, { onConflict: 'employee_id' });

  if (error) {
    console.error('Error upserting financial details:', error);
    return {
      type: 'error',
      message: 'Database error: Could not save financial details.',
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
  doctor_name: z.string().optional(),
  doctor_address: z.string().optional(),
  allergies: z.string().optional(),
  illness_history: z.string().optional(),
  recent_treatment: z.string().optional(),
  has_diabetes: z.boolean(),
  has_epilepsy: z.boolean(),
  has_skin_condition: z.boolean(),
  has_depressive_illness: z.boolean(),
  has_bowel_problems: z.boolean(),
  has_ear_problems: z.boolean(),
  is_registered_disabled: z.boolean(),
  disability_reg_number: z.string().optional(),
  disability_reg_expiry_date: z.string().optional().nullable(),
  disability_details: z.string().optional(),
});

export async function upsertHealthRecord(
  prevState: ActionFormState | null,
  formData: FormData
): Promise<ActionFormState | null> {
  const data: any = Object.fromEntries(formData.entries());

  // Convert checkbox values from 'on' to boolean
  const booleanFields = [
    'has_diabetes', 'has_epilepsy', 'has_skin_condition', 'has_depressive_illness',
    'has_bowel_problems', 'has_ear_problems', 'is_registered_disabled'
  ];
  booleanFields.forEach(field => {
    data[field] = data[field] === 'on';
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

  const { error } = await supabase
    .from('employee_health_records')
    .upsert(validatedFields.data, { onConflict: 'employee_id' });

  if (error) {
    console.error('Error upserting health record:', error);
    return {
      type: 'error',
      message: 'Database error: Could not save health record.',
    };
  }

  revalidatePath(`/employees/${validatedFields.data.employee_id}`);
  return {
    type: 'success',
    message: 'Health record saved successfully.',
  };
}