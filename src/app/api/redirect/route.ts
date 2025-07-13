import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  // Check if this is the vip-club.uk domain
  const host = request.headers.get('host');
  if (host?.includes('vip-club.uk')) {
    // Redirect to the main loyalty page
    return NextResponse.redirect('https://management.orangejelly.co.uk/loyalty');
  }
  
  // Otherwise just redirect to main site
  return NextResponse.redirect('https://management.orangejelly.co.uk');
}