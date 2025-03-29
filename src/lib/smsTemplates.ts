export const smsTemplates = {
  bookingConfirmation: (params: {
    firstName: string
    seats: number
    eventName: string
    eventDate: Date
    eventTime: string
  }) => {
    const formattedDate = new Date(params.eventDate).toLocaleDateString('en-GB', {
      month: 'long',
      day: 'numeric',
    })
    return `Hi ${params.firstName}, your booking for ${params.seats} people for our ${params.eventName} on ${formattedDate} at ${params.eventTime} is confirmed! See you then. If you've got any questions, WhatsApp/Call 01753682707`
  },

  reminderOnly: (params: {
    firstName: string
    eventName: string
    eventDate: Date
    eventTime: string
  }) => {
    const formattedDate = new Date(params.eventDate).toLocaleDateString('en-GB', {
      month: 'long',
      day: 'numeric',
    })
    return `Hi ${params.firstName}, don't forget, we've got our ${params.eventName} on ${formattedDate} at ${params.eventTime}! If you'd like to book seats, WhatsApp/Call 01753682707`
  },

  dayBeforeReminder: (params: {
    firstName: string
    eventName: string
    eventTime: string
    seats?: number
  }) => {
    const seatInfo = params.seats
      ? `and you have ${params.seats} seats booked`
      : ''
    return `Hi ${params.firstName}, just a reminder that our ${params.eventName} is tomorrow at ${params.eventTime} ${seatInfo}. If you've got any questions, WhatsApp/Call 01753682707`
  },

  weekBeforeReminder: (params: {
    firstName: string
    eventName: string
    eventDate: Date
    eventTime: string
    seats?: number
  }) => {
    const formattedDate = new Date(params.eventDate).toLocaleDateString('en-GB', {
      month: 'long',
      day: 'numeric',
    })
    const seatInfo = params.seats
      ? `and you have ${params.seats} seats booked`
      : ''
    return `Hi ${params.firstName}, just a reminder that our ${params.eventName} is next week on ${formattedDate} at ${params.eventTime} ${seatInfo}. If you've got any questions, WhatsApp/Call 01753682707`
  },
} 