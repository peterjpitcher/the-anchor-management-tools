import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  try {
    // Verify this is a cron job or authorized request
    const authHeader = request.headers.get('authorization');
    const isVercelCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
    const isDev = process.env.NODE_ENV === 'development';
    
    if (!isVercelCron && !isDev) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    console.log('[Cron] Starting service slot generation...');
    
    const supabase = createAdminClient();
    
    // Run the slot generation function
    const { data, error } = await supabase.rpc('auto_generate_weekly_slots');
    
    if (error) {
      console.error('[Cron] Error generating slots:', error);
      return NextResponse.json(
        { 
          error: 'Failed to generate slots',
          details: error.message 
        },
        { status: 500 }
      );
    }
    
    console.log('[Cron] Service slots generated:', data);
    
    // Also cleanup old slots
    const { data: cleanupData, error: cleanupError } = await supabase.rpc('cleanup_old_service_slots');
    
    if (cleanupError) {
      console.error('[Cron] Error cleaning up old slots:', cleanupError);
    } else {
      console.log(`[Cron] Cleaned up ${cleanupData} old slots`);
    }
    
    return NextResponse.json({
      success: true,
      message: 'Service slots generated successfully',
      data: {
        generation: data,
        cleanup: cleanupData
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('[Cron] Unexpected error:', error);
    return NextResponse.json(
      { 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

// Allow POST for manual triggering from admin panel
export async function POST(request: NextRequest) {
  return GET(request);
}