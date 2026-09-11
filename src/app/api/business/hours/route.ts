import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveVersion, getBusinessHoursForDates, listVersions } from '@/lib/business-hours/effective';
import {
  describeKitchenWindows,
  resolveKitchenWindows,
} from '@/lib/business-hours/kitchen-windows';
import { calculateTimeUntil, kitchenServiceAt, resolveOpenNow } from '@/lib/business-hours/open-now';
import { createApiResponse, createErrorResponse } from '@/lib/api/auth';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { getLocalIsoDateDaysAhead, isValidIsoDate, shiftIsoDate, toLocalIsoDate } from '@/lib/dateUtils';

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export async function GET(request: NextRequest) {
  try {
    // This endpoint can be public for SEO purposes
    const supabase = createAdminClient();

    // One instant for the whole response, so every "today" below is the same London day.
    const now = new Date();
    const todayIso = toLocalIsoDate(now);
    const yesterdayIso = shiftIsoDate(todayIso, -1) as string;

    // `?date=` asks "what are the hours on this date". Without it the answer is
    // "today", which is what every existing caller means. The SHAPE is identical
    // either way: a seven-day regularHours object, resolved to the version in
    // force on that date. The website needs this because a customer can book up
    // to twelve months out, and until now it read every future date off this
    // week's hours.
    const requestedDate = request.nextUrl.searchParams.get('date');
    if (requestedDate !== null && !isValidIsoDate(requestedDate)) {
      return createErrorResponse('date must be a real calendar date in YYYY-MM-DD form', 'VALIDATION_ERROR', 400);
    }
    const effectiveDate = requestedDate ?? todayIso;

    const activeVersion = await getActiveVersion(effectiveDate, supabase);
    if (!activeVersion) {
      console.error('No published business-hours version covers', effectiveDate);
      return createErrorResponse('Failed to fetch business hours', 'DATABASE_ERROR', 500);
    }

    const { data: regularHours, error: hoursError } = await supabase
      .from('business_hours')
      .select('*')
      .eq('version_id', activeVersion.id)
      .order('day_of_week', { ascending: true });

    if (hoursError) {
      console.error('Failed to fetch business hours:', hoursError);
      return createErrorResponse('Failed to fetch business hours', 'DATABASE_ERROR', 500);
    }

    // Get special hours for the next 90 days, and yesterday's: from midnight until an
    // after-midnight close, yesterday's hours are the ones in force. Yesterday's row is
    // only used for that, never returned in specialHours.
    let specialHours = [];
    let yesterdaySpecial;
    try {
      const { data, error } = await supabase
        .from('special_hours')
        .select('*')
        .gte('date', yesterdayIso)
        .lte('date', getLocalIsoDateDaysAhead(90))
        .order('date', { ascending: true });

      if (error) {
        console.error('Special hours query failed:', error);
        // Continue with empty special hours instead of failing
      } else {
        const rows = data || [];
        yesterdaySpecial = rows.find(special => special.date === yesterdayIso);
        specialHours = rows.filter(special => special.date >= todayIso);
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
        .gte('end_date', format(now, 'yyyy-MM-dd'))
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
    const todayStr = format(now, 'yyyy-MM-dd');
    const { data: todayEvents, error: eventsError } = await supabase
      .from('events')
      .select('id, name, date, time, capacity')
      .eq('date', todayStr)
      .order('time', { ascending: true });

    if (eventsError) {
      console.error("Today's events query failed:", eventsError);
    }

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
    // A full-day closure was signalled by `status: 'closed'` alone. Public clients merge the
    // special entry over the regular one for the day and then read `is_closed` off whichever
    // wins, so on a day the pub is shut all day they read `undefined`, decided we were open,
    // and rendered blank opening times instead of "Closed". Every other field here already
    // mirrors the regularHours shape; this one was the gap. `status` is unchanged, so clients
    // reading either signal stay correct.
    is_closed: special.is_closed ?? false,
    is_kitchen_closed: special.is_kitchen_closed ?? false,
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

  // Calculate current status in London timezone
  const timeZone = 'Europe/London';
  const nowInLondon = toZonedTime(now, timeZone);
  const currentDay = nowInLondon.getDay();
  const currentTime = format(nowInLondon, 'HH:mm:ss');
  const currentDayName = DAY_NAMES[currentDay];

  // Regular hours for yesterday and the coming week, each date through the version in
  // force on it. Not `regularHours`, which follows `?date=` rather than today, and
  // which would give the wrong hours either side of a scheduled change.
  const upcomingDates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const checkDate = new Date(nowInLondon);
    checkDate.setDate(checkDate.getDate() + i);
    upcomingDates.push(format(checkDate, 'yyyy-MM-dd'));
  }
  const resolvedHours = await getBusinessHoursForDates([yesterdayIso, ...upcomingDates], supabase);

  // Check if today has special hours
  const todaySpecial = specialHours?.find(s => s.date === todayIso);
  const todayHoursData = todaySpecial || resolvedHours.get(todayIso);

  // Open now comes from the London trading day in force, not from today's row alone.
  // A close after midnight is stored earlier than the opening time (New Year's Eve is
  // 12:00 to 01:00), so from midnight until that close yesterday's hours still apply,
  // and today's own row only opens at its opening time.
  const openNow = resolveOpenNow(now, {
    today: todayHoursData,
    yesterday: yesterdaySpecial || resolvedHours.get(yesterdayIso),
  });

  // The kitchen service being served now, on that same trading day. Read the day's
  // sittings, not the kitchen bounds: on a split day the bounds span the gap between
  // services, which reported the kitchen open while the booking engine was refusing
  // food bookings at the same minute.
  const activeKitchenService = openNow.window
    ? kitchenServiceAt(resolveKitchenWindows(openNow.hours), openNow.tradingDate, now)
    : null;

  let currentStatus: any = {
    isOpen: false,
    kitchenOpen: false,
    closesIn: null,
    opensIn: null,
  };

  if (openNow.window) {
    currentStatus = {
      isOpen: openNow.isOpen,
      kitchenOpen: !!activeKitchenService,
      closesIn: openNow.isOpen ? calculateTimeUntil(now, openNow.window.closesAt) : null,
      opensIn: !openNow.isOpen && now < openNow.window.opensAt
        ? calculateTimeUntil(now, openNow.window.opensAt)
        : null,
      currentTime,
      timestamp: nowInLondon.toISOString(),
    };
  }

  // Calculate today's information. It describes the calendar day, so in the small
  // hours after a late close it already shows today while currentStatus above still
  // reports the night before.
  const todayKitchenWindows = resolveKitchenWindows(todayHoursData);
  const todaysSundayOverride = sundayOverrides.find(
    (override: any) =>
      override.startDate <= todayIso && override.endDate >= todayIso
  );
  const sundayLunchEnabledToday =
    todaysSundayOverride && typeof todaysSundayOverride.isEnabled === 'boolean'
      ? todaysSundayOverride.isEnabled
      : sundayLunchEnabled;
  const sundayLunchMessage =
    todaysSundayOverride?.message || sundayLunchStatus?.message || null;

  const todayInfo = {
    date: todayIso,
    dayName: currentDayName,
    // Every sitting, so a split day reads "Kitchen 12:00 - 15:00, 16:00 - 21:00"
    // rather than claiming one unbroken service across the afternoon closure.
    summary: todayHoursData?.is_closed ? 'Closed' :
      `Open ${todayHoursData?.opens || 'N/A'} - ${todayHoursData?.closes || 'N/A'}` +
      (todayKitchenWindows.length > 0
        ? `, Kitchen ${describeKitchenWindows(todayKitchenWindows)}`
        : ''),
    isSpecialHours: !!todaySpecial,
    events: todayEvents?.map(e => ({
      title: e.name,
      time: e.time,
      affectsCapacity: !!e.capacity
    })) || [],
  };

  // Published schedules whose start date has not yet arrived, with their hours,
  // so a consumer can show the change in advance without a second round trip.
  const allVersions = await listVersions(supabase);
  const futureVersions = allVersions
    .filter((v) => v.status === 'published' && v.effective_from > effectiveDate)
    .sort((a, b) => a.effective_from.localeCompare(b.effective_from));

  const upcomingVersions = await Promise.all(
    futureVersions.map(async (version) => {
      const { data: versionRows } = await supabase
        .from('business_hours')
        .select('*')
        .eq('version_id', version.id)
        .order('day_of_week', { ascending: true });

      return {
        effectiveFrom: version.effective_from,
        label: version.label,
        hours: (versionRows ?? []).reduce((acc: any, hour: any) => {
          acc[DAY_NAMES[hour.day_of_week]] = {
            opens: hour.opens,
            closes: hour.closes,
            kitchen: hour.is_kitchen_closed
              ? null
              : hour.kitchen_opens && hour.kitchen_closes
                ? { opens: hour.kitchen_opens, closes: hour.kitchen_closes }
                : null,
            is_closed: hour.is_closed,
            is_kitchen_closed: hour.is_kitchen_closed,
            schedule_config: hour.schedule_config || [],
          };
          return acc;
        }, {}),
      };
    }),
  );

  // Generate upcoming week overview, from the hours resolved per date above.
  const upcomingWeek = [];
  for (let i = 0; i < 7; i++) {
    const checkDate = new Date(nowInLondon);
    checkDate.setDate(checkDate.getDate() + i);
    const checkDateStr = upcomingDates[i];
    const checkDayOfWeek = checkDate.getDay();
    const checkDayName = DAY_NAMES[checkDayOfWeek];

    const specialDay = specialHours?.find(s => s.date === checkDateStr);
    const regularDay = resolvedHours.get(checkDateStr);
    
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
  // Sunday food window: post-launch (Spec §6, §8.3 Task 4.4) the
  // schedule_config entry uses booking_type='food' (slot_type 'sunday_food').
  // Legacy data still uses booking_type='sunday_lunch'. Accept either so the
  // API keeps returning a usable Sunday window during the migration.
  const sundayLunchConfig = todayConfig.find(
    (c: any) =>
      c.booking_type === 'sunday_lunch' ||
      c.slot_type === 'sunday_food' ||
      (currentDay === 0 && c.booking_type === 'food'),
  );

  // Calculate service information
  const services = {
    venue: {
      open: currentStatus.isOpen,
      closesIn: currentStatus.closesIn,
    },
    kitchen: {
      open: currentStatus.kitchenOpen,
      // Counts down to the end of the sitting being served, not to the end of
      // the day. On a split day the latter promised food for hours after the
      // kitchen had actually stopped.
      closesIn: currentStatus.kitchenOpen && activeKitchenService
        ? calculateTimeUntil(now, activeKitchenService.closesAt)
        : null,
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

  // Sunday food info — fallbacks reflect the new 13:00–18:00 service window
  // (Spec §6, §8.3 Task 4.4). The DB-driven config above will overwrite these
  // when present. Last seating is 1 hour before service ends, i.e. 17:00 for
  // an 18:00 close.
  let sundaySlots = ['13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00'];
  let lastOrderTime = '17:00';

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

  // Summarise the venue's named kitchen services from schedule_config.
  // This previously read Friday alone (a hardcoded dayOfWeek default) and fell
  // back to a hardcoded 12:00-14:30 lunch, so it advertised a lunch service even
  // when no day had one. Scan every configured day instead, and report null
  // rather than inventing a window the kitchen does not work.
  const findServiceTimes = (type: string) => {
      for (const day of regularHours ?? []) {
          const dayConfig = day?.schedule_config;
          if (!Array.isArray(dayConfig)) continue;

          const slot = dayConfig.find((s: any) => {
              const bookingType = typeof s?.booking_type === 'string' ? s.booking_type.toLowerCase() : '';
              // The Sunday roast has its own services.kitchen.sundayLunch field.
              // Skip it here, or 'sunday_lunch'.includes('lunch') would report the
              // roast window as the venue's regular lunch service.
              if (bookingType === 'sunday_lunch') return false;

              const name = typeof s?.name === 'string' ? s.name.toLowerCase() : '';
              return name.includes(type) || bookingType.includes(type);
          });

          if (slot?.starts_at && slot?.ends_at) {
              return { start: `${slot.starts_at}:00`, end: `${slot.ends_at}:00` };
          }
      }
      return null;
  };

  const lunchTimes = findServiceTimes('lunch');
  const dinnerTimes = findServiceTimes('dinner');

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
        // Was a hardcoded placeholder. Now the real scheduled changes, so the
        // website can say "our hours change on 1 September" instead of nothing.
        seasonalChanges: {
          upcoming: upcomingVersions.map((v) => ({
            effectiveFrom: v.effectiveFrom,
            label: v.label,
          })),
        },
      },
      // Every published change that has not yet started, oldest first. An array
      // rather than a single field: more than one can be scheduled at a time.
      upcomingVersions,
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

export async function OPTIONS(request: NextRequest) {
  return createApiResponse({}, 200);
}
