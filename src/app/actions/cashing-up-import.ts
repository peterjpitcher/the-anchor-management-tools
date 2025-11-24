'use server'

import { createClient } from '@/lib/supabase/server';
import { CashingUpService } from '@/services/cashing-up.service';
import { PermissionService } from '@/services/permission';
import { UpsertCashupSessionDTO } from '@/types/cashing-up';

export interface ImportRow {
  date: string;
  siteName?: string;
  cashCounted?: number; // Mapped from 'Cash' or 'Actual Cash'
  cashExpected?: number; // Mapped from 'Z Report Cash' or 'Expected Cash'
  card: number;
  stripe: number;
  notes?: string;
  cashCounts?: Record<number, number>; // Optional: Denomination value -> Count
}

export interface ImportResult {
  success: boolean;
  summary: {
    total: number;
    succeeded: number;
    failed: number;
  };
  errors: string[];
}

export async function importCashupHistoryAction(rows: ImportRow[]): Promise<ImportResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    return { success: false, summary: { total: 0, succeeded: 0, failed: 0 }, errors: ['Unauthorized'] };
  }

  const hasPermission = await PermissionService.checkUserPermission('cashing_up', 'create', user.id);
  if (!hasPermission) {
    return { success: false, summary: { total: 0, succeeded: 0, failed: 0 }, errors: ['Forbidden'] };
  }

  // Fetch all sites for mapping
  const { data: sites, error: sitesError } = await supabase.from('sites').select('id, name');
  if (sitesError || !sites || sites.length === 0) {
    return { success: false, summary: { total: 0, succeeded: 0, failed: 0 }, errors: ['Failed to fetch sites or no sites defined'] };
  }
  
  const defaultSite = sites[0];

  const results = {
    total: rows.length,
    succeeded: 0,
    failed: 0,
  };
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    
    try {
      // 1. Match Site
      let site = defaultSite;
      if (row.siteName && row.siteName.trim() !== '') {
         const found = sites.find(s => s.name.toLowerCase() === row.siteName!.toLowerCase().trim());
         if (found) {
           site = found;
         } else {
           throw new Error(`Site not found: "${row.siteName}"`);
         }
      }

      // 2. Validate Date
      const dateObj = new Date(row.date);
      if (isNaN(dateObj.getTime())) {
        throw new Error(`Invalid date: "${row.date}"`);
      }
      const isoDate = dateObj.toISOString().split('T')[0]; // YYYY-MM-DD

      // 3. Prepare DTO
      // Process Cash Counts if available
      const cashCounts = [];
      let calculatedCashTotal = 0;

      if (row.cashCounts) {
        for (const [denom, value] of Object.entries(row.cashCounts)) {
          const denomination = parseFloat(denom);
          const inputValue = Number(value);
          // Input is Value (e.g. 150.00), not Count. Calculate Count.
          const quantity = Math.round(inputValue / denomination);
          
          if (quantity > 0) {
            cashCounts.push({ denomination, quantity });
            calculatedCashTotal += denomination * quantity;
          }
        }
      }

      // Determine Cash Counted
      let finalCashCounted = row.cashCounted || 0;
      // If 0 but counts exist, use counts
      if (finalCashCounted === 0 && calculatedCashTotal > 0) {
          finalCashCounted = calculatedCashTotal;
      }

      // Determine Cash Expected (Z Report)
      // If not provided, assume 0 variance (equal to counted)
      const finalCashExpected = row.cashExpected !== undefined ? row.cashExpected : finalCashCounted;

      const dto: UpsertCashupSessionDTO = {
        siteId: site.id,
        sessionDate: isoDate,
        status: 'approved', // Import as approved since it's historic
        notes: row.notes || 'Historic Import',
        paymentBreakdowns: [
          {
            paymentTypeCode: 'CASH',
            paymentTypeLabel: 'Cash',
            expectedAmount: finalCashExpected, 
            countedAmount: finalCashCounted,
          },
          {
            paymentTypeCode: 'CARD',
            paymentTypeLabel: 'Card',
            expectedAmount: row.card,
            countedAmount: row.card,
          },
          {
            paymentTypeCode: 'STRIPE',
            paymentTypeLabel: 'Stripe',
            expectedAmount: row.stripe,
            countedAmount: row.stripe,
          }
        ],
        cashCounts: cashCounts // Now populated if available
      };

      // 4. Upsert
      await CashingUpService.upsertSession(supabase, dto, user.id);
      results.succeeded++;

    } catch (err: any) {
      results.failed++;
      errors.push(`Row ${i + 1} (${row.date}): ${err.message}`);
    }
  }

  return {
    success: true,
    summary: results,
    errors
  };
}