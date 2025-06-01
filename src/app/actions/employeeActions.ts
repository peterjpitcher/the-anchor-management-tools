'use server'

import { createClient } from '@supabase/supabase-js';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { Employee, EmployeeNote, EmployeeAttachment } from '@/types/database';

// Helper function to create Supabase client with Service Role Key for server-side actions
// Ensure these ENV VARS are set in your Vercel/hosting environment
function createAdminSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const testServerOnlyVar = process.env.TEST_SERVER_ONLY_VAR; // Added for testing

  // Added logging to inspect the values of env vars at runtime
  console.log('[employeeActions] TEST_SERVER_ONLY_VAR:', testServerOnlyVar ? `SET (value: ${testServerOnlyVar})` : 'NOT SET');
  console.log('[employeeActions] NEXT_PUBLIC_SUPABASE_URL:', supabaseUrl ? 'SET' : 'NOT SET');
  console.log('[employeeActions] SUPABASE_SERVICE_ROLE_KEY:', supabaseServiceRoleKey ? 'SET (length: ' + supabaseServiceRoleKey.length + ')' : 'NOT SET');

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    console.error('Missing Supabase URL or Service Role Key for admin client in employeeActions. Check .env file and restart dev server.'); // Changed .env.local to .env
    console.error('Current process.env.NEXT_PUBLIC_SUPABASE_URL:', process.env.NEXT_PUBLIC_SUPABASE_URL);
    console.error('Current process.env.SUPABASE_SERVICE_ROLE_KEY provided:', !!process.env.SUPABASE_SERVICE_ROLE_KEY);
    return null;
  }
  return createClient(supabaseUrl, supabaseServiceRoleKey);
}

export type FormState = {
  message: string;
  type: 'success' | 'error';
  employeeId?: string;
  errors?: Record<string, string>;
} | null;

// Type for the data expected from the form, excluding auto-generated fields
export type EmployeeFormData = Omit<Employee, 'employee_id' | 'created_at' | 'updated_at'>;

export async function addEmployee(prevState: FormState, formData: FormData): Promise<FormState> {
  const supabase = createAdminSupabaseClient();
  if (!supabase) {
    return { message: 'Database connection failed. Please try again.', type: 'error' };
  }

  const rawFormData = {
    first_name: formData.get('first_name') as string,
    last_name: formData.get('last_name') as string,
    date_of_birth: formData.get('date_of_birth') as string || null, // Handle empty string for optional date
    address: formData.get('address') as string || null,
    phone_number: formData.get('phone_number') as string || null,
    email_address: formData.get('email_address') as string,
    job_title: formData.get('job_title') as string,
    employment_start_date: formData.get('employment_start_date') as string,
    employment_end_date: formData.get('employment_end_date') as string || null, // Handle empty string
    status: formData.get('status') as string || 'Active', // Default to 'Active' if not provided
    emergency_contact_name: formData.get('emergency_contact_name') as string || null,
    emergency_contact_phone: formData.get('emergency_contact_phone') as string || null,
  };

  // Basic Validation (more comprehensive validation should be added)
  const errors: Record<string, string> = {};
  if (!rawFormData.first_name) errors.first_name = 'First name is required.';
  if (!rawFormData.last_name) errors.last_name = 'Last name is required.';
  if (!rawFormData.email_address) errors.email_address = 'Email is required.';
  if (!rawFormData.job_title) errors.job_title = 'Job title is required.';
  if (!rawFormData.employment_start_date) errors.employment_start_date = 'Start date is required.';

  if (Object.keys(errors).length > 0) {
    return { message: 'Please correct the errors below.', type: 'error', errors };
  }

  // Prepare data for Supabase (ensure correct types, e.g., dates)
  const employeeData: Partial<EmployeeFormData> = {
    ...rawFormData,
    // Ensure date fields are correctly formatted or null if empty
    date_of_birth: rawFormData.date_of_birth ? rawFormData.date_of_birth : null,
    employment_start_date: rawFormData.employment_start_date,
    employment_end_date: rawFormData.employment_end_date ? rawFormData.employment_end_date : null,
  };

  const { data: newEmployee, error } = await supabase
    .from('employees')
    .insert(employeeData as EmployeeFormData) // Cast as EmployeeFormData after validation
    .select('employee_id') // Select the ID of the newly created employee
    .single();

  if (error) {
    console.error('Error adding employee:', error);
    return { message: `Failed to add employee: ${error.message}`, type: 'error' };
  }

  if (!newEmployee || !newEmployee.employee_id) {
    console.error('Failed to add employee or retrieve ID.');
    return { message: 'Failed to add employee or retrieve their ID. Please check the logs.', type: 'error' };
  }

  // Revalidate the employees list page to show the new employee
  revalidatePath('/employees');

  // Redirect to the new employee's detail page (once it exists)
  // For now, redirecting back to the employees list
  // redirect(`/employees/${newEmployee.employee_id}`);
  // For now, return success and let the form redirect or update UI
  return {
    message: 'Employee added successfully!',
    type: 'success',
    employeeId: newEmployee.employee_id,
  };
}

export async function updateEmployee(employeeId: string, prevState: FormState, formData: FormData): Promise<FormState> {
  const supabase = createAdminSupabaseClient();
  if (!supabase) {
    return { message: 'Database connection failed. Please try again.', type: 'error' };
  }

  if (!employeeId) {
    return { message: 'Employee ID is missing. Cannot update.', type: 'error' };
  }

  const rawFormData = {
    first_name: formData.get('first_name') as string,
    last_name: formData.get('last_name') as string,
    date_of_birth: formData.get('date_of_birth') as string || null,
    address: formData.get('address') as string || null,
    phone_number: formData.get('phone_number') as string || null,
    email_address: formData.get('email_address') as string,
    job_title: formData.get('job_title') as string,
    employment_start_date: formData.get('employment_start_date') as string,
    employment_end_date: formData.get('employment_end_date') as string || null,
    status: formData.get('status') as string || 'Active',
    emergency_contact_name: formData.get('emergency_contact_name') as string || null,
    emergency_contact_phone: formData.get('emergency_contact_phone') as string || null,
  };

  // Basic Validation
  const errors: Record<string, string> = {};
  if (!rawFormData.first_name) errors.first_name = 'First name is required.';
  if (!rawFormData.last_name) errors.last_name = 'Last name is required.';
  if (!rawFormData.email_address) errors.email_address = 'Email is required.';
  if (!rawFormData.job_title) errors.job_title = 'Job title is required.';
  if (!rawFormData.employment_start_date) errors.employment_start_date = 'Start date is required.';

  if (Object.keys(errors).length > 0) {
    return { message: 'Please correct the errors below.', type: 'error', errors, employeeId };
  }

  const employeeData: Partial<EmployeeFormData> = {
    ...rawFormData,
    date_of_birth: rawFormData.date_of_birth ? rawFormData.date_of_birth : null,
    employment_start_date: rawFormData.employment_start_date,
    employment_end_date: rawFormData.employment_end_date ? rawFormData.employment_end_date : null,
    // updated_at will be handled by the database trigger if set up, or manually add here if not.
  };

  const { error } = await supabase
    .from('employees')
    .update(employeeData as EmployeeFormData)
    .eq('employee_id', employeeId);

  if (error) {
    console.error('Error updating employee:', error);
    return { message: `Failed to update employee: ${error.message}`, type: 'error', employeeId };
  }

  revalidatePath('/employees'); // Revalidate list page
  revalidatePath(`/employees/${employeeId}`); // Revalidate detail page
  revalidatePath(`/employees/${employeeId}/edit`); // Revalidate edit page itself

  return {
    message: 'Employee updated successfully!',
    type: 'success',
    employeeId,
  };
}

export type DeleteState = {
  message: string;
  type: 'success' | 'error';
} | null;

export async function deleteEmployee(employeeId: string, prevState: DeleteState /* formData not needed */): Promise<DeleteState> {
  const supabase = createAdminSupabaseClient();
  if (!supabase) {
    return { message: 'Database connection failed.', type: 'error' };
  }

  if (!employeeId) {
    return { message: 'Employee ID is missing. Cannot delete.', type: 'error' };
  }

  // Before deleting, consider implications: related notes and attachments might also be deleted due to CASCADE constraints.
  // Or, they might be orphaned if CASCADE is not set. Ensure this is the desired behavior.
  // Also, if files are stored in Supabase Storage, they are NOT automatically deleted when the DB record is deleted.
  // You would need to manually delete them from storage using the storage_path.
  // For this iteration, we are only deleting the DB record.

  const { error } = await supabase
    .from('employees')
    .delete()
    .eq('employee_id', employeeId);

  if (error) {
    console.error('Error deleting employee:', error);
    // It's possible the employee was already deleted, or RLS prevents deletion.
    return { message: `Failed to delete employee: ${error.message}. Please try again or check permissions.`, type: 'error' };
  }

  revalidatePath('/employees'); // Revalidate the main list page
  // No need to revalidate the specific employee page as it will 404
  
  // Instead of returning a state, we will redirect to the employees list page
  // as the current page (/employees/[id]) will no longer be valid.
  redirect('/employees');
  
  // Note: redirect() must be called outside of a try/catch block.
  // If we needed to return a state for some reason, it would be:
  // return { message: 'Employee deleted successfully!', type: 'success' };
}

// Types for Employee Notes
export type EmployeeNoteFormData = Omit<EmployeeNote, 'note_id' | 'created_at' | 'created_by'>; // created_by will be added server-side

export type NoteFormState = {
  message: string;
  type: 'success' | 'error';
  errors?: {
    note_text?: string;
    general?: string;
  };
} | null;

export async function addEmployeeNote(
  employeeId: string, 
  prevState: NoteFormState, 
  formData: FormData
): Promise<NoteFormState> {
  const supabase = createAdminSupabaseClient(); // Use the admin client for server-side operations
  if (!supabase) {
    return { message: 'Database connection failed.', type: 'error' };
  }

  if (!employeeId) {
    return { message: 'Employee ID is missing.', type: 'error', errors: { general: 'Employee ID is missing.' } };
  }

  const noteText = formData.get('note_text') as string;

  if (!noteText || noteText.trim().length === 0) {
    return { message: 'Note text cannot be empty.', type: 'error', errors: { note_text: 'Note cannot be empty.' } };
  }

  // Get current authenticated user ID - this part is tricky with Service Role key
  // Normally, for user-specific actions, you'd use the user's session-based Supabase client.
  // If using admin client, we can't directly get user.id().
  // For server actions where user identity is crucial and RLS is based on auth.uid(),
  // you might need to create a Supabase client with the user's actual JWT if passed from client,
  // or adjust RLS to allow service_role to set created_by.
  // For now, let's assume RLS and DB policies allow service_role to insert with a passed created_by, 
  // or created_by is nullable and we get it differently or pass it.
  // A simpler approach for now, if RLS doesn't block it, is to get the user from a different client if needed.
  // This requires careful setup of Supabase client for user context in server actions.
  // For this example, we'll simulate getting a user ID or leave it null if not easily available.
  // THIS IS A PLACEHOLDER - In a real app, you must correctly get the authenticated user's ID.
  let createdById: string | null = null; 
  
  // Attempt to get current user from a non-admin client if possible, or pass it to the action
  // For this example, we'll omit actually fetching the user to keep it simpler, assuming it might be passed
  // or RLS for employee_notes allows service_key to set created_by or it's nullable.
  // const { data: { user } } = await supabase.auth.getUser(); // This won't work with Service Role Key for the *specific* user.
  // createdById = user?.id || null; // This is what you'd do with a user-session client.

  // The SQL for the table makes `created_by` nullable, so if we can't get it, it will be null.
  // The form will need to pass the current user's ID if it's required to be set by this action.
  // Let's assume for now that the `created_by` field is correctly populated by the client/caller or RLS setup.
  // The `formData` could potentially include a hidden field for `created_by` if set by the client component that has user context.
  const created_by_from_client = formData.get('created_by_user_id') as string | null;
  if (created_by_from_client) {
      createdById = created_by_from_client;
  }

  const noteData: Omit<EmployeeNote, 'note_id' | 'created_at'> = {
    employee_id: employeeId,
    note_text: noteText.trim(),
    created_by: createdById, // This might be null
  };

  const { error } = await supabase.from('employee_notes').insert(noteData);

  if (error) {
    console.error('Error adding employee note:', error);
    return { message: `Failed to add note: ${error.message}`, type: 'error', errors: { general: error.message } };
  }

  revalidatePath(`/employees/${employeeId}`); // Revalidate the employee detail page to show the new note

  return { message: 'Note added successfully!', type: 'success' };
}

// Types for Employee Attachments
// import type { EmployeeAttachment } from '@/types/database'; // Already imported at the top
const ATTACHMENT_BUCKET_NAME = 'employee-attachments'; // Define your bucket name

export type AttachmentFormState = {
  message: string;
  type: 'success' | 'error';
  errors?: {
    file?: string;
    category_id?: string;
    description?: string;
    general?: string;
  };
} | null;

export async function addEmployeeAttachment(
  employeeId: string,
  prevState: AttachmentFormState,
  formData: FormData
): Promise<AttachmentFormState> {
  const supabase = createAdminSupabaseClient();
  if (!supabase) {
    return { message: 'Database connection failed.', type: 'error' };
  }

  if (!employeeId) {
    return { message: 'Employee ID is missing.', type: 'error', errors: { general: 'Employee ID missing'}};
  }

  const file = formData.get('attachment_file') as File | null;
  const categoryId = formData.get('category_id') as string;
  const description = formData.get('description') as string || null;

  const errors: NonNullable<AttachmentFormState>['errors'] = {};
  if (!file || file.size === 0) errors.file = 'A file is required.';
  if (!categoryId) errors.category_id = 'Category is required.';
  // Max file size (e.g., 10MB)
  const MAX_FILE_SIZE = 10 * 1024 * 1024;
  if (file && file.size > MAX_FILE_SIZE) errors.file = `File size cannot exceed ${MAX_FILE_SIZE / (1024*1024)}MB.`;
  // Allowed file types (example) - uncomment and customize if needed
  // const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
  // if (file && !ALLOWED_TYPES.includes(file.type)) errors.file = 'Invalid file type.';

  if (Object.keys(errors).length > 0) {
    return { message: 'Please correct the errors.', type: 'error', errors };
  }

  if (!file) { // Should be caught by above validation, but as a safeguard
    return { message: 'File not found.', type: 'error', errors: { file: 'File not found.' } };
  }

  // Upload file to Supabase Storage
  // Ensure the bucket `employee-attachments` exists and has appropriate policies.
  const fileExt = file.name.split('.').pop() || 'bin'; // Default extension if none
  const uniqueFileName = `${employeeId}/${Date.now()}_${Math.random().toString(36).substring(2, 15)}.${fileExt}`;
  // storagePath is just the uniqueFileName within the bucket

  const { data: uploadData, error: uploadError } = await supabase.storage
    .from(ATTACHMENT_BUCKET_NAME)
    .upload(uniqueFileName, file, { // use uniqueFileName as path
      cacheControl: '3600',
      upsert: false, // Don't upsert if file with same path exists (should be unique)
    });

  if (uploadError) {
    console.error('Error uploading file to storage:', uploadError);
    return { message: `Storage upload failed: ${uploadError.message}`, type: 'error', errors: { general: uploadError.message }};
  }

  // Insert record into employee_attachments table
  const attachmentData: Omit<EmployeeAttachment, 'attachment_id' | 'uploaded_at'> = {
    employee_id: employeeId,
    category_id: categoryId,
    file_name: file.name,
    storage_path: uploadData.path, // Use path from successful upload
    mime_type: file.type,
    file_size_bytes: file.size,
    description: description,
  };

  const { error: dbError } = await supabase.from('employee_attachments').insert(attachmentData);

  if (dbError) {
    console.error('Error saving attachment record to DB:', dbError);
    // Attempt to delete the orphaned file from storage if DB insert fails
    await supabase.storage.from(ATTACHMENT_BUCKET_NAME).remove([uniqueFileName]);
    return { message: `Failed to save attachment details: ${dbError.message}`, type: 'error', errors: { general: dbError.message } };
  }

  revalidatePath(`/employees/${employeeId}`);
  return { message: 'Attachment uploaded successfully!', type: 'success' };
}

export async function deleteEmployeeAttachment(
  employeeId: string, 
  attachmentId: string, 
  storagePath: string,
  prevState: DeleteState // Reusing DeleteState for simplicity in form handling
): Promise<DeleteState> {
  const supabase = createAdminSupabaseClient();
  if (!supabase) return { message: 'Database connection failed.', type: 'error' };

  if (!attachmentId || !storagePath || !employeeId) {
    return { message: 'Missing required IDs for deletion.', type: 'error' };
  }

  // 1. Delete file from Supabase Storage
  const { error: storageError } = await supabase.storage
    .from(ATTACHMENT_BUCKET_NAME)
    .remove([storagePath]);

  if (storageError) {
    console.error('Error deleting file from storage:', storageError);
    // Do not return immediately; still attempt to delete DB record.
  }

  // 2. Delete record from employee_attachments table
  const { error: dbError } = await supabase
    .from('employee_attachments')
    .delete()
    .eq('attachment_id', attachmentId);

  if (dbError) {
    console.error('Error deleting attachment record from DB:', dbError);
    return { message: `Failed to delete attachment record: ${dbError.message}. Storage error (if any): ${storageError?.message || 'None'}`, type: 'error' };
  }
  
  if (storageError && !dbError) {
    console.warn(`Attachment record ${attachmentId} deleted from DB, but file ${storagePath} might be orphaned in storage due to error: ${storageError.message}`);
    revalidatePath(`/employees/${employeeId}`);
    return { message: 'Attachment record deleted, but file may remain in storage. Check logs.', type: 'error' }; 
  }

  revalidatePath(`/employees/${employeeId}`);
  return { message: 'Attachment deleted successfully!', type: 'success' };
} 