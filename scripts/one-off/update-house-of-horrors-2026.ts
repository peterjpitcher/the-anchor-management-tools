#!/usr/bin/env tsx

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  assertScriptExpectedRowCount,
  assertScriptMutationAllowed,
  assertScriptQuerySucceeded,
} from '@/lib/script-mutation-safety'

const SCRIPT_NAME = 'update-house-of-horrors-2026'
const CONFIRM_ENV = 'CONFIRM_HOUSE_OF_HORRORS_UPDATE'
const EVENT_ID = 'd52cbd18-d293-4516-beca-e151eaa90180'
const EVENT_DATE = '2026-10-31'
const EVENT_TITLE = 'Enter If You Dare: The House of Horrors Halloween Party'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const brief = `# Enter If You Dare: The House of Horrors Halloween Party

## The Anchor's 6th Annual Halloween Fancy Dress Party

**Saturday 31 October 2026 | 8pm-midnight**
**The Anchor, Horton Road, Stanwell Moor Village, TW19 6AQ**

Enter if you dare as The Anchor transforms into the **House of Horrors** for our sixth annual Halloween fancy dress party.

Step inside an abandoned haunted mansion filled with dark corners, eerie lighting, creepy characters and plenty of Halloween atmosphere. It will be spooky, theatrical and packed with fun, without being genuinely frightening.

DJ Jermaine will keep the party going from **8pm until midnight** with Halloween favourites, party classics and dance-floor hits.

## Fancy dress competition

Fancy dress is encouraged but not compulsory. DJ Jermaine will choose the winners at **11pm** in three fun categories:

1. **Best Overall Horror**
2. **Most Creative Costume**
3. **Best Little Monster** - for children

Need inspiration? Come as a monster, skeleton, ghost, vampire, gothic witch, haunted bride, zombie servant, possessed doll, Victorian spirit or anything else that might live inside a haunted house. Homemade costumes, family themes and group costumes are all welcome.

## Food and drink

The pub is open from **12pm until midnight**.

Our full menu is available from **12pm to 6pm**. The kitchen then closes until **9pm**, when it reopens with our pizza menu until midnight. Pizza will be available for eating in and takeaway.

The regular bar range will be available throughout the day and party.

## Entry and booking

Entry is **free**, and all ages are welcome throughout the evening.

Advance booking is preferred and guarantees entry, but it does not reserve a table. Walk-ins are welcome while space is available, up to our 100-person capacity.

Fog and flashing or strobe lighting will be used during this event.`

const eventUpdate = {
  name: EVENT_TITLE,
  brief,
  capacity: 100,
  performer_name: 'DJ Jermaine',
  performer_type: 'Person',
  booking_mode: 'general',
  payment_mode: 'free',
  is_free: true,
  price: 0,
  price_per_seat: 0,
  booking_open: true,
  bookings_enabled: true,
  time: '20:00',
  end_time: '00:00:00',
  duration_minutes: 240,
  attendance_note:
    'Free entry. Advance booking is preferred and guarantees entry, but no tables are reserved. Walk-ins are welcome while capacity allows.',
  cancellation_policy:
    'There is no cancellation charge. If you can no longer attend, please cancel your booking so the place can be released to another guest.',
}

const specialHoursUpdate = {
  date: EVENT_DATE,
  opens: '12:00:00',
  closes: '00:00:00',
  kitchen_opens: '12:00:00',
  kitchen_closes: '18:00:00',
  is_closed: false,
  is_kitchen_closed: false,
  note: 'Halloween: pub open 12pm-midnight. Full menu 12pm-6pm. Kitchen closed 6pm-9pm. Pizza only 9pm-midnight for eating in and takeaway.',
  schedule_config: [
    {
      name: 'lunch',
      ends_at: '14:30',
      capacity: 50,
      starts_at: '12:00',
      booking_type: 'regular',
    },
    {
      name: 'early dinner',
      ends_at: '18:00',
      capacity: 50,
      starts_at: '17:00',
      booking_type: 'regular',
    },
  ],
}

async function main() {
  assertScriptMutationAllowed({ scriptName: SCRIPT_NAME, envVar: CONFIRM_ENV })

  const supabase = createAdminClient()

  const { data: existingEvent, error: existingEventError } = await supabase
    .from('events')
    .select('id, name, date')
    .eq('id', EVENT_ID)
    .maybeSingle()

  const checkedEvent = assertScriptQuerySucceeded({
    operation: 'Load Halloween event',
    error: existingEventError,
    data: existingEvent,
  })

  if (!checkedEvent || checkedEvent.date !== EVENT_DATE) {
    throw new Error(`Event ${EVENT_ID} is not the expected ${EVENT_DATE} Halloween event`)
  }

  const allowedNames = new Set([
    'Monster Mash: The Anchor Halloween Party',
    EVENT_TITLE,
  ])
  if (!allowedNames.has(checkedEvent.name)) {
    throw new Error(`Unexpected existing event name: ${checkedEvent.name}`)
  }

  const { data: updatedEvents, error: updateEventError } = await supabase
    .from('events')
    .update(eventUpdate)
    .eq('id', EVENT_ID)
    .eq('date', EVENT_DATE)
    .select('id')

  if (updateEventError) {
    throw new Error(`Update Halloween event failed: ${updateEventError.message}`)
  }
  assertScriptExpectedRowCount({
    operation: 'Update Halloween event',
    expected: 1,
    actual: updatedEvents?.length ?? 0,
  })

  const { data: updatedHours, error: updateHoursError } = await supabase
    .from('special_hours')
    .upsert(specialHoursUpdate, { onConflict: 'date' })
    .select('id')

  if (updateHoursError) {
    throw new Error(`Update Halloween special hours failed: ${updateHoursError.message}`)
  }
  assertScriptExpectedRowCount({
    operation: 'Update Halloween special hours',
    expected: 1,
    actual: updatedHours?.length ?? 0,
  })

  const [{ data: verifiedEvent, error: verifyEventError }, { data: verifiedHours, error: verifyHoursError }] =
    await Promise.all([
      supabase
        .from('events')
        .select('id, name, date, time, end_time, capacity, performer_name, booking_mode, brief')
        .eq('id', EVENT_ID)
        .single(),
      supabase
        .from('special_hours')
        .select('date, opens, closes, kitchen_opens, kitchen_closes, note')
        .eq('date', EVENT_DATE)
        .single(),
    ])

  if (verifyEventError) throw new Error(`Verify event failed: ${verifyEventError.message}`)
  if (verifyHoursError) throw new Error(`Verify special hours failed: ${verifyHoursError.message}`)
  if (verifiedEvent.name !== EVENT_TITLE || verifiedEvent.brief !== brief) {
    throw new Error('Event verification did not match the requested title and brief')
  }
  if (verifiedHours.opens !== '12:00:00' || verifiedHours.closes !== '00:00:00') {
    throw new Error('Special-hours verification did not match 12pm-midnight')
  }

  process.stdout.write(`${JSON.stringify({
    event: {
      id: verifiedEvent.id,
      name: verifiedEvent.name,
      date: verifiedEvent.date,
      time: verifiedEvent.time,
      end_time: verifiedEvent.end_time,
      capacity: verifiedEvent.capacity,
      performer_name: verifiedEvent.performer_name,
      booking_mode: verifiedEvent.booking_mode,
      brief_length: verifiedEvent.brief?.length ?? 0,
    },
    special_hours: verifiedHours,
  }, null, 2)}\n`)
}

main().catch((error) => {
  console.error(`[${SCRIPT_NAME}] Failed:`, error)
  process.exitCode = 1
})
