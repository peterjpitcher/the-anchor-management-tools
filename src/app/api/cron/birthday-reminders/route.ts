import { NextRequest, NextResponse } from 'next/server';
import { sendBirthdayRemindersInternal } from '@/app/actions/employee-birthdays';

export async function GET(request: NextRequest) {
  try {
    // Verify this is coming from Vercel Cron (in production)
    const authHeader = request.headers.get('authorization');
    if (process.env.NODE_ENV === 'production' && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Send birthday reminders for employees with birthdays exactly 7 days away
    const result = await sendBirthdayRemindersInternal(7);

    if (result.error) {
      console.error('Birthday reminder error:', result.error);
      return NextResponse.json(
        { error: result.error },
        { status: 500 }
      );
    }

    console.log(`Birthday reminders sent: ${result.sent} employees`);

    return NextResponse.json({
      success: true,
      sent: result.sent,
      message: result.message,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Birthday reminder cron error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}