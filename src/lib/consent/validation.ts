import { z } from 'zod'
import { GUEST_COMMS_CONSENT_TEXT_VERSION } from '@/lib/consent/constants'
import type { CommunicationConsentPayload } from '@/lib/consent/types'

const CommunicationConsentSchema = z.object({
  service_contact_notice_shown: z.boolean().optional(),
  marketing_email_opt_in: z.boolean().optional(),
  marketing_sms_opt_in: z.boolean().optional(),
  whatsapp_opt_in: z.boolean().optional(),
  marketing_whatsapp_opt_in: z.boolean().optional(),
  consent_text_version: z.string().trim().min(1).max(120).optional(),
}).strict()

export const OptionalCommunicationConsentSchema = CommunicationConsentSchema.optional()

function normalizeCommunicationConsent(
  input: unknown
): CommunicationConsentPayload | undefined {
  if (input === undefined || input === null) {
    return undefined
  }

  const parsed = CommunicationConsentSchema.parse(input)
  return {
    service_contact_notice_shown: parsed.service_contact_notice_shown === true,
    marketing_email_opt_in: parsed.marketing_email_opt_in === true,
    marketing_sms_opt_in: parsed.marketing_sms_opt_in === true,
    whatsapp_opt_in: parsed.whatsapp_opt_in === true,
    marketing_whatsapp_opt_in: parsed.marketing_whatsapp_opt_in === true,
    consent_text_version: parsed.consent_text_version || GUEST_COMMS_CONSENT_TEXT_VERSION,
  }
}

export function consentHashPayload(payload: CommunicationConsentPayload | undefined) {
  return {
    service_contact_notice_shown: payload?.service_contact_notice_shown === true,
    marketing_email_opt_in: payload?.marketing_email_opt_in === true,
    marketing_sms_opt_in: payload?.marketing_sms_opt_in === true,
    whatsapp_opt_in: payload?.whatsapp_opt_in === true,
    marketing_whatsapp_opt_in: payload?.marketing_whatsapp_opt_in === true,
    consent_text_version: payload?.consent_text_version || GUEST_COMMS_CONSENT_TEXT_VERSION,
  }
}
