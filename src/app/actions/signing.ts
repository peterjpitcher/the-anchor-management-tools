'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { logAuditEvent } from '@/app/actions/audit'
import { checkUserPermission } from '@/app/actions/rbac'
import { getErrorMessage } from '@/lib/errors'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  SigningError,
  getSigningDocument,
  getSigningPartyById,
  listSigningDocumentsForSubject,
  resendSigningLink,
  startInPersonSigning,
  voidSigningDocument,
  type SigningDocumentSummary,
} from '@/lib/signing/service'
import {
  canSendSigningKind,
  canViewSigningKind,
  getSigningStaffUser,
  signingKindsForSubject,
} from '@/lib/signing/staff'
import { describeSigningSubject } from '@/lib/signing/subjects'
import { unknownMergeFields } from '@/lib/signing/template-fields'
import { findMergeFields } from '@/lib/signing/template-render'
import { listSigningTemplates, templateActivationBlocker } from '@/lib/signing/templates'
import { SIGNING_SUBJECT_TYPES, type SigningSubjectType, type SigningTemplateRow } from '@/lib/signing/types'

/**
 * Staff actions shared by every kind of signed document: see what has been sent, chase it,
 * withdraw it, hand a device over to sign in person, and manage template wording.
 *
 * Sending is not here. Each kind has its own send action beside the record it belongs to,
 * because each builds its document differently; they all end in createSigningRequest.
 */

type ActionResult<T = undefined> = { success?: boolean; error?: string; data?: T }

const UuidSchema = z.string().uuid()

function failure(error: unknown): { error: string } {
  // A SigningError carries words written for staff. Anything else is ours, and is not shown raw.
  if (error instanceof SigningError) return { error: error.message }
  console.error('Signing action failed:', error)
  return { error: getErrorMessage(error) || 'Something went wrong. Please try again.' }
}

async function revalidateSubject(document: Pick<SigningDocumentSummary, 'subject_type' | 'subject_id'>): Promise<void> {
  const subject = await describeSigningSubject(document)
  revalidatePath(subject.path.split('?')[0])
  revalidatePath('/signatures')
}

export async function getSigningDocumentsForSubject(
  subjectType: SigningSubjectType,
  subjectId: string
): Promise<ActionResult<SigningDocumentSummary[]>> {
  try {
    if (!SIGNING_SUBJECT_TYPES.includes(subjectType) || !UuidSchema.safeParse(subjectId).success) {
      return { error: 'Unknown record.' }
    }
    const user = await getSigningStaffUser()
    if (!user) return { error: 'Unauthorized' }

    const documents = await listSigningDocumentsForSubject(subjectType, subjectId)
    // A record can hold kinds with different permissions; show only those this person may see.
    const allowed = new Map<string, boolean>()
    for (const kind of signingKindsForSubject(subjectType)) {
      allowed.set(kind, await canViewSigningKind(kind, user.id))
    }
    return { success: true, data: documents.filter((document) => allowed.get(document.kind)) }
  } catch (error) {
    return failure(error)
  }
}

async function loadPartyForSend(partyId: string): Promise<
  | { error: string }
  | { user: NonNullable<Awaited<ReturnType<typeof getSigningStaffUser>>>; context: NonNullable<Awaited<ReturnType<typeof getSigningPartyById>>> }
> {
  if (!UuidSchema.safeParse(partyId).success) return { error: 'Unknown signer.' }
  const user = await getSigningStaffUser()
  if (!user) return { error: 'Unauthorized' }
  const context = await getSigningPartyById(partyId)
  if (!context) return { error: 'Signer not found.' }
  if (!(await canSendSigningKind(context.document.kind, user.id))) {
    return { error: 'Insufficient permissions' }
  }
  return { user, context }
}

/** Email a fresh link. The earlier link stops working. */
export async function sendSigningReminder(partyId: string): Promise<ActionResult> {
  try {
    const loaded = await loadPartyForSend(partyId)
    if ('error' in loaded) return loaded
    const { user, context } = loaded

    await resendSigningLink({ partyId, userId: user.id, isReminder: true })
    await logAuditEvent({
      user_id: user.id,
      user_email: user.email ?? undefined,
      operation_type: 'remind',
      resource_type: 'signing_document',
      resource_id: context.document.id,
      operation_status: 'success',
      additional_info: { party_id: partyId, kind: context.document.kind },
    })
    await revalidateSubject(context.document)
    return { success: true }
  } catch (error) {
    return failure(error)
  }
}

/** Start an in-person signing on this device. Returns the short-lived link to open. */
export async function startInPersonSigningAction(partyId: string): Promise<ActionResult<{ url: string }>> {
  try {
    const loaded = await loadPartyForSend(partyId)
    if ('error' in loaded) return loaded
    const { user, context } = loaded

    const { url } = await startInPersonSigning({ partyId, userId: user.id })
    await logAuditEvent({
      user_id: user.id,
      user_email: user.email ?? undefined,
      operation_type: 'start_in_person',
      resource_type: 'signing_document',
      resource_id: context.document.id,
      operation_status: 'success',
      additional_info: { party_id: partyId, kind: context.document.kind },
    })
    await revalidateSubject(context.document)
    return { success: true, data: { url } }
  } catch (error) {
    return failure(error)
  }
}

const VoidSchema = z.object({
  documentId: UuidSchema,
  reason: z.string().trim().min(3, 'Give a short reason.').max(300),
})

/** Withdraw a request that has not been fully signed. */
export async function voidSigningRequest(input: { documentId: string; reason: string }): Promise<ActionResult> {
  try {
    const parsed = VoidSchema.safeParse(input)
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check the details and try again.' }
    const user = await getSigningStaffUser()
    if (!user) return { error: 'Unauthorized' }
    const document = await getSigningDocument(parsed.data.documentId)
    if (!document) return { error: 'Document not found.' }
    if (!(await canSendSigningKind(document.kind, user.id))) return { error: 'Insufficient permissions' }

    await voidSigningDocument({ documentId: document.id, userId: user.id, reason: parsed.data.reason })
    await logAuditEvent({
      user_id: user.id,
      user_email: user.email ?? undefined,
      operation_type: 'void',
      resource_type: 'signing_document',
      resource_id: document.id,
      operation_status: 'success',
      old_values: { status: document.status },
      new_values: { status: 'voided' },
      additional_info: { kind: document.kind, reason: parsed.data.reason },
    })
    await revalidateSubject(document)
    return { success: true }
  } catch (error) {
    return failure(error)
  }
}

export interface SigningOverviewRow {
  document: SigningDocumentSummary
  subjectLabel: string
  subjectPath: string
}

const OVERVIEW_LIMIT = 100
const OverviewFilterSchema = z.enum(['outstanding', 'signed', 'closed'])
export type SigningOverviewFilter = z.infer<typeof OverviewFilterSchema>

const OVERVIEW_STATUSES: Record<SigningOverviewFilter, string[]> = {
  outstanding: ['sent', 'part_signed'],
  signed: ['completed'],
  closed: ['declined', 'voided', 'expired', 'superseded'],
}

/**
 * Every document sent for signature, across all kinds, newest first: the page that answers
 * "what are we still waiting on?". Shows only the kinds this person may see, and the most
 * recent hundred in the chosen group.
 */
export async function getSigningOverview(filter: SigningOverviewFilter): Promise<ActionResult<{ rows: SigningOverviewRow[]; truncated: boolean }>> {
  try {
    const parsed = OverviewFilterSchema.safeParse(filter)
    if (!parsed.success) return { error: 'Unknown filter.' }
    const user = await getSigningStaffUser()
    if (!user) return { error: 'Unauthorized' }

    const visibleKinds: string[] = []
    for (const subjectType of SIGNING_SUBJECT_TYPES) {
      for (const kind of signingKindsForSubject(subjectType)) {
        if (await canViewSigningKind(kind, user.id)) visibleKinds.push(kind)
      }
    }
    if (visibleKinds.length === 0) return { error: 'Insufficient permissions' }

    const admin = createAdminClient()
    const { data, error } = await admin
      .from('signing_documents')
      .select('id')
      .in('kind', visibleKinds)
      .in('status', OVERVIEW_STATUSES[parsed.data])
      .order('created_at', { ascending: false })
      .limit(OVERVIEW_LIMIT + 1)
    if (error) throw new Error(`Could not read signing documents: ${error.message}`)
    const ids = ((data ?? []) as Array<{ id: string }>).map((row) => row.id)
    const truncated = ids.length > OVERVIEW_LIMIT

    const rows: SigningOverviewRow[] = []
    for (const id of ids.slice(0, OVERVIEW_LIMIT)) {
      const document = await getSigningDocument(id)
      if (!document) continue
      const subject = await describeSigningSubject(document)
      rows.push({ document, subjectLabel: subject.label, subjectPath: subject.path })
    }
    return { success: true, data: { rows, truncated } }
  } catch (error) {
    return failure(error)
  }
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export async function getSigningTemplates(): Promise<ActionResult<SigningTemplateRow[]>> {
  try {
    if (!(await checkUserPermission('settings', 'manage'))) return { error: 'Insufficient permissions' }
    return { success: true, data: await listSigningTemplates() }
  } catch (error) {
    return failure(error)
  }
}

const SaveTemplateSchema = z.object({
  id: UuidSchema,
  title: z.string().trim().min(3, 'Give the template a title.').max(200),
  body: z.string().trim().min(1, 'The template has no wording.').max(60000),
})

/**
 * Save new wording. The version goes up by one, and a template that is switched on stays on
 * only if the new wording has no gaps left in it.
 */
export async function saveSigningTemplate(input: { id: string; title: string; body: string }): Promise<ActionResult<SigningTemplateRow>> {
  try {
    const parsed = SaveTemplateSchema.safeParse(input)
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check the details and try again.' }
    const user = await getSigningStaffUser()
    if (!user) return { error: 'Unauthorized' }
    if (!(await checkUserPermission('settings', 'manage', user.id))) return { error: 'Insufficient permissions' }

    const admin = createAdminClient()
    const { data: existing, error: readError } = await admin
      .from('signing_templates')
      .select('*')
      .eq('id', parsed.data.id)
      .maybeSingle()
    if (readError) throw new Error(readError.message)
    if (!existing) return { error: 'Template not found.' }
    const current = existing as SigningTemplateRow

    if (current.title === parsed.data.title && current.body === parsed.data.body) {
      return { success: true, data: current }
    }

    const unknown = unknownMergeFields(current.kind, findMergeFields(`${parsed.data.title}\n${parsed.data.body}`))
    if (unknown.length > 0) {
      return {
        error: `This template cannot fill in ${unknown.map((field) => `{{${field}}}`).join(', ')}. Remove ${unknown.length === 1 ? 'it' : 'them'} or check the spelling.`,
      }
    }

    const staysActive = current.is_active && templateActivationBlocker(parsed.data) === null
    const { data: updated, error: updateError } = await admin
      .from('signing_templates')
      .update({
        title: parsed.data.title,
        body: parsed.data.body,
        version: current.version + 1,
        is_active: staysActive,
        updated_at: new Date().toISOString(),
        updated_by: user.id,
      })
      .eq('id', current.id)
      // Two people editing at once: the second save is refused, not silently merged.
      .eq('version', current.version)
      .select('*')
      .maybeSingle()
    if (updateError) throw new Error(updateError.message)
    if (!updated) return { error: 'Someone else changed this template while you were editing. Reload and try again.' }

    await logAuditEvent({
      user_id: user.id,
      user_email: user.email ?? undefined,
      operation_type: 'update',
      resource_type: 'signing_template',
      resource_id: current.id,
      operation_status: 'success',
      old_values: { version: current.version, is_active: current.is_active },
      new_values: { version: current.version + 1, is_active: staysActive },
      additional_info: { slug: current.slug },
    })
    revalidatePath('/settings/signing-templates')
    return { success: true, data: updated as SigningTemplateRow }
  } catch (error) {
    return failure(error)
  }
}

/** Switch a template on or off. It can only be switched on once its wording has no gaps. */
export async function setSigningTemplateActive(input: { id: string; active: boolean }): Promise<ActionResult<SigningTemplateRow>> {
  try {
    if (!UuidSchema.safeParse(input.id).success || typeof input.active !== 'boolean') {
      return { error: 'Unknown template.' }
    }
    const user = await getSigningStaffUser()
    if (!user) return { error: 'Unauthorized' }
    if (!(await checkUserPermission('settings', 'manage', user.id))) return { error: 'Insufficient permissions' }

    const admin = createAdminClient()
    const { data: existing, error: readError } = await admin
      .from('signing_templates')
      .select('*')
      .eq('id', input.id)
      .maybeSingle()
    if (readError) throw new Error(readError.message)
    if (!existing) return { error: 'Template not found.' }
    const current = existing as SigningTemplateRow

    if (input.active) {
      const blocker = templateActivationBlocker(current)
      if (blocker) return { error: blocker }
    }

    const now = new Date().toISOString()
    const { data: updated, error: updateError } = await admin
      .from('signing_templates')
      .update({
        is_active: input.active,
        activated_at: input.active ? now : current.activated_at,
        activated_by: input.active ? user.id : current.activated_by,
        updated_at: now,
        updated_by: user.id,
      })
      .eq('id', current.id)
      .select('*')
      .single()
    if (updateError) throw new Error(updateError.message)

    await logAuditEvent({
      user_id: user.id,
      user_email: user.email ?? undefined,
      operation_type: input.active ? 'activate' : 'deactivate',
      resource_type: 'signing_template',
      resource_id: current.id,
      operation_status: 'success',
      old_values: { is_active: current.is_active },
      new_values: { is_active: input.active },
      additional_info: { slug: current.slug, version: current.version },
    })
    revalidatePath('/settings/signing-templates')
    return { success: true, data: updated as SigningTemplateRow }
  } catch (error) {
    return failure(error)
  }
}
