'use server'

import { Booking } from '@/types/database'
import { supabase } from '@/lib/supabase'
import twilio from 'twilio'

const accountSid = process.env.TWILIO_ACCOUNT_SID!
const authToken = process.env.TWILIO_AUTH_TOKEN!
const fromNumber = process.env.TWILIO_PHONE_NUMBER!

const twilioClient = twilio(accountSid, authToken)

export async function sendBookingConfirmation(bookingId: string) {
  try {
    // Get booking details with customer and event information
    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .select(
        `
        *,
        customer:customers(first_name, last_name, mobile_number),
        event:events(name, date, time)
      `
      )
      .eq('id', bookingId)
      .single()

    if (bookingError) throw bookingError
    if (!booking) throw new Error('Booking not found')

    const customer = booking.customer as {
      first_name: string
      last_name: string
      mobile_number: string
    }
    const event = booking.event as {
      name: string
      date: string
      time: string
    }

    // Format the message based on whether seats are included
    let message = `Hi ${customer.first_name}, your booking for ${
      event.name
    } on ${new Date(event.date).toLocaleDateString()} at ${event.time} is confirmed.`

    if (booking.seats) {
      message += ` We've reserved ${booking.seats} seat(s) for you.`
    }

    message += ' Reply to this message if you need to make any changes. The Anchor.'

    // Send the SMS
    await twilioClient.messages.create({
      body: message,
      to: customer.mobile_number,
      from: fromNumber,
    })

    return { success: true }
  } catch (error) {
    console.error('Error sending booking confirmation SMS:', error)
    return { success: false, error }
  }
} 