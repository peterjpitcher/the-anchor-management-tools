import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { formatPhoneForStorage } from '@/lib/validation';
import type { 
  CreateCustomerInput, 
  UpdateCustomerInput, 
  Customer, 
  CustomerImportResult,
  BulkDeleteResult
} from '@/types/customers';

export class CustomerService {
  static async createCustomer(input: CreateCustomerInput): Promise<Customer> {
    const supabase = await createClient();

    let mobileNumber: string | undefined;
    if (input.mobile_number) {
      try {
        mobileNumber = formatPhoneForStorage(input.mobile_number);
      } catch (e) {
        throw new Error('Invalid UK phone number format');
      }

      // Check existence
      const { data: existing } = await supabase
        .from('customers')
        .select('id')
        .eq('mobile_number', mobileNumber)
        .maybeSingle();

      if (existing) {
        throw new Error('A customer with this phone number already exists');
      }
    }

    const payload = {
      first_name: input.first_name,
      last_name: input.last_name ?? null,
      mobile_number: mobileNumber ?? null,
      email: input.email ? input.email.toLowerCase() : null,
      sms_opt_in: input.sms_opt_in
    };

    const { data: customer, error } = await supabase
      .from('customers')
      .insert(payload)
      .select()
      .single();

    if (error) {
      console.error('Customer creation error:', error);
      throw new Error('Failed to create customer');
    }

    return customer;
  }

  static async updateCustomer(id: string, input: UpdateCustomerInput): Promise<Customer> {
    const supabase = await createClient();

    let mobileNumber = input.mobile_number;
    if (mobileNumber) {
      try {
        mobileNumber = formatPhoneForStorage(mobileNumber);
      } catch (e) {
        throw new Error('Invalid UK phone number format');
      }

      const { data: existing } = await supabase
        .from('customers')
        .select('id')
        .eq('mobile_number', mobileNumber)
        .neq('id', id)
        .maybeSingle();

      if (existing) {
        throw new Error('A customer with this phone number already exists');
      }
    }

    const payload: Record<string, unknown> = { ...input };
    if (mobileNumber !== undefined) payload.mobile_number = mobileNumber;
    if (input.email) payload.email = input.email.toLowerCase();
    
    // Remove undefined keys
    Object.keys(payload).forEach(key => payload[key] === undefined && delete payload[key]);

    const { data: customer, error } = await supabase
      .from('customers')
      .update(payload)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Customer update error:', error);
      throw new Error('Failed to update customer');
    }

    return customer;
  }

  static async deleteCustomer(id: string): Promise<Customer | null> {
    const supabase = await createClient();

    // Fetch first to return for audit log
    const { data: customer } = await supabase
      .from('customers')
      .select('*')
      .eq('id', id)
      .single();

    const { error } = await supabase
      .from('customers')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Customer deletion error:', error);
      throw new Error('Failed to delete customer');
    }

    return customer;
  }

  static async importCustomers(customers: CreateCustomerInput[]): Promise<CustomerImportResult> {
    const supabase = await createClient();
    
    // Validate and Format
    const validCustomers: CreateCustomerInput[] = [];
    const seenPhones = new Set<string>();
    let invalidCount = 0;
    let duplicateInFileCount = 0;

    for (const c of customers) {
      if (!c.first_name || !c.mobile_number) {
        invalidCount++;
        continue;
      }

      let formattedPhone;
      try {
        formattedPhone = formatPhoneForStorage(c.mobile_number);
      } catch {
        invalidCount++;
        continue;
      }

      if (seenPhones.has(formattedPhone)) {
        duplicateInFileCount++;
        continue;
      }
      seenPhones.add(formattedPhone);

      validCustomers.push({
        ...c,
        mobile_number: formattedPhone,
        email: c.email ? c.email.toLowerCase() : undefined
      });
    }

    if (validCustomers.length === 0) {
      return { created: [], skippedInvalid: invalidCount, skippedDuplicates: duplicateInFileCount, skippedExisting: 0 };
    }

    // Check Database Duplicates
    const { data: existing } = await supabase
      .from('customers')
      .select('mobile_number')
      .in('mobile_number', Array.from(seenPhones));

    const existingSet = new Set((existing || []).map(c => c.mobile_number));
    const newCustomers = validCustomers.filter(c => !existingSet.has(c.mobile_number!));
    const skippedExistingCount = validCustomers.length - newCustomers.length;

    if (newCustomers.length === 0) {
      return { created: [], skippedInvalid: invalidCount, skippedDuplicates: duplicateInFileCount, skippedExisting: skippedExistingCount };
    }

    // Batch Insert
    const { data: created, error } = await supabase
      .from('customers')
      .insert(newCustomers)
      .select();

    if (error) {
      console.error('Batch customer import error:', error);
      throw new Error('Failed to import customers');
    }

    return { 
      created: created || [], 
      skippedInvalid: invalidCount, 
      skippedDuplicates: duplicateInFileCount, 
      skippedExisting: skippedExistingCount 
    };
  }

  static async deleteTestCustomers(): Promise<BulkDeleteResult> {
    const supabase = await createClient();

    // Find all customers with 'test' in first or last name (case-insensitive)
    const { data: testCustomers, error: fetchError } = await supabase
      .from('customers')
      .select('id, first_name, last_name')
      .or('first_name.ilike.%test%,last_name.ilike.%test%');

    if (fetchError) {
      console.error('Error fetching test customers:', fetchError);
      throw new Error('Failed to fetch test customers');
    }

    if (!testCustomers || testCustomers.length === 0) {
      return { success: true, deletedCount: 0, message: 'No test customers found' };
    }

    const deletedCustomers: { id: string; name: string }[] = [];
    const failedDeletions: { id: string; name: string; error: string }[] = [];

    // Delete each test customer one by one to allow partial success and tracking
    for (const customer of testCustomers) {
      const { error: deleteError } = await supabase
        .from('customers')
        .delete()
        .eq('id', customer.id);

      const name = `${customer.first_name} ${customer.last_name || ''}`.trim();

      if (deleteError) {
        failedDeletions.push({
          id: customer.id,
          name,
          error: deleteError.message
        });
      } else {
        deletedCustomers.push({
          id: customer.id,
          name
        });
      }
    }

    if (failedDeletions.length > 0) {
      return {
        success: false,
        deletedCount: deletedCustomers.length,
        failedCount: failedDeletions.length,
        deletedCustomers,
        failedDeletions,
        message: `Deleted ${deletedCustomers.length} test customers. Failed to delete ${failedDeletions.length} customers.`
      };
    }

    return {
      success: true,
      deletedCount: deletedCustomers.length,
      deletedCustomers,
      message: `Successfully deleted ${deletedCustomers.length} test customers`
    };
  }

  static async toggleSmsOptIn(customerId: string, optIn: boolean) {
    const supabase = createAdminClient();

    const { data: customer, error: fetchError } = await supabase
      .from('customers')
      .select('id, sms_opt_in, sms_delivery_failures, sms_deactivated_at, sms_deactivation_reason')
      .eq('id', customerId)
      .maybeSingle();

    if (fetchError || !customer) {
      throw new Error('Customer not found');
    }

    const updateData: Record<string, unknown> = {
      sms_opt_in: optIn,
    };

    if (optIn) {
      updateData.sms_delivery_failures = 0;
      updateData.sms_deactivated_at = null;
      updateData.sms_deactivation_reason = null;
    }

    const { error: updateError } = await supabase
      .from('customers')
      .update(updateData)
      .eq('id', customerId);

    if (updateError) {
      throw new Error('Failed to update customer SMS preferences');
    }

    return {
      oldValues: {
        sms_opt_in: customer.sms_opt_in,
        sms_delivery_failures: customer.sms_delivery_failures,
        sms_deactivated_at: customer.sms_deactivated_at,
        sms_deactivation_reason: customer.sms_deactivation_reason,
      },
      newValues: {
        sms_opt_in: optIn,
        sms_delivery_failures: updateData.sms_delivery_failures ?? customer.sms_delivery_failures,
        sms_deactivated_at: updateData.sms_deactivated_at ?? customer.sms_deactivated_at,
        sms_deactivation_reason: updateData.sms_deactivation_reason ?? customer.sms_deactivation_reason,
      }
    };
  }
}