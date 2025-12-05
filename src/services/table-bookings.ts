import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { generatePhoneVariants, formatPhoneForStorage } from '@/lib/utils';
import { withIncrementedModificationCount } from '@/lib/table-bookings/modification';
import type { TableBooking } from '@/types/table-bookings';
import { format as formatDate, startOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, addMonths, subDays, parseISO } from 'date-fns';
import { formatDateWithTimeForSms } from '@/lib/dateUtils';

// Helper function to format time from 24hr to 12hr format
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

export type CreateTableBookingInput = {
  customer_id?: string;
  booking_date: string;
  booking_time: string;
  party_size: number;
  booking_type: 'regular' | 'sunday_lunch';
  special_requirements?: string;
  dietary_requirements?: string[];
  allergies?: string[];
  celebration_type?: string;
  duration_minutes?: number;
  source?: string;
  // New payment fields
  payment_method?: 'payment_link' | 'cash';
  payment_status?: 'pending' | 'completed' | 'failed' | 'refunded' | 'partial_refund';
  // Customer details for creation if ID not provided
  customer_first_name?: string;
  customer_last_name?: string;
  customer_mobile_number?: string;
  customer_email?: string;
  customer_sms_opt_in?: boolean;
  // Menu items for Sunday lunch
  menu_items?: Array<{
    custom_item_name?: string;
    item_type: 'main' | 'side' | 'extra';
    quantity: number;
    guest_name?: string;
    price_at_booking: number;
    special_requests?: string;
  }>;
};

export type UpdateTableBookingInput = {
  booking_date?: string;
  booking_time?: string;
  party_size?: number;
  special_requirements?: string;
  dietary_requirements?: string[];
  allergies?: string[];
  celebration_type?: string;
  tables_assigned?: any;
  internal_notes?: string;
  // New payment fields
  payment_method?: 'payment_link' | 'cash';
  payment_status?: 'pending' | 'completed' | 'failed' | 'refunded' | 'partial_refund';
};

export type DashboardViewMode = 'day' | 'week' | 'month' | 'next-month';

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

export type DashboardResult = {
  bookings: TableBooking[];
  stats: DashboardStats;
};

const BOOKINGS_STATUSES = ['confirmed', 'pending_payment'];
const HISTORICAL_STATUSES = ['confirmed', 'pending_payment', 'completed'];

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

export interface ReportData {
  totalBookings: number;
  totalCovers: number;
  totalRevenue: number;
  averagePartySize: number;
  noShowRate: number;
  cancellationRate: number;
  sundayLunchBookings: number;
  regularBookings: number;
  bookingsByDay: Record<string, number>;
  bookingsByHour: Record<string, number>;
  topCustomers: Array<{
    customer_id: string;
    customer_name: string;
    booking_badge: number;
    total_covers: number;
  }>;
  revenueByType: {
    sunday_lunch: number;
    regular: number;
  };
}

export class TableBookingService {
  static async queueConfirmationSMS(bookingId: string) {
    const supabase = await createAdminClient();
    
    const { data: booking } = await supabase
      .from('table_bookings')
      .select(`
        *,
        customer:customers(*),
        table_booking_items(*),
        table_booking_payments(*)
      `)
      .eq('id', bookingId)
      .single();
      
    if (!booking || !booking.customer?.sms_opt_in) return;
    
    const templateKey = booking.booking_type === 'sunday_lunch'
      ? 'booking_confirmation_sunday_lunch'
      : 'booking_confirmation_regular';
      
    const { data: template } = await supabase
      .from('table_booking_sms_templates')
      .select('*')
      .eq('template_key', templateKey)
      .eq('is_active', true)
      .single();
      
    if (!template) return;
    
    const variables: Record<string, string> = {
      customer_name: booking.customer.first_name,
      party_size: booking.party_size.toString(),
      date: new Date(booking.booking_date).toLocaleDateString('en-GB', {
        weekday: 'long',
        month: 'long',
        day: 'numeric'
      }),
      time: formatTime12Hour(booking.booking_time),
      reference: booking.booking_reference,
      contact_phone: process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || '01753682707',
    };
    
    if (booking.booking_type === 'sunday_lunch' && booking.table_booking_payments?.length > 0) {
      const payment = booking.table_booking_payments[0];
      const depositAmount = payment.payment_metadata?.deposit_amount || payment.amount;
      const totalAmount = payment.payment_metadata?.total_amount || 0;
      const outstandingAmount = payment.payment_metadata?.outstanding_amount || (totalAmount - depositAmount);
      
      variables.deposit_amount = depositAmount.toFixed(2);
      variables.outstanding_amount = outstandingAmount.toFixed(2);
    }
    
    await supabase.from('jobs').insert({
      type: 'send_sms',
      payload: {
        to: booking.customer.mobile_number,
        template: templateKey,
        variables,
        booking_id: bookingId,
        customer_id: booking.customer.id,
      },
      scheduled_for: new Date().toISOString(),
    });
  }

  static async queueUpdateSMS(bookingId: string) {
    const supabase = await createAdminClient();
    
    const { data: booking } = await supabase
      .from('table_bookings')
      .select(`*, customer:customers(*)`)
      .eq('id', bookingId)
      .single();
      
    if (!booking || booking.status !== 'confirmed' || !booking.customer?.sms_opt_in) return;
    
    const templateKey = booking.booking_type === 'sunday_lunch'
      ? 'booking_update_sunday_lunch'
      : 'booking_update_regular';
      
    const { data: template } = await supabase
      .from('table_booking_sms_templates')
      .select('*')
      .eq('template_key', templateKey)
      .eq('is_active', true)
      .single();
      
    if (!template) return;
    
    const variables = {
      customer_name: booking.customer.first_name,
      party_size: booking.party_size.toString(),
      date: new Date(booking.booking_date).toLocaleDateString('en-GB', {
        weekday: 'long',
        month: 'long',
        day: 'numeric'
      }),
      time: formatTime12Hour(booking.booking_time),
      reference: booking.booking_reference,
      contact_phone: process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || '01753682707',
    };
    
    await supabase.from('jobs').insert({
      type: 'send_sms',
      payload: {
        to: booking.customer.mobile_number,
        template: templateKey,
        variables,
        booking_id: bookingId,
        customer_id: booking.customer.id,
      },
      scheduled_for: new Date().toISOString(),
    });
  }

  static async queueCancellationSMS(bookingId: string, refundMessage: string) {
    const supabase = await createAdminClient();
    
    const { data: booking } = await supabase
      .from('table_bookings')
      .select(`*, customer:customers(*)`)
      .eq('id', bookingId)
      .single();
      
    if (!booking || !booking.customer?.sms_opt_in) return;
    
    const variables = {
      reference: booking.booking_reference,
      refund_message: refundMessage,
      contact_phone: process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || '',
    };
    
    await supabase.from('jobs').insert({
      type: 'send_sms',
      payload: {
        to: booking.customer.mobile_number,
        template: 'cancellation',
        variables,
        booking_id: bookingId,
        customer_id: booking.customer.id
      },
      scheduled_for: new Date().toISOString(),
    });
  }

  static async queuePaymentRequestSMS(bookingId: string) {
    const supabase = await createAdminClient();
    
    const { data: booking } = await supabase
      .from('table_bookings')
      .select(`*, customer:customers(*), table_booking_items(*)`)
      .eq('id', bookingId)
      .single();
      
    if (!booking || !booking.customer?.sms_opt_in) return;
    
    let totalAmount = 0;
    if (booking.table_booking_items) {
      booking.table_booking_items.forEach((item: any) => {
        totalAmount += item.price_at_booking * item.quantity;
      });
    } else {
      totalAmount = booking.party_size * 25;
    }
    
    const depositAmount = booking.party_size * 5;
    const bookingDate = new Date(booking.booking_date);
    const deadlineDate = new Date(bookingDate);
    deadlineDate.setDate(bookingDate.getDate() - 1);
    deadlineDate.setHours(13, 0, 0, 0);
    
    const deadlineFormatted = formatDateWithTimeForSms(
      deadlineDate,
      `${deadlineDate.getHours().toString().padStart(2, '0')}:${deadlineDate.getMinutes().toString().padStart(2, '0')}`
    );
    
    const longPaymentUrl = `/table-booking/${booking.booking_reference}/payment`;
    const paymentLink = `${process.env.NEXT_PUBLIC_APP_URL}${longPaymentUrl}`;
    
    const variables = {
      customer_name: booking.customer.first_name,
      reference: booking.booking_reference,
      deposit_amount: depositAmount.toFixed(2),
      total_amount: totalAmount.toFixed(2),
      payment_link: paymentLink,
      deadline: deadlineFormatted,
    };
    
    await supabase.from('jobs').insert({
      type: 'send_sms',
      payload: {
        to: booking.customer.mobile_number,
        template: 'payment_request',
        variables,
        booking_id: bookingId,
        customer_id: booking.customer.id
      },
      scheduled_for: new Date().toISOString(),
    });
  }

  static async queueEmail(
    bookingId: string,
    emailType: 'confirmation' | 'cancellation' | 'reminder' | 'payment_request',
    options?: { refundMessage?: string }
  ) {
    const supabase = await createAdminClient();
    const { refundMessage } = options || {};

    let templateKey: string;
    const payload: any = { booking_id: bookingId };

    switch (emailType) {
      case 'confirmation': templateKey = 'table_booking_confirmation'; break;
      case 'cancellation': 
        templateKey = 'table_booking_cancellation'; 
        payload.refund_message = refundMessage;
        break;
      case 'reminder': templateKey = 'table_booking_reminder'; break;
      case 'payment_request': templateKey = 'table_booking_payment_request'; break;
      default: return;
    }

    await supabase.from('jobs').insert({
      type: 'send_email',
      payload: {
        template: templateKey,
        ...payload,
      },
      scheduled_for: new Date().toISOString(),
    });
  }

  static async getReportData(dateRange: { start: string; end: string }): Promise<ReportData> {
    const supabase = await createClient();

    // Get all bookings in date range
    const { data: bookings, error: bookingsError } = await supabase
      .from('table_bookings')
      .select(`
        *,
        customer:customers(id, first_name, last_name),
        table_booking_payments(amount, status)
      `)
      .gte('booking_date', dateRange.start)
      .lte('booking_date', dateRange.end);

    if (bookingsError) {
      throw new Error('Failed to fetch booking data');
    }

    // Calculate metrics
    const totalBookings = bookings?.length || 0;
    const confirmedBookings = bookings?.filter((b: any) => b.status === 'confirmed' || b.status === 'completed') || [];
    const cancelledBookings = bookings?.filter((b: any) => b.status === 'cancelled') || [];
    const noShowBookings = bookings?.filter((b: any) => b.status === 'no_show') || [];
    
    const totalCovers = confirmedBookings.reduce((sum: number, b: any) => sum + b.party_size, 0);
    const averagePartySize = confirmedBookings.length > 0 ? totalCovers / confirmedBookings.length : 0;
    const noShowRate = totalBookings > 0 ? (noShowBookings.length / totalBookings) * 100 : 0;
    const cancellationRate = totalBookings > 0 ? (cancelledBookings.length / totalBookings) * 100 : 0;
    
    const sundayLunchBookings = confirmedBookings.filter((b: any) => b.booking_type === 'sunday_lunch').length;
    const regularBookings = confirmedBookings.filter((b: any) => b.booking_type === 'regular').length;

    // Calculate revenue
    let totalRevenue = 0;
    let sundayLunchRevenue = 0;
    bookings?.forEach((booking: any) => {
      const payment = booking.table_booking_payments?.find((p: any) => p.status === 'completed');
      if (payment) {
        totalRevenue += payment.amount;
        if (booking.booking_type === 'sunday_lunch') {
          sundayLunchRevenue += payment.amount;
        }
      }
    });

    // Bookings by day of week
    const bookingsByDay: Record<string, number> = {
      'Monday': 0,
      'Tuesday': 0,
      'Wednesday': 0,
      'Thursday': 0,
      'Friday': 0,
      'Saturday': 0,
      'Sunday': 0,
    };
    
    confirmedBookings.forEach((booking: any) => {
      const dayName = formatDate(new Date(booking.booking_date), 'EEEE');
      if (bookingsByDay[dayName] !== undefined) {
        bookingsByDay[dayName]++;
      }
    });

    // Bookings by hour
    const bookingsByHour: Record<string, number> = {};
    confirmedBookings.forEach((booking: any) => {
      if (booking.booking_time) {
        const hour = booking.booking_time.split(':')[0];
        bookingsByHour[hour] = (bookingsByHour[hour] || 0) + 1;
      }
    });

    // Top customers
    const customerBookings: Record<string, any> = {};
    confirmedBookings.forEach((booking: any) => {
      if (booking.customer) {
        const customerId = booking.customer.id;
        if (!customerBookings[customerId]) {
          customerBookings[customerId] = {
            customer_id: customerId,
            customer_name: `${booking.customer.first_name} ${booking.customer.last_name}`,
            booking_badge: 0,
            total_covers: 0,
          };
        }
        customerBookings[customerId].booking_badge++;
        customerBookings[customerId].total_covers += booking.party_size;
      }
    });
    
    const topCustomers = Object.values(customerBookings)
      .sort((a: any, b: any) => b.booking_badge - a.booking_badge)
      .slice(0, 10);

    return {
      totalBookings: confirmedBookings.length, // Using confirmed count for consistency with other metrics like covers
      totalCovers,
      totalRevenue,
      averagePartySize,
      noShowRate,
      cancellationRate,
      sundayLunchBookings,
      regularBookings,
      bookingsByDay,
      bookingsByHour,
      topCustomers,
      revenueByType: {
        sunday_lunch: sundayLunchRevenue,
        regular: totalRevenue - sundayLunchRevenue,
      },
    };
  }

  static async getBookingsByDate(date: string) {
    const supabase = await createClient();
    
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
      throw new Error('Failed to fetch bookings');
    }
    
    return data;
  }

  static async searchBookings(searchTerm: string) {
    const supabase = await createClient();
    
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
      throw new Error('Failed to search bookings');
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
    
    return allBookings;
  }

  static async getBookingDetails(bookingId: string) {
    const supabase = await createClient();

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
      throw new Error('Failed to fetch booking details');
    }

    if (!data) {
      throw new Error('Booking not found');
    }

    return data;
  }

  static async searchTableBookings(searchTerm: string, searchType: 'name' | 'phone' | 'reference') {
    const supabase = await createClient();

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
        return [];
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
        return [];
      }
    } else if (searchType === 'reference') {
      query = query.ilike('booking_reference', `%${searchTerm}%`);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error('Failed to search bookings');
    }

    return data || [];
  }

  static async getDashboardData(viewMode: DashboardViewMode, referenceDate: Date): Promise<DashboardResult> {
    const supabase = await createClient();
    
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
      throw new Error('Failed to load bookings');
    }

    const stats: DashboardStats = {
      todayBookings: todayCount.count || 0,
      weekBookings: weekCount.count || 0,
      monthBookings: monthCount.count || 0,
      pendingPayments: pendingCount.count || 0,
      growth: growthStats,
    };

    return {
      bookings: (bookings || []) as TableBooking[],
      stats,
    };
  }

  static async findOrCreateCustomer(
    customerData: {
      first_name: string;
      last_name?: string;
      mobile_number: string;
      email?: string;
      sms_opt_in: boolean;
    }
  ) {
    const supabase = await createAdminClient();
    const standardizedPhone = formatPhoneForStorage(customerData.mobile_number);
    const phoneVariants = generatePhoneVariants(standardizedPhone);
    const normalizedEmail = customerData.email ? customerData.email.toLowerCase() : undefined;
    const searchConditions = [
      ...phoneVariants.map((v) => `mobile_number.eq.${v}`),
      `mobile_e164.eq.${standardizedPhone}`,
    ];

    const { data: existingMatches, error: existingLookupError } = await supabase
      .from('customers')
      .select('*')
      .or(searchConditions.join(','))
      .order('created_at', { ascending: true })
      .limit(1);

    if (existingLookupError) {
      console.error('Customer lookup error during table booking:', existingLookupError);
      throw new Error('Failed to find customer');
    }

    const existingCustomer = (existingMatches?.[0] ?? null) as any | null;

    if (existingCustomer) {
      const updates: Record<string, unknown> = {};

      if (customerData.sms_opt_in !== existingCustomer.sms_opt_in) {
        updates.sms_opt_in = customerData.sms_opt_in;
      }

      if (existingCustomer.mobile_number !== standardizedPhone) {
        updates.mobile_number = standardizedPhone;
      }

      if (!existingCustomer.mobile_e164 || existingCustomer.mobile_e164 !== standardizedPhone) {
        updates.mobile_e164 = standardizedPhone;
      }

      if (customerData.last_name && customerData.last_name !== existingCustomer.last_name) {
        updates.last_name = customerData.last_name;
      }

      if (normalizedEmail && normalizedEmail !== existingCustomer.email) {
        updates.email = normalizedEmail;
      }

      if (Object.keys(updates).length > 0) {
        const { data: updatedCustomer, error: updateError } = await supabase
          .from('customers')
          .update(updates)
          .eq('id', existingCustomer.id)
          .select()
          .single();

        if (updateError) {
          console.error('Failed to update existing customer from table booking:', updateError);
          return { ...existingCustomer, ...updates } as typeof existingCustomer;
        }

        if (updatedCustomer) {
          return updatedCustomer;
        }

        return { ...existingCustomer, ...updates } as typeof existingCustomer;
      }

      return existingCustomer;
    }

    const insertPayload: Record<string, unknown> = {
      first_name: customerData.first_name,
      last_name: customerData.last_name ?? null,
      mobile_number: standardizedPhone,
      mobile_e164: standardizedPhone,
      sms_opt_in: customerData.sms_opt_in,
    };

    if (normalizedEmail) {
      insertPayload.email = normalizedEmail;
    }

    const { data: newCustomer, error } = await supabase
      .from('customers')
      .insert(insertPayload)
      .select()
      .single();

    if (error) {
      if (error.code === '23505' && error.message?.includes('idx_customers_mobile_e164')) {
        const { data: existingByPhone, error: fetchExistingError } = await supabase
          .from('customers')
          .select('*')
          .eq('mobile_e164', standardizedPhone)
          .order('created_at', { ascending: true })
          .limit(1);

        if (fetchExistingError) {
          console.error('Failed to fetch customer after duplicate detected:', fetchExistingError);
        }

        const duplicateCustomer = existingByPhone?.[0];
        if (duplicateCustomer) {
          return duplicateCustomer;
        }
      }

      console.error('Failed to create customer from table booking:', error);
      throw new Error('Failed to create customer');
    }

    return newCustomer;
  }

  static async checkAvailability(
    date: string,
    time: string,
    partySize: number,
    excludeBookingId?: string
  ) {
    try {
      const supabase = await createClient();
      
      const { data, error } = await supabase.rpc('check_table_availability', {
        p_date: date,
        p_time: time,
        p_party_size: partySize,
        p_duration_minutes: 120,
        p_exclude_booking_id: excludeBookingId || null,
      });
      
      if (error) {
        console.error('Availability check error:', error);
        throw new Error('Failed to check availability');
      }
      
      return { 
        available_capacity: data[0]?.available_capacity || 0,
        is_available: data[0]?.is_available || false,
      };
    } catch (error) {
      console.error('Availability check error:', error);
      throw error;
    }
  }

  private static async validateKitchenHours(
    supabase: any,
    date: string,
    time: string,
    source: string,
    isStaffSource: boolean
  ) {
    const bookingDay = new Date(date).getDay();
    
    // Get business hours for the booking day
    const { data: businessHours } = await supabase
      .from('business_hours')
      .select('kitchen_opens, kitchen_closes, is_closed, is_kitchen_closed')
      .eq('day_of_week', bookingDay)
      .single();
      
    // Check for special hours
    const { data: specialHours } = await supabase
      .from('special_hours')
      .select('kitchen_opens, kitchen_closes, is_closed, is_kitchen_closed')
      .eq('date', date)
      .single();
      
    const activeHours = specialHours || businessHours;
    
    // Check if kitchen is closed
    const kitchenClosed = !activeHours || 
                         activeHours.is_closed || 
                         activeHours.is_kitchen_closed ||
                         (!activeHours.kitchen_opens || !activeHours.kitchen_closes);
    
    if (kitchenClosed) {
      if (isStaffSource) {
        console.warn('Overriding kitchen closure for staff-created booking', {
          booking_date: date,
          booking_time: time,
          source: source,
          is_closed: activeHours?.is_closed,
          is_kitchen_closed: activeHours?.is_kitchen_closed,
        });
        return; // Allow
      } else {
        throw new Error('Kitchen is closed on the selected date');
      }
    }
    
    // Check if booking time is within kitchen hours
    const kitchenOpens = activeHours?.kitchen_opens || time;
    const kitchenCloses = activeHours?.kitchen_closes || time;
    const outsideKitchenHours = time < kitchenOpens || time >= kitchenCloses;
    
    if (outsideKitchenHours) {
      if (isStaffSource) {
        console.warn('Overriding kitchen hours constraint for staff-created booking', {
          booking_date: date,
          booking_time: time,
          kitchen_opens: kitchenOpens,
          kitchen_closes: kitchenCloses,
          source: source,
        });
      } else {
        throw new Error(
          `Kitchen is only open from ${formatTime12Hour(kitchenOpens)} to ${formatTime12Hour(kitchenCloses)} on this day`
        );
      }
    }
  }

  static async createBooking(input: CreateTableBookingInput) {
    const supabase = await createClient();
    const adminSupabase = await createAdminClient();

    // 1. Handle Customer
    let customerId = input.customer_id;
    if (!customerId && input.customer_first_name) {
      const customer = await this.findOrCreateCustomer({
        first_name: input.customer_first_name,
        last_name: input.customer_last_name,
        mobile_number: input.customer_mobile_number || '',
        email: input.customer_email,
        sms_opt_in: input.customer_sms_opt_in ?? true,
      });
      customerId = customer.id;
    }

    if (!customerId) {
      throw new Error('Customer information is required');
    }

    // 2. Check Availability
    const availability = await this.checkAvailability(
      input.booking_date,
      input.booking_time,
      input.party_size
    );

    if (!availability.is_available) {
      throw new Error('No tables available for the selected time');
    }

    // 3. Validate Policy (RPC)
    const { data: policyCheck, error: policyError } = await supabase.rpc(
      'validate_booking_against_policy',
      {
        p_booking_type: input.booking_type,
        p_booking_date: input.booking_date,
        p_booking_time: input.booking_time,
        p_party_size: input.party_size,
      }
    );

    const policyResult = policyCheck?.[0];
    const policyErrorMessage = policyResult?.error_message;
    const isPolicyValid = Boolean(policyResult?.is_valid);
    const isStaffSource = input.source && input.source !== 'website';

    // Staff can override policies for cash payments directly or payment_link with override
    if (input.payment_method === 'cash' && !isStaffSource) {
      throw new Error('Cash payment option is only available for staff bookings');
    }

    if (policyError || !isPolicyValid) {
      const bookingDateTime = new Date(`${input.booking_date}T${input.booking_time}`);
      const hoursUntilBooking = (bookingDateTime.getTime() - Date.now()) / (1000 * 60 * 60);
      const isMinAdvanceViolation =
        typeof policyErrorMessage === 'string' &&
        policyErrorMessage.toLowerCase().includes('must be made at least');
      const isSundayCutoffViolation =
        input.booking_type === 'sunday_lunch' &&
        typeof policyErrorMessage === 'string' &&
        policyErrorMessage.toLowerCase().includes('sunday lunch bookings must be made before 1pm on saturday');
      const canOverridePolicy =
        isStaffSource &&
        (isMinAdvanceViolation || isSundayCutoffViolation) &&
        !Number.isNaN(hoursUntilBooking) &&
        hoursUntilBooking >= 0;
      
      if (canOverridePolicy) {
        console.warn('Overriding booking policy for staff-created booking', {
          booking_date: input.booking_date,
          booking_time: input.booking_time,
          party_size: input.party_size,
          hours_until_booking: hoursUntilBooking.toFixed(2),
          source: input.source,
          policy_error: policyErrorMessage,
        });
      } else {
        throw new Error(policyErrorMessage || 'Booking does not meet policy requirements');
      }
    }

    // 4. Validate Kitchen Hours
    await this.validateKitchenHours(
      supabase,
      input.booking_date,
      input.booking_time,
      input.source || 'phone',
      Boolean(isStaffSource)
    );

    // 5. Prepare Transaction Data
    let initialStatus: 'pending_payment' | 'confirmed' | 'cancelled' | 'no_show' | 'completed' = 'pending_payment';
    if (input.booking_type === 'sunday_lunch') {
      if (input.payment_method === 'cash') {
        initialStatus = 'confirmed';
      } else {
        initialStatus = 'pending_payment'; // Payment link will lead to pending status
      }
    } else {
      initialStatus = 'confirmed'; // Regular bookings are confirmed by default
    }

    const bookingData = {
      customer_id: customerId,
      booking_date: input.booking_date,
      booking_time: input.booking_time,
      party_size: input.party_size,
      booking_type: input.booking_type,
      special_requirements: input.special_requirements,
      dietary_requirements: input.dietary_requirements,
      allergies: input.allergies,
      celebration_type: input.celebration_type,
      duration_minutes: input.duration_minutes || 120,
      source: input.source || 'phone',
      status: initialStatus,
      payment_method: input.payment_method,
      payment_status: input.payment_status,
    };

    let paymentData = null;
    if (input.booking_type === 'sunday_lunch' && input.payment_method) {
      const depositAmount = input.party_size * 5; // Assuming deposit based on party size for now
      const recordedAt = new Date().toISOString();
      if (input.payment_method === 'cash') {
        paymentData = {
          amount: depositAmount,
          payment_method: 'cash',
          status: 'completed',
          paid_at: recordedAt,
          payment_metadata: {
            recorded_via: 'manual_cash',
            recorded_at: recordedAt,
            recorded_in_app: true,
            deposit_amount: depositAmount,
          },
        };
      }
    }

    // 6. Execute Atomic Transaction
    const { data: booking, error: transactionError } = await supabase.rpc(
      'create_table_booking_transaction',
      {
        p_booking_data: bookingData,
        p_menu_items: input.menu_items || [],
        p_payment_data: paymentData
      }
    );

    if (transactionError) {
      console.error('Transaction failed:', transactionError);
      throw new Error('Failed to create booking transaction');
    }

    // Queue confirmation SMS and Email
    if (booking.status === 'confirmed') {
      await this.queueConfirmationSMS(booking.id);
      await this.queueEmail(booking.id, 'confirmation');
    } else if (booking.status === 'pending_payment' && booking.booking_type === 'sunday_lunch') {
      await this.queuePaymentRequestSMS(booking.id);
      await this.queueEmail(booking.id, 'payment_request');
    }

    return booking;
  }

  static async updateBooking(bookingId: string, input: UpdateTableBookingInput) {
    const supabase = await createClient();

    // 1. Get Current Booking
    const { data: currentBooking, error: fetchError } = await supabase
      .from('table_bookings')
      .select('*')
      .eq('id', bookingId)
      .single();

    if (fetchError || !currentBooking) {
      throw new Error('Booking not found');
    }

    // 2. Check Availability (if date/time/size changed)
    if (input.booking_date || input.booking_time || input.party_size) {
      const availability = await this.checkAvailability(
        input.booking_date || currentBooking.booking_date,
        input.booking_time || currentBooking.booking_time,
        input.party_size || currentBooking.party_size,
        bookingId
      );

      if (!availability.is_available) {
        throw new Error('No tables available for the updated time');
      }

      // 3. Validate Kitchen Hours (if date/time changed)
      if (input.booking_date || input.booking_time) {
        await this.validateKitchenHours(
          supabase,
          input.booking_date || currentBooking.booking_date,
          input.booking_time || currentBooking.booking_time,
          currentBooking.source,
          currentBooking.source !== 'website'
        );
      }
    }

    // 4. Update Booking
    const updatePayload = withIncrementedModificationCount(
      { ...input },
      (currentBooking as { modification_count?: number }).modification_count
    );

    const { data: updatedBooking, error: updateError } = await supabase
      .from('table_bookings')
      .update(updatePayload)
      .eq('id', bookingId)
      .select()
      .single();

    if (updateError) {
      console.error('Booking update error:', updateError);
      throw new Error('Failed to update booking');
    }

    // 5. Log Modification
    await supabase
      .from('table_booking_modifications')
      .insert({
        booking_id: bookingId,
        modified_by: (await supabase.auth.getUser()).data.user?.id,
        modification_type: 'manual_update',
        old_values: currentBooking,
        new_values: updatedBooking,
      });

    const dateChanged = updatedBooking.booking_date !== currentBooking.booking_date;
    const timeChanged = updatedBooking.booking_time !== currentBooking.booking_time;
    const partySizeChanged = updatedBooking.party_size !== currentBooking.party_size;

    if (updatedBooking.status === 'confirmed' && (dateChanged || timeChanged || partySizeChanged)) {
      await this.queueUpdateSMS(updatedBooking.id);
    }

    return {
      updatedBooking,
      currentBooking,
      changes: {
        dateChanged,
        timeChanged,
        partySizeChanged
      }
    };
  }

  static async cancelBooking(bookingId: string, reason: string) {
    const supabase = await createClient();
    const adminSupabase = await createAdminClient();

    // 1. Get Booking
    const { data: booking, error: fetchError } = await adminSupabase
      .from('table_bookings')
      .select('*, table_booking_payments(*)')
      .eq('id', bookingId)
      .single();

    if (fetchError || !booking) {
      throw new Error('Booking not found');
    }

    if (booking.status === 'cancelled') {
      throw new Error('Booking is already cancelled');
    }

    // 2. Calculate Refund
    let refundAmount = 0;
    if (booking.table_booking_payments?.length > 0) {
      const { data: refundCalc } = await supabase.rpc('calculate_refund_amount', {
        p_booking_id: bookingId,
      });
      refundAmount = refundCalc?.[0]?.refund_amount || 0;
    }

    // 3. Update Status
    const { error: updateError } = await adminSupabase
      .from('table_bookings')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        cancellation_reason: reason,
      })
      .eq('id', bookingId);

    if (updateError) {
      console.error('Booking cancellation error:', updateError);
      throw new Error('Failed to cancel booking');
    }

    const refundMessage = refundAmount > 0 
      ? `A refund of £${refundAmount.toFixed(2)} will be processed within 3-5 business days.`
      : 'No payment was taken for this booking.';
    
    await this.queueCancellationSMS(bookingId, refundMessage);
    await this.queueEmail(bookingId, 'cancellation', { refundMessage });

    return {
      booking,
      refundAmount,
      refundEligible: refundAmount > 0
    };
  }

  static async markNoShow(bookingId: string) {
    const supabase = await createClient();
    
    const { data: booking, error } = await supabase
      .from('table_bookings')
      .update({
        status: 'no_show',
        no_show_at: new Date().toISOString(),
      })
      .eq('id', bookingId)
      .select()
      .single();
      
    if (error) {
      throw new Error('Failed to mark as no-show');
    }

    return booking;
  }

  static async markCompleted(bookingId: string) {
    const supabase = await createClient();
    
    const { data: booking, error } = await supabase
      .from('table_bookings')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
      })
      .eq('id', bookingId)
      .select()
      .single();
      
    if (error) {
      throw new Error('Failed to mark as completed');
    }

    return booking;
  }

  static async deleteBooking(bookingId: string) {
    const supabase = await createClient();

    const { data: booking, error: fetchError } = await supabase
      .from('table_bookings')
      .select('id, status, booking_reference')
      .eq('id', bookingId)
      .single();

    if (fetchError || !booking) {
      throw new Error('Booking not found');
    }

    if (booking.status !== 'pending_payment' && booking.status !== 'cancelled') {
      throw new Error('Only pending or cancelled bookings can be deleted');
    }

    const { error: deleteError } = await supabase
      .from('table_bookings')
      .delete()
      .eq('id', bookingId);

    if (deleteError) {
      throw new Error('Failed to delete booking');
    }

    return booking;
  }
}
