import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { fetchAllRows } from '@/lib/supabase/paged-read';
import { normalizePersonName } from '@/lib/names';
import { isSigningOwnedChecklistField } from '@/lib/employees/checklist-rules';
import { z } from 'zod';
import { formatDateInLondon, getTodayIsoDate } from '@/lib/dateUtils';
import { countAllowanceDays, getHolidayYear, getHolidayYearBounds } from '@/lib/leave/working-days';
import { consumesAllowance, getAllowanceConsumingTypes } from '@/lib/leave/leave-types';
import { formatPhoneForStorage } from '@/lib/utils';
import { displayName } from '@/lib/employees/display-name';
import {
  ACCOUNT_NUMBER_MESSAGE,
  ACCOUNT_NUMBER_PATTERN,
  NI_NUMBER_MESSAGE,
  NI_NUMBER_PATTERN,
  SORT_CODE_MESSAGE,
  SORT_CODE_PATTERN,
  normaliseAccountNumber,
  normaliseNiNumber,
  normaliseSortCode,
} from '@/lib/employees/field-rules';
import {
  isAllowedAttachmentType,
  isAllowedRightToWorkType,
  isRightToWorkStoragePath,
  rightToWorkStoragePath,
  sanitiseStorageFileName,
} from '@/lib/employees/document-rules';
import { MAX_FILE_SIZE } from '@/lib/constants';
import { syncBirthdayCalendarEvent, deleteBirthdayCalendarEvent } from '@/lib/google-calendar-birthdays';
import type { AuditLogEntry } from '@/app/actions/employeeDetails';
import type { Employee, EmployeeAttachment, EmployeeFinancialDetails, EmployeeHealthRecord, EmployeeEmergencyContact, EmployeeRightToWork, AttachmentCategory, EmployeeNote, AuditLog } from '@/types/database';

type EmployeeStatus = 'all' | 'Active' | 'Former' | 'Onboarding' | 'Started Separation';

// The only employee columns the roster reads and sends to the browser: what the list shows, the
// name fallbacks, and the login link behind Send Portal Invite. The roster is a client component,
// so `select('*')` used to put every address, date of birth, phone number and post code into the
// page for anyone with employees:view. The search still matches phones and post codes, on the
// server, without selecting them.
const EMPLOYEE_ROSTER_COLUMNS =
  'employee_id, first_name, last_name, preferred_name, email_address, job_title, employment_start_date, status, auth_user_id';

export type EmployeeRosterEmployee = Pick<
  Employee,
  | 'employee_id'
  | 'first_name'
  | 'last_name'
  | 'preferred_name'
  | 'email_address'
  | 'job_title'
  | 'employment_start_date'
  | 'status'
  | 'auth_user_id'
> & {
  holiday_days_current_year: number;
};

export interface ExportOptions {
  format: 'csv' | 'json';
  includeFields?: string[];
  statusFilter?: EmployeeStatus;
  /** The roster's search box, so the file holds the people the list is showing. */
  searchTerm?: string;
}

// The only employee columns that may appear in an export file, in the order they
// are written. An allowlist rather than an exclusion list, so a column added to
// the table later cannot leak into the file just because nobody remembered it.
const EMPLOYEE_EXPORT_FIELDS: readonly string[] = [
  'employee_id', 'first_name', 'last_name', 'email_address', 'job_title',
  'phone_number', 'mobile_number', 'post_code',
  'employment_start_date', 'first_shift_date', 'employment_end_date', 'status',
  'date_of_birth', 'address', 'uniform_preference', 'keyholder_status'
];

function resolveExportFields(includeFields?: string[]): string[] {
  if (!includeFields || includeFields.length === 0) {
    return [...EMPLOYEE_EXPORT_FIELDS];
  }
  // A caller-supplied field list is still held to the allowlist: it arrives from
  // the export dialog and must not be able to name a column such as the PIN hash.
  const allowed = includeFields.filter((field) => EMPLOYEE_EXPORT_FIELDS.includes(field));
  return allowed.length > 0 ? allowed : [...EMPLOYEE_EXPORT_FIELDS];
}

export interface EmployeeNoteWithAuthor extends EmployeeNote {
  author_name: string;
}

// A phone number in international form: "+" followed only by digits and spaces. It cannot be a
// formula, so the guard below lets it through; before, every mobile exported as '+44... with a
// stray apostrophe. "+SUM(A1)" and anything else after the "+" is still guarded.
const PLAIN_INTERNATIONAL_PHONE = /^\+[\d ]+$/;

function escapeCsvCell(rawValue: string): string {
  const isFormulaLike = /^[=+\-@\t\r\n]/.test(rawValue) && !PLAIN_INTERNATIONAL_PHONE.test(rawValue);
  const safeValue = isFormulaLike ? `'${rawValue}` : rawValue;
  if (safeValue.includes(',') || safeValue.includes('"') || safeValue.includes('\n') || safeValue.includes('\r')) {
    return `"${safeValue.replace(/"/g, '""')}"`;
  }
  return safeValue;
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
  /**
   * Answers the starter gave during onboarding that leave no other record: whether they had time
   * off already booked ('none' or 'has_dates'), and when they were told about the right to work
   * check. Null when they never answered.
   */
  onboardingAnswers: {
    bookedTimeOff: { answer: string; answeredAt: string } | null;
    rightToWorkNotice: { answeredAt: string } | null;
  };
  /**
   * The sections that could not be loaded, each with a message to show on its tab. A failed read
   * used to come back as no row or an empty list, which the page then showed as a real answer
   * ("Has allergies? No") or as a missing-details warning.
   */
  loadErrors: Partial<Record<
    'financial' | 'health' | 'notes' | 'attachments' | 'emergencyContacts' | 'rightToWork' | 'auditLogs' | 'onboardingAnswers',
    string
  >>;
}

export interface EmployeeEditData {
  employee: Employee;
  financialDetails: EmployeeFinancialDetails | null;
  healthRecord: EmployeeHealthRecord | null;
  rightToWork: EmployeeRightToWork | null;
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

/**
 * What closing a starter's open onboarding links did when they were made Active by hand: how many
 * closed, or that the write failed. null when the status did not go from Onboarding to Active.
 */
type OnboardingLinksClosed = { closed: number } | { failed: true } | null;

const phoneNumberSchema = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
  z.union([
    z.string().transform((value, ctx) => {
      try {
        return formatPhoneForStorage(value);
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Invalid phone number format',
        });
        return z.NEVER;
      }
    }),
    z.null(),
  ])
);

/**
 * A refusal the person saving should read as written: a status change the edit form may not
 * make, a delete that is not allowed, a contact that is not this employee's. The actions show
 * its message as it is; any other error is a fault and gets a generic message instead.
 */
export class EmployeeServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmployeeServiceError';
  }
}

export const employeeSchema = z.object({
  first_name: z.string().min(1, 'First name is required'),
  last_name: z.string().min(1, 'Last name is required'),
  // Lower-cased like the invite path does it, so "Sam@Example.com" and "sam@example.com" are
  // one address to the login, the invite links and the unique index.
  email_address: z.string().trim().toLowerCase().email('Invalid email address'),
  job_title: z.string().min(1, 'Job title is required'),
  employment_start_date: z.string().min(1, 'Start date is required'),
  status: z.enum(['Onboarding', 'Active', 'Former', 'Started Separation']),
  date_of_birth: z.union([z.string().min(1), z.null()]).optional(),
  address: z.union([z.string().min(1), z.null()]).optional(),
  post_code: z.union([z.string().min(1), z.null()]).optional(),
  phone_number: phoneNumberSchema.optional(),
  mobile_number: phoneNumberSchema.optional(),
  first_shift_date: z.union([z.string().min(1), z.null()]).optional(),
  uniform_preference: z.union([z.string().min(1), z.null()]).optional(),
  keyholder_status: z.union([z.boolean(), z.null()]).optional(),
  employment_end_date: z.union([z.string().min(1), z.null()]).optional(),
});

const OPERATIONALLY_ACTIVE_EMPLOYEE_STATUSES = ['Active', 'Started Separation'] as const;

function isOperationallyActiveStatus(status: string | null | undefined): boolean {
  return OPERATIONALLY_ACTIVE_EMPLOYEE_STATUSES.includes(status as (typeof OPERATIONALLY_ACTIVE_EMPLOYEE_STATUSES)[number]);
}

// The author is not part of the form: the action sets it from the signed-in user, so a note
// cannot be posted under somebody else's name. Trimmed, so a note of only spaces is refused.
export const noteSchema = z.object({
    note_text: z.string().trim().min(1, 'Note text cannot be empty.'),
    employee_id: z.string().uuid(),
});

const ATTACHMENT_BUCKET_NAME = 'employee-attachments'; // Moved here for service scope

// Columns on `employees` that must never leave the server. The timeclock PIN hash
// is a credential, and `select('*')` hands it to every caller, so it has been
// reaching the browser on the roster and the JSON export file.
const SERVER_ONLY_EMPLOYEE_FIELDS = ['timeclock_pin_hash'] as const;

function stripServerOnlyEmployeeFields<T extends object>(row: T): T {
  const safeRow = { ...row } as Record<string, unknown>;
  for (const field of SERVER_ONLY_EMPLOYEE_FIELDS) {
    delete safeRow[field];
  }
  return safeRow as T;
}

function sanitizeEmployeeSearchTerm(value: string): string {
  return value
    .replace(/[,%_()"'\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

/**
 * The status tab and search box filters, shared by the roster and the export so the file holds
 * exactly the people the list is showing. "Active" includes staff on notice, who are still working.
 */
function applyEmployeeListFilters<T>(query: T, statusFilter: EmployeeStatus, searchTerm: string) {
  // any: a PostgREST builder changes type with every filter, and this takes several shapes of it.
  let builder: any = query;
  if (statusFilter !== 'all') {
    if (statusFilter === 'Active') {
      builder = builder.in('status', ['Active', 'Started Separation']);
    } else {
      builder = builder.eq('status', statusFilter);
    }
  }
  if (searchTerm) {
    const searchPattern = `%${searchTerm}%`;
    builder = builder.or(
      [
        `first_name.ilike.${searchPattern}`,
        `last_name.ilike.${searchPattern}`,
        // The roster shows the preferred name, so searching it has to work:
        // without this, looking up "Mandy" finds nobody.
        `preferred_name.ilike.${searchPattern}`,
        `email_address.ilike.${searchPattern}`,
        `job_title.ilike.${searchPattern}`,
        `mobile_number.ilike.${searchPattern}`,
        `phone_number.ilike.${searchPattern}`,
        `post_code.ilike.${searchPattern}`
      ].join(',')
    );
  }
  return builder;
}

/**
 * The current holiday year's date bounds.
 *
 * This used to be the calendar year, while the Holidays tab on the employee record used the
 * configured holiday year. That was one of two reasons the same person could read 27 days on
 * the roster and 4 on their own record. Both now read the same window and count it the same
 * way, through countAllowanceDays.
 */
async function getCurrentHolidayYearDateRange(
  adminClient: ReturnType<typeof createAdminClient>,
): Promise<{ startDate: string; endDate: string }> {
  const [monthSetting, daySetting] = await Promise.all([
    adminClient.from('system_settings').select('value').eq('key', 'rota_holiday_year_start_month').maybeSingle(),
    adminClient.from('system_settings').select('value').eq('key', 'rota_holiday_year_start_day').maybeSingle(),
  ]);

  const readNumber = (row: { data: { value: unknown } | null }, fallback: number): number => {
    const wrapped = row.data?.value as { value?: unknown } | undefined;
    const value = Number(wrapped?.value);
    return Number.isFinite(value) ? value : fallback;
  };

  // Same defaults as getRotaSettings, kept here so the roster never fails on a missing row.
  const startMonth = readNumber(monthSetting, 4);
  const startDay = readNumber(daySetting, 6);

  const today = getTodayIsoDate();
  const holidayYear = getHolidayYear(today, startMonth, startDay);
  return getHolidayYearBounds(holidayYear, startMonth, startDay);
}

export const addAttachmentSchema = z.object({
  employee_id: z.string().uuid(),
  attachment_file: z.instanceof(File)
    .refine(file => file.size > 0, "A file is required.")
    .refine(file => file.size < MAX_FILE_SIZE, "File size must be less than 10MB.")
    .refine(
      file => isAllowedAttachmentType(file.type),
      "Invalid file type. Only PDF, JPG, PNG, TIFF, Word documents, and TXT files are allowed."
    ),
  category_id: z.string().uuid("A valid category must be selected."),
  description: z.string().optional(),
});

export const deleteAttachmentSchema = z.object({
    employee_id: z.string().uuid(),
    attachment_id: z.string().uuid(),
});

export const EmergencyContactSchema = z.object({
  employee_id: z.string().uuid(),
  name: z.string().trim().min(1, 'Name is required'),
  relationship: z.union([z.string().min(1), z.null()]).optional(),
  phone_number: phoneNumberSchema.optional(),
  mobile_number: phoneNumberSchema.optional(),
  priority: z.enum(['Primary', 'Secondary', 'Other']).optional(),
  address: z.union([z.string().min(1), z.null()]).optional(),
}).superRefine((contact, ctx) => {
  // The same rule as the new starter's own form: the first person we would ring in an
  // emergency must have a number we can ring.
  if (contact.priority === 'Primary' && !contact.phone_number && !contact.mobile_number) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['mobile_number'],
      message: 'A primary contact needs a telephone or mobile number.',
    });
  }
});

/**
 * A bank or NI field: blank is null, anything else is normalised exactly as the new starter's
 * own form does it (src/lib/employees/field-rules.ts) and then checked. A manager typing
 * "ab 12 34 56 c" stores "AB123456C", which every later save accepts.
 */
function normalisedFinancialField(normalise: (value: string) => string, pattern: RegExp, message: string) {
  return z.preprocess(
    (value) => {
      if (typeof value !== 'string') return value;
      const trimmed = value.trim();
      return trimmed === '' ? null : normalise(trimmed);
    },
    z.union([z.string().regex(pattern, message), z.null()])
  ).optional();
}

export const FinancialDetailsSchema = z.object({
  employee_id: z.string().uuid(),
  ni_number: normalisedFinancialField(normaliseNiNumber, NI_NUMBER_PATTERN, NI_NUMBER_MESSAGE),
  bank_account_number: normalisedFinancialField(normaliseAccountNumber, ACCOUNT_NUMBER_PATTERN, ACCOUNT_NUMBER_MESSAGE),
  bank_sort_code: normalisedFinancialField(normaliseSortCode, SORT_CODE_PATTERN, SORT_CODE_MESSAGE),
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
  // No verified_by_user_id: who verified is set on the server, from the signed-in user, and only
  // when the check itself changes (see EmployeeService.upsertRightToWork).
  document_photo: z.instanceof(File)
    .refine(file => file.size > 0, "File is empty")
    .refine(file => file.size < MAX_FILE_SIZE, "File size must be less than 10MB")
    .refine(file => isAllowedRightToWorkType(file.type), "Only JPG, PNG, and PDF files are allowed")
    .optional(),
});

export const ONBOARDING_CHECKLIST_FIELDS = [
  'private_whatsapp_added', 'team_whatsapp_added', 'till_system_setup',
  'training_flow_setup', 'employee_agreement_accepted'
] as const;

export type OnboardingChecklistField = typeof ONBOARDING_CHECKLIST_FIELDS[number];

export const ONBOARDING_FIELD_CONFIG: Record<OnboardingChecklistField, { label: string; dateField: string }> = {
  private_whatsapp_added: { label: 'Added to Private WhatsApp', dateField: 'private_whatsapp_date' },
  team_whatsapp_added: { label: 'Added to Team WhatsApp', dateField: 'team_whatsapp_date' },
  till_system_setup: { label: 'Till System Setup', dateField: 'till_system_date' },
  training_flow_setup: { label: 'Training in Flow Setup', dateField: 'training_flow_date' },
  employee_agreement_accepted: { label: 'Employee Agreement Accepted', dateField: 'employee_agreement_accepted_date' }
};

/** Columns the staff edit writes with the main update that employeeSchema does not carry. */
export type EmployeeUpdateExtras = {
  preferred_name?: string | null;
  timeclock_pin_hash?: string;
  timeclock_pin_updated_at?: string;
};

/**
 * Why the staff edit form may not make this status change, or null when it may.
 *
 * The form makes one status change itself: Onboarding to Active. Every other move has its own
 * action, because each does more than change a column. Begin Separation sets the last day and
 * settles the remaining shifts, Cancel Separation clears them again, and Mark as Former takes
 * the login away. Changing the column alone skipped all of that, and Started Separation to
 * Active then failed on employees_separation_shift_policy_check with "Invalid data provided".
 */
function staffEditStatusRefusal(from: string, to: string): string | null {
  if (from === to) return null;
  if (from === 'Onboarding' && to === 'Active') return null;
  if (to === 'Former') {
    return 'Use the "Mark as Former" action to separate an employee so access is revoked correctly.';
  }
  if (from === 'Former') {
    return 'Former employees cannot be reactivated from the edit form. Create a controlled rehire flow first.';
  }
  if (to === 'Started Separation') {
    return 'Use Begin Separation on the employee page to start a separation, so their last day and remaining shifts are settled.';
  }
  if (from === 'Started Separation') {
    return 'This employee is part-way through a separation. Use Cancel Separation on the employee page to bring them back to Active.';
  }
  return 'An employee who has started work cannot be moved back to Onboarding.';
}

/** A date or text column compared as stored: blank and missing are both null, and a date is its YYYY-MM-DD. */
function storedValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (text === '') return null;
  return /^\d{4}-\d{2}-\d{2}T/.test(text) ? text.split('T')[0] : text;
}

/** The parts of a right to work record that are the check itself. Changing any of them is a new check. */
const RIGHT_TO_WORK_VERIFICATION_FIELDS = [
  'document_type', 'check_method', 'document_reference', 'verification_date', 'document_expiry_date'
] as const;


export type CreateEmployeeInput = {
  first_name: string;
  last_name: string;
  email_address: string;
  job_title: string;
  employment_start_date: string;
  status: 'Onboarding' | 'Active' | 'Former' | 'Started Separation';
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
      first_name: normalizePersonName(input.first_name),
      last_name: normalizePersonName(input.last_name),
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

  static async updateEmployee(
    employeeId: string,
    updateData: z.infer<typeof employeeSchema>,
    // The preferred name and the PIN hash go in the same write as everything else. They used to
    // be separate writes after it, so a failure there reported the whole save as failed when
    // the main change had already gone through.
    extras: EmployeeUpdateExtras = {}
  ) {
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

    const statusRefusal = staffEditStatusRefusal(oldEmployee.status, updateData.status);
    if (statusRefusal) {
      throw new EmployeeServiceError(statusRefusal);
    }

    // While someone is working their notice, the last day belongs to the separation: it decides
    // which shifts and leave are settled. Editing it here moved the date without any of that.
    if (oldEmployee.status === 'Started Separation' && updateData.employment_end_date !== undefined
      && storedValue(updateData.employment_end_date) !== storedValue(oldEmployee.employment_end_date)) {
      throw new EmployeeServiceError(
        'Their last day is set by the separation, so it cannot be changed here. Use Cancel Separation on the employee page, then Begin Separation again with the new date.'
      );
    }

    const normalizedUpdate = {
      ...updateData,
      ...extras,
      first_name: normalizePersonName(updateData.first_name),
      last_name: normalizePersonName(updateData.last_name),
    }

    const { data: updatedEmployee, error } = await adminClient
      .from('employees')
      .update(normalizedUpdate)
      .eq('employee_id', employeeId)
      .select('*')
      .maybeSingle();

    if (error) {
      console.error('Update employee error:', error);
      throw error;
    }

    if (!updatedEmployee) {
      throw new Error('Employee not found or failed to update.');
    }

    // A starter made Active by hand still held an open onboarding link. It stops working once
    // the status moves on (validateInviteToken checks), but the chaser cron reads open links and
    // kept emailing someone already working here. Closed after the update, so a failure here
    // never undoes the activation: it is reported to the action instead. The count says whether
    // there was a link at all, so a starter added by staff and never invited is not told one closed.
    let onboardingLinks: OnboardingLinksClosed = null;
    if (oldEmployee.status === 'Onboarding' && updatedEmployee.status === 'Active') {
      const nowIso = new Date().toISOString();
      const { data: closedLinks, error: inviteError } = await adminClient
        .from('employee_invite_tokens')
        .update({ expires_at: nowIso })
        .eq('employee_id', employeeId)
        .eq('invite_type', 'onboarding')
        .is('completed_at', null)
        .gt('expires_at', nowIso)
        .select('id');

      if (inviteError) {
        console.error('[EmployeeService] Failed to expire onboarding invite links on activation:', inviteError);
        onboardingLinks = { failed: true };
      } else {
        onboardingLinks = { closed: (closedLinks ?? []).length };
      }
    }

    // Keep Google Calendar birthday event in sync (best-effort).
    const wasEligibleForBirthdayEvent = isOperationallyActiveStatus(oldEmployee.status) && Boolean(oldEmployee.date_of_birth);
    const isEligibleForBirthdayEvent = isOperationallyActiveStatus(updateData.status) && Boolean(updateData.date_of_birth);

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
          ...normalizedUpdate,
          employee_id: employeeId
        });
      } catch (calendarError) {
        console.error('Failed to update birthday calendar event:', calendarError);
      }
    }
    
    // Callers feed both of these straight into the audit log, so the PIN hash is
    // stripped here rather than relying on every caller to remember.
    return {
      updatedEmployee: stripServerOnlyEmployeeFields(updatedEmployee),
      oldEmployee: stripServerOnlyEmployeeFields(oldEmployee),
      onboardingLinks,
    };
  }

  /**
   * Remove every file stored for an employee. Attachments and right-to-work
   * documents are both written under an `<employee_id>/` prefix, so listing that
   * prefix covers both. Best-effort and paged: storage list() caps each page, and
   * a failure here must not resurrect an employee row that is already gone.
   */
  private static async deleteEmployeeStorageFiles(
    adminClient: ReturnType<typeof createAdminClient>,
    employeeId: string
  ): Promise<void> {
    const pageSize = 100;
    // Deleted objects drop out of the listing, so each pass re-reads from the
    // start. The cap only exists so an unexpected undeletable entry (a nested
    // folder, say) cannot spin here forever.
    const maxPasses = 50;

    for (let pass = 0; pass < maxPasses; pass++) {
      const { data: entries, error: listError } = await adminClient.storage
        .from(ATTACHMENT_BUCKET_NAME)
        .list(employeeId, { limit: pageSize });

      if (listError) {
        console.error(`Failed to list stored files for employee '${employeeId}'. Manual cleanup may be needed.`, listError);
        return;
      }

      // Entries with no id are folder placeholders, which remove() cannot delete.
      const paths = (entries ?? [])
        .filter((entry) => entry.id && entry.name)
        .map((entry) => `${employeeId}/${entry.name}`);

      if (paths.length === 0) {
        return;
      }

      const { error: removeError } = await adminClient.storage
        .from(ATTACHMENT_BUCKET_NAME)
        .remove(paths);

      if (removeError) {
        console.error(`Failed to delete stored files for employee '${employeeId}'. Manual cleanup may be needed.`, removeError);
        return;
      }

      if (paths.length < pageSize) {
        return;
      }
    }

    console.warn(`Stopped clearing storage for employee '${employeeId}' after ${maxPasses} passes. Manual cleanup may be needed.`);
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

    // Deleting the row cascades away shifts, clock history, leave and pay (owner decision,
    // 2 November 2026). That is only right for a starter who never started; anyone who has
    // worked here leaves through the separation flow, which keeps their history.
    if (employee.status !== 'Onboarding') {
      throw new EmployeeServiceError(
        'Only a new starter who is still onboarding can be deleted. For anyone who has worked here, use Begin Separation so their shifts, hours and pay history are kept.'
      );
    }

    // Records that stop the row being deleted, checked before any access is touched. Without
    // this the login went first and the delete then failed on a checklist reference, leaving
    // the person on the books with no way in.
    const blockers = await EmployeeService.findEmployeeDeleteBlockers(adminClient, employeeId);
    if (blockers === null) {
      throw new EmployeeServiceError('Could not check what else refers to this employee, so nothing was deleted. Please try again.');
    }
    if (blockers.length > 0) {
      throw new EmployeeServiceError(
        `This employee cannot be deleted because other records refer to them (${blockers.join(', ')}). Nothing was changed.`
      );
    }

    // Deleting the employees row leaves the linked auth account and its user_roles grants
    // untouched, so a deleted employee kept a working login with every permission they had.
    // Roles come off first, because losing them is the hard security prerequisite, and are put
    // back if the row then cannot be deleted. The login itself is only removed once the row
    // is certainly gone.
    const authUserId = employee.auth_user_id as string | null;
    let removedRoles: Array<{ user_id: string; role_id: string; assigned_at: string | null; assigned_by: string | null }> = [];
    if (authUserId) {
      const { data: roles, error: rolesReadError } = await adminClient
        .from('user_roles')
        .select('user_id, role_id, assigned_at, assigned_by')
        .eq('user_id', authUserId);

      if (rolesReadError) {
        console.error('[EmployeeService] Failed to read roles before delete:', rolesReadError);
        throw new EmployeeServiceError('Could not read this employee\'s system access, so nothing was deleted. Please try again.');
      }

      removedRoles = roles ?? [];
      if (removedRoles.length > 0) {
        const { error: rolesError } = await adminClient
          .from('user_roles')
          .delete()
          .eq('user_id', authUserId);

        if (rolesError) {
          console.error('[EmployeeService] CRITICAL: Failed to remove roles before delete:', rolesError);
          throw new EmployeeServiceError('Failed to remove system access, so the employee was not deleted. Please try again.');
        }
      }
    }

    // The Onboarding rule is applied in the delete itself too: the status read above is earlier,
    // and someone made Active in between must not be deleted with their shifts and pay.
    const { data: deletedEmployee, error } = await adminClient
      .from('employees')
      .delete()
      .eq('employee_id', employeeId)
      .eq('status', 'Onboarding')
      .select('*')
      .maybeSingle();

    if (error || !deletedEmployee) {
      // The record is still there: give their access back.
      if (removedRoles.length > 0) {
        const { error: restoreError } = await adminClient.from('user_roles').insert(removedRoles);
        if (restoreError) {
          console.error('[EmployeeService] CRITICAL: Employee delete failed and their roles could not be restored:', restoreError);
        }
      }
      if (error) {
        console.error('Delete employee error:', error);
        throw error;
      }
      throw new EmployeeServiceError(
        'This employee is no longer onboarding, so they were not deleted. Refresh the page to see their current status.'
      );
    }

    let loginRemoved = true;
    if (authUserId) {
      const { error: authDeleteError } = await adminClient.auth.admin.deleteUser(authUserId);
      if (authDeleteError) {
        // Their roles are already gone, so the login opens nothing; it still needs removing.
        console.error('[EmployeeService] CRITICAL: Employee deleted but their login could not be removed:', authDeleteError);
        loginRemoved = false;
      }
    }

    // Deleting the employees row cascades to employee_attachments and
    // employee_right_to_work, but the files themselves live in storage and were
    // being left behind forever. Runs after the row delete so a storage failure
    // cannot strand a half-deleted employee.
    await EmployeeService.deleteEmployeeStorageFiles(adminClient, employeeId);

    // Delete birthday calendar events if employee had a date of birth
    if (employee?.date_of_birth) {
        try {
            await deleteBirthdayCalendarEvent(employeeId);
        } catch (error) {
            console.error('Failed to delete birthday from calendar:', error);
            // Don't fail the employee deletion if calendar sync fails
        }
    }

    // Returned for audit logging, so the PIN hash must not travel with it.
    return { deletedEmployee: stripServerOnlyEmployeeFields(deletedEmployee), loginRemoved };
  }

  /**
   * What stops an employees row being deleted: the references declared ON DELETE RESTRICT or
   * with no rule (checklists, and recruitment's candidate, slot and appointment links). Every
   * other reference cascades or is set to null. Returns what to name in the refusal, or null
   * when the check itself failed, so the caller refuses rather than guesses.
   */
  private static async findEmployeeDeleteBlockers(
    adminClient: ReturnType<typeof createAdminClient>,
    employeeId: string
  ): Promise<string[] | null> {
    const checks: Array<{ label: string; result: PromiseLike<{ count: number | null; error: unknown }> }> = [
      { label: 'checklist tasks', result: adminClient.from('checklist_task_instances').select('id', { count: 'exact', head: true }).eq('accountable_employee_id', employeeId) },
      { label: 'checklist tasks', result: adminClient.from('checklist_task_instances').select('id', { count: 'exact', head: true }).eq('completed_by_employee_id', employeeId) },
      { label: 'checklist spot checks', result: adminClient.from('checklist_spot_checks').select('id', { count: 'exact', head: true }).eq('checked_employee_id', employeeId) },
      { label: 'checklist to-dos', result: adminClient.from('checklist_todos').select('id', { count: 'exact', head: true }).eq('assigned_employee_id', employeeId) },
      { label: 'checklist to-dos', result: adminClient.from('checklist_todos').select('id', { count: 'exact', head: true }).eq('completed_by_employee_id', employeeId) },
      { label: 'their recruitment application', result: adminClient.from('recruitment_candidates').select('id', { count: 'exact', head: true }).eq('converted_employee_id', employeeId) },
      { label: 'recruitment interview slots', result: adminClient.from('recruitment_appointment_slots').select('id', { count: 'exact', head: true }).eq('supervisor_staff_id', employeeId) },
      { label: 'recruitment appointments', result: adminClient.from('recruitment_candidate_appointments').select('id', { count: 'exact', head: true }).eq('supervisor_staff_id', employeeId) },
    ];

    const results = await Promise.all(checks.map((check) => check.result));
    const blockers = new Set<string>();
    for (const [index, { count, error }] of results.entries()) {
      if (error) {
        console.error(`[EmployeeService] Delete pre-check failed (${checks[index].label}):`, error);
        return null;
      }
      if ((count ?? 0) > 0) blockers.add(checks[index].label);
    }
    return [...blockers];
  }

  static async getEmployeeList(): Promise<{ id: string; name: string; }[] | null> {
    const adminClient = createAdminClient();

    const { data, error } = await adminClient
      .from('employees')
      .select('employee_id, first_name, last_name, preferred_name')
      .in('status', OPERATIONALLY_ACTIVE_EMPLOYEE_STATUSES)  // Show currently employable staff in dropdowns
      .order('last_name')
      .order('first_name');

    if (error) {
      console.error('Error fetching employee list:', error);
      throw new Error('Failed to fetch employee list');
    }

    // Staff-facing dropdowns, so show the name the team uses.
    return data.map(emp => ({ id: emp.employee_id, name: displayName(emp) }));
  }

  static async addEmployeeNote(noteData: z.infer<typeof noteSchema> & { created_by_user_id: string | null }) {
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

    const uniqueFileName = `${employeeId}/${Date.now()}_${sanitiseStorageFileName(attachmentFile.name, 'unnamed_file')}`;
    
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
    } catch (dbInsertError: unknown) {
      console.error('Database insert failed after file upload. Initiating cleanup.', dbInsertError);
      const { error: removeError } = await adminClient.storage.from(ATTACHMENT_BUCKET_NAME).remove([storagePath]);

      if (removeError) {
        console.error(`CRITICAL ALERT: Failed to remove orphaned file '${storagePath}'. Manual cleanup required.`, removeError);
      } else {
        console.warn(`Orphaned file '${storagePath}' successfully removed.`);
      }
      throw new Error(`Failed to save attachment details to the database: ${dbInsertError instanceof Error ? dbInsertError.message : 'Unknown error'}`);
    }
  }

  /**
   * `downloadName` makes the link a download saved under that name. The browser ignores an
   * <a download> on a link to another origin, which a signed storage URL always is, so the
   * file name has to come from storage's own Content-Disposition.
   */
  static async getAttachmentSignedUrl(storagePath: string, downloadName?: string): Promise<string | null> {
    const adminClient = createAdminClient();

    const { data, error } = await adminClient.storage
      .from(ATTACHMENT_BUCKET_NAME)
      .createSignedUrl(storagePath, 60 * 5, downloadName ? { download: downloadName } : undefined); // URL valid for 5 minutes

    if (error) {
      console.error('Error creating signed URL:', error);
      throw new Error(error.message);
    }
    return data.signedUrl;
  }

  static async deleteEmployeeAttachment(attachmentId: string, employeeId: string) {
    const adminClient = createAdminClient();

    const { data: attachment, error: fetchError } = await adminClient
      .from('employee_attachments')
      .select('file_name, storage_path')
      .eq('attachment_id', attachmentId)
      .eq('employee_id', employeeId)
      .single();
    
    if (fetchError || !attachment) {
      throw new Error('Attachment not found');
    }

    if (!attachment.storage_path) {
      throw new Error('Attachment storage path is missing.');
    }

    // Delete DB record first: if this fails, storage file is still referenced (safe to retry)
    const { error: dbError } = await adminClient.from('employee_attachments').delete().eq('attachment_id', attachmentId);
    if (dbError) {
      console.error('Error deleting attachment metadata:', dbError);
      throw new Error('Failed to delete attachment record.');
    }

    // Delete storage file: if this fails, orphan file is harmless (no DB reference)
    const { error: storageError } = await adminClient.storage
      .from(ATTACHMENT_BUCKET_NAME)
      .remove([attachment.storage_path]);

    if (storageError) {
      console.warn(`Failed to delete storage file '${attachment.storage_path}' after DB record removed. Manual cleanup may be needed.`, storageError);
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

  // Both scoped to the employee as well as the contact id, and both check a row was changed: a
  // contact id from one employee's page cannot edit or remove another employee's contact, and
  // a save that matched nothing is not reported as done.
  static async updateEmergencyContact(contactId: string, updates: Omit<z.infer<typeof EmergencyContactSchema>, 'employee_id'> & { employee_id: string }) {
    const adminClient = createAdminClient();
    const { employee_id: employeeId, ...contactUpdates } = updates;
    const { data, error } = await adminClient
      .from('employee_emergency_contacts')
      .update(contactUpdates)
      .eq('id', contactId)
      .eq('employee_id', employeeId)
      .select('id');
    if (error) {
      console.error('Error updating emergency contact:', error);
      throw error;
    }
    if (!data || data.length === 0) {
      throw new EmployeeServiceError('That emergency contact was not found for this employee. Refresh the page and try again.');
    }
  }

  static async deleteEmergencyContact(contactId: string, employeeId: string) {
    const adminClient = createAdminClient();
    const { data, error } = await adminClient
      .from('employee_emergency_contacts')
      .delete()
      .eq('id', contactId)
      .eq('employee_id', employeeId)
      .select('id');
    if (error) {
      console.error('Error deleting emergency contact:', error);
      throw error;
    }
    if (!data || data.length === 0) {
      throw new EmployeeServiceError('That emergency contact was not found for this employee. Refresh the page and try again.');
    }
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

    // The browser hands over the path it uploaded to, so it must be one this employee's right
    // to work upload could have made (not one of their other files) and the file must be there.
    if (photoStoragePathOverride && !isRightToWorkStoragePath(employeeId, photoStoragePathOverride)) {
      throw new EmployeeServiceError('Invalid photo storage path.');
    }

    if (photoStoragePathOverride) {
      const { data: uploaded } = await adminClient.storage
        .from(ATTACHMENT_BUCKET_NAME)
        .exists(photoStoragePathOverride);
      if (uploaded !== true) {
        throw new EmployeeServiceError('The uploaded document could not be found, so nothing was saved. Please upload it again.');
      }
    }

    let photoStoragePath: string | null = null;
    const documentPhoto = rtwData.document_photo;

    const shouldUploadNewPhoto = Boolean(documentPhoto && documentPhoto.size > 0);
    const shouldUseOverridePhotoPath = Boolean(photoStoragePathOverride);

    const { data: existingRecord, error: existingError } = await adminClient
      .from('employee_right_to_work')
      .select('photo_storage_path, verified_by_user_id, document_type, check_method, document_reference, verification_date, document_expiry_date')
      .eq('employee_id', employeeId)
      .maybeSingle();

    if (existingError) {
      console.error('Error loading right to work before save:', existingError);
      throw new Error('Failed to load the current right to work record.');
    }

    const existingPhotoPath: string | null = existingRecord?.photo_storage_path ?? null;

    // Who verified is whoever recorded the check. It was taken from the form and rewritten on
    // every save, so fixing a typo in the notes made the person fixing it the verifier. It now
    // changes only when the check itself does (or there was no record yet).
    const existingCheck = existingRecord as Record<string, unknown> | null;
    const checkChanged = !existingCheck || RIGHT_TO_WORK_VERIFICATION_FIELDS.some(
      (field) => storedValue(existingCheck[field]) !== storedValue(rtwData[field])
    );
    const verifiedByUserId = checkChanged ? currentUserId : (existingRecord?.verified_by_user_id ?? null);

    if (shouldUploadNewPhoto && documentPhoto) {
      // Upload new photo
      const uniqueFileName = rightToWorkStoragePath(employeeId, documentPhoto.name);

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
      verified_by_user_id: verifiedByUserId,
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

  /** As getAttachmentSignedUrl: `downloadName` makes the link a download saved under that name. */
  static async getRightToWorkPhotoUrl(photoPath: string, downloadName?: string): Promise<string | null> {
    const adminClient = createAdminClient();

    const { data, error } = await adminClient.storage
      .from(ATTACHMENT_BUCKET_NAME)
      .createSignedUrl(photoPath, 60 * 5, downloadName ? { download: downloadName } : undefined); // URL valid for 5 minutes

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

    const previousPhotoPath = rightToWork.photo_storage_path;

    // Clear DB reference first with an optimistic guard to avoid stale-worker overwrite.
    const { data: clearedRows, error: clearError } = await adminClient
      .from('employee_right_to_work')
      .update({ photo_storage_path: null })
      .eq('employee_id', employeeId)
      .eq('photo_storage_path', previousPhotoPath)
      .select('employee_id');

    if (clearError) {
      console.error('Error clearing right to work photo path:', clearError);
      throw new Error('Failed to update database record.');
    }

    if (!clearedRows || clearedRows.length === 0) {
      throw new Error('Right to work photo changed before deletion. Please refresh and try again.');
    }

    const { error: storageError } = await adminClient.storage
      .from(ATTACHMENT_BUCKET_NAME)
      .remove([previousPhotoPath]);

    if (storageError) {
      console.error('Error deleting right to work photo from storage:', storageError);

      const { error: rollbackError } = await adminClient
        .from('employee_right_to_work')
        .update({ photo_storage_path: previousPhotoPath })
        .eq('employee_id', employeeId)
        .is('photo_storage_path', null);

      if (rollbackError) {
        console.error('Failed to restore right to work photo path after storage delete failure:', rollbackError);
      }

      throw new Error('Failed to delete photo from storage.');
    }

    return { photoPath: previousPhotoPath };
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
    if (isSigningOwnedChecklistField(checklistField)) {
      throw new EmployeeServiceError(
        'The employee agreement is ticked when the employee signs it. Use Send for Signature on their page instead of ticking it by hand.'
      );
    }

    const checklistConfig = ONBOARDING_FIELD_CONFIG[checklistField];

    const updateData: any = { employee_id: employeeId };

    const isChecked = Boolean(checked);
    updateData[checklistField] = isChecked;

    const dateField = checklistConfig?.dateField;
    if (dateField) {
      updateData[dateField] = isChecked ? getTodayIsoDate() : null;
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
      auditLogsResult,
      onboardingAnswersResult
    ] = await Promise.all([
      supabase.from('employee_financial_details').select('*').eq('employee_id', employeeId).maybeSingle(),
      supabase.from('employee_health_records').select('*').eq('employee_id', employeeId).maybeSingle(),
      supabase.from('employee_notes').select('*').eq('employee_id', employeeId).order('created_at', { ascending: false }),
      supabase.from('employee_attachments').select('*').eq('employee_id', employeeId).order('uploaded_at', { ascending: false }),
      supabase.from('attachment_categories').select('*').order('category_name', { ascending: true }),
      supabase.from('employee_emergency_contacts').select('*').eq('employee_id', employeeId).order('created_at', { ascending: false }),
      supabase.from('employee_right_to_work').select('*').eq('employee_id', employeeId).maybeSingle(),
      // Limit raised from 50: checklist spot-check results also land on the employee audit
      // trail (decision 7), so a 50-row cap would bury real HR history within weeks once the
      // module is live. TODO(checklists Phase 3+): filter spot-check entries into their own
      // view / paginate so HR history and spot checks each stay legible.
      supabase.from('audit_logs').select('*').eq('resource_type', 'employee').eq('resource_id', employeeId).order('created_at', { ascending: false }).limit(200),
      supabase.from('employee_onboarding_responses').select('question, answer, answered_at').eq('employee_id', employeeId).in('question', ['booked_time_off', 'right_to_work_notice']),
    ]);

    if (financialResult.error) console.error('[EmployeeService] financial fetch failed', financialResult.error);
    if (healthResult.error) console.error('[EmployeeService] health fetch failed', healthResult.error);
    if (notesResult.error) console.error('[EmployeeService] notes fetch failed', notesResult.error);
    if (attachmentsResult.error) console.error('[EmployeeService] attachments fetch failed', attachmentsResult.error);
    if (attachmentCategoriesResult.error) console.error('[EmployeeService] categories fetch failed', attachmentCategoriesResult.error);
    if (emergencyContactsResult.error) console.error('[EmployeeService] contacts fetch failed', emergencyContactsResult.error);
    if (rightToWorkResult.error) console.error('[EmployeeService] right-to-work fetch failed', rightToWorkResult.error);
    if (auditLogsResult.error) console.error('[EmployeeService] audit logs fetch failed', auditLogsResult.error);
    if (onboardingAnswersResult.error) console.error('[EmployeeService] onboarding answers fetch failed', onboardingAnswersResult.error);

    // Each failed section is reported on its own tab, so the rest of the record still shows.
    const loadErrors: EmployeeDetailData['loadErrors'] = {};
    if (financialResult.error) loadErrors.financial = 'The financial details could not be loaded. Refresh the page to try again.';
    if (healthResult.error) loadErrors.health = 'The health record could not be loaded. Refresh the page to try again.';
    if (notesResult.error) loadErrors.notes = 'The notes could not be loaded. Refresh the page to try again.';
    if (attachmentsResult.error || attachmentCategoriesResult.error) loadErrors.attachments = 'The documents could not be loaded. Refresh the page to try again.';
    if (emergencyContactsResult.error) loadErrors.emergencyContacts = 'The emergency contacts could not be loaded. Refresh the page to try again.';
    if (rightToWorkResult.error) loadErrors.rightToWork = 'The right to work record could not be loaded. Refresh the page to try again.';
    if (auditLogsResult.error) loadErrors.auditLogs = 'The audit trail could not be loaded. Refresh the page to try again.';
    if (onboardingAnswersResult.error) loadErrors.onboardingAnswers = 'The onboarding answers could not be loaded. Refresh the page to try again.';

    const answers = onboardingAnswersResult.data ?? [];
    const bookedTimeOff = answers.find((row) => row.question === 'booked_time_off') ?? null;
    const rightToWorkNotice = answers.find((row) => row.question === 'right_to_work_notice') ?? null;

    const notes = await enrichNotesWithAuthors(notesResult.data ?? [], supabase);

    return {
      employee: stripServerOnlyEmployeeFields(employee),
      financialDetails: financialResult.data ?? null,
      healthRecord: healthResult.data ?? null,
      notes,
      attachments: attachmentsResult.data ?? [],
      attachmentCategories: attachmentCategoriesResult.data ?? [],
      emergencyContacts: emergencyContactsResult.data ?? [],
      rightToWork: rightToWorkResult.data ?? null,
      auditLogs: auditLogsResult.data ?? [],
      onboardingAnswers: {
        bookedTimeOff: bookedTimeOff ? { answer: bookedTimeOff.answer, answeredAt: bookedTimeOff.answered_at } : null,
        rightToWorkNotice: rightToWorkNotice ? { answeredAt: rightToWorkNotice.answered_at } : null,
      },
      loadErrors,
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
      healthResult,
      rightToWorkResult
    ] = await Promise.all([
      supabase.from('employee_financial_details').select('*').eq('employee_id', employeeId).maybeSingle(),
      supabase.from('employee_health_records').select('*').eq('employee_id', employeeId).maybeSingle(),
      supabase.from('employee_right_to_work').select('*').eq('employee_id', employeeId).maybeSingle()
    ]);

    if (financialResult.error) console.error('[EmployeeService] financial fetch failed for edit', financialResult.error);
    if (healthResult.error) console.error('[EmployeeService] health fetch failed for edit', healthResult.error);
    if (rightToWorkResult.error) console.error('[EmployeeService] right-to-work fetch failed for edit', rightToWorkResult.error);

    return {
      // The edit page hands this straight to EmployeeForm, a client component.
      employee: stripServerOnlyEmployeeFields(employee),
      financialDetails: financialResult.data ?? null,
      healthRecord: healthResult.data ?? null,
      rightToWork: rightToWorkResult.data ?? null
    };
  }

  static async getEmployeesRoster(
    request: {
      page?: number;
      pageSize?: number;
      searchTerm?: string;
      statusFilter?: 'all' | 'Active' | 'Former' | 'Onboarding' | 'Started Separation';
    } = {}
  ) {
    const adminClient = createAdminClient();

    const pageSize = typeof request.pageSize === 'number' && request.pageSize > 0 ? request.pageSize : 50;
    const requestedPage = typeof request.page === 'number' && request.page > 0 ? request.page : 1;
    const rawStatus = request.statusFilter ?? 'Active';
    const statusFilter: 'all' | 'Active' | 'Former' | 'Onboarding' | 'Started Separation' = rawStatus === 'all' ? 'all' : (['Active', 'Former', 'Onboarding', 'Started Separation'].includes(rawStatus) ? rawStatus as any : 'Active');
    const searchTerm = sanitizeEmployeeSearchTerm(request.searchTerm ?? '');

    const applyFilters = <T>(query: T) => applyEmployeeListFilters(query, statusFilter, searchTerm);

    // Single query to get all status counts in one round-trip, then derive tab counts in JS
    const { data: statusRows, error: statusCountError } = await adminClient
      .from('employees')
      .select('status');

    if (statusCountError) {
      throw statusCountError;
    }

    const statusMap = new Map<string, number>();
    let allCount = 0;
    for (const row of statusRows ?? []) {
      const s = (row.status as string) ?? '';
      statusMap.set(s, (statusMap.get(s) ?? 0) + 1);
      allCount += 1;
    }
    const activeCount = (statusMap.get('Active') ?? 0) + (statusMap.get('Started Separation') ?? 0);
    const formerCount = statusMap.get('Former') ?? 0;
    const onboardingCount = statusMap.get('Onboarding') ?? 0;

    // Filtered count for the selected tab + search term
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
        .select(EMPLOYEE_ROSTER_COLUMNS)
        .order('employment_start_date', { ascending: true })
        // Many people share a start date, and Postgres gives no fixed order among equals, so
        // without a tiebreak the same person could appear on two pages and someone else on none.
        .order('employee_id', { ascending: true })
        .range(from, to)
    );

    if (dataError) {
      throw dataError;
    }

    const employees = (data ?? []) as Omit<EmployeeRosterEmployee, 'holiday_days_current_year'>[];
    const employeeIds = employees.map((employee) => employee.employee_id);
    const holidayCounts = new Map<string, number>();

    if (employeeIds.length > 0) {
      const [{ startDate, endDate }, allowanceConsuming] = await Promise.all([
        getCurrentHolidayYearDateRange(adminClient),
        getAllowanceConsumingTypes(adminClient),
      ]);

      type RosterLeaveDay = {
        employee_id?: string | null;
        leave_date: string;
        leave_requests:
          | { status: string; leave_type: string | null }
          | { status: string; leave_type: string | null }[]
          | null;
      };

      // Fifty people's approved days across a holiday year can pass the 1,000 rows Supabase
      // returns in one go, and it cuts the answer short without an error, so the column would
      // quietly undercount. Read it in pages, in id order so a page never repeats or skips a row.
      const leaveDays = await fetchAllRows<RosterLeaveDay>(
        (rangeFrom, rangeTo) =>
          adminClient
            .from('leave_days')
            .select('employee_id, leave_date, leave_requests!inner(status, leave_type)')
            .in('employee_id', employeeIds)
            .gte('leave_date', startDate)
            .lte('leave_date', endDate)
            .eq('leave_requests.status', 'approved')
            .order('id', { ascending: true })
            .range(rangeFrom, rangeTo),
        { label: 'roster holiday days' }
      );

      const perEmployee = new Map<string, { leave_date: string; consumes_allowance: boolean }[]>();
      for (const row of leaveDays) {
        const employeeId = row.employee_id;
        if (!employeeId) continue;
        const request = Array.isArray(row.leave_requests) ? row.leave_requests[0] : row.leave_requests;
        const bucket = perEmployee.get(employeeId) ?? [];
        bucket.push({
          leave_date: String(row.leave_date),
          consumes_allowance: consumesAllowance(request?.leave_type, allowanceConsuming),
        });
        perEmployee.set(employeeId, bucket);
      }

      for (const [employeeId, rows] of perEmployee) {
        holidayCounts.set(employeeId, countAllowanceDays(rows));
      }
    }

    // The roster is rendered by a client component, so every row here is serialised
    // into the browser payload for anyone holding only `employees:view`. Each field is
    // named rather than spread, so nothing beyond EMPLOYEE_ROSTER_COLUMNS can ride along.
    const rosterEmployees: EmployeeRosterEmployee[] = employees.map((employee) => ({
      employee_id: employee.employee_id,
      first_name: employee.first_name,
      last_name: employee.last_name,
      preferred_name: employee.preferred_name ?? null,
      email_address: employee.email_address,
      job_title: employee.job_title,
      employment_start_date: employee.employment_start_date,
      status: employee.status,
      auth_user_id: employee.auth_user_id ?? null,
      holiday_days_current_year: holidayCounts.get(employee.employee_id) ?? 0,
    }));

    return {
      employees: rosterEmployees,
      pagination: {
        page: currentPage,
        pageSize,
        totalCount,
        totalPages
      },
      statusCounts: {
        all: allCount,
        active: activeCount,
        former: formerCount,
        onboarding: onboardingCount,
        startedSeparation: statusMap.get('Started Separation') ?? 0,
      },
      filters: {
        statusFilter,
        searchTerm
      }
    };
  }

  static async exportEmployeesData(options: ExportOptions): Promise<Employee[]> {
    const adminClient = createAdminClient();

    // The export used to ignore the search box, so searching for one person and exporting
    // gave a file of everyone on the tab.
    const query = applyEmployeeListFilters(
      adminClient.from('employees').select('*').order('last_name').order('first_name'),
      options.statusFilter ?? 'all',
      sanitizeEmployeeSearchTerm(options.searchTerm ?? '')
    );

    const { data: employees, error } = await query;

    if (error) {
      throw new Error('Failed to fetch employees for export');
    }
    return (employees ?? []) as Employee[];
  }

  static generateCSV(employees: Employee[], includeFields?: string[]): string {
    const fields = resolveExportFields(includeFields);

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
          return escapeCsvCell(formatDateInLondon(value, {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
          }));
        }
        
        if (typeof value === 'string') {
          return escapeCsvCell(value);
        }
        
        return escapeCsvCell(String(value));
      });
      csvRows.push(values.join(','));
    }
    return csvRows.join('\n');
  }

  static generateJSON(employees: Employee[], includeFields?: string[]): string {
    // Previously the default JSON export spread the whole row, so it shipped every
    // column the table happened to have, timeclock_pin_hash included. Both formats
    // now go through the same allowlist.
    const fields = resolveExportFields(includeFields);

    const rows = employees.map(emp => {
      const row: Record<string, unknown> = {};
      for (const field of fields) {
        row[field] = (emp as any)[field] ?? null;
      }
      return row;
    });
    return JSON.stringify(rows, null, 2);
  }
}
