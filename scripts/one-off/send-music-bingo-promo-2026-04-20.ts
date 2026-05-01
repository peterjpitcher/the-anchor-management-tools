/**
 * One-off: Send Music Bingo 24 Apr promo to manual list.
 * Run: npx tsx scripts/one-off/send-music-bingo-promo-2026-04-20.ts
 */

import { config } from 'dotenv'
config({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'
import twilio from 'twilio'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID!
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN!
const TWILIO_FROM = process.env.TWILIO_PHONE_NUMBER!

const EVENT_ID = '89f35974-94f7-4faa-810a-14cc6daa4ef2'
const TEMPLATE_KEY = 'event_manual_promo_3d'

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
const twilioClient = twilio(TWILIO_SID, TWILIO_TOKEN)

// Recipients after dedup (excluded: Rob Trowbridge, Gabriel Lacatus, Lorraine,
// Luke Phillips, Mandy Jones, Penny Gibbons, Rani)
const recipients = [
  { name: 'Adam', phone: '+447434961614' },
  { name: 'Aimee', phone: '+447860640494' },
  { name: 'Alison', phone: '+447538720758' },
  { name: 'Alison', phone: '+447956953289' },
  { name: 'Amber', phone: '+447508715297' },
  { name: 'Andy', phone: '+447834905435' },
  { name: 'Beata', phone: '+447526572087' },
  { name: 'Brooke', phone: '+447510715341' },
  { name: 'Cheena', phone: '+447392997030' },
  { name: 'Donna', phone: '+447947248805' },
  { name: 'Emily', phone: '+447765338138' },
  { name: 'Jacqui', phone: '+447914398101' },
  { name: 'Jordan', phone: '+447891505037' },
  { name: 'Josie', phone: '+447861774496' },
  { name: 'Kylie', phone: '+447827813640' },
  { name: 'Lara', phone: '+447359148716' },
  { name: 'Lauren', phone: '+447305866052' },
  { name: 'Lisa', phone: '+447540301040' },
  { name: 'Louise', phone: '+447464029798' },
  { name: 'Mark', phone: '+447561329418' },
  { name: 'Mary', phone: '+447719989051' },
  { name: 'Mary', phone: '+447957252906' },
  { name: 'Moureen', phone: '+447586282882' },
  { name: 'Myrtle', phone: '+447805988710' },
  { name: 'Paul', phone: '+447787815721' },
  { name: 'Ronnie', phone: '+447863230107' },
  { name: 'Rosie', phone: '+447979507926' },
  { name: 'Sarah', phone: '+447988517062' },
  { name: 'Sian', phone: '+447951172396' },
  { name: 'Stacey', phone: '+447872983493' },
  { name: 'Stacey', phone: '+447895200732' },
  { name: 'Sylvia', phone: '+447895504024' },
]

function buildMessage(firstName: string): string {
  return `The Anchor: ${firstName}! Music Bingo is this Thursday! Still got seats — reply with how many and you're in! Offer open 48hrs.`
}

async function findCustomerByPhone(phone: string): Promise<string | null> {
  const { data } = await db
    .from('customers')
    .select('id')
    .eq('mobile_e164', phone)
    .limit(1)
    .maybeSingle()
  return data?.id ?? null
}

async function main() {
  console.log(`Sending Music Bingo promo to ${recipients.length} recipients...`)
  let sent = 0
  let skipped = 0
  let errors = 0

  for (const r of recipients) {
    const customerId = await findCustomerByPhone(r.phone)
    if (!customerId) {
      console.log(`  SKIP ${r.name} (${r.phone}) — not found in customers table`)
      skipped++
      continue
    }

    const body = buildMessage(r.name)

    try {
      const msg = await twilioClient.messages.create({
        to: r.phone,
        from: TWILIO_FROM,
        body,
      })

      // Record in sms_promo_context for reply-to-book + dedup tracking
      await db.from('sms_promo_context').insert({
        customer_id: customerId,
        phone_number: r.phone,
        event_id: EVENT_ID,
        template_key: TEMPLATE_KEY,
        message_id: null,
        reply_window_expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
        booking_created: false,
      })

      console.log(`  SENT ${r.name} (${r.phone}) — SID: ${msg.sid}`)
      sent++
    } catch (err: any) {
      console.log(`  ERROR ${r.name} (${r.phone}) — ${err.message}`)
      errors++
    }

    // Small delay between sends (100ms)
    await new Promise(resolve => setTimeout(resolve, 100))
  }

  console.log(`\nDone. Sent: ${sent}, Skipped: ${skipped}, Errors: ${errors}`)
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
