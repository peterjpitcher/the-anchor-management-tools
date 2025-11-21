import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getTodayIsoDate } from '@/lib/dateUtils';

interface ExportData {
  profile: any;
  customers: any[];
  bookings: any[];
  messages: any[];
  employees: any[];
  auditLogs: any[];
}

export class GdprService {
  /**
   * Export all user data for GDPR compliance
   */
  static async exportUserData(targetUserId: string, currentUserId?: string) {
    const adminClient = createAdminClient();
    
    const exportData: ExportData = {
      profile: null,
      customers: [],
      bookings: [],
      messages: [],
      employees: [],
      auditLogs: []
    };
    
    // Export profile data
    const { data: profileData } = await adminClient
      .from('profiles')
      .select('*')
      .eq('id', targetUserId)
      .single();
    
    exportData.profile = profileData;
    
    // Export customer data (if user has customer records)
    const { data: customers } = await adminClient
      .from('customers')
      .select('*')
      .eq('email_address', profileData?.email); // Assuming email_address exists in customers table
    
    exportData.customers = customers || [];
    
    // Export bookings for those customers
    if (customers && customers.length > 0) {
      const customerIds = customers.map(c => c.id);
      const { data: bookings } = await adminClient
        .from('bookings')
        .select('*, event:events(*)')
        .in('customer_id', customerIds);
      
      exportData.bookings = bookings || [];
    }
    
    // Export messages
    if (customers && customers.length > 0) {
      const customerIds = customers.map(c => c.id);
      const { data: messages } = await adminClient
        .from('messages')
        .select('*')
        .in('customer_id', customerIds);
      
      exportData.messages = messages || [];
    }
    
    // Export employee data (if user is an employee)
    const { data: employees } = await adminClient
      .from('employees')
      .select('*')
      .eq('email_address', profileData?.email); // Assuming email_address exists in employees table
    
    exportData.employees = employees || [];
    
    // Export audit logs for this user
    const { data: auditLogs } = await adminClient
      .from('audit_logs')
      .select('*')
      .eq('user_id', targetUserId)
      .order('created_at', { ascending: false })
      .limit(1000);
    
    exportData.auditLogs = auditLogs || [];
    
    // Return as JSON file
    const jsonData = JSON.stringify(exportData, null, 2);
    const fileName = `gdpr-export-${targetUserId}-${getTodayIsoDate()}.json`;
    
    return {
      data: jsonData,
      fileName,
      mimeType: 'application/json'
    };
  }

  /**
   * Delete all user data (right to be forgotten)
   * Note: This is a destructive operation and should be carefully considered
   */
  static async deleteUserData(userId: string) {
    const adminClient = createAdminClient();
    
    // Note: Actual deletion would happen here
    // For safety, we're only logging the request and returning a success message
    // Implement actual deletion based on your data retention policies

    // This is a placeholder for the actual deletion logic.
    // In a real scenario, you'd perform cascade deletes or set flags across all related tables.
    // For now, it just returns a log message.

    console.warn(`GDPR: Initiated deletion for user ${userId}. Actual data deletion needs to be implemented here.`);

    return {
      message: 'User data deletion request has been logged. Manual review required.'
    };
  }
}
