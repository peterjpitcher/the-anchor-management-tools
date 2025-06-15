import { createClient } from '@supabase/supabase-js';
import path from 'path';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing required environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkMessages() {
  // Get all messages
  const { data: messages, error } = await supabase
    .from('messages')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    console.error('Error fetching messages:', error);
    return;
  }

  console.log(`\nFound ${messages?.length || 0} recent messages\n`);

  // Group by direction
  const inbound = messages?.filter(m => m.direction === 'inbound') || [];
  const outbound = messages?.filter(m => m.direction === 'outbound') || [];

  console.log(`Inbound: ${inbound.length}`);
  console.log(`Outbound: ${outbound.length}`);

  // Check for missing fields
  console.log('\nChecking for missing fields...');
  const missingDirection = messages?.filter(m => !m.direction) || [];
  const missingCustomerId = messages?.filter(m => !m.customer_id) || [];
  
  if (missingDirection.length > 0) {
    console.log(`⚠️  ${missingDirection.length} messages missing direction field`);
  }
  if (missingCustomerId.length > 0) {
    console.log(`⚠️  ${missingCustomerId.length} messages missing customer_id`);
  }

  // Show sample messages
  console.log('\nSample messages:');
  messages?.slice(0, 5).forEach(msg => {
    console.log(`\n--- Message ${msg.id} ---`);
    console.log(`Direction: ${msg.direction || 'MISSING'}`);
    console.log(`Customer ID: ${msg.customer_id || 'MISSING'}`);
    console.log(`Body: ${msg.body?.substring(0, 50)}...`);
    console.log(`Status: ${msg.twilio_status}`);
    console.log(`Created: ${new Date(msg.created_at).toLocaleString()}`);
    console.log(`From: ${msg.from_number || 'N/A'}`);
    console.log(`To: ${msg.to_number || 'N/A'}`);
  });

  // Check specific customer if provided
  const customerId = process.argv[2];
  if (customerId) {
    console.log(`\n\nChecking messages for customer ${customerId}...`);
    const { data: customerMessages, error: customerError } = await supabase
      .from('messages')
      .select('*')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: true });

    if (customerError) {
      console.error('Error fetching customer messages:', customerError);
      return;
    }

    console.log(`Found ${customerMessages?.length || 0} messages for this customer`);
    customerMessages?.forEach(msg => {
      console.log(`\n${msg.direction === 'inbound' ? '← IN ' : '→ OUT'} ${new Date(msg.created_at).toLocaleString()}`);
      console.log(`   ${msg.body?.substring(0, 100)}${msg.body?.length > 100 ? '...' : ''}`);
      console.log(`   Status: ${msg.twilio_status}`);
    });
  }
}

console.log('=== Message Diagnostic Tool ===');
console.log('Usage: npx tsx scripts/check-messages.ts [customer-id]');
checkMessages().catch(console.error);