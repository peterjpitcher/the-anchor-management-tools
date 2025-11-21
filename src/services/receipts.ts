import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import Papa from 'papaparse';
import { createHash } from 'crypto';
import type { ReceiptTransactionStatus, ReceiptClassificationSource, ReceiptExpenseCategory } from '@/types/database';

type CsvRow = {
  Date: string;
  Details: string;
  'Transaction Type': string;
  In: string;
  Out: string;
  Balance: string;
};

type ParsedTransactionRow = {
  transactionDate: string;
  details: string;
  transactionType: string | null;
  amountIn: number | null;
  amountOut: number | null;
  balance: number | null;
  dedupeHash: string;
};

export type ImportReceiptBatchInput = {
  fileContent: string;
  originalFilename: string;
  notes?: string;
  uploadedBy?: string;
};

export class ReceiptService {
  static async importBatch(input: ImportReceiptBatchInput) {
    const supabase = await createClient();
    const admin = await createAdminClient();

    // 1. Parse CSV
    const parseResult = Papa.parse<CsvRow>(input.fileContent, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (h) => h.trim(),
    });

    if (parseResult.errors.length > 0) {
      throw new Error(`CSV Parse Error: ${parseResult.errors[0].message}`);
    }

    if (!parseResult.data || parseResult.data.length === 0) {
      throw new Error('No rows found in CSV');
    }

    // 2. Prepare Transactions
    const transactions = parseResult.data.map((row) => this.parseRow(row)).filter(Boolean) as ParsedTransactionRow[];
    
    if (transactions.length === 0) {
      throw new Error('No valid transactions parsed');
    }

    // 3. Calculate Batch Hash (for deduping batches if needed)
    const sourceHash = createHash('sha256').update(input.fileContent).digest('hex');

    // 4. Auto-Classify (Simplified for now, can be expanded with rules engine)
    const enrichedTransactions = await Promise.all(transactions.map(async (tx) => {
      // Basic classification logic or rule application can go here
      // For now, we set defaults and let the "thick" logic stay if it's too complex to move all at once
      // Ideally, we fetch rules and apply them here.
      
      // NOTE: The full classification logic is very complex in the original action. 
      // We should ideally port the `classifyTransaction` logic here or keep it simple for the transaction.
      // Let's assume we want to persist first and classify later (async) or do basic mapping.
      
      return {
        transaction_date: tx.transactionDate,
        details: tx.details,
        transaction_type: tx.transactionType,
        amount_in: tx.amountIn,
        amount_out: tx.amountOut,
        balance: tx.balance,
        dedupe_hash: tx.dedupeHash,
        status: 'pending' as ReceiptTransactionStatus,
        receipt_required: true, // Default
        // vendor_name, expense_category could be set here if we ported the rules
      };
    }));

    // 5. Atomic Batch Import
    const { data: batch, error } = await supabase.rpc('import_receipt_batch_transaction', {
      p_batch_data: {
        original_filename: input.originalFilename,
        source_hash: sourceHash,
        row_count: transactions.length,
        notes: input.notes,
        uploaded_by: input.uploadedBy
      },
      p_transactions: enrichedTransactions
    });

    if (error) {
      console.error('Import receipt batch transaction error:', error);
      throw new Error('Failed to import receipt batch');
    }

    return batch;
  }

  private static parseRow(row: CsvRow): ParsedTransactionRow | null {
    const dateStr = row.Date?.trim();
    const details = row.Details?.trim();
    
    if (!dateStr || !details) return null;

    // Parse Date (assuming DD/MM/YYYY from UK banks)
    const [day, month, year] = dateStr.split('/');
    if (!day || !month || !year) return null;
    const isoDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;

    // Parse Numbers
    const parseAmount = (val: string) => {
      if (!val) return null;
      const cleaned = val.replace(/,/g, '').trim();
      const num = parseFloat(cleaned);
      return isNaN(num) ? null : num;
    };

    const amountIn = parseAmount(row.In);
    const amountOut = parseAmount(row.Out);
    const balance = parseAmount(row.Balance);

    // Generate Hash
    const rawString = `${isoDate}|${details}|${amountIn ?? ''}|${amountOut ?? ''}|${balance ?? ''}`;
    const dedupeHash = createHash('sha256').update(rawString).digest('hex');

    return {
      transactionDate: isoDate,
      details,
      transactionType: row['Transaction Type']?.trim() || null,
      amountIn,
      amountOut,
      balance,
      dedupeHash,
    };
  }
}
