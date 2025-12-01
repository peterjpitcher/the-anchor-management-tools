'use server';

import { CashingUpService } from '@/services/cashing-up.service';
import { BusinessHoursService } from '@/services/business-hours';
import { createClient } from '@/lib/supabase/server';
import { eachDayOfInterval, subDays, format, isSameDay } from 'date-fns';

export async function getMissingCashupDatesAction(siteId: string, daysBack = 365) {
  const supabase = await createClient();
  const today = new Date();
  const fromDate = subDays(today, daysBack);
  
  try {
    // 1. Get all dates in range
    const allDates = eachDayOfInterval({ start: fromDate, end: subDays(today, 1) }); // Exclude today
    
    // 2. Get existing sessions
    const { data: sessions, error } = await supabase
      .from('cashup_sessions')
      .select('session_date')
      .eq('site_id', siteId)
      .gte('session_date', format(fromDate, 'yyyy-MM-dd'))
      .lte('session_date', format(subDays(today, 1), 'yyyy-MM-dd'));

    if (error) throw error;
    
    const existingDates = new Set(sessions?.map(s => s.session_date) || []);

    // 3. Filter for open days that are missing
    const missingDates: string[] = [];
    
    for (const date of allDates) {
      const dateStr = format(date, 'yyyy-MM-dd');
      
      // Skip if exists
      if (existingDates.has(dateStr)) continue;
      
      // Check if open
      const isOpen = await BusinessHoursService.isSiteOpen(siteId, dateStr);
      if (isOpen) {
        missingDates.push(dateStr);
      }
    }

    // Sort descending (newest first)
    return { success: true, dates: missingDates.reverse() };

  } catch (error: any) {
    console.error('Error checking missing dates:', error);
    return { success: false, error: error.message };
  }
}
