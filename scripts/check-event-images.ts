import { config } from 'dotenv';
import { createAdminClient } from '../src/lib/supabase/server.js';

// Load environment variables
config({ path: '.env.local' });

async function checkEventImages() {
  const supabase = createAdminClient();

  // Get the specific event mentioned by the user
  const { data: event, error } = await supabase
    .from('events')
    .select('id, name, hero_image_url, thumbnail_image_url, poster_image_url')
    .eq('id', 'a6164ade-9408-485c-9ee4-fb5bf3c9736e')
    .single();

  if (error) {
    console.error('Error fetching event:', error);
  } else {
    console.log('Event data:');
    console.log(JSON.stringify(event, null, 2));
  }

  // Check if there's an image_url column (raw SQL query)
  const { data: columns, error: columnsError } = await supabase
    .rpc('query_information_schema', {
      query: `SELECT column_name FROM information_schema.columns WHERE table_name = 'events' AND column_name LIKE '%image%'`
    });

  if (columnsError) {
    // Try a different approach - just select all from events with limit 0
    const { data: sample } = await supabase
      .from('events')
      .select('*')
      .limit(1);
    
    if (sample && sample.length > 0) {
      const imageFields = Object.keys(sample[0]).filter(key => key.includes('image'));
      console.log('\nImage-related fields in events table:', imageFields);
    }
  } else {
    console.log('\nImage columns:', columns);
  }

  // Check a category that works
  const { data: category } = await supabase
    .from('event_categories')
    .select('id, name, image_url, default_image_url')
    .limit(1)
    .single();

  console.log('\nSample category fields:');
  console.log(JSON.stringify(category, null, 2));
}

checkEventImages().catch(console.error);