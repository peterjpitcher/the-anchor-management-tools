import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { formatPhoneForStorage, generatePhoneVariants } from '@/lib/utils';
import type { 
  CreateCustomerInput, 
  UpdateCustomerInput, 
  Customer, 
  CustomerImportResult,
  BulkDeleteResult
} from '@/types/customers';

type CustomerPhoneLookupRow = {
  id: string;
  mobile_number: string | null;
  mobile_e164: string | null;
};

function sanitizeEmail(email: string | undefined): string | null {
  if (!email) return null;
  const normalized = email.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function sanitizeLastName(lastName: string | undefined): string {
  const normalized = lastName?.trim() || '';
  return normalized.length > 0 ? normalized : 'Guest';
}

function toCanonicalPhoneSetFromRows(rows: CustomerPhoneLookupRow[]): Set<string> {
  const canonicalPhones = new Set<string>();

  for (const row of rows) {
    const rawPhone = row.mobile_e164 || row.mobile_number;
    if (!rawPhone) continue;

    try {
      canonicalPhones.add(formatPhoneForStorage(rawPhone));
    } catch {
      // Keep scanning. Bad historical rows should not abort import/create lookups.
    }
  }

  return canonicalPhones;
}

function isDuplicateKeyError(error: { code?: string; message?: string } | null): boolean {
  return error?.code === '23505';
}

function isPhoneUniqueViolation(error: { message?: string } | null): boolean {
  const message = error?.message?.toLowerCase() || '';
  return (
    message.includes('idx_customers_mobile_e164') ||
    message.includes('idx_customers_mobile_e164_unique') ||
    message.includes('idx_customers_mobile_number') ||
    message.includes('customers_mobile_number')
  );
}

function isEmailUniqueViolation(error: { message?: string } | null): boolean {
  const message = error?.message?.toLowerCase() || '';
  return message.includes('idx_customers_email_unique') || message.includes('customers_email');
}

async function findExistingCustomerByPhone(
  supabase: Awaited<ReturnType<typeof createClient>>,
  canonicalPhone: string,
  excludeCustomerId?: string
): Promise<CustomerPhoneLookupRow | null> {
  const phoneVariants = Array.from(new Set(generatePhoneVariants(canonicalPhone)));

  let canonicalQuery = supabase
    .from('customers')
    .select('id, mobile_number, mobile_e164')
    .eq('mobile_e164', canonicalPhone)
    .order('created_at', { ascending: true })
    .limit(1);

  if (excludeCustomerId) {
    canonicalQuery = canonicalQuery.neq('id', excludeCustomerId);
  }

  const { data: canonicalRows, error: canonicalError } = await canonicalQuery;
  if (canonicalError) {
    throw canonicalError;
  }

  if (canonicalRows && canonicalRows.length > 0) {
    return canonicalRows[0] as CustomerPhoneLookupRow;
  }

  if (phoneVariants.length === 0) {
    return null;
  }

  let legacyQuery = supabase
    .from('customers')
    .select('id, mobile_number, mobile_e164')
    .in('mobile_number', phoneVariants)
    .order('created_at', { ascending: true })
    .limit(1);

  if (excludeCustomerId) {
    legacyQuery = legacyQuery.neq('id', excludeCustomerId);
  }

  const { data: legacyRows, error: legacyError } = await legacyQuery;
  if (legacyError) {
    throw legacyError;
  }

  return legacyRows && legacyRows.length > 0 ? (legacyRows[0] as CustomerPhoneLookupRow) : null;
}

export class CustomerService {
  static async createCustomer(input: CreateCustomerInput): Promise<Customer> {
    const supabase = await createClient();

    if (!input.mobile_number || input.mobile_number.trim().length === 0) {
      throw new Error('Mobile number is required');
    }

    let mobileNumber: string;
    try {
      mobileNumber = formatPhoneForStorage(input.mobile_number, {
        defaultCountryCode: input.default_country_code
      });
    } catch (e) {
      throw new Error('Invalid phone number format');
    }

    const existing = await findExistingCustomerByPhone(supabase, mobileNumber);
    if (existing) {
      throw new Error('A customer with this phone number already exists');
    }

    const payload = {
      first_name: input.first_name,
      last_name: sanitizeLastName(input.last_name),
      mobile_number: mobileNumber,
      mobile_e164: mobileNumber,
      email: sanitizeEmail(input.email),
      sms_opt_in: input.sms_opt_in
    };

    const { data: customer, error } = await supabase
      .from('customers')
      .insert(payload)
      .select()
      .single();

    if (error) {
      if (isDuplicateKeyError(error as { code?: string; message?: string } | null)) {
        if (isPhoneUniqueViolation(error)) {
          throw new Error('A customer with this phone number already exists');
        }
        if (isEmailUniqueViolation(error)) {
          throw new Error('A customer with this email already exists');
        }
      }
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
        mobileNumber = formatPhoneForStorage(mobileNumber, {
          defaultCountryCode: input.default_country_code
        });
      } catch (e) {
        throw new Error('Invalid phone number format');
      }

      const existing = await findExistingCustomerByPhone(supabase, mobileNumber, id);
      if (existing) {
        throw new Error('A customer with this phone number already exists');
      }
    }

    const payload: Record<string, unknown> = { ...input };
    delete payload.default_country_code;
    if (mobileNumber !== undefined) {
      payload.mobile_number = mobileNumber;
      payload.mobile_e164 = mobileNumber;
    }
    if (input.email !== undefined) {
      payload.email = sanitizeEmail(input.email);
    }
    if (input.last_name !== undefined) {
      payload.last_name = sanitizeLastName(input.last_name);
    }
    
    // Remove undefined keys
    Object.keys(payload).forEach(key => payload[key] === undefined && delete payload[key]);

    const { data: customer, error } = await supabase
      .from('customers')
      .update(payload)
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error) {
      if (isDuplicateKeyError(error as { code?: string; message?: string } | null)) {
        if (isPhoneUniqueViolation(error)) {
          throw new Error('A customer with this phone number already exists');
        }
        if (isEmailUniqueViolation(error)) {
          throw new Error('A customer with this email already exists');
        }
      }
      console.error('Customer update error:', error);
      throw new Error('Failed to update customer');
    }
    if (!customer) {
      throw new Error('Customer not found');
    }

    return customer;
  }

  static async deleteCustomer(id: string): Promise<Customer | null> {
    const supabase = await createClient();

    // Fetch first to return for audit log
    const { data: customer, error: fetchError } = await supabase
      .from('customers')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (fetchError) {
      console.error('Customer lookup before delete error:', fetchError);
      throw new Error('Failed to delete customer');
    }
    if (!customer) {
      throw new Error('Customer not found');
    }

    const { data: deletedCustomer, error } = await supabase
      .from('customers')
      .delete()
      .eq('id', id)
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('Customer deletion error:', error);
      throw new Error('Failed to delete customer');
    }
    if (!deletedCustomer) {
      throw new Error('Customer not found');
    }

    return customer;
  }

  static async importCustomers(customers: CreateCustomerInput[]): Promise<CustomerImportResult> {
    const supabase = await createClient();
    
    // Validate and Format
    const validCustomers: Array<CreateCustomerInput & { mobile_number: string }> = [];
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
        formattedPhone = formatPhoneForStorage(c.mobile_number, {
          defaultCountryCode: c.default_country_code
        });
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
        email: sanitizeEmail(c.email) ?? undefined,
        last_name: sanitizeLastName(c.last_name)
      });
    }

    if (validCustomers.length === 0) {
      return { created: [], skippedInvalid: invalidCount, skippedDuplicates: duplicateInFileCount, skippedExisting: 0 };
    }

    // Check Database Duplicates
    const canonicalPhoneList = Array.from(seenPhones);
    const { data: existingCanonicalRows, error: existingCanonicalError } = await supabase
      .from('customers')
      .select('id, mobile_number, mobile_e164')
      .in('mobile_e164', canonicalPhoneList);

    if (existingCanonicalError) {
      console.error('Batch customer import canonical lookup error:', existingCanonicalError);
      throw new Error('Failed to import customers');
    }

    const { data: existingLegacyRows, error: existingLegacyError } = await supabase
      .from('customers')
      .select('id, mobile_number, mobile_e164')
      .in('mobile_number', canonicalPhoneList);

    if (existingLegacyError) {
      console.error('Batch customer import legacy lookup error:', existingLegacyError);
      throw new Error('Failed to import customers');
    }

    const existingSet = toCanonicalPhoneSetFromRows([
      ...((existingCanonicalRows || []) as CustomerPhoneLookupRow[]),
      ...((existingLegacyRows || []) as CustomerPhoneLookupRow[])
    ]);
    const newCustomers = validCustomers.filter(c => !existingSet.has(c.mobile_number!));
    let skippedExistingCount = validCustomers.length - newCustomers.length;

    if (newCustomers.length === 0) {
      return { created: [], skippedInvalid: invalidCount, skippedDuplicates: duplicateInFileCount, skippedExisting: skippedExistingCount };
    }

    // Batch Insert
    const insertPayload = newCustomers.map((customer) => ({
      first_name: customer.first_name,
      last_name: sanitizeLastName(customer.last_name),
      mobile_number: customer.mobile_number,
      mobile_e164: customer.mobile_number,
      email: sanitizeEmail(customer.email),
      sms_opt_in: customer.sms_opt_in
    }));

    let createdRows: Customer[] = [];

    const { data: created, error } = await supabase
      .from('customers')
      .insert(insertPayload)
      .select();

    if (error) {
      if (isDuplicateKeyError(error as { code?: string; message?: string } | null)) {
        const { data: upserted, error: upsertError } = await supabase
          .from('customers')
          .upsert(insertPayload, {
            onConflict: 'mobile_e164',
            ignoreDuplicates: true
          })
          .select();

        if (upsertError) {
          if (isEmailUniqueViolation(upsertError)) {
            throw new Error('Import contains an email that already belongs to another customer');
          }
          console.error('Batch customer import upsert error:', upsertError);
          throw new Error('Failed to import customers');
        }

        createdRows = (upserted || []) as Customer[];
      } else {
        if (isEmailUniqueViolation(error)) {
          throw new Error('Import contains an email that already belongs to another customer');
        }
        console.error('Batch customer import error:', error);
        throw new Error('Failed to import customers');
      }
    } else {
      createdRows = (created || []) as Customer[];
    }

    skippedExistingCount += Math.max(0, newCustomers.length - createdRows.length);

    return { 
      created: createdRows, 
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
      const { data: deletedCustomer, error: deleteError } = await supabase
        .from('customers')
        .delete()
        .eq('id', customer.id)
        .select('id')
        .maybeSingle();

      const name = `${customer.first_name} ${customer.last_name || ''}`.trim();

      if (deleteError || !deletedCustomer) {
        failedDeletions.push({
          id: customer.id,
          name,
          error: deleteError?.message || 'Customer was already removed'
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
      .select('id, sms_opt_in, sms_status, marketing_sms_opt_in, sms_delivery_failures, sms_deactivated_at, sms_deactivation_reason')
      .eq('id', customerId)
      .maybeSingle();

    if (fetchError || !customer) {
      throw new Error('Customer not found');
    }

    const updateData: Record<string, unknown> = {
      sms_opt_in: optIn,
    };

    if (optIn) {
      updateData.sms_status = 'active';
      updateData.sms_delivery_failures = 0;
      updateData.sms_deactivated_at = null;
      updateData.sms_deactivation_reason = null;
    } else {
      updateData.sms_status = 'opted_out';
      updateData.marketing_sms_opt_in = false;
      // Keep SMS status-derived fields consistent when explicitly opting out.
      updateData.sms_deactivated_at = null;
      updateData.sms_deactivation_reason = null;
    }

    const { data: updatedCustomer, error: updateError } = await supabase
      .from('customers')
      .update(updateData)
      .eq('id', customerId)
      .select('id')
      .maybeSingle();

    if (updateError) {
      throw new Error('Failed to update customer SMS preferences');
    }
    if (!updatedCustomer) {
      throw new Error('Customer not found');
    }

    return {
      oldValues: {
        sms_opt_in: customer.sms_opt_in,
        sms_status: (customer as any).sms_status ?? null,
        marketing_sms_opt_in: (customer as any).marketing_sms_opt_in ?? null,
        sms_delivery_failures: customer.sms_delivery_failures,
        sms_deactivated_at: customer.sms_deactivated_at,
        sms_deactivation_reason: customer.sms_deactivation_reason,
      },
      newValues: {
        sms_opt_in: optIn,
        sms_status: (updateData.sms_status as string | undefined) ?? (customer as any).sms_status ?? null,
        marketing_sms_opt_in: (updateData.marketing_sms_opt_in as boolean | undefined) ?? (customer as any).marketing_sms_opt_in ?? null,
        sms_delivery_failures: updateData.sms_delivery_failures ?? customer.sms_delivery_failures,
        sms_deactivated_at: Object.prototype.hasOwnProperty.call(updateData, 'sms_deactivated_at')
          ? updateData.sms_deactivated_at
          : customer.sms_deactivated_at,
        sms_deactivation_reason: Object.prototype.hasOwnProperty.call(updateData, 'sms_deactivation_reason')
          ? updateData.sms_deactivation_reason
          : customer.sms_deactivation_reason,
      }
    };
  }
}
