'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { logAuditEvent } from '@/app/actions/audit'
import { formatDateInLondon, getTodayIsoDate, isValidIsoDate } from '@/lib/dateUtils'
import { getErrorMessage } from '@/lib/errors'
import { loadWorkerAgreement } from '@/lib/signing/documents/worker-agreement'
import { applyWorkerAgreementSigningSlots } from '@/lib/signing/documents/worker-agreement-slots'
import { prepareSigningDocument } from '@/lib/signing/prepare'
import { POLICY_BATCH_SIZE } from '@/lib/signing/policy'
import { sendTemplateSigningRequest } from '@/lib/signing/send-template'
import {
  SigningError,
  createSigningRequest,
  type CreateSigningRequestResult,
  type PartyDelivery,
  type SigningPartyInput,
} from '@/lib/signing/service'
import { canSendSigningKind, canViewSigningKind, getSigningStaffUser, type SigningStaffUser } from '@/lib/signing/staff'
import { SINGLE_TEMPLATE_SLUGS } from '@/lib/signing/template-fields'
import { TemplateMergeError } from '@/lib/signing/template-render'
import { getSigningTemplateBySlug } from '@/lib/signing/templates'
import type { SigningDocumentStatus, SigningKind } from '@/lib/signing/types'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAllRows } from '@/lib/supabase/paged-read'
import { computeAgeAt } from '@/lib/worker-agreement'

/**
 * Sending staff documents for signature: the worker agreement, changes to terms, consent forms
 * and policy acknowledgements. Each ends in createSigningRequest, like every other kind.
 */

export interface SendResult {
  documentId: string
  deliveries: PartyDelivery[]
}
type ActionResult<T = undefined> = { success?: boolean; error?: string; data?: T }

const UuidSchema = z.string().uuid()
const EmailSchema = z.string().trim().email('Enter a valid email address.').max(254)
const NameSchema = z.string().trim().min(2, 'Enter their full name.').max(120)

function failure(error: unknown): { error: string } {
  if (error instanceof SigningError) return { error: error.message }
  if (error instanceof TemplateMergeError) {
    return { error: `This document needs details that are missing: ${error.missingFields.join(', ')}.` }
  }
  console.error('Staff signing action failed:', error)
  return { error: getErrorMessage(error) || 'Something went wrong. Please try again.' }
}

interface StaffEmployee {
  employee_id: string
  first_name: string | null
  last_name: string | null
  email_address: string | null
  date_of_birth: string | null
  status: string
}

function employeeName(employee: Pick<StaffEmployee, 'first_name' | 'last_name'>): string {
  return [employee.first_name, employee.last_name].map((part) => part?.trim()).filter(Boolean).join(' ')
}

async function loadEmployee(employeeId: string): Promise<StaffEmployee | null> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('employees')
    .select('employee_id, first_name, last_name, email_address, date_of_birth, status')
    .eq('employee_id', employeeId)
    .maybeSingle()
  if (error) throw new Error(`Could not read the employee: ${error.message}`)
  return (data as StaffEmployee | null) ?? null
}

/** The worker as a signer. They confirm their date of birth by link where we hold one. */
function workerParty(employee: StaffEmployee): SigningPartyInput {
  return {
    role: 'worker',
    name: employeeName(employee),
    email: employee.email_address,
    employeeId: employee.employee_id,
    identityCheck: employee.date_of_birth ? 'date_of_birth' : 'none',
  }
}

async function authorise(kind: SigningKind): Promise<{ error: string } | { user: SigningStaffUser }> {
  const user = await getSigningStaffUser()
  if (!user) return { error: 'Unauthorized' }
  if (!(await canSendSigningKind(kind, user.id))) return { error: 'Insufficient permissions' }
  return { user }
}

async function recordSend(
  user: SigningStaffUser,
  kind: SigningKind,
  employeeId: string,
  result: CreateSigningRequestResult
): Promise<SendResult> {
  await logAuditEvent({
    user_id: user.id,
    user_email: user.email ?? undefined,
    operation_type: 'send',
    resource_type: 'signing_document',
    resource_id: result.documentId,
    operation_status: 'success',
    additional_info: { kind, employee_id: employeeId, version: result.version },
  })
  revalidatePath(`/employees/${employeeId}`)
  revalidatePath('/employees/policies')
  return { documentId: result.documentId, deliveries: result.deliveries }
}

// ---------------------------------------------------------------------------
// Worker agreement
// ---------------------------------------------------------------------------

const AgreementSchema = z.object({
  employeeId: UuidSchema,
  guardianName: NameSchema.optional(),
  guardianEmail: EmailSchema.optional(),
})

/**
 * Send the zero-hours worker agreement. A worker under 18 needs a parent or guardian to sign
 * the same document. Refused while the agreement would print a blank where a detail should be.
 */
export async function sendEmploymentAgreement(input: {
  employeeId: string
  guardianName?: string
  guardianEmail?: string
}): Promise<ActionResult<SendResult>> {
  try {
    const parsed = AgreementSchema.safeParse(input)
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check the details and try again.' }
    const auth = await authorise('employment_agreement')
    if ('error' in auth) return auth

    const employee = await loadEmployee(parsed.data.employeeId)
    if (!employee) return { error: 'Employee not found.' }

    const built = await loadWorkerAgreement(employee.employee_id)
    if (!built) return { error: 'Employee not found.' }
    if (built.missing.length > 0) {
      return { error: `Add these to the employee record first, so the agreement has no blanks: ${built.missing.join('; ')}.` }
    }

    const parties: SigningPartyInput[] = [workerParty(employee)]
    const under18 = built.age !== null && built.age < 18
    if (under18) {
      if (!parsed.data.guardianName || !parsed.data.guardianEmail) {
        return { error: 'This worker is under 18. Add a parent or guardian name and email so they can sign too.' }
      }
      parties.push({ role: 'guardian', name: parsed.data.guardianName, email: parsed.data.guardianEmail })
    }
    // The parent or guardian block is on Schedule 2, which the agreement includes for under 18s.
    if (under18 && !built.includesYoungWorkerSchedule) {
      return { error: 'The agreement did not include the Young Worker Schedule. Check the date of birth on the record.' }
    }

    // Signature slots go where the agreement's blank signature lines are, so the signed copy
    // shows each signature in its place.
    const slotted = applyWorkerAgreementSigningSlots(built.html, {
      includesYoungWorkerSchedule: built.includesYoungWorkerSchedule,
    })
    const prepared = await prepareSigningDocument({
      source: { html: slotted.html, profile: 'a4_css_page', slots: slotted.slots, hasInitials: true },
      mode: 'sign',
      parties: parties.map((party) => ({ role: party.role, name: party.name })),
      sender: { name: auth.user.name, position: auth.user.position },
    })

    const result = await createSigningRequest({
      kind: 'employment_agreement',
      subjectId: employee.employee_id,
      title: 'Zero-hours casual worker agreement',
      summary: `Your agreement with The Anchor, dated ${formatDateInLondon(built.agreementDate, { day: 'numeric', month: 'long', year: 'numeric' })}. It sets out your role, pay and the terms you work under.`,
      pdf: prepared.pdf,
      render: prepared.render,
      parties,
      createdBy: auth.user.id,
      createdByName: auth.user.name,
      createdByPosition: auth.user.position,
      context: { agreement_date: built.agreementDate, under_18: under18 },
    })

    // The checklist's "agreement drafted" tick follows the send; "accepted" follows the signature.
    const admin = createAdminClient()
    const { error: checklistError } = await admin.from('employee_onboarding_checklist').upsert(
      {
        employee_id: employee.employee_id,
        employment_agreement_drafted: true,
        employment_agreement_date: getTodayIsoDate(),
      },
      { onConflict: 'employee_id' }
    )
    if (checklistError) console.error('Could not tick the onboarding checklist after sending the agreement:', checklistError)

    return { success: true, data: await recordSend(auth.user, 'employment_agreement', employee.employee_id, result) }
  } catch (error) {
    return failure(error)
  }
}

// ---------------------------------------------------------------------------
// Template documents for one employee
// ---------------------------------------------------------------------------

const StaffTemplateSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('terms_variation'),
    employeeId: UuidSchema,
    changeSummary: z.string().trim().min(10, 'Describe what is changing.').max(4000),
    effectiveDate: z.string().refine(isValidIsoDate, 'Choose the date the change starts.'),
  }),
  z.object({
    kind: z.literal('deduction_consent'),
    employeeId: UuidSchema,
    deductionDetails: z.string().trim().min(10, 'Describe what may be deducted, and when.').max(4000),
  }),
  z.object({
    kind: z.literal('working_time_opt_out'),
    employeeId: UuidSchema,
  }),
  z.object({
    kind: z.literal('guardian_consent'),
    employeeId: UuidSchema,
    guardianName: NameSchema,
    guardianEmail: EmailSchema,
  }),
])
export type StaffTemplateInput = z.input<typeof StaffTemplateSchema>

export async function sendStaffTemplateDocument(input: StaffTemplateInput): Promise<ActionResult<SendResult>> {
  try {
    const parsed = StaffTemplateSchema.safeParse(input)
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check the details and try again.' }
    const data = parsed.data
    const auth = await authorise(data.kind)
    if ('error' in auth) return auth

    const employee = await loadEmployee(data.employeeId)
    if (!employee) return { error: 'Employee not found.' }
    const name = employeeName(employee)
    if (!name) return { error: 'Add the employee\'s name to their record first.' }
    const age = computeAgeAt(employee.date_of_birth, getTodayIsoDate())

    let mergeValues: Record<string, string>
    let parties: SigningPartyInput[]
    let summary: string

    switch (data.kind) {
      case 'terms_variation':
        mergeValues = {
          worker_name: name,
          change_summary: data.changeSummary,
          effective_date: formatDateInLondon(data.effectiveDate, { day: 'numeric', month: 'long', year: 'numeric' }),
        }
        parties = [workerParty(employee)]
        summary = 'A change to the terms you work under. Please read what is changing and when it starts.'
        break
      case 'deduction_consent':
        mergeValues = { worker_name: name, deduction_details: data.deductionDetails }
        parties = [workerParty(employee)]
        summary = 'This asks for your agreement to specific deductions from your wages. Read exactly what it covers before you agree.'
        break
      case 'working_time_opt_out':
        // The law does not let a worker under 18 opt out, so we do not ask.
        if (age === null) return { error: 'Add the employee\'s date of birth first. A worker under 18 cannot opt out.' }
        if (age < 18) return { error: 'A worker under 18 cannot opt out of the working time limits.' }
        mergeValues = { worker_name: name }
        parties = [workerParty(employee)]
        summary = 'This is your choice. It asks whether you agree to give up the 48-hour average weekly limit. You can say no.'
        break
      case 'guardian_consent':
        if (age !== null && age >= 18) return { error: 'This worker is 18 or over, so no parent or guardian consent is needed.' }
        mergeValues = { worker_name: name, guardian_name: data.guardianName }
        parties = [{ role: 'guardian', name: data.guardianName, email: data.guardianEmail }]
        summary = `We are asking for your consent for ${name} to work with us.`
        break
    }

    const result = await sendTemplateSigningRequest({
      kind: data.kind,
      slug: SINGLE_TEMPLATE_SLUGS[data.kind],
      subjectId: employee.employee_id,
      mergeValues,
      parties,
      user: auth.user,
      summary,
      subtitle: `Prepared for ${name}`,
    })
    return { success: true, data: await recordSend(auth.user, data.kind, employee.employee_id, result) }
  } catch (error) {
    return failure(error)
  }
}

// ---------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------

export interface PolicyStaffRow {
  employeeId: string
  name: string
  email: string | null
  /** Where this person is with the current version of the policy. */
  state: 'confirmed' | 'waiting' | 'declined' | 'outdated' | 'not_sent'
  documentId: string | null
  /** When they confirmed, or when it was last sent. */
  at: string | null
  confirmedVersion: number | null
}

export interface PolicyOverview {
  slug: string
  title: string
  version: number
  isActive: boolean
  staff: PolicyStaffRow[]
}

const SlugSchema = z.string().regex(/^[a-z0-9-]{3,80}$/)

function policySeriesKey(slug: string): string {
  return `policy:${slug}`
}

async function loadActiveStaff(): Promise<StaffEmployee[]> {
  const admin = createAdminClient()
  const staff = await fetchAllRows<StaffEmployee>(
    (from, to) =>
      admin
        .from('employees')
        .select('employee_id, first_name, last_name, email_address, date_of_birth, status')
        .eq('status', 'Active')
        .order('employee_id', { ascending: true })
        .range(from, to),
    { label: 'active staff for policies' }
  )
  return staff.sort((left, right) => employeeName(left).localeCompare(employeeName(right)))
}

export interface PolicyTemplateSummary {
  slug: string
  title: string
  version: number
  isActive: boolean
}

/** The policies there are, for the policies page to choose between. */
export async function getPolicyTemplates(): Promise<ActionResult<PolicyTemplateSummary[]>> {
  try {
    const user = await getSigningStaffUser()
    if (!user) return { error: 'Unauthorized' }
    if (!(await canViewSigningKind('policy_acknowledgement', user.id))) return { error: 'Insufficient permissions' }
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('signing_templates')
      .select('slug, title, version, is_active')
      .eq('kind', 'policy_acknowledgement')
      .order('title', { ascending: true })
    if (error) throw new Error(`Could not read the policies: ${error.message}`)
    return {
      success: true,
      data: ((data ?? []) as Array<{ slug: string; title: string; version: number; is_active: boolean }>).map((row) => ({
        slug: row.slug,
        title: row.title,
        version: row.version,
        isActive: row.is_active,
      })),
    }
  } catch (error) {
    return failure(error)
  }
}

/** Who has confirmed the current version of a policy, and who has not. */
export async function getPolicyOverview(slug: string): Promise<ActionResult<PolicyOverview>> {
  try {
    if (!SlugSchema.safeParse(slug).success) return { error: 'Unknown policy.' }
    const user = await getSigningStaffUser()
    if (!user) return { error: 'Unauthorized' }
    if (!(await canViewSigningKind('policy_acknowledgement', user.id))) return { error: 'Insufficient permissions' }

    const template = await getSigningTemplateBySlug(slug)
    if (!template || template.kind !== 'policy_acknowledgement') return { error: 'Policy not found.' }

    const staff = await loadActiveStaff()
    const admin = createAdminClient()
    type PolicyDocument = {
      id: string
      subject_id: string
      status: SigningDocumentStatus
      version: number
      template_version: number | null
      sent_at: string
      completed_at: string | null
    }
    // Every send to every person, over the life of the policy, so it is read in pages.
    const documents = await fetchAllRows<PolicyDocument>(
      (from, to) =>
        admin
          .from('signing_documents')
          .select('id, subject_id, status, version, template_version, sent_at, completed_at')
          .eq('subject_type', 'employee')
          .eq('series_key', policySeriesKey(slug))
          .order('id', { ascending: true })
          .range(from, to),
      { label: 'policy records' }
    )
    // Newest first, so the first document seen for a person is their latest.
    documents.sort((left, right) => right.version - left.version)
    const latest = new Map<string, PolicyDocument>()
    const latestConfirmed = new Map<string, PolicyDocument>()
    for (const document of documents) {
      if (!latest.has(document.subject_id)) latest.set(document.subject_id, document)
      if (document.status === 'completed' && !latestConfirmed.has(document.subject_id)) {
        latestConfirmed.set(document.subject_id, document)
      }
    }

    const rows: PolicyStaffRow[] = staff.map((employee) => {
      const last = latest.get(employee.employee_id) ?? null
      const confirmed = latestConfirmed.get(employee.employee_id) ?? null
      let state: PolicyStaffRow['state'] = 'not_sent'
      if (confirmed && confirmed.template_version === template.version) state = 'confirmed'
      else if (last && (last.status === 'sent' || last.status === 'part_signed')) state = 'waiting'
      else if (last && last.status === 'declined') state = 'declined'
      else if (confirmed) state = 'outdated'
      return {
        employeeId: employee.employee_id,
        name: employeeName(employee) || 'Unnamed',
        email: employee.email_address,
        state,
        documentId: (state === 'confirmed' ? confirmed?.id : last?.id) ?? null,
        at: state === 'confirmed' ? confirmed?.completed_at ?? null : last?.sent_at ?? null,
        confirmedVersion: confirmed?.template_version ?? null,
      }
    })

    return {
      success: true,
      data: { slug, title: template.title, version: template.version, isActive: template.is_active, staff: rows },
    }
  } catch (error) {
    return failure(error)
  }
}

const SendPolicySchema = z.object({
  slug: SlugSchema,
  employeeIds: z.array(UuidSchema).min(1, 'Choose at least one person.').max(POLICY_BATCH_SIZE),
})

export interface PolicySendOutcome {
  sent: number
  failed: Array<{ name: string; reason: string }>
}

/**
 * Send a policy to a batch of staff to read and confirm. The page calls this repeatedly for a
 * long list. One person failing does not stop the rest; the result names who did not get it.
 */
export async function sendPolicyAcknowledgements(input: { slug: string; employeeIds: string[] }): Promise<ActionResult<PolicySendOutcome>> {
  try {
    const parsed = SendPolicySchema.safeParse(input)
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check the details and try again.' }
    const auth = await authorise('policy_acknowledgement')
    if ('error' in auth) return auth

    const outcome: PolicySendOutcome = { sent: 0, failed: [] }
    for (const employeeId of parsed.data.employeeIds) {
      const employee = await loadEmployee(employeeId)
      const name = employee ? employeeName(employee) || 'Unnamed' : 'Unknown'
      if (!employee) {
        outcome.failed.push({ name, reason: 'Employee not found.' })
        continue
      }
      try {
        const result = await sendTemplateSigningRequest({
          kind: 'policy_acknowledgement',
          slug: parsed.data.slug,
          subjectId: employee.employee_id,
          mergeValues: { worker_name: name },
          parties: [workerParty(employee)],
          user: auth.user,
          summary: 'Please read this policy and confirm you have understood it. Ask your manager about anything that is unclear.',
          seriesKey: policySeriesKey(parsed.data.slug),
        })
        const delivery = result.deliveries[0]
        if (delivery?.email_status === 'failed') {
          outcome.failed.push({ name, reason: `Created, but the email failed: ${delivery.error ?? 'unknown error'}` })
        } else {
          outcome.sent += 1
        }
        await recordSend(auth.user, 'policy_acknowledgement', employee.employee_id, result)
      } catch (error) {
        // A template that is off or unfinished stops everyone, so say so once and stop.
        if (error instanceof SigningError && error.code.startsWith('template_')) return { error: error.message }
        outcome.failed.push({ name, reason: failure(error).error })
      }
    }
    return { success: true, data: outcome }
  } catch (error) {
    return failure(error)
  }
}
