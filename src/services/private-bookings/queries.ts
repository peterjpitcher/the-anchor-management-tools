import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { toLocalIsoDate } from '@/lib/dateUtils';
import { logger } from '@/lib/logger';
import type {
  BookingStatus,
  PrivateBookingWithDetails,
  PrivateBookingAuditWithUser,
  PrivateBookingPayment,
} from '@/types/private-bookings';
import {
  toNumber,
  sanitizeBookingSearchTerm,
  DATE_TBD_NOTE,
} from './types';

// ---------------------------------------------------------------------------
// Booking queries
// ---------------------------------------------------------------------------

export async function getBookings(filters?: {
  status?: BookingStatus;
  fromDate?: string;
  toDate?: string;
  customerId?: string;
  limit?: number;
  useAdmin?: boolean;
}): Promise<{ data: PrivateBookingWithDetails[]; count: number | null }> {
  const supabase = filters?.useAdmin ? createAdminClient() : await createClient();

  let query = supabase
    .from('private_bookings_with_details')
    .select(
      `
        id,
        customer_id,
        customer_name,
        customer_first_name,
        customer_last_name,
        customer_full_name,
        contact_phone,
        contact_email,
        event_date,
        start_time,
        setup_date,
        setup_time,
        end_time,
        end_time_next_day,
        guest_count,
        event_type,
        status,
        contract_version,
        created_at,
        updated_at,
        deposit_amount,
        deposit_paid_date,
        total_amount,
        balance_due_date,
        final_payment_date,
        final_payment_method,
        discount_type,
        discount_amount,
        discount_reason,
        internal_notes,
        customer_requests,
        calculated_total,
        deposit_status,
        days_until_event
      `,
      { count: 'estimated' }
    )
    .order('event_date', { ascending: true, nullsFirst: true })
    .order('start_time', { ascending: true, nullsFirst: true });

  if (filters?.status) {
    query = query.eq('status', filters.status);
  }

  if (filters?.fromDate) {
    query = query.gte('event_date', filters.fromDate);
  }

  if (filters?.toDate) {
    query = query.lte('event_date', filters.toDate);
  }

  if (filters?.customerId) {
    query = query.eq('customer_id', filters.customerId);
  }

  if (filters?.limit) {
    query = query.limit(filters.limit);
  }

  const { data, error, count } = await query;

  if (error) {
    logger.error('Error fetching private bookings:', { error: error instanceof Error ? error : new Error(String(error)) });
    throw new Error(error.message || 'An error occurred');
  }

  return { data: (data || []) as PrivateBookingWithDetails[], count };
}

export async function fetchPrivateBookings(options: {
  status?: BookingStatus | 'all';
  dateFilter?: 'all' | 'upcoming' | 'past';
  search?: string;
  page?: number;
  pageSize?: number;
  includeCancelled?: boolean;
}): Promise<{ data: PrivateBookingWithDetails[]; totalCount: number }> {
  const supabase = await createClient();
  const page = options.page && options.page > 0 ? options.page : 1;
  const pageSize = options.pageSize && options.pageSize > 0 ? options.pageSize : 20;
  const todayIso = toLocalIsoDate(new Date());
  const includeCancelled = options.includeCancelled !== false;

  const start = (page - 1) * pageSize;
  const end = start + pageSize - 1;

  let query = supabase
    .from('private_bookings_with_details')
    .select(
      `
        id,
        customer_id,
        customer_name,
        customer_first_name,
        customer_last_name,
        customer_full_name,
        contact_phone,
        contact_email,
        event_date,
        start_time,
        setup_date,
        setup_time,
        end_time,
        end_time_next_day,
        guest_count,
        event_type,
        status,
        contract_version,
        created_at,
        updated_at,
        deposit_amount,
        deposit_paid_date,
        total_amount,
        balance_due_date,
        final_payment_date,
        final_payment_method,
        discount_type,
        discount_amount,
        discount_reason,
        internal_notes,
        customer_requests,
        calculated_total,
        deposit_status,
        days_until_event
      `,
      { count: 'exact' }
    )
    .order('event_date', { ascending: true, nullsFirst: true })
    .order('start_time', { ascending: true, nullsFirst: true });

  if (options.status && options.status !== 'all') {
    query = query.eq('status', options.status);
  }

  if (options.dateFilter === 'upcoming') {
    query = query.gte('event_date', todayIso);
    if (!includeCancelled && (!options.status || options.status === 'all')) {
      query = query.neq('status', 'cancelled');
    }
  } else if (options.dateFilter === 'past') {
    query = query.lte('event_date', todayIso);
  }

  const searchTerm = options.search?.trim();
  if (searchTerm) {
    const sanitizedSearch = sanitizeBookingSearchTerm(searchTerm);
    if (sanitizedSearch.length > 0) {
      const pattern = `%${sanitizedSearch}%`;

      query = query.or(
        [
          `customer_name.ilike.${pattern}`,
          `customer_first_name.ilike.${pattern}`,
          `customer_last_name.ilike.${pattern}`,
          `customer_full_name.ilike.${pattern}`,
          `contact_phone.ilike.${pattern}`,
          `contact_email.ilike.${pattern}`,
          `event_type.ilike.${pattern}`,
        ].join(',')
      );
    }
  }

  const { data, error, count } = await query.range(start, end);

  if (error) {
    logger.error('Error fetching private bookings:', { error: error instanceof Error ? error : new Error(String(error)) });
    throw new Error(error.message || 'An error occurred');
  }

  const totalCount = typeof count === 'number' ? count : (data?.length ?? 0);

  const bookingIds = (data || []).map((booking) => booking.id).filter(Boolean);
  const holdExpiryById = new Map<string, string | null>();
  const paymentSumById = new Map<string, number>();

  if (bookingIds.length > 0) {
    const [holdExpiryResult, paymentsResult] = await Promise.all([
      supabase
        .from('private_bookings')
        .select('id, hold_expiry')
        .in('id', bookingIds),
      supabase
        .from('private_booking_payments')
        .select('booking_id, amount')
        .in('booking_id', bookingIds),
    ]);

    if (holdExpiryResult.error) {
      logger.error('Error fetching hold expiry dates for private bookings:', { error: holdExpiryResult.error instanceof Error ? holdExpiryResult.error : new Error(String(holdExpiryResult.error)) });
    } else if (holdExpiryResult.data) {
      for (const row of holdExpiryResult.data) {
        holdExpiryById.set(row.id, row.hold_expiry ?? null);
      }
    }

    if (paymentsResult.data) {
      for (const row of paymentsResult.data) {
        paymentSumById.set(row.booking_id, (paymentSumById.get(row.booking_id) ?? 0) + toNumber(row.amount));
      }
    }
  }

  const enriched = (data || []).map((booking) => {
    const bookingTotal = toNumber(booking.calculated_total ?? booking.total_amount);
    const paymentSum = paymentSumById.get(booking.id) ?? 0;
    const balanceRemaining = booking.final_payment_date ? 0 : Math.max(0, bookingTotal - paymentSum);
    return {
      ...booking,
      hold_expiry: holdExpiryById.get(booking.id) ?? undefined,
      is_date_tbd: Boolean(booking.internal_notes?.includes(DATE_TBD_NOTE)),
      balance_remaining: balanceRemaining,
    };
  });

  return { data: enriched as PrivateBookingWithDetails[], totalCount };
}

export async function fetchPrivateBookingsForCalendar(): Promise<{ data: PrivateBookingWithDetails[] }> {
  const todayIso = toLocalIsoDate(new Date());
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('private_bookings_with_details')
    .select(
      `
        id,
        customer_name,
        customer_first_name,
        customer_last_name,
        event_date,
        start_time,
        end_time,
        end_time_next_day,
        status,
        contract_version,
        created_at,
        updated_at,
        event_type,
        guest_count,
        internal_notes
      `
    )
    .gte('event_date', todayIso)
    .order('event_date', { ascending: true, nullsFirst: true })
    .order('start_time', { ascending: true, nullsFirst: true });

  if (error) {
    logger.error('Error fetching bookings for calendar:', { error: error instanceof Error ? error : new Error(String(error)) });
    throw new Error(error.message || 'An error occurred');
  }

  return { data: (data || []) as PrivateBookingWithDetails[] };
}

export async function getBookingById(id: string): Promise<PrivateBookingWithDetails> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('private_bookings')
    .select(`
      *,
      customer:customers(id, first_name, last_name, email, phone:mobile_number),
      items:private_booking_items(
        *,
        space:venue_spaces(*),
        package:catering_packages(*),
        vendor:vendors(*)
      ),
      documents:private_booking_documents(*),
      sms_queue:private_booking_sms_queue(*),
      payments:private_booking_payments(*),
      audits:private_booking_audit(
        id,
        booking_id,
        action,
        field_name,
        old_value,
        new_value,
        metadata,
        performed_by,
        performed_at,
        performed_by_profile:profiles!private_booking_audit_performed_by_profile_fkey(
          id,
          full_name,
          email
        )
      )
    `)
    .order('display_order', { ascending: true, foreignTable: 'private_booking_items' })
    .order('created_at', { ascending: true, foreignTable: 'private_booking_payments' })
    .order('performed_at', { ascending: false, foreignTable: 'private_booking_audit' })
    .eq('id', id)
    .maybeSingle();

  if (error) {
    logger.error('Error fetching private booking:', { error: error instanceof Error ? error : new Error(String(error)) });
    throw new Error(error.message || 'An error occurred');
  }

  if (!data) {
    throw new Error('Booking not found');
  }

  const {
    audits: auditsData,
    payments: paymentsData,
    ...bookingCore
  } = data as typeof data & {
    audits?: PrivateBookingAuditWithUser[];
    payments?: PrivateBookingPayment[];
  };

  const items = bookingCore.items ?? [];

   
  const calculatedTotal = items?.reduce((sum: number, item: any) => sum + toNumber(item.line_total), 0) || 0;

  const eventDate = new Date(data.event_date);
  const today = new Date();
  const daysUntilEvent = Math.ceil((eventDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  const depositStatus = data.deposit_paid_date
    ? 'Paid'
    : toNumber(data.deposit_amount) > 0
      ? 'Required'
      : 'Not Required';

  const auditTrail = ((auditsData ?? []) as PrivateBookingAuditWithUser[]).slice().sort(
    (a, b) => new Date(b.performed_at).getTime() - new Date(a.performed_at).getTime()
  );

  const bookingWithDetails: PrivateBookingWithDetails = {
    ...(bookingCore as PrivateBookingWithDetails),
    items,
    calculated_total: calculatedTotal,
    deposit_status: depositStatus,
    days_until_event: daysUntilEvent,
    audit_trail: auditTrail,
    payments: (paymentsData ?? []) as PrivateBookingPayment[]
  };

  return bookingWithDetails;
}

export async function getBookingByIdForEdit(id: string): Promise<PrivateBookingWithDetails> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('private_bookings')
    .select(
      `
        *,
        customer:customers(id, first_name, last_name, email, phone:mobile_number)
      `
    )
    .eq('id', id)
    .maybeSingle();

  if (error) {
    logger.error('Error fetching private booking for edit:', { error: error instanceof Error ? error : new Error(String(error)) });
    throw new Error(error.message || 'An error occurred');
  }

  if (!data) {
    throw new Error('Booking not found');
  }

  return data as PrivateBookingWithDetails;
}

export async function getBookingByIdForItems(id: string): Promise<PrivateBookingWithDetails & { calculated_total: number }> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('private_bookings')
    .select(
      `
        *,
        customer:customers(id, first_name, last_name, email, phone:mobile_number),
        items:private_booking_items(
          *,
          space:venue_spaces(*),
          package:catering_packages(*),
          vendor:vendors(*)
        )
      `
    )
    .order('display_order', { ascending: true, foreignTable: 'private_booking_items' })
    .eq('id', id)
    .maybeSingle();

  if (error) {
    logger.error('Error fetching private booking items:', { error: error instanceof Error ? error : new Error(String(error)) });
    throw new Error(error.message || 'An error occurred');
  }

  if (!data) {
    throw new Error('Booking not found');
  }

   
  const items = (data as any).items ?? [];
   
  const calculatedTotal = items.reduce((sum: number, item: any) => sum + toNumber(item.line_total), 0);

  return {
    ...(data as PrivateBookingWithDetails),
    calculated_total: calculatedTotal,
  };
}

 
export async function getBookingByIdForMessages(id: string): Promise<PrivateBookingWithDetails & { sms_queue: any[] }> {
  const supabase = await createClient();

  const { data: booking, error: bookingError } = await supabase
    .from('private_bookings_with_details')
    .select(
      `
        id,
        customer_id,
        customer_name,
        customer_first_name,
        customer_last_name,
        customer_full_name,
        contact_phone,
        contact_email,
        event_date,
        start_time,
        setup_date,
        setup_time,
        end_time,
        end_time_next_day,
        guest_count,
        event_type,
        status,
        deposit_amount,
        deposit_paid_date,
        total_amount,
        balance_due_date,
        final_payment_date,
        final_payment_method,
        discount_type,
        discount_amount,
        discount_reason,
        internal_notes,
        calculated_total,
        days_until_event,
        deposit_status
      `
    )
    .eq('id', id)
    .maybeSingle();

  if (bookingError) {
    logger.error('Error fetching private booking for messages:', { error: bookingError instanceof Error ? bookingError : new Error(String(bookingError)) });
    throw new Error(bookingError.message || 'An error occurred');
  }

  if (!booking) {
    throw new Error('Booking not found');
  }

  const { data: smsQueue, error: smsError } = await supabase
    .from('private_booking_sms_queue')
    .select('*')
    .eq('booking_id', id)
    .order('created_at', { ascending: false });

  if (smsError) {
    logger.error('Error fetching private booking SMS queue:', { error: smsError instanceof Error ? smsError : new Error(String(smsError)) });
    throw new Error(smsError.message || 'Failed to fetch booking messages');
  }

  return {
    ...(booking as PrivateBookingWithDetails),
    sms_queue: smsQueue ?? [],
  };
}

// ---------------------------------------------------------------------------
// Reference data queries (venue spaces, catering packages, vendors)
// ---------------------------------------------------------------------------

 
export async function getVenueSpaces(activeOnly = true, useAdmin = false): Promise<any[]> {
  const supabase = useAdmin ? createAdminClient() : await createClient();

  let query = supabase
    .from('venue_spaces')
    .select('*')
    .order('display_order', { ascending: true });

  if (activeOnly) {
    query = query.eq('active', true);
  }

  const { data, error } = await query;

  if (error) {
    logger.error('Error fetching venue spaces:', { error: error instanceof Error ? error : new Error(String(error)) });
    throw new Error(error.message || 'An error occurred');
  }

  return data;
}

 
export async function getVenueSpacesForManagement(): Promise<any[]> {
  return getVenueSpaces(false);
}

 
export async function getCateringPackages(activeOnly = true, useAdmin = false): Promise<any[]> {
  const supabase = useAdmin ? createAdminClient() : await createClient();

  let query = supabase
    .from('catering_packages')
    .select('*')
    .order('display_order', { ascending: true });

  if (activeOnly) {
    query = query.eq('active', true);
  }

  const { data, error } = await query;

  if (error) {
    logger.error('Error fetching catering packages:', { error: error instanceof Error ? error : new Error(String(error)) });
    throw new Error(error.message || 'An error occurred');
  }

  return data;
}

 
export async function getCateringPackagesForManagement(): Promise<any[]> {
  return getCateringPackages(false);
}

 
export async function getVendors(serviceType?: string, activeOnly = true, useAdmin = false): Promise<any[]> {
  const supabase = useAdmin ? createAdminClient() : await createClient();

  let query = supabase
    .from('vendors')
    .select('*')
    .order('preferred', { ascending: false })
    .order('name', { ascending: true });

  if (activeOnly) {
    query = query.eq('active', true);
  }

  if (serviceType) {
    query = query.eq('service_type', serviceType);
  }

  const { data, error } = await query;

  if (error) {
    logger.error('Error fetching vendors:', { error: error instanceof Error ? error : new Error(String(error)) });
    throw new Error(error.message || 'An error occurred');
  }

  // Note: Normalization of rates happens here or in UI, keeping raw data here for now unless strictly needed
  return data;
}

 
export async function getVendorsForManagement(): Promise<any[]> {
  return getVendors(undefined, false);
}

 
export async function getVendorRate(vendorId: string): Promise<any> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('vendors')
    .select('id, name, service_type, typical_rate, typical_rate_normalized')
    .eq('id', vendorId)
    .maybeSingle();

  if (error) {
    logger.error('Error fetching vendor rate:', { error: error instanceof Error ? error : new Error(String(error)) });
    throw new Error(error.message || 'Failed to fetch vendor rate');
  }

  return data;
}
