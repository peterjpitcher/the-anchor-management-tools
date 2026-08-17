'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { logAuditEvent } from '@/app/actions/audit'
import { checkUserPermission } from '@/app/actions/rbac'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import type { ActionType } from '@/types/rbac'
import type {
  AudiencePreview,
  BusinessContact,
  BusinessContactEngagement,
  MarketingClusterCount,
  MarketingTagCount,
} from '@/types/marketing'
import {
  createContact,
  getContact,
  getContactEngagement,
  importContacts,
  listClusters,
  listContacts,
  listContactsWithEngagement,
  listTags,
  hashEmail,
  previewAudience,
  resubscribeContact,
  setEligibility,
  setEligibilityBulk,
  unsubscribeContact,
  unsubscribeEmailAddressFromMarketing,
  updateContact,
  type ImportContactsResult,
  type ListContactsResult,
  type ListContactsWithClicksResult,
} from '@/services/marketing-contacts'

/**
 * Server actions for business contacts.
 *
 * The marketing tables are service-role only, so RBAC is the entire access control story for
 * this data. Every action below re-checks it server-side; hiding a button in the UI proves
 * nothing.
 */

type ActionResult<T = undefined> = { success?: boolean; error?: string; data?: T }

interface AuthorisedUser {
  id: string
  email: string | undefined
}

async function authorise(action: ActionType): Promise<{ user: AuthorisedUser } | { error: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { error: 'Unauthorized' }

  if (!(await checkUserPermission('marketing', action, user.id))) {
    return { error: 'Insufficient permissions' }
  }

  return { user: { id: user.id, email: user.email ?? undefined } }
}

function failureMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function revalidateContacts(): void {
  revalidatePath('/marketing')
  revalidatePath('/marketing/contacts')
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const tagsSchema = z.array(z.string().trim().min(1).max(80)).max(40)

const listSchema = z.object({
  search: z.string().max(200).optional(),
  tags: tagsSchema.optional(),
  status: z.enum(['subscribed', 'unsubscribed', 'bounced', 'complained']).optional(),
  eligibility: z.enum(['pending_review', 'eligible', 'excluded']).optional(),
  cluster: z.string().trim().max(120).optional(),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(200).optional(),
})

const contactSchema = z.object({
  email: z.string().trim().min(3).max(320),
  contactName: z.string().trim().max(200).nullable().optional(),
  firstName: z.string().trim().max(100).nullable().optional(),
  companyName: z.string().trim().max(200).nullable().optional(),
  jobTitle: z.string().trim().max(200).nullable().optional(),
  tags: tagsSchema.optional(),
  sourceDetail: z.string().trim().max(500).nullable().optional(),
  collectedAt: z.string().datetime().nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
})

const updateContactSchema = contactSchema.partial()

const eligibilitySchema = z.object({
  eligibilityStatus: z.enum(['pending_review', 'eligible', 'excluded']),
  subscriberType: z.enum(['corporate', 'individual', 'unknown']).optional(),
  marketingBasis: z.enum(['legitimate_interest', 'consent', 'soft_opt_in']).nullable().optional(),
  basisEvidence: z.string().trim().max(2000).nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
})

const unsubscribeSchema = z.object({
  reason: z.enum(['unsubscribe', 'complaint', 'bounce', 'manual', 'erasure']),
  campaignId: z.string().uuid().nullable().optional(),
  source: z.string().trim().min(1).max(100),
})

const unsubscribeEmailAddressSchema = z.string().trim().toLowerCase().email().max(320)

const audienceSchema = z.object({
  includeTags: tagsSchema.optional(),
  excludeTags: tagsSchema.optional(),
})

const importSchema = z.object({
  filename: z.string().trim().max(300).nullable().optional(),
  rows: z
    .array(
      z.object({
        rowNumber: z.number().int().min(1),
        email: z.string().max(320),
        contactName: z.string().trim().max(200).nullable().optional(),
        firstName: z.string().trim().max(100).nullable().optional(),
        companyName: z.string().trim().max(200).nullable().optional(),
        jobTitle: z.string().trim().max(200).nullable().optional(),
        tags: tagsSchema.optional(),
        sourceDetail: z.string().trim().max(500).nullable().optional(),
        notes: z.string().max(4000).nullable().optional(),
      }),
    )
    .min(1)
    .max(5000),
})

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listBusinessContacts(input: unknown): Promise<ActionResult<ListContactsResult>> {
  try {
    const context = await authorise('view')
    if ('error' in context) return { error: context.error }

    const parsed = listSchema.safeParse(input ?? {})
    if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid filters' }

    return { success: true, data: await listContacts(parsed.data) }
  } catch (error) {
    console.error('Failed to list business contacts:', error)
    return { error: failureMessage(error, 'Failed to load contacts') }
  }
}

export async function getBusinessContact(id: string): Promise<ActionResult<BusinessContact>> {
  try {
    const context = await authorise('view')
    if ('error' in context) return { error: context.error }

    const contact = await getContact(id)
    if (!contact) return { error: 'Contact not found' }

    return { success: true, data: contact }
  } catch (error) {
    console.error('Failed to load business contact:', error)
    return { error: failureMessage(error, 'Failed to load contact') }
  }
}

/**
 * The contacts list plus a lifetime click count on every row.
 *
 * A separate action from `listBusinessContacts` rather than a flag on it, because it costs two
 * more queries and not every caller wants to pay for a column it will not show.
 */
export async function listBusinessContactsWithEngagement(
  input: unknown,
): Promise<ActionResult<ListContactsWithClicksResult>> {
  try {
    const context = await authorise('view')
    if ('error' in context) return { error: context.error }

    const parsed = listSchema.safeParse(input ?? {})
    if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid filters' }

    return { success: true, data: await listContactsWithEngagement(parsed.data) }
  } catch (error) {
    console.error('Failed to list business contacts with engagement:', error)
    return { error: failureMessage(error, 'Failed to load contacts') }
  }
}

/** Lifetime clicks, deliveries, bounces and conversions for one contact. */
export async function getBusinessContactEngagement(
  id: string,
): Promise<ActionResult<BusinessContactEngagement>> {
  try {
    const context = await authorise('view')
    if ('error' in context) return { error: context.error }

    const contactId = z.string().uuid().safeParse(id)
    if (!contactId.success) return { error: 'Invalid contact id' }

    return { success: true, data: await getContactEngagement(contactId.data) }
  } catch (error) {
    console.error('Failed to load business contact engagement:', error)
    return { error: failureMessage(error, 'Failed to load engagement') }
  }
}

export async function listMarketingClusters(): Promise<ActionResult<MarketingClusterCount[]>> {
  try {
    const context = await authorise('view')
    if ('error' in context) return { error: context.error }

    return { success: true, data: await listClusters() }
  } catch (error) {
    console.error('Failed to list marketing clusters:', error)
    return { error: failureMessage(error, 'Failed to load clusters') }
  }
}

export async function listMarketingTags(): Promise<ActionResult<MarketingTagCount[]>> {
  try {
    const context = await authorise('view')
    if ('error' in context) return { error: context.error }

    return { success: true, data: await listTags() }
  } catch (error) {
    console.error('Failed to list marketing tags:', error)
    return { error: failureMessage(error, 'Failed to load tags') }
  }
}

export async function previewMarketingAudience(input: unknown): Promise<ActionResult<AudiencePreview>> {
  try {
    const context = await authorise('view')
    if ('error' in context) return { error: context.error }

    const parsed = audienceSchema.safeParse(input ?? {})
    if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid audience' }

    return { success: true, data: await previewAudience(parsed.data) }
  } catch (error) {
    console.error('Failed to preview marketing audience:', error)
    return { error: failureMessage(error, 'Failed to preview the audience') }
  }
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function createBusinessContact(input: unknown): Promise<ActionResult<BusinessContact>> {
  try {
    const context = await authorise('create')
    if ('error' in context) return { error: context.error }

    const parsed = contactSchema.safeParse(input)
    if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid contact' }

    const contact = await createContact(parsed.data, context.user.id)

    await logAuditEvent({
      user_id: context.user.id,
      user_email: context.user.email,
      operation_type: 'create',
      resource_type: 'marketing_contact',
      resource_id: contact.id,
      operation_status: 'success',
      additional_info: {
        email: contact.email,
        company_name: contact.companyName,
        is_freemail: contact.isFreemail,
      },
    })

    revalidateContacts()
    return { success: true, data: contact }
  } catch (error) {
    console.error('Failed to create business contact:', error)
    return { error: failureMessage(error, 'Failed to create the contact') }
  }
}

export async function updateBusinessContact(
  id: string,
  input: unknown,
): Promise<ActionResult<BusinessContact>> {
  try {
    const context = await authorise('edit')
    if ('error' in context) return { error: context.error }

    const parsed = updateContactSchema.safeParse(input)
    if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid contact' }

    const contact = await updateContact(id, parsed.data, context.user.id)

    await logAuditEvent({
      user_id: context.user.id,
      user_email: context.user.email,
      operation_type: 'update',
      resource_type: 'marketing_contact',
      resource_id: id,
      operation_status: 'success',
      additional_info: { fields: Object.keys(parsed.data) },
    })

    revalidateContacts()
    revalidatePath(`/marketing/contacts/${id}`)
    return { success: true, data: contact }
  } catch (error) {
    console.error('Failed to update business contact:', error)
    return { error: failureMessage(error, 'Failed to update the contact') }
  }
}

export async function setContactEligibility(
  id: string,
  input: unknown,
): Promise<ActionResult<BusinessContact>> {
  try {
    const context = await authorise('edit')
    if ('error' in context) return { error: context.error }

    const parsed = eligibilitySchema.safeParse(input)
    if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid eligibility' }

    const contact = await setEligibility(id, parsed.data, context.user.id)

    // Eligibility is the decision that makes a send lawful, so the whole decision is logged,
    // not just that something changed.
    await logAuditEvent({
      user_id: context.user.id,
      user_email: context.user.email,
      operation_type: 'update',
      resource_type: 'marketing_contact',
      resource_id: id,
      operation_status: 'success',
      additional_info: {
        change: 'eligibility',
        eligibility_status: contact.eligibilityStatus,
        subscriber_type: contact.subscriberType,
        marketing_basis: contact.marketingBasis,
        basis_evidence: contact.basisEvidence,
      },
    })

    revalidateContacts()
    revalidatePath(`/marketing/contacts/${id}`)
    return { success: true, data: contact }
  } catch (error) {
    console.error('Failed to set contact eligibility:', error)
    return { error: failureMessage(error, 'Failed to set eligibility') }
  }
}

/**
 * Applies one eligibility decision to a set of contacts.
 *
 * Capped at 200 per call so a mis-click cannot rewrite the whole list in one request, and so
 * the audit entry stays legible.
 */
export async function setContactEligibilityBulk(
  ids: unknown,
  input: unknown,
): Promise<ActionResult<{ updated: number; failures: Array<{ id: string; error: string }> }>> {
  try {
    const context = await authorise('edit')
    if ('error' in context) return { error: context.error }

    const parsedIds = z.array(z.string().uuid()).min(1).max(200).safeParse(ids)
    if (!parsedIds.success) {
      return { error: 'Select between 1 and 200 contacts' }
    }

    const parsed = eligibilitySchema.safeParse(input)
    if (!parsed.success) {
      return { error: parsed.error.errors[0]?.message ?? 'Invalid eligibility details' }
    }

    const result = await setEligibilityBulk(parsedIds.data, parsed.data, context.user.id)

    await logAuditEvent({
      user_id: context.user.id,
      operation_type: 'update',
      resource_type: 'marketing_contact',
      operation_status: result.failures.length ? 'failure' : 'success',
      additional_info: {
        bulk: true,
        requested: parsedIds.data.length,
        updated: result.updated,
        failed: result.failures.length,
        eligibility_status: parsed.data.eligibilityStatus,
        subscriber_type: parsed.data.subscriberType ?? null,
        marketing_basis: parsed.data.marketingBasis ?? null,
      },
    })

    revalidatePath('/marketing/contacts')
    return { success: true, data: result }
  } catch (error) {
    console.error('Failed to set eligibility in bulk:', error)
    return { error: failureMessage(error, 'Failed to update eligibility') }
  }
}

export async function unsubscribeBusinessContact(
  id: string,
  input: unknown,
): Promise<ActionResult<BusinessContact>> {
  try {
    const context = await authorise('edit')
    if ('error' in context) return { error: context.error }

    const parsed = unsubscribeSchema.safeParse(input)
    if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid unsubscribe' }

    const contact = await unsubscribeContact(id, parsed.data)

    await logAuditEvent({
      user_id: context.user.id,
      user_email: context.user.email,
      operation_type: 'update',
      resource_type: 'marketing_contact',
      resource_id: id,
      operation_status: 'success',
      additional_info: {
        change: 'unsubscribe',
        reason: parsed.data.reason,
        source: parsed.data.source,
        campaign_id: parsed.data.campaignId ?? null,
      },
    })

    revalidateContacts()
    revalidatePath(`/marketing/contacts/${id}`)
    return { success: true, data: contact }
  } catch (error) {
    console.error('Failed to unsubscribe business contact:', error)
    return { error: failureMessage(error, 'Failed to unsubscribe the contact') }
  }
}

export async function unsubscribeMarketingEmailAddress(
  input: unknown,
): Promise<ActionResult<Awaited<ReturnType<typeof unsubscribeEmailAddressFromMarketing>>>> {
  try {
    const context = await authorise('edit')
    if ('error' in context) return { error: context.error }

    const parsed = unsubscribeEmailAddressSchema.safeParse(input)
    if (!parsed.success) return { error: 'Enter a valid email address' }

    const result = await unsubscribeEmailAddressFromMarketing(parsed.data, context.user.id)

    await logAuditEvent({
      user_id: context.user.id,
      user_email: context.user.email,
      operation_type: 'update',
      resource_type: 'marketing_contact',
      resource_id: hashEmail(parsed.data),
      operation_status: 'success',
      additional_info: {
        change: 'unsubscribe_by_email',
        customer_matches: result.customerMatches,
        business_contact_matches: result.businessContactMatches,
        newly_unsubscribed: result.newlyUnsubscribed,
        already_unsubscribed: result.alreadyUnsubscribed,
        address_blocked: result.addressBlocked,
      },
    })

    revalidateContacts()
    return { success: true, data: result }
  } catch (error) {
    console.error('Failed to unsubscribe marketing email address:', error)
    return { error: failureMessage(error, 'Failed to unsubscribe the email address') }
  }
}

export async function resubscribeBusinessContact(
  id: string,
  note: unknown,
): Promise<ActionResult<BusinessContact>> {
  try {
    const context = await authorise('edit')
    if ('error' in context) return { error: context.error }

    const parsed = z
      .string()
      .trim()
      .min(1, 'A note recording where the consent came from is required')
      .max(2000)
      .safeParse(note)

    if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'A note is required' }

    const contact = await resubscribeContact(id, parsed.data, context.user.id)

    await logAuditEvent({
      user_id: context.user.id,
      user_email: context.user.email,
      operation_type: 'update',
      resource_type: 'marketing_contact',
      resource_id: id,
      operation_status: 'success',
      additional_info: { change: 'resubscribe', note: parsed.data },
    })

    revalidateContacts()
    revalidatePath(`/marketing/contacts/${id}`)
    return { success: true, data: contact }
  } catch (error) {
    console.error('Failed to resubscribe business contact:', error)
    return { error: failureMessage(error, 'Failed to resubscribe the contact') }
  }
}

/**
 * Deletes a contact that has never been sent to.
 *
 * A contact with send history is refused rather than deleted: the recipient rows are the
 * record of what went out, and losing them would also lose the suppression trail. Erasure of
 * a contact with history is a GDPR path, not a tidy-up, and goes through the erasure service.
 */
export async function deleteBusinessContact(id: string): Promise<ActionResult> {
  try {
    const context = await authorise('delete')
    if ('error' in context) return { error: context.error }

    const contact = await getContact(id)
    if (!contact) return { error: 'Contact not found' }

    const supabase = createAdminClient()
    const { count, error: historyError } = await supabase
      .from('marketing_campaign_recipients')
      .select('id', { count: 'exact', head: true })
      .eq('contact_id', id)
      .in('status', ['sent', 'sending', 'needs_review'])

    if (historyError) return { error: historyError.message }

    if ((count ?? 0) > 0) {
      return {
        error: 'This contact has been sent to, so it cannot be deleted. Unsubscribe it instead.',
      }
    }

    const { error } = await supabase.from('business_contacts').delete().eq('id', id)
    if (error) return { error: error.message }

    await logAuditEvent({
      user_id: context.user.id,
      user_email: context.user.email,
      operation_type: 'delete',
      resource_type: 'marketing_contact',
      resource_id: id,
      operation_status: 'success',
      additional_info: { email: contact.email, company_name: contact.companyName },
    })

    revalidateContacts()
    return { success: true }
  } catch (error) {
    console.error('Failed to delete business contact:', error)
    return { error: failureMessage(error, 'Failed to delete the contact') }
  }
}

export async function importBusinessContacts(
  input: unknown,
): Promise<ActionResult<ImportContactsResult>> {
  try {
    const context = await authorise('create')
    if ('error' in context) return { error: context.error }

    const parsed = importSchema.safeParse(input)
    if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid import' }

    const result = await importContacts(parsed.data, context.user.id)

    await logAuditEvent({
      user_id: context.user.id,
      user_email: context.user.email,
      operation_type: 'create',
      resource_type: 'marketing_contact',
      resource_id: result.batchId,
      operation_status: 'success',
      additional_info: {
        change: 'import',
        filename: parsed.data.filename ?? null,
        row_count: parsed.data.rows.length,
        imported: result.imported,
        skipped: result.skipped,
        flagged_freemail: result.flaggedFreemail,
      },
    })

    revalidateContacts()
    return { success: true, data: result }
  } catch (error) {
    console.error('Failed to import business contacts:', error)
    return { error: failureMessage(error, 'Failed to import contacts') }
  }
}

function toCsvValue(value: string | null): string {
  const text = value ?? ''
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export async function exportBusinessContacts(input: unknown): Promise<ActionResult<string>> {
  try {
    const context = await authorise('export')
    if ('error' in context) return { error: context.error }

    const parsed = listSchema.safeParse(input ?? {})
    if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid filters' }

    // An export is the whole filtered set, not the page on screen, so it walks the pages. The
    // cap is a guard against a runaway query rather than a real list size.
    const contacts: BusinessContact[] = []
    for (let page = 1; page <= 50; page += 1) {
      const batch = await listContacts({ ...parsed.data, page, pageSize: 200 })
      contacts.push(...batch.contacts)
      if (contacts.length >= batch.total || batch.contacts.length < 200) break
    }

    const header = [
      'email',
      'contact_name',
      'first_name',
      'company_name',
      'job_title',
      'tags',
      'eligibility_status',
      'marketing_basis',
      'marketing_status',
      'is_freemail',
      'last_marketing_email_at',
    ]

    const lines = [header.join(',')]
    for (const contact of contacts) {
      lines.push(
        [
          toCsvValue(contact.email),
          toCsvValue(contact.contactName),
          toCsvValue(contact.firstName),
          toCsvValue(contact.companyName),
          toCsvValue(contact.jobTitle),
          toCsvValue(contact.tags.join(' ')),
          toCsvValue(contact.eligibilityStatus),
          toCsvValue(contact.marketingBasis),
          toCsvValue(contact.marketingStatus),
          toCsvValue(contact.isFreemail ? 'yes' : 'no'),
          toCsvValue(contact.lastMarketingEmailAt),
        ].join(','),
      )
    }

    await logAuditEvent({
      user_id: context.user.id,
      user_email: context.user.email,
      operation_type: 'export',
      resource_type: 'marketing_contact',
      operation_status: 'success',
      additional_info: { rows: contacts.length, filters: parsed.data },
    })

    return { success: true, data: lines.join('\n') }
  } catch (error) {
    console.error('Failed to export business contacts:', error)
    return { error: failureMessage(error, 'Failed to export contacts') }
  }
}
