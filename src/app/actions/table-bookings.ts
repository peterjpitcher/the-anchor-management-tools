'use server';

import { createClient } from '@/lib/supabase/server';
import { checkUserPermission } from '@/app/actions/rbac';
import { logAuditEvent } from './audit';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { generatePhoneVariants } from '@/lib/utils';
import { sendSameDayBookingAlertIfNeeded, TableBookingNotificationRecord } from '@/lib/table-bookings/managerNotifications';
import { startOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, addMonths, format as formatDate, subDays, isWithinInterval, parseISO } from 'date-fns';
import type { TableBooking } from '@/types/table-bookings';
import { TableBookingService, type DashboardViewMode, type DashboardResult } from '@/services/table-bookings';

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

type GrowthMetric = {
  bookings: number;
  covers: number;
  bookingsChange: number;
  coversChange: number;
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
    const dashboardData = await TableBookingService.getDashboardData(params.viewMode, referenceDate);

    return {
      success: true,
      data: dashboardData,
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
    // Check permissions
    const hasPermission = await checkUserPermission('table_bookings', 'view');
    if (!hasPermission) {
      return { error: 'You do not have permission to view bookings' };
    }
    
    const data = await TableBookingService.getBookingsByDate(date);
    return { data };
  } catch (error) {
    console.error('Get bookings error:', error);
    return { error: 'An unexpected error occurred' };
  }
}

// Search bookings
export async function searchBookings(searchTerm: string) {
  try {
    // Check permissions
    const hasPermission = await checkUserPermission('table_bookings', 'view');
    if (!hasPermission) {
      return { error: 'You do not have permission to search bookings' };
    }
    
    const data = await TableBookingService.searchBookings(searchTerm);
    return { data };
  } catch (error) {
    console.error('Search bookings error:', error);
    return { error: 'An unexpected error occurred' };
  }
}

// Get detailed booking information
export async function getTableBookingDetails(bookingId: string) {
  try {
    // Check permissions
    const hasPermission = await checkUserPermission('table_bookings', 'view');
    if (!hasPermission) {
      return { error: 'You do not have permission to view bookings' };
    }

    const data = await TableBookingService.getBookingDetails(bookingId);
    return { success: true, data };
  } catch (error: any) {
    console.error('Unexpected error fetching booking details:', error);
    return { error: error.message || 'An unexpected error occurred' };
  }
}

// Targeted search for bookings
export async function searchTableBookings(searchTerm: string, searchType: 'name' | 'phone' | 'reference') {
  try {
    const hasPermission = await checkUserPermission('table_bookings', 'view');
    if (!hasPermission) {
      return { error: 'You do not have permission to search bookings' };
    }

    const data = await TableBookingService.searchTableBookings(searchTerm, searchType);
    return { success: true, data };
  } catch (error: any) {
    console.error('Unexpected search error:', error);
    return { error: 'An unexpected error occurred' };
  }
}
