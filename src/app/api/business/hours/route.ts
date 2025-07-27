import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { createApiResponse, createErrorResponse } from '@/lib/api/auth';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export async function GET(_request: NextRequest) {
  try {
    // This endpoint can be public for SEO purposes
    const supabase = createAdminClient();
    
    // Get regular hours
    const { data: regularHours, error: hoursError } = await supabase
      .from('business_hours')
      .select('*')
      .order('day_of_week', { ascending: true });

    if (hoursError) {
      console.error('Failed to fetch business hours:', hoursError);
      return createErrorResponse('Failed to fetch business hours', 'DATABASE_ERROR', 500);
    }

    // Get special hours for the next 90 days
    const today = new Date();
    const ninetyDaysFromNow = new Date();
    ninetyDaysFromNow.setDate(ninetyDaysFromNow.getDate() + 90);

    let specialHours = [];
    try {
      const { data, error } = await supabase
        .from('special_hours')
        .select('*')
        .gte('date', today.toISOString().split('T')[0])
        .lte('date', ninetyDaysFromNow.toISOString().split('T')[0])
        .order('date', { ascending: true });
      
      if (error) {
        console.error('Special hours query failed:', error);
        // Continue with empty special hours instead of failing
      } else {
        specialHours = data || [];
      }
    } catch (specialError) {
      console.error('Special hours error:', specialError);
      // Continue with empty special hours
    }

    // Get today's events for capacity information
    const todayStr = format(today, 'yyyy-MM-dd');
    const { data: todayEvents } = await supabase
      .from('events')
      .select('id, title, start_date, start_time, capacity')
      .eq('start_date', todayStr)
      .order('start_time', { ascending: true });

    // Get current bookings for capacity calculation
    const { data: currentBookings } = await supabase
      .from('table_bookings')
      .select('party_size, booking_time')
      .eq('booking_date', todayStr)
      .in('status', ['confirmed', 'pending_payment']);

    // Get booking time slots configuration
    const currentDayOfWeek = new Date().getDay();
    const { data: bookingSlots } = await supabase
      .from('booking_time_slots')
      .select('*')
      .eq('day_of_week', currentDayOfWeek)
      .eq('is_active', true)
      .order('slot_time', { ascending: true });

  // Format regular hours
  const formattedRegularHours = regularHours?.reduce((acc: any, hour) => {
    const dayName = DAY_NAMES[hour.day_of_week];
    acc[dayName] = {
      opens: hour.opens,
      closes: hour.closes,
      kitchen: hour.kitchen_opens && hour.kitchen_closes ? {
        opens: hour.kitchen_opens,
        closes: hour.kitchen_closes,
      } : null,
      is_closed: hour.is_closed,
    };
    return acc;
  }, {}) || {};

  // Format special hours - handle kitchen closure based on null values or venue closure
  const formattedSpecialHours = specialHours?.map(special => ({
    date: special.date,
    opens: special.opens,
    closes: special.closes,
    kitchen: special.is_closed ? null : special.kitchen_opens && special.kitchen_closes ? {
      opens: special.kitchen_opens,
      closes: special.kitchen_closes,
    } : null,
    status: special.is_closed ? 'closed' : 'modified',
    note: special.note,
  })) || [];

  // Calculate current status in London timezone
  const timeZone = 'Europe/London';
  const now = new Date();
  const nowInLondon = toZonedTime(now, timeZone);
  const currentDay = nowInLondon.getDay();
  const currentTime = format(nowInLondon, 'HH:mm:ss');
  const todayDate = format(nowInLondon, 'yyyy-MM-dd');
  const currentDayName = DAY_NAMES[currentDay];
  

  // Check if today has special hours
  const todaySpecial = specialHours?.find(s => s.date === todayDate);
  let currentStatus: any = {
    isOpen: false,
    kitchenOpen: false,
    closesIn: null,
    opensIn: null,
  };

  if (todaySpecial) {
    if (!todaySpecial.is_closed && todaySpecial.opens && todaySpecial.closes) {
      const isCurrentlyOpen = currentTime >= todaySpecial.opens && currentTime < todaySpecial.closes;
      const isKitchenOpen = todaySpecial.is_kitchen_closed ? false : 
        !!(todaySpecial.kitchen_opens && todaySpecial.kitchen_closes &&
        currentTime >= todaySpecial.kitchen_opens && currentTime < todaySpecial.kitchen_closes);

      currentStatus = {
        isOpen: isCurrentlyOpen,
        kitchenOpen: isKitchenOpen,
        closesIn: isCurrentlyOpen ? calculateTimeUntil(currentTime, todaySpecial.closes) : null,
        opensIn: !isCurrentlyOpen && currentTime < todaySpecial.opens ? 
          calculateTimeUntil(currentTime, todaySpecial.opens) : null,
        currentTime,
        timestamp: nowInLondon.toISOString(),
      };
    }
  } else {
    const todayHours = regularHours?.find(h => h.day_of_week === currentDay);
    if (todayHours && !todayHours.is_closed && todayHours.opens && todayHours.closes) {
      const isCurrentlyOpen = currentTime >= todayHours.opens && currentTime < todayHours.closes;
      
      let isKitchenOpen = false;
      if (todayHours.kitchen_opens && todayHours.kitchen_closes) {
        isKitchenOpen = currentTime >= todayHours.kitchen_opens && currentTime < todayHours.kitchen_closes;
      }

      currentStatus = {
        isOpen: isCurrentlyOpen,
        kitchenOpen: isKitchenOpen,
        closesIn: isCurrentlyOpen ? calculateTimeUntil(currentTime, todayHours.closes) : null,
        opensIn: !isCurrentlyOpen && currentTime < todayHours.opens ? 
          calculateTimeUntil(currentTime, todayHours.opens) : null,
        currentTime,
        timestamp: nowInLondon.toISOString(),
      };
    }
  }

  // Calculate today's information
  const todayHoursData = todaySpecial || (regularHours?.find(h => h.day_of_week === currentDay));
  const todayInfo = {
    date: todayDate,
    dayName: currentDayName,
    summary: todayHoursData?.is_closed ? 'Closed' : 
      `Open ${todayHoursData?.opens || 'N/A'} - ${todayHoursData?.closes || 'N/A'}` +
      (todayHoursData?.kitchen_opens ? `, Kitchen ${todayHoursData.kitchen_opens} - ${todayHoursData.kitchen_closes}` : ''),
    isSpecialHours: !!todaySpecial,
    events: todayEvents?.map(e => ({
      title: e.title,
      time: e.start_time,
      affectsCapacity: !!e.capacity
    })) || [],
  };

  // Calculate capacity information
  const RESTAURANT_CAPACITY = 50;
  const currentCapacity = currentBookings?.reduce((sum, booking) => sum + booking.party_size, 0) || 0;
  const capacityInfo = {
    total: RESTAURANT_CAPACITY,
    available: Math.max(0, RESTAURANT_CAPACITY - currentCapacity),
    percentageFull: Math.round((currentCapacity / RESTAURANT_CAPACITY) * 100),
  };

  // Generate upcoming week overview
  const upcomingWeek = [];
  for (let i = 0; i < 7; i++) {
    const checkDate = new Date(nowInLondon);
    checkDate.setDate(checkDate.getDate() + i);
    const checkDateStr = format(checkDate, 'yyyy-MM-dd');
    const checkDayOfWeek = checkDate.getDay();
    const checkDayName = DAY_NAMES[checkDayOfWeek];
    
    const specialDay = specialHours?.find(s => s.date === checkDateStr);
    const regularDay = regularHours?.find(h => h.day_of_week === checkDayOfWeek);
    
    upcomingWeek.push({
      date: checkDateStr,
      dayName: checkDayName,
      status: specialDay ? 'special' : 'normal',
      summary: specialDay?.is_closed || regularDay?.is_closed ? 'Closed' :
        `Open ${specialDay?.opens || regularDay?.opens || 'N/A'} - ${specialDay?.closes || regularDay?.closes || 'N/A'}`,
      note: specialDay?.note,
    });
  }

  // Calculate service information
  const services = {
    venue: {
      open: currentStatus.isOpen,
      closesIn: currentStatus.closesIn,
    },
    kitchen: {
      open: currentStatus.kitchenOpen,
      closesIn: currentStatus.kitchenOpen ? 
        (todayHoursData?.kitchen_closes ? calculateTimeUntil(currentTime, todayHoursData.kitchen_closes) : null) : null,
    },
    bookings: {
      accepting: currentStatus.isOpen && currentStatus.kitchenOpen,
      availableSlots: bookingSlots?.filter(slot => {
        // Filter slots that are still available today
        return slot.slot_time > currentTime;
      }).map(slot => slot.slot_time.substring(0, 5)) || [],
    },
  };

  // Find next closure
  let nextClosure = null;
  let nextModified = null;
  
  for (const special of specialHours || []) {
    if (special.is_closed && !nextClosure) {
      nextClosure = {
        date: special.date,
        reason: special.note || 'Closed',
      };
    }
    if (!special.is_closed && !nextModified) {
      nextModified = {
        date: special.date,
        reason: special.note || 'Modified hours',
        changes: `${special.opens || 'Closed'} - ${special.closes || 'Closed'}`,
      };
    }
    if (nextClosure && nextModified) break;
  }

  // Service patterns
  const patterns = {
    regularClosures: ['Christmas Day', 'Boxing Day'],
    typicalBusyTimes: {
      friday: ['19:00-21:00'],
      saturday: ['12:00-14:00', '19:00-21:00'],
      sunday: ['12:00-15:00'],
    },
    quietTimes: {
      tuesday: ['14:00-17:00'],
      wednesday: ['14:00-17:00'],
    },
  };

  // Sunday lunch info
  const sundayInfo = currentDay === 0 ? {
    available: true,
    slots: ['12:00', '12:30', '13:00', '13:30', '14:00'],
    bookingRequired: true,
    lastOrderTime: '14:00',
  } : null;

  // Build comprehensive response
  const response = {
    success: true,
    data: {
      regularHours: formattedRegularHours,
      specialHours: formattedSpecialHours,
      currentStatus: {
        ...currentStatus,
        services,
        capacity: capacityInfo,
      },
      today: todayInfo,
      upcomingWeek,
      patterns,
      services: {
        kitchen: {
          lunch: { start: '12:00:00', end: '14:30:00' },
          dinner: { start: '17:00:00', end: '21:00:00' },
          sundayLunch: sundayInfo,
        },
        bar: {
          happyHour: { days: ['friday'], start: '17:00:00', end: '19:00:00' },
        },
        privateHire: {
          available: true,
          minimumNotice: '48 hours',
          spaces: ['Main Restaurant', 'Private Dining Room', 'Garden Area'],
        },
      },
      planning: {
        nextClosure,
        nextModifiedHours: nextModified,
        seasonalChanges: {
          summerHours: {
            active: false,
            period: 'June-August',
            changes: 'Garden open until 23:00',
          },
        },
      },
      integration: {
        bookingApi: '/api/table-bookings/availability',
        eventsApi: '/api/events',
        lastUpdated: new Date().toISOString(),
        updateFrequency: '1 minute',
      },
    },
    metadata: {
      generated: new Date().toISOString(),
      timezone: 'Europe/London',
      dataVersion: '2.0',
      cacheControl: 'public, max-age=60',
    },
  };

  return createApiResponse(response.data, 200, {
    'Cache-Control': 'public, max-age=60, stale-while-revalidate=120',
  });
  } catch (error) {
    console.error('Business hours API error:', error);
    // Return minimal response on error
    return createApiResponse({
      regularHours: {},
      specialHours: [],
      currentStatus: {
        isOpen: false,
        kitchenOpen: false,
        closesIn: null,
        opensIn: null,
        error: 'Unable to fetch complete data',
      },
      error: 'Some data may be unavailable',
    }, 200);
  }
}

function calculateTimeUntil(fromTime: string, toTime: string): string {
  const [fromHours, fromMinutes] = fromTime.split(':').map(Number);
  const [toHours, toMinutes] = toTime.split(':').map(Number);
  
  const totalFromMinutes = fromHours * 60 + fromMinutes;
  const totalToMinutes = toHours * 60 + toMinutes;
  const diffMinutes = totalToMinutes - totalFromMinutes;
  
  const hours = Math.floor(diffMinutes / 60);
  const minutes = diffMinutes % 60;
  
  if (hours > 0 && minutes > 0) {
    return `${hours} hour${hours > 1 ? 's' : ''} ${minutes} minute${minutes > 1 ? 's' : ''}`;
  } else if (hours > 0) {
    return `${hours} hour${hours > 1 ? 's' : ''}`;
  } else {
    return `${minutes} minute${minutes > 1 ? 's' : ''}`;
  }
}

export async function OPTIONS(request: NextRequest) {
  return createApiResponse({}, 200);
}