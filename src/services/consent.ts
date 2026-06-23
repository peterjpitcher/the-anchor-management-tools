import { createAdminClient } from '@/lib/supabase/admin'
import {
  GUEST_COMMS_CONSENT_TEXT_VERSION,
  GUEST_SERVICE_CONTACT_NOTICE,
  GUEST_MARKETING_EMAIL_LABEL,
  GUEST_MARKETING_SMS_LABEL,
  GUEST_WHATSAPP_SERVICE_LABEL,
  GUEST_MARKETING_WHATSAPP_LABEL,
} from '@/lib/consent/constants'
import type {
  CommunicationConsentPayload,
  ConsentCaptureMethod,
  ConsentChannel,
  ConsentContext,
  ConsentLegalBasis,
  ConsentPurpose,
  ConsentSource,
  ConsentStatus,
} from '@/lib/consent/types'

type CustomerConsentState = {
  id: string
  sms_opt_in?: boolean | null
  sms_status?: string | null
  marketing_sms_opt_in?: boolean | null
  whatsapp_opt_in?: boolean | null
  whatsapp_status?: string | null
  marketing_whatsapp_opt_in?: boolean | null
  marketing_email_opt_in?: boolean | null
}

type RecordConsentInput = {
  customerId: string
  channel: ConsentChannel
  purpose: ConsentPurpose
  status: ConsentStatus
  legalBasis: ConsentLegalBasis
  source: ConsentSource
  captureMethod: ConsentCaptureMethod
  consentTextVersion?: string | null
  consentText?: string | null
  actorUserId?: string | null
  sourceUrl?: string | null
  ipHash?: string | null
  userAgent?: string | null
  relatedEntityType?: string | null
  relatedEntityId?: string | null
  metadata?: Record<string, unknown>
  updateSummary?: boolean
}

type ToggleResult = {
  oldValues: CustomerConsentState
  newValues: CustomerConsentState
}

function consentTextFor(channel: ConsentChannel, purpose: ConsentPurpose, fallback?: string | null): string | null {
  if (fallback) return fallback
  if (purpose === 'service' && channel === 'sms') return GUEST_SERVICE_CONTACT_NOTICE
  if (purpose === 'service' && channel === 'whatsapp') return GUEST_WHATSAPP_SERVICE_LABEL
  if (purpose === 'marketing' && channel === 'email') return GUEST_MARKETING_EMAIL_LABEL
  if (purpose === 'marketing' && channel === 'sms') return GUEST_MARKETING_SMS_LABEL
  if (purpose === 'marketing' && channel === 'whatsapp') return GUEST_MARKETING_WHATSAPP_LABEL
  return null
}

function defaultVersion(version?: string | null): string {
  return version || GUEST_COMMS_CONSENT_TEXT_VERSION
}

function isSmsStopped(customer: CustomerConsentState | null): boolean {
  return customer?.sms_status === 'opted_out'
}

function isWhatsAppStopped(customer: CustomerConsentState | null): boolean {
  return customer?.whatsapp_status === 'opted_out'
}

export class ConsentService {
  static async recordConsent(input: RecordConsentInput): Promise<string> {
    const admin = createAdminClient()
    const { data, error } = await ((admin as any).rpc('record_customer_consent', {
      p_customer_id: input.customerId,
      p_channel: input.channel,
      p_purpose: input.purpose,
      p_status: input.status,
      p_legal_basis: input.legalBasis,
      p_source: input.source,
      p_capture_method: input.captureMethod,
      p_consent_text_version: defaultVersion(input.consentTextVersion),
      p_consent_text: consentTextFor(input.channel, input.purpose, input.consentText),
      p_captured_by_user_id: input.actorUserId ?? null,
      p_source_url: input.sourceUrl ?? null,
      p_ip_hash: input.ipHash ?? null,
      p_user_agent: input.userAgent ?? null,
      p_related_entity_type: input.relatedEntityType ?? null,
      p_related_entity_id: input.relatedEntityId ?? null,
      p_metadata: input.metadata ?? {},
      p_update_summary: input.updateSummary !== false,
    }) as any)

    if (error) {
      throw new Error(`Failed to record customer consent: ${error.message}`)
    }

    return String(data)
  }

  static async getConsentState(customerId: string): Promise<CustomerConsentState | null> {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('customers')
      .select('id, sms_opt_in, sms_status, marketing_sms_opt_in, whatsapp_opt_in, whatsapp_status, marketing_whatsapp_opt_in, marketing_email_opt_in')
      .eq('id', customerId)
      .maybeSingle()

    if (error) {
      throw new Error(`Failed to load customer consent state: ${error.message}`)
    }

    return data as CustomerConsentState | null
  }

  static async applyBookingContactConsent(
    customerId: string,
    consent: CommunicationConsentPayload | undefined,
    context: ConsentContext
  ): Promise<void> {
    if (!consent) return

    const current = await this.getConsentState(customerId)
    if (!current) throw new Error('Customer not found')

    const base = {
      customerId,
      source: context.source,
      captureMethod: context.captureMethod,
      consentTextVersion: consent.consent_text_version || context.consentTextVersion,
      actorUserId: context.actorUserId,
      sourceUrl: context.sourceUrl,
      ipHash: context.ipHash,
      userAgent: context.userAgent,
      relatedEntityType: context.relatedEntityType,
      relatedEntityId: context.relatedEntityId,
      metadata: context.metadata,
    }

    if (consent.service_contact_notice_shown === true && !isSmsStopped(current)) {
      await this.recordConsent({
        ...base,
        channel: 'sms',
        purpose: 'service',
        status: 'opted_in',
        legalBasis: 'legitimate_interests',
        captureMethod: 'service_notice',
      })
    }

    if (consent.marketing_email_opt_in === true) {
      await this.recordConsent({
        ...base,
        channel: 'email',
        purpose: 'marketing',
        status: 'opted_in',
        legalBasis: 'consent',
        captureMethod: context.captureMethod,
      })
    }

    if (consent.marketing_sms_opt_in === true) {
      await this.recordConsent({
        ...base,
        channel: 'sms',
        purpose: 'marketing',
        status: 'opted_in',
        legalBasis: 'consent',
        captureMethod: context.captureMethod,
      })
    }

    if ((consent.whatsapp_opt_in === true || consent.marketing_whatsapp_opt_in === true) && !isWhatsAppStopped(current)) {
      await this.recordConsent({
        ...base,
        channel: 'whatsapp',
        purpose: 'service',
        status: 'opted_in',
        legalBasis: 'consent',
        captureMethod: context.captureMethod,
      })
    }

    if (consent.marketing_whatsapp_opt_in === true) {
      await this.recordConsent({
        ...base,
        channel: 'whatsapp',
        purpose: 'marketing',
        status: 'opted_in',
        legalBasis: 'consent',
        captureMethod: context.captureMethod,
      })
    }
  }

  static async applyStaffCapturedConsent(
    customerId: string,
    consent: CommunicationConsentPayload | undefined,
    actorUserId: string,
    context: ConsentContext
  ): Promise<void> {
    await this.applyBookingContactConsent(customerId, consent, {
      ...context,
      actorUserId,
    })
  }

  static async recordOptOut(
    customerId: string,
    channel: Extract<ConsentChannel, 'sms' | 'whatsapp' | 'email'>,
    source: ConsentSource,
    context: Partial<ConsentContext> = {}
  ): Promise<void> {
    if (channel === 'sms') {
      await this.recordConsent({
        customerId,
        channel: 'sms',
        purpose: 'service',
        status: 'opted_out',
        legalBasis: 'legitimate_interests',
        source,
        captureMethod: context.captureMethod || 'inbound_keyword',
        consentTextVersion: context.consentTextVersion,
        consentText: context.consentText,
        actorUserId: context.actorUserId,
        relatedEntityType: context.relatedEntityType,
        relatedEntityId: context.relatedEntityId,
        metadata: context.metadata,
      })
      await this.recordConsent({
        customerId,
        channel: 'sms',
        purpose: 'marketing',
        status: 'opted_out',
        legalBasis: 'consent',
        source,
        captureMethod: context.captureMethod || 'inbound_keyword',
        consentTextVersion: context.consentTextVersion,
        actorUserId: context.actorUserId,
        relatedEntityType: context.relatedEntityType,
        relatedEntityId: context.relatedEntityId,
        metadata: context.metadata,
        updateSummary: false,
      })
      return
    }

    if (channel === 'whatsapp') {
      await this.recordConsent({
        customerId,
        channel: 'whatsapp',
        purpose: 'service',
        status: 'opted_out',
        legalBasis: 'consent',
        source,
        captureMethod: context.captureMethod || 'inbound_keyword',
        consentTextVersion: context.consentTextVersion,
        actorUserId: context.actorUserId,
        relatedEntityType: context.relatedEntityType,
        relatedEntityId: context.relatedEntityId,
        metadata: context.metadata,
      })
      await this.recordConsent({
        customerId,
        channel: 'whatsapp',
        purpose: 'marketing',
        status: 'opted_out',
        legalBasis: 'consent',
        source,
        captureMethod: context.captureMethod || 'inbound_keyword',
        consentTextVersion: context.consentTextVersion,
        actorUserId: context.actorUserId,
        relatedEntityType: context.relatedEntityType,
        relatedEntityId: context.relatedEntityId,
        metadata: context.metadata,
        updateSummary: false,
      })
      return
    }

    await this.recordConsent({
      customerId,
      channel: 'email',
      purpose: 'marketing',
      status: 'opted_out',
      legalBasis: 'consent',
      source,
      captureMethod: context.captureMethod || 'provider_event',
      consentTextVersion: context.consentTextVersion,
      actorUserId: context.actorUserId,
      relatedEntityType: context.relatedEntityType,
      relatedEntityId: context.relatedEntityId,
      metadata: context.metadata,
    })
  }

  static async recordObjection(
    customerId: string,
    channel: ConsentChannel,
    purpose: ConsentPurpose,
    source: ConsentSource,
    context: Partial<ConsentContext> = {}
  ): Promise<void> {
    await this.recordConsent({
      customerId,
      channel,
      purpose,
      status: 'objected',
      legalBasis: purpose === 'marketing' ? 'consent' : 'legitimate_interests',
      source,
      captureMethod: context.captureMethod || 'profile_toggle',
      consentTextVersion: context.consentTextVersion,
      consentText: context.consentText,
      actorUserId: context.actorUserId,
      relatedEntityType: context.relatedEntityType,
      relatedEntityId: context.relatedEntityId,
      metadata: context.metadata,
    })
  }

  static async toggleSmsServiceOptIn(
    customerId: string,
    optIn: boolean,
    actorUserId: string
  ): Promise<ToggleResult> {
    const oldValues = await this.getConsentState(customerId)
    if (!oldValues) throw new Error('Customer not found')

    await this.recordConsent({
      customerId,
      channel: 'sms',
      purpose: 'service',
      status: optIn ? 'opted_in' : 'opted_out',
      legalBasis: 'legitimate_interests',
      source: 'customer_profile',
      captureMethod: 'profile_toggle',
      actorUserId,
      relatedEntityType: 'customer',
      relatedEntityId: customerId,
    })

    const newValues = await this.getConsentState(customerId)
    if (!newValues) throw new Error('Customer not found')
    return { oldValues, newValues }
  }

  static async toggleWhatsAppServiceOptIn(
    customerId: string,
    optIn: boolean,
    actorUserId: string
  ): Promise<ToggleResult> {
    const oldValues = await this.getConsentState(customerId)
    if (!oldValues) throw new Error('Customer not found')

    await this.recordConsent({
      customerId,
      channel: 'whatsapp',
      purpose: 'service',
      status: optIn ? 'opted_in' : 'opted_out',
      legalBasis: 'consent',
      source: 'customer_profile',
      captureMethod: 'profile_toggle',
      actorUserId,
      relatedEntityType: 'customer',
      relatedEntityId: customerId,
    })

    const newValues = await this.getConsentState(customerId)
    if (!newValues) throw new Error('Customer not found')
    return { oldValues, newValues }
  }

  static async listCustomerConsents(customerId: string) {
    const admin = createAdminClient()
    const { data, error } = await (admin.from('customer_consents') as any)
      .select('*')
      .eq('customer_id', customerId)
      .order('captured_at', { ascending: false })
      .order('event_sequence', { ascending: false })
      .limit(200)

    if (error) {
      throw new Error(`Failed to load customer consent audit: ${error.message}`)
    }

    return data || []
  }
}
