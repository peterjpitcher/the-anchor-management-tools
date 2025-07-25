'use server';

import { createClient } from '@/lib/supabase/server';
import { format, parse, addMinutes, isWithinInterval, setHours, setMinutes } from 'date-fns';
import { BookingAvailability } from '@/types/table-bookings';

// Restaurant capacity configuration
const RESTAURANT_CAPACITY = 50; // Maximum 50 people at any time

// Generate time slots based on kitchen hours
function generateTimeSlots(
  openTime: string,
  closeTime: string,
  intervalMinutes: number = 30
): string[] {
  const slots: string[] = [];
  const baseDate = new Date();
  
  // Parse times
  const [openHour, openMin] = openTime.split(':').map(Number);
  const [closeHour, closeMin] = closeTime.split(':').map(Number);
  
  let currentTime = setMinutes(setHours(baseDate, openHour), openMin);
  const endTime = setMinutes(setHours(baseDate, closeHour), closeMin);
  
  // Generate slots
  while (currentTime < endTime) {
    slots.push(format(currentTime, 'HH:mm'));
    currentTime = addMinutes(currentTime, intervalMinutes);
  }
  
  return slots;
}

// Check availability for a specific date
export async function checkAvailability(
  date: string,
  partySize: number,
  bookingType?: 'regular' | 'sunday_lunch'
): Promise<{ data?: BookingAvailability; error?: string }> {
  try {
    const supabase = await createClient();
    const bookingDate = new Date(date);
    const dayOfWeek = bookingDate.getDay();
    
    // Get business hours for the day
    const { data: businessHours } = await supabase
      .from('business_hours')
      .select('*')
      .eq('day_of_week', dayOfWeek)
      .single();
      
    // Check for special hours (holidays, etc.)
    const { data: specialHours } = await supabase
      .from('special_hours')
      .select('*')
      .eq('date', date)
      .single();
      
    const activeHours = specialHours || businessHours;
    
    // Check if closed
    if (!activeHours || activeHours.is_closed) {
      return {
        data: {
          available: false,
          time_slots: [],
          kitchen_hours: {
            opens: '00:00',
            closes: '00:00',
            source: specialHours ? 'special_hours' : 'business_hours',
          },
          special_notes: activeHours?.notes || 'Restaurant closed on this date',
        }
      };
    }
    
    // Check kitchen hours
    if (!activeHours.kitchen_opens || !activeHours.kitchen_closes) {
      return {
        data: {
          available: false,
          time_slots: [],
          kitchen_hours: {
            opens: activeHours.opens || '00:00',
            closes: activeHours.closes || '00:00',
            source: specialHours ? 'special_hours' : 'business_hours',
          },
          special_notes: 'Kitchen closed on this date',
        }
      };
    }
    
    // Generate time slots from kitchen hours
    const allSlots = generateTimeSlots(
      activeHours.kitchen_opens,
      activeHours.kitchen_closes,
      30 // 30-minute intervals
    );
    
    // Get booking time slot configurations
    const { data: slotConfigs } = await supabase
      .from('booking_time_slots')
      .select('*')
      .eq('day_of_week', dayOfWeek)
      .eq('is_active', true)
      .or(`booking_type.eq.${bookingType},booking_type.is.null`);
      
    // Get existing bookings for the date
    const { data: existingBookings } = await supabase
      .from('table_bookings')
      .select('booking_time, party_size, duration_minutes')
      .eq('booking_date', date)
      .in('status', ['confirmed', 'pending_payment']);
      
    // Use a fixed restaurant capacity instead of table configuration
    const totalCapacity = RESTAURANT_CAPACITY;
    
    // Calculate availability for each slot
    const availableSlots = allSlots.map(slotTime => {
      // Find slot configuration
      const slotConfig = slotConfigs?.find(config => 
        config.slot_time === slotTime + ':00' &&
        (!config.booking_type || config.booking_type === bookingType)
      );
      
      // Use slot-specific capacity if configured, otherwise use restaurant capacity
      const maxCovers = slotConfig?.max_covers || RESTAURANT_CAPACITY;
      
      // Calculate booked capacity for this slot
      const bookedCapacity = existingBookings?.reduce((sum, booking) => {
        const bookingStart = parse(booking.booking_time, 'HH:mm', new Date());
        const bookingEnd = addMinutes(bookingStart, booking.duration_minutes || 120);
        const slotStart = parse(slotTime, 'HH:mm', new Date());
        const slotEnd = addMinutes(slotStart, 30);
        
        // Check if booking overlaps with this slot
        const overlaps = 
          (bookingStart < slotEnd && bookingEnd > slotStart) ||
          (slotStart < bookingEnd && slotEnd > bookingStart);
          
        return overlaps ? sum + booking.party_size : sum;
      }, 0) || 0;
      
      const availableCapacity = maxCovers - bookedCapacity;
      
      return {
        time: slotTime,
        available_capacity: Math.max(0, availableCapacity),
        booking_type: bookingType,
        requires_prepayment: bookingType === 'sunday_lunch',
      };
    });
    
    // Filter slots with enough capacity
    const viableSlots = availableSlots.filter(slot => 
      slot.available_capacity >= partySize
    );
    
    // Special Sunday lunch validation
    if (bookingType === 'sunday_lunch' && dayOfWeek === 0) {
      const now = new Date();
      const saturday1pm = new Date(bookingDate);
      saturday1pm.setDate(saturday1pm.getDate() - 1); // Previous Saturday
      saturday1pm.setHours(13, 0, 0, 0); // 1pm
      
      if (now > saturday1pm) {
        return {
          data: {
            available: false,
            time_slots: [],
            kitchen_hours: {
              opens: activeHours.kitchen_opens,
              closes: activeHours.kitchen_closes,
              source: specialHours ? 'special_hours' : 'business_hours',
            },
            special_notes: 'Sunday lunch bookings must be made before 1pm on Saturday',
          }
        };
      }
    }
    
    return {
      data: {
        available: viableSlots.length > 0,
        time_slots: viableSlots,
        kitchen_hours: {
          opens: activeHours.kitchen_opens,
          closes: activeHours.kitchen_closes,
          source: specialHours ? 'special_hours' : 'business_hours',
        },
        special_notes: activeHours.notes,
      }
    };
  } catch (error) {
    console.error('Availability check error:', error);
    return { error: 'Failed to check availability' };
  }
}

// Get availability for a date range
export async function getAvailabilityRange(
  startDate: string,
  endDate: string,
  bookingType?: 'regular' | 'sunday_lunch'
) {
  try {
    const supabase = await createClient();
    
    // Get all dates in range
    const dates: string[] = [];
    const current = new Date(startDate);
    const end = new Date(endDate);
    
    while (current <= end) {
      dates.push(format(current, 'yyyy-MM-dd'));
      current.setDate(current.getDate() + 1);
    }
    
    // Check availability for each date
    const availabilityPromises = dates.map(date => 
      checkAvailability(date, 1, bookingType) // Check for minimum party size
    );
    
    const results = await Promise.all(availabilityPromises);
    
    // Build availability map
    const availabilityMap: Record<string, boolean> = {};
    dates.forEach((date, index) => {
      availabilityMap[date] = results[index].data?.available || false;
    });
    
    return { data: availabilityMap };
  } catch (error) {
    console.error('Availability range error:', error);
    return { error: 'Failed to check availability range' };
  }
}

// Get next available slot
export async function getNextAvailableSlot(
  partySize: number,
  bookingType: 'regular' | 'sunday_lunch',
  preferredTime?: string
) {
  try {
    const today = new Date();
    const maxDate = new Date();
    maxDate.setDate(maxDate.getDate() + 56); // 8 weeks ahead
    
    const currentDate = new Date(today);
    
    while (currentDate <= maxDate) {
      const dateStr = format(currentDate, 'yyyy-MM-dd');
      const availability = await checkAvailability(dateStr, partySize, bookingType);
      
      if (availability.data?.available && availability.data.time_slots.length > 0) {
        // If preferred time specified, try to find closest slot
        if (preferredTime) {
          const preferredMinutes = parse(preferredTime, 'HH:mm', new Date()).getTime();
          const closestSlot = availability.data.time_slots.reduce((closest, slot) => {
            const slotMinutes = parse(slot.time, 'HH:mm', new Date()).getTime();
            const closestMinutes = parse(closest.time, 'HH:mm', new Date()).getTime();
            
            return Math.abs(slotMinutes - preferredMinutes) < 
                   Math.abs(closestMinutes - preferredMinutes) ? slot : closest;
          });
          
          return {
            data: {
              date: dateStr,
              time: closestSlot.time,
              available_capacity: closestSlot.available_capacity,
            }
          };
        }
        
        // Return first available slot
        return {
          data: {
            date: dateStr,
            time: availability.data.time_slots[0].time,
            available_capacity: availability.data.time_slots[0].available_capacity,
          }
        };
      }
      
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    return { error: 'No available slots found in the next 8 weeks' };
  } catch (error) {
    console.error('Next available slot error:', error);
    return { error: 'Failed to find next available slot' };
  }
}

// Check if modification is allowed
export async function checkModificationAllowed(
  bookingId: string,
  newDate?: string,
  newTime?: string,
  newPartySize?: number
) {
  try {
    const supabase = await createClient();
    
    // Get booking
    const { data: booking } = await supabase
      .from('table_bookings')
      .select('*')
      .eq('id', bookingId)
      .single();
      
    if (!booking) {
      return { error: 'Booking not found' };
    }
    
    // Get policy
    const { data: policy } = await supabase
      .from('booking_policies')
      .select('*')
      .eq('booking_type', booking.booking_type)
      .single();
      
    if (!policy?.modification_allowed) {
      return { allowed: false, reason: 'Modifications not allowed for this booking type' };
    }
    
    // Check time constraints
    const bookingDateTime = new Date(`${booking.booking_date}T${booking.booking_time}`);
    const hoursUntilBooking = (bookingDateTime.getTime() - Date.now()) / (1000 * 60 * 60);
    
    if (hoursUntilBooking < policy.min_advance_hours) {
      return { 
        allowed: false, 
        reason: `Modifications must be made at least ${policy.min_advance_hours} hours in advance` 
      };
    }
    
    // If changing date/time/size, check new availability
    if (newDate || newTime || newPartySize) {
      const availability = await checkTableAvailability(
        newDate || booking.booking_date,
        newTime || booking.booking_time,
        newPartySize || booking.party_size,
        bookingId // Exclude current booking
      );
      
      if (!availability.data?.is_available) {
        return { 
          allowed: false, 
          reason: 'No availability for the requested changes' 
        };
      }
    }
    
    return { allowed: true };
  } catch (error) {
    console.error('Modification check error:', error);
    return { error: 'Failed to check modification eligibility' };
  }
}

// Helper function used by server actions
async function checkTableAvailability(
  date: string,
  time: string,
  partySize: number,
  excludeBookingId?: string
) {
  const supabase = await createClient();
  
  // Get existing bookings for the date and time
  const { data: existingBookings, error } = await supabase
    .from('table_bookings')
    .select('booking_time, party_size, duration_minutes')
    .eq('booking_date', date)
    .in('status', ['confirmed', 'pending_payment'])
    .neq('id', excludeBookingId || '');
    
  if (error) {
    console.error('Availability check error:', error);
    return { error: 'Failed to check availability' };
  }
  
  // Calculate booked capacity for the requested time slot
  const requestedStart = parse(time, 'HH:mm', new Date());
  const requestedEnd = addMinutes(requestedStart, 120); // Assume 2-hour duration
  
  const bookedCapacity = existingBookings?.reduce((sum, booking) => {
    const bookingStart = parse(booking.booking_time, 'HH:mm', new Date());
    const bookingEnd = addMinutes(bookingStart, booking.duration_minutes || 120);
    
    // Check if booking overlaps with requested time
    const overlaps = 
      (bookingStart < requestedEnd && bookingEnd > requestedStart) ||
      (requestedStart < bookingEnd && requestedEnd > bookingStart);
      
    return overlaps ? sum + booking.party_size : sum;
  }, 0) || 0;
  
  const availableCapacity = RESTAURANT_CAPACITY - bookedCapacity;
  
  return { 
    data: {
      available_capacity: Math.max(0, availableCapacity),
      is_available: availableCapacity >= partySize,
    }
  };
}