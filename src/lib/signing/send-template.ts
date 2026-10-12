import { formatDateInLondon } from '@/lib/dateUtils'
import { createSigningRequest, type CreateSigningRequestResult, type SigningPartyInput } from './service'
import type { SigningStaffUser } from './staff'
import { renderTemplateDocument } from './templates'
import type { SigningTemplateKind } from './types'

/** "12 October 2026", on the London calendar. */
export function todayForDocuments(now: Date = new Date()): string {
  return formatDateInLondon(now, { day: 'numeric', month: 'long', year: 'numeric' })
}

/**
 * Send a template kind for signature: fill the wording, render the PDF, and create the request.
 * Every template-kind send action ends here, so they all refuse the same things: a template
 * that is switched off, a template with a gap left in it, and a merge field with no value.
 */
export async function sendTemplateSigningRequest(input: {
  kind: SigningTemplateKind
  slug: string
  subjectId: string
  /** The kind's own fields. `manager_name` and `date_today` are added here. */
  mergeValues: Record<string, string | null | undefined>
  parties: SigningPartyInput[]
  user: SigningStaffUser
  summary?: string | null
  subtitle?: string | null
  seriesKey?: string
  context?: Record<string, unknown>
}): Promise<CreateSigningRequestResult> {
  const rendered = await renderTemplateDocument({
    kind: input.kind,
    slug: input.slug,
    mergeValues: {
      manager_name: input.user.name,
      date_today: todayForDocuments(),
      ...input.mergeValues,
    },
    subtitle: input.subtitle,
  })

  return createSigningRequest({
    kind: input.kind,
    subjectId: input.subjectId,
    title: rendered.title,
    summary: input.summary ?? null,
    pdf: rendered.pdf,
    parties: input.parties,
    createdBy: input.user.id,
    createdByName: input.user.name,
    seriesKey: input.seriesKey,
    templateId: rendered.template.id,
    templateVersion: rendered.template.version,
    context: { template_slug: input.slug, ...(input.context ?? {}) },
  })
}
