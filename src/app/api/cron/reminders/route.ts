import { NextResponse } from 'next/server'
import { sendEventReminders } from '@/app/actions/sms'
import { processScheduledEventReminders } from '@/app/actions/sms-event-reminders'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(request: Request) {
  try {
    // Verify the request is from a trusted source (e.g., Vercel Cron)
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET
    
    // In production, require authentication
    if (process.env.NODE_ENV === 'production' && (!cronSecret || authHeader !== `Bearer ${cronSecret}`)) {
      console.log('Unauthorized request - invalid CRON_SECRET')
      return new NextResponse('Unauthorized', { status: 401 })
    }

    console.log('Starting reminder check...')

    // Process new scheduled reminders from booking_reminders table
    const scheduledResult = await processScheduledEventReminders()
    console.log('Scheduled reminders processed:', scheduledResult)

    // Also run legacy reminders for backward compatibility
    // This handles any bookings that don't have entries in booking_reminders yet
    await sendEventReminders()
    
    console.log('Reminder check completed successfully')
    return new NextResponse(
      JSON.stringify({
        success: true,
        scheduled: scheduledResult,
        message: 'Reminders processed successfully'
      }), 
      { 
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    )
  } catch (error) {
    console.error('Error processing reminders:', error)
    // Return the error message in the response for debugging
    return new NextResponse(`Internal Server Error: ${error instanceof Error ? error.message : 'Unknown error'}`, { status: 500 })
  }
} 