import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { calculateInvoiceTotals } from '@/lib/invoiceCalculations';
import { getTodayIsoDate } from '@/lib/dateUtils';
import { isInvoiceStatusTransitionAllowed } from '@/lib/status-transitions';
import { z } from 'zod'; // Import Zod

import type { InvoiceStatus, InvoiceLineItemInput, Invoice, InvoiceWithDetails, LineItemCatalogItem } from '@/types/invoices';

function sanitizeInvoiceSearch(value: string): string {
  return value
    .replace(/[,%_()"'\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}
export { isInvoiceStatusTransitionAllowed } from '@/lib/status-transitions';

// Invoice validation schema
export const CreateInvoiceSchema = z.object({
  vendor_id: z.string().uuid('Invalid vendor ID'),
  invoice_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  reference: z.string().optional(),
  invoice_discount_percentage: z.number().min(0).max(100).default(0),
  notes: z.string().optional(),
  internal_notes: z.string().optional()
});

export type CreateInvoiceInput = {
  vendor_id: string;
  invoice_date: string;
  due_date: string;
  reference?: string;
  invoice_discount_percentage: number;
  notes?: string;
  internal_notes?: string;
  line_items: InvoiceLineItemInput[];
};

export type RecordPaymentInput = {
  invoice_id: string;
  amount: number;
  payment_date: string;
  payment_method: string;
  reference?: string;
  notes?: string;
};

export class InvoiceService {
  /**
   * Creates an invoice and its line items atomically.
   */
  static async createInvoice(input: CreateInvoiceInput) {
    const supabase = await createClient();
    const adminClient = await createAdminClient(); // Admin client for potential sequence generation

    // Calculate totals
    const totals = calculateInvoiceTotals(input.line_items, input.invoice_discount_percentage);

    // Generate Invoice Number (optimistic)
    // ideally this should be part of the transaction if we want gapless numbers, 
    // but for now we keep the existing pattern of getting it first
    const { data: seqData, error: seqError } = await adminClient
      .rpc('get_and_increment_invoice_series', { p_series_code: 'INV' })
      .single();

    if (seqError) {
      throw new Error('Failed to generate invoice number');
    }

    const encoded = ((seqData as { next_sequence: number }).next_sequence + 5000)
      .toString(36)
      .toUpperCase()
      .padStart(5, '0');
    const invoiceNumber = `INV-${encoded}`;

    // Prepare payload
    const invoiceData = {
      invoice_number: invoiceNumber,
      vendor_id: input.vendor_id,
      invoice_date: input.invoice_date,
      due_date: input.due_date,
      reference: input.reference,
      invoice_discount_percentage: input.invoice_discount_percentage,
      subtotal_amount: totals.subtotalBeforeInvoiceDiscount,
      discount_amount: totals.invoiceDiscountAmount,
      vat_amount: totals.vatAmount,
      total_amount: totals.totalAmount,
      notes: input.notes,
      internal_notes: input.internal_notes,
      status: 'draft' as InvoiceStatus,
    };

    // Execute RPC
    const { data: invoice, error } = await supabase.rpc('create_invoice_transaction', {
      p_invoice_data: invoiceData,
      p_line_items: input.line_items
    });

    if (error) {
      console.error('Create invoice transaction error:', error);
      throw new Error('Failed to create invoice');
    }

    return invoice;
  }

  /**
   * Creates an invoice and its line items atomically using the service role client.
   * Intended for trusted server-side automation (e.g. cron jobs).
   */
  static async createInvoiceAsAdmin(input: CreateInvoiceInput) {
    const adminClient = await createAdminClient()

    const totals = calculateInvoiceTotals(input.line_items, input.invoice_discount_percentage)

    const { data: seqData, error: seqError } = await adminClient
      .rpc('get_and_increment_invoice_series', { p_series_code: 'INV' })
      .single()

    if (seqError) {
      throw new Error('Failed to generate invoice number')
    }

    const encoded = ((seqData as { next_sequence: number }).next_sequence + 5000)
      .toString(36)
      .toUpperCase()
      .padStart(5, '0')
    const invoiceNumber = `INV-${encoded}`

    const invoiceData = {
      invoice_number: invoiceNumber,
      vendor_id: input.vendor_id,
      invoice_date: input.invoice_date,
      due_date: input.due_date,
      reference: input.reference,
      invoice_discount_percentage: input.invoice_discount_percentage,
      subtotal_amount: totals.subtotalBeforeInvoiceDiscount,
      discount_amount: totals.invoiceDiscountAmount,
      vat_amount: totals.vatAmount,
      total_amount: totals.totalAmount,
      notes: input.notes,
      internal_notes: input.internal_notes,
      status: 'draft' as InvoiceStatus,
    }

    const { data: invoice, error } = await adminClient.rpc('create_invoice_transaction', {
      p_invoice_data: invoiceData,
      p_line_items: input.line_items
    })

    if (error) {
      console.error('Create invoice transaction error:', error)
      throw new Error('Failed to create invoice')
    }

    return invoice
  }

  /**
   * Records a payment and updates invoice status atomically.
   */
  static async recordPayment(input: RecordPaymentInput) {
    const supabase = await createClient();

    const { data: result, error } = await supabase.rpc('record_invoice_payment_transaction', {
      p_payment_data: {
        invoice_id: input.invoice_id,
        payment_date: input.payment_date,
        amount: input.amount,
        payment_method: input.payment_method,
        reference: input.reference,
        notes: input.notes
      }
    });

    if (error) {
      console.error('Record payment transaction error:', error);
      throw new Error(error.message || 'Failed to record payment');
    }

    return result;
  }

  /**
   * Updates an invoice and its line items using the existing RPC.
   */
  static async updateInvoice(invoiceId: string, input: Omit<CreateInvoiceInput, 'invoice_number'>) {
    const adminClient = await createAdminClient();

    const { data: existingInvoice, error: existingInvoiceError } = await adminClient
      .from('invoices')
      .select('id, status')
      .eq('id', invoiceId)
      .is('deleted_at', null)
      .maybeSingle()

    if (existingInvoiceError || !existingInvoice) {
      throw new Error('Invoice not found')
    }

    if (existingInvoice.status !== 'draft') {
      throw new Error('Only draft invoices can be edited')
    }

    // Calculate totals
    const totals = calculateInvoiceTotals(input.line_items, input.invoice_discount_percentage);

    const payload = {
      p_invoice_id: invoiceId,
      p_invoice_data: {
        vendor_id: input.vendor_id,
        invoice_date: input.invoice_date,
        due_date: input.due_date,
        reference: input.reference ?? null,
        invoice_discount_percentage: input.invoice_discount_percentage,
        subtotal_amount: totals.subtotalBeforeInvoiceDiscount,
        discount_amount: totals.invoiceDiscountAmount,
        vat_amount: totals.vatAmount,
        total_amount: totals.totalAmount,
        notes: input.notes ?? null,
        internal_notes: input.internal_notes ?? null
      },
      p_line_items: input.line_items.map(item => ({
        catalog_item_id: item.catalog_item_id || null,
        description: item.description,
        quantity: item.quantity,
        unit_price: item.unit_price,
        discount_percentage: item.discount_percentage,
        vat_rate: item.vat_rate
      }))
    };

    const { data: updatedInvoice, error: updateError } = await adminClient.rpc(
      'update_invoice_with_line_items',
      payload
    );

    if (updateError) {
      console.error('Error updating invoice via RPC:', updateError);
      throw new Error('Failed to update invoice');
    }

    return updatedInvoice;
  }

  static async persistOverdueInvoices() {
    const adminClient = await createAdminClient();
    const today = getTodayIsoDate();

    const { error } = await adminClient
      .from('invoices')
      .update({
        status: 'overdue' as InvoiceStatus,
        updated_at: new Date().toISOString(),
      })
      .lte('due_date', today)
      .eq('status', 'sent')
      .is('deleted_at', null);

    if (error) {
      console.error('Error persisting overdue invoices:', error);
      throw new Error('Failed to persist overdue invoices');
    }
  }

  static async getInvoices(
    status?: InvoiceStatus | 'unpaid',
    page: number = 1,
    limit: number = 20,
    search?: string
  ) {
    const supabase = await createClient();
    
    await this.persistOverdueInvoices(); // Ensure statuses are updated before fetching

    let query = supabase
      .from('invoices')
      .select(`
        *,
        vendor:invoice_vendors(*)
      `, { count: 'exact' })
      .is('deleted_at', null);

    if (status === 'unpaid') {
      query = query.in('status', ['draft', 'sent', 'partially_paid', 'overdue']);
    } else if (status) {
      query = query.eq('status', status);
    }

    if (search) {
      const searchTerm = sanitizeInvoiceSearch(search);
      if (searchTerm.length > 0) {
        query = query.or(`invoice_number.ilike.%${searchTerm}%,reference.ilike.%${searchTerm}%`);
      }
    }

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    query = query
      .order('invoice_date', { ascending: false })
      .range(from, to);

    const { data: invoices, error, count } = await query;

    if (error) {
      console.error('Error fetching invoices:', error);
      throw new Error('Failed to fetch invoices');
    }

    const today = getTodayIsoDate();
    const normalizedInvoices = invoices.map((invoice) => ({
      ...invoice,
      status:
        invoice.status === 'sent' && invoice.due_date < today
          ? ('overdue' as InvoiceStatus)
          : invoice.status,
    }));

    return {
      invoices: normalizedInvoices as InvoiceWithDetails[],
      total: count || 0
    };
  }

  static async getInvoiceById(invoiceId: string) {
    const supabase = await createClient();
    
    await this.persistOverdueInvoices();

    const { data: invoice, error } = await supabase
      .from('invoices')
      .select(`
        *,
        vendor:invoice_vendors(*),
        line_items:invoice_line_items(*),
        payments:invoice_payments(*)
      `)
      .eq('id', invoiceId)
      .is('deleted_at', null)
      .single();

    if (error) {
      console.error('Error fetching invoice:', error);
      throw new Error('Failed to fetch invoice');
    }

    const today = getTodayIsoDate();
    const normalized =
      invoice.status === 'sent' && invoice.due_date < today
        ? { ...invoice, status: 'overdue' as InvoiceStatus }
        : invoice;

    return normalized as InvoiceWithDetails;
  }

  static async getInvoiceSummary() {
    const supabase = await createClient();
    
    const { data, error } = await supabase
      .rpc('get_invoice_summary_stats')
      .single();

    if (error) {
      console.error('Error fetching invoice summary:', error);
      throw new Error('Failed to fetch invoice summary');
    }

    const summary = data as {
      total_outstanding: number;
      total_overdue: number;
      total_this_month: number;
      count_draft: number;
    };

    return { 
      total_outstanding: summary.total_outstanding || 0,
      total_overdue: summary.total_overdue || 0,
      total_this_month: summary.total_this_month || 0,
      count_draft: summary.count_draft || 0
    };
  }

  static async getLineItemCatalog() {
    const supabase = await createClient();
    
    const { data: items, error } = await supabase
      .from('line_item_catalog')
      .select('*')
      .eq('is_active', true)
      .order('name');

    if (error) {
      console.error('Error fetching line item catalog:', error);
      throw new Error('Failed to fetch line items');
    }

    return items as LineItemCatalogItem[];
  }

  static async updateInvoiceStatus(invoiceId: string, newStatus: InvoiceStatus) {
    const supabase = await createClient();
    
    // Get current invoice for old status
    const { data: currentInvoice, error: fetchError } = await supabase
      .from('invoices')
      .select('*')
      .eq('id', invoiceId)
      .is('deleted_at', null)
      .single();

    if (fetchError || !currentInvoice) {
      throw new Error('Invoice not found');
    }

    if (!isInvoiceStatusTransitionAllowed(currentInvoice.status as InvoiceStatus, newStatus)) {
      throw new Error(`Invalid status transition from ${currentInvoice.status} to ${newStatus}`);
    }

    if (currentInvoice.status === newStatus) {
      return { updatedInvoice: currentInvoice, oldStatus: currentInvoice.status };
    }

    const updates: any = {
      status: newStatus,
      updated_at: new Date().toISOString()
    };

    if (newStatus === 'paid') {
      updates.paid_amount = currentInvoice.total_amount;
    }

    const { data: updatedInvoice, error: updateError } = await supabase
      .from('invoices')
      .update(updates)
      .eq('id', invoiceId)
      .eq('status', currentInvoice.status)
      .is('deleted_at', null)
      .select()
      .maybeSingle();

    if (updateError) {
      console.error('Error updating invoice status:', updateError);
      throw new Error('Failed to update invoice status');
    }

    if (!updatedInvoice) {
      throw new Error('Invoice status changed before update completed');
    }
    return { updatedInvoice, oldStatus: currentInvoice.status };
  }

  static async deleteInvoice(invoiceId: string, userId: string) {
    const supabase = await createClient();
    
    const { data: invoice, error: fetchError } = await supabase
      .from('invoices')
      .select('invoice_number, status')
      .eq('id', invoiceId)
      .is('deleted_at', null)
      .single();

    if (fetchError || !invoice) {
      throw new Error('Invoice not found');
    }

    if (invoice.status !== 'draft') {
      throw new Error('Only draft invoices can be deleted');
    }

    const { data: deletedInvoice, error: deleteError } = await supabase
      .from('invoices')
      .update({ 
        deleted_at: new Date().toISOString(),
        deleted_by: userId,
        updated_at: new Date().toISOString()
      })
      .eq('id', invoiceId)
      .eq('status', 'draft')
      .is('deleted_at', null)
      .select('invoice_number')
      .maybeSingle();

    if (deleteError) {
      console.error('Error deleting invoice:', deleteError);
      throw new Error('Failed to delete invoice');
    }
    if (!deletedInvoice) {
      throw new Error('Invoice is no longer deletable');
    }
    return invoice;
  }

  static async createCatalogItem(input: { name: string, description?: string | null, default_price: number, default_vat_rate: number }) {
    const supabase = await createClient();
    
    const { data: item, error } = await supabase
      .from('line_item_catalog')
      .insert({
        name: input.name,
        description: input.description || null,
        default_price: input.default_price,
        default_vat_rate: input.default_vat_rate,
        is_active: true
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating catalog item:', error);
      throw new Error('Failed to create catalog item');
    }
    return item;
  }

  static async updateCatalogItem(itemId: string, input: { name?: string, description?: string | null, default_price?: number, default_vat_rate?: number }) {
    const supabase = await createClient();
    
    const { data: item, error } = await supabase
      .from('line_item_catalog')
      .update({
        name: input.name,
        description: input.description || null,
        default_price: input.default_price,
        default_vat_rate: input.default_vat_rate,
        updated_at: new Date().toISOString()
      })
      .eq('id', itemId)
      .select()
      .maybeSingle();

    if (error) {
      console.error('Error updating catalog item:', error);
      throw new Error('Failed to update catalog item');
    }
    if (!item) {
      throw new Error('Catalog item not found');
    }
    return item;
  }

  static async deleteCatalogItem(itemId: string) {
    const supabase = await createClient();
    
    const { data: updatedCatalogItem, error } = await supabase
      .from('line_item_catalog')
      .update({
        is_active: false,
        updated_at: new Date().toISOString()
      })
      .eq('id', itemId)
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('Error deleting catalog item:', error);
      throw new Error('Failed to delete catalog item');
    }
    if (!updatedCatalogItem) {
      throw new Error('Catalog item not found');
    }
    return { success: true };
  }
}
