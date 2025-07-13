import { NextRequest, NextResponse } from 'next/server';
import { resolveShortLink } from '@/app/actions/short-links';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code: shortCode } = await params;
    
    if (!shortCode) {
      return NextResponse.redirect('https://management.orangejelly.co.uk/loyalty');
    }
    
    // Resolve the short link
    const result = await resolveShortLink({ short_code: shortCode });
    
    if (result.error || !result.data) {
      // Redirect to a default page if link not found
      return NextResponse.redirect('https://management.orangejelly.co.uk/loyalty');
    }
    
    // Redirect to the destination URL
    return NextResponse.redirect(result.data.destination_url);
  } catch (error) {
    console.error('Redirect error:', error);
    return NextResponse.redirect('https://management.orangejelly.co.uk/loyalty');
  }
}