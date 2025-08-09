#!/usr/bin/env tsx
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

// Load environment variables
config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const appUrl = process.env.NEXT_PUBLIC_APP_URL!;

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function investigatePaymentURLIssue() {
  console.log('🔍 Payment URL Investigation Report');
  console.log('=' .repeat(60));
  console.log(`Report Time: ${new Date().toISOString()}\n`);
  
  try {
    // 1. Check recent Sunday lunch bookings and their URLs
    console.log('📋 1. RECENT SUNDAY LUNCH BOOKINGS & URLS');
    console.log('-'.repeat(40));
    
    const { data: bookings } = await supabase
      .from('table_bookings')
      .select(`
        id,
        booking_reference,
        booking_type,
        status,
        created_at,
        customer:customers(
          first_name,
          last_name,
          mobile_number
        )
      `)
      .eq('booking_type', 'sunday_lunch')
      .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: false })
      .limit(5);

    if (bookings && bookings.length > 0) {
      console.log(`Found ${bookings.length} recent Sunday lunch bookings:\n`);
      
      for (const booking of bookings) {
        console.log(`📍 Booking: ${booking.booking_reference}`);
        console.log(`   ID: ${booking.id}`);
        console.log(`   Status: ${booking.status}`);
        console.log(`   Customer: ${booking.customer?.first_name} ${booking.customer?.last_name}`);
        
        // Show different URL formats
        console.log('\n   URL Formats:');
        console.log(`   ❌ Current (broken): ${appUrl}/table-bookings/${booking.id}/payment`);
        console.log(`   ✅ Should be: ${appUrl}/table-booking/${booking.booking_reference}/payment`);
        console.log(`   📱 SMS sends: /table-bookings/${booking.id}/payment`);
        
        // Check if any messages were sent with this URL
        if (booking.customer?.mobile_number) {
          const { data: messages } = await supabase
            .from('messages')
            .select('body, created_at')
            .or(`body.like.%${booking.id}%,body.like.%${booking.booking_reference}%`)
            .eq('customer_id', booking.customer.id)
            .limit(2);
            
          if (messages && messages.length > 0) {
            console.log('\n   📱 SMS Messages sent:');
            messages.forEach(msg => {
              // Extract URL from message if present
              const urlMatch = msg.body.match(/https?:\/\/[^\s]+/);
              if (urlMatch) {
                console.log(`      URL in SMS: ${urlMatch[0]}`);
              }
            });
          }
        }
        console.log('');
      }
    }

    // 2. Check available routes
    console.log('\n🗺️ 2. ROUTE STRUCTURE ANALYSIS');
    console.log('-'.repeat(40));
    console.log('Current route structure:');
    console.log('  ✅ /table-booking/[reference]/payment/page.tsx (exists)');
    console.log('  ❌ /table-bookings/[id]/payment/page.tsx (does NOT exist)');
    console.log('\nRedirect after booking creation:');
    console.log('  Line 306 in new/page.tsx: router.push(`/table-bookings/${result.data.id}/payment`)');
    console.log('  Should be: router.push(`/table-booking/${result.data.booking_reference}/payment`)');

    // 3. Check short links
    console.log('\n🔗 3. SHORT LINK ANALYSIS');
    console.log('-'.repeat(40));
    
    const { data: shortLinks } = await supabase
      .from('short_links')
      .select('*')
      .or('target_url.like.%table-booking%,target_url.like.%payment%')
      .order('created_at', { ascending: false })
      .limit(5);

    if (shortLinks && shortLinks.length > 0) {
      console.log(`Found ${shortLinks.length} payment-related short links:`);
      shortLinks.forEach(link => {
        console.log(`  - Code: ${link.code}`);
        console.log(`    Target: ${link.target_url}`);
        console.log(`    Created: ${new Date(link.created_at).toLocaleDateString()}`);
      });
    } else {
      console.log('❌ No short links found for payment URLs');
      console.log('   Short links are NOT being created for payment URLs');
    }

    // 4. Analysis
    console.log('\n📊 4. ROOT CAUSE ANALYSIS');
    console.log('-'.repeat(40));
    console.log('ISSUE 1: URL Mismatch');
    console.log('  - Code generates: /table-bookings/{id}/payment');
    console.log('  - Route expects: /table-booking/{reference}/payment');
    console.log('  - Note: "bookings" (plural) vs "booking" (singular)');
    console.log('  - Note: {id} (UUID) vs {reference} (e.g., TB-2025-1234)');
    
    console.log('\nISSUE 2: No Link Shortening');
    console.log('  - Payment URLs are sent as full URLs in SMS');
    console.log('  - No createShortLink() calls for payment URLs');
    console.log('  - Long URLs use up SMS character limit');
    
    console.log('\nISSUE 3: Multiple Places to Fix');
    console.log('  - new/page.tsx line 306 (redirect after creation)');
    console.log('  - table-bookings.ts line 457 (immediate SMS)');
    console.log('  - table-booking-sms.ts line 522 (queued SMS)');
    
    // 5. Recommendations
    console.log('\n💡 5. RECOMMENDED FIXES');
    console.log('-'.repeat(40));
    console.log('Option A: Fix URLs to match existing route');
    console.log('  1. Change new/page.tsx to use booking_reference');
    console.log('  2. Update SMS functions to use correct URL format');
    console.log('  3. Add link shortening before sending SMS');
    
    console.log('\nOption B: Create missing route (easier)');
    console.log('  1. Create /table-bookings/[id]/payment/page.tsx');
    console.log('  2. Make it fetch booking by ID and redirect to reference URL');
    console.log('  3. Still add link shortening for SMS');
    
    console.log('\nExample shortening implementation:');
    console.log('  const longUrl = `/table-booking/${booking.booking_reference}/payment`;');
    console.log('  const { data: shortLink } = await createShortLink(longUrl, "payment");');
    console.log('  const paymentUrl = `${appUrl}/s/${shortLink.code}`;');

  } catch (error) {
    console.error('❌ Investigation error:', error);
  }
}

// Run the investigation
investigatePaymentURLIssue();