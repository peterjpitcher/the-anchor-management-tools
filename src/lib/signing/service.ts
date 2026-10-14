import crypto from 'crypto'
import { reportCronFailure } from '@/lib/cron/alerting'
import { sendEmail } from '@/lib/email/emailService'
import { invoiceEmailRouting } from '@/lib/email/invoice-sender'
import { getAppUrl } from '@/lib/env'
import { logger } from '@/lib/logger'
import { closePdfBrowser, createPdfBrowser, generatePDFFromHTML } from '@/lib/pdf-generator'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildAgreedText, buildCompanyAgreedText, isAcceptableTypedName } from './agreement-text'
import { appendCertificate, renderCertificateHtml, type CertificateParty } from './certificate'
import { runCompletionHook } from './completion-hooks'
import {
  buildSigningCompletedEmail,
  buildSigningRequestEmail,
  buildSigningStaffNoticeEmail,
} from './emails'
import { getSigningKind } from './kinds'
import { isUntrustedRender, readSigningRenderSpec, renderSigningPdf, type SigningRenderInput, type SigningRenderSpec } from './render'
import { fillSignatureSlots } from './signature-slots'
import { buildSignedFills, signingReference } from './slot-fills'
import { findSubjectClosure } from './subject-state'
import { describeSigningSubject } from './subjects'
import { buildSigningUrl, generateSigningToken, hashSigningToken, isWellFormedSigningToken, sha256Hex } from './tokens'
import {
  SIGNED_DOCUMENTS_BUCKET,
  SIGNING_EXPIRY_DAYS,
  SIGNING_OPEN_STATUSES,
  type SigningDocumentRow,
  type SigningEventName,
  type SigningEvidence,
  type SigningIdentityCheck,
  type SigningKind,
  type SigningMethod,
  type SigningPartyRole,
  type SigningPartyRow,
} from './types'

/**
 * Sending, signing, declining and completing documents. Everything here runs with the service
 * role: the callers (server actions, the public signing endpoints, the staff portal, the cron)
 * have already decided who is asking.
 */

type AdminClient = ReturnType<typeof createAdminClient>

const DAY_MS = 24 * 60 * 60 * 1000
/** A link handed over on a venue device is good for half an hour and no longer. */
const IN_PERSON_LINK_MINUTES = 30
/** After this many wrong dates of birth the link is locked and staff must send a new one. */
export const MAX_IDENTITY_CHECK_FAILURES = 5

const NO_EVIDENCE: SigningEvidence = { ip: null, userAgent: null, city: null, region: null, country: null }

export class SigningError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
    this.name = 'SigningError'
  }
}

function sourcePath(document: Pick<SigningDocumentRow, 'id' | 'subject_type' | 'subject_id'>): string {
  return `${document.subject_type}/${document.subject_id}/${document.id}/document.pdf`
}

function sourceHtmlPath(document: Pick<SigningDocumentRow, 'id' | 'subject_type' | 'subject_id'>): string {
  return `${document.subject_type}/${document.subject_id}/${document.id}/document.html`
}

function finalPath(document: Pick<SigningDocumentRow, 'id' | 'subject_type' | 'subject_id'>): string {
  return `${document.subject_type}/${document.subject_id}/${document.id}/signed.pdf`
}

/** Raise something visible on our side. Never throws: an alert that fails must not mask the fault. */
async function alertSigningFault(what: string, error: unknown, context: Record<string, unknown>): Promise<void> {
  logger.error(`Signing: ${what}`, {
    error: error instanceof Error ? error : new Error(String(error)),
    metadata: context,
  })
  try {
    await reportCronFailure(`signing: ${what}`, error, context)
  } catch {
    // The log line above is the record.
  }
}

async function insertEvent(
  admin: AdminClient,
  input: {
    documentId: string
    partyId?: string | null
    event: SigningEventName
    actorUserId?: string | null
    evidence?: SigningEvidence
    meta?: Record<string, unknown>
  }
): Promise<void> {
  const evidence = input.evidence ?? NO_EVIDENCE
  const { error } = await admin.from('signing_events').insert({
    document_id: input.documentId,
    party_id: input.partyId ?? null,
    event: input.event,
    actor_user_id: input.actorUserId ?? null,
    ip: evidence.ip,
    user_agent: evidence.userAgent,
    city: evidence.city,
    region: evidence.region,
    country: evidence.country,
    meta: input.meta ?? {},
  })
  if (error) {
    throw new Error(`Could not write signing event ${input.event}: ${error.message}`)
  }
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

export interface SigningPartyInput {
  role: Exclude<SigningPartyRole, 'company'>
  name: string
  /** Where the link goes. Leave out for someone who will sign in person or in the portal. */
  email?: string | null
  phone?: string | null
  employeeId?: string | null
  customerId?: string | null
  identityCheck?: SigningIdentityCheck
}

export interface CreateSigningRequestInput {
  kind: SigningKind
  subjectId: string
  title: string
  summary?: string | null
  /** The exact PDF the signers will be shown. */
  pdf: Buffer
  parties: SigningPartyInput[]
  /** The staff member sending it. They are also the business's signatory where the kind has one. */
  createdBy: string
  createdByName: string
  /** Their job title, printed beside their name where the business signs. */
  createdByPosition?: string | null
  /**
   * The HTML the PDF was rendered from, with its signature slots marked, so the signed copy
   * can show each signature in place (src/lib/signing/signature-slots.ts). Without it the
   * signed copy is the PDF as sent plus the signing record page.
   */
  render?: SigningRenderInput
  /** Defaults to the kind. See signing_documents.series_key. */
  seriesKey?: string
  templateId?: string | null
  templateVersion?: number | null
  context?: Record<string, unknown>
  /**
   * False when the caller puts the link in an email of its own (the private booking contract
   * email does). The links come back in `deliveries`, and the caller reports each one it sends
   * with recordSigningLinkSent. Defaults to true.
   */
  sendLinkEmails?: boolean
}

export interface PartyDelivery {
  partyId: string
  name: string
  email: string | null
  /**
   * `sent`, `failed`, `none` when there was no address to send to, or `caller_sends` when the
   * caller asked to send the link itself.
   */
  email_status: 'sent' | 'failed' | 'none' | 'caller_sends'
  error?: string
  /** Only with `caller_sends`. Never stored, and never returned to a browser. */
  signingUrl?: string
}

export interface CreateSigningRequestResult {
  documentId: string
  version: number
  deliveries: PartyDelivery[]
}

function emailRoutingFor(document: Pick<SigningDocumentRow, 'subject_type'>): {
  from?: string
  replyTo?: string
  provider?: 'graph'
} {
  // Orange Jelly's own clients hear from Orange Jelly, the same identity their invoices and
  // quotes come from (owner decision, 28 August 2026).
  if (document.subject_type === 'invoice_vendor' || document.subject_type === 'quote') {
    return invoiceEmailRouting()
  }
  return {}
}

async function sendSigningLinkEmail(input: {
  document: SigningDocumentRow
  party: Pick<SigningPartyRow, 'id' | 'name' | 'email' | 'customer_id'>
  rawToken: string
  expiresAt: string
  isReminder: boolean
}): Promise<{ success: boolean; error?: string; uncertain?: boolean }> {
  if (!input.party.email) {
    return { success: false, error: 'No email address' }
  }
  const email = buildSigningRequestEmail({
    brand: input.document.brand,
    mode: input.document.mode,
    recipientName: input.party.name,
    title: input.document.title,
    signingUrl: buildSigningUrl(input.rawToken),
    expiresAt: input.expiresAt,
    isReminder: input.isReminder,
  })
  // A signing link is never copied to anyone else: whoever holds it can sign.
  const result = await sendEmail({
    to: input.party.email,
    subject: email.subject,
    html: email.html,
    text: email.text,
    commType: 'signing_request',
    customerId: input.party.customer_id,
    privateBookingId: input.document.subject_type === 'private_booking' ? input.document.subject_id : null,
    quoteId: input.document.subject_type === 'quote' ? input.document.subject_id : null,
    metadata: { signing_document_id: input.document.id, signing_party_id: input.party.id },
    // The stored copy of this email must not hold a working link.
    logRedactions: [input.rawToken],
    ...emailRoutingFor(input.document),
  })
  return result.success
    ? { success: true }
    : { success: false, error: result.error ?? 'Email failed', uncertain: result.uncertain === true }
}

/**
 * Send a document for signature.
 *
 * The PDF is stored and fingerprinted first, then the rows are written, then the links go out.
 * A link that fails to send does not undo the request: the result says which emails failed, so
 * staff can resend or have the person sign in person.
 */
export async function createSigningRequest(input: CreateSigningRequestInput): Promise<CreateSigningRequestResult> {
  const definition = getSigningKind(input.kind)
  if (input.parties.length === 0) {
    throw new SigningError('no_parties', 'There is nobody to sign this document.')
  }
  for (const party of input.parties) {
    if (!party.name.trim()) {
      throw new SigningError('party_name_missing', 'Every signer needs a name.')
    }
  }
  if (input.pdf.length === 0) {
    throw new SigningError('empty_document', 'The document is empty.')
  }

  const admin = createAdminClient()
  const seriesKey = input.seriesKey ?? input.kind
  const subject = { subject_type: definition.subjectType, subject_id: input.subjectId }

  const { data: latest, error: latestError } = await admin
    .from('signing_documents')
    .select('version')
    .eq('subject_type', subject.subject_type)
    .eq('subject_id', subject.subject_id)
    .eq('series_key', seriesKey)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (latestError) {
    throw new Error(`Could not read earlier versions: ${latestError.message}`)
  }
  const version = ((latest?.version as number | undefined) ?? 0) + 1

  const documentId = crypto.randomUUID()
  const storagePath = sourcePath({ id: documentId, ...subject })
  const sourceSha = sha256Hex(input.pdf)
  const now = new Date()
  const expiresAt = new Date(now.getTime() + SIGNING_EXPIRY_DAYS * DAY_MS).toISOString()

  const { error: uploadError } = await admin.storage
    .from(SIGNED_DOCUMENTS_BUCKET)
    .upload(storagePath, input.pdf, { contentType: 'application/pdf', upsert: false })
  if (uploadError) {
    throw new Error(`Could not store the document: ${uploadError.message}`)
  }

  const context: Record<string, unknown> = { ...(input.context ?? {}) }
  if (input.createdByPosition) context.sender_position = input.createdByPosition
  if (input.render) {
    const htmlPath = sourceHtmlPath({ id: documentId, ...subject })
    const htmlBuffer = Buffer.from(input.render.html, 'utf-8')
    const { error: htmlError } = await admin.storage
      .from(SIGNED_DOCUMENTS_BUCKET)
      .upload(htmlPath, htmlBuffer, { contentType: 'text/html; charset=utf-8', upsert: false })
    if (htmlError) {
      throw new Error(`Could not store the document source: ${htmlError.message}`)
    }
    const spec: SigningRenderSpec = {
      htmlPath,
      // The signed copy is rendered from this file, so it is fingerprinted like the PDF.
      htmlSha256: sha256Hex(htmlBuffer),
      profile: input.render.profile,
      pages: input.render.pages,
      slots: input.render.slots,
      hasInitials: input.render.hasInitials === true,
    }
    context.render = spec
  }

  const { data: inserted, error: insertError } = await admin
    .from('signing_documents')
    .insert({
      id: documentId,
      kind: input.kind,
      mode: definition.mode,
      brand: definition.brand,
      title: input.title,
      summary: input.summary ?? null,
      subject_type: subject.subject_type,
      subject_id: subject.subject_id,
      series_key: seriesKey,
      version,
      template_id: input.templateId ?? null,
      template_version: input.templateVersion ?? null,
      context,
      status: 'sent',
      source_pdf_path: storagePath,
      source_sha256: sourceSha,
      expires_at: expiresAt,
      sent_at: now.toISOString(),
      created_by: input.createdBy,
    })
    .select('*')
    .single()
  if (insertError || !inserted) {
    throw new Error(`Could not record the document: ${insertError?.message ?? 'no row returned'}`)
  }
  const document = inserted as SigningDocumentRow

  const tokens = new Map<number, string>()
  const partyRows = input.parties.map((party, index) => {
    const email = party.email?.trim() || null
    let hashedToken: string | null = null
    if (email) {
      const rawToken = generateSigningToken()
      tokens.set(index, rawToken)
      hashedToken = hashSigningToken(rawToken)
    }
    return {
      document_id: documentId,
      role: party.role,
      name: party.name.trim(),
      email,
      phone: party.phone?.trim() || null,
      employee_id: party.employeeId ?? null,
      customer_id: party.customerId ?? null,
      hashed_token: hashedToken,
      token_expires_at: hashedToken ? expiresAt : null,
      identity_check: party.identityCheck ?? 'none',
    }
  })

  const { data: insertedParties, error: partiesError } = await admin
    .from('signing_parties')
    .insert(partyRows)
    .select('*')
  if (partiesError || !insertedParties || insertedParties.length !== partyRows.length) {
    // A document with nobody to sign it must not sit there looking live.
    await admin
      .from('signing_documents')
      .update({ status: 'voided', voided_at: new Date().toISOString(), void_reason: 'Could not be set up' })
      .eq('id', documentId)
    throw new Error(`Could not record the signers: ${partiesError?.message ?? 'row count mismatch'}`)
  }
  const parties = insertedParties as SigningPartyRow[]

  await insertEvent(admin, {
    documentId,
    event: 'created',
    actorUserId: input.createdBy,
    meta: { version, source_sha256: sourceSha, kind: input.kind },
  })

  if (definition.companySigns) {
    // If the business side cannot be recorded the request is withdrawn: left open, the worker
    // could complete it in the portal with no business signature on it.
    const withdraw = async (reason: string): Promise<void> => {
      await admin
        .from('signing_documents')
        .update({ status: 'voided', voided_at: new Date().toISOString(), void_reason: reason })
        .eq('id', documentId)
    }
    const { data: companyParty, error: companyError } = await admin
      .from('signing_parties')
      .insert({
        document_id: documentId,
        role: 'company',
        name: input.createdByName,
        auth_user_id: input.createdBy,
      })
      .select('id')
      .single()
    if (companyError || !companyParty) {
      await withdraw('Could not be set up')
      throw new Error(`Could not record the business signatory: ${companyError?.message ?? 'no row returned'}`)
    }
    const { data: signed, error: signError } = await admin.rpc('signing_record_signature', {
      p_party_id: companyParty.id,
      p_typed_name: input.createdByName,
      p_agreed_text: buildCompanyAgreedText({ title: input.title }),
      p_method: 'sender',
      p_auth_user_id: input.createdBy,
    })
    if (signError || !(signed as { ok?: boolean } | null)?.ok) {
      await withdraw('Could not be set up')
      throw new Error(`Could not sign for the business: ${signError?.message ?? JSON.stringify(signed)}`)
    }
  }

  // Earlier unsigned requests in the same series are dead the moment a newer version goes out.
  // A completed earlier version stays the one in force until this one is signed.
  const { data: replaced } = await admin
    .from('signing_documents')
    .update({
      status: 'voided',
      voided_at: new Date().toISOString(),
      voided_by: input.createdBy,
      void_reason: `Replaced by version ${version}`,
    })
    .eq('subject_type', subject.subject_type)
    .eq('subject_id', subject.subject_id)
    .eq('series_key', seriesKey)
    .in('status', [...SIGNING_OPEN_STATUSES])
    .neq('id', documentId)
    .select('id')
  for (const row of replaced ?? []) {
    await insertEvent(admin, {
      documentId: row.id as string,
      event: 'voided',
      actorUserId: input.createdBy,
      meta: { reason: `Replaced by version ${version}`, replaced_by: documentId },
    })
  }

  const deliveries: PartyDelivery[] = []
  for (const [index, party] of parties.entries()) {
    const rawToken = tokens.get(index)
    if (!rawToken || !party.email) {
      deliveries.push({ partyId: party.id, name: party.name, email: null, email_status: 'none' })
      continue
    }
    if (input.sendLinkEmails === false) {
      deliveries.push({
        partyId: party.id,
        name: party.name,
        email: party.email,
        email_status: 'caller_sends',
        signingUrl: buildSigningUrl(rawToken),
      })
      continue
    }
    const sent = await sendSigningLinkEmail({ document, party, rawToken, expiresAt, isReminder: false })
    deliveries.push({
      partyId: party.id,
      name: party.name,
      email: party.email,
      email_status: sent.success ? 'sent' : 'failed',
      error: sent.success ? undefined : sent.error,
    })
    if (sent.success) {
      await insertEvent(admin, {
        documentId,
        partyId: party.id,
        event: 'sent',
        actorUserId: input.createdBy,
        meta: { to: party.email },
      })
    }
  }

  return { documentId, version, deliveries }
}

/** For a caller that sent the link in its own email: note it on the evidence trail. */
export async function recordSigningLinkSent(input: {
  documentId: string
  partyId: string
  to: string
  userId: string | null
}): Promise<void> {
  await insertEvent(createAdminClient(), {
    documentId: input.documentId,
    partyId: input.partyId,
    event: 'sent',
    actorUserId: input.userId,
    meta: { to: input.to },
  })
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export interface SigningPartyContext {
  party: SigningPartyRow
  document: SigningDocumentRow
}

async function loadDocument(admin: AdminClient, documentId: string): Promise<SigningDocumentRow | null> {
  const { data, error } = await admin.from('signing_documents').select('*').eq('id', documentId).maybeSingle()
  if (error) throw new Error(`Could not read the document: ${error.message}`)
  return (data as SigningDocumentRow | null) ?? null
}

async function loadParties(admin: AdminClient, documentId: string): Promise<SigningPartyRow[]> {
  const { data, error } = await admin
    .from('signing_parties')
    .select('*')
    .eq('document_id', documentId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(`Could not read the signers: ${error.message}`)
  return (data ?? []) as SigningPartyRow[]
}

/** The party and document behind a signing link, or null when the link is not one of ours. */
export async function getSigningPartyByToken(rawToken: string): Promise<SigningPartyContext | null> {
  if (!isWellFormedSigningToken(rawToken)) return null
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('signing_parties')
    .select('*')
    .eq('hashed_token', hashSigningToken(rawToken))
    .maybeSingle()
  if (error) throw new Error(`Could not read the signing link: ${error.message}`)
  if (!data) return null
  const party = data as SigningPartyRow
  const document = await loadDocument(admin, party.document_id)
  return document ? { party, document } : null
}

export async function getSigningPartyById(partyId: string): Promise<SigningPartyContext | null> {
  const admin = createAdminClient()
  const { data, error } = await admin.from('signing_parties').select('*').eq('id', partyId).maybeSingle()
  if (error) throw new Error(`Could not read the signer: ${error.message}`)
  if (!data) return null
  const party = data as SigningPartyRow
  const document = await loadDocument(admin, party.document_id)
  return document ? { party, document } : null
}

/**
 * Other documents still waiting for this same person, on the same record: the food agreement
 * that goes with a booking contract, or a second policy. The signing screen names them, so
 * someone who has signed one document is not left thinking they have finished.
 */
export async function listOtherDocumentsToSign(context: SigningPartyContext): Promise<string[]> {
  const { party, document } = context
  const admin = createAdminClient()
  const { data: documents, error } = await admin
    .from('signing_documents')
    .select('id, title, expires_at')
    .eq('subject_type', document.subject_type)
    .eq('subject_id', document.subject_id)
    .in('status', [...SIGNING_OPEN_STATUSES])
    .neq('id', document.id)
    .limit(50)
  if (error) throw new Error(`Could not read the other documents: ${error.message}`)
  const open = ((documents ?? []) as Array<{ id: string; title: string; expires_at: string }>).filter(
    (other) => new Date(other.expires_at).getTime() > Date.now()
  )
  if (open.length === 0) return []

  const { data: parties, error: partiesError } = await admin
    .from('signing_parties')
    .select('document_id, email, employee_id, role, status')
    .in('document_id', open.map((other) => other.id))
    .eq('status', 'pending')
  if (partiesError) throw new Error(`Could not read the other signers: ${partiesError.message}`)

  const email = party.email?.trim().toLowerCase() ?? null
  const mine = new Set(
    ((parties ?? []) as Array<{ document_id: string; email: string | null; employee_id: string | null; role: string }>)
      .filter((other) => {
        if (other.role !== party.role) return false
        if (party.employee_id && other.employee_id === party.employee_id) return true
        return Boolean(email) && other.email?.trim().toLowerCase() === email
      })
      .map((other) => other.document_id)
  )
  return open.filter((other) => mine.has(other.id)).map((other) => other.title)
}

export type SigningPartyState =
  | 'ready'
  | 'needs_identity_check'
  | 'locked'
  | 'signed'
  | 'declined'
  | 'link_expired'
  | 'expired'
  | 'voided'
  | 'superseded'
  | 'document_declined'

/** What the signer should see. `via` matters because only a link can expire or need a date of birth. */
export function resolveSigningPartyState(
  context: SigningPartyContext,
  via: 'link' | 'portal',
  now: Date = new Date()
): SigningPartyState {
  const { party, document } = context
  if (party.status === 'signed') return 'signed'
  if (party.status === 'declined') return 'declined'
  if (document.status === 'voided') return 'voided'
  if (document.status === 'superseded') return 'superseded'
  if (document.status === 'declined') return 'document_declined'
  if (document.status === 'expired' || new Date(document.expires_at).getTime() <= now.getTime()) return 'expired'
  if (via === 'link') {
    if (!party.token_expires_at || new Date(party.token_expires_at).getTime() <= now.getTime()) return 'link_expired'
    // A manager is standing beside them, so the date of birth check is not needed.
    if (party.identity_check !== 'none' && !party.identity_checked_at && !party.witnessed_by) {
      return party.identity_check_failures >= MAX_IDENTITY_CHECK_FAILURES ? 'locked' : 'needs_identity_check'
    }
  }
  return 'ready'
}

/** Note that the link was opened. Only the first opening is kept. */
export async function recordSigningOpened(context: SigningPartyContext, evidence: SigningEvidence): Promise<void> {
  if (context.party.first_opened_at) return
  const admin = createAdminClient()
  const { data } = await admin
    .from('signing_parties')
    .update({ first_opened_at: new Date().toISOString() })
    .eq('id', context.party.id)
    .is('first_opened_at', null)
    .select('id')
  if (data && data.length > 0) {
    await insertEvent(admin, {
      documentId: context.document.id,
      partyId: context.party.id,
      event: 'opened',
      evidence,
    })
  }
}

/** The exact PDF sent for signature, checked against its fingerprint before it is served. */
export async function readSourcePdf(document: SigningDocumentRow): Promise<Buffer> {
  const admin = createAdminClient()
  const { data, error } = await admin.storage.from(SIGNED_DOCUMENTS_BUCKET).download(document.source_pdf_path)
  if (error || !data) {
    throw new Error(`Could not read the stored document: ${error?.message ?? 'no data'}`)
  }
  const buffer = Buffer.from(await data.arrayBuffer())
  if (sha256Hex(buffer) !== document.source_sha256) {
    const mismatch = new SigningError('fingerprint_mismatch', 'The stored document does not match its fingerprint.')
    await alertSigningFault('stored document does not match its fingerprint', mismatch, { documentId: document.id })
    throw mismatch
  }
  return buffer
}

/**
 * The signed copy, checked against the fingerprint recorded when it was made. A file that no
 * longer matches is never downloaded or emailed: the fault is raised instead.
 */
async function readFinalPdf(admin: AdminClient, document: SigningDocumentRow): Promise<Buffer> {
  if (!document.final_pdf_path) throw new SigningError('not_completed', 'This document has no signed copy yet.')
  const { data, error } = await admin.storage.from(SIGNED_DOCUMENTS_BUCKET).download(document.final_pdf_path)
  if (error || !data) throw new Error(`Could not read the signed copy: ${error?.message ?? 'no data'}`)
  const buffer = Buffer.from(await data.arrayBuffer())
  if (!document.final_sha256 || sha256Hex(buffer) !== document.final_sha256) {
    const mismatch = new SigningError('fingerprint_mismatch', 'The signed copy does not match its fingerprint.')
    await alertSigningFault('signed copy does not match its fingerprint', mismatch, { documentId: document.id })
    throw mismatch
  }
  return buffer
}

/** Serve the document to a signer and note that they opened it. The agree button needs this. */
export async function viewSigningDocument(context: SigningPartyContext, evidence: SigningEvidence): Promise<Buffer> {
  const pdf = await readSourcePdf(context.document)
  if (!context.party.document_viewed_at) {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('signing_parties')
      .update({ document_viewed_at: new Date().toISOString() })
      .eq('id', context.party.id)
      .is('document_viewed_at', null)
      .select('id')
    if (error) throw new Error(`Could not record that the document was opened: ${error.message}`)
    if (data && data.length > 0) {
      await insertEvent(admin, {
        documentId: context.document.id,
        partyId: context.party.id,
        event: 'document_viewed',
        evidence,
      })
    }
  }
  return pdf
}

// ---------------------------------------------------------------------------
// Identity check
// ---------------------------------------------------------------------------

export type IdentityCheckResult =
  | { ok: true }
  | { ok: false; reason: 'mismatch' | 'locked' | 'not_required' | 'no_record' | 'busy'; attemptsLeft: number }

/**
 * A new starter signing by link gives the date of birth we hold. It is something the right
 * person knows and someone who merely got hold of the email usually does not.
 */
export async function checkSigningIdentity(
  context: SigningPartyContext,
  dateOfBirthIso: string,
  evidence: SigningEvidence
): Promise<IdentityCheckResult> {
  const { party, document } = context
  if (party.identity_check !== 'date_of_birth') {
    return { ok: false, reason: 'not_required', attemptsLeft: 0 }
  }
  if (party.identity_checked_at) return { ok: true }
  if (party.identity_check_failures >= MAX_IDENTITY_CHECK_FAILURES) {
    return { ok: false, reason: 'locked', attemptsLeft: 0 }
  }

  const admin = createAdminClient()
  let expected: string | null = null
  if (party.employee_id) {
    const { data, error } = await admin
      .from('employees')
      .select('date_of_birth')
      .eq('employee_id', party.employee_id)
      .maybeSingle()
    if (error) throw new Error(`Could not read the employee record: ${error.message}`)
    expected = (data?.date_of_birth as string | null | undefined) ?? null
  }
  if (!expected) {
    // Nothing to compare with. Staff must add the date of birth or have them sign in person.
    return { ok: false, reason: 'no_record', attemptsLeft: MAX_IDENTITY_CHECK_FAILURES - party.identity_check_failures }
  }

  // Take an attempt BEFORE comparing, with an update that only succeeds if nobody else has
  // taken one since we read the row. Guesses sent in parallel therefore cannot each be checked
  // against the same count: all but one lose the update and are refused without a comparison.
  const attempts = party.identity_check_failures + 1
  const { data: taken, error: takeError } = await admin
    .from('signing_parties')
    .update({ identity_check_failures: attempts })
    .eq('id', party.id)
    .eq('identity_check_failures', party.identity_check_failures)
    .lt('identity_check_failures', MAX_IDENTITY_CHECK_FAILURES)
    .is('identity_checked_at', null)
    .select('id')
  if (takeError) throw new Error(`Could not record the identity check: ${takeError.message}`)
  if (!taken || taken.length === 0) {
    return { ok: false, reason: 'busy', attemptsLeft: Math.max(0, MAX_IDENTITY_CHECK_FAILURES - attempts) }
  }
  const attemptsLeft = Math.max(0, MAX_IDENTITY_CHECK_FAILURES - attempts)

  if (expected.slice(0, 10) === dateOfBirthIso) {
    const { error } = await admin
      .from('signing_parties')
      .update({ identity_checked_at: new Date().toISOString() })
      .eq('id', party.id)
    if (error) throw new Error(`Could not record the identity check: ${error.message}`)
    await insertEvent(admin, { documentId: document.id, partyId: party.id, event: 'identity_check_passed', evidence })
    return { ok: true }
  }

  await insertEvent(admin, {
    documentId: document.id,
    partyId: party.id,
    event: 'identity_check_failed',
    evidence,
    meta: { failures: attempts },
  })
  return { ok: false, reason: attemptsLeft === 0 ? 'locked' : 'mismatch', attemptsLeft }
}

// ---------------------------------------------------------------------------
// Signing and declining
// ---------------------------------------------------------------------------

/**
 * Withdraw an open request whose record no longer needs signing (the booking was cancelled,
 * staff marked the quote accepted, the worker left: see subject-state.ts). Called when the
 * signer opens the link, before a signature is recorded and before a reminder goes out.
 * Returns the context as it now stands.
 */
export async function withdrawIfSubjectClosed(context: SigningPartyContext): Promise<SigningPartyContext> {
  if (!SIGNING_OPEN_STATUSES.includes(context.document.status)) return context
  const reason = await findSubjectClosure(context.document)
  if (!reason) return context

  const admin = createAdminClient()
  const now = new Date().toISOString()
  const { data, error } = await admin
    .from('signing_documents')
    .update({ status: 'voided', voided_at: now, void_reason: reason, updated_at: now })
    .eq('id', context.document.id)
    .in('status', [...SIGNING_OPEN_STATUSES])
    .select('*')
  if (error) throw new Error(`Could not withdraw the document: ${error.message}`)
  if (!data || data.length === 0) {
    // Someone else changed it first. Show whatever it is now.
    const current = await loadDocument(admin, context.document.id)
    return current ? { ...context, document: current } : context
  }
  try {
    await insertEvent(admin, {
      documentId: context.document.id,
      event: 'voided',
      meta: { reason, automatic: true },
    })
  } catch (eventError) {
    // The request is withdrawn either way, and the reason is on the document. The daily job
    // adds the missing line to the trail (src/lib/signing/reminders.ts).
    await alertSigningFault('a withdrawn request was not written to the trail', eventError, { documentId: context.document.id })
  }
  return { ...context, document: data[0] as SigningDocumentRow }
}

export type SignResult =
  | { ok: true; completed: boolean; documentId: string }
  | { ok: false; reason: string }

export async function signSigningParty(input: {
  context: SigningPartyContext
  typedName: string
  /** The words on screen when they ticked the box. Must be the words we would show now. */
  agreedText: string
  via: 'link' | 'portal'
  evidence: SigningEvidence
  authUserId?: string | null
}): Promise<SignResult> {
  const { party, document } = input.context
  if (!isAcceptableTypedName(input.typedName)) {
    return { ok: false, reason: 'name_not_acceptable' }
  }
  const expectedText = buildAgreedText({ mode: document.mode, title: document.title })
  if (input.agreedText !== expectedText) {
    // The page they agreed on is not the page we would show. Refuse and let them reload.
    return { ok: false, reason: 'agreement_text_changed' }
  }

  // The record may have moved on since the page was opened.
  const current = await withdrawIfSubjectClosed(input.context)
  if (current.document.status === 'voided') {
    return { ok: false, reason: 'document_voided' }
  }

  const admin = createAdminClient()
  if (input.via === 'link') {
    // A newer link may have replaced this one while the page was open: a reminder, a resend or
    // an in-person session. The earlier link is dead from that moment, for a signature too.
    const { data: fresh, error: freshError } = await admin
      .from('signing_parties')
      .select('hashed_token')
      .eq('id', party.id)
      .maybeSingle()
    if (freshError) throw new Error(`Could not check the signing link: ${freshError.message}`)
    const currentHash = (fresh as { hashed_token: string | null } | null)?.hashed_token ?? null
    if (currentHash !== (party.hashed_token ?? null)) {
      return { ok: false, reason: 'link_replaced' }
    }
  }

  // An in-person session is a link the manager opened on a venue device a moment ago.
  const method: SigningMethod = input.via === 'portal' ? 'portal' : party.witnessed_by ? 'in_person' : 'link'

  const { data, error } = await admin.rpc('signing_record_signature', {
    p_party_id: party.id,
    p_typed_name: input.typedName,
    p_agreed_text: expectedText,
    p_method: method,
    p_ip: input.evidence.ip,
    p_user_agent: input.evidence.userAgent,
    p_city: input.evidence.city,
    p_region: input.evidence.region,
    p_country: input.evidence.country,
    p_auth_user_id: input.authUserId ?? null,
    p_witnessed_by: method === 'in_person' ? party.witnessed_by : null,
  })
  if (error) {
    throw new Error(`Could not record the signature: ${error.message}`)
  }
  const result = data as { ok: boolean; reason?: string; completed?: boolean; document_id?: string }
  if (!result.ok) {
    return { ok: false, reason: result.reason ?? 'refused' }
  }

  if (result.completed) {
    // The signature stands whatever happens next. Finishing off (the signed PDF, the record it
    // belongs to, the copies by email) is retried from the download path and the daily cron.
    try {
      await finaliseSigningDocument(document.id)
    } catch (finaliseError) {
      await alertSigningFault('signed but not finalised', finaliseError, { documentId: document.id })
    }
  }

  return { ok: true, completed: Boolean(result.completed), documentId: document.id }
}

export async function declineSigningParty(input: {
  context: SigningPartyContext
  reason: string | null
  evidence: SigningEvidence
}): Promise<SignResult> {
  const { party, document } = input.context
  const admin = createAdminClient()
  const { data, error } = await admin.rpc('signing_record_decline', {
    p_party_id: party.id,
    p_reason: input.reason,
    p_ip: input.evidence.ip,
    p_user_agent: input.evidence.userAgent,
    p_city: input.evidence.city,
    p_region: input.evidence.region,
    p_country: input.evidence.country,
  })
  if (error) throw new Error(`Could not record the refusal: ${error.message}`)
  const result = data as { ok: boolean; reason?: string }
  if (!result.ok) return { ok: false, reason: result.reason ?? 'refused' }

  try {
    await notifySender(admin, document, { outcome: 'declined', partyName: party.name, declineReason: input.reason })
  } catch (notifyError) {
    await alertSigningFault('declined but the sender was not told', notifyError, { documentId: document.id })
  }
  return { ok: true, completed: false, documentId: document.id }
}

// ---------------------------------------------------------------------------
// Completion
// ---------------------------------------------------------------------------

async function lookupUser(admin: AdminClient, userId: string | null): Promise<{ email: string | null; name: string | null }> {
  if (!userId) return { email: null, name: null }
  try {
    const { data } = await admin.auth.admin.getUserById(userId)
    const user = data?.user
    const metadataName = (user?.user_metadata as { full_name?: string; name?: string } | undefined)
    return { email: user?.email ?? null, name: metadataName?.full_name ?? metadataName?.name ?? user?.email ?? null }
  } catch {
    return { email: null, name: null }
  }
}

async function notifySender(
  admin: AdminClient,
  document: SigningDocumentRow,
  input: { outcome: 'completed' | 'declined' | 'expired'; partyName?: string | null; declineReason?: string | null }
): Promise<boolean> {
  // Nobody sent it (a system document): nobody to tell.
  if (!document.created_by) return false
  // Read here, not through lookupUser, which hides a failed read. "Could not find out who to
  // tell" must fail loudly; it is not the same as "there is nobody to tell".
  let senderEmail: string | null
  try {
    const { data, error } = await admin.auth.admin.getUserById(document.created_by)
    if (error) throw new Error(error.message)
    senderEmail = data?.user?.email ?? null
  } catch (lookupError) {
    throw new Error(
      `The address of whoever sent it could not be read: ${lookupError instanceof Error ? lookupError.message : String(lookupError)}`
    )
  }
  if (!senderEmail) return false
  const sender = { email: senderEmail }
  const subject = await describeSigningSubject(document)
  const email = buildSigningStaffNoticeEmail({
    outcome: input.outcome,
    title: document.title,
    subjectLabel: subject.label,
    partyName: input.partyName,
    declineReason: input.declineReason,
    recordUrl: `${getAppUrl()}${subject.path}`,
  })
  const result = await sendEmail({
    to: sender.email,
    subject: email.subject,
    html: email.html,
    text: email.text,
    commType: 'signing_staff_notice',
    metadata: { signing_document_id: document.id },
  })
  if (!result.success) {
    throw new Error(`The notice to the sender was not sent: ${result.error ?? 'unknown error'}`)
  }
  return true
}

function isAlreadyExistsError(error: { message?: string; statusCode?: string | number } | null): boolean {
  if (!error) return false
  return String(error.statusCode ?? '') === '409' || /already exists|duplicate/i.test(error.message ?? '')
}

/**
 * Finish a fully signed document: write the signed PDF with its signing record, update the
 * record it belongs to, and send everyone their copy.
 *
 * Safe to call any number of times, from any path. Each of the three steps (signed PDF, copies
 * by email, record update) claims its own completion in the database, so two callers at once do
 * the work once, and a caller that fails part way leaves the rest for the next one.
 */
export async function finaliseSigningDocument(documentId: string): Promise<SigningDocumentRow> {
  const admin = createAdminClient()
  let document = await loadDocument(admin, documentId)
  if (!document) throw new SigningError('not_found', 'Document not found.')
  if (document.status !== 'completed' && document.status !== 'superseded') {
    throw new SigningError('not_completed', 'This document is not fully signed.')
  }

  if (!document.final_pdf_path) {
    const parties = await loadParties(admin, documentId)
    const path = finalPath(document)
    let finalBuffer: Buffer

    const source = await readSourcePdf(document)
    const certificateParties: CertificateParty[] = []
    for (const party of parties) {
      const witness = party.witnessed_by ? await lookupUser(admin, party.witnessed_by) : null
      certificateParties.push({ ...party, witnessName: witness?.name ?? null })
    }
    // Where the document's HTML was kept, render it again with each signature shown in its
    // place, so the copy people receive does not show blank signature lines. `source` (the file
    // they were shown, already checked against its fingerprint above) is otherwise used as is.
    const renderSpec = readSigningRenderSpec(document.context)
    const browser = renderSpec ? await createPdfBrowser() : null
    try {
      let body: Buffer = source
      let signedInPlace = false
      if (renderSpec && browser) {
        const { data: htmlFile, error: htmlError } = await admin.storage
          .from(SIGNED_DOCUMENTS_BUCKET)
          .download(renderSpec.htmlPath)
        if (htmlError || !htmlFile) {
          throw new Error(`Could not read the stored document source: ${htmlError?.message ?? 'no data'}`)
        }
        const storedHtml = Buffer.from(await htmlFile.arrayBuffer())
        // The second render is a convenience: it shows the signatures where they belong. It is
        // used only when it can be trusted to be the document as sent. If the stored source does
        // not match its fingerprint, or the render overflows a page or changes the page count
        // (a font that loaded differently, a different browser build), the signed copy is the
        // file each signer was shown instead, which is fingerprinted, and the fault is raised.
        let untrusted: Error | null = null
        if (sha256Hex(storedHtml) !== renderSpec.htmlSha256) {
          untrusted = new SigningError('fingerprint_mismatch', 'The stored document source does not match its fingerprint.')
        } else {
          const filled = fillSignatureSlots({
            html: storedHtml.toString('utf-8'),
            fills: buildSignedFills({ document, slots: renderSpec.slots, parties: certificateParties }),
            mode: document.mode,
            initialsText: renderSpec.hasInitials ? `Signed electronically, ref ${signingReference(document.id)}` : null,
          })
          try {
            body = await renderSigningPdf({ html: filled, profile: renderSpec.profile, pages: renderSpec.pages, browser })
            signedInPlace = true
          } catch (renderError) {
            if (!isUntrustedRender(renderError)) throw renderError
            untrusted = renderError as Error
          }
        }
        if (untrusted) {
          await alertSigningFault('the signed copy could not show the signatures in place, so the document as sent was used', untrusted, {
            documentId,
          })
        }
      }
      const certificatePdf = await generatePDFFromHTML(
        renderCertificateHtml({ document, parties: certificateParties, signedInPlace }),
        undefined,
        browser ? { browser } : {}
      )
      finalBuffer = Buffer.from(await appendCertificate(body, certificatePdf))
    } finally {
      if (browser) await closePdfBrowser(browser)
    }

    const { error: uploadError } = await admin.storage
      .from(SIGNED_DOCUMENTS_BUCKET)
      .upload(path, finalBuffer, { contentType: 'application/pdf', upsert: false })
    if (uploadError) {
      if (!isAlreadyExistsError(uploadError)) {
        throw new Error(`Could not store the signed copy: ${uploadError.message}`)
      }
      // Another caller stored it first, or an earlier attempt stored it and then failed. The
      // stored file is the signed copy; record whatever fingerprint it has.
      const { data: existing, error: downloadError } = await admin.storage.from(SIGNED_DOCUMENTS_BUCKET).download(path)
      if (downloadError || !existing) {
        throw new Error(`Could not read the stored signed copy: ${downloadError?.message ?? 'no data'}`)
      }
      finalBuffer = Buffer.from(await existing.arrayBuffer())
    }

    const { data: claimed, error: claimError } = await admin
      .from('signing_documents')
      .update({ final_pdf_path: path, final_sha256: sha256Hex(finalBuffer), updated_at: new Date().toISOString() })
      .eq('id', documentId)
      .is('final_pdf_path', null)
      .select('*')
    if (claimError) throw new Error(`Could not record the signed copy: ${claimError.message}`)
    if (claimed && claimed.length > 0) {
      document = claimed[0] as SigningDocumentRow
      await insertEvent(admin, {
        documentId,
        event: 'finalised',
        meta: { final_sha256: document.final_sha256 },
      })
    } else {
      document = (await loadDocument(admin, documentId)) ?? document
    }
  }

  if (document.final_pdf_path && !document.copies_sent_at) {
    // Copies go out before the record update below: someone who has signed gets their copy even
    // if updating the booking or quote then fails. The step is claimed so two callers at once
    // send once. Each delivery is written to the trail as it happens, so a later pass sends only
    // what is missing.
    const { data: claimed, error: claimError } = await admin
      .from('signing_documents')
      .update({ copies_sent_at: new Date().toISOString() })
      .eq('id', documentId)
      .is('copies_sent_at', null)
      .select('*')
    if (claimError) throw new Error(`Could not claim the copies step: ${claimError.message}`)
    if (claimed && claimed.length > 0) {
      document = claimed[0] as SigningDocumentRow
      let tryAgain = false
      try {
        const failures = await sendCompletedCopies(admin, document)
        if (failures.length > 0) {
          // Sent again by the daily job only where the provider definitely refused, so nothing
          // can have gone. Where the outcome is not known the email may have arrived, and a
          // second copy of a contract is worse than one staff send by hand after checking.
          tryAgain = failures.some((failure) => failure.retry === 'always')
            || (failures.some((failure) => failure.retry === 'soon') && withinCopyRetryWindow(document))
          await alertSigningFault(
            tryAgain ? 'signed copies were not all sent, and will be tried again' : 'signed copies were not all sent',
            new Error(`Signed copy not sent to ${failures.map((failure) => `${failure.name}: ${failure.error}`).join('; ')}`),
            { documentId }
          )
        }
      } catch (emailError) {
        // Something broke part way. What went is on the trail; the rest waits for a person, and
        // the alert says who that is.
        const reason = emailError instanceof Error ? emailError.message : String(emailError)
        let waiting = 'could not be worked out'
        try {
          waiting = (await listCopyRecipientsWaiting(admin, document)).join(', ') || 'nobody'
        } catch {
          // The alert still goes, with the original error.
        }
        await alertSigningFault(
          'signed copies were not all sent',
          new Error(`Signed copy still to reach: ${waiting}. It stopped because: ${reason}`),
          { documentId }
        )
      }
      if (tryAgain) {
        const { error: releaseError } = await admin
          .from('signing_documents')
          .update({ copies_sent_at: null })
          .eq('id', documentId)
        if (releaseError) {
          await alertSigningFault('signed copies could not be queued to send again', new Error(releaseError.message), { documentId })
        } else {
          document = { ...document, copies_sent_at: null }
        }
      }
    }
  }

  if (!document.completion_applied_at) {
    // Run, then record. Every hook is safe to run twice, so two callers at once is harmless,
    // whereas recording first would leave the step marked done if this function were cut off
    // before the hook ran, and nothing would ever retry it.
    await runCompletionHook(document, await loadParties(admin, documentId))

    // This version is now the one in force; earlier signed versions in the series are history.
    const { data: older, error: olderError } = await admin
      .from('signing_documents')
      .update({ status: 'superseded', updated_at: new Date().toISOString() })
      .eq('subject_type', document.subject_type)
      .eq('subject_id', document.subject_id)
      .eq('series_key', document.series_key)
      .eq('status', 'completed')
      .lt('version', document.version)
      .select('id')
    if (olderError) throw new Error(`Could not mark the earlier version as replaced: ${olderError.message}`)
    for (const row of older ?? []) {
      await insertEvent(admin, {
        documentId: row.id as string,
        event: 'superseded',
        meta: { superseded_by: documentId },
      })
    }

    const { data: applied, error: appliedError } = await admin
      .from('signing_documents')
      .update({ completion_applied_at: new Date().toISOString() })
      .eq('id', documentId)
      .is('completion_applied_at', null)
      .select('*')
    if (appliedError) throw new Error(`Could not record the completion step: ${appliedError.message}`)
    if (applied && applied.length > 0) document = applied[0] as SigningDocumentRow
  }

  return document
}

/** Marks on the trail: a signed copy that went to a signer, and the notice that went to the sender. */
const SIGNED_COPY = 'signed_copy'
const SENDER_NOTICE = 'sender_notice'
/** A refused signed-copy email is tried again by the daily job for this many days after signing. */
const COPY_RETRY_DAYS = 3

interface CopyFailure {
  name: string
  error: string
  /**
   * 'soon': definitely refused, so safe to try again for a few days. 'always': held because
   * email is switched off, so it waits however long that lasts. 'never': the outcome is not
   * known, or the attempt is used up, and a person has to look.
   */
  retry: 'soon' | 'always' | 'never'
}

function withinCopyRetryWindow(document: Pick<SigningDocumentRow, 'completed_at'>): boolean {
  if (!document.completed_at) return true
  return Date.now() - new Date(document.completed_at).getTime() < COPY_RETRY_DAYS * DAY_MS
}

/** The signers who have no mark on the trail for their signed copy, delivered or uncertain. */
async function listCopyRecipientsWaiting(admin: AdminClient, document: SigningDocumentRow): Promise<string[]> {
  const { data, error } = await admin
    .from('signing_events')
    .select('party_id, meta')
    .eq('document_id', document.id)
    .eq('event', 'sent')
  if (error) throw new Error(error.message)
  const settled = new Set(
    ((data ?? []) as Array<{ party_id: string | null; meta: { what?: string } | null }>)
      .filter((row) => row.meta?.what === SIGNED_COPY)
      .map((row) => row.party_id)
  )
  return (await loadParties(admin, document.id))
    .filter((party) => party.role !== 'company' && party.email && !settled.has(party.id))
    .map((party) => party.name)
}

/**
 * Email the signed copy to each signer who does not have it yet, and tell the sender it is
 * signed. Returns who did not get theirs. Each delivery is written to the trail as it happens,
 * which is how a later pass knows who is left.
 */
async function sendCompletedCopies(admin: AdminClient, document: SigningDocumentRow): Promise<CopyFailure[]> {
  const content = await readFinalPdf(admin, document)
  const fileName = `${document.title.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'signed-document'}.pdf`

  const { data: sentRows, error: sentError } = await admin
    .from('signing_events')
    .select('party_id, meta')
    .eq('document_id', document.id)
    .eq('event', 'sent')
  if (sentError) throw new Error(`Could not read which copies have gone: ${sentError.message}`)
  const marks = ((sentRows ?? []) as Array<{ party_id: string | null; meta: { what?: string } | null }>)
  // Delivered, or possibly delivered: either way not sent again automatically.
  const settled = new Set(marks.filter((row) => row.meta?.what === SIGNED_COPY).map((row) => row.party_id))
  const senderTold = marks.some((row) => row.meta?.what === SENDER_NOTICE)

  const parties = await loadParties(admin, document.id)
  const failures: CopyFailure[] = []
  for (const party of parties) {
    if (party.role === 'company' || !party.email || settled.has(party.id)) continue
    const email = buildSigningCompletedEmail({
      brand: document.brand,
      mode: document.mode,
      recipientName: party.name,
      title: document.title,
    })
    const result = await sendEmail({
      to: party.email,
      subject: email.subject,
      html: email.html,
      text: email.text,
      attachments: [{ name: fileName, content, contentType: 'application/pdf' }],
      commType: 'signing_completed',
      customerId: party.customer_id,
      privateBookingId: document.subject_type === 'private_booking' ? document.subject_id : null,
      quoteId: document.subject_type === 'quote' ? document.subject_id : null,
      metadata: { signing_document_id: document.id, signing_party_id: party.id },
      ...emailRoutingFor(document),
    })
    if (result.success) {
      await insertEvent(admin, {
        documentId: document.id,
        partyId: party.id,
        event: 'sent',
        meta: { what: SIGNED_COPY, to: party.email },
      })
      continue
    }
    if (result.uncertain) {
      // It may have arrived. Recorded so that no later pass sends it a second time.
      await insertEvent(admin, {
        documentId: document.id,
        partyId: party.id,
        event: 'sent',
        meta: { what: SIGNED_COPY, to: party.email, outcome: 'uncertain', error: result.error ?? null },
      })
    }
    failures.push({
      name: party.name,
      error: result.uncertain ? `${result.error ?? 'failed'} (it may have been sent: check before sending again)` : result.error ?? 'failed',
      retry: result.uncertain ? 'never' : result.code === 'email_suspended' ? 'always' : 'soon',
    })
  }

  if (!senderTold) {
    try {
      const told = await notifySender(admin, document, { outcome: 'completed' })
      if (told) {
        await insertEvent(admin, { documentId: document.id, event: 'sent', meta: { what: SENDER_NOTICE } })
      }
    } catch (noticeError) {
      // A notice to our own staff: missing it is not worth sending signers anything twice.
      failures.push({
        name: 'the member of staff who sent it',
        error: noticeError instanceof Error ? noticeError.message : String(noticeError),
        retry: 'never',
      })
    }
  }
  return failures
}

// ---------------------------------------------------------------------------
// Staff actions
// ---------------------------------------------------------------------------

export interface SigningDocumentSummary extends SigningDocumentRow {
  /** Parties without their token hashes, which never leave the server. */
  parties: Array<Omit<SigningPartyRow, 'hashed_token'>>
}

function stripToken(party: SigningPartyRow): Omit<SigningPartyRow, 'hashed_token'> {
  const { hashed_token: _hashedToken, ...rest } = party
  return rest
}

export async function listSigningDocumentsForSubject(
  subjectType: SigningDocumentRow['subject_type'],
  subjectId: string
): Promise<SigningDocumentSummary[]> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('signing_documents')
    .select('*')
    .eq('subject_type', subjectType)
    .eq('subject_id', subjectId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(`Could not read signing documents: ${error.message}`)
  return attachParties(admin, (data ?? []) as SigningDocumentRow[])
}

/**
 * Every document in one series across all its subjects. Supplier confirmations for a booking
 * are the case: each belongs to its supplier, and the booking page wants them together.
 */
export async function listSigningDocumentsForSeries(
  subjectType: SigningDocumentRow['subject_type'],
  seriesKey: string
): Promise<SigningDocumentSummary[]> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('signing_documents')
    .select('*')
    .eq('subject_type', subjectType)
    .eq('series_key', seriesKey)
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) throw new Error(`Could not read signing documents: ${error.message}`)
  return attachParties(admin, (data ?? []) as SigningDocumentRow[])
}

/** Two plain reads rather than an embed, so a second foreign key can never break the list. */
async function attachParties(admin: AdminClient, documents: SigningDocumentRow[]): Promise<SigningDocumentSummary[]> {
  if (documents.length === 0) return []
  const { data, error } = await admin
    .from('signing_parties')
    .select('*')
    .in('document_id', documents.map((document) => document.id))
    .order('created_at', { ascending: true })
  if (error) throw new Error(`Could not read the signers: ${error.message}`)
  const byDocument = new Map<string, Array<Omit<SigningPartyRow, 'hashed_token'>>>()
  for (const party of (data ?? []) as SigningPartyRow[]) {
    const list = byDocument.get(party.document_id) ?? []
    list.push(stripToken(party))
    byDocument.set(party.document_id, list)
  }
  return documents.map((document) => ({ ...document, parties: byDocument.get(document.id) ?? [] }))
}

export async function getSigningDocument(documentId: string): Promise<SigningDocumentSummary | null> {
  const admin = createAdminClient()
  const document = await loadDocument(admin, documentId)
  if (!document) return null
  return { ...document, parties: (await loadParties(admin, documentId)).map(stripToken) }
}

/** Withdraw a request that has not been fully signed. A signed document cannot be voided. */
export async function voidSigningDocument(input: { documentId: string; userId: string; reason: string }): Promise<void> {
  const admin = createAdminClient()
  const now = new Date().toISOString()
  const { data, error } = await admin
    .from('signing_documents')
    .update({ status: 'voided', voided_at: now, voided_by: input.userId, void_reason: input.reason, updated_at: now })
    .eq('id', input.documentId)
    .in('status', [...SIGNING_OPEN_STATUSES])
    .select('id')
  if (error) throw new Error(`Could not withdraw the document: ${error.message}`)
  if (!data || data.length === 0) {
    throw new SigningError('not_open', 'Only a document that is still waiting to be signed can be withdrawn.')
  }
  await insertEvent(admin, {
    documentId: input.documentId,
    event: 'voided',
    actorUserId: input.userId,
    meta: { reason: input.reason },
  })
}

async function requireOpenParty(admin: AdminClient, partyId: string): Promise<SigningPartyContext> {
  const { data, error } = await admin.from('signing_parties').select('*').eq('id', partyId).maybeSingle()
  if (error) throw new Error(`Could not read the signer: ${error.message}`)
  const party = data as SigningPartyRow | null
  const document = party ? await loadDocument(admin, party.document_id) : null
  if (!party || !document) throw new SigningError('not_found', 'Signer not found.')
  if (party.status !== 'pending') throw new SigningError('not_pending', 'This person has already responded.')
  if (!SIGNING_OPEN_STATUSES.includes(document.status)) {
    throw new SigningError('not_open', 'This document is no longer waiting to be signed.')
  }
  if (new Date(document.expires_at).getTime() <= Date.now()) {
    throw new SigningError('expired', 'This request has expired. Send the document again.')
  }
  return { party, document }
}

/**
 * Email a fresh link. Only a hash of each link is kept, so the old one cannot be sent again:
 * a reminder issues a new link and the earlier one stops working.
 */
export async function resendSigningLink(input: {
  partyId: string
  /** Null when the daily cron sends it. */
  userId: string | null
  isReminder: boolean
}): Promise<void> {
  const admin = createAdminClient()
  const { party, document } = await requireOpenParty(admin, input.partyId)
  if (!party.email) throw new SigningError('no_email', 'There is no email address for this person.')

  const rawToken = generateSigningToken()
  const newHash = hashSigningToken(rawToken)
  const now = new Date().toISOString()
  // The new link replaces the one this function read, and only that one. Two sends at the same
  // moment would otherwise each replace the other's link, and one email would carry a dead one.
  let rotate = admin
    .from('signing_parties')
    .update({
      hashed_token: newHash,
      token_expires_at: document.expires_at,
      // A fresh link gets a fresh set of attempts, and is not an in-person session. Whoever
      // holds it proves who they are and opens the document themselves: nothing carries over
      // from an earlier link.
      identity_check_failures: 0,
      identity_checked_at: null,
      document_viewed_at: null,
      witnessed_by: null,
      updated_at: now,
    })
    .eq('id', party.id)
    .eq('status', 'pending')
  rotate = party.hashed_token ? rotate.eq('hashed_token', party.hashed_token) : rotate.is('hashed_token', null)
  const { data: rotated, error } = await rotate.select('id')
  if (error) throw new Error(`Could not issue a new link: ${error.message}`)
  if (!rotated || rotated.length === 0) {
    throw new SigningError('busy', 'A new link was sent to this person a moment ago. Check before sending another.')
  }

  let sent: { success: boolean; error?: string; uncertain?: boolean }
  try {
    sent = await sendSigningLinkEmail({
      document,
      party,
      rawToken,
      expiresAt: document.expires_at,
      isReminder: input.isReminder,
    })
  } catch (sendError) {
    // Cut off part way: it may or may not have gone.
    sent = { success: false, error: sendError instanceof Error ? sendError.message : String(sendError), uncertain: true }
  }
  if (!sent.success) {
    if (!sent.uncertain) {
      // Definitely not sent, so nobody has the new link. Put the earlier one back, with what was
      // known about it, so the link they already hold goes on working.
      const { error: restoreError } = await admin
        .from('signing_parties')
        .update({
          hashed_token: party.hashed_token,
          token_expires_at: party.token_expires_at,
          identity_check_failures: party.identity_check_failures,
          identity_checked_at: party.identity_checked_at,
          document_viewed_at: party.document_viewed_at,
          witnessed_by: party.witnessed_by,
          updated_at: new Date().toISOString(),
        })
        .eq('id', party.id)
        .eq('hashed_token', newHash)
      if (restoreError) {
        await alertSigningFault('the earlier signing link could not be restored after a failed email', new Error(restoreError.message), {
          documentId: document.id,
          partyId: party.id,
        })
      }
    }
    if (sent.uncertain && input.isReminder) {
      // It may have gone, and the new link is the live one. Count it, so the daily job does not
      // send another tomorrow and kill a link the person may be holding. A person checks.
      const { error: countError } = await admin
        .from('signing_parties')
        .update({ last_reminded_at: now, reminder_count: party.reminder_count + 1 })
        .eq('id', party.id)
      if (countError) {
        await alertSigningFault('a reminder of unknown outcome could not be counted', new Error(countError.message), {
          documentId: document.id,
          partyId: party.id,
        })
      }
      try {
        await insertEvent(admin, {
          documentId: document.id,
          partyId: party.id,
          event: 'reminded',
          actorUserId: input.userId,
          meta: { to: party.email, outcome: 'uncertain', error: sent.error ?? null },
        })
      } catch (eventError) {
        await alertSigningFault('a reminder of unknown outcome was not written to the trail', eventError, {
          documentId: document.id,
          partyId: party.id,
        })
      }
    }
    throw new SigningError(
      'email_failed',
      sent.uncertain
        ? `The email may not have been sent: ${sent.error ?? 'unknown error'}. Check with the person before sending another.`
        : `The email could not be sent: ${sent.error ?? 'unknown error'}`
    )
  }

  // Only a reminder that went counts as one, so a refused reminder is tried again tomorrow.
  if (input.isReminder) {
    const { error: countError } = await admin
      .from('signing_parties')
      .update({ last_reminded_at: now, reminder_count: party.reminder_count + 1 })
      .eq('id', party.id)
    if (countError) throw new Error(`The reminder went, but could not be counted: ${countError.message}`)
  }
  await insertEvent(admin, {
    documentId: document.id,
    partyId: party.id,
    event: input.isReminder ? 'reminded' : 'resent',
    actorUserId: input.userId,
    meta: { to: party.email },
  })
}

/**
 * Start an in-person signing: a short-lived link for the device in the manager's hand. The
 * record will name the manager as present.
 */
export async function startInPersonSigning(input: { partyId: string; userId: string }): Promise<{ url: string }> {
  const admin = createAdminClient()
  const { party } = await requireOpenParty(admin, input.partyId)
  const rawToken = generateSigningToken()
  const now = new Date()
  const { error } = await admin
    .from('signing_parties')
    .update({
      hashed_token: hashSigningToken(rawToken),
      token_expires_at: new Date(now.getTime() + IN_PERSON_LINK_MINUTES * 60 * 1000).toISOString(),
      witnessed_by: input.userId,
      // Opened on this device, in front of the manager: an earlier opening by link does not count.
      document_viewed_at: null,
      updated_at: now.toISOString(),
    })
    .eq('id', party.id)
    .eq('status', 'pending')
  if (error) throw new Error(`Could not start in-person signing: ${error.message}`)
  return { url: buildSigningUrl(rawToken) }
}

/** The signed copy if there is one, otherwise the document as sent. Notes who downloaded it. */
export async function downloadSigningPdf(input: {
  documentId: string
  userId: string | null
}): Promise<{ buffer: Buffer; fileName: string; signed: boolean }> {
  const admin = createAdminClient()
  let document = await loadDocument(admin, input.documentId)
  if (!document) throw new SigningError('not_found', 'Document not found.')

  if (document.status === 'completed' || document.status === 'superseded') {
    if (!document.final_pdf_path) {
      // The signature was recorded but the signed copy was never made. Make it now. If that
      // fails there is nothing signed to hand over; if the copy was made and a later step is
      // what failed, the copy is still handed over and the fault is raised.
      try {
        document = await finaliseSigningDocument(document.id)
      } catch (finishError) {
        const after = await loadDocument(admin, document.id)
        if (!after?.final_pdf_path) throw finishError
        document = after
        await alertSigningFault('finishing on download failed', finishError, { documentId: document.id })
      }
    } else if (!document.copies_sent_at || !document.completion_applied_at) {
      // The copy exists but a later step did not finish. Try it again, without letting that
      // stand between a member of staff and the signed copy.
      try {
        document = await finaliseSigningDocument(document.id)
      } catch (finishError) {
        await alertSigningFault('finishing on download failed', finishError, { documentId: document.id })
      }
    }
  }

  const baseName = document.title.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'document'
  let buffer: Buffer
  let signed = false
  if (document.final_pdf_path) {
    buffer = await readFinalPdf(admin, document)
    signed = true
  } else {
    buffer = await readSourcePdf(document)
  }

  await insertEvent(admin, {
    documentId: document.id,
    event: 'downloaded',
    actorUserId: input.userId,
    meta: { signed },
  })
  return { buffer, fileName: `${baseName}${signed ? '-signed' : ''}.pdf`, signed }
}
