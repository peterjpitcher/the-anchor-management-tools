import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { InvoiceVendor } from '@/types/invoices';
import { parsePaymentTermsValue } from '@/lib/vendors/paymentTerms';

function emptyToNull(v?: string | null): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length === 0 ? null : s;
}

export class VendorService {
  static async createVendor(input: {
    name: string;
    contact_name?: string | null;
    email?: string | null;
    phone?: string | null;
    address?: string | null;
    vat_number?: string | null;
    payment_terms: number;
    notes?: string | null;
  }) {
    const supabase = await createClient();
    
    const payload = {
      name: input.name,
      contact_name: emptyToNull(input.contact_name),
      email: emptyToNull(input.email),
      phone: emptyToNull(input.phone),
      address: emptyToNull(input.address),
      vat_number: emptyToNull(input.vat_number),
      payment_terms: input.payment_terms,
      notes: emptyToNull(input.notes)
    };

    const { data: vendor, error } = await supabase
      .from('invoice_vendors')
      .insert([payload])
      .select()
      .single();

    if (error) {
      console.error('Error creating vendor:', error);
      throw new Error('Failed to create vendor');
    }

    return vendor;
  }

  static async updateVendor(id: string, input: {
    name: string;
    contact_name?: string | null;
    email?: string | null;
    phone?: string | null;
    address?: string | null;
    vat_number?: string | null;
    payment_terms: number;
    notes?: string | null;
  }) {
    const supabase = await createClient();

    const payload = {
      name: input.name,
      contact_name: emptyToNull(input.contact_name),
      email: emptyToNull(input.email),
      phone: emptyToNull(input.phone),
      address: emptyToNull(input.address),
      vat_number: emptyToNull(input.vat_number),
      payment_terms: input.payment_terms,
      notes: emptyToNull(input.notes)
    };

    const { data: vendor, error } = await supabase
      .from('invoice_vendors')
      .update(payload)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating vendor:', error);
      throw new Error('Failed to update vendor');
    }

    return vendor;
  }

  static async deleteVendor(vendorId: string) {
    const supabase = await createClient();
    
    // Check if vendor has any invoices
    const { data: invoices, error: checkError } = await supabase
      .from('invoices')
      .select('id')
      .eq('vendor_id', vendorId)
      .limit(1);

    if (checkError) {
      console.error('Error checking vendor usage:', checkError);
      throw new Error('Failed to check vendor usage');
    }

    if (invoices && invoices.length > 0) {
      // Soft delete by marking as inactive
      const { error } = await supabase
        .from('invoice_vendors')
        .update({ is_active: false })
        .eq('id', vendorId);

      if (error) {
        console.error('Error deactivating vendor:', error);
        throw new Error('Failed to deactivate vendor');
      }
      return { action: 'deactivated' };
    } else {
      // Hard delete if no invoices
      const { error } = await supabase
        .from('invoice_vendors')
        .delete()
        .eq('id', vendorId);

      if (error) {
        console.error('Error deleting vendor:', error);
        throw new Error('Failed to delete vendor');
      }
      return { action: 'deleted' };
    }
  }
}
