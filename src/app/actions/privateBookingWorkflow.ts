'use server'

/**
 * Private booking SOP workflow actions:
 * - Deposit deductions (SOP §25): proposed with evidence, discussed with the
 *   customer, decided by the General Manager. Money moves only via the
 *   existing refund flow — never here.
 * - Suppliers (SOP §20): per-booking supplier records with document status
 *   and GM approval; the booking-level supplier_status rolls up from them.
 * - Self-catering waiver (SOP §21): status tracking + signed-copy upload.
 * - Risk review (SOP §18), record locking (SOP §27) and the complaints log
 *   (SOP §26: acknowledge within 3 working days, respond within 10).
 */

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from './audit'
import { logger } from '@/lib/logger'
import { getErrorMessage } from '@/lib/errors'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import type { ActionType } from '@/types/rbac'
import type { User as SupabaseUser } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DeductionStatus = 'proposed' | 'discussed' | 'approved' | 'rejected' | 'applied'

export type PrivateBookingDeduction = {
  id: string
  booking_id: string
  amount: number
  reason: string
  evidence_document_id: string | null
  customer_discussion_note: string | null
  status: DeductionStatus
  approved_by: string | null
  approved_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type SupplierStatus = 'requested' | 'incomplete' | 'approved' | 'rejected'

export type PrivateBookingSupplier = {
  id: string
  booking_id: string
  vendor_id: string | null
  name: string
  supplier_type: string | null
  contact_details: string | null
  arrival_time: string | null
  departure_time: string | null
  vehicle_notes: string | null
  power_requirements: string | null
  documents_required: string[]
  documents_received: string[]
  status: SupplierStatus
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type WaiverStatus = 'required' | 'sent' | 'signed' | 'overdue'

export type RiskStatus = 'low' | 'normal' | 'high' | 'gm_approval_required' | 'approved' | 'rejected'

export type ComplaintStatus = 'open' | 'acknowledged' | 'responded' | 'resolved' | 'closed'

export type PrivateBookingComplaint = {
  id: string
  booking_id: string | null
  customer_id: string | null
  received_at: string
  channel: string | null
  summary: string
  status: ComplaintStatus
  acknowledged_at: string | null
  responded_at: string | null
  resolved_at: string | null
  resolution: string | null
  handled_by: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const PRIVATE_BOOKING_DOCUMENTS_BUCKET = 'private-booking-documents'

async function requireUser(): Promise<{ user: SupabaseUser } | { error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  return { user }
}

// 'gm_override' and 'view_sensitive' are seeded by migration
// 20260705100003_pb_workflow_model.sql; the cast keeps this compiling whether
// or not the ActionType union has caught up with the new DB permissions.
function pbPermission(action: string, userId: string): Promise<boolean> {
  return checkUserPermission('private_bookings', action as ActionType, userId)
}

async function audit(params: {
  userId: string
  operationType: 'create' | 'update' | 'delete'
  resourceType: string
  resourceId?: string
  oldValues?: Record<string, unknown>
  newValues?: Record<string, unknown>
  additionalInfo?: Record<string, unknown>
}): Promise<void> {
  try {
    await logAuditEvent({
      user_id: params.userId,
      operation_type: params.operationType,
      resource_type: params.resourceType,
      resource_id: params.resourceId,
      operation_status: 'success',
      old_values: params.oldValues as Record<string, any> | undefined,
      new_values: params.newValues as Record<string, any> | undefined,
      additional_info: params.additionalInfo as Record<string, any> | undefined,
    })
  } catch (auditError) {
    logger.error('Failed to log audit event for private booking workflow', {
      error: auditError instanceof Error ? auditError : new Error(String(auditError)),
      metadata: { resourceType: params.resourceType, resourceId: params.resourceId },
    })
  }
}

function revalidateBooking(bookingId: string): void {
  revalidatePath(`/private-bookings/${bookingId}`)
}

/**
 * Roll the booking-level supplier_status up from the per-supplier statuses:
 * none → not_applicable; any requested/incomplete → incomplete;
 * any approved (and nothing outstanding) → approved; else all rejected → rejected.
 */
async function recomputeBookingSupplierStatus(
  admin: ReturnType<typeof createAdminClient>,
  bookingId: string
): Promise<string> {
  const { data, error } = await admin
    .from('private_booking_suppliers')
    .select('status')
    .eq('booking_id', bookingId)
  if (error) throw new Error(error.message)

  const statuses = (data ?? []).map((row: { status: string }) => row.status)
  let bookingStatus: string
  if (statuses.length === 0) {
    bookingStatus = 'not_applicable'
  } else if (statuses.some((status) => status === 'requested' || status === 'incomplete')) {
    bookingStatus = 'incomplete'
  } else if (statuses.some((status) => status === 'approved')) {
    bookingStatus = 'approved'
  } else {
    bookingStatus = 'rejected'
  }

  const { error: updateError } = await admin
    .from('private_bookings')
    .update({ supplier_status: bookingStatus })
    .eq('id', bookingId)
  if (updateError) throw new Error(updateError.message)

  return bookingStatus
}

// ---------------------------------------------------------------------------
// Deductions (SOP §25)
// ---------------------------------------------------------------------------

const proposeDeductionSchema = z.object({
  bookingId: z.string().uuid('Invalid booking id'),
  amount: z.number().positive('Deduction amount must be greater than zero'),
  reason: z.string().trim().min(1, 'A reason is required for every deduction'),
  evidenceDocumentId: z.string().uuid('Invalid evidence document id').optional(),
})

export async function proposeDeduction(input: {
  bookingId: string
  amount: number
  reason: string
  evidenceDocumentId?: string
}): Promise<{ success?: boolean; error?: string; data?: PrivateBookingDeduction }> {
  const auth = await requireUser()
  if ('error' in auth) return { error: auth.error }

  if (!(await pbPermission('manage_deposits', auth.user.id))) {
    return { error: 'You do not have permission to propose deposit deductions' }
  }

  const parsed = proposeDeductionSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid deduction' }

  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('private_booking_deductions')
      .insert({
        booking_id: parsed.data.bookingId,
        amount: parsed.data.amount,
        reason: parsed.data.reason,
        evidence_document_id: parsed.data.evidenceDocumentId ?? null,
        status: 'proposed',
        created_by: auth.user.id,
      })
      .select('*')
      .single()
    if (error) throw new Error(error.message)

    await audit({
      userId: auth.user.id,
      operationType: 'create',
      resourceType: 'private_booking_deduction',
      resourceId: data.id as string,
      newValues: { booking_id: parsed.data.bookingId, amount: parsed.data.amount, reason: parsed.data.reason, status: 'proposed' },
    })

    revalidateBooking(parsed.data.bookingId)
    return { success: true, data: data as PrivateBookingDeduction }
  } catch (error) {
    logger.error('Failed to propose deduction', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { bookingId: input.bookingId },
    })
    return { error: getErrorMessage(error) }
  }
}

export async function recordDeductionDiscussion(
  deductionId: string,
  note: string
): Promise<{ success?: boolean; error?: string; data?: PrivateBookingDeduction }> {
  const auth = await requireUser()
  if ('error' in auth) return { error: auth.error }

  if (!(await pbPermission('manage_deposits', auth.user.id))) {
    return { error: 'You do not have permission to record deduction discussions' }
  }

  const trimmedNote = note?.trim()
  if (!trimmedNote) return { error: 'A note describing the customer discussion is required' }

  try {
    const admin = createAdminClient()
    const { data: existing, error: loadError } = await admin
      .from('private_booking_deductions')
      .select('*')
      .eq('id', deductionId)
      .single()
    if (loadError || !existing) return { error: 'Deduction not found' }
    if (existing.status === 'approved' || existing.status === 'rejected' || existing.status === 'applied') {
      return { error: 'This deduction has already been decided' }
    }

    const { data, error } = await admin
      .from('private_booking_deductions')
      .update({
        customer_discussion_note: trimmedNote,
        status: 'discussed',
        updated_at: new Date().toISOString(),
      })
      .eq('id', deductionId)
      .select('*')
      .single()
    if (error) throw new Error(error.message)

    await audit({
      userId: auth.user.id,
      operationType: 'update',
      resourceType: 'private_booking_deduction',
      resourceId: deductionId,
      oldValues: { status: existing.status },
      newValues: { status: 'discussed', customer_discussion_note: trimmedNote },
    })

    revalidateBooking(existing.booking_id as string)
    return { success: true, data: data as PrivateBookingDeduction }
  } catch (error) {
    logger.error('Failed to record deduction discussion', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { deductionId },
    })
    return { error: getErrorMessage(error) }
  }
}

export async function decideDeduction(
  deductionId: string,
  decision: 'approved' | 'rejected'
): Promise<{ success?: boolean; error?: string; data?: PrivateBookingDeduction }> {
  const auth = await requireUser()
  if ('error' in auth) return { error: auth.error }

  if (!(await pbPermission('gm_override', auth.user.id))) {
    return { error: 'Only the General Manager can approve or reject deductions' }
  }

  if (decision !== 'approved' && decision !== 'rejected') {
    return { error: 'Decision must be approved or rejected' }
  }

  try {
    const admin = createAdminClient()
    const { data: existing, error: loadError } = await admin
      .from('private_booking_deductions')
      .select('*')
      .eq('id', deductionId)
      .single()
    if (loadError || !existing) return { error: 'Deduction not found' }
    if (existing.status === 'applied') {
      return { error: 'This deduction has already been applied and cannot be re-decided' }
    }

    const { data, error } = await admin
      .from('private_booking_deductions')
      .update({
        status: decision,
        approved_by: auth.user.id,
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', deductionId)
      .select('*')
      .single()
    if (error) throw new Error(error.message)

    await audit({
      userId: auth.user.id,
      operationType: 'update',
      resourceType: 'private_booking_deduction',
      resourceId: deductionId,
      oldValues: { status: existing.status },
      newValues: { status: decision },
      additionalInfo: { amount: existing.amount, reason: existing.reason },
    })

    revalidateBooking(existing.booking_id as string)
    return { success: true, data: data as PrivateBookingDeduction }
  } catch (error) {
    logger.error('Failed to decide deduction', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { deductionId, decision },
    })
    return { error: getErrorMessage(error) }
  }
}

export async function listDeductions(
  bookingId: string
): Promise<{ success?: boolean; error?: string; data?: PrivateBookingDeduction[] }> {
  const auth = await requireUser()
  if ('error' in auth) return { error: auth.error }

  if (!(await pbPermission('view', auth.user.id))) {
    return { error: 'You do not have permission to view private bookings' }
  }

  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('private_booking_deductions')
      .select('*')
      .eq('booking_id', bookingId)
      .order('created_at', { ascending: true })
    if (error) throw new Error(error.message)
    return { success: true, data: (data ?? []) as PrivateBookingDeduction[] }
  } catch (error) {
    logger.error('Failed to list deductions', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { bookingId },
    })
    return { error: getErrorMessage(error) }
  }
}

// ---------------------------------------------------------------------------
// Suppliers (SOP §20)
// ---------------------------------------------------------------------------

const supplierFieldsSchema = z.object({
  vendorId: z.string().uuid('Invalid vendor id').nullish(),
  name: z.string().trim().min(1, 'Supplier name is required'),
  supplierType: z.string().trim().nullish(),
  contactDetails: z.string().trim().nullish(),
  arrivalTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Arrival time must be HH:MM').nullish(),
  departureTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Departure time must be HH:MM').nullish(),
  vehicleNotes: z.string().trim().nullish(),
  powerRequirements: z.string().trim().nullish(),
  documentsRequired: z.array(z.string().trim().min(1)).nullish(),
  documentsReceived: z.array(z.string().trim().min(1)).nullish(),
  notes: z.string().trim().nullish(),
})

export async function addBookingSupplier(input: {
  bookingId: string
  name: string
  vendorId?: string | null
  supplierType?: string | null
  contactDetails?: string | null
  arrivalTime?: string | null
  departureTime?: string | null
  vehicleNotes?: string | null
  powerRequirements?: string | null
  documentsRequired?: string[]
  documentsReceived?: string[]
  notes?: string | null
}): Promise<{ success?: boolean; error?: string; data?: PrivateBookingSupplier }> {
  const auth = await requireUser()
  if ('error' in auth) return { error: auth.error }

  if (!(await pbPermission('edit', auth.user.id))) {
    return { error: 'You do not have permission to edit private bookings' }
  }

  if (!input.bookingId || !z.string().uuid().safeParse(input.bookingId).success) {
    return { error: 'Invalid booking id' }
  }
  const parsed = supplierFieldsSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid supplier' }

  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('private_booking_suppliers')
      .insert({
        booking_id: input.bookingId,
        vendor_id: parsed.data.vendorId ?? null,
        name: parsed.data.name,
        supplier_type: parsed.data.supplierType ?? null,
        contact_details: parsed.data.contactDetails ?? null,
        arrival_time: parsed.data.arrivalTime ?? null,
        departure_time: parsed.data.departureTime ?? null,
        vehicle_notes: parsed.data.vehicleNotes ?? null,
        power_requirements: parsed.data.powerRequirements ?? null,
        documents_required: parsed.data.documentsRequired ?? [],
        documents_received: parsed.data.documentsReceived ?? [],
        status: 'requested',
        notes: parsed.data.notes ?? null,
        created_by: auth.user.id,
      })
      .select('*')
      .single()
    if (error) throw new Error(error.message)

    const bookingSupplierStatus = await recomputeBookingSupplierStatus(admin, input.bookingId)

    await audit({
      userId: auth.user.id,
      operationType: 'create',
      resourceType: 'private_booking_supplier',
      resourceId: data.id as string,
      newValues: { booking_id: input.bookingId, name: parsed.data.name, status: 'requested' },
      additionalInfo: { booking_supplier_status: bookingSupplierStatus },
    })

    revalidateBooking(input.bookingId)
    return { success: true, data: data as PrivateBookingSupplier }
  } catch (error) {
    logger.error('Failed to add booking supplier', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { bookingId: input.bookingId },
    })
    return { error: getErrorMessage(error) }
  }
}

export async function updateBookingSupplier(
  supplierId: string,
  updates: {
    name?: string
    vendorId?: string | null
    supplierType?: string | null
    contactDetails?: string | null
    arrivalTime?: string | null
    departureTime?: string | null
    vehicleNotes?: string | null
    powerRequirements?: string | null
    documentsRequired?: string[]
    documentsReceived?: string[]
    notes?: string | null
  }
): Promise<{ success?: boolean; error?: string; data?: PrivateBookingSupplier }> {
  const auth = await requireUser()
  if ('error' in auth) return { error: auth.error }

  if (!(await pbPermission('edit', auth.user.id))) {
    return { error: 'You do not have permission to edit private bookings' }
  }

  const parsed = supplierFieldsSchema.partial().safeParse(updates)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid supplier update' }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (parsed.data.name !== undefined) patch.name = parsed.data.name
  if (parsed.data.vendorId !== undefined) patch.vendor_id = parsed.data.vendorId
  if (parsed.data.supplierType !== undefined) patch.supplier_type = parsed.data.supplierType
  if (parsed.data.contactDetails !== undefined) patch.contact_details = parsed.data.contactDetails
  if (parsed.data.arrivalTime !== undefined) patch.arrival_time = parsed.data.arrivalTime
  if (parsed.data.departureTime !== undefined) patch.departure_time = parsed.data.departureTime
  if (parsed.data.vehicleNotes !== undefined) patch.vehicle_notes = parsed.data.vehicleNotes
  if (parsed.data.powerRequirements !== undefined) patch.power_requirements = parsed.data.powerRequirements
  if (parsed.data.documentsRequired !== undefined) patch.documents_required = parsed.data.documentsRequired ?? []
  if (parsed.data.documentsReceived !== undefined) patch.documents_received = parsed.data.documentsReceived ?? []
  if (parsed.data.notes !== undefined) patch.notes = parsed.data.notes

  if (Object.keys(patch).length === 1) return { error: 'No supplier changes provided' }

  try {
    const admin = createAdminClient()
    const { data: existing, error: loadError } = await admin
      .from('private_booking_suppliers')
      .select('id, booking_id, name, status')
      .eq('id', supplierId)
      .single()
    if (loadError || !existing) return { error: 'Supplier not found' }

    const { data, error } = await admin
      .from('private_booking_suppliers')
      .update(patch)
      .eq('id', supplierId)
      .select('*')
      .single()
    if (error) throw new Error(error.message)

    await audit({
      userId: auth.user.id,
      operationType: 'update',
      resourceType: 'private_booking_supplier',
      resourceId: supplierId,
      newValues: patch,
      additionalInfo: { booking_id: existing.booking_id },
    })

    revalidateBooking(existing.booking_id as string)
    return { success: true, data: data as PrivateBookingSupplier }
  } catch (error) {
    logger.error('Failed to update booking supplier', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { supplierId },
    })
    return { error: getErrorMessage(error) }
  }
}

export async function setSupplierStatus(
  supplierId: string,
  status: SupplierStatus
): Promise<{ success?: boolean; error?: string; data?: PrivateBookingSupplier }> {
  const auth = await requireUser()
  if ('error' in auth) return { error: auth.error }

  if (!['requested', 'incomplete', 'approved', 'rejected'].includes(status)) {
    return { error: 'Invalid supplier status' }
  }

  // GM approval is required to approve or reject a supplier (SOP §20);
  // marking documents requested/incomplete is normal booking editing.
  const requiredPermission = status === 'approved' || status === 'rejected' ? 'gm_override' : 'edit'
  if (!(await pbPermission(requiredPermission, auth.user.id))) {
    return {
      error:
        requiredPermission === 'gm_override'
          ? 'Only the General Manager can approve or reject suppliers'
          : 'You do not have permission to edit private bookings',
    }
  }

  try {
    const admin = createAdminClient()
    const { data: existing, error: loadError } = await admin
      .from('private_booking_suppliers')
      .select('id, booking_id, name, status')
      .eq('id', supplierId)
      .single()
    if (loadError || !existing) return { error: 'Supplier not found' }

    const { data, error } = await admin
      .from('private_booking_suppliers')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', supplierId)
      .select('*')
      .single()
    if (error) throw new Error(error.message)

    const bookingSupplierStatus = await recomputeBookingSupplierStatus(admin, existing.booking_id as string)

    await audit({
      userId: auth.user.id,
      operationType: 'update',
      resourceType: 'private_booking_supplier',
      resourceId: supplierId,
      oldValues: { status: existing.status },
      newValues: { status },
      additionalInfo: { booking_id: existing.booking_id, booking_supplier_status: bookingSupplierStatus },
    })

    revalidateBooking(existing.booking_id as string)
    return { success: true, data: data as PrivateBookingSupplier }
  } catch (error) {
    logger.error('Failed to set supplier status', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { supplierId, status },
    })
    return { error: getErrorMessage(error) }
  }
}

export async function listBookingSuppliers(
  bookingId: string
): Promise<{ success?: boolean; error?: string; data?: PrivateBookingSupplier[] }> {
  const auth = await requireUser()
  if ('error' in auth) return { error: auth.error }

  if (!(await pbPermission('view', auth.user.id))) {
    return { error: 'You do not have permission to view private bookings' }
  }

  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('private_booking_suppliers')
      .select('*')
      .eq('booking_id', bookingId)
      .order('arrival_time', { ascending: true, nullsFirst: false })
    if (error) throw new Error(error.message)
    return { success: true, data: (data ?? []) as PrivateBookingSupplier[] }
  } catch (error) {
    logger.error('Failed to list booking suppliers', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { bookingId },
    })
    return { error: getErrorMessage(error) }
  }
}

// ---------------------------------------------------------------------------
// Self-catering waiver (SOP §21)
// ---------------------------------------------------------------------------

export async function setWaiverStatus(
  bookingId: string,
  status: WaiverStatus
): Promise<{ success?: boolean; error?: string }> {
  const auth = await requireUser()
  if ('error' in auth) return { error: auth.error }

  if (!(await pbPermission('edit', auth.user.id))) {
    return { error: 'You do not have permission to edit private bookings' }
  }

  if (!['required', 'sent', 'signed', 'overdue'].includes(status)) {
    return { error: 'Invalid waiver status' }
  }

  try {
    const admin = createAdminClient()
    const { data: existing, error: loadError } = await admin
      .from('private_bookings')
      .select('id, waiver_status')
      .eq('id', bookingId)
      .single()
    if (loadError || !existing) return { error: 'Booking not found' }

    const { error } = await admin
      .from('private_bookings')
      .update({ waiver_status: status })
      .eq('id', bookingId)
    if (error) throw new Error(error.message)

    await audit({
      userId: auth.user.id,
      operationType: 'update',
      resourceType: 'private_booking',
      resourceId: bookingId,
      oldValues: { waiver_status: existing.waiver_status },
      newValues: { waiver_status: status },
      additionalInfo: { action: 'set_waiver_status' },
    })

    revalidateBooking(bookingId)
    return { success: true }
  } catch (error) {
    logger.error('Failed to set waiver status', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { bookingId, status },
    })
    return { error: getErrorMessage(error) }
  }
}

const WAIVER_MIME_EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
}

const MAX_WAIVER_FILE_BYTES = 10 * 1024 * 1024 // 10 MB

export async function uploadSignedWaiver(
  bookingId: string,
  formData: FormData
): Promise<{ success?: boolean; error?: string }> {
  const auth = await requireUser()
  if ('error' in auth) return { error: auth.error }

  if (!(await pbPermission('edit', auth.user.id))) {
    return { error: 'You do not have permission to edit private bookings' }
  }

  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) {
    return { error: 'A signed waiver file is required' }
  }
  const extension = WAIVER_MIME_EXTENSIONS[file.type]
  if (!extension) {
    return { error: 'Signed waiver must be a PDF or an image (JPEG, PNG, WebP or HEIC)' }
  }
  if (file.size > MAX_WAIVER_FILE_BYTES) {
    return { error: 'Signed waiver file is too large (maximum 10 MB)' }
  }

  try {
    const admin = createAdminClient()
    const { data: existing, error: loadError } = await admin
      .from('private_bookings')
      .select('id, waiver_status')
      .eq('id', bookingId)
      .single()
    if (loadError || !existing) return { error: 'Booking not found' }

    const fileName = `waiver-signed-${Date.now()}.${extension}`
    const storagePath = `${bookingId}/${fileName}`
    const content = Buffer.from(await file.arrayBuffer())

    const { error: uploadError } = await admin.storage
      .from(PRIVATE_BOOKING_DOCUMENTS_BUCKET)
      .upload(storagePath, content, { contentType: file.type, upsert: false })
    if (uploadError) throw new Error(uploadError.message)

    const { error: docError } = await admin.from('private_booking_documents').insert({
      booking_id: bookingId,
      document_type: 'waiver_signed',
      file_name: fileName,
      storage_path: storagePath,
      mime_type: file.type,
      file_size_bytes: content.byteLength,
      version: 1,
      generated_by: auth.user.id,
      metadata: { original_file_name: file.name },
    })
    if (docError) throw new Error(docError.message)

    const { error: statusError } = await admin
      .from('private_bookings')
      .update({ waiver_status: 'signed' })
      .eq('id', bookingId)
    if (statusError) throw new Error(statusError.message)

    await audit({
      userId: auth.user.id,
      operationType: 'update',
      resourceType: 'private_booking',
      resourceId: bookingId,
      oldValues: { waiver_status: existing.waiver_status },
      newValues: { waiver_status: 'signed' },
      additionalInfo: { action: 'upload_signed_waiver', storage_path: storagePath },
    })

    revalidateBooking(bookingId)
    return { success: true }
  } catch (error) {
    logger.error('Failed to upload signed waiver', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { bookingId },
    })
    return { error: getErrorMessage(error) }
  }
}

// ---------------------------------------------------------------------------
// Risk review (SOP §18)
// ---------------------------------------------------------------------------

export async function setRiskStatus(
  bookingId: string,
  status: RiskStatus,
  reason: string
): Promise<{ success?: boolean; error?: string }> {
  const auth = await requireUser()
  if ('error' in auth) return { error: auth.error }

  if (!['low', 'normal', 'high', 'gm_approval_required', 'approved', 'rejected'].includes(status)) {
    return { error: 'Invalid risk status' }
  }

  const trimmedReason = reason?.trim()
  if (!trimmedReason) return { error: 'A reason is required when changing risk status' }

  // Approving or rejecting a risk decision is a GM call; flagging risk is not.
  const requiredPermission = status === 'approved' || status === 'rejected' ? 'gm_override' : 'edit'
  if (!(await pbPermission(requiredPermission, auth.user.id))) {
    return {
      error:
        requiredPermission === 'gm_override'
          ? 'Only the General Manager can approve or reject a risk decision'
          : 'You do not have permission to edit private bookings',
    }
  }

  try {
    const admin = createAdminClient()
    const { data: existing, error: loadError } = await admin
      .from('private_bookings')
      .select('id, risk_status')
      .eq('id', bookingId)
      .single()
    if (loadError || !existing) return { error: 'Booking not found' }

    const { error } = await admin
      .from('private_bookings')
      .update({ risk_status: status })
      .eq('id', bookingId)
    if (error) throw new Error(error.message)

    await audit({
      userId: auth.user.id,
      operationType: 'update',
      resourceType: 'private_booking',
      resourceId: bookingId,
      oldValues: { risk_status: existing.risk_status },
      newValues: { risk_status: status },
      additionalInfo: { action: 'set_risk_status', reason: trimmedReason },
    })

    revalidateBooking(bookingId)
    return { success: true }
  } catch (error) {
    logger.error('Failed to set risk status', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { bookingId, status },
    })
    return { error: getErrorMessage(error) }
  }
}

// ---------------------------------------------------------------------------
// Record locking (SOP §27)
// ---------------------------------------------------------------------------

export async function lockBookingRecord(
  bookingId: string,
  reason: string
): Promise<{ success?: boolean; error?: string }> {
  const auth = await requireUser()
  if ('error' in auth) return { error: auth.error }

  if (!(await pbPermission('gm_override', auth.user.id))) {
    return { error: 'Only the General Manager can lock a booking record' }
  }

  const trimmedReason = reason?.trim()
  if (!trimmedReason) return { error: 'A reason is required to lock a booking record' }

  try {
    const admin = createAdminClient()
    const { data: existing, error: loadError } = await admin
      .from('private_bookings')
      .select('id, locked_at, locked_reason')
      .eq('id', bookingId)
      .single()
    if (loadError || !existing) return { error: 'Booking not found' }
    if (existing.locked_at) {
      return { error: `Booking record is already locked (${existing.locked_reason ?? 'no reason recorded'})` }
    }

    const lockedAt = new Date().toISOString()
    const { error } = await admin
      .from('private_bookings')
      .update({ locked_at: lockedAt, locked_reason: trimmedReason, locked_by: auth.user.id })
      .eq('id', bookingId)
    if (error) throw new Error(error.message)

    await audit({
      userId: auth.user.id,
      operationType: 'update',
      resourceType: 'private_booking',
      resourceId: bookingId,
      newValues: { locked_at: lockedAt, locked_reason: trimmedReason },
      additionalInfo: { action: 'lock_booking_record' },
    })

    revalidateBooking(bookingId)
    return { success: true }
  } catch (error) {
    logger.error('Failed to lock booking record', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { bookingId },
    })
    return { error: getErrorMessage(error) }
  }
}

export async function unlockBookingRecord(
  bookingId: string
): Promise<{ success?: boolean; error?: string }> {
  const auth = await requireUser()
  if ('error' in auth) return { error: auth.error }

  if (!(await pbPermission('gm_override', auth.user.id))) {
    return { error: 'Only the General Manager can unlock a booking record' }
  }

  try {
    const admin = createAdminClient()
    const { data: existing, error: loadError } = await admin
      .from('private_bookings')
      .select('id, locked_at, locked_reason')
      .eq('id', bookingId)
      .single()
    if (loadError || !existing) return { error: 'Booking not found' }
    if (!existing.locked_at) return { error: 'Booking record is not locked' }

    const { error } = await admin
      .from('private_bookings')
      .update({ locked_at: null, locked_reason: null, locked_by: null })
      .eq('id', bookingId)
    if (error) throw new Error(error.message)

    await audit({
      userId: auth.user.id,
      operationType: 'update',
      resourceType: 'private_booking',
      resourceId: bookingId,
      oldValues: { locked_at: existing.locked_at, locked_reason: existing.locked_reason },
      newValues: { locked_at: null, locked_reason: null },
      additionalInfo: { action: 'unlock_booking_record' },
    })

    revalidateBooking(bookingId)
    return { success: true }
  } catch (error) {
    logger.error('Failed to unlock booking record', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { bookingId },
    })
    return { error: getErrorMessage(error) }
  }
}

// ---------------------------------------------------------------------------
// Complaints (SOP §26)
// ---------------------------------------------------------------------------

const logComplaintSchema = z.object({
  bookingId: z.string().uuid('Invalid booking id').nullish(),
  customerId: z.string().uuid('Invalid customer id').nullish(),
  channel: z.string().trim().nullish(),
  summary: z.string().trim().min(1, 'A complaint summary is required'),
})

export async function logComplaint(input: {
  bookingId?: string | null
  customerId?: string | null
  channel?: string | null
  summary: string
}): Promise<{ success?: boolean; error?: string; data?: PrivateBookingComplaint }> {
  const auth = await requireUser()
  if ('error' in auth) return { error: auth.error }

  if (!(await pbPermission('edit', auth.user.id))) {
    return { error: 'You do not have permission to log complaints' }
  }

  const parsed = logComplaintSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid complaint' }

  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('private_booking_complaints')
      .insert({
        booking_id: parsed.data.bookingId ?? null,
        customer_id: parsed.data.customerId ?? null,
        channel: parsed.data.channel ?? null,
        summary: parsed.data.summary,
        status: 'open',
        created_by: auth.user.id,
      })
      .select('*')
      .single()
    if (error) throw new Error(error.message)

    await audit({
      userId: auth.user.id,
      operationType: 'create',
      resourceType: 'private_booking_complaint',
      resourceId: data.id as string,
      newValues: { booking_id: parsed.data.bookingId ?? null, status: 'open' },
    })

    if (parsed.data.bookingId) {
      revalidateBooking(parsed.data.bookingId)
    } else {
      revalidatePath('/private-bookings')
    }
    return { success: true, data: data as PrivateBookingComplaint }
  } catch (error) {
    logger.error('Failed to log complaint', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { bookingId: input.bookingId },
    })
    return { error: getErrorMessage(error) }
  }
}

export async function updateComplaint(
  complaintId: string,
  updates: { status?: ComplaintStatus; resolution?: string | null }
): Promise<{ success?: boolean; error?: string; data?: PrivateBookingComplaint }> {
  const auth = await requireUser()
  if ('error' in auth) return { error: auth.error }

  if (updates.status && !['open', 'acknowledged', 'responded', 'resolved', 'closed'].includes(updates.status)) {
    return { error: 'Invalid complaint status' }
  }
  if (updates.status === undefined && updates.resolution === undefined) {
    return { error: 'No complaint changes provided' }
  }

  // Resolving or closing a complaint is a GM/manager decision (SOP §26).
  const needsManage = updates.status === 'resolved' || updates.status === 'closed'
  const allowed = needsManage
    ? (await pbPermission('manage', auth.user.id)) || (await pbPermission('gm_override', auth.user.id))
    : await pbPermission('edit', auth.user.id)
  if (!allowed) {
    return {
      error: needsManage
        ? 'Only a manager or the General Manager can resolve or close complaints'
        : 'You do not have permission to update complaints',
    }
  }

  try {
    const admin = createAdminClient()
    const { data: existing, error: loadError } = await admin
      .from('private_booking_complaints')
      .select('*')
      .eq('id', complaintId)
      .single()
    if (loadError || !existing) return { error: 'Complaint not found' }

    const now = new Date().toISOString()
    const patch: Record<string, unknown> = { updated_at: now, handled_by: auth.user.id }
    if (updates.status) {
      patch.status = updates.status
      if (updates.status === 'acknowledged' && !existing.acknowledged_at) patch.acknowledged_at = now
      if (updates.status === 'responded' && !existing.responded_at) patch.responded_at = now
      if (updates.status === 'resolved' && !existing.resolved_at) patch.resolved_at = now
    }
    if (updates.resolution !== undefined) patch.resolution = updates.resolution?.trim() || null

    const { data, error } = await admin
      .from('private_booking_complaints')
      .update(patch)
      .eq('id', complaintId)
      .select('*')
      .single()
    if (error) throw new Error(error.message)

    await audit({
      userId: auth.user.id,
      operationType: 'update',
      resourceType: 'private_booking_complaint',
      resourceId: complaintId,
      oldValues: { status: existing.status },
      newValues: { status: updates.status ?? existing.status, resolution: updates.resolution ?? undefined },
    })

    if (existing.booking_id) revalidateBooking(existing.booking_id as string)
    return { success: true, data: data as PrivateBookingComplaint }
  } catch (error) {
    logger.error('Failed to update complaint', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { complaintId },
    })
    return { error: getErrorMessage(error) }
  }
}

export async function listComplaints(input?: {
  bookingId?: string
  status?: ComplaintStatus
}): Promise<{ success?: boolean; error?: string; data?: PrivateBookingComplaint[] }> {
  const auth = await requireUser()
  if ('error' in auth) return { error: auth.error }

  if (!(await pbPermission('view', auth.user.id))) {
    return { error: 'You do not have permission to view complaints' }
  }

  try {
    const admin = createAdminClient()
    let query = admin
      .from('private_booking_complaints')
      .select('*')
      .order('received_at', { ascending: false })
    if (input?.bookingId) query = query.eq('booking_id', input.bookingId)
    if (input?.status) query = query.eq('status', input.status)

    const { data, error } = await query
    if (error) throw new Error(error.message)
    return { success: true, data: (data ?? []) as PrivateBookingComplaint[] }
  } catch (error) {
    logger.error('Failed to list complaints', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { bookingId: input?.bookingId, status: input?.status },
    })
    return { error: getErrorMessage(error) }
  }
}
