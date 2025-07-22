import { NextResponse } from 'next/server';
import { cleanupRateLimits } from '@/lib/rate-limiter';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    // Verify the request is from a trusted source (e.g., Vercel Cron)
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    
    // In production, require authentication
    if (process.env.NODE_ENV === 'production' && (!cronSecret || authHeader !== `Bearer ${cronSecret}`)) {
      console.log('Unauthorized request - invalid CRON_SECRET');
      return new NextResponse('Unauthorized', { status: 401 });
    }

    console.log('Starting rate limit cleanup...');

    // Clean up old rate limit entries
    await cleanupRateLimits();
    
    console.log('Rate limit cleanup completed successfully');
    
    return new NextResponse(
      JSON.stringify({
        success: true,
        message: 'Rate limit cleanup completed',
        timestamp: new Date().toISOString()
      }),
      { 
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    console.error('Error cleaning up rate limits:', error);
    return new NextResponse(
      `Internal Server Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      { status: 500 }
    );
  }
}