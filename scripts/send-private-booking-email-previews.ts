/**
 * Sends preview copies of the private-booking customer emails to a recipient
 * so the wording can be reviewed in a real inbox.
 *
 * Usage: tsx scripts/send-private-booking-email-previews.ts [recipient-email]
 * Defaults to peter@orangejelly.co.uk. Uses obviously-fake SAMPLE data only.
 */
import * as dotenv from 'dotenv'
import { resolve } from 'path'

dotenv.config({ path: resolve(process.cwd(), '.env.local') })

import {
  sendBookingConfirmationEmail,
  sendDepositReceivedEmail,
  sendDepositPaymentLinkEmail,
} from '@/lib/email/private-booking-emails'

async function main() {
  const recipient = process.argv[2] || 'peter@orangejelly.co.uk'

  const sample = {
    id: 'preview-0000-0000-0000-000000000000',
    contact_email: recipient,
    customer_first_name: 'Peter',
    customer_last_name: 'Pitcher',
    customer_name: 'Peter Pitcher',
    event_date: '2026-07-18',
    event_type: 'SAMPLE Birthday Party',
    start_time: '18:00',
    end_time: '23:00',
    guest_count: 40,
    deposit_amount: 250,
    deposit_payment_method: 'PayPal',
    balance_due_date: '2026-07-04',
    total_amount: 1200,
  }

  const examplePaypalUrl =
    'https://www.sandbox.paypal.com/checkoutnow?token=EXAMPLE-PREVIEW-TOKEN'

  console.log(`Sending private-booking email previews to ${recipient} ...`)

  console.log('1/3 Provisional Booking Hold (sendBookingConfirmationEmail)')
  await sendBookingConfirmationEmail(sample)

  console.log('2/3 Booking Confirmed (sendDepositReceivedEmail)')
  await sendDepositReceivedEmail(sample)

  console.log('3/3 Deposit Payment link (sendDepositPaymentLinkEmail)')
  await sendDepositPaymentLinkEmail(sample, examplePaypalUrl)

  console.log('Done. If no red error lines appeared above, all three were sent.')
}

main().catch((e) => {
  console.error('Preview send script failed:', e)
  process.exit(1)
})
