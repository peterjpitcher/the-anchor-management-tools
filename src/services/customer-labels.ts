import { createAdminClient } from '@/lib/supabase/admin';

export class CustomerLabelService {
  static async applyLabelsRetroactively() {
    const admin = createAdminClient();

    console.log('Backfilling customer category stats...');
    const { data: backfillData, error: backfillError } = await admin
      .rpc('backfill_customer_category_stats');
    
    if (backfillError) {
      console.error('Error backfilling customer stats:', backfillError);
      // Continue anyway - partial data is better than none
    } else {
      console.log(`Backfilled ${backfillData || 0} customer category stats`);
    }

    // Call the RPC function
    const { data, error } = await admin
      .rpc('apply_customer_labels_retroactively');

    if (error) {
      throw error;
    }

    return data;
  }

  static async bulkAssignLabel(labelId: string, customerIds: string[], assignedBy?: string) {
    const admin = createAdminClient();

    // Prepare bulk insert data
    const assignments = customerIds.map(customerId => ({
      customer_id: customerId,
      label_id: labelId,
      assigned_by: assignedBy,
      auto_assigned: false,
      notes: 'Bulk assigned'
    }));

    // Insert with conflict handling
    const { error } = await admin
      .from('customer_label_assignments')
      .upsert(assignments, { onConflict: 'customer_id,label_id' });

    if (error) {
      throw error;
    }

    return { count: customerIds.length };
  }
}
