import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
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

    const { data: businessHours, error: hoursError } = await supabase
      .from('business_hours')
      .select('*')
      .order('day_of_week', { ascending: true })

    if (hoursError) {
      return NextResponse.json({ error: 'Failed to fetch business hours' }, { status: 500 })
    }

    const londonNow = toZonedTime(new Date(), TIMEZONE)
    const today = startOfDay(londonNow)
    const thirtyDaysFromNow = addDays(today, 30)

    const { data: specialHours, error: specialError } = await supabase
      .from('special_hours')
      .select('*')
      .gte('date', format(today, 'yyyy-MM-dd'))
      .lte('date', format(thirtyDaysFromNow, 'yyyy-MM-dd'))
      .order('date', { ascending: true })

    if (specialError) {
      return NextResponse.json({ error: 'Failed to fetch special hours' }, { status: 500 })
    }

    const currentDay = londonNow.getDay()
    const currentTime = format(londonNow, 'HH:mm:ss')
    const currentDate = format(londonNow, 'yyyy-MM-dd')

    const todaySpecial = specialHours?.find((entry) => entry.date === currentDate)
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

    const isOpen = isWithinWindow(currentTime, todayWindow.opens, todayWindow.closes, todayWindow.is_closed)

    return NextResponse.json({
      businessHours: (businessHours || []).map((entry) => ({
        ...entry,
        open_time: entry.opens,
        close_time: entry.closes,
        kitchen_last_order_time: entry.kitchen_closes,
      })),
      specialHours: (specialHours || []).map((entry) => ({
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

function isWithinWindow(current: string, opens: string | null, closes: string | null, isClosed: boolean): boolean {
  if (isClosed || !opens || !closes) return false
  if (closes <= opens) {
    return current >= opens || current < closes
  }
  return current >= opens && current < closes
}
