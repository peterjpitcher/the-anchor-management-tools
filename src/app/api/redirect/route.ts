import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  // Check if this is the vip-club.uk domain
  const host = request.headers.get('host');
  if (host?.includes('vip-club.uk')) {
    // Redirect to The Anchor pub website
    return NextResponse.redirect('https://www.the-anchor.pub');
  }
  
  // Otherwise just redirect to main site
  return NextResponse.redirect('https://management.orangejelly.co.uk');
}