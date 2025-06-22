import { NextResponse } from 'next/server'
import { sendEventReminders } from '@/app/actions/sms'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(request: Request) {
  try {
    // Verify the request is from a trusted source (e.g., Vercel Cron)
    const authHeader = request.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET_KEY
    
    // In production, require authentication
    if (process.env.NODE_ENV === 'production' && (!cronSecret || authHeader !== `Bearer ${cronSecret}`)) {
      console.log('Unauthorized request - invalid CRON_SECRET_KEY')
      return new NextResponse('Unauthorized', { status: 401 })
    }

    console.log('Starting reminder check...')

    // TEMPORARY: Use legacy approach until the timing function is fixed in production
    // The new timing-based approach has a bug in the SQL function that needs migration
    await sendEventReminders()
    console.log('Reminder check completed using legacy approach')
    
    // TODO: Re-enable timing-based approach after running migration 20250620_fix_reminder_timing_function.sql
    // try {
    //   await sendEventRemindersWithTiming()
    //   console.log('Reminder check completed using timing-based approach')
    // } catch (timingError) {
    //   console.error('Timing-based reminders failed, falling back to legacy approach:', timingError)
    //   await sendEventReminders()
    //   console.log('Reminder check completed using legacy approach')
    // }
    return new NextResponse('Reminders processed successfully', { status: 200 })
  } catch (error) {
    console.error('Error processing reminders:', error)
    // Return the error message in the response for debugging
    return new NextResponse(`Internal Server Error: ${error instanceof Error ? error.message : 'Unknown error'}`, { status: 500 })
  }
} 