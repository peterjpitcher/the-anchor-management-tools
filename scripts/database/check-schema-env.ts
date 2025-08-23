import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing required environment variables');
  process.exit(1);
}

async function checkCurrentSchema() {
  console.log('🔍 Checking Current Database Schema...\n');
  
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  // Check events table columns
  console.log('📊 Events Table Schema:');
  
  // Try to query specific fields
  const { error: imageUrlError } = await supabase
    .from('events')
    .select('image_url')
    .limit(1);
    
  const { error: heroImageError } = await supabase
    .from('events')
    .select('hero_image_url')
    .limit(1);
    
  const { error: imageUrlsError } = await supabase
    .from('events')
    .select('image_urls')
    .limit(1);
    
  console.log('- image_url field:', imageUrlError ? '❌ NOT FOUND' : '✅ EXISTS');
  console.log('- hero_image_url field:', heroImageError ? '❌ NOT FOUND' : '✅ EXISTS');
  console.log('- image_urls field:', imageUrlsError ? '❌ NOT FOUND' : '✅ EXISTS');
  
  // Check for other image fields
  const { error: galleryError } = await supabase
    .from('events')
    .select('gallery_image_urls')
    .limit(1);
    
  const { error: posterError } = await supabase
    .from('events')
    .select('poster_image_url')
    .limit(1);
    
  const { error: thumbnailError } = await supabase
    .from('events')
    .select('thumbnail_image_url')
    .limit(1);
    
  console.log('- gallery_image_urls field:', galleryError ? '❌ NOT FOUND' : '✅ EXISTS');
  console.log('- poster_image_url field:', posterError ? '❌ NOT FOUND' : '✅ EXISTS');
  console.log('- thumbnail_image_url field:', thumbnailError ? '❌ NOT FOUND' : '✅ EXISTS');
  
  // Check event_categories for faqs field
  console.log('\n📂 Event Categories Schema:');
  const { error: faqsError } = await supabase
    .from('event_categories')
    .select('faqs')
    .limit(1);
    
  const { error: catImageUrlError } = await supabase
    .from('event_categories')
    .select('image_url')
    .limit(1);
    
  console.log('- faqs field:', faqsError ? '❌ NOT FOUND' : '✅ EXISTS');
  console.log('- image_url field:', catImageUrlError ? '❌ NOT FOUND' : '✅ EXISTS');
  
  // Check private_bookings fields
  console.log('\n🏢 Private Bookings Schema:');
  const { error: customerNameError } = await supabase
    .from('private_bookings')
    .select('customer_name')
    .limit(1);
    
  const { error: firstNameError } = await supabase
    .from('private_bookings')
    .select('customer_first_name')
    .limit(1);
    
  const { error: sourceError } = await supabase
    .from('private_bookings')
    .select('source')
    .limit(1);
    
  const { error: specialReqError } = await supabase
    .from('private_bookings')
    .select('special_requirements')
    .limit(1);
    
  const { error: accessibilityError } = await supabase
    .from('private_bookings')
    .select('accessibility_needs')
    .limit(1);
    
  console.log('- customer_name field:', customerNameError ? '❌ NOT FOUND' : '✅ EXISTS');
  console.log('- customer_first_name field:', firstNameError ? '❌ NOT FOUND' : '✅ EXISTS');
  console.log('- source field:', sourceError ? '❌ NOT FOUND' : '✅ EXISTS');
  console.log('- special_requirements field:', specialReqError ? '❌ NOT FOUND' : '✅ EXISTS');
  console.log('- accessibility_needs field:', accessibilityError ? '❌ NOT FOUND' : '✅ EXISTS');
  
  // Check profiles table
  console.log('\n👤 Profiles Table Schema:');
  const { error: smsNotifError } = await supabase
    .from('profiles')
    .select('sms_notifications')
    .limit(1);
    
  const { error: emailNotifError } = await supabase
    .from('profiles')
    .select('email_notifications')
    .limit(1);
    
  console.log('- sms_notifications field:', smsNotifError ? '❌ NOT FOUND' : '✅ EXISTS');
  console.log('- email_notifications field:', emailNotifError ? '❌ NOT FOUND' : '✅ EXISTS');
  
  // Check menu_items table
  console.log('\n🍽️ Menu Items Table Schema:');
  const { error: menuImageError } = await supabase
    .from('menu_items')
    .select('image_url')
    .limit(1);
    
  console.log('- image_url field:', menuImageError ? '❌ NOT FOUND' : '✅ EXISTS');
}

checkCurrentSchema().catch(console.error);