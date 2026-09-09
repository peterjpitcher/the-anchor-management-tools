/**
 * Prices the Tasting Night, which is stored as free.
 *
 * Owner-confirmed 9 September 2026: £45 a person, with £5 off tickets bought in advance. The
 * event row says `is_free = true` and `price = 0`, so the website has been advertising a
 * premium spirit tasting for nothing. It is why I left it out of the October and November
 * round-ups twice.
 *
 * The discount only works on a prepaid event. `resolveEventOnlineDiscountAmount` in
 * `src/lib/events/pricing.ts` returns 0 unless `payment_mode === 'prepaid'`, so setting the
 * discount without the payment mode would quietly do nothing and sell every ticket at £45.
 * No event has ever used these two columns before, so that path is worth stating rather than
 * assuming.
 *
 * Safe to change: the event has zero bookings, so nobody has booked it expecting free.
 *
 * Dry run by default. RUN_TASTING_NIGHT_PRICING=true applies it.
 */
import { config } from 'dotenv'

config({ path: '.env.local' })

import { resolveEventOnlineDiscountAmount, resolveEventTicketPriceAmount } from '@/lib/events/pricing'
import { assertScriptMutationAllowed } from '@/lib/script-mutation-safety'
import { createAdminClient } from '@/lib/supabase/admin'

const EVENT_ID = '5bd854ce-48e7-4ca8-8e7c-c52cc7ec1e65'
const OWNER_USER_ID = 'b44dd268-7c66-4163-8ff3-cc962b2d528c'

const CHANGES = {
  is_free: false,
  price: 45,
  payment_mode: 'prepaid',
  online_discount_type: 'fixed',
  online_discount_value: 5,
} as const

async function main(): Promise<void> {
  const supabase = createAdminClient()

  const { data: before, error } = await supabase
    .from('events')
    .select('id,name,date,capacity,booking_open,is_free,price,payment_mode,online_discount_type,online_discount_value,poster_image_url')
    .eq('id', EVENT_ID)
    .single()
  if (error) throw new Error(error.message)

  const { count } = await supabase
    .from('bookings')
    .select('id', { count: 'exact', head: true })
    .eq('event_id', EVENT_ID)
  if ((count ?? 0) > 0) {
    throw new Error(`${before.name} already has ${count} booking(s). Repricing it would change what they owe.`)
  }

  console.warn(`${before.name}, ${before.date}`)
  console.warn(`  before: is_free ${before.is_free}, price ${before.price}, payment_mode ${before.payment_mode}, discount ${before.online_discount_type ?? 'none'}`)
  console.warn(`  after : is_free false, price 45, payment_mode prepaid, discount fixed 5`)

  // Prove the pricing helpers produce the two numbers the owner stated, before writing.
  const after = { ...before, ...CHANGES }
  const door = resolveEventTicketPriceAmount(after as never)
  const online = door - resolveEventOnlineDiscountAmount(after as never)
  console.warn(`\n  on the door: £${door.toFixed(2)}`)
  console.warn(`  in advance : £${online.toFixed(2)}`)
  if (door !== 45 || online !== 40) {
    throw new Error(`Expected £45 on the door and £40 in advance, computed £${door} and £${online}.`)
  }

  if (!before.poster_image_url) {
    console.warn('\n  NOTE: this event still has no artwork, so it cannot go in a round-up email yet.')
  }

  assertScriptMutationAllowed({
    scriptName: 'fix-tasting-night-pricing',
    envVar: 'RUN_TASTING_NIGHT_PRICING',
  })

  const { error: updateError } = await supabase.from('events').update(CHANGES).eq('id', EVENT_ID)
  if (updateError) throw new Error(updateError.message)

  await supabase.from('audit_logs').insert({
    user_id: OWNER_USER_ID,
    operation_type: 'update',
    resource_type: 'event',
    resource_id: EVENT_ID,
    operation_status: 'success',
    old_values: {
      is_free: before.is_free, price: before.price, payment_mode: before.payment_mode,
      online_discount_type: before.online_discount_type, online_discount_value: before.online_discount_value,
    },
    new_values: CHANGES,
    additional_info: { reason: 'Owner-confirmed pricing: GBP 45, GBP 5 off in advance. Was stored as free.', script: 'fix-tasting-night-pricing' },
  })

  const { data: verify, error: verifyError } = await supabase
    .from('events')
    .select('is_free,price,payment_mode,online_discount_type,online_discount_value')
    .eq('id', EVENT_ID)
    .single()
  if (verifyError) throw new Error(verifyError.message)

  const doorAfter = resolveEventTicketPriceAmount(verify as never)
  const onlineAfter = doorAfter - resolveEventOnlineDiscountAmount(verify as never)
  console.warn(`\nVerified from the database: £${doorAfter.toFixed(2)} on the door, £${onlineAfter.toFixed(2)} in advance.`)
  if (doorAfter !== 45 || onlineAfter !== 40) throw new Error('The stored row does not price as expected.')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
