'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkUserPermission } from '@/app/actions/rbac';
import { logAuditEvent } from './audit';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { generatePhoneVariants } from '@/lib/utils';
import { queueBookingConfirmationSMS, queueBookingUpdateSMS, queueCancellationSMS, queuePaymentRequestSMS } from './table-booking-sms';
import { queueBookingEmail } from './table-booking-email'; // Updated import
import { sendSameDayBookingAlertIfNeeded, TableBookingNotificationRecord } from '@/lib/table-bookings/managerNotifications';
import { startOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, addMonths, format as formatDate, subDays, isWithinInterval, parseISO } from 'date-fns';
import type { TableBooking } from '@/types/table-bookings';
import { TableBookingService } from '@/services/table-bookings';

// ... (formatTime12Hour and Schemas remain unchanged)
function formatTime12Hour(time24: string): string {
  const timeWithoutSeconds = time24.split(':').slice(0, 2).join(':');
  const [hours, minutes] = timeWithoutSeconds.split(':').map(Number);
  
  const period = hours >= 12 ? 'pm' : 'am';
  const hours12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
  
  if (minutes === 0) {
    return `${hours12}${period}`;
  } else {
    return `${hours12}:${minutes.toString().padStart(2, '0')}${period}`;
  }
}

// Validation schemas (Keeping these in the action as they are used for input parsing directly)
const CreateTableBookingSchema = z.object({
  customer_id: z.string().uuid().optional(),
  booking_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  booking_time: z.string().regex(/^\d{2}:\d{2}$/),
  party_size: z.number().min(1).max(20),
  booking_type: z.enum(['regular', 'sunday_lunch']),
  special_requirements: z.string().optional(),
  dietary_requirements: z.array(z.string()).optional(),
  allergies: z.array(z.string()).optional(),
  celebration_type: z.string().optional(),
  duration_minutes: z.number().default(120),
  source: z.string().default('phone'),
  cash_payment_received: z.boolean().default(false),
});

const CreateCustomerSchema = z.object({ // This schema is not directly used after service refactoring
  first_name: z.string().min(1),
  last_name: z.string().optional(),
  mobile_number: z.string().min(10),
  email: z.string().email().optional(),
  sms_opt_in: z.boolean().default(true),
});

const UpdateTableBookingSchema = z.object({
  booking_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  booking_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  party_size: z.number().min(1).max(20).optional(),
  special_requirements: z.string().optional(),
  dietary_requirements: z.array(z.string()).optional(),
  allergies: z.array(z.string()).optional(),
  celebration_type: z.string().optional(),
  tables_assigned: z.any().optional(),
  internal_notes: z.string().optional(),
});

type DashboardViewMode = 'day' | 'week' | 'month' | 'next-month';

type GrowthMetric = {
  bookings: number;
  covers: number;
  bookingsChange: number;
  coversChange: number;
};

type DashboardStats = {
  todayBookings: number;
  weekBookings: number;
  monthBookings: number;
  pendingPayments: number;
  growth: {
    lastMonth: GrowthMetric;
    last3Months: GrowthMetric;
    lastYear: GrowthMetric;
  };
};

type DashboardResult = {
  bookings: TableBooking[];
  stats: DashboardStats;
};

const BOOKINGS_STATUSES = ['confirmed', 'pending_payment'];
const HISTORICAL_STATUSES = ['confirmed', 'pending_payment', 'completed'];

function toSafeDate(dateString: string | undefined): Date {
  const parsed = dateString ? new Date(dateString) : new Date();
  if (Number.isNaN(parsed.getTime())) {
    return new Date();
  }
  return parsed;
}

function formatDateOnly(date: Date) {
  return formatDate(date, 'yyyy-MM-dd');
}

function calculateGrowth(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

async function getGrowthStats(supabase: any): Promise<DashboardStats['growth']> {
  const now = new Date();
  const twoYearsAgo = subDays(now, 730);

  // Fetch minimal data for calculation
  const { data, error } = await supabase
    .from('table_bookings')
    .select('booking_date, party_size')
    .in('status', HISTORICAL_STATUSES)
    .gte('booking_date', formatDateOnly(twoYearsAgo));

  if (error || !data) {
    console.error('Error fetching historical stats:', error);
    return {
      lastMonth: { bookings: 0, covers: 0, bookingsChange: 0, coversChange: 0 },
      last3Months: { bookings: 0, covers: 0, bookingsChange: 0, coversChange: 0 },
      lastYear: { bookings: 0, covers: 0, bookingsChange: 0, coversChange: 0 },
    };
  }

  const bookings = data as { booking_date: string; party_size: number }[];

  const calculatePeriodStats = (days: number) => {
    const currentStart = subDays(now, days);
    const previousStart = subDays(now, days * 2);
    
    let currentBookings = 0;
    let currentCovers = 0;
    let previousBookings = 0;
    let previousCovers = 0;

    bookings.forEach(b => {
      const date = parseISO(b.booking_date);
      // Check if in current period
      if (date >= currentStart && date <= now) {
        currentBookings++;
        currentCovers += b.party_size;
      }
      // Check if in previous period
      else if (date >= previousStart && date < currentStart) {
        previousBookings++;
        previousCovers += b.party_size;
      }
    });

    return {
      bookings: currentBookings,
      covers: currentCovers,
      bookingsChange: calculateGrowth(currentBookings, previousBookings),
      coversChange: calculateGrowth(currentCovers, previousCovers),
    };
  };

  return {
    lastMonth: calculatePeriodStats(30),
    last3Months: calculatePeriodStats(90),
    lastYear: calculatePeriodStats(365),
  };
}

export async function getTableBookingsDashboardData(params: {
  viewMode: DashboardViewMode;
  selectedDate: string;
}): Promise<{ success: true; data: DashboardResult } | { error: string }> {
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
      return { error: 'You do not have permission to view table bookings' };
    }

    const referenceDate = toSafeDate(params.selectedDate);
    const viewMode = params.viewMode;

    let bookingsQuery = supabase
      .from('table_bookings')
      .select(
        `
        *,
        customer:customers(*),
        table_booking_items(*),
        table_booking_payments(*)
      `,
      )
      .in('status', BOOKINGS_STATUSES)
      .order('booking_date', { ascending: true })
      .order('booking_time', { ascending: true });

    if (viewMode === 'day') {
      const day = formatDateOnly(referenceDate);
      bookingsQuery = bookingsQuery.eq('booking_date', day);
    } else if (viewMode === 'week') {
      const weekStart = startOfWeek(referenceDate, { weekStartsOn: 1 });
      const weekEnd = endOfWeek(referenceDate, { weekStartsOn: 1 });
      bookingsQuery = bookingsQuery
        .gte('booking_date', formatDateOnly(weekStart))
        .lte('booking_date', formatDateOnly(weekEnd));
    } else if (viewMode === 'month') {
      const now = new Date();
      const monthStart = startOfMonth(now);
      const monthEnd = endOfMonth(now);
      bookingsQuery = bookingsQuery
        .gte('booking_date', formatDateOnly(monthStart))
        .lte('booking_date', formatDateOnly(monthEnd));
    } else if (viewMode === 'next-month') {
      const nextMonth = addMonths(new Date(), 1);
      const monthStart = startOfMonth(nextMonth);
      const monthEnd = endOfMonth(nextMonth);
      bookingsQuery = bookingsQuery
        .gte('booking_date', formatDateOnly(monthStart))
        .lte('booking_date', formatDateOnly(monthEnd));
    }

    const [{ data: bookings, error: bookingsError }, todayCount, weekCount, monthCount, pendingCount, growthStats] = await Promise.all([
      bookingsQuery,
      supabase
        .from('table_bookings')
        .select('id', { count: 'exact', head: true })
        .eq('booking_date', formatDateOnly(startOfDay(new Date())))
        .in('status', BOOKINGS_STATUSES),
      (() => {
        const now = new Date();
        const weekStart = startOfWeek(now, { weekStartsOn: 1 });
        const weekEnd = endOfWeek(now, { weekStartsOn: 1 });
        return supabase
          .from('table_bookings')
          .select('id', { count: 'exact', head: true })
          .gte('booking_date', formatDateOnly(weekStart))
          .lte('booking_date', formatDateOnly(weekEnd))
          .in('status', BOOKINGS_STATUSES);
      })(),
      (() => {
        const now = new Date();
        const monthStart = startOfMonth(now);
        const monthEnd = endOfMonth(now);
        return supabase
          .from('table_bookings')
          .select('id', { count: 'exact', head: true })
          .gte('booking_date', formatDateOnly(monthStart))
          .lte('booking_date', formatDateOnly(monthEnd))
          .in('status', BOOKINGS_STATUSES);
      })(),
      supabase
        .from('table_bookings')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending_payment')
        .gte('booking_date', formatDateOnly(startOfDay(new Date()))),
      getGrowthStats(supabase),
    ]);

    if (bookingsError) {
      console.error('Error fetching table bookings for dashboard:', bookingsError);
      return { error: 'Failed to load bookings' };
    }

    const stats: DashboardStats = {
      todayBookings: todayCount.count || 0,
      weekBookings: weekCount.count || 0,
      monthBookings: monthCount.count || 0,
      pendingPayments: pendingCount.count || 0,
      growth: growthStats,
    };

    return {
      success: true,
      data: {
        bookings: (bookings || []) as TableBooking[],
        stats,
      },
    };
  } catch (error) {
    console.error('Unexpected error loading table bookings dashboard data', error);
    return { error: 'Failed to load dashboard data' };
  }
}

// Check table availability
export async function checkTableAvailability(
  date: string,
  time: string,
  partySize: number,
  excludeBookingId?: string
) {
  try {
    const result = await TableBookingService.checkAvailability(date, time, partySize, excludeBookingId);
    return { data: result };
  } catch (error) {
    console.error('Availability check error:', error);
    return { error: 'Failed to check availability' };
  }
}

// Create table booking
export async function createTableBooking(formData: FormData) {
  try {
    // Check permissions
    const hasPermission = await checkUserPermission('table_bookings', 'create');
    if (!hasPermission) {
      return { error: 'You do not have permission to create bookings' };
    }
    
    // Parse and validate booking data
    const bookingData = CreateTableBookingSchema.parse({
      customer_id: formData.get('customer_id') || undefined,
      booking_date: formData.get('booking_date'),
      booking_time: formData.get('booking_time'),
      party_size: parseInt(formData.get('party_size') as string),
      booking_type: formData.get('booking_type'),
      special_requirements: formData.get('special_requirements') || undefined,
      dietary_requirements: formData.get('dietary_requirements') 
        ? JSON.parse(formData.get('dietary_requirements') as string) 
        : undefined,
      allergies: formData.get('allergies')
        ? JSON.parse(formData.get('allergies') as string)
        : undefined,
      celebration_type: formData.get('celebration_type') || undefined,
      duration_minutes: parseInt(formData.get('duration_minutes') as string) || 120,
      source: formData.get('source') || 'phone',
      cash_payment_received: formData.get('cash_payment_received') === 'true',
    });

    // Extract menu items if present
    let menuItems = undefined;
    const menuItemsData = formData.get('menu_items');
    if (menuItemsData) {
      try {
        menuItems = JSON.parse(menuItemsData as string);
      } catch (err) {
        console.error('Menu items parsing error:', err);
      }
    }

    // Call Service
    const booking = await TableBookingService.createBooking({
      ...bookingData,
      customer_first_name: (formData.get('customer_first_name') as string | null)?.trim() || undefined,
      customer_last_name: (formData.get('customer_last_name') as string | null)?.trim() || undefined,
      customer_mobile_number: (formData.get('customer_mobile_number') as string | null)?.trim() || undefined,
      customer_email: (formData.get('customer_email') as string | null)?.trim() || undefined,
      customer_sms_opt_in: formData.get('customer_sms_opt_in') === 'true',
      menu_items: menuItems,
    });
    
    // Send same day alert (this might also be queued eventually, but is not part of this refactor)
    await sendSameDayBookingAlertIfNeeded(booking as TableBookingNotificationRecord);

    // Log audit event
    await logAuditEvent({
      operation_type: 'create',
      resource_type: 'table_booking',
      resource_id: booking.id,
      operation_status: 'success',
      additional_info: {
        booking_reference: booking.booking_reference,
        booking_type: booking.booking_type,
        party_size: booking.party_size,
        booking_date: booking.booking_date,
        source: booking.source,
      }
    });
    
    // Queue confirmation SMS and Email
    if (booking.status === 'confirmed') {
      console.log(`Booking confirmed, queuing SMS and Email for booking ${booking.id}`);
      await queueBookingConfirmationSMS(booking.id);
      await queueBookingEmail(booking.id, 'confirmation');
    } else if (booking.status === 'pending_payment' && booking.booking_type === 'sunday_lunch') {
      console.log(`Sunday lunch booking created, queuing payment request SMS for booking ${booking.id}`);
      await queuePaymentRequestSMS(booking.id, { requirePermission: false });
      await queueBookingEmail(booking.id, 'payment_request');
    }
    
    // Revalidate paths
    revalidatePath('/table-bookings');
    revalidatePath('/table-bookings/calendar');
    
    return { success: true, data: booking };
  } catch (error: any) {
    console.error('Create booking error:', error);
    return { error: error.message || 'An unexpected error occurred' };
  }
}

// Update table booking
export async function updateTableBooking(
  bookingId: string,
  updates: z.infer<typeof UpdateTableBookingSchema>
) {
  try {
    // Check permissions
    const hasPermission = await checkUserPermission('table_bookings', 'edit');
    if (!hasPermission) {
      return { error: 'You do not have permission to edit bookings' };
    }

    const { updatedBooking, currentBooking, changes } = await TableBookingService.updateBooking(bookingId, updates);
    
    if (updatedBooking.status === 'confirmed' && (changes.dateChanged || changes.timeChanged || changes.partySizeChanged)) {
      const smsResult = await queueBookingUpdateSMS(updatedBooking.id);
      if (smsResult?.error) {
        console.error('Booking update SMS queue error:', smsResult.error);
      }
    }
    
    // Log audit event
    await logAuditEvent({
      operation_type: 'update',
      resource_type: 'table_booking',
      resource_id: bookingId,
      operation_status: 'success',
      additional_info: {
        booking_reference: currentBooking.booking_reference,
        changes: updates,
      }
    });
    
    // Revalidate paths
    revalidatePath('/table-bookings');
    revalidatePath(`/table-bookings/${bookingId}`);
    
    return { success: true, data: updatedBooking };
  } catch (error: any) {
    console.error('Update booking error:', error);
    return { error: error.message || 'An unexpected error occurred' };
  }
}

// Cancel table booking
export async function cancelTableBooking(bookingId: string, reason: string) {
  try {
    // Check permissions
    const hasPermission = await checkUserPermission('table_bookings', 'edit');
    if (!hasPermission) {
      return { error: 'You do not have permission to cancel bookings' };
    }

    const { booking, refundAmount, refundEligible } = await TableBookingService.cancelBooking(bookingId, reason);
    
    // Log audit event
    await logAuditEvent({
      operation_type: 'cancel',
      resource_type: 'table_booking',
      resource_id: bookingId,
      operation_status: 'success',
      additional_info: {
        booking_reference: booking.booking_reference,
        reason,
        refund_amount: refundAmount,
      }
    });
    
    // Queue cancellation SMS and Email
    const refundMessage = refundAmount > 0 
      ? `A refund of £${refundAmount.toFixed(2)} will be processed within 3-5 business days.`
      : 'No payment was taken for this booking.';
    
    await queueCancellationSMS(booking.id, refundMessage);
    await queueBookingEmail(booking.id, 'cancellation', { refundMessage });
    
    // Revalidate paths
    revalidatePath('/table-bookings');
    revalidatePath(`/table-bookings/${bookingId}`);
    
    return { 
      success: true, 
      data: { 
        booking_id: bookingId,
        refund_eligible: refundEligible,
        refund_amount: refundAmount,
      }
    };
  } catch (error: any) {
    console.error('Cancel booking error:', error);
    return { error: error.message || 'An unexpected error occurred' };
  }
}

// Mark booking as no-show
export async function markBookingNoShow(bookingId: string) {
  try {
    // Check permissions
    const hasPermission = await checkUserPermission('table_bookings', 'edit');
    if (!hasPermission) {
      return { error: 'You do not have permission to update bookings' };
    }

    const booking = await TableBookingService.markNoShow(bookingId);
    
    // Log audit event
    await logAuditEvent({
      operation_type: 'no_show',
      resource_type: 'table_booking',
      resource_id: bookingId,
      operation_status: 'success',
      additional_info: {
        booking_reference: booking.booking_reference,
        customer_id: booking.customer_id,
      }
    });
    
    // Revalidate paths
    revalidatePath('/table-bookings');
    revalidatePath(`/table-bookings/${bookingId}`);
    
    return { success: true, data: booking };
  } catch (error: any) {
    console.error('No-show error:', error);
    return { error: error.message || 'An unexpected error occurred' };
  }
}

// Mark booking as completed
export async function markBookingCompleted(bookingId: string) {
  try {
    // Check permissions
    const hasPermission = await checkUserPermission('table_bookings', 'edit');
    if (!hasPermission) {
      return { error: 'You do not have permission to update bookings' };
    }

    const booking = await TableBookingService.markCompleted(bookingId);
    
    // Log audit event
    await logAuditEvent({
      operation_type: 'complete',
      resource_type: 'table_booking',
      resource_id: bookingId,
      operation_status: 'success',
      additional_info: {
        booking_reference: booking.booking_reference,
      }
    });
    
    // Revalidate paths
    revalidatePath('/table-bookings');
    revalidatePath(`/table-bookings/${bookingId}`);
    
    return { success: true, data: booking };
  } catch (error: any) {
    console.error('Complete booking error:', error);
    return { error: error.message || 'An unexpected error occurred' };
  }
}

export async function deleteTableBooking(bookingId: string) {
  try {
    const hasPermission = await checkUserPermission('table_bookings', 'delete')
    if (!hasPermission) {
      return { error: 'You do not have permission to delete table bookings.' }
    }

    const booking = await TableBookingService.deleteBooking(bookingId);

    await logAuditEvent({
      operation_type: 'delete',
      resource_type: 'table_booking',
      resource_id: bookingId,
      operation_status: 'success',
      additional_info: {
        booking_reference: booking.booking_reference
      }
    })

    revalidatePath('/table-bookings')
    revalidatePath(`/table-bookings/${bookingId}`)

    return { success: true }
  } catch (error: any) {
    console.error('Unexpected error deleting table booking:', error)
    return { error: error.message || 'Unexpected error occurred' }
  }
}

// ... (GetBookingsByDate, SearchBookings, GetTableBookingDetails, SearchTableBookings - Keep as is)
export async function getBookingsByDate(date: string) {
  try {
    const supabase = await createClient();
    
    // Check permissions
    const hasPermission = await checkUserPermission('table_bookings', 'view');
    if (!hasPermission) {
      return { error: 'You do not have permission to view bookings' };
    }
    
    const { data, error } = await supabase
      .from('table_bookings')
      .select(`
        *,
        customer:customers(
          id,
          first_name,
          last_name,
          mobile_number,
          email
        ),
        table_booking_items(*)
      `)
      .eq('booking_date', date)
      .order('booking_time', { ascending: true });
      
    if (error) {
      console.error('Fetch bookings error:', error);
      return { error: 'Failed to fetch bookings' };
    }
    
    return { data };
  } catch (error) {
    console.error('Get bookings error:', error);
    return { error: 'An unexpected error occurred' };
  }
}

// Search bookings
export async function searchBookings(searchTerm: string) {
  try {
    const supabase = await createClient();
    
    // Check permissions
    const hasPermission = await checkUserPermission('table_bookings', 'view');
    if (!hasPermission) {
      return { error: 'You do not have permission to search bookings' };
    }
    
    // Search by reference, customer name, or phone
    const { data, error } = await supabase
      .from('table_bookings')
      .select(`
        *,
        customer:customers(
          id,
          first_name,
          last_name,
          mobile_number,
          email
        )
      `)
      .or(`booking_reference.ilike.%${searchTerm}%`)
      .order('booking_date', { ascending: false })
      .limit(50);
      
    if (error) {
      console.error('Search bookings error:', error);
      return { error: 'Failed to search bookings' };
    }
    
    // Also search by customer details
    const phoneVariants = generatePhoneVariants(searchTerm);
    const { data: customerBookings } = await supabase
      .from('customers')
      .select(`
        id,
        first_name,
        last_name,
        mobile_number,
        email,
        table_bookings(*)
      `)
      .or([
        `first_name.ilike.%${searchTerm}%`,
        `last_name.ilike.%${searchTerm}%`,
        `email.ilike.%${searchTerm}%`,
        phoneVariants.map(v => `mobile_number.eq.${v}`).join(',')
      ].join(','));
      
    // Combine results
    const allBookings = [...(data || [])];
    if (customerBookings) {
      customerBookings.forEach(customer => {
        if (customer.table_bookings) {
          customer.table_bookings.forEach((booking: any) => {
            if (!allBookings.find(b => b.id === booking.id)) {
              allBookings.push({
                ...booking,
                customer,
              });
            }
          });
        }
      });
    }
    
    return { data: allBookings };
  } catch (error) {
    console.error('Search bookings error:', error);
    return { error: 'An unexpected error occurred' };
  }
}

// Get detailed booking information
export async function getTableBookingDetails(bookingId: string) {
  try {
    const supabase = await createClient();

    // Check permissions
    const hasPermission = await checkUserPermission('table_bookings', 'view');
    if (!hasPermission) {
      return { error: 'You do not have permission to view bookings' };
    }

    const { data, error } = await supabase
      .from('table_bookings')
      .select(`
        *,
        customer:customers(*),
        table_booking_items(*),
        table_booking_payments(*),
        table_booking_modifications(*)
      `)
      .eq('id', bookingId)
      .single();

    if (error) {
      console.error('Error fetching booking details:', error);
      return { error: 'Failed to fetch booking details' };
    }

    if (!data) {
      return { error: 'Booking not found' };
    }

    return { success: true, data };
  } catch (error: any) {
    console.error('Unexpected error fetching booking details:', error);
    return { error: 'An unexpected error occurred' };
  }
}

// Targeted search for bookings
export async function searchTableBookings(searchTerm: string, searchType: 'name' | 'phone' | 'reference') {
  try {
    const supabase = await createClient();

    const hasPermission = await checkUserPermission('table_bookings', 'view');
    if (!hasPermission) {
      return { error: 'You do not have permission to search bookings' };
    }

    let query = supabase
      .from('table_bookings')
      .select(`
        *,
        customer:customers(*)
      `)
      .order('booking_date', { ascending: false })
      .order('booking_time', { ascending: false })
      .limit(50);

    if (searchType === 'name') {
      const { data: customers } = await supabase
        .from('customers')
        .select('id')
        .or(`first_name.ilike.%${searchTerm}%,last_name.ilike.%${searchTerm}%`);

      if (customers && customers.length > 0) {
        query = query.in('customer_id', customers.map((c: any) => c.id));
      } else {
        return { success: true, data: [] };
      }
    } else if (searchType === 'phone') {
      const cleanPhone = searchTerm.replace(/\D/g, '');
      const { data: customers } = await supabase
        .from('customers')
        .select('id')
        .like('mobile_number', `%${cleanPhone}%`);

      if (customers && customers.length > 0) {
        query = query.in('customer_id', customers.map((c: any) => c.id));
      } else {
        return { success: true, data: [] };
      }
    } else if (searchType === 'reference') {
      query = query.ilike('booking_reference', `%${searchTerm}%`);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Search error:', error);
      return { error: 'Failed to search bookings' };
    }

    return { success: true, data: data || [] };
  } catch (error: any) {
    console.error('Unexpected search error:', error);
    return { error: 'An unexpected error occurred' };
  }
}
