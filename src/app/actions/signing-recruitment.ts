'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { logAuditEvent } from '@/app/actions/audit'
import { formatDateInLondon, isValidIsoDate } from '@/lib/dateUtils'
import { getErrorMessage } from '@/lib/errors'
import { sendTemplateSigningRequest } from '@/lib/signing/send-template'
import { SigningError, type PartyDelivery } from '@/lib/signing/service'
import { canSendSigningKind, getSigningStaffUser } from '@/lib/signing/staff'
import { SINGLE_TEMPLATE_SLUGS } from '@/lib/signing/template-fields'
import { TemplateMergeError } from '@/lib/signing/template-render'
import { createAdminClient } from '@/lib/supabase/admin'

type ActionResult<T = undefined> = { success?: boolean; error?: string; data?: T }

const OfferSchema = z.object({
  applicationId: z.string().uuid(),
  jobTitle: z.string().trim().min(2, 'Enter the job title.').max(120),
  startDate: z.string().refine(isValidIsoDate, 'Choose a start date.'),
  payDetails: z.string().trim().min(5, 'Describe the pay.').max(2000),
})

/**
 * Send a written job offer for the candidate to accept or decline online. Only for an
 * application already at the Offered stage: this records the candidate's answer, it does not
 * make the decision to offer. Hiring them stays a separate step (Create Employee Invite).
 */
export async function sendJobOffer(input: {
  applicationId: string
  jobTitle: string
  startDate: string
  payDetails: string
}): Promise<ActionResult<{ documentId: string; deliveries: PartyDelivery[] }>> {
  try {
    const parsed = OfferSchema.safeParse(input)
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check the details and try again.' }
    const user = await getSigningStaffUser()
    if (!user) return { error: 'Unauthorized' }
    if (!(await canSendSigningKind('job_offer', user.id))) return { error: 'Insufficient permissions' }

    const admin = createAdminClient()
    const { data: application, error } = await admin
      .from('recruitment_applications')
      .select('id, status, candidate:recruitment_candidates(id, first_name, last_name, email)')
      .eq('id', parsed.data.applicationId)
      .maybeSingle()
    if (error) throw new Error(`Could not read the application: ${error.message}`)
    if (!application) return { error: 'Application not found.' }
    if (application.status !== 'offered') {
      return { error: 'Move the application to Offered first. A written offer is only sent once the decision to offer has been made.' }
    }
    const candidate = (Array.isArray(application.candidate) ? application.candidate[0] : application.candidate) as
      | { id: string; first_name: string | null; last_name: string | null; email: string | null }
      | null
    const name = [candidate?.first_name, candidate?.last_name].map((part) => part?.trim()).filter(Boolean).join(' ')
    if (!candidate || !name) return { error: 'Add the candidate\'s name first.' }
    if (!candidate.email) return { error: 'Add the candidate\'s email address first.' }

    const result = await sendTemplateSigningRequest({
      kind: 'job_offer',
      slug: SINGLE_TEMPLATE_SLUGS.job_offer,
      subjectId: application.id as string,
      mergeValues: {
        candidate_name: name,
        job_title: parsed.data.jobTitle,
        start_date: formatDateInLondon(parsed.data.startDate, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
        pay_details: parsed.data.payDetails,
      },
      parties: [{ role: 'candidate', name, email: candidate.email }],
      user,
      summary: `An offer of work at The Anchor as ${parsed.data.jobTitle}. You can accept it or decline it on this page.`,
      context: { candidate_id: candidate.id, job_title: parsed.data.jobTitle, start_date: parsed.data.startDate },
    })

    await logAuditEvent({
      user_id: user.id,
      user_email: user.email ?? undefined,
      operation_type: 'send',
      resource_type: 'signing_document',
      resource_id: result.documentId,
      operation_status: 'success',
      additional_info: { kind: 'job_offer', application_id: application.id, version: result.version },
    })
    revalidatePath('/recruitment')
    return { success: true, data: { documentId: result.documentId, deliveries: result.deliveries } }
  } catch (error) {
    if (error instanceof SigningError) return { error: error.message }
    if (error instanceof TemplateMergeError) return { error: `The offer needs details that are missing: ${error.missingFields.join(', ')}.` }
    console.error('Job offer send failed:', error)
    return { error: getErrorMessage(error) || 'Something went wrong. Please try again.' }
  }
}
