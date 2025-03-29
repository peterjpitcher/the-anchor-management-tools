import { NextResponse } from 'next/server'
import { sendEventReminders } from '@/app/actions/sms'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(request: Request) {
  try {
    // Verify the request is from a trusted source (e.g., Vercel Cron)
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${process.env.CRON_SECRET_KEY}`) {
      return new NextResponse('Unauthorized', { status: 401 })
    }

    await sendEventReminders()
    return new NextResponse('Reminders processed successfully', { status: 200 })
  } catch (error) {
    console.error('Error processing reminders:', error)
    return new NextResponse('Internal Server Error', { status: 500 })
  }
} 