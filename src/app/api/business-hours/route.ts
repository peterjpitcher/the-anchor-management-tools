import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getActiveVersion, getBusinessHoursForDates } from '@/lib/business-hours/effective'
import { resolveOpenNow } from '@/lib/business-hours/open-now'
import { shiftIsoDate, toLocalIsoDate } from '@/lib/dateUtils'
import { format, addDays, startOfDay } from 'date-fns'
import { toZonedTime } from 'date-fns-tz'

const TIMEZONE = 'Europe/London'

type TimeWindow = {
  opens: string | null
  closes: string | null
  kitchen_closes: string | null
  is_closed: boolean
}

export async function GET(_request: NextRequest) {
  try {
    const supabase = createAdminClient()

    // One instant for the whole response, so every "today" below is the same London day.
    const now = new Date()
    const todayIso = toLocalIsoDate(now)
    const yesterdayIso = shiftIsoDate(todayIso, -1) as string

    // The version in force today, not every row: selecting the whole table would
    // mix versions together once a future schedule has been published.
    const activeVersion = await getActiveVersion(todayIso, supabase)
    if (!activeVersion) {
      return NextResponse.json({ error: 'Failed to fetch business hours' }, { status: 500 })
    }

    const { data: businessHours, error: hoursError } = await supabase
      .from('business_hours')
      .select('day_of_week, opens, closes, kitchen_opens, kitchen_closes, is_closed')
      .eq('version_id', activeVersion.id)
      .order('day_of_week', { ascending: true })

    if (hoursError) {
      return NextResponse.json({ error: 'Failed to fetch business hours' }, { status: 500 })
    }

    const londonNow = toZonedTime(now, TIMEZONE)
    const today = startOfDay(londonNow)
    const thirtyDaysFromNow = addDays(today, 30)

    // Yesterday's row as well: from midnight until an after-midnight close, yesterday's
    // hours are the ones in force. It is only used for that, never returned below.
    const { data: specialRows, error: specialError } = await supabase
      .from('special_hours')
      .select('date, opens, closes, kitchen_opens, kitchen_closes, is_closed, is_kitchen_closed, schedule_config')
      .gte('date', yesterdayIso)
      .lte('date', format(thirtyDaysFromNow, 'yyyy-MM-dd'))
      .order('date', { ascending: true })

    if (specialError) {
      return NextResponse.json({ error: 'Failed to fetch special hours' }, { status: 500 })
    }

    const currentDay = londonNow.getDay()
    const currentDate = format(londonNow, 'yyyy-MM-dd')

    const specialHours = (specialRows ?? []).filter((entry) => entry.date >= currentDate)
    const yesterdaySpecial = (specialRows ?? []).find((entry) => entry.date === yesterdayIso)

    const todaySpecial = specialHours.find((entry) => entry.date === currentDate)
    const todayRegular = businessHours?.find((entry) => entry.day_of_week === currentDay)

    const todayWindow: TimeWindow = todaySpecial
      ? {
          opens: todaySpecial.opens,
          closes: todaySpecial.closes,
          kitchen_closes: todaySpecial.kitchen_closes,
          is_closed: Boolean(todaySpecial.is_closed),
        }
      : {
          opens: todayRegular?.opens ?? null,
          closes: todayRegular?.closes ?? null,
          kitchen_closes: todayRegular?.kitchen_closes ?? null,
          is_closed: Boolean(todayRegular?.is_closed),
        }

    // Open now comes from the London trading day in force, not from today's row alone. A
    // close after midnight is stored earlier than the opening time (New Year's Eve is 12:00
    // to 01:00), so from midnight until that close yesterday's hours still apply. Yesterday's
    // regular row is resolved through the version in force yesterday, which is not today's
    // on the day a new schedule starts.
    const yesterdayHours =
      yesterdaySpecial ?? (await getBusinessHoursForDates([yesterdayIso], supabase)).get(yesterdayIso)
    const { isOpen } = resolveOpenNow(now, { today: todayWindow, yesterday: yesterdayHours })

    return NextResponse.json({
      businessHours: (businessHours || []).map((entry) => ({
        ...entry,
        open_time: entry.opens,
        close_time: entry.closes,
        kitchen_last_order_time: entry.kitchen_closes,
      })),
      specialHours: specialHours.map((entry) => ({
        ...entry,
        open_time: entry.opens,
        close_time: entry.closes,
        kitchen_last_order_time: entry.kitchen_closes,
      })),
      currentStatus: {
        isOpen,
        currentTime: format(londonNow, 'HH:mm'),
        currentDate,
        currentDay,
        // The calendar day's hours. In the small hours after a late close these already
        // show today while isOpen above still reports the night before.
        todayHours: todayWindow.is_closed
          ? { is_closed: true }
          : {
              open_time: todayWindow.opens,
              close_time: todayWindow.closes,
              kitchen_last_order_time: todayWindow.kitchen_closes,
            },
      },
      kitchenHours: (businessHours || []).map((entry) => ({
        day_of_week: entry.day_of_week,
        kitchen_open_time: entry.kitchen_opens,
        kitchen_close_time: entry.kitchen_closes || entry.closes,
        is_closed: entry.is_closed,
      })),
    })
  } catch (error) {
    console.error('Business hours API error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function OPTIONS(_request: NextRequest) {
  return new NextResponse(null, { status: 200 })
}
