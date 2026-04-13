#!/usr/bin/env tsx

/**
 * Investigates and remediates the review SMS spam incident for Terry Leigh.
 *
 * Steps:
 * 1. Find Terry's customer record(s) — check for duplicates
 * 2. Find the table booking from April 11
 * 3. Check messages sent to Terry around the incident
 * 4. Check idempotency keys related to the booking
 * 5. Check orphaned guest tokens
 * 6. Remediate: set review_sms_sent_at if not set, clean up tokens
 */

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '../../src/lib/supabase/admin'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function main() {
  const db = createAdminClient()

  console.log('=== STEP 1: Find Terry\'s customer record(s) ===\n')

  const { data: customers, error: custErr } = await db
    .from('customers')
    .select('id, first_name, last_name, mobile_number, email, sms_opt_in, messaging_status, created_at')
    .or('mobile_number.ilike.%7379500%,mobile_number.ilike.%737950051%')

  if (custErr) {
    console.error('Error querying customers:', custErr.message)
  } else if (!customers || customers.length === 0) {
    console.log('No customers found matching phone pattern. Trying broader search...')
    const { data: broader } = await db
      .from('customers')
      .select('id, first_name, last_name, mobile_number')
      .ilike('first_name', '%terry%')
      .limit(10)
    console.log('Broader search (name=terry):', JSON.stringify(broader, null, 2))
  } else {
    console.log(`Found ${customers.length} customer record(s):`)
    for (const c of customers) {
      console.log(`  ID: ${c.id}`)
      console.log(`  Name: ${c.first_name} ${c.last_name}`)
      console.log(`  Mobile: ${c.mobile_number}`)
      console.log(`  SMS opt-in: ${c.sms_opt_in}, Status: ${c.messaging_status}`)
      console.log(`  Created: ${c.created_at}`)
      console.log()
    }
    if (customers.length > 1) {
      console.log('⚠️  DUPLICATE CUSTOMER RECORDS FOUND — this may explain bypassed rate limits\n')
    }
  }

  console.log('\n=== STEP 2: Find table booking from April 11 ===\n')

  const customerIds = (customers || []).map(c => c.id)

  if (customerIds.length === 0) {
    console.log('No customer IDs to search bookings for. Trying by date and party size...')
    const { data: dateBookings } = await db
      .from('table_bookings')
      .select('id, customer_id, customer_name, customer_phone, booking_date, booking_time, party_size, status, review_sms_sent_at, review_suppressed_at, start_datetime, created_at')
      .eq('booking_date', '2026-04-11')
      .eq('party_size', 4)
    console.log('Bookings on Apr 11 with party_size=4:', JSON.stringify(dateBookings, null, 2))
  } else {
    const { data: bookings, error: bookErr } = await db
      .from('table_bookings')
      .select('id, customer_id, booking_date, booking_time, party_size, status, review_sms_sent_at, review_suppressed_at, start_datetime, booking_type, created_at, updated_at')
      .in('customer_id', customerIds)
      .gte('booking_date', '2026-04-10')
      .lte('booking_date', '2026-04-12')

    if (bookErr) {
      console.error('Error querying bookings:', bookErr.message)
    } else {
      console.log(`Found ${bookings?.length ?? 0} booking(s):`)
      for (const b of bookings || []) {
        console.log(`  Booking ID: ${b.id}`)
        console.log(`  Customer ID: ${b.customer_id}`)
        console.log(`  Date: ${b.booking_date} ${b.booking_time}, Party: ${b.party_size}`)
        console.log(`  Status: ${b.status}`)
        console.log(`  review_sms_sent_at: ${b.review_sms_sent_at ?? 'NULL ⚠️'}`)
        console.log(`  review_suppressed_at: ${b.review_suppressed_at ?? 'NULL'}`)
        console.log(`  start_datetime: ${b.start_datetime}`)
        console.log(`  Updated: ${b.updated_at}`)
        console.log()
      }

      // Check for the specific booking
      const terryBooking = (bookings || []).find(b => b.booking_date === '2026-04-11' && b.party_size === 4)
      if (terryBooking) {
        console.log(`\n=== STEP 3: Check messages for booking ${terryBooking.id} ===\n`)

        const { data: messages, error: msgErr } = await db
          .from('messages')
          .select('id, customer_id, body, status, template_key, table_booking_id, created_at, sent_at')
          .in('customer_id', customerIds)
          .gte('created_at', '2026-04-11T00:00:00Z')
          .lte('created_at', '2026-04-13T00:00:00Z')
          .order('created_at', { ascending: true })

        if (msgErr) {
          console.error('Error querying messages:', msgErr.message)
        } else {
          console.log(`Found ${messages?.length ?? 0} message(s) in the incident window:`)
          for (const m of messages || []) {
            const bodyPreview = (m.body || '').substring(0, 80)
            console.log(`  ${m.created_at} | ${m.template_key ?? 'no-template'} | ${m.table_booking_id ?? 'no-tbid'} | ${bodyPreview}...`)
          }
        }

        console.log(`\n=== STEP 4: Check idempotency keys ===\n`)

        const { data: idempKeys, error: idempErr } = await db
          .from('idempotency_keys')
          .select('key, request_hash, expires_at, response')
          .ilike('key', '%table_review%')
          .limit(20)

        if (idempErr) {
          // May not match — try broader
          console.log('No idempotency keys matching "table_review". Checking all recent keys...')
          const { data: allKeys, error: allErr } = await db
            .from('idempotency_keys')
            .select('key, request_hash, expires_at')
            .gte('expires_at', '2026-04-11T00:00:00Z')
            .limit(20)
          if (allErr) {
            console.error('Error querying idempotency_keys:', allErr.message)
          } else {
            console.log(`Found ${allKeys?.length ?? 0} recent idempotency keys`)
          }
        } else {
          console.log(`Found ${idempKeys?.length ?? 0} idempotency key(s):`)
          for (const k of idempKeys || []) {
            console.log(`  Key: ${k.key?.substring(0, 40)}...`)
            console.log(`  Expires: ${k.expires_at}`)
            console.log()
          }
        }

        console.log(`\n=== STEP 5: Check orphaned guest tokens ===\n`)

        const { data: tokens, error: tokErr } = await db
          .from('guest_tokens')
          .select('id, action_type, table_booking_id, expires_at, created_at')
          .eq('action_type', 'review_redirect')
          .eq('table_booking_id', terryBooking.id)

        if (tokErr) {
          console.error('Error querying guest_tokens:', tokErr.message)
        } else {
          console.log(`Found ${tokens?.length ?? 0} review_redirect token(s) for this booking:`)
          for (const t of tokens || []) {
            console.log(`  Token ID: ${t.id}, Created: ${t.created_at}, Expires: ${t.expires_at}`)
          }
        }

        console.log(`\n=== STEP 6: REMEDIATION ===\n`)

        // 6a. Set review_sms_sent_at if not already set
        if (!terryBooking.review_sms_sent_at) {
          console.log('Setting review_sms_sent_at on the booking...')
          const { data: updated, error: updateErr } = await db
            .from('table_bookings')
            .update({
              review_sms_sent_at: '2026-04-11T16:00:00Z',
              status: 'visited_waiting_for_review',
              updated_at: new Date().toISOString()
            })
            .eq('id', terryBooking.id)
            .select('id, status, review_sms_sent_at')
            .maybeSingle()

          if (updateErr) {
            console.error('Failed to update booking:', updateErr.message)
            // Try just the dedup flag without status change
            console.log('Retrying with dedup flag only...')
            const { error: retryErr } = await db
              .from('table_bookings')
              .update({
                review_sms_sent_at: '2026-04-11T16:00:00Z',
                updated_at: new Date().toISOString()
              })
              .eq('id', terryBooking.id)
            if (retryErr) {
              console.error('Retry also failed:', retryErr.message)
            } else {
              console.log('✅ Dedup flag set (without status change)')
            }
          } else {
            console.log(`✅ Booking updated: status=${updated?.status}, review_sms_sent_at=${updated?.review_sms_sent_at}`)
          }
        } else {
          console.log(`✅ review_sms_sent_at already set: ${terryBooking.review_sms_sent_at}`)
        }

        // 6b. Clean up orphaned tokens (keep the most recent one)
        if (tokens && tokens.length > 1) {
          const sorted = [...tokens].sort((a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          )
          const keepId = sorted[0].id
          const deleteIds = sorted.slice(1).map(t => t.id)
          console.log(`\nCleaning up ${deleteIds.length} orphaned tokens (keeping ${keepId})...`)
          const { error: delErr } = await db
            .from('guest_tokens')
            .delete()
            .in('id', deleteIds)
          if (delErr) {
            console.error('Failed to delete orphaned tokens:', delErr.message)
          } else {
            console.log(`✅ Deleted ${deleteIds.length} orphaned review tokens`)
          }
        } else {
          console.log('No orphaned tokens to clean up (0 or 1 token found)')
        }
      }
    }
  }

  console.log('\n=== STEP 7: Check env var defaults ===\n')
  console.log('SMS_SAFETY_GUARDS_ENABLED:', process.env.SMS_SAFETY_GUARDS_ENABLED ?? '(not set — defaults to true)')
  console.log('SMS_SAFETY_IDEMPOTENCY_TTL_HOURS:', process.env.SMS_SAFETY_IDEMPOTENCY_TTL_HOURS ?? '(not set — defaults to 336 / 14 days)')
  console.log('SMS_SAFETY_MAX_PER_RECIPIENT_HOURLY:', process.env.SMS_SAFETY_MAX_PER_RECIPIENT_HOURLY ?? '(not set — defaults to 3)')
  console.log('SMS_SAFETY_MAX_PER_RECIPIENT_DAILY:', process.env.SMS_SAFETY_MAX_PER_RECIPIENT_DAILY ?? '(not set — defaults to 8)')

  console.log('\n=== INVESTIGATION COMPLETE ===')
}

main().catch((err) => {
  console.error('Script error:', err)
  process.exit(1)
})
