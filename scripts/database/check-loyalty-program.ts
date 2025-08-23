#!/usr/bin/env tsx

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

// Load environment variables
dotenv.config({ path: resolve(process.cwd(), '.env.local') });

async function checkLoyaltyProgram() {
  console.log('🔍 Checking loyalty program setup...\n');
  
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Missing required environment variables');
  }
  
  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
  
  // Check if loyalty program exists
  const { data: programs, error: programError } = await supabase
    .from('loyalty_programs')
    .select('*');
    
  if (programError) {
    console.error('❌ Error checking loyalty programs:', programError);
    return;
  }
  
  console.log(`📊 Found ${programs?.length || 0} loyalty programs`);
  
  if (programs && programs.length > 0) {
    programs.forEach(program => {
      console.log(`\n✅ Program: ${program.name}`);
      console.log(`   ID: ${program.id}`);
      console.log(`   Active: ${program.active}`);
      console.log(`   Settings:`, JSON.stringify(program.settings, null, 2));
    });
  } else {
    console.log('\n⚠️  No loyalty programs found!');
    console.log('Creating default loyalty program...\n');
    
    // Create the default program
    const { data: newProgram, error: createError } = await supabase
      .from('loyalty_programs')
      .insert({
        id: '550e8400-e29b-41d4-a716-446655440000',
        name: 'The Anchor VIP Club',
        active: true,
        settings: {
          points_per_check_in: 10,
          welcome_bonus: 50,
          birthday_bonus: 100,
          referral_bonus: 50
        }
      })
      .select()
      .single();
      
    if (createError) {
      console.error('❌ Error creating loyalty program:', createError);
    } else {
      console.log('✅ Created loyalty program:', newProgram.name);
    }
  }
  
  // Check tiers
  const { data: tiers, error: tierError } = await supabase
    .from('loyalty_tiers')
    .select('*')
    .order('level');
    
  if (tierError) {
    console.error('❌ Error checking tiers:', tierError);
    return;
  }
  
  console.log(`\n📊 Found ${tiers?.length || 0} loyalty tiers`);
  
  if (tiers && tiers.length > 0) {
    tiers.forEach(tier => {
      console.log(`\n   ${tier.icon} ${tier.name} (Level ${tier.level})`);
      console.log(`      Min Events: ${tier.min_events}`);
      console.log(`      Multiplier: ${tier.point_multiplier}x`);
    });
  } else {
    console.log('\n⚠️  No tiers found! You may need to run the migrations.');
  }
  
  // Check members
  const { count: memberCount } = await supabase
    .from('loyalty_members')
    .select('*', { count: 'exact', head: true });
    
  console.log(`\n👥 Total members: ${memberCount || 0}`);
}

checkLoyaltyProgram()
  .then(() => {
    console.log('\n✅ Check complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Error:', error);
    process.exit(1);
  });