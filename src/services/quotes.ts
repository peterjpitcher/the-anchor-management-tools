import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { calculateInvoiceTotals } from '@/lib/invoiceCalculations';
import { isQuoteStatusTransitionAllowed } from '@/lib/status-transitions';
import type { QuoteStatus, InvoiceLineItemInput } from '@/types/invoices';

export type CreateQuoteInput = {
  vendor_id: string;
  quote_date: string;
  valid_until: string;
  reference?: string;
  quote_discount_percentage: number;
  notes?: string;
  internal_notes?: string;
  line_items: InvoiceLineItemInput[];
};
export { isQuoteStatusTransitionAllowed } from '@/lib/status-transitions';

export class QuoteService {
  static async createQuote(input: CreateQuoteInput) {
    const supabase = await createClient();
    const adminClient = createAdminClient();

    // Calculate totals (reusing invoice logic as schema is identical)
    const totals = calculateInvoiceTotals(input.line_items, input.quote_discount_percentage);

    // Generate Quote Number
    const { data: seqData, error: seqError } = await adminClient
      .rpc('get_and_increment_invoice_series', { p_series_code: 'QTE' })
      .single();

    if (seqError) {
      throw new Error('Failed to generate quote number');
    }

    const encoded = ((seqData as { next_sequence: number }).next_sequence + 3000)
      .toString(36)
      .toUpperCase()
      .padStart(5, '0');
    const quoteNumber = `QTE-${encoded}`;

    const quoteData = {
      quote_number: quoteNumber,
      vendor_id: input.vendor_id,
      quote_date: input.quote_date,
      valid_until: input.valid_until,
      reference: input.reference,
      quote_discount_percentage: input.quote_discount_percentage,
      subtotal_amount: totals.subtotalBeforeInvoiceDiscount,
      discount_amount: totals.invoiceDiscountAmount,
      vat_amount: totals.vatAmount,
      total_amount: totals.totalAmount,
      notes: input.notes,
      internal_notes: input.internal_notes,
      status: 'draft' as QuoteStatus,
    };

    // Atomic Transaction
    const { data: quote, error } = await supabase.rpc('create_quote_transaction', {
      p_quote_data: quoteData,
      p_line_items: input.line_items
    });

    if (error) {
      console.error('Create quote transaction error:', error);
      throw new Error('Failed to create quote');
    }

    return quote;
  }
}
