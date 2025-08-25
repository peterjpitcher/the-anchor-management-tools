import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { formatPhoneForStorage, generatePhoneVariants } from '../src/lib/utils';

config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

async function migratePrivateBookingsToCustomers() {
  console.log('🔄 Starting Private Bookings Customer Migration...\n');
  
  // Get all private bookings without customer_id
  const { data: bookings, error } = await supabase
    .from('private_bookings')
    .select('*')
    .is('customer_id', null)
    .not('contact_phone', 'is', null)
    .order('event_date', { ascending: false });
    
  if (error) {
    console.error('❌ Error fetching bookings:', error);
    return;
  }
  
  if (!bookings || bookings.length === 0) {
    console.log('✅ No bookings to migrate');
    return;
  }
  
  console.log(`📋 Found ${bookings.length} bookings to process\n`);
  
  let created = 0;
  let linked = 0;
  let skipped = 0;
  
  for (const booking of bookings) {
    console.log(`Processing: ${booking.customer_first_name} ${booking.customer_last_name || ''}`);
    
    if (!booking.contact_phone) {
      console.log('  ⚠️  Skipped - no phone number\n');
      skipped++;
      continue;
    }
    
    try {
      // Standardize phone and generate variants
      const standardizedPhone = formatPhoneForStorage(booking.contact_phone);
      const phoneVariants = generatePhoneVariants(standardizedPhone);
      
      // Try to find existing customer
      const { data: existingCustomer } = await supabase
        .from('customers')
        .select('*')
        .or(phoneVariants.map(v => `mobile_number.eq.${v}`).join(','))
        .single();
        
      let customerId;
      
      if (existingCustomer) {
        console.log(`  ✅ Found existing customer: ${existingCustomer.first_name} ${existingCustomer.last_name}`);
        customerId = existingCustomer.id;
        linked++;
      } else {
        // Create new customer
        const { data: newCustomer, error: createError } = await supabase
          .from('customers')
          .insert({
            first_name: booking.customer_first_name,
            last_name: booking.customer_last_name || '',
            mobile_number: standardizedPhone,
            email: booking.contact_email,
            sms_opt_in: true,
            created_at: booking.created_at, // Preserve original creation date
          })
          .select()
          .single();
          
        if (createError) {
          console.error(`  ❌ Error creating customer:`, createError);
          skipped++;
          continue;
        }
        
        console.log(`  ✨ Created new customer: ${newCustomer.first_name} ${newCustomer.last_name}`);
        customerId = newCustomer.id;
        created++;
      }
      
      // Update booking with customer_id
      const { error: updateError } = await supabase
        .from('private_bookings')
        .update({ customer_id: customerId })
        .eq('id', booking.id);
        
      if (updateError) {
        console.error(`  ❌ Error updating booking:`, updateError);
      } else {
        console.log(`  ✅ Linked booking to customer\n`);
      }
      
    } catch (err) {
      console.error(`  ❌ Unexpected error:`, err);
      skipped++;
    }
  }
  
  console.log('\n📊 Migration Summary:');
  console.log(`   Total bookings processed: ${bookings.length}`);
  console.log(`   New customers created: ${created}`);
  console.log(`   Existing customers linked: ${linked}`);
  console.log(`   Bookings skipped: ${skipped}`);
  
  if (process.argv.includes('--dry-run')) {
    console.log('\n⚠️  This was a dry run. No changes were made.');
    console.log('Run without --dry-run to apply changes.');
  }
}

// Add dry run warning
if (process.argv.includes('--dry-run')) {
  console.log('🔍 DRY RUN MODE - No changes will be made\n');
}

migratePrivateBookingsToCustomers();