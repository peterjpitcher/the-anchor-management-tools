import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code: shortCode } = await params;
    
    if (!shortCode) {
      return NextResponse.redirect('https://www.the-anchor.pub');
    }
    
    // Use service role key to bypass RLS
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Missing Supabase configuration');
      return NextResponse.redirect('https://www.the-anchor.pub');
    }
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Get the short link directly
    const { data: link, error } = await supabase
      .from('short_links')
      .select('*')
      .eq('short_code', shortCode)
      .single();
    
    if (error || !link) {
      console.error('Short link not found:', shortCode, error?.message || 'No link found');
      // Redirect to the-anchor.pub for deleted or non-existent links
      return NextResponse.redirect('https://www.the-anchor.pub');
    }
    
    // Check if expired
    if (link.expires_at && new Date(link.expires_at) < new Date()) {
      console.error('Short link expired:', shortCode);
      return NextResponse.redirect('https://www.the-anchor.pub');
    }
    
    // Track the click asynchronously (don't wait for it)
    Promise.resolve().then(async () => {
      try {
        await supabase
          .from('short_link_clicks')
          .insert({
            short_link_id: link.id,
            user_agent: request.headers.get('user-agent'),
            referrer: request.headers.get('referer'),
            ip_address: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip')
          });
          
        await supabase
          .from('short_links')
          .update({
            click_count: (link.click_count || 0) + 1,
            last_clicked_at: new Date().toISOString()
          })
          .eq('id', link.id);
      } catch (err) {
        console.error('Error tracking click:', err);
      }
    });
    
    // Redirect immediately to the destination URL
    return NextResponse.redirect(link.destination_url);
  } catch (error) {
    console.error('Redirect error:', error);
    return NextResponse.redirect('https://www.the-anchor.pub');
  }
}