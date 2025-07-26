import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { createApiResponse, createErrorResponse } from '@/lib/api/auth';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export async function GET(_request: NextRequest) {
  // This endpoint can be public for SEO purposes
  const supabase = createAdminClient();
  
  // Get regular hours
  const { data: regularHours, error: hoursError } = await supabase
    .from('business_hours')
    .select('*')
    .order('day_of_week', { ascending: true });

  if (hoursError) {
    return createErrorResponse('Failed to fetch business hours', 'DATABASE_ERROR', 500);
  }

  // Get special hours for the next 30 days
  const today = new Date();
  const thirtyDaysFromNow = new Date();
  thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

  const { data: specialHours, error: specialError } = await supabase
    .from('special_hours')
    .select('*')
    .gte('date', today.toISOString().split('T')[0])
    .lte('date', thirtyDaysFromNow.toISOString().split('T')[0])
    .order('date', { ascending: true });

  if (specialError) {
    return createErrorResponse('Failed to fetch special hours', 'DATABASE_ERROR', 500);
  }

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

  // Format special hours
  const formattedSpecialHours = specialHours?.map(special => ({
    date: special.date,
    opens: special.opens,
    closes: special.closes,
    kitchen: special.is_kitchen_closed ? {
      is_closed: true
    } : special.kitchen_opens && special.kitchen_closes ? {
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
      };
    }
  }

  return createApiResponse({
    regularHours: formattedRegularHours,
    specialHours: formattedSpecialHours,
    currentStatus,
    timezone: 'Europe/London',
    lastUpdated: new Date().toISOString(),
  });
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