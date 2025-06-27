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

    // Use the proven legacy approach for sending event reminders
    await sendEventReminders()
    console.log('Reminder check completed successfully')
    return new NextResponse('Reminders processed successfully', { status: 200 })
  } catch (error) {
    console.error('Error processing reminders:', error)
    // Return the error message in the response for debugging
    return new NextResponse(`Internal Server Error: ${error instanceof Error ? error.message : 'Unknown error'}`, { status: 500 })
  }
} 