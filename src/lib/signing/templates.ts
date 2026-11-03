import { createAdminClient } from '@/lib/supabase/admin'
import { getSigningKind, signingRoleLabel } from './kinds'
import { SigningError } from './service'
import { findDraftMarkers, mergeTemplateText, renderTemplateDocumentHtml } from './template-render'
import type { SigningPartyRole, SigningTemplateKind, SigningTemplateRow } from './types'

/**
 * Wording for the document kinds that have no generator of their own. One row per template in
 * signing_templates; policies have one row each.
 */

export async function listSigningTemplates(): Promise<SigningTemplateRow[]> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('signing_templates')
    .select('*')
    .order('kind', { ascending: true })
    .order('title', { ascending: true })
  if (error) throw new Error(`Could not read the templates: ${error.message}`)
  return (data ?? []) as SigningTemplateRow[]
}

export async function getSigningTemplateBySlug(slug: string): Promise<SigningTemplateRow | null> {
  const admin = createAdminClient()
  const { data, error } = await admin.from('signing_templates').select('*').eq('slug', slug).maybeSingle()
  if (error) throw new Error(`Could not read the template: ${error.message}`)
  return (data as SigningTemplateRow | null) ?? null
}

/**
 * The policy acknowledgements the staff training courses replaced (owner decision, 2 November
 * 2026; tasks/plan-2026-11-02-staff-training-build.md, section 2.4). Migration
 * 20261103090300_retire_policy_drafts_replaced_by_training.sql switched each one off and put a
 * `[[RETIRED: ...]]` line at the top of its wording, but whoever edits the wording can delete that
 * line. This list cannot be edited away: these templates are never switched on, rendered or sent
 * again, whatever their wording says.
 */
export const RETIRED_TEMPLATE_SLUGS: readonly string[] = ['health-and-safety', 'allergens', 'challenge-25', 'data-protection']

/** What staff are told when one of the retired templates is refused. */
export const RETIRED_TEMPLATE_MESSAGE =
  'This policy was replaced by staff training, so it cannot be switched on or sent. Staff now learn it, and confirm it, in their training courses.'

/** True for a template the staff training courses replaced (see RETIRED_TEMPLATE_SLUGS). */
export function isRetiredTemplateSlug(slug: string | null | undefined): boolean {
  return typeof slug === 'string' && RETIRED_TEMPLATE_SLUGS.includes(slug.trim().toLowerCase())
}

/**
 * Why a template cannot be switched on, or null when it can. A template with a gap still marked
 * `[[TO CONFIRM: ...]]` is a draft, and a draft must never reach a signer. A template that staff
 * training replaced can never be switched on: pass its slug, or that is not checked.
 */
export function templateActivationBlocker(
  template: Pick<SigningTemplateRow, 'title' | 'body'> & Partial<Pick<SigningTemplateRow, 'slug'>>
): string | null {
  if (isRetiredTemplateSlug(template.slug)) return RETIRED_TEMPLATE_MESSAGE
  if (!template.title.trim()) return 'The template needs a title.'
  if (template.body.trim().length < 40) return 'The template has no wording yet.'
  const markers = [...findDraftMarkers(template.title), ...findDraftMarkers(template.body)]
  if (markers.length > 0) {
    return `Fill in or remove ${markers.length === 1 ? 'this gap' : `these ${markers.length} gaps`} first: ${markers.slice(0, 5).join(' ')}${markers.length > 5 ? ' ...' : ''}`
  }
  return null
}

export interface RenderedTemplateDocument {
  template: SigningTemplateRow
  title: string
  /** The document's HTML, with a signature slot for each person who signs. */
  html: string
  /** Which party fills which slot. */
  slots: Record<string, SigningPartyRole>
}

/** The slot key a template document uses for a role. */
export function templateSlotKey(role: SigningPartyRole): string {
  return `doc:${role}`
}

/**
 * Build the document for a template kind, as HTML ready to be prepared for signing. Refuses a
 * template that staff training replaced, a template that is switched off, a template that still
 * has gaps, and any merge field with no value: a document goes out complete or not at all.
 */
export async function renderTemplateDocument(input: {
  kind: SigningTemplateKind
  slug: string
  mergeValues: Record<string, string | null | undefined>
  subtitle?: string | null
}): Promise<RenderedTemplateDocument> {
  // Refused before the row is read, so no wording or switch in the database can bring it back.
  // Every send of a template kind comes through here (send-template.ts).
  if (isRetiredTemplateSlug(input.slug)) {
    throw new SigningError('template_retired', RETIRED_TEMPLATE_MESSAGE)
  }
  const template = await getSigningTemplateBySlug(input.slug)
  if (!template || template.kind !== input.kind) {
    throw new SigningError('template_missing', 'There is no template for this document.')
  }
  if (!template.is_active) {
    throw new SigningError(
      'template_inactive',
      `The "${template.title}" template is switched off. Check its wording and switch it on in Settings, Signing templates.`
    )
  }
  const blocker = templateActivationBlocker(template)
  if (blocker) {
    throw new SigningError('template_incomplete', `The "${template.title}" template is not finished. ${blocker}`)
  }

  const definition = getSigningKind(input.kind)
  // Everyone who signs gets a slot at the end of the document: the signers, then the business
  // where it signs too.
  const roles: SigningPartyRole[] = [...definition.signerRoles, ...(definition.companySigns ? ['company' as const] : [])]
  const slots: Record<string, SigningPartyRole> = {}
  for (const role of roles) slots[templateSlotKey(role)] = role

  const title = mergeTemplateText(template.title, input.mergeValues)
  const mergedBody = mergeTemplateText(template.body, input.mergeValues)
  const html = renderTemplateDocumentHtml({
    brand: definition.brand,
    title,
    subtitle: input.subtitle,
    mergedBody,
    // Printed in the footer, so a paper copy can be matched to the wording it was made from.
    reference: `${template.slug}, version ${template.version}`,
    signatures: roles.map((role) => ({ slotKey: templateSlotKey(role), heading: signingRoleLabel(role) })),
    mode: definition.mode,
  })
  return { template, title, html, slots }
}
