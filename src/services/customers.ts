import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { formatPhoneForStorage, generatePhoneVariants } from '@/lib/utils';
import { createHash } from 'node:crypto';
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

// Capitalise first letter of each word (handles hyphens and apostrophes).
// Does not force-lowercase existing letters so abbreviations like "JR" are preserved.
function capitaliseName(name: string): string {
  return name.replace(/(?:^|[\s\-'])(\S)/g, c => c.toUpperCase());
}

function sanitizeFirstName(firstName: string | undefined): string {
  const trimmed = firstName?.trim() || '';
  return capitaliseName(trimmed);
}

function sanitizeLastName(lastName: string | undefined): string {
  const trimmed = lastName?.trim() || '';
  return capitaliseName(trimmed);
}

function isDuplicateKeyError(error: { code?: string; message?: string } | null): boolean {
  return error?.code === '23505';
}

function isForeignKeyViolation(error: { code?: string } | null): boolean {
  return error?.code === '23503';
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

function buildDeletedCustomerPhone(customerId: string, attempt: number): string {
  const hash = createHash('sha256').update(`${customerId}:${attempt}`).digest('hex');
  let digits = '';
  for (const char of hash) {
    digits += String(parseInt(char, 16) % 10);
  }
  return `+447000${digits.slice(0, 8)}`;
}

async function anonymizeCustomerForDelete(
  supabase: Awaited<ReturnType<typeof createClient>>,
  customerId: string
): Promise<void> {
  let lastError: { code?: string; message?: string } | null = null;

  for (let attempt = 0; attempt < 5; attempt++) {
    const deletedPhone = buildDeletedCustomerPhone(customerId, attempt);
    const payload: Record<string, unknown> = {
      first_name: 'Deleted',
      last_name: 'Customer',
      internal_notes: null,
      mobile_number: deletedPhone,
      mobile_e164: deletedPhone,
      mobile_number_raw: null,
      email: null,
      sms_opt_in: false,
      sms_status: 'opted_out',
      marketing_sms_opt_in: false,
      whatsapp_opt_in: false,
      whatsapp_status: 'opted_out',
      marketing_whatsapp_opt_in: false,
      marketing_email_opt_in: false,
      messaging_status: 'opted_out',
      stripe_customer_id: null,
      sms_delivery_failures: 0,
      last_sms_failure_reason: null,
      last_successful_sms_at: null,
      last_successful_delivery: null,
      consecutive_failures: 0,
      total_failures_30d: 0,
      last_failure_type: null,
      sms_deactivated_at: new Date().toISOString(),
      sms_deactivation_reason: 'customer_deleted',
    };

    const { data: anonymizedCustomer, error } = await supabase
      .from('customers')
      .update(payload)
      .eq('id', customerId)
      .select('id')
      .maybeSingle();

    if (!error && anonymizedCustomer) return;

    if (error) {
      lastError = error as { code?: string; message?: string };
      if (
        isDuplicateKeyError(lastError) &&
        isPhoneUniqueViolation(lastError)
      ) {
        continue;
      }

      console.error('Customer anonymization error:', error);
      throw new Error('Failed to delete customer');
    }

    throw new Error('Customer not found');
  }

  console.error('Customer anonymization exhausted unique phone retries:', lastError);
  throw new Error('Failed to delete customer');
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
      first_name: sanitizeFirstName(input.first_name),
      last_name: sanitizeLastName(input.last_name),
      mobile_number: mobileNumber,
      mobile_e164: mobileNumber,
      email: sanitizeEmail(input.email),
      sms_opt_in: input.sms_opt_in !== false,
      sms_status: input.sms_opt_in === false ? 'opted_out' : 'active',
      marketing_sms_opt_in: false,
      whatsapp_opt_in: true,
      whatsapp_status: 'active',
      marketing_whatsapp_opt_in: false,
      marketing_email_opt_in: false
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
    if (input.first_name !== undefined) {
      payload.first_name = sanitizeFirstName(input.first_name);
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
      if (isForeignKeyViolation(error as { code?: string } | null)) {
        await anonymizeCustomerForDelete(supabase, id);
        return customer;
      }

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
    const seenEmails = new Set<string>();
    let invalidCount = 0;
    let duplicateInFileCount = 0;

    for (const c of customers) {
      if ((!c.first_name && !c.last_name) || !c.mobile_number) {
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

      const email = sanitizeEmail(c.email);
      if (email && seenEmails.has(email)) {
        duplicateInFileCount++;
        continue;
      }
      if (email) {
        seenEmails.add(email);
      }

      validCustomers.push({
        ...c,
        mobile_number: formattedPhone,
        email: email ?? undefined,
        last_name: sanitizeLastName(c.last_name)
      });
    }

    if (validCustomers.length === 0) {
      return { created: [], skippedInvalid: invalidCount, skippedDuplicates: duplicateInFileCount, skippedExisting: 0 };
    }

    const importPayload = validCustomers.map((customer) => ({
      first_name: sanitizeFirstName(customer.first_name),
      last_name: sanitizeLastName(customer.last_name),
      mobile_number: customer.mobile_number,
      mobile_e164: customer.mobile_number,
      email: sanitizeEmail(customer.email),
      sms_opt_in: customer.sms_opt_in !== false,
      sms_status: customer.sms_opt_in === false ? 'opted_out' : 'active',
      marketing_sms_opt_in: false,
      whatsapp_opt_in: true,
      whatsapp_status: 'active',
      marketing_whatsapp_opt_in: false,
      marketing_email_opt_in: false
    }));

    const { data: importResult, error: importError } = await supabase
      .rpc('import_customers_atomic', { p_customers: importPayload });

    if (importError) {
      console.error('Batch customer import error:', importError);
      throw new Error('Failed to import customers');
    }

    const result = importResult as { created?: Customer[]; skippedExisting?: number } | null;
    if (!result || !Array.isArray(result.created)) {
      console.error('Batch customer import invalid RPC result:', importResult);
      throw new Error('Failed to import customers');
    }

    return { 
      created: result.created, 
      skippedInvalid: invalidCount, 
      skippedDuplicates: duplicateInFileCount, 
      skippedExisting: Number(result.skippedExisting ?? 0)
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

    // Batch delete all test customers in one query
    const ids = testCustomers.map(c => c.id);
    const { data: deletedRows, error: deleteError } = await supabase
      .from('customers')
      .delete()
      .in('id', ids)
      .select('id');

    if (deleteError) {
      return {
        success: false,
        deletedCount: 0,
        failedCount: testCustomers.length,
        deletedCustomers: [],
        failedDeletions: testCustomers.map(c => ({
          id: c.id,
          name: `${c.first_name} ${c.last_name || ''}`.trim(),
          error: deleteError.message,
        })),
        message: `Failed to delete test customers: ${deleteError.message}`,
      };
    }

    const deletedIds = new Set((deletedRows ?? []).map(r => r.id));
    const deletedCustomers = testCustomers
      .filter(c => deletedIds.has(c.id))
      .map(c => ({ id: c.id, name: `${c.first_name} ${c.last_name || ''}`.trim() }));
    const failedDeletions = testCustomers
      .filter(c => !deletedIds.has(c.id))
      .map(c => ({ id: c.id, name: `${c.first_name} ${c.last_name || ''}`.trim(), error: 'Customer was already removed' }));

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
}
