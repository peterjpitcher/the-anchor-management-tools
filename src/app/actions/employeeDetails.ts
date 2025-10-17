'use server'

import { checkUserPermission } from './rbac'
import { createClient } from '@/lib/supabase/server'
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

type Nullable<T> = T | null

export interface EmployeeNoteWithAuthor extends EmployeeNote {
  author_name: string
}

export interface EmployeeDetailData {
  employee: Employee
  financialDetails: Nullable<EmployeeFinancialDetails>
  healthRecord: Nullable<EmployeeHealthRecord>
  notes: EmployeeNoteWithAuthor[]
  attachments: EmployeeAttachment[]
  attachmentCategories: AttachmentCategory[]
  emergencyContacts: EmployeeEmergencyContact[]
  rightToWork: Nullable<EmployeeRightToWork & { photo_storage_path?: string | null }>
  auditLogs: AuditLogEntry[]
  permissions: EmployeePermissions
}

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
  data?: EmployeeDetailData
  error?: string
  notFound?: boolean
  unauthorized?: boolean
}

export interface EmployeeEditData {
  employee: Employee
  financialDetails: Nullable<EmployeeFinancialDetails>
  healthRecord: Nullable<EmployeeHealthRecord>
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
    supabase
  ] = await Promise.all([
    checkUserPermission('employees', 'view'),
    checkUserPermission('employees', 'edit'),
    checkUserPermission('employees', 'delete'),
    checkUserPermission('employees', 'view_documents'),
    checkUserPermission('employees', 'upload_documents'),
    checkUserPermission('employees', 'delete_documents'),
    createClient()
  ])

  if (!canView) {
    return { unauthorized: true }
  }

  const permissions: EmployeePermissions = {
    canView,
    canEdit,
    canDelete,
    canViewDocuments,
    canUploadDocuments,
    canDeleteDocuments
  }

  try {
    const {
      data: employee,
      error: employeeError
    } = await supabase
      .from('employees')
      .select('*')
      .eq('employee_id', employeeId)
      .maybeSingle()

    if (employeeError) {
      console.error('[employeeDetail] Failed to fetch employee', employeeError)
      return { error: 'Failed to load employee.' }
    }

    if (!employee) {
      return { notFound: true }
    }

    const attachmentsPromise: PromiseLike<{ data: EmployeeAttachment[] | null; error: unknown }> = canViewDocuments
      ? supabase
          .from('employee_attachments')
          .select('*')
          .eq('employee_id', employeeId)
          .order('uploaded_at', { ascending: false })
          .then((result) => ({
            data: (result.data ?? null) as EmployeeAttachment[] | null,
            error: result.error
          }))
      : Promise.resolve({ data: [] as EmployeeAttachment[], error: null as unknown })

    const attachmentCategoriesPromise: PromiseLike<{ data: AttachmentCategory[] | null; error: unknown }> = canViewDocuments
      ? supabase
          .from('attachment_categories')
          .select('*')
          .order('category_name', { ascending: true })
          .then((result) => ({
            data: (result.data ?? null) as AttachmentCategory[] | null,
            error: result.error
          }))
      : Promise.resolve({ data: [] as AttachmentCategory[], error: null as unknown })

    const [
      financialResult,
      healthResult,
      notesResult,
      emergencyContactsResult,
      rightToWorkResult,
      auditLogsResult,
      attachmentsResult,
      attachmentCategoriesResult
    ] = await Promise.all([
      supabase
        .from('employee_financial_details')
        .select('*')
        .eq('employee_id', employeeId)
        .maybeSingle(),
      supabase
        .from('employee_health_records')
        .select('*')
        .eq('employee_id', employeeId)
        .maybeSingle(),
      supabase
        .from('employee_notes')
        .select('*')
        .eq('employee_id', employeeId)
        .order('created_at', { ascending: false }),
      supabase
        .from('employee_emergency_contacts')
        .select('*')
        .eq('employee_id', employeeId)
        .order('created_at', { ascending: false }),
      supabase
        .from('employee_right_to_work')
        .select('*')
        .eq('employee_id', employeeId)
        .maybeSingle(),
      supabase
        .from('audit_logs')
        .select('*')
        .eq('resource_type', 'employee')
        .eq('resource_id', employeeId)
        .order('created_at', { ascending: false })
        .limit(50),
      attachmentsPromise,
      attachmentCategoriesPromise
    ]) as [

      { data: Nullable<EmployeeFinancialDetails>; error: unknown },
      { data: Nullable<EmployeeHealthRecord>; error: unknown },
      { data: EmployeeNote[] | null; error: unknown },
      { data: EmployeeEmergencyContact[] | null; error: unknown },
      { data: Nullable<EmployeeRightToWork>; error: unknown },
      { data: AuditLogEntry[] | null; error: unknown },
      { data: EmployeeAttachment[] | null; error: unknown },
      { data: AttachmentCategory[] | null; error: unknown }
    ]

    if (financialResult.error) {
      console.error('[employeeDetail] financial fetch failed', financialResult.error)
    }
    if (healthResult.error) {
      console.error('[employeeDetail] health fetch failed', healthResult.error)
    }
    if (notesResult.error) {
      console.error('[employeeDetail] notes fetch failed', notesResult.error)
    }
    if (emergencyContactsResult.error) {
      console.error('[employeeDetail] contacts fetch failed', emergencyContactsResult.error)
    }
    if (rightToWorkResult.error) {
      console.error('[employeeDetail] right-to-work fetch failed', rightToWorkResult.error)
    }
    if (auditLogsResult.error) {
      console.error('[employeeDetail] audit logs fetch failed', auditLogsResult.error)
    }
    if (attachmentsResult.error) {
      console.error('[employeeDetail] attachments fetch failed', attachmentsResult.error)
    }
    if (attachmentCategoriesResult.error) {
      console.error('[employeeDetail] categories fetch failed', attachmentCategoriesResult.error)
    }

    const notes = await enrichNotesWithAuthors(notesResult.data ?? [], supabase)

    return {
      data: {
        employee,
        financialDetails: financialResult.data ?? null,
        healthRecord: healthResult.data ?? null,
        notes,
        attachments: canViewDocuments ? attachmentsResult.data ?? [] : [],
        attachmentCategories: canViewDocuments ? attachmentCategoriesResult.data ?? [] : [],
        emergencyContacts: emergencyContactsResult.data ?? [],
        rightToWork: rightToWorkResult.data ?? null,
        auditLogs: auditLogsResult.data ?? [],
        permissions
      }
    }
  } catch (error) {
    console.error('[employeeDetail] unexpected error', error)
    return { error: 'Failed to load employee.' }
  }
}

async function enrichNotesWithAuthors(notes: EmployeeNote[], supabase: Awaited<ReturnType<typeof createClient>>) {
  if (notes.length === 0) {
    return [] as EmployeeNoteWithAuthor[]
  }

  const authorIds = Array.from(
    new Set(
      notes
        .map((note) => note.created_by_user_id)
        .filter((id): id is string => Boolean(id))
    )
  )

  if (authorIds.length === 0) {
    return notes.map((note) => ({
      ...note,
      author_name: 'System'
    }))
  }

  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('id, full_name')
    .in('id', authorIds)

  if (error) {
    console.error('[employeeDetail] failed to fetch profiles', error)
  }

  const profileMap = new Map(profiles?.map((profile) => [profile.id, profile.full_name ?? null]))

  return notes.map((note) => {
    if (!note.created_by_user_id) {
      return { ...note, author_name: 'System' }
    }

    const fullName = profileMap.get(note.created_by_user_id)
    if (fullName) {
      return { ...note, author_name: fullName }
    }

    return {
      ...note,
      author_name: `User (${note.created_by_user_id.slice(0, 6)}…)`
    }
  })
}

export async function getEmployeeEditData(employeeId: string): Promise<EmployeeEditResult> {
  const [canEdit, supabase] = await Promise.all([
    checkUserPermission('employees', 'edit'),
    createClient()
  ])

  if (!canEdit) {
    return { unauthorized: true }
  }

  try {
    const { data: employee, error: employeeError } = await supabase
      .from('employees')
      .select('*')
      .eq('employee_id', employeeId)
      .maybeSingle()

    if (employeeError) {
      console.error('[employeeEdit] Failed to fetch employee', employeeError)
      return { error: 'Failed to load employee.' }
    }

    if (!employee) {
      return { notFound: true }
    }

    const [
      financialResult,
      healthResult
    ] = await Promise.all([
      supabase
        .from('employee_financial_details')
        .select('*')
        .eq('employee_id', employeeId)
        .maybeSingle(),
      supabase
        .from('employee_health_records')
        .select('*')
        .eq('employee_id', employeeId)
        .maybeSingle()
    ]) as [
      { data: Nullable<EmployeeFinancialDetails>; error: unknown },
      { data: Nullable<EmployeeHealthRecord>; error: unknown }
    ]

    if (financialResult.error) {
      console.error('[employeeEdit] financial fetch failed', financialResult.error)
    }

    if (healthResult.error) {
      console.error('[employeeEdit] health fetch failed', healthResult.error)
    }

    return {
      data: {
        employee,
        financialDetails: financialResult.data ?? null,
        healthRecord: healthResult.data ?? null
      }
    }
  } catch (error) {
    console.error('[employeeEdit] unexpected error', error)
    return { error: 'Failed to load employee.' }
  }
}
