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

export async function describeSigningSubject(
  document: Pick<SigningDocumentRow, 'subject_type' | 'subject_id'>
): Promise<SigningSubjectDescription> {
  const admin = createAdminClient()
  const id = document.subject_id
  const fallback: SigningSubjectDescription = {
    label: 'a record that no longer exists',
    path: FALLBACK_PATHS[document.subject_type],
  }

  switch (document.subject_type) {
    case 'employee': {
      const { data } = await admin
        .from('employees')
        .select('first_name, last_name')
        .eq('employee_id', id)
        .maybeSingle()
      if (!data) return fallback
      return { label: fullName(data.first_name, data.last_name) || 'an employee', path: `/employees/${id}` }
    }
    case 'private_booking': {
      const { data } = await admin
        .from('private_bookings')
        .select('customer_name, customer_first_name, customer_last_name')
        .eq('id', id)
        .maybeSingle()
      if (!data) return fallback
      const name = fullName(data.customer_first_name, data.customer_last_name) || data.customer_name || 'a customer'
      return { label: `${name}'s booking`, path: `/private-bookings/${id}` }
    }
    case 'quote': {
      const { data } = await admin.from('quotes').select('quote_number').eq('id', id).maybeSingle()
      if (!data) return fallback
      return { label: `quote ${data.quote_number}`, path: `/quotes/${id}` }
    }
    case 'recruitment_application': {
      const { data } = await admin
        .from('recruitment_applications')
        .select('candidate:recruitment_candidates(first_name, last_name)')
        .eq('id', id)
        .maybeSingle()
      if (!data) return fallback
      const candidate = (Array.isArray(data.candidate) ? data.candidate[0] : data.candidate) as
        | { first_name: string | null; last_name: string | null }
        | null
        | undefined
      return {
        label: fullName(candidate?.first_name, candidate?.last_name) || 'a candidate',
        path: `/recruitment?application=${id}`,
      }
    }
    case 'invoice_vendor': {
      const { data } = await admin.from('invoice_vendors').select('name').eq('id', id).maybeSingle()
      if (!data) return fallback
      return { label: data.name as string, path: '/oj-projects/clients' }
    }
    case 'vendor': {
      const { data } = await admin.from('vendors').select('name').eq('id', id).maybeSingle()
      if (!data) return fallback
      return { label: data.name as string, path: '/private-bookings/settings' }
    }
  }
}
