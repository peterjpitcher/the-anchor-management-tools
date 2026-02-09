import type { SupabaseClient } from '@supabase/supabase-js'

type GenericClient = SupabaseClient<any, 'public', any>

type InvoiceVendorContact = {
  email: string
  isPrimary: boolean
  receiveInvoiceCopy: boolean
}

export function parseRecipientList(raw: string | null | undefined): string[] {
  if (!raw) return []

  return dedupeRecipients(
    String(raw)
      .split(/[;,]/)
      .map((value) => value.trim())
      .filter((value) => isEmailLike(value))
  )
}

export function splitToAndCc(recipients: string[], preferredTo?: string | null): { to: string | null; cc: string[] } {
  const deduped = dedupeRecipients(recipients)

  if (deduped.length === 0) {
    return { to: null, cc: [] }
  }

  let to = deduped[0]
  if (preferredTo) {
    const preferred = deduped.find((email) => email.toLowerCase() === preferredTo.toLowerCase())
    if (preferred) {
      to = preferred
    }
  }

  return {
    to,
    cc: deduped.filter((email) => email.toLowerCase() !== to.toLowerCase())
  }
}

export async function resolveVendorInvoiceRecipients(
  supabase: GenericClient,
  vendorId: string,
  vendorEmailRaw: string | null | undefined
): Promise<{ to: string | null; cc: string[] } | { error: string }> {
  const recipientsFromVendor = parseRecipientList(vendorEmailRaw)
  const contactsResult = await fetchVendorInvoiceContacts(supabase, vendorId)

  if ('error' in contactsResult) {
    return contactsResult
  }

  const contacts = contactsResult.contacts
  const primaryEmail = contacts.find((contact) => contact.isPrimary)?.email ?? null
  const firstVendorEmail = recipientsFromVendor[0] ?? null
  const to = primaryEmail ?? firstVendorEmail ?? contacts[0]?.email ?? null

  const cc = dedupeRecipients([
    ...recipientsFromVendor.slice(firstVendorEmail ? 1 : 0),
    ...contacts.filter((contact) => contact.receiveInvoiceCopy).map((contact) => contact.email)
  ]).filter((email) => email.toLowerCase() !== (to ? to.toLowerCase() : ''))

  return { to, cc }
}

export async function resolveManualInvoiceRecipients(
  supabase: GenericClient,
  vendorId: string,
  rawRecipients: string
): Promise<{ to: string | null; cc: string[] } | { error: string }> {
  const recipients = parseRecipientList(rawRecipients)
  if (recipients.length === 0) {
    return { error: 'At least one valid email address is required' }
  }

  const contactsResult = await fetchVendorInvoiceContacts(supabase, vendorId)
  if ('error' in contactsResult) {
    return contactsResult
  }

  const primaryEmail = contactsResult.contacts.find((contact) => contact.isPrimary)?.email ?? null
  return splitToAndCc(recipients, primaryEmail)
}

async function fetchVendorInvoiceContacts(
  supabase: GenericClient,
  vendorId: string
): Promise<{ contacts: InvoiceVendorContact[] } | { error: string }> {
  const { data, error } = await supabase
    .from('invoice_vendor_contacts')
    .select('email, is_primary, receive_invoice_copy')
    .eq('vendor_id', vendorId)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true })

  if (error) {
    return { error: error.message || 'Failed to load invoice contacts' }
  }

  const contacts = (data || [])
    .map((row: any) => ({
      email: String(row?.email || '').trim(),
      isPrimary: Boolean(row?.is_primary),
      receiveInvoiceCopy: Boolean(row?.receive_invoice_copy)
    }))
    .filter((row) => isEmailLike(row.email))

  return { contacts }
}

function dedupeRecipients(recipients: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const recipient of recipients) {
    const normalized = recipient.trim()
    if (!normalized) continue
    const key = normalized.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(normalized)
  }

  return result
}

function isEmailLike(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}
