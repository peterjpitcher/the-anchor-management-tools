import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { format, parseISO, addDays, startOfDay, isWithinInterval } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

const TIMEZONE = 'Europe/London';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // Get regular business hours
    const { data: businessHours, error: hoursError } = await supabase
      .from('business_hours')
      .select('*')
      .order('day_of_week');
      
    if (hoursError) {
      return NextResponse.json({ error: 'Failed to fetch business hours' }, { status: 500 });
    }
    
    // Get special hours for the next 30 days
    const today = startOfDay(new Date());
    const thirtyDaysFromNow = addDays(today, 30);
    
    const { data: specialHours, error: specialError } = await supabase
      .from('business_hours_special')
      .select('*')
      .gte('date', format(today, 'yyyy-MM-dd'))
      .lte('date', format(thirtyDaysFromNow, 'yyyy-MM-dd'))
      .order('date');
      
    if (specialError) {
      return NextResponse.json({ error: 'Failed to fetch special hours' }, { status: 500 });
    }
    
    // Get current London time
    const londonTime = toZonedTime(new Date(), TIMEZONE);
    const currentDay = londonTime.getDay();
    const currentTime = format(londonTime, 'HH:mm:ss');
    const currentDate = format(londonTime, 'yyyy-MM-dd');
    
    // Check if today has special hours
    const todaySpecialHours = specialHours?.find(sh => sh.date === currentDate);
    
    let isOpen = false;
    let todayHours = null;
    let nextOpenTime = null;
    
    if (todaySpecialHours) {
      // Use special hours for today
      if (todaySpecialHours.is_closed) {
        isOpen = false;
        todayHours = { is_closed: true };
      } else {
        isOpen = currentTime >= todaySpecialHours.open_time && 
                currentTime <= todaySpecialHours.close_time;
        todayHours = {
          open_time: todaySpecialHours.open_time,
          close_time: todaySpecialHours.close_time,
          kitchen_last_order_time: todaySpecialHours.kitchen_last_order_time
        };
      }
    } else {
      // Use regular hours for today
      const regularToday = businessHours?.find(bh => bh.day_of_week === currentDay);
      if (regularToday && !regularToday.is_closed) {
        isOpen = currentTime >= regularToday.open_time && 
                currentTime <= regularToday.close_time;
        todayHours = {
          open_time: regularToday.open_time,
          close_time: regularToday.close_time,
          kitchen_last_order_time: regularToday.kitchen_last_order_time
        };
      } else {
        todayHours = { is_closed: true };
      }
    }
    
    // Calculate time until closing/opening
    let timeUntilChange = null;
    if (isOpen && todayHours && !todayHours.is_closed) {
      // Calculate time until closing
      const closingTime = parseISO(`${currentDate}T${todayHours.close_time}`);
      const minutesUntilClosing = Math.floor((closingTime.getTime() - londonTime.getTime()) / 60000);
      timeUntilChange = {
        type: 'closing',
        minutes: minutesUntilClosing,
        time: todayHours.close_time
      };
    } else {
      // Find next opening time
      for (let i = 1; i <= 7; i++) {
        const checkDate = addDays(londonTime, i);
        const checkDateStr = format(checkDate, 'yyyy-MM-dd');
        const checkDay = checkDate.getDay();
        
        // Check special hours first
        const specialDay = specialHours?.find(sh => sh.date === checkDateStr);
        if (specialDay && !specialDay.is_closed) {
          nextOpenTime = {
            date: checkDateStr,
            time: specialDay.open_time,
            dayName: format(checkDate, 'EEEE')
          };
          break;
        }
        
        // Check regular hours if no special hours
        if (!specialDay) {
          const regularDay = businessHours?.find(bh => bh.day_of_week === checkDay);
          if (regularDay && !regularDay.is_closed) {
            nextOpenTime = {
              date: checkDateStr,
              time: regularDay.open_time,
              dayName: format(checkDate, 'EEEE')
            };
            break;
          }
        }
      }
      
      if (nextOpenTime) {
        const openingDateTime = parseISO(`${nextOpenTime.date}T${nextOpenTime.time}`);
        const minutesUntilOpening = Math.floor((openingDateTime.getTime() - londonTime.getTime()) / 60000);
        timeUntilChange = {
          type: 'opening',
          minutes: minutesUntilOpening,
          time: nextOpenTime.time,
          date: nextOpenTime.date,
          dayName: nextOpenTime.dayName
        };
      }
    }
    
    return NextResponse.json({
      businessHours,
      specialHours,
      currentStatus: {
        isOpen,
        currentTime: format(londonTime, 'HH:mm'),
        currentDate,
        currentDay,
        todayHours,
        timeUntilChange
      },
      kitchenHours: businessHours?.map(bh => ({
        day_of_week: bh.day_of_week,
        kitchen_open_time: bh.open_time,
        kitchen_close_time: bh.kitchen_last_order_time || bh.close_time,
        is_closed: bh.is_closed
      }))
    });
  } catch (error) {
    console.error('Business hours API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 200 });
}