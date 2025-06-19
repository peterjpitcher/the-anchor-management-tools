import { createClient } from '@supabase/supabase-js';
import twilio from 'twilio';

// Configuration
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN!;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER || '+447700106752';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Date range for fetching messages
// Adjust these dates to match when your webhook was misconfigured
const START_DATE = new Date('2025-06-18T00:00:00Z'); // Adjust as needed
const END_DATE = new Date(); // Now

async function importMissedMessages() {
  console.log('Starting import of missed messages...');
  console.log(`Date range: ${START_DATE.toISOString()} to ${END_DATE.toISOString()}`);

  // Initialize clients
  const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    // Fetch messages from Twilio
    console.log('Fetching messages from Twilio...');
    const messages = await twilioClient.messages.list({
      to: TWILIO_PHONE_NUMBER,
      dateSentAfter: START_DATE,
      dateSentBefore: END_DATE,
      limit: 1000 // Adjust if needed
    });

    console.log(`Found ${messages.length} inbound messages`);

    // Filter for inbound messages only
    const inboundMessages = messages.filter(msg => 
      msg.direction === 'inbound' || 
      (msg.to === TWILIO_PHONE_NUMBER && msg.from !== TWILIO_PHONE_NUMBER)
    );

    console.log(`Filtered to ${inboundMessages.length} inbound messages`);

    // Check which messages already exist in database
    const messageSids = inboundMessages.map(m => m.sid);
    const { data: existingMessages } = await supabase
      .from('messages')
      .select('twilio_message_sid')
      .in('twilio_message_sid', messageSids);

    const existingSids = new Set(existingMessages?.map(m => m.twilio_message_sid) || []);
    const newMessages = inboundMessages.filter(m => !existingSids.has(m.sid));

    console.log(`${newMessages.length} messages need to be imported`);

    // Import each message
    let imported = 0;
    let failed = 0;

    for (const twilioMessage of newMessages) {
      try {
        console.log(`\nProcessing message from ${twilioMessage.from}...`);
        
        // Find or create customer
        const phoneNumber = twilioMessage.from;
        
        // Check if customer exists
        const { data: existingCustomer } = await supabase
          .from('customers')
          .select('*')
          .eq('mobile_number', phoneNumber)
          .single();

        let customerId: string;

        if (existingCustomer) {
          customerId = existingCustomer.id;
          console.log(`Found existing customer: ${existingCustomer.first_name} ${existingCustomer.last_name}`);
        } else {
          // Create new customer
          console.log(`Creating new customer for ${phoneNumber}`);
          const { data: newCustomer, error: customerError } = await supabase
            .from('customers')
            .insert({
              first_name: 'Unknown',
              last_name: phoneNumber.replace(/\D/g, '').slice(-4), // Last 4 digits
              mobile_number: phoneNumber,
              sms_opt_in: true // They texted us, so they're opted in
            })
            .select()
            .single();

          if (customerError) {
            console.error(`Failed to create customer: ${customerError.message}`);
            failed++;
            continue;
          }

          customerId = newCustomer.id;
          console.log(`Created new customer with ID: ${customerId}`);
        }

        // Insert message
        const { error: messageError } = await supabase
          .from('messages')
          .insert({
            customer_id: customerId,
            direction: 'inbound',
            message_sid: twilioMessage.sid,
            twilio_message_sid: twilioMessage.sid,
            body: twilioMessage.body || '',
            status: twilioMessage.status,
            twilio_status: twilioMessage.status,
            from_number: twilioMessage.from || '',
            to_number: twilioMessage.to || '',
            message_type: 'sms',
            created_at: twilioMessage.dateCreated || twilioMessage.dateSent,
            sent_at: twilioMessage.dateSent,
            segments: twilioMessage.numSegments?.toString() || '1'
          });

        if (messageError) {
          console.error(`Failed to insert message: ${messageError.message}`);
          failed++;
        } else {
          console.log(`✓ Imported message: "${twilioMessage.body?.substring(0, 50)}..."`);
          imported++;
        }

      } catch (error) {
        console.error(`Error processing message ${twilioMessage.sid}:`, error);
        failed++;
      }
    }

    console.log('\n=== Import Complete ===');
    console.log(`Total messages found: ${messages.length}`);
    console.log(`Inbound messages: ${inboundMessages.length}`);
    console.log(`Already in database: ${existingSids.size}`);
    console.log(`Successfully imported: ${imported}`);
    console.log(`Failed to import: ${failed}`);

  } catch (error) {
    console.error('Fatal error during import:', error);
  }
}

// Run the import
if (require.main === module) {
  importMissedMessages()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Import failed:', error);
      process.exit(1);
    });
}