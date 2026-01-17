import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createApiResponse, createErrorResponse } from '@/lib/api/auth';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { getTodayIsoDate, getLocalIsoDateDaysAhead } from '@/lib/dateUtils';

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

    let specialHours = [];
    try {
      const { data, error } = await supabase
        .from('special_hours')
        .select('*')
        .gte('date', getTodayIsoDate())
        .lte('date', getLocalIsoDateDaysAhead(90))
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

    let serviceStatuses: any[] = [];
    try {
      const { data, error } = await supabase
        .from('service_statuses')
        .select('service_code, display_name, is_enabled, message, updated_at')
        .order('updated_at', { ascending: true });

      if (error) {
        console.error('Service status query failed:', error);
      } else {
        serviceStatuses = data || [];
      }
    } catch (serviceStatusError) {
      console.error('Service status error:', serviceStatusError);
    }

    let serviceStatusOverrides: any[] = [];
    try {
      const { data, error } = await supabase
        .from('service_status_overrides')
        .select('service_code, start_date, end_date, is_enabled, message, updated_at, created_by')
        .gte('end_date', format(today, 'yyyy-MM-dd'))
        .order('start_date', { ascending: true });

      if (error) {
        console.error('Service status overrides query failed:', error);
      } else {
        serviceStatusOverrides = data || [];
      }
    } catch (serviceOverridesError) {
      console.error('Service status overrides error:', serviceOverridesError);
    }

    // Get today's events for capacity information
    const todayStr = format(today, 'yyyy-MM-dd');
    const { data: todayEvents } = await supabase
      .from('events')
      .select('id, title, start_date, start_time, capacity')
      .eq('start_date', todayStr)
      .order('start_time', { ascending: true });

    // Table booking functionality removed; omit reservation capacity + slot calculations.

  // Format regular hours
  const formattedRegularHours = regularHours?.reduce((acc: any, hour) => {
    const dayName = DAY_NAMES[hour.day_of_week];
    acc[dayName] = {
      opens: hour.opens,
      closes: hour.closes,
      kitchen: hour.is_kitchen_closed ? null : (hour.kitchen_opens && hour.kitchen_closes ? {
        opens: hour.kitchen_opens,
        closes: hour.kitchen_closes,
      } : null),
      is_closed: hour.is_closed,
      is_kitchen_closed: hour.is_kitchen_closed,
      schedule_config: hour.schedule_config || [] // Expose new config
    };
    return acc;
  }, {}) || {};

  // Format special hours - handle kitchen closure based on null values or venue closure
  const formattedSpecialHours = specialHours?.map(special => ({
    date: special.date,
    opens: special.opens,
    closes: special.closes,
    kitchen: (special.is_closed || special.is_kitchen_closed) ? null : (special.kitchen_opens && special.kitchen_closes ? {
      opens: special.kitchen_opens,
      closes: special.kitchen_closes,
    } : null),
    status: special.is_closed ? 'closed' : 'modified',
    note: special.note,
    schedule_config: special.schedule_config || [] // Expose new config
  })) || [];

  const serviceStatus = serviceStatuses.reduce(
    (acc: Record<string, { displayName: string; isEnabled: boolean; message: string | null; updatedAt: string }>, status: any) => {
      acc[status.service_code] = {
        displayName: status.display_name,
        isEnabled: status.is_enabled !== false,
        message: status.message,
        updatedAt: status.updated_at,
      };
      return acc;
    },
    {}
  );

  const serviceOverrides = serviceStatusOverrides.reduce(
    (acc: Record<string, Array<{ startDate: string; endDate: string; isEnabled: boolean; message: string | null; updatedAt: string; createdBy?: string }>>, override: any) => {
      if (!acc[override.service_code]) {
        acc[override.service_code] = [];
      }
      acc[override.service_code].push({
        startDate: override.start_date,
        endDate: override.end_date,
        isEnabled: override.is_enabled,
        message: override.message,
        updatedAt: override.updated_at,
        createdBy: override.created_by,
      });
      return acc;
    },
    {}
  );

  const sundayLunchStatus = serviceStatus['sunday_lunch'];
  const sundayOverrides = serviceOverrides['sunday_lunch'] || [];
  const sundayLunchEnabled = sundayLunchStatus ? sundayLunchStatus.isEnabled : true;

  console.log('[BusinessHours API] Sunday Lunch Status:', {
    status: sundayLunchStatus,
    enabled: sundayLunchEnabled,
    overridesCount: sundayOverrides.length
  });

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
      // Handle venues that close at or after midnight
      const isCurrentlyOpen = todaySpecial.closes <= todaySpecial.opens
        ? (currentTime >= todaySpecial.opens || currentTime < todaySpecial.closes)
        : (currentTime >= todaySpecial.opens && currentTime < todaySpecial.closes);
      
      const isKitchenOpen = todaySpecial.is_kitchen_closed ? false : 
        !!(todaySpecial.kitchen_opens && todaySpecial.kitchen_closes &&
        (todaySpecial.kitchen_closes <= todaySpecial.kitchen_opens
          ? (currentTime >= todaySpecial.kitchen_opens || currentTime < todaySpecial.kitchen_closes)
          : (currentTime >= todaySpecial.kitchen_opens && currentTime < todaySpecial.kitchen_closes)));

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
      // Handle venues that close at or after midnight
      const isCurrentlyOpen = todayHours.closes <= todayHours.opens
        ? (currentTime >= todayHours.opens || currentTime < todayHours.closes)
        : (currentTime >= todayHours.opens && currentTime < todayHours.closes);
      
      let isKitchenOpen = false;
      if (todayHours.kitchen_opens && todayHours.kitchen_closes) {
        isKitchenOpen = todayHours.kitchen_closes <= todayHours.kitchen_opens
          ? (currentTime >= todayHours.kitchen_opens || currentTime < todayHours.kitchen_closes)
          : (currentTime >= todayHours.kitchen_opens && currentTime < todayHours.kitchen_closes);
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
  const todaysSundayOverride = sundayOverrides.find(
    (override: any) =>
      override.startDate <= todayDate && override.endDate >= todayDate
  );
  const sundayLunchEnabledToday =
    todaysSundayOverride && typeof todaysSundayOverride.isEnabled === 'boolean'
      ? todaysSundayOverride.isEnabled
      : sundayLunchEnabled;
  const sundayLunchMessage =
    todaysSundayOverride?.message || sundayLunchStatus?.message || null;

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

  const todayConfig = todayHoursData?.schedule_config || [];
  const sundayLunchConfig = todayConfig.find((c: any) => c.booking_type === 'sunday_lunch');

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
    sundayLunch: sundayLunchConfig ? {
      enabled: sundayLunchEnabledToday,
      startsAt: sundayLunchConfig.starts_at || null,
      endsAt: sundayLunchConfig.ends_at || null,
      capacity: sundayLunchConfig.capacity || null,
      message: sundayLunchMessage,
    } : {
      enabled: sundayLunchEnabledToday,
      startsAt: null,
      endsAt: null,
      capacity: null,
      message: sundayLunchMessage,
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
  let sundaySlots = ['12:00', '12:30', '13:00', '13:30', '14:00'];
  let lastOrderTime = '14:00';

  if (sundayLunchConfig && sundayLunchConfig.starts_at && sundayLunchConfig.ends_at) {
    const start = sundayLunchConfig.starts_at.substring(0, 5);
    const end = sundayLunchConfig.ends_at.substring(0, 5);
    
    // Generate slots: start time until (end time - 60 mins)
    // Allowed last seating 1 hour before service ends
    const [endH, endM] = end.split(':').map(Number);
    const endMinutes = endH * 60 + endM;
    const lastSeatingMinutes = endMinutes - 60; 
    
    const generatedSlots = [];
    const [startH, startM] = start.split(':').map(Number);
    let currentMinutes = startH * 60 + startM;
    
    while (currentMinutes <= lastSeatingMinutes) {
        const h = Math.floor(currentMinutes / 60);
        const m = currentMinutes % 60;
        generatedSlots.push(`${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`);
        currentMinutes += 30; // 30 min interval
    }
    
    if (generatedSlots.length > 0) {
        sundaySlots = generatedSlots;
        lastOrderTime = generatedSlots[generatedSlots.length - 1];
    }
  }

  const sundayInfo = currentDay === 0
    ? {
        available: sundayLunchEnabledToday,
        slots: sundayLunchEnabledToday ? sundaySlots : [],
        bookingRequired: true,
        lastOrderTime: lastOrderTime,
        message: sundayLunchMessage,
      }
    : null;

  // Helper to find service times from config
  const findServiceTimes = (type: string, dayOfWeek: number = 5) => {
      const dayConfig = regularHours?.find(h => h.day_of_week === dayOfWeek)?.schedule_config;
      if (Array.isArray(dayConfig)) {
          const slot = dayConfig.find((s: any) => s.name.toLowerCase().includes(type) || s.booking_type.toLowerCase().includes(type));
          if (slot) return { start: `${slot.starts_at}:00`, end: `${slot.ends_at}:00` };
      }
      return null;
  };

  const lunchTimes = findServiceTimes('lunch') || { start: '12:00:00', end: '14:30:00' };
  const dinnerTimes = findServiceTimes('dinner') || { start: '17:00:00', end: '21:00:00' };

  // Build comprehensive response
  const response = {
    success: true,
    data: {
      regularHours: formattedRegularHours,
      specialHours: formattedSpecialHours,
      serviceStatus,
      serviceOverrides,
      currentStatus: {
        ...currentStatus,
        services,
      },
      today: todayInfo,
      upcomingWeek,
      patterns,
      services: {
        kitchen: {
          lunch: lunchTimes,
          dinner: dinnerTimes,
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
