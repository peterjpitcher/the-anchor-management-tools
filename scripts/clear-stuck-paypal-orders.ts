#!/usr/bin/env tsx
/**
 * Inspect known stuck PayPal deposit orders and optionally clear failed lookups.
 *
 * Default mode is read-only. Pass --confirm to clear private_bookings.paypal_deposit_order_id
 * only for orders that cannot be loaded from PayPal and are still unpaid.
 */

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPayPalOrder, PayPalApiError } from '@/lib/paypal'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const SCRIPT_NAME = 'clear-stuck-paypal-orders'
const KNOWN_STUCK_ORDER_IDS = [
  '4TB38943S69167218',
  '2J52830664016643Y',
  '2GY54506VR606383F',
  '9C152858VV719682A',
]

function summarizeError(error: unknown) {
  if (error instanceof PayPalApiError) {
    return {
      name: error.name,
      message: error.message,
      status: error.status,
      statusText: error.statusText,
      details: error.details,
    }
  }

  if (error instanceof Error) {
    return { name: error.name, message: error.message }
  }

  return { message: String(error) }
}

async function main() {
  const confirm = process.argv.includes('--confirm')
  const supabase = createAdminClient()

  console.warn(`[${SCRIPT_NAME}] Mode: ${confirm ? 'CLEAR FAILED LOOKUPS' : 'read-only'}`)

  for (const orderId of KNOWN_STUCK_ORDER_IDS) {
    const { data: bookings, error: bookingError } = await supabase
      .from('private_bookings')
      .select('id, status, event_date, deposit_paid_date, paypal_deposit_order_id')
      .eq('paypal_deposit_order_id', orderId)

    if (bookingError) {
      throw new Error(`[${SCRIPT_NAME}] Failed to load bookings for ${orderId}: ${bookingError.message}`)
    }

    console.warn(`\n[${orderId}] matching bookings: ${bookings?.length ?? 0}`)
    console.warn(JSON.stringify(bookings ?? [], null, 2))

    try {
      const order = await getPayPalOrder(orderId)
      console.warn(`[${orderId}] PayPal lookup succeeded; not clearing.`)
      console.warn(JSON.stringify(order, null, 2))
      continue
    } catch (error) {
      console.warn(`[${orderId}] PayPal lookup failed:`)
      console.warn(JSON.stringify(summarizeError(error), null, 2))
    }

    if (!confirm) {
      console.warn(`[${orderId}] Dry run only. Re-run with --confirm to clear failed lookup rows.`)
      continue
    }

    const { data: cleared, error: clearError } = await supabase
      .from('private_bookings')
      .update({
        paypal_deposit_order_id: null,
        paypal_reconciliation_attempts: 0,
        paypal_reconciliation_last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('paypal_deposit_order_id', orderId)
      .is('deposit_paid_date', null)
      .select('id')

    if (clearError) {
      throw new Error(`[${SCRIPT_NAME}] Failed to clear ${orderId}: ${clearError.message}`)
    }

    console.warn(`[${orderId}] cleared rows: ${cleared?.length ?? 0}`)
  }
}

main().catch((error) => {
  console.error(`[${SCRIPT_NAME}] Failed:`, error)
  process.exitCode = 1
})
