#!/usr/bin/env tsx

/**
 * Loyalty program diagnostics (read-only).
 *
 * Safety:
 * - No DB mutations (does not create default programs/tiers).
 * - Fails closed on query errors (non-zero exit).
 */

import * as dotenv from 'dotenv'
import { resolve } from 'path'
import { createAdminClient } from '../../src/lib/supabase/admin'

dotenv.config({ path: resolve(process.cwd(), '.env.local') })

function markFailure(message: string, error?: unknown) {
  process.exitCode = 1
  if (error) {
    console.error(`❌ ${message}`, error)
    return
  }
  console.error(`❌ ${message}`)
}

function isFlagPresent(flag: string): boolean {
  return process.argv.includes(flag)
}

async function checkLoyaltyProgram() {
  if (isFlagPresent('--help')) {
    console.log(`
check-loyalty-program (read-only)

Usage:
  tsx scripts/database/check-loyalty-program.ts
`)
    return
  }

  if (isFlagPresent('--confirm')) {
    throw new Error('check-loyalty-program is read-only and does not support --confirm.')
  }

  console.log('🔍 Checking loyalty program setup (read-only)...\n')

  const supabase = createAdminClient()
  
  // Check if loyalty program exists
  const { data: programs, error: programError } = await supabase
    .from('loyalty_programs')
    .select('*')
    
  if (programError) {
    throw new Error(`Error checking loyalty_programs: ${programError.message || 'unknown error'}`)
  }
  
  console.log(`📊 Found ${programs?.length || 0} loyalty programs`)
  
  if (programs && programs.length > 0) {
    programs.forEach(program => {
      console.log(`\n✅ Program: ${program.name}`)
      console.log(`   ID: ${program.id}`)
      console.log(`   Active: ${program.active}`)
      console.log(`   Settings:`, JSON.stringify(program.settings, null, 2))
    })
  } else {
    console.log('\n❌ No loyalty programs found (unexpected).')
    throw new Error('Missing loyalty_programs rows')
  }
  
  // Check tiers
  const { data: tiers, error: tierError } = await supabase
    .from('loyalty_tiers')
    .select('*')
    .order('level')
    
  if (tierError) {
    throw new Error(`Error checking loyalty_tiers: ${tierError.message || 'unknown error'}`)
  }
  
  console.log(`\n📊 Found ${tiers?.length || 0} loyalty tiers`)
  
  if (tiers && tiers.length > 0) {
    tiers.forEach(tier => {
      console.log(`\n   ${tier.icon} ${tier.name} (Level ${tier.level})`)
      console.log(`      Min Events: ${tier.min_events}`)
      console.log(`      Multiplier: ${tier.point_multiplier}x`)
    })
  } else {
    console.log('\n⚠️  No tiers found! You may need to run the migrations.')
  }
  
  // Check members
  const { count: memberCount, error: memberError } = await supabase
    .from('loyalty_members')
    .select('*', { count: 'exact', head: true })

  if (memberError) {
    throw new Error(`Error counting loyalty_members: ${memberError.message || 'unknown error'}`)
  }

  console.log(`\n👥 Total members: ${memberCount || 0}`)
}

checkLoyaltyProgram()
  .then(() => {
    console.log('\n✅ Check complete')
  })
  .catch((error) => markFailure('check-loyalty-program failed', error))
