'use server';

import { createClient } from '@/lib/supabase/server';
import { checkUserPermission } from '@/app/actions/rbac';
import { TableBookingService, type ReportData } from '@/services/table-bookings';

export type { ReportData };

export async function getTableBookingReportData(dateRange: { start: string; end: string }): Promise<{ success: true; data: ReportData } | { error: string }> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { error: 'Authentication required' };
    }

    const canView = await checkUserPermission('table_bookings', 'view', user.id);
    if (!canView) {
      return { error: 'You do not have permission to view reports' };
    }

    const data = await TableBookingService.getReportData(dateRange);

    return { success: true, data };

  } catch (error: any) {
    console.error('Unexpected error in getTableBookingReportData:', error);
    return { error: error.message || 'An unexpected error occurred while generating the report' };
  }
}