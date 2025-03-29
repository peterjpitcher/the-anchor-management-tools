'use server'

import { createClient } from '@supabase/supabase-js'
import twilio from 'twilio'
import { smsTemplates } from '@/lib/smsTemplates'

export async function sendBookingConfirmation(bookingId: string) {
  try {
    // Skip SMS if Twilio credentials are not configured
    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_PHONE_NUMBER) {
      console.log('Skipping SMS - Twilio not configured')
      return
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

    // Get booking details with customer and event info
    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .select('*, customer:customers(first_name, last_name, mobile_number), event:events(name, date, time)')
      .eq('id', bookingId)
      .single()

    if (bookingError || !booking) {
      throw new Error('Failed to fetch booking details')
    }

    // Skip if customer has no mobile number
    if (!booking.customer?.mobile_number) {
      console.log('Skipping SMS - No mobile number')
      return
    }

    const client = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    )

    const message = booking.seats
      ? smsTemplates.bookingConfirmation({
          firstName: booking.customer.first_name,
          seats: booking.seats,
          eventName: booking.event.name,
          eventDate: new Date(booking.event.date),
          eventTime: booking.event.time,
        })
      : smsTemplates.reminderOnly({
          firstName: booking.customer.first_name,
          eventName: booking.event.name,
          eventDate: new Date(booking.event.date),
          eventTime: booking.event.time,
        })

    await client.messages.create({
      body: message,
      to: booking.customer.mobile_number,
      from: process.env.TWILIO_PHONE_NUMBER,
    })

    console.log('SMS sent successfully')
  } catch (error) {
    console.error('Failed to send SMS:', error)
    // Don't throw the error - we don't want to block booking creation if SMS fails
  }
}

export async function sendEventReminders() {
  try {
    // Skip if Twilio credentials are not configured
    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_PHONE_NUMBER) {
      console.log('Skipping reminders - Twilio not configured:', {
        hasSid: !!process.env.TWILIO_ACCOUNT_SID,
        hasToken: !!process.env.TWILIO_AUTH_TOKEN,
        hasPhone: !!process.env.TWILIO_PHONE_NUMBER
      })
      return
    }

    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      console.log('Missing Supabase configuration')
      throw new Error('Supabase configuration missing')
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )

    const today = new Date()
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    const nextWeek = new Date(today)
    nextWeek.setDate(nextWeek.getDate() + 7)

    // Format dates for database query
    const tomorrowStr = tomorrow.toISOString().split('T')[0]
    const nextWeekStr = nextWeek.toISOString().split('T')[0]

    console.log('Checking for events on:', { tomorrowStr, nextWeekStr })
    console.log('Querying bookings with dates:', [tomorrowStr, nextWeekStr])

    // Get bookings for tomorrow and next week
    const { data: bookings, error: bookingsError } = await supabase
      .from('bookings')
      .select('*, customer:customers(first_name, last_name, mobile_number), event:events(name, date, time)')
      .in('event.date', [tomorrowStr, nextWeekStr])
      .not('customer.mobile_number', 'is', null)

    if (bookingsError) {
      console.error('Database error:', bookingsError)
      throw new Error(`Failed to fetch bookings: ${bookingsError.message}`)
    }

    if (!bookings || bookings.length === 0) {
      console.log('No reminders to send - No bookings found for dates:', { tomorrowStr, nextWeekStr })
      return
    }

    // Filter out any bookings with missing event or customer data
    const validBookings = bookings.filter(booking => {
      if (!booking.event || !booking.customer) {
        console.log('Skipping invalid booking - Missing event or customer data:', {
          bookingId: booking.id,
          hasEvent: !!booking.event,
          hasCustomer: !!booking.customer
        })
        return false
      }
      return true
    })

    if (validBookings.length === 0) {
      console.log('No valid bookings found after filtering')
      return
    }

    console.log('Found valid bookings:', validBookings.map(b => ({
      id: b.id,
      eventName: b.event.name,
      eventDate: b.event.date,
      customerName: `${b.customer.first_name} ${b.customer.last_name}`,
      mobile: b.customer.mobile_number
    })))

    const client = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    )

    // Send reminders for each booking
    for (const booking of validBookings) {
      try {
        const eventDate = new Date(booking.event.date)
        const isNextDay = eventDate.toISOString().split('T')[0] === tomorrowStr
        
        const message = isNextDay
          ? smsTemplates.dayBeforeReminder({
              firstName: booking.customer.first_name,
              eventName: booking.event.name,
              eventTime: booking.event.time,
              seats: booking.seats,
            })
          : smsTemplates.weekBeforeReminder({
              firstName: booking.customer.first_name,
              eventName: booking.event.name,
              eventDate: eventDate,
              eventTime: booking.event.time,
              seats: booking.seats,
            })

        console.log('Sending SMS to:', {
          to: booking.customer.mobile_number,
          message,
          isNextDay,
          eventName: booking.event.name,
          eventDate: booking.event.date
        })

        await client.messages.create({
          body: message,
          to: booking.customer.mobile_number,
          from: process.env.TWILIO_PHONE_NUMBER,
        })
        console.log(`Reminder sent to ${booking.customer.first_name} for ${booking.event.name}`)
      } catch (error) {
        console.error(`Failed to send reminder for booking ${booking.id}:`, error)
        // Continue with other bookings even if one fails
      }
    }
  } catch (error) {
    console.error('Failed to process reminders:', error)
    throw error
  }
} 