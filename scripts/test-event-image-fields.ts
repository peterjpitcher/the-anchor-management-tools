import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function testEventImageFields() {
  console.log('🧪 Testing Event Image Field Operations...\n');
  
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  // Test 1: Try to create event with image_url
  console.log('1️⃣ Test: Create event with image_url field');
  const { data: event1, error: error1 } = await supabase
    .from('events')
    .insert({
      name: 'Test Event with image_url',
      date: new Date(Date.now() + 86400000).toISOString().split('T')[0], // Tomorrow
      time: '19:00',
      slug: `test-image-url-${Date.now()}`,
      image_url: 'https://example.com/image.jpg'
    })
    .select()
    .single();
    
  if (error1) {
    console.log('❌ Failed:', error1.message);
    console.log('   Error code:', error1.code);
  } else {
    console.log('✅ Success: Event created with image_url');
    // Clean up
    await supabase.from('events').delete().eq('id', event1.id);
  }
  
  // Test 2: Try to update event with image_url
  console.log('\n2️⃣ Test: Update event with image_url field');
  // First create an event
  const { data: testEvent, error: createError } = await supabase
    .from('events')
    .insert({
      name: 'Test Event for Update',
      date: new Date(Date.now() + 86400000).toISOString().split('T')[0],
      time: '20:00',
      slug: `test-update-${Date.now()}`
    })
    .select()
    .single();
    
  if (!createError && testEvent) {
    const { error: updateError } = await supabase
      .from('events')
      .update({ image_url: 'https://example.com/updated.jpg' })
      .eq('id', testEvent.id);
      
    if (updateError) {
      console.log('❌ Failed:', updateError.message);
      console.log('   Error code:', updateError.code);
    } else {
      console.log('✅ Success: Event updated with image_url');
    }
    
    // Clean up
    await supabase.from('events').delete().eq('id', testEvent.id);
  }
  
  // Test 3: Try using hero_image_url instead
  console.log('\n3️⃣ Test: Create event with hero_image_url field');
  const { data: event3, error: error3 } = await supabase
    .from('events')
    .insert({
      name: 'Test Event with hero_image_url',
      date: new Date(Date.now() + 86400000).toISOString().split('T')[0],
      time: '19:00',
      slug: `test-hero-image-${Date.now()}`,
      hero_image_url: 'https://example.com/hero.jpg'
    })
    .select()
    .single();
    
  if (error3) {
    console.log('❌ Failed:', error3.message);
  } else {
    console.log('✅ Success: Event created with hero_image_url');
    console.log('   Event ID:', event3.id);
    console.log('   Hero Image URL:', event3.hero_image_url);
    // Clean up
    await supabase.from('events').delete().eq('id', event3.id);
  }
  
  // Test 4: Check event_categories image_url
  console.log('\n4️⃣ Test: Create category with image_url field');
  const { data: category, error: catError } = await supabase
    .from('event_categories')
    .insert({
      name: 'Test Category',
      slug: `test-cat-${Date.now()}`,
      image_url: 'https://example.com/category.jpg'
    })
    .select()
    .single();
    
  if (catError) {
    console.log('❌ Failed:', catError.message);
    console.log('   Error code:', catError.code);
  } else {
    console.log('✅ Success: Category created with image_url');
    // Clean up
    await supabase.from('event_categories').delete().eq('id', category.id);
  }
  
  // Test 5: Query events and check field availability
  console.log('\n5️⃣ Test: Query events with different image fields');
  const { data: events, error: queryError } = await supabase
    .from('events')
    .select('id, name, hero_image_url, image_urls, gallery_image_urls')
    .limit(1);
    
  if (queryError) {
    console.log('❌ Query failed:', queryError.message);
  } else {
    console.log('✅ Query successful');
    if (events && events.length > 0) {
      console.log('   Sample event fields:');
      console.log('   - hero_image_url:', events[0].hero_image_url ? 'present' : 'null');
      console.log('   - image_urls:', events[0].image_urls ? 'present' : 'null');
      console.log('   - gallery_image_urls:', events[0].gallery_image_urls ? 'present' : 'null');
    }
  }
}

testEventImageFields().catch(console.error);