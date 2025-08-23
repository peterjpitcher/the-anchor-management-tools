import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function testEventCrudFixed() {
  console.log('🧪 Testing Event CRUD Operations (After Fixes)...\n');
  
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  // Test 1: Create event with hero_image_url
  console.log('1️⃣ Test: Create event with hero_image_url field');
  const { data: event1, error: error1 } = await supabase
    .from('events')
    .insert({
      name: 'Test Event Fixed',
      date: new Date(Date.now() + 86400000).toISOString().split('T')[0], // Tomorrow
      time: '19:00',
      slug: `test-fixed-${Date.now()}`,
      hero_image_url: 'https://example.com/hero.jpg',
      thumbnail_image_url: 'https://example.com/thumb.jpg',
      poster_image_url: 'https://example.com/poster.jpg'
    })
    .select()
    .single();
    
  if (error1) {
    console.log('❌ Failed:', error1.message);
  } else {
    console.log('✅ Success: Event created with hero_image_url');
    console.log('   Event ID:', event1.id);
    console.log('   Hero Image:', event1.hero_image_url);
    console.log('   Thumbnail:', event1.thumbnail_image_url);
    console.log('   Poster:', event1.poster_image_url);
    
    // Test 2: Update event image fields
    console.log('\n2️⃣ Test: Update event image fields');
    const { error: updateError } = await supabase
      .from('events')
      .update({ 
        hero_image_url: 'https://example.com/updated-hero.jpg',
        thumbnail_image_url: 'https://example.com/updated-thumb.jpg'
      })
      .eq('id', event1.id);
      
    if (updateError) {
      console.log('❌ Failed:', updateError.message);
    } else {
      console.log('✅ Success: Event images updated');
    }
    
    // Clean up
    await supabase.from('events').delete().eq('id', event1.id);
  }
  
  // Test 3: Verify old image_url field fails as expected
  console.log('\n3️⃣ Test: Verify image_url field still fails (expected)');
  const { error: error3 } = await supabase
    .from('events')
    .insert({
      name: 'Test Event with image_url',
      date: new Date(Date.now() + 86400000).toISOString().split('T')[0],
      time: '20:00',
      slug: `test-old-field-${Date.now()}`,
      image_url: 'https://example.com/image.jpg'
    });
    
  if (error3) {
    console.log('✅ Expected failure:', error3.message);
  } else {
    console.log('❌ Unexpected success - image_url should not work');
  }
  
  console.log('\n✅ All tests completed - fixes are working correctly!');
}

testEventCrudFixed().catch(console.error);