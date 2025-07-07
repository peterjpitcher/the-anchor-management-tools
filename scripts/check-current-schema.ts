import { createClient } from '@/lib/supabase/server';

async function checkCurrentSchema() {
  console.log('🔍 Checking Current Database Schema...\n');
  
  const supabase = await createClient();
  
  // Check events table columns
  console.log('📊 Events Table Schema:');
  const { data: eventsSchema, error: eventsError } = await supabase
    .rpc('get_table_columns', { table_name: 'events' });
    
  if (eventsError) {
    // Try alternative method
    const { data, error } = await supabase
      .from('events')
      .select('*')
      .limit(0);
      
    if (error) {
      console.error('Error checking events schema:', error);
    } else {
      console.log('Events table exists, checking for image fields...');
      
      // Try to query specific fields
      const { error: imageUrlError } = await supabase
        .from('events')
        .select('image_url')
        .limit(1);
        
      const { error: heroImageError } = await supabase
        .from('events')
        .select('hero_image_url')
        .limit(1);
        
      console.log('- image_url field:', imageUrlError ? '❌ NOT FOUND' : '✅ EXISTS');
      console.log('- hero_image_url field:', heroImageError ? '❌ NOT FOUND' : '✅ EXISTS');
    }
  } else {
    console.log('Columns:', eventsSchema);
  }
  
  // Check migrations table
  console.log('\n📋 Applied Migrations:');
  const { data: migrations, error: migrationsError } = await supabase
    .from('schema_migrations')
    .select('*')
    .order('version', { ascending: false })
    .limit(10);
    
  if (migrationsError) {
    console.log('No migrations table found or error:', migrationsError.message);
    
    // Try Supabase migrations table
    const { data: supabaseMigrations, error: supabaseMigrationsError } = await supabase
      .from('supabase_migrations')
      .select('*')
      .order('inserted_at', { ascending: false })
      .limit(10);
      
    if (supabaseMigrationsError) {
      console.log('No supabase_migrations table found either');
    } else {
      console.log('Supabase migrations:', supabaseMigrations);
    }
  } else {
    migrations?.forEach(m => {
      console.log(`- ${m.version}: ${m.name || 'unnamed'}`);
    });
  }
  
  // Check event_categories for faqs field
  console.log('\n📂 Event Categories Schema:');
  const { error: faqsError } = await supabase
    .from('event_categories')
    .select('faqs')
    .limit(1);
    
  console.log('- faqs field:', faqsError ? '❌ NOT FOUND' : '✅ EXISTS');
  
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
    
  console.log('- customer_name field:', customerNameError ? '❌ NOT FOUND' : '✅ EXISTS');
  console.log('- customer_first_name field:', firstNameError ? '❌ NOT FOUND' : '✅ EXISTS');
}

checkCurrentSchema().catch(console.error);