import { config } from 'dotenv'
config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'
import twilio from 'twilio'

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!)
const FROM = process.env.TWILIO_PHONE_NUMBER!

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

const BODY = 'Oops — Music Bingo is Friday! Reply with how many seats.'

async function main() {
  console.log(`Sending correction to ${recipients.length} recipients...`)
  let sent = 0, errors = 0

  for (const r of recipients) {
    try {
      const msg = await twilioClient.messages.create({ to: r.phone, from: FROM, body: BODY })

      // Log in messages table
      const { data: cust } = await db.from('customers').select('id').eq('mobile_e164', r.phone).limit(1).maybeSingle()
      if (cust) {
        await db.from('messages').insert({
          customer_id: cust.id,
          direction: 'outbound',
          message_sid: msg.sid,
          body: BODY,
          status: 'sent',
          twilio_status: 'sent',
          from_number: '+447700106752',
          to_number: r.phone,
          message_type: 'sms',
          template_key: 'event_manual_promo_correction',
          sent_at: new Date().toISOString(),
          segments: 1,
        })
      }

      console.log(`  SENT ${r.name} — ${msg.sid}`)
      sent++
    } catch (err: any) {
      console.log(`  ERROR ${r.name} — ${err.message}`)
      errors++
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  console.log(`\nDone. Sent: ${sent}, Errors: ${errors}`)
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
