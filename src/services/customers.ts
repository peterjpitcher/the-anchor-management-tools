import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { formatPhoneForStorage, generatePhoneVariants } from '@/lib/utils';
import { emailAddressResetFields, isEmailAddressChange } from '@/lib/email/address-reset';
import { getTodayIsoDate } from '@/lib/dateUtils';
import { GdprService } from '@/services/gdpr';
import { eraseCustomers } from '@/services/customer-erasure';
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

/**
 * Postgres puts the offending value in the error `details` of a unique
 * violation, for example `Key (mobile_e164)=(+447700900123) already exists.`,
 * so logging a raw Supabase error on this table writes a customer's phone
 * number or email into the server log. Log the code and the constraint message
 * only: they identify the failure without carrying the personal data.
 */
function describeDbError(error: { code?: string; message?: string } | null): {
  code: string;
  message: string;
} {
  return {
    code: error?.code ?? 'unknown',
    message: error?.message ?? 'Unknown database error'
  };
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

/** Names an erased, deleted or merged record carries once its personal data is gone. */
const ANONYMISED_NAMES = new Set(['Erased Customer', 'Deleted Customer', 'Merged Customer']);

export type UpcomingCustomerBookings = {
  tableBookings: number;
  eventBookings: number;
  privateBookings: number;
  parkingBookings: number;
  total: number;
};

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Bookings a customer still has ahead of them, which a delete must not strip of their contact
 * details (BK-161). Fails closed: if any count cannot be read the delete is refused.
 */
export async function findUpcomingCustomerBookings(
  db: AdminClient,
  customerId: string
): Promise<UpcomingCustomerBookings> {
  const today = getTodayIsoDate();
  const nowIso = new Date().toISOString();

  const [tableResult, eventBookingResult, privateResult, parkingResult] = await Promise.all([
    db
      .from('table_bookings')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', customerId)
      .in('status', ['pending_payment', 'confirmed', 'pending_card_capture'])
      .gte('booking_date', today),
    db
      .from('bookings')
      .select('id, event_id')
      .eq('customer_id', customerId)
      .in('status', ['pending_payment', 'confirmed']),
    db
      .from('private_bookings')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', customerId)
      .in('status', ['draft', 'confirmed'])
      .or(`event_date.gte.${today},date_tbd.eq.true`),
    db
      .from('parking_bookings')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', customerId)
      .in('status', ['pending_payment', 'confirmed'])
      .gte('end_at', nowIso),
  ]);

  const failed = [tableResult, eventBookingResult, privateResult, parkingResult].find((result) => result.error);
  if (failed?.error) {
    console.error('Upcoming booking check before customer delete failed:', describeDbError(failed.error));
    throw new Error("Could not check the customer's upcoming bookings, so nothing was deleted. Try again.");
  }

  const liveEventBookings = (eventBookingResult.data ?? []) as Array<{ id: string; event_id: string | null }>;
  const eventIds = Array.from(new Set(liveEventBookings.map((row) => row.event_id).filter((id): id is string => Boolean(id))));
  let eventBookings = 0;
  if (eventIds.length > 0) {
    const { data: upcomingEvents, error: eventError } = await db
      .from('events')
      .select('id')
      .in('id', eventIds)
      .gte('date', today);
    if (eventError) {
      console.error('Upcoming event check before customer delete failed:', describeDbError(eventError));
      throw new Error("Could not check the customer's upcoming bookings, so nothing was deleted. Try again.");
    }
    const upcomingIds = new Set(((upcomingEvents ?? []) as Array<{ id: string }>).map((row) => row.id));
    eventBookings = liveEventBookings.filter((row) => row.event_id && upcomingIds.has(row.event_id)).length;
  }

  const tableBookings = tableResult.count ?? 0;
  const privateBookings = privateResult.count ?? 0;
  const parkingBookings = parkingResult.count ?? 0;

  return {
    tableBookings,
    eventBookings,
    privateBookings,
    parkingBookings,
    total: tableBookings + eventBookings + privateBookings + parkingBookings,
  };
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** "This customer has 1 table booking and 2 event bookings coming up. ..." */
export function describeUpcomingBookingsRefusal(upcoming: UpcomingCustomerBookings): string {
  const parts = [
    upcoming.tableBookings > 0 ? plural(upcoming.tableBookings, 'table booking') : null,
    upcoming.eventBookings > 0 ? plural(upcoming.eventBookings, 'event booking') : null,
    upcoming.privateBookings > 0 ? plural(upcoming.privateBookings, 'private booking') : null,
    upcoming.parkingBookings > 0 ? plural(upcoming.parkingBookings, 'parking booking') : null,
  ].filter((part): part is string => Boolean(part));
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
  return `This customer has ${list} coming up. Cancel or move ${upcoming.total === 1 ? 'it' : 'them'} before deleting the customer, so the booking keeps its contact details.`;
}

export type CustomerDeleteResult = {
  message: string;
  counts: Record<string, number>;
  unscrubbedRows: number;
};

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
      console.error('Customer creation error:', describeDbError(error));
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

      // A new address inherits none of the old one's delivery history. Without this a bounce
      // from a mistyped address kept `email_deactivated_at` set, `isEmailUsable` kept saying
      // no, and the corrected address was never emailed again. See `address-reset.ts`.
      const { data: before } = await supabase
        .from('customers')
        .select('email')
        .eq('id', id)
        .maybeSingle();

      if (isEmailAddressChange(before?.email, payload.email as string | null)) {
        Object.assign(payload, emailAddressResetFields());
      }
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
      console.error('Customer update error:', describeDbError(error));
      throw new Error('Failed to update customer');
    }
    if (!customer) {
      throw new Error('Customer not found');
    }

    return customer;
  }

  /**
   * 'Delete customer' anonymises the record rather than wiping it (BK-161, customer bookings review
   * of 24 October 2026).
   *
   * It used to try a hard delete first, which cascaded away the guest's free and unpaid event
   * bookings, messages and consent history, and fell back to a made-up phone number only when a
   * foreign key refused. Either way their opt-outs were lost. Now it refuses while the customer
   * has bookings coming up, and otherwise runs the shared erasure path: opt-outs onto the
   * suppression list, vouchers unlinked, then the GDPR anonymisation, which keeps every booking and
   * consent row without the personal data. The caller has already checked customers manage.
   */
  static async deleteCustomer(id: string): Promise<CustomerDeleteResult> {
    const admin = createAdminClient();

    const { data: customer, error: fetchError } = await admin
      .from('customers')
      .select('id, first_name, last_name')
      .eq('id', id)
      .maybeSingle();

    if (fetchError) {
      console.error('Customer lookup before delete error:', describeDbError(fetchError));
      throw new Error('Failed to delete customer');
    }
    if (!customer) {
      throw new Error('Customer not found');
    }
    if (ANONYMISED_NAMES.has(`${customer.first_name} ${customer.last_name}`.trim())) {
      throw new Error('This customer has already been deleted.');
    }

    const upcoming = await findUpcomingCustomerBookings(admin, id);
    if (upcoming.total > 0) {
      throw new Error(describeUpcomingBookingsRefusal(upcoming));
    }

    const subject = await GdprService.resolveErasureSubject(id);
    if (!subject || !subject.customerIds.includes(id)) {
      throw new Error('Customer not found');
    }

    // Only this customer: a profile can never share a customer's id, but the erasure must not
    // reach past the record that was asked for.
    const { result } = await eraseCustomers(
      { ...subject, profileId: null, profileEmail: null, customerIds: [id] },
      'customer_deleted'
    );

    return {
      message: result.message,
      counts: { ...result.counts },
      unscrubbedRows: result.unscrubbedRows,
    };
  }

  static async importCustomers(customers: CreateCustomerInput[]): Promise<CustomerImportResult> {
    
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

    // The function is server-only (BK-105), so it runs through the service-role client; the importCustomers
    // action has already checked customers manage.
    const { data: importResult, error: importError } = await createAdminClient()
      .rpc('import_customers_atomic', { p_customers: importPayload });

    if (importError) {
      console.error('Batch customer import error:', describeDbError(importError));
      throw new Error('Failed to import customers');
    }

    const result = importResult as { created?: Customer[]; skippedExisting?: number } | null;
    if (!result || !Array.isArray(result.created)) {
      // The RPC payload is the imported customer rows, phone numbers and emails
      // included, so log its shape rather than its contents.
      console.error('Batch customer import invalid RPC result:', {
        type: importResult === null ? 'null' : typeof importResult,
        keys: importResult && typeof importResult === 'object' ? Object.keys(importResult) : []
      });
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
