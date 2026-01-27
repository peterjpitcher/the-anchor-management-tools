import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { z } from 'zod';
import { getTodayIsoDate } from '@/lib/dateUtils';
import { syncBirthdayCalendarEvent, deleteBirthdayCalendarEvent } from '@/lib/google-calendar-birthdays';
import type { AuditLogEntry } from '@/app/actions/employeeDetails';
import type { Employee, EmployeeAttachment, EmployeeFinancialDetails, EmployeeHealthRecord, EmployeeEmergencyContact, EmployeeRightToWork, AttachmentCategory, EmployeeNote, AuditLog } from '@/types/database';

export type EmployeeStatus = 'all' | 'Active' | 'Former' | 'Prospective';

export interface ExportOptions {
  format: 'csv' | 'json';
  includeFields?: string[];
  statusFilter?: EmployeeStatus;
}

export interface EmployeeNoteWithAuthor extends EmployeeNote {
  author_name: string;
}

export interface EmployeeDetailData {
  employee: Employee;
  financialDetails: EmployeeFinancialDetails | null;
  healthRecord: EmployeeHealthRecord | null;
  notes: EmployeeNoteWithAuthor[];
  attachments: EmployeeAttachment[];
  attachmentCategories: AttachmentCategory[];
  emergencyContacts: EmployeeEmergencyContact[];
  rightToWork: (EmployeeRightToWork & { photo_storage_path?: string | null }) | null;
  auditLogs: AuditLogEntry[];
}

export interface EmployeeEditData {
  employee: Employee;
  financialDetails: EmployeeFinancialDetails | null;
  healthRecord: EmployeeHealthRecord | null;
}

async function enrichNotesWithAuthors(
  notes: EmployeeNote[],
  supabase: Awaited<ReturnType<typeof createClient>>
) {
  if (notes.length === 0) {
    return [] as EmployeeNoteWithAuthor[];
  }

  const authorIds = Array.from(
    new Set(
      notes
        .map((note) => note.created_by_user_id)
        .filter((id): id is string => Boolean(id))
    )
  );

  if (authorIds.length === 0) {
    return notes.map((note) => ({
      ...note,
      author_name: 'System'
    }));
  }

  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('id, full_name')
    .in('id', authorIds);

  if (error) {
    console.error('[employeeDetail] failed to fetch profiles', error);
  }

  const profileMap = new Map(profiles?.map((profile) => [profile.id, profile.full_name ?? null]));

  return notes.map((note) => {
    if (!note.created_by_user_id) {
      return { ...note, author_name: 'System' };
    }

    const fullName = profileMap.get(note.created_by_user_id);
    if (fullName) {
      return { ...note, author_name: fullName };
    }

    return {
      ...note,
      author_name: `User (${note.created_by_user_id.slice(0, 6)}…)`
    };
  });
}

export const employeeSchema = z.object({
  first_name: z.string().min(1, 'First name is required'),
  last_name: z.string().min(1, 'Last name is required'),
  email_address: z.string().email('Invalid email address'),
  job_title: z.string().min(1, 'Job title is required'),
  employment_start_date: z.string().min(1, 'Start date is required'),
  status: z.enum(['Active', 'Former', 'Prospective']),
  date_of_birth: z.union([z.string().min(1), z.null()]).optional(),
  address: z.union([z.string().min(1), z.null()]).optional(),
  post_code: z.union([z.string().min(1), z.null()]).optional(),
  phone_number: z.union([z.string().min(1), z.null()]).optional(),
  mobile_number: z.union([z.string().min(1), z.null()]).optional(),
  first_shift_date: z.union([z.string().min(1), z.null()]).optional(),
  uniform_preference: z.union([z.string().min(1), z.null()]).optional(),
  keyholder_status: z.union([z.boolean(), z.null()]).optional(),
  employment_end_date: z.union([z.string().min(1), z.null()]).optional(),
});

export const noteSchema = z.object({
    note_text: z.string().min(1, 'Note text cannot be empty.'),
    employee_id: z.string().uuid(),
    created_by_user_id: z.string().uuid().optional(),
});

const ATTACHMENT_BUCKET_NAME = 'employee-attachments'; // Moved here for service scope

export const addAttachmentSchema = z.object({
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

export const deleteAttachmentSchema = z.object({
    employee_id: z.string().uuid(),
    attachment_id: z.string().uuid(),
    storage_path: z.string().min(1),
});

export const EmergencyContactSchema = z.object({
  employee_id: z.string().uuid(),
  name: z.string().min(1, 'Name is required'),
  relationship: z.union([z.string().min(1), z.null()]).optional(),
  phone_number: z.union([z.string().regex(/^(\+?44|0)?[0-9]{10,11}$/, 'Invalid UK phone number format'), z.null()]).optional(),
  mobile_number: z.union([z.string().regex(/^(\+?44|0)?[0-9]{10,11}$/, 'Invalid UK phone number format'), z.null()]).optional(),
  priority: z.enum(['Primary', 'Secondary', 'Other']).optional(),
  address: z.union([z.string().min(1), z.null()]).optional(),
});

export const FinancialDetailsSchema = z.object({
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

export const HealthRecordSchema = z.object({
  employee_id: z.string().uuid(),
  doctor_name: z.union([z.string().min(1), z.null()]).optional(),
  doctor_address: z.union([z.string().min(1), z.null()]).optional(),
  allergies: z.union([z.string().min(1), z.null()]).optional(),
  has_allergies: z.boolean().optional(),
  had_absence_over_2_weeks_last_3_years: z.boolean(),
  had_outpatient_treatment_over_3_months_last_3_years: z.boolean(),
  absence_or_treatment_details: z.union([z.string().min(1), z.null()]).optional(),
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

const RIGHT_TO_WORK_DOCUMENT_TYPES = [
  'Passport', 'Biometric Residence Permit', 'Share Code', 'Other', 'List A', 'List B'
] as const;

export const RightToWorkSchema = z.object({
  employee_id: z.string().uuid(),
  document_type: z.enum(RIGHT_TO_WORK_DOCUMENT_TYPES),
  check_method: z.union([z.enum(['manual', 'online', 'digital']), z.null()]).optional(),
  document_reference: z.union([z.string().min(1), z.null()]).optional(),
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

export const ONBOARDING_CHECKLIST_FIELDS = [
  'wheniwork_invite_sent', 'private_whatsapp_added', 'team_whatsapp_added', 'till_system_setup',
  'training_flow_setup', 'employment_agreement_drafted', 'employee_agreement_accepted'
] as const;

export type OnboardingChecklistField = typeof ONBOARDING_CHECKLIST_FIELDS[number];

export const ONBOARDING_FIELD_CONFIG: Record<OnboardingChecklistField, { label: string; dateField: string }> = {
  wheniwork_invite_sent: { label: 'WhenIWork Invite Sent', dateField: 'wheniwork_invite_date' },
  private_whatsapp_added: { label: 'Added to Private WhatsApp', dateField: 'private_whatsapp_date' },
  team_whatsapp_added: { label: 'Added to Team WhatsApp', dateField: 'team_whatsapp_date' },
  till_system_setup: { label: 'Till System Setup', dateField: 'till_system_date' },
  training_flow_setup: { label: 'Training in Flow Setup', dateField: 'training_flow_date' },
  employment_agreement_drafted: { label: 'Employment Agreement Drafted', dateField: 'employment_agreement_date' },
  employee_agreement_accepted: { label: 'Employee Agreement Accepted', dateField: 'employee_agreement_accepted_date' }
};


export type CreateEmployeeInput = {
  first_name: string;
  last_name: string;
  email_address: string;
  job_title: string;
  employment_start_date: string;
  status: 'Active' | 'Former' | 'Prospective';
  date_of_birth?: string | null;
  address?: string | null;
  post_code?: string | null;
  phone_number?: string | null;
  mobile_number?: string | null;
  first_shift_date?: string | null;
  uniform_preference?: string | null;
  keyholder_status?: boolean | null;
  employment_end_date?: string | null;
  
  // Financial Details
  financial?: {
    ni_number?: string | null;
    bank_account_number?: string | null;
    bank_sort_code?: string | null;
    bank_name?: string | null;
    payee_name?: string | null;
    branch_address?: string | null;
  };

  // Health Records
  health?: {
    doctor_name?: string | null;
    doctor_address?: string | null;
    allergies?: string | null;
    has_allergies?: boolean;
    had_absence_over_2_weeks_last_3_years?: boolean;
    had_outpatient_treatment_over_3_months_last_3_years?: boolean;
    absence_or_treatment_details?: string | null;
    illness_history?: string | null;
    recent_treatment?: string | null;
    has_diabetes?: boolean;
    has_epilepsy?: boolean;
    has_skin_condition?: boolean;
    has_depressive_illness?: boolean;
    has_bowel_problems?: boolean;
    has_ear_problems?: boolean;
    is_registered_disabled?: boolean;
    disability_reg_number?: string | null;
    disability_reg_expiry_date?: string | null;
    disability_details?: string | null;
  };
};

export class EmployeeService {
  static async createEmployee(input: CreateEmployeeInput) {
    const adminClient = createAdminClient();

    // Prepare payloads
    const employeeData = {
      first_name: input.first_name,
      last_name: input.last_name,
      email_address: input.email_address,
      job_title: input.job_title,
      employment_start_date: input.employment_start_date,
      status: input.status,
      date_of_birth: input.date_of_birth ?? null,
      address: input.address ?? null,
      post_code: input.post_code ?? null,
      phone_number: input.phone_number ?? null,
      mobile_number: input.mobile_number ?? null,
      first_shift_date: input.first_shift_date ?? null,
      uniform_preference: input.uniform_preference ?? null,
      keyholder_status: input.keyholder_status ?? false,
      employment_end_date: input.employment_end_date ?? null,
    };

    const financialData = input.financial ? {
      ni_number: input.financial.ni_number ?? null,
      bank_account_number: input.financial.bank_account_number ?? null,
      bank_sort_code: input.financial.bank_sort_code ?? null,
      bank_name: input.financial.bank_name ?? null,
      payee_name: input.financial.payee_name ?? null,
      branch_address: input.financial.branch_address ?? null,
    } : null;

    const healthData = input.health ? {
      doctor_name: input.health.doctor_name ?? null,
      doctor_address: input.health.doctor_address ?? null,
      allergies: input.health.allergies ?? null,
      has_allergies: input.health.has_allergies ?? false,
      had_absence_over_2_weeks_last_3_years: input.health.had_absence_over_2_weeks_last_3_years ?? false,
      had_outpatient_treatment_over_3_months_last_3_years: input.health.had_outpatient_treatment_over_3_months_last_3_years ?? false,
      absence_or_treatment_details: input.health.absence_or_treatment_details ?? null,
      illness_history: input.health.illness_history ?? null,
      recent_treatment: input.health.recent_treatment ?? null,
      has_diabetes: input.health.has_diabetes ?? false,
      has_epilepsy: input.health.has_epilepsy ?? false,
      has_skin_condition: input.health.has_skin_condition ?? false,
      has_depressive_illness: input.health.has_depressive_illness ?? false,
      has_bowel_problems: input.health.has_bowel_problems ?? false,
      has_ear_problems: input.health.has_ear_problems ?? false,
      is_registered_disabled: input.health.is_registered_disabled ?? false,
      disability_reg_number: input.health.disability_reg_number ?? null,
      disability_reg_expiry_date: input.health.disability_reg_expiry_date ?? null,
      disability_details: input.health.disability_details ?? null,
    } : null;

    // Atomic Transaction
    const { data: employee, error } = await adminClient.rpc('create_employee_transaction', {
      p_employee_data: employeeData,
      p_financial_data: financialData,
      p_health_data: healthData
    });

    if (error) {
      console.error('Create employee transaction error:', error);
      // Handle unique constraint violations gracefully if needed, though server action can parse message
      throw error; // Let server action handle the error mapping
    }

    // Automatically sync birthday to Google Calendar (best-effort).
    if (employee?.status === 'Active' && employee?.date_of_birth) {
      try {
        await syncBirthdayCalendarEvent(employee);
      } catch (calendarError) {
        console.error('Failed to sync birthday calendar on employee create:', calendarError);
        // Don't fail employee creation if calendar sync fails
      }
    }

    return employee;
  }

  static async updateEmployee(employeeId: string, updateData: z.infer<typeof employeeSchema>) {
    const adminClient = createAdminClient();

    // Get old values for calendar sync and audit logging in action
    const { data: oldEmployee, error: fetchError } = await adminClient
      .from('employees')
      .select('*')
      .eq('employee_id', employeeId)
      .maybeSingle();

    if (fetchError || !oldEmployee) {
      throw new Error('Employee not found or failed to fetch old data.');
    }
    
    const { error } = await adminClient.from('employees').update(updateData).eq('employee_id', employeeId);
    
    if (error) {
      console.error('Update employee error:', error);
      throw error;
    }

    // Keep Google Calendar birthday event in sync (best-effort).
    const wasEligibleForBirthdayEvent = oldEmployee.status === 'Active' && Boolean(oldEmployee.date_of_birth);
    const isEligibleForBirthdayEvent = updateData.status === 'Active' && Boolean(updateData.date_of_birth);

    if (wasEligibleForBirthdayEvent && !isEligibleForBirthdayEvent) {
      try {
        await deleteBirthdayCalendarEvent(employeeId);
      } catch (calendarError) {
        console.error('Failed to delete birthday calendar event:', calendarError);
      }
    } else if (isEligibleForBirthdayEvent) {
      try {
        await syncBirthdayCalendarEvent({
          ...oldEmployee,
          ...updateData,
          employee_id: employeeId
        });
      } catch (calendarError) {
        console.error('Failed to update birthday calendar event:', calendarError);
      }
    }
    
    return { updatedEmployee: updateData, oldEmployee: oldEmployee };
  }

  static async deleteEmployee(employeeId: string) {
    const adminClient = createAdminClient();

    // Get employee details for audit logging in action and calendar sync
    const { data: employee, error: fetchError } = await adminClient
        .from('employees')
        .select('*')
        .eq('employee_id', employeeId)
        .maybeSingle();
    
    if (fetchError || !employee) {
        throw new Error('Employee not found or failed to fetch old data.');
    }

    const { error } = await adminClient.from('employees').delete().eq('employee_id', employeeId);
    
    if (error) {
      console.error('Delete employee error:', error);
      throw error;
    }
    
    // Delete birthday calendar events if employee had a date of birth
    if (employee?.date_of_birth) {
        try {
            await deleteBirthdayCalendarEvent(employeeId);
        } catch (error) {
            console.error('Failed to delete birthday from calendar:', error);
            // Don't fail the employee deletion if calendar sync fails
        }
    }
    
    return employee; // Return deleted employee for audit logging
  }

  static async getEmployeeList(): Promise<{ id: string; name: string; }[] | null> {
    const adminClient = createAdminClient();

    const { data, error } = await adminClient
      .from('employees')
      .select('employee_id, first_name, last_name')
      .eq('status', 'Active')  // Only show active employees in dropdowns
      .order('last_name')
      .order('first_name');

    if (error) {
      console.error('Error fetching employee list:', error);
      throw new Error('Failed to fetch employee list');
    }

    return data.map(emp => ({ id: emp.employee_id, name: `${emp.first_name} ${emp.last_name}` }));
  }

  static async addEmployeeNote(noteData: z.infer<typeof noteSchema>) {
    const adminClient = createAdminClient();

    const { data: newNote, error } = await adminClient.from('employee_notes').insert(noteData).select().single();

    if (error) {
      console.error('Add employee note error:', error);
      throw error;
    }

    return newNote;
  }

  static async addEmployeeAttachment(
    employeeId: string,
    attachmentFile: File, // File object comes from FormData
    categoryId: string,
    description?: string | null
  ) {
    const adminClient = createAdminClient();

    // Sanitize filename
    const sanitizedFileName = attachmentFile.name
      .replace(/[^\w\s.-]/g, '')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^[._-]+|[._-]+$/g, '');
    
    const finalFileName = sanitizedFileName || 'unnamed_file';
    const uniqueFileName = `${employeeId}/${Date.now()}_${finalFileName}`;
    
    const { data: uploadData, error: uploadError } = await adminClient.storage
      .from(ATTACHMENT_BUCKET_NAME)
      .upload(uniqueFileName, attachmentFile, { upsert: false });

    if (uploadError) {
      console.error('Error uploading file to storage:', uploadError);
      throw new Error(`Storage upload failed: ${uploadError.message}`);
    }

    const storagePath = uploadData.path;

    try {
      const { error: dbError } = await adminClient.from('employee_attachments').insert({
        employee_id: employeeId,
        category_id: categoryId,
        file_name: attachmentFile.name,
        storage_path: storagePath,
        mime_type: attachmentFile.type,
        file_size_bytes: attachmentFile.size,
        description: description,
      });

      if (dbError) {
        throw new Error(`Database insert failed: ${dbError.message}`);
      }
      return { storagePath, fileName: attachmentFile.name, categoryId, description };
    } catch (dbInsertError: any) {
      console.error('Database insert failed after file upload. Initiating cleanup.', dbInsertError);
      const { error: removeError } = await adminClient.storage.from(ATTACHMENT_BUCKET_NAME).remove([storagePath]);

      if (removeError) {
        console.error(`CRITICAL ALERT: Failed to remove orphaned file '${storagePath}'. Manual cleanup required.`, removeError);
      } else {
        console.log(`Orphaned file '${storagePath}' successfully removed.`);
      }
      throw new Error(`Failed to save attachment details to the database: ${dbInsertError.message}`);
    }
  }

  static async getAttachmentSignedUrl(storagePath: string): Promise<string | null> {
    const adminClient = createAdminClient();

    const { data, error } = await adminClient.storage
      .from(ATTACHMENT_BUCKET_NAME)
      .createSignedUrl(storagePath, 60 * 5); // URL valid for 5 minutes

    if (error) {
      console.error('Error creating signed URL:', error);
      throw new Error(error.message);
    }
    return data.signedUrl;
  }

  static async deleteEmployeeAttachment(attachmentId: string, storagePath: string) {
    const adminClient = createAdminClient();

    const { data: attachment, error: fetchError } = await adminClient
      .from('employee_attachments')
      .select('file_name, storage_path')
      .eq('attachment_id', attachmentId)
      .single();
    
    if (fetchError || !attachment) {
      throw new Error('Attachment not found');
    }

    const { error: storageError } = await adminClient.storage
      .from(ATTACHMENT_BUCKET_NAME)
      .remove([storagePath]);
    
    if (storageError) {
      console.error('Error deleting file from storage:', storageError);
      throw new Error(`Storage error: ${storageError.message}`);
    }

    const { error: dbError } = await adminClient.from('employee_attachments').delete().eq('attachment_id', attachmentId);
    if (dbError) {
      console.error('Error deleting attachment metadata:', dbError);
      throw new Error(`Database error: ${dbError.message}`);
    }
    return attachment;
  }

  static async addEmergencyContact(contactData: z.infer<typeof EmergencyContactSchema>) {
    const adminClient = createAdminClient();
    
    const { error } = await adminClient
      .from('employee_emergency_contacts')
      .insert([contactData]);

    if (error) {
      console.error('Error adding emergency contact:', error);
      throw error;
    }
    return contactData;
  }

  static async upsertFinancialDetails(financialData: z.infer<typeof FinancialDetailsSchema>) {
    const adminClient = createAdminClient();
    
    const { error } = await adminClient
      .from('employee_financial_details')
      .upsert(financialData, { onConflict: 'employee_id' });

    if (error) {
      console.error('Error upserting financial details:', error);
      throw error;
    }
    return financialData;
  }

  static async upsertHealthRecord(healthData: z.infer<typeof HealthRecordSchema>) {
    const adminClient = createAdminClient();
    
    const { error } = await adminClient
      .from('employee_health_records')
      .upsert(healthData, { onConflict: 'employee_id' });

    if (error) {
      console.error('Error upserting health record:', error);
      throw error;
    }
    return healthData;
  }

  static async upsertRightToWork(
    employeeId: string,
    rtwData: z.infer<typeof RightToWorkSchema>,
    currentUserId: string | null,
    photoStoragePathOverride: string | null = null
  ) {
    const adminClient = createAdminClient();

    // Get current user ID for verified_by_user_id if not provided in data
    const verifiedByUserId = rtwData.verified_by_user_id ?? currentUserId;
    
    // Handle file upload if provided
    if (photoStoragePathOverride && !photoStoragePathOverride.startsWith(`${employeeId}/`)) {
      throw new Error('Invalid photo storage path.');
    }

    let photoStoragePath: string | null = null;
    const documentPhoto = rtwData.document_photo;

    const shouldUploadNewPhoto = Boolean(documentPhoto && documentPhoto.size > 0);
    const shouldUseOverridePhotoPath = Boolean(photoStoragePathOverride);
    let existingPhotoPath: string | null = null;

    if (shouldUploadNewPhoto || shouldUseOverridePhotoPath) {
      const { data: existingRecord } = await adminClient
        .from('employee_right_to_work')
        .select('photo_storage_path')
        .eq('employee_id', employeeId)
        .maybeSingle();

      existingPhotoPath = existingRecord?.photo_storage_path ?? null;
    }

    if (shouldUploadNewPhoto && documentPhoto) {
      // Upload new photo
      const sanitizedFileName = documentPhoto.name
        .replace(/[^\w\s.-]/g, '')
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^[._-]+|[._-]+$/g, '');

      const finalFileName = sanitizedFileName || 'right_to_work_document';
      const uniqueFileName = `${employeeId}/rtw_${Date.now()}_${finalFileName}`;

      const { data: uploadData, error: uploadError } = await adminClient.storage
        .from(ATTACHMENT_BUCKET_NAME)
        .upload(uniqueFileName, documentPhoto, { upsert: false });

      if (uploadError) {
        console.error('Error uploading right to work document:', uploadError);
        throw new Error(`Failed to upload document photo: ${uploadError.message}`);
      }

      photoStoragePath = uploadData.path;
    } else if (shouldUseOverridePhotoPath) {
      photoStoragePath = photoStoragePathOverride;
    }
    
    // Prepare data for database update
    const { document_photo, ...dataToSave } = rtwData; // Exclude the File object
    const dataForDb: any = {
      ...dataToSave,
      ...(photoStoragePath ? { photo_storage_path: photoStoragePath } : {}),
      verified_by_user_id: verifiedByUserId, // Ensure this is set
    };
    
    const { error } = await adminClient
      .from('employee_right_to_work')
      .upsert(dataForDb, { onConflict: 'employee_id' });

    if (error) {
      console.error('Error upserting right to work:', error);
      
      // Clean up uploaded file if database update failed
      if (photoStoragePath) {
        await adminClient.storage.from(ATTACHMENT_BUCKET_NAME).remove([photoStoragePath]);
      }
      throw error;
    }

    // Delete old photo after a successful DB update
    if (existingPhotoPath && photoStoragePath && existingPhotoPath !== photoStoragePath) {
      const { error: deleteError } = await adminClient.storage.from(ATTACHMENT_BUCKET_NAME).remove([existingPhotoPath]);
      if (deleteError) {
        console.error('Error deleting old right to work photo:', deleteError);
      }
    }

    return { data: dataForDb, oldPhotoPath: existingPhotoPath };
  }

  static async getRightToWorkPhotoUrl(photoPath: string): Promise<string | null> {
    const adminClient = createAdminClient();

    const { data, error } = await adminClient.storage
      .from(ATTACHMENT_BUCKET_NAME)
      .createSignedUrl(photoPath, 60 * 5); // URL valid for 5 minutes

    if (error) {
      console.error('Error creating signed URL for right to work photo:', error);
      throw new Error(error.message);
    }
    return data.signedUrl;
  }

  static async deleteRightToWorkPhoto(employeeId: string) {
    const adminClient = createAdminClient();
    
    // Get current photo path
    const { data: rightToWork, error: fetchError } = await adminClient
      .from('employee_right_to_work')
      .select('photo_storage_path')
      .eq('employee_id', employeeId)
      .single();
      
    if (fetchError || !rightToWork?.photo_storage_path) {
      throw new Error('No photo found to delete.');
    }
    
    // Delete from storage
    const { error: storageError } = await adminClient.storage
      .from(ATTACHMENT_BUCKET_NAME)
      .remove([rightToWork.photo_storage_path]);
      
    if (storageError) {
      console.error('Error deleting right to work photo from storage:', storageError);
      throw new Error('Failed to delete photo from storage.');
    }
    
    // Update database record
    const { error: dbError } = await adminClient
      .from('employee_right_to_work')
      .update({ photo_storage_path: null })
      .eq('employee_id', employeeId);
      
    if (dbError) {
      console.error('Error updating right to work record:', dbError);
      throw new Error('Failed to update database record.');
    }
    return { photoPath: rightToWork.photo_storage_path };
  }

  static async updateOnboardingChecklist(
    employeeId: string,
    field: string,
    checked: boolean
  ) {
    const adminClient = createAdminClient();

    if (!ONBOARDING_CHECKLIST_FIELDS.includes(field as OnboardingChecklistField)) {
      throw new Error('Unsupported onboarding checklist field.');
    }

    const checklistField = field as OnboardingChecklistField;
    const checklistConfig = ONBOARDING_FIELD_CONFIG[checklistField];

    const updateData: any = { employee_id: employeeId };
    
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
    
    const { error } = await adminClient
      .from('employee_onboarding_checklist')
      .upsert(updateData, { onConflict: 'employee_id' });

    if (error) {
      console.error('Error updating onboarding checklist:', error);
      throw error;
    }
    return updateData;
  }

  static async getOnboardingProgress(
    employeeId: string
  ): Promise<{ completed: number; total: number; percentage: number; items: Array<{ field: OnboardingChecklistField; label: string; completed: boolean; date: string | null }>; data: Record<string, any> | null }> {
    const adminClient = createAdminClient();

    const { data, error } = await adminClient
      .from('employee_onboarding_checklist')
      .select('*')
      .eq('employee_id', employeeId)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 is "no rows found"
      console.error('Error fetching onboarding progress:', error);
      throw new Error('Failed to fetch onboarding progress.');
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
      completed: completedCount,
      total,
      percentage,
      items,
      data: record
    };
  }

  static async getEmployeeByIdWithDetails(employeeId: string): Promise<EmployeeDetailData> {
    const supabase = await createClient(); // Use client for read-only to leverage RLS

    const { data: employee, error: employeeError } = await supabase
      .from('employees')
      .select('*')
      .eq('employee_id', employeeId)
      .maybeSingle();

    if (employeeError) {
      console.error('[EmployeeService] Failed to fetch employee', employeeError);
      throw new Error('Failed to load employee.');
    }
    if (!employee) {
      throw new Error('Employee not found.');
    }

    const [
      financialResult,
      healthResult,
      notesResult,
      attachmentsResult,
      attachmentCategoriesResult,
      emergencyContactsResult,
      rightToWorkResult,
      auditLogsResult
    ] = await Promise.all([
      supabase.from('employee_financial_details').select('*').eq('employee_id', employeeId).maybeSingle(),
      supabase.from('employee_health_records').select('*').eq('employee_id', employeeId).maybeSingle(),
      supabase.from('employee_notes').select('*').eq('employee_id', employeeId).order('created_at', { ascending: false }),
      supabase.from('employee_attachments').select('*').eq('employee_id', employeeId).order('uploaded_at', { ascending: false }),
      supabase.from('attachment_categories').select('*').order('category_name', { ascending: true }),
      supabase.from('employee_emergency_contacts').select('*').eq('employee_id', employeeId).order('created_at', { ascending: false }),
      supabase.from('employee_right_to_work').select('*').eq('employee_id', employeeId).maybeSingle(),
      supabase.from('audit_logs').select('*').eq('resource_type', 'employee').eq('resource_id', employeeId).order('created_at', { ascending: false }).limit(50),
    ]);

    if (financialResult.error) console.error('[EmployeeService] financial fetch failed', financialResult.error);
    if (healthResult.error) console.error('[EmployeeService] health fetch failed', healthResult.error);
    if (notesResult.error) console.error('[EmployeeService] notes fetch failed', notesResult.error);
    if (attachmentsResult.error) console.error('[EmployeeService] attachments fetch failed', attachmentsResult.error);
    if (attachmentCategoriesResult.error) console.error('[EmployeeService] categories fetch failed', attachmentCategoriesResult.error);
    if (emergencyContactsResult.error) console.error('[EmployeeService] contacts fetch failed', emergencyContactsResult.error);
    if (rightToWorkResult.error) console.error('[EmployeeService] right-to-work fetch failed', rightToWorkResult.error);
    if (auditLogsResult.error) console.error('[EmployeeService] audit logs fetch failed', auditLogsResult.error);

    const notes = await enrichNotesWithAuthors(notesResult.data ?? [], supabase);

    return {
      employee,
      financialDetails: financialResult.data ?? null,
      healthRecord: healthResult.data ?? null,
      notes,
      attachments: attachmentsResult.data ?? [],
      attachmentCategories: attachmentCategoriesResult.data ?? [],
      emergencyContacts: emergencyContactsResult.data ?? [],
      rightToWork: rightToWorkResult.data ?? null,
      auditLogs: auditLogsResult.data ?? [],
    };
  }

  static async getEmployeeByIdForEdit(employeeId: string): Promise<EmployeeEditData> {
    const supabase = await createClient(); // Use client for read-only to leverage RLS

    const { data: employee, error: employeeError } = await supabase
      .from('employees')
      .select('*')
      .eq('employee_id', employeeId)
      .maybeSingle();

    if (employeeError) {
      console.error('[EmployeeService] Failed to fetch employee for edit', employeeError);
      throw new Error('Failed to load employee.');
    }
    if (!employee) {
      throw new Error('Employee not found.');
    }

    const [
      financialResult,
      healthResult
    ] = await Promise.all([
      supabase.from('employee_financial_details').select('*').eq('employee_id', employeeId).maybeSingle(),
      supabase.from('employee_health_records').select('*').eq('employee_id', employeeId).maybeSingle()
    ]);

    if (financialResult.error) console.error('[EmployeeService] financial fetch failed for edit', financialResult.error);
    if (healthResult.error) console.error('[EmployeeService] health fetch failed for edit', healthResult.error);

    return {
      employee,
      financialDetails: financialResult.data ?? null,
      healthRecord: healthResult.data ?? null
    };
  }

  static async getEmployeesRoster(
    request: {
      page?: number;
      pageSize?: number;
      searchTerm?: string;
      statusFilter?: 'all' | 'Active' | 'Former' | 'Prospective';
    } = {}
  ) {
    const adminClient = createAdminClient();

    const pageSize = typeof request.pageSize === 'number' && request.pageSize > 0 ? request.pageSize : 50;
    const requestedPage = typeof request.page === 'number' && request.page > 0 ? request.page : 1;
    const rawStatus = request.statusFilter ?? 'Active';
    const statusFilter: 'all' | 'Active' | 'Former' | 'Prospective' = rawStatus === 'all' ? 'all' : (['Active', 'Former', 'Prospective'].includes(rawStatus) ? rawStatus : 'Active');
    const searchTerm = (request.searchTerm ?? '').trim();

    const applyFilters = <T>(query: T) => {
      let builder: any = query;
      if (statusFilter !== 'all') {
        builder = builder.eq('status', statusFilter);
      }
      if (searchTerm) {
        const searchPattern = `%${searchTerm}%`;
        builder = builder.or(
          [
            `first_name.ilike.${searchPattern}`,
            `last_name.ilike.${searchPattern}`,
            `email_address.ilike.${searchPattern}`,
            `job_title.ilike.${searchPattern}`,
            `mobile_number.ilike.${searchPattern}`,
            `phone_number.ilike.${searchPattern}`,
            `post_code.ilike.${searchPattern}`
          ].join(',')
        );
      }
      return builder;
    };

    const [allCountRes, activeCountRes, formerCountRes, prospectiveCountRes] = await Promise.all([
      adminClient.from('employees').select('*', { count: 'exact', head: true }),
      adminClient.from('employees').select('*', { count: 'exact', head: true }).eq('status', 'Active'),
      adminClient.from('employees').select('*', { count: 'exact', head: true }).eq('status', 'Former'),
      adminClient.from('employees').select('*', { count: 'exact', head: true }).eq('status', 'Prospective')
    ]);

    if (allCountRes.error || activeCountRes.error || formerCountRes.error || prospectiveCountRes.error) {
      throw allCountRes.error || activeCountRes.error || formerCountRes.error || prospectiveCountRes.error;
    }

    const { count, error: countError } = await applyFilters(
      adminClient.from('employees').select('*', { count: 'exact', head: true })
    );

    if (countError) {
      throw countError;
    }

    const totalCount = count ?? 0;
    const totalPages = totalCount === 0 ? 0 : Math.ceil(totalCount / pageSize);
    const currentPage = totalPages === 0 ? 1 : Math.min(requestedPage, totalPages);

    const from = (currentPage - 1) * pageSize;
    const to = from + pageSize - 1;

    const { data, error: dataError } = await applyFilters(
      adminClient
        .from('employees')
        .select('*')
        .order('employment_start_date', { ascending: true })
        .range(from, to)
    );

    if (dataError) {
      throw dataError;
    }

    return {
      employees: (data ?? []) as Employee[],
      pagination: {
        page: currentPage,
        pageSize,
        totalCount,
        totalPages
      },
      statusCounts: {
        all: allCountRes.count ?? 0,
        active: activeCountRes.count ?? 0,
        former: formerCountRes.count ?? 0,
        prospective: prospectiveCountRes.count ?? 0
      },
      filters: {
        statusFilter,
        searchTerm
      }
    };
  }

  static async exportEmployeesData(options: ExportOptions): Promise<Employee[]> {
    const adminClient = createAdminClient();
    
    let query = adminClient.from('employees').select('*').order('last_name').order('first_name');
    
    if (options.statusFilter && options.statusFilter !== 'all') {
      query = query.eq('status', options.statusFilter);
    }

    const { data: employees, error } = await query;

    if (error) {
      throw new Error('Failed to fetch employees for export');
    }
    return (employees ?? []) as Employee[];
  }

  static generateCSV(employees: Employee[], includeFields?: string[]): string {
    const defaultFields = [
      'employee_id', 'first_name', 'last_name', 'email_address', 'job_title',
      'phone_number', 'mobile_number', 'post_code',
      'employment_start_date', 'first_shift_date', 'employment_end_date', 'status',
      'date_of_birth', 'address', 'uniform_preference', 'keyholder_status'
    ];

    const fields = includeFields && includeFields.length > 0 ? includeFields : defaultFields;
    
    const headers = fields.map(field => {
      return field
        .split('_')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
    });
    
    const csvRows = [headers.join(',')];

    for (const employee of employees) {
      const values = fields.map(field => {
        const value = (employee as any)[field];
        
        if (value === null || value === undefined) {
          return '';
        }
        
        if (field.includes('date') && value) {
          return new Date(value).toLocaleDateString('en-GB');
        }
        
        if (typeof value === 'string') {
          if (value.includes(',') || value.includes('"') || value.includes('\n')) {
            return `"${value.replace(/"/g, '""')}"`;
          }
          return value;
        }
        
        return String(value);
      });
      csvRows.push(values.join(','));
    }
    return csvRows.join('\n');
  }

  static generateJSON(employees: Employee[], includeFields?: string[]): string {
    if (!includeFields || includeFields.length === 0) {
      const sanitized = employees.map(emp => {
        const { created_at: _, ...rest } = emp;
        return rest;
      });
      return JSON.stringify(sanitized, null, 2);
    }

    const filtered = employees.map(emp => {
      const filtered: any = {};
      for (const field of includeFields) {
        if (field in emp) {
          filtered[field] = (emp as any)[field];
        }
      }
      return filtered;
    });
    return JSON.stringify(filtered, null, 2);
  }
}
