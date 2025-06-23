'use server'

import { createClient } from '@supabase/supabase-js'

function getSupabaseAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Missing Supabase environment variables')
  }

  return createClient(supabaseUrl, supabaseServiceRoleKey)
}

// Standardize a UK phone number to E.164 format
function standardizePhoneNumber(phone: string): string | null {
  if (!phone) return null;
  
  // Remove all non-digit characters
  const digitsOnly = phone.replace(/\D/g, '');
  
  // Check if it's a UK number
  if (digitsOnly.startsWith('44') && digitsOnly.length === 12) {
    return '+' + digitsOnly; // Already has country code
  } else if (digitsOnly.startsWith('0') && digitsOnly.length === 11) {
    return '+44' + digitsOnly.substring(1); // UK number starting with 0
  } else if (digitsOnly.length === 10 && digitsOnly.startsWith('7')) {
    return '+44' + digitsOnly; // UK mobile without leading 0
  }
  
  // If already in correct format
  if (phone.startsWith('+44') && phone.length >= 13) {
    return phone;
  }
  
  // Can't standardize - return null
  return null;
}

export async function analyzePhoneNumbers() {
  const supabase = getSupabaseAdminClient()
  
  console.log('=== ANALYZING PHONE NUMBERS ===')
  
  // Get all unique phone numbers from customers
  const { data: customers, error: customersError } = await supabase
    .from('customers')
    .select('id, mobile_number')
    .not('mobile_number', 'is', null)
  
  if (customersError) {
    return { error: customersError.message }
  }
  
  const phoneAnalysis = {
    total: customers?.length || 0,
    e164Format: 0,
    ukWithZero: 0,
    ukWithoutPlus: 0,
    nonStandard: 0,
    invalid: 0,
    samples: {
      e164Format: [] as string[],
      needsFixing: [] as { id: string, current: string, suggested: string | null }[]
    }
  }
  
  customers?.forEach(customer => {
    const phone = customer.mobile_number
    if (!phone) return
    
    if (phone.match(/^\+44\d{10}$/)) {
      phoneAnalysis.e164Format++
      if (phoneAnalysis.samples.e164Format.length < 5) {
        phoneAnalysis.samples.e164Format.push(phone)
      }
    } else if (phone.match(/^0\d{10}$/)) {
      phoneAnalysis.ukWithZero++
      const suggested = standardizePhoneNumber(phone)
      if (phoneAnalysis.samples.needsFixing.length < 10) {
        phoneAnalysis.samples.needsFixing.push({
          id: customer.id,
          current: phone,
          suggested
        })
      }
    } else if (phone.match(/^44\d{10}$/)) {
      phoneAnalysis.ukWithoutPlus++
      const suggested = standardizePhoneNumber(phone)
      if (phoneAnalysis.samples.needsFixing.length < 10) {
        phoneAnalysis.samples.needsFixing.push({
          id: customer.id,
          current: phone,
          suggested
        })
      }
    } else {
      const suggested = standardizePhoneNumber(phone)
      if (suggested) {
        phoneAnalysis.nonStandard++
      } else {
        phoneAnalysis.invalid++
      }
      if (phoneAnalysis.samples.needsFixing.length < 10) {
        phoneAnalysis.samples.needsFixing.push({
          id: customer.id,
          current: phone,
          suggested
        })
      }
    }
  })
  
  // Also check messages table
  const { data: messages, error: messagesError } = await supabase
    .from('messages')
    .select('from_number, to_number')
    .limit(100)
  
  const messagePhoneNumbers = new Set<string>()
  messages?.forEach(msg => {
    if (msg.from_number) messagePhoneNumbers.add(msg.from_number)
    if (msg.to_number) messagePhoneNumbers.add(msg.to_number)
  })
  
  console.log('\n=== PHONE NUMBER ANALYSIS ===')
  console.log(`Total customers with phone numbers: ${phoneAnalysis.total}`)
  console.log(`Already in E.164 format (+44...): ${phoneAnalysis.e164Format}`)
  console.log(`UK numbers starting with 0: ${phoneAnalysis.ukWithZero}`)
  console.log(`UK numbers without + prefix: ${phoneAnalysis.ukWithoutPlus}`)
  console.log(`Non-standard but fixable: ${phoneAnalysis.nonStandard}`)
  console.log(`Invalid/unfixable: ${phoneAnalysis.invalid}`)
  console.log(`\nUnique phone formats in messages table: ${messagePhoneNumbers.size}`)
  
  return phoneAnalysis
}

export async function fixPhoneNumbers(dryRun: boolean = true) {
  const supabase = getSupabaseAdminClient()
  
  console.log(`=== ${dryRun ? 'DRY RUN' : 'FIXING'} PHONE NUMBERS ===`)
  
  // Get all customers with non-standard phone numbers
  const { data: customers, error: customersError } = await supabase
    .from('customers')
    .select('id, mobile_number, first_name, last_name')
    .not('mobile_number', 'is', null)
  
  if (customersError) {
    return { error: customersError.message }
  }
  
  const updates: Array<{
    id: string
    name: string
    current: string
    standardized: string
  }> = []
  
  const unfixable: Array<{
    id: string
    name: string
    current: string
    reason: string
  }> = []
  
  customers?.forEach(customer => {
    const phone = customer.mobile_number
    if (!phone) return
    
    // Skip if already in E.164 format
    if (phone.match(/^\+44\d{10}$/)) return
    
    const standardized = standardizePhoneNumber(phone)
    
    if (standardized && standardized !== phone) {
      updates.push({
        id: customer.id,
        name: `${customer.first_name} ${customer.last_name}`,
        current: phone,
        standardized
      })
    } else if (!standardized) {
      unfixable.push({
        id: customer.id,
        name: `${customer.first_name} ${customer.last_name}`,
        current: phone,
        reason: 'Cannot determine correct format'
      })
    }
  })
  
  console.log(`\nFound ${updates.length} phone numbers to update`)
  console.log(`Found ${unfixable.length} unfixable phone numbers`)
  
  if (!dryRun && updates.length > 0) {
    console.log('\nApplying updates...')
    
    let successCount = 0
    let errorCount = 0
    
    for (const update of updates) {
      const { error } = await supabase
        .from('customers')
        .update({ mobile_number: update.standardized })
        .eq('id', update.id)
      
      if (error) {
        console.error(`Failed to update ${update.name}: ${error.message}`)
        errorCount++
      } else {
        successCount++
      }
    }
    
    console.log(`\nSuccessfully updated: ${successCount}`)
    console.log(`Failed updates: ${errorCount}`)
  }
  
  return {
    toUpdate: updates,
    unfixable,
    dryRun
  }
}