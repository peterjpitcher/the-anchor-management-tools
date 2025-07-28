import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

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

async function testPrivateBookingCustomerCreation() {
  console.log('🧪 Testing Private Booking Customer Creation...\n');
  
  // Test data
  const testBookingData = {
    customer_first_name: 'Test',
    customer_last_name: 'Customer',
    contact_phone: '07700900123',
    contact_email: 'test@example.com',
    event_date: '2025-12-25',
    start_time: '18:00',
    event_type: 'Birthday Party',
    guest_badge: 50,
    status: 'draft'
  };
  
  console.log('📋 Test booking data:', testBookingData);
  
  try {
    // 1. Check if customer already exists
    console.log('\n1️⃣ Checking for existing customer with phone:', testBookingData.contact_phone);
    
    const phoneVariants = [
      testBookingData.contact_phone,
      '+44' + testBookingData.contact_phone.substring(1),
      '44' + testBookingData.contact_phone.substring(1)
    ];
    
    const { data: existingCustomer } = await supabase
      .from('customers')
      .select('*')
      .or(phoneVariants.map(v => `mobile_number.eq.${v}`).join(','))
      .single();
      
    if (existingCustomer) {
      console.log('✅ Found existing customer:', {
        id: existingCustomer.id,
        name: `${existingCustomer.first_name} ${existingCustomer.last_name}`,
        phone: existingCustomer.mobile_number
      });
    } else {
      console.log('❌ No existing customer found');
    }
    
    // 2. Create a private booking (simulating the action)
    console.log('\n2️⃣ Creating private booking...');
    
    const bookingData = {
      ...testBookingData,
      customer_name: `${testBookingData.customer_first_name} ${testBookingData.customer_last_name}`,
      created_at: new Date().toISOString()
    };
    
    const { data: booking, error: bookingError } = await supabase
      .from('private_bookings')
      .insert(bookingData)
      .select()
      .single();
      
    if (bookingError) {
      console.error('❌ Error creating booking:', bookingError);
      return;
    }
    
    console.log('✅ Booking created:', {
      id: booking.id,
      customer_name: booking.customer_name,
      customer_id: booking.customer_id
    });
    
    // 3. Check if customer was created/linked
    console.log('\n3️⃣ Verifying customer creation/linking...');
    
    if (booking.customer_id) {
      const { data: linkedCustomer } = await supabase
        .from('customers')
        .select('*')
        .eq('id', booking.customer_id)
        .single();
        
      if (linkedCustomer) {
        console.log('✅ Customer successfully linked:', {
          id: linkedCustomer.id,
          name: `${linkedCustomer.first_name} ${linkedCustomer.last_name}`,
          phone: linkedCustomer.mobile_number,
          email: linkedCustomer.email
        });
      }
    } else {
      console.log('⚠️  No customer_id in booking - customer creation may not be working');
      console.log('   This is expected if testing directly in the database.');
      console.log('   The customer creation logic is in the server action, not database triggers.');
    }
    
    // 4. Clean up test data
    if (!process.argv.includes('--keep')) {
      console.log('\n4️⃣ Cleaning up test data...');
      
      await supabase
        .from('private_bookings')
        .delete()
        .eq('id', booking.id);
        
      console.log('✅ Test booking deleted');
      console.log('\n💡 Use --keep flag to preserve test data');
    }
    
  } catch (error) {
    console.error('❌ Unexpected error:', error);
  }
  
  console.log('\n📝 Note: The customer creation logic is implemented in the server action.');
  console.log('   This test only verifies database operations.');
  console.log('   To fully test, create a booking through the UI at /private-bookings/new');
}

testPrivateBookingCustomerCreation();