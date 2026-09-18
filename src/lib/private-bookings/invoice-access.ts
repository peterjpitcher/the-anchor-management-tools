import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { InvoiceWithDetails } from '@/types/invoices'

export async function requirePrivateBookingBillingAdmin(): Promise<{ userId: string } | { error: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { error: 'Unauthorized' }

  const db = createAdminClient()
  const { data, error } = await (db.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: Array<{ role_name?: string }> | null; error: unknown }>)('get_user_roles', {
    p_user_id: user.id,
  })

  if (error) {
    console.error('[PrivateBookingInvoice] Failed to verify caller roles', error)
    return { error: 'Failed to verify permissions' }
  }

  if (!(data ?? []).some(row => row.role_name === 'super_admin')) {
    return { error: 'Only super admins can raise a booking invoice.' }
  }

  return { userId: user.id }
}

export async function loadInvoiceForSending(invoiceId: string): Promise<InvoiceWithDetails | null> {
  const db = createAdminClient()
  const { data, error } = await db
    .from('invoices')
    .select(`*, vendor:invoice_vendors(*), line_items:invoice_line_items(*), payments:invoice_payments(*), credits:credit_notes(status, amount_inc_vat)`)
    .order('display_order', { ascending: true, foreignTable: 'invoice_line_items' })
    .order('payment_date', { ascending: true, foreignTable: 'invoice_payments' })
    .eq('id', invoiceId)
    .is('deleted_at', null)
    .maybeSingle()

  if (error || !data) {
    console.error('[PrivateBookingInvoice] Failed to load invoice for sending', error)
    return null
  }

  return data as unknown as InvoiceWithDetails
}
