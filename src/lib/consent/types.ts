export type ConsentChannel = 'email' | 'sms' | 'whatsapp'
export type ConsentPurpose = 'service' | 'marketing'
export type ConsentStatus = 'opted_in' | 'opted_out' | 'objected' | 'unknown' | 'legacy'
export type ConsentLegalBasis = 'contract' | 'legitimate_interests' | 'consent' | 'soft_opt_in' | 'unknown'

export type ConsentSource =
  | 'public_table_booking'
  | 'public_event_booking'
  | 'public_event_waitlist'
  | 'public_private_booking'
  | 'public_parking_booking'
  | 'staff_table_booking'
  | 'staff_event_booking'
  | 'staff_private_booking'
  | 'staff_parking_booking'
  | 'customer_profile'
  | 'customer_import'
  | 'customer_lookup_legacy'
  | 'twilio_inbound_sms'
  | 'twilio_inbound_whatsapp'
  | 'direct_message'
  | 'system_migration'
  | 'gdpr_action'

export type ConsentCaptureMethod =
  | 'checkbox'
  | 'staff_verbal'
  | 'profile_toggle'
  | 'import_attestation'
  | 'api_field'
  | 'inbound_keyword'
  | 'system_migration'
  | 'service_notice'
  | 'provider_event'

type ConsentRelatedEntityType =
  | 'table_booking'
  | 'event_booking'
  | 'event_waitlist'
  | 'private_booking'
  | 'parking_booking'
  | 'customer'
  | 'message'
  | 'import'

export type CommunicationConsentPayload = {
  service_contact_notice_shown?: boolean
  marketing_email_opt_in?: boolean
  marketing_sms_opt_in?: boolean
  whatsapp_opt_in?: boolean
  marketing_whatsapp_opt_in?: boolean
  consent_text_version?: string
}

export type ConsentContext = {
  source: ConsentSource
  captureMethod: ConsentCaptureMethod
  consentTextVersion?: string | null
  consentText?: string | null
  actorUserId?: string | null
  sourceUrl?: string | null
  ipHash?: string | null
  userAgent?: string | null
  relatedEntityType?: ConsentRelatedEntityType | null
  relatedEntityId?: string | null
  metadata?: Record<string, unknown>
}

type CustomerConsentContext = ConsentContext & CommunicationConsentPayload
