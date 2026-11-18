import { createAdminClient } from '@/lib/supabase/admin'
import type { SigningDocumentRow, SigningSubjectType } from './types'

/**
 * Who or what a document is about, in words staff will recognise, and the staff page it lives on.
 * Used for notices to the sender and for the list of every document.
 */
export interface SigningSubjectDescription {
  label: string
  /** App path of the record, starting with a slash. */
  path: string
}

type SubjectRef = Pick<SigningDocumentRow, 'subject_type' | 'subject_id'>

function fullName(first: string | null | undefined, last: string | null | undefined): string {
  return [first, last].map((part) => part?.trim()).filter(Boolean).join(' ')
}

const FALLBACK_PATHS: Record<SigningSubjectType, string> = {
  employee: '/employees',
  private_booking: '/private-bookings',
  quote: '/quotes',
  recruitment_application: '/recruitment',
  invoice_vendor: '/oj-projects/clients',
  vendor: '/private-bookings/settings',
}

function fallbackFor(subjectType: SigningSubjectType): SigningSubjectDescription {
  return { label: 'a record that no longer exists', path: FALLBACK_PATHS[subjectType] }
}

// How a subject row becomes words. The single and the batch lookups share these, so their
// wording cannot drift apart.

type EmployeeName = { first_name: string | null; last_name: string | null }
type BookingName = { customer_name: string | null; customer_first_name: string | null; customer_last_name: string | null }
type CandidateEmbed = { candidate: unknown }

function describeEmployee(row: EmployeeName, id: string): SigningSubjectDescription {
  return { label: fullName(row.first_name, row.last_name) || 'an employee', path: `/employees/${id}` }
}

function describeBooking(row: BookingName, id: string): SigningSubjectDescription {
  const name = fullName(row.customer_first_name, row.customer_last_name) || row.customer_name || 'a customer'
  return { label: `${name}'s booking`, path: `/private-bookings/${id}` }
}

function describeQuote(row: { quote_number: string }, id: string): SigningSubjectDescription {
  return { label: `quote ${row.quote_number}`, path: `/quotes/${id}` }
}

function describeApplication(row: CandidateEmbed, id: string): SigningSubjectDescription {
  const candidate = (Array.isArray(row.candidate) ? row.candidate[0] : row.candidate) as
    | { first_name: string | null; last_name: string | null }
    | null
    | undefined
  return {
    label: fullName(candidate?.first_name, candidate?.last_name) || 'a candidate',
    path: `/recruitment?application=${id}`,
  }
}

function describeInvoiceVendor(row: { name: string }): SigningSubjectDescription {
  return { label: row.name as string, path: '/oj-projects/clients' }
}

function describeVendor(row: { name: string }): SigningSubjectDescription {
  return { label: row.name as string, path: '/private-bookings/settings' }
}

export async function describeSigningSubject(document: SubjectRef): Promise<SigningSubjectDescription> {
  const admin = createAdminClient()
  const id = document.subject_id
  const fallback = fallbackFor(document.subject_type)

  switch (document.subject_type) {
    case 'employee': {
      const { data } = await admin
        .from('employees')
        .select('first_name, last_name')
        .eq('employee_id', id)
        .maybeSingle()
      if (!data) return fallback
      return describeEmployee(data, id)
    }
    case 'private_booking': {
      const { data } = await admin
        .from('private_bookings')
        .select('customer_name, customer_first_name, customer_last_name')
        .eq('id', id)
        .maybeSingle()
      if (!data) return fallback
      return describeBooking(data, id)
    }
    case 'quote': {
      const { data } = await admin.from('quotes').select('quote_number').eq('id', id).maybeSingle()
      if (!data) return fallback
      return describeQuote(data, id)
    }
    case 'recruitment_application': {
      const { data } = await admin
        .from('recruitment_applications')
        .select('candidate:recruitment_candidates(first_name, last_name)')
        .eq('id', id)
        .maybeSingle()
      if (!data) return fallback
      return describeApplication(data, id)
    }
    case 'invoice_vendor': {
      const { data } = await admin.from('invoice_vendors').select('name').eq('id', id).maybeSingle()
      if (!data) return fallback
      return describeInvoiceVendor(data)
    }
    case 'vendor': {
      const { data } = await admin.from('vendors').select('name').eq('id', id).maybeSingle()
      if (!data) return fallback
      return describeVendor(data)
    }
  }
}

/**
 * One read for every subject of one type, keyed by subject id. A read error leaves the map empty,
 * so those documents show the fallback, as describeSigningSubject does when its read fails.
 */
async function describeSubjectsOfType(
  admin: ReturnType<typeof createAdminClient>,
  subjectType: SigningSubjectType,
  ids: string[]
): Promise<Map<string, SigningSubjectDescription>> {
  const out = new Map<string, SigningSubjectDescription>()
  switch (subjectType) {
    case 'employee': {
      const { data } = await admin.from('employees').select('employee_id, first_name, last_name').in('employee_id', ids)
      for (const row of data ?? []) out.set(row.employee_id, describeEmployee(row, row.employee_id))
      return out
    }
    case 'private_booking': {
      const { data } = await admin
        .from('private_bookings')
        .select('id, customer_name, customer_first_name, customer_last_name')
        .in('id', ids)
      for (const row of data ?? []) out.set(row.id, describeBooking(row, row.id))
      return out
    }
    case 'quote': {
      const { data } = await admin.from('quotes').select('id, quote_number').in('id', ids)
      for (const row of data ?? []) out.set(row.id, describeQuote(row, row.id))
      return out
    }
    case 'recruitment_application': {
      const { data } = await admin
        .from('recruitment_applications')
        .select('id, candidate:recruitment_candidates(first_name, last_name)')
        .in('id', ids)
      for (const row of data ?? []) out.set(row.id, describeApplication(row, row.id))
      return out
    }
    case 'invoice_vendor': {
      const { data } = await admin.from('invoice_vendors').select('id, name').in('id', ids)
      for (const row of data ?? []) out.set(row.id, describeInvoiceVendor(row))
      return out
    }
    case 'vendor': {
      const { data } = await admin.from('vendors').select('id, name').in('id', ids)
      for (const row of data ?? []) out.set(row.id, describeVendor(row))
      return out
    }
  }
}

/**
 * describeSigningSubject for many documents at once: one read per subject type, run together,
 * instead of one read per document. Same labels, paths and fallback; the result lines up with
 * the input.
 */
export async function describeSigningSubjects(documents: SubjectRef[]): Promise<SigningSubjectDescription[]> {
  if (documents.length === 0) return []
  const admin = createAdminClient()
  const idsByType = new Map<SigningSubjectType, Set<string>>()
  for (const document of documents) {
    const ids = idsByType.get(document.subject_type) ?? new Set<string>()
    ids.add(document.subject_id)
    idsByType.set(document.subject_type, ids)
  }

  const byType = new Map<SigningSubjectType, Map<string, SigningSubjectDescription>>()
  await Promise.all(
    Array.from(idsByType.entries()).map(async ([subjectType, ids]) => {
      byType.set(subjectType, await describeSubjectsOfType(admin, subjectType, Array.from(ids)))
    })
  )

  return documents.map(
    (document) => byType.get(document.subject_type)?.get(document.subject_id) ?? fallbackFor(document.subject_type)
  )
}
