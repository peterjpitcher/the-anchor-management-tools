import type { SupabaseClient } from '@supabase/supabase-js'
import { firstNameFrom } from './email-copy'

type GenericClient = SupabaseClient<any, 'public', any>

/**
 * The first name an invoice email should greet, or null for "Hi there".
 *
 *  1. The first name of the client's primary contact (`invoice_vendor_contacts.name`).
 *  2. Else the first name on the linked guest record (`customers.first_name`), which is how a
 *     private hire customer is known.
 *  3. Else null.
 *
 * NEVER the company name, and never `invoice_vendors.contact_name`: that legacy column is
 * blank on most records (the Vendors page used to wipe it) and was the reason every automatic
 * email opened "Dear Golden Barrels Limited".
 *
 * Never throws. A greeting is not worth failing a send over, so any lookup problem falls back
 * to "Hi there". Pass the admin client from crons and server actions: row level security on
 * these tables allows super admins only.
 */
export async function resolveInvoiceGreetingName(
  supabase: GenericClient,
  vendorId: string | null | undefined
): Promise<string | null> {
  if (!vendorId) return null

  try {
    const { data: contacts, error: contactsError } = await supabase
      .from('invoice_vendor_contacts')
      .select('name, is_primary')
      .eq('vendor_id', vendorId)
      .eq('is_primary', true)
      .limit(1)

    if (!contactsError) {
      const primary = firstNameFrom((contacts?.[0] as { name?: string | null } | undefined)?.name)
      if (primary) return primary
    }

    const { data: vendor, error: vendorError } = await supabase
      .from('invoice_vendors')
      .select('customer_id')
      .eq('id', vendorId)
      .maybeSingle()

    const customerId = (vendor as { customer_id?: string | null } | null)?.customer_id
    if (vendorError || !customerId) return null

    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('first_name')
      .eq('id', customerId)
      .maybeSingle()

    if (customerError) return null
    return firstNameFrom((customer as { first_name?: string | null } | null)?.first_name)
  } catch {
    return null
  }
}
