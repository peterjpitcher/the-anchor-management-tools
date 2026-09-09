/**
 * Closes the kitchen on Sunday 27 December, which is the only date in the festive run where
 * our records currently say it is open.
 *
 * Owner-confirmed 9 September 2026: open throughout December except the 26th and 1 January,
 * and the kitchen closed across the festive run. Every other date in the run either has a
 * `special_hours` row saying the kitchen is shut, or is a Monday, when the kitchen is closed
 * anyway. Sunday 27 December has neither, so it falls back to the ordinary week and resolves
 * to a roast served 1pm to 6pm. The website, the booking system and the phone line all answer
 * from these records, so it has been offering a Sunday roast that will not exist.
 *
 * Bar hours are the ordinary Sunday, 12pm to 10pm, which is also what every other Sunday in
 * the run already carries, so the two agree and nothing is being invented.
 *
 * NOT TOUCHED, because the owner's wording does not settle them:
 *   Sun 20 Dec  the kitchen still resolves open, 1pm to 6pm. "Closed from December 20th"
 *               could include the 20th, but the SSOT has the last Christmas sitting ON the
 *               20th. Those cannot both be right.
 *   The Mondays 21, 28 Dec, 4 and 11 Jan open at 4pm rather than the midday the rest of the
 *               run uses. The kitchen is correctly closed on all four either way.
 *
 * Dry run by default. RUN_CLOSE_KITCHEN_27_DEC=true applies it.
 */
import { config } from 'dotenv'

config({ path: '.env.local' })

import { assertScriptMutationAllowed } from '@/lib/script-mutation-safety'
import { createAdminClient } from '@/lib/supabase/admin'

const DATE = '2026-12-27'
const OWNER_USER_ID = 'b44dd268-7c66-4163-8ff3-cc962b2d528c'

const ROW = {
  date: DATE,
  opens: '12:00:00',
  closes: '22:00:00',
  is_closed: false,
  is_kitchen_closed: true,
  kitchen_opens: null,
  kitchen_closes: null,
  note: 'Kitchen closed for the festive run. Bar open as usual.',
}

async function main(): Promise<void> {
  const supabase = createAdminClient()

  const { data: existing, error } = await supabase
    .from('special_hours')
    .select('*')
    .eq('date', DATE)
    .maybeSingle()
  if (error) throw new Error(error.message)

  if (existing) {
    console.warn(`A row for ${DATE} already exists: ${JSON.stringify(existing)}`)
    console.warn('Nothing to do. Check it by hand rather than letting this script overwrite it.')
    return
  }

  console.warn(`No special_hours row for ${DATE} (Sunday), so it currently resolves to:`)
  console.warn('  bar 12:00 to 22:00, kitchen 13:00 to 18:00  <- the roast that will not be served')
  console.warn('\nWould insert:')
  console.warn(`  ${JSON.stringify(ROW)}`)

  assertScriptMutationAllowed({
    scriptName: 'close-kitchen-27-december',
    envVar: 'RUN_CLOSE_KITCHEN_27_DEC',
  })

  const { error: insertError } = await supabase.from('special_hours').insert(ROW)
  if (insertError) throw new Error(insertError.message)

  await supabase.from('audit_logs').insert({
    user_id: OWNER_USER_ID,
    operation_type: 'create',
    resource_type: 'special_hours',
    resource_id: null,
    operation_status: 'success',
    new_values: ROW,
    additional_info: {
      reason:
        'The only date in the 20 Dec to 11 Jan run where the kitchen resolved open. Owner ' +
        'confirmed the kitchen is closed across the run.',
      script: 'close-kitchen-27-december',
    },
  })

  const { data: after, error: readError } = await supabase
    .from('special_hours')
    .select('date,opens,closes,is_closed,is_kitchen_closed')
    .eq('date', DATE)
    .single()
  if (readError) throw new Error(readError.message)
  if (!after.is_kitchen_closed) throw new Error('The row did not take is_kitchen_closed.')

  console.warn(`\nVerified: ${after.date}, bar ${after.opens} to ${after.closes}, kitchen closed.`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
