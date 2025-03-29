import { NextResponse } from 'next/server'
import { sendEventReminders } from '@/app/actions/sms'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(request: Request) {
  try {
    // Verify the request is from a trusted source (e.g., Vercel Cron)
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${process.env.CRON_SECRET_KEY}`) {
      console.log('Unauthorized request - invalid CRON_SECRET_KEY')
      return new NextResponse('Unauthorized', { status: 401 })
    }

    console.log('Starting reminder check...')
    console.log('Environment check:', {
      hasTwilioSid: !!process.env.TWILIO_ACCOUNT_SID,
      hasTwilioToken: !!process.env.TWILIO_AUTH_TOKEN,
      hasTwilioPhone: !!process.env.TWILIO_PHONE_NUMBER,
      hasSupabaseUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
      hasSupabaseKey: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    })

    await sendEventReminders()
    console.log('Reminder check completed')
    return new NextResponse('Reminders processed successfully', { status: 200 })
  } catch (error) {
    console.error('Error processing reminders:', error)
    // Return the error message in the response for debugging
    return new NextResponse(`Internal Server Error: ${error instanceof Error ? error.message : 'Unknown error'}`, { status: 500 })
  }
} 