const { createClient } = require('@supabase/supabase-js')
const twilio = require('twilio')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
)

const fromNumber = process.env.TWILIO_PHONE_NUMBER

async function sendSMS(to, body) {
  try {
    await twilioClient.messages.create({
      body,
      to,
      from: fromNumber,
    })
    console.log(`SMS sent successfully to ${to}`)
    return true
  } catch (error) {
    console.error(`Failed to send SMS to ${to}:`, error)
    return false
  }
}

async function getBookingsForReminders() {
  const today = new Date()
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const sevenDays = new Date(today)
  sevenDays.setDate(sevenDays.getDate() + 7)

  // Format dates to match the database format (YYYY-MM-DD)
  const tomorrowStr = tomorrow.toISOString().split('T')[0]
  const sevenDaysStr = sevenDays.toISOString().split('T')[0]

  const { data, error } = await supabase
    .from('bookings')
    .select(
      `
      *,
      customer:customers(first_name, last_name, mobile_number),
      event:events(name, date, time)
    `
    )
    .or(
      `and(event.date.eq.${tomorrowStr},type.eq.24hour),and(event.date.eq.${sevenDaysStr},type.eq.7day)`
    )

  if (error) {
    console.error('Error fetching bookings:', error)
    return []
  }

  return data
}

async function main() {
  try {
    const bookings = await getBookingsForReminders()
    console.log(`Found ${bookings.length} bookings that need reminders`)

    for (const booking of bookings) {
      const { customer, event } = booking
      const eventDate = new Date(event.date)
      const isSevenDayReminder = eventDate.getTime() - Date.now() > 24 * 60 * 60 * 1000

      let message
      if (isSevenDayReminder) {
        message = `Hi ${customer.first_name}, don't forget, we've got our ${event.name} on ${new Date(event.date).toLocaleDateString()} at ${event.time}! If you'd like to book seats, WhatsApp/Call 01753682707`
      } else {
        message = `Hi ${customer.first_name}, just a reminder that you're booked for ${event.name} tomorrow at ${event.time}. We look forward to seeing you! Reply to this message if you need to make any changes. The Anchor.`
      }

      await sendSMS(customer.mobile_number, message)
    }

    console.log('Finished sending reminders')
    process.exit(0)
  } catch (error) {
    console.error('Error in main process:', error)
    process.exit(1)
  }
}

main() 