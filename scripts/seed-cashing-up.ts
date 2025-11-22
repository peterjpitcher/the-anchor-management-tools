import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.error('Missing Supabase URL or Service Role Key');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

async function seedCashingUpData() {
  console.log('🌱 Seeding Cashing Up data...');

  // 1. Get or Create Site
  let { data: site } = await supabase.from('sites').select('id').eq('name', 'The Anchor').single();
  
  if (!site) {
    const { data: newSite, error } = await supabase.from('sites').insert({ name: 'The Anchor' }).select('id').single();
    if (error) throw error;
    site = newSite;
    console.log('Created site: The Anchor');
  }

  const siteId = site.id;
  
  // 2. Get Admin User (for prepared_by)
  // Fetch a real user to assign these to, or just pick the first one found
  const { data: users } = await supabase.auth.admin.listUsers();
  const userId = users.users[0]?.id;

  if (!userId) {
    console.error('No users found to assign sessions to.');
    return;
  }

  console.log(`Assigning sessions to user: ${userId}`);

  // 3. Create Sessions for last 2 weeks
  const today = new Date();
  const sessions = [];
  
  for (let i = 0; i < 14; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];
    
    // Skip if exists
    const { data: existing } = await supabase.from('cashup_sessions')
      .select('id')
      .eq('site_id', siteId)
      .eq('session_date', dateStr)
      .maybeSingle();
      
    if (existing) {
      console.log(`Skipping existing session for ${dateStr}`);
      continue;
    }

    // Generate random values
    const expectedCash = 500 + Math.random() * 500;
    const expectedCard = 1000 + Math.random() * 1000;
    const variance = (Math.random() - 0.5) * 20; // +/- 10
    
    const countedCash = expectedCash + (Math.random() > 0.8 ? variance : 0);
    const countedCard = expectedCard; // cards usually match

    const status = i < 2 ? 'draft' : (i < 5 ? 'submitted' : 'approved');

    // Insert Session
    const { data: session, error } = await supabase.from('cashup_sessions').insert({
      site_id: siteId,
      session_date: dateStr,
      shift_code: 'DAY',
      status,
      prepared_by_user_id: userId,
      created_by_user_id: userId,
      updated_by_user_id: userId,
      total_expected_amount: expectedCash + expectedCard,
      total_counted_amount: countedCash + countedCard,
      total_variance_amount: (countedCash + countedCard) - (expectedCash + expectedCard),
      notes: Math.abs(variance) > 5 ? 'Variance noted.' : null
    }).select('id').single();

    if (error) {
      console.error(`Error creating session for ${dateStr}:`, error);
      continue;
    }

    // Insert Breakdowns
    await supabase.from('cashup_payment_breakdowns').insert([
      {
        cashup_session_id: session.id,
        payment_type_code: 'CASH',
        payment_type_label: 'Cash',
        expected_amount: expectedCash,
        counted_amount: countedCash,
        variance_amount: countedCash - expectedCash
      },
      {
        cashup_session_id: session.id,
        payment_type_code: 'CARD',
        payment_type_label: 'Card',
        expected_amount: expectedCard,
        counted_amount: countedCard,
        variance_amount: countedCard - expectedCard
      }
    ]);

    console.log(`Created ${status} session for ${dateStr}`);
  }

  console.log('✅ Seeding complete!');
}

seedCashingUpData().catch(console.error);
