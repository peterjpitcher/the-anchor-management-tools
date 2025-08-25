#!/usr/bin/env tsx

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

// Load environment variables
dotenv.config({ path: resolve(process.cwd(), '.env.local') });

async function fixDuplicateLoyaltyProgram() {
  console.log('🔧 Fixing duplicate loyalty program issue...\n');
  
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Missing required environment variables');
  }
  
  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
  
  // Check all loyalty programs
  const { data: programs, error: programError } = await supabase
    .from('loyalty_programs')
    .select('*')
    .order('created_at');
    
  if (programError) {
    console.error('❌ Error checking loyalty programs:', programError);
    return;
  }
  
  console.log(`📊 Found ${programs?.length || 0} loyalty programs`);
  
  if (programs && programs.length > 1) {
    // Find the program with empty settings
    const emptyProgram = programs.find(p => 
      !p.settings || Object.keys(p.settings).length === 0
    );
    
    const validProgram = programs.find(p => 
      p.settings && Object.keys(p.settings).length > 0
    );
    
    if (emptyProgram && validProgram) {
      console.log('\n🗑️  Program to remove (empty settings):');
      console.log(`   ID: ${emptyProgram.id}`);
      console.log(`   Name: ${emptyProgram.name}`);
      console.log(`   Active: ${emptyProgram.active}`);
      
      console.log('\n✅ Program to keep (valid settings):');
      console.log(`   ID: ${validProgram.id}`);
      console.log(`   Name: ${validProgram.name}`);
      console.log(`   Active: ${validProgram.active}`);
      console.log(`   Settings:`, JSON.stringify(validProgram.settings, null, 2));
      
      // Check if there are any members assigned to the empty program
      const { count: memberCount } = await supabase
        .from('loyalty_members')
        .select('*', { count: 'exact', head: true })
        .eq('program_id', emptyProgram.id);
        
      if (memberCount && memberCount > 0) {
        console.log(`\n⚠️  Found ${memberCount} members assigned to the empty program`);
        console.log('   Migrating them to the valid program...');
        
        // Migrate members to valid program
        const { error: migrateError } = await supabase
          .from('loyalty_members')
          .update({ program_id: validProgram.id })
          .eq('program_id', emptyProgram.id);
          
        if (migrateError) {
          console.error('❌ Error migrating members:', migrateError);
          return;
        }
        
        console.log('✅ Members migrated successfully');
      }
      
      // Delete the empty program
      console.log('\n🗑️  Deleting empty program...');
      const { error: deleteError } = await supabase
        .from('loyalty_programs')
        .delete()
        .eq('id', emptyProgram.id);
        
      if (deleteError) {
        console.error('❌ Error deleting program:', deleteError);
        return;
      }
      
      console.log('✅ Empty program deleted successfully');
      
      // Verify only one program remains
      const { data: remainingPrograms } = await supabase
        .from('loyalty_programs')
        .select('*');
        
      console.log(`\n📊 Remaining programs: ${remainingPrograms?.length || 0}`);
      if (remainingPrograms && remainingPrograms.length === 1) {
        console.log('✅ Successfully resolved duplicate program issue!');
      }
    } else {
      console.log('\n⚠️  Could not identify which program to keep');
      programs.forEach((p, i) => {
        console.log(`\nProgram ${i + 1}:`);
        console.log(`   ID: ${p.id}`);
        console.log(`   Name: ${p.name}`);
        console.log(`   Active: ${p.active}`);
        console.log(`   Settings:`, JSON.stringify(p.settings, null, 2));
      });
    }
  } else if (programs && programs.length === 1) {
    console.log('\n✅ Only one loyalty program found - no duplicates to fix');
  } else {
    console.log('\n⚠️  No loyalty programs found!');
  }
}

fixDuplicateLoyaltyProgram()
  .then(() => {
    console.log('\n✅ Script complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Error:', error);
    process.exit(1);
  });