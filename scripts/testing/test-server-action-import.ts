#!/usr/bin/env tsx

// Test if server actions can be imported and called from a script
// This simulates what happens in an API route

async function testServerActionImport() {
  console.log('Testing server action imports...\n');

  // Safety: this script is intentionally read-only. Do NOT call server actions from
  // scripts without explicit gating and caps, as they may enqueue jobs or send SMS.
  let hasFailure = false

  try {
    console.log('1. Attempting to import queueBookingConfirmationSMS...')
    const { queueBookingConfirmationSMS } = await import('../src/app/actions/table-booking-sms')
    console.log('   ✅ Import successful')
    console.log('   Type:', typeof queueBookingConfirmationSMS)

    if (typeof queueBookingConfirmationSMS === 'function') {
      console.log('   ✅ It is a function')
      console.log('   ℹ️  This script will not call server actions (read-only safety).')
    } else {
      hasFailure = true
      console.log('   ❌ Not a function, actual type:', typeof queueBookingConfirmationSMS)
    }
  } catch (importError: any) {
    hasFailure = true
    console.log('   ❌ Import failed:', importError.message)
    console.log('   Error type:', importError.constructor?.name ?? 'unknown')
  }

  try {
    console.log('\n2. Attempting to import sendBookingConfirmationEmail...')
    const { sendBookingConfirmationEmail } = await import('../src/app/actions/table-booking-email')
    console.log('   ✅ Import successful')
    console.log('   Type:', typeof sendBookingConfirmationEmail)
    if (typeof sendBookingConfirmationEmail !== 'function') {
      hasFailure = true
      console.log('   ❌ Not a function, actual type:', typeof sendBookingConfirmationEmail)
    }
  } catch (importError: any) {
    hasFailure = true
    console.log('   ❌ Import failed:', importError.message)
  }
  
  console.log('\n3. Checking if this is a Next.js server context issue...')
  console.log('   NODE_ENV:', process.env.NODE_ENV)
  console.log('   Running in:', typeof window === 'undefined' ? 'Node.js' : 'Browser')
  
  console.log('\n4. Testing direct Twilio import (read-only)...')
  try {
    const { sendSMS } = await import('../src/lib/twilio')
    console.log('   ✅ Twilio import successful')
    console.log('   Type:', typeof sendSMS)
    if (typeof sendSMS !== 'function') {
      hasFailure = true
      console.log('   ❌ Not a function, actual type:', typeof sendSMS)
    }
  } catch (error: any) {
    hasFailure = true
    console.log('   ❌ Twilio import failed:', error.message)
  }

  if (hasFailure) {
    console.log('\n❌ One or more imports failed.')
    process.exitCode = 1
    return
  }

  console.log('\n✅ All imports succeeded.')
}

testServerActionImport();
