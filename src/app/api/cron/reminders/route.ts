import { NextResponse } from 'next/server'
import { processScheduledEventReminders } from '@/app/actions/sms-event-reminders'
import { authorizeCronRequest } from '@/lib/cron-auth'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(request: Request) {
  try {
    // Verify the request is from a trusted source (e.g., Vercel Cron)
    const authResult = authorizeCronRequest(request)

    if (!authResult.authorized) {
      console.log('Unauthorized reminder request', authResult.reason)
      return new NextResponse('Unauthorized', { status: 401 })
    }

    console.log('Starting reminder check (scheduled pipeline only by default)...')

    // Process new scheduled reminders from booking_reminders table (single source of truth)
    const scheduledResult = await processScheduledEventReminders()
    console.log('Scheduled reminders processed:', scheduledResult)

    // Legacy path has been removed to prevent duplicate or early sends.
    console.log('Legacy reminder sender removed — only scheduled pipeline runs')
    
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
