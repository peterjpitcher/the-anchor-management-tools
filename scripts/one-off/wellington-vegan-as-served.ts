/**
 * Describes the Wellington as it is actually served, and flags it vegan.
 *
 * Owner-confirmed 9 September 2026, and it is the opposite of what I first assumed. The
 * Wellington's DEFAULT plate is vegan. The cabbage and the Yorkshire pudding are not part of
 * it: they are additions, offered on request for people who order the Wellington because they
 * fancy it rather than because they are vegan. The pub does not make unbuttered cabbage, so
 * the cabbage can never be on the vegan plate at all.
 *
 * So the SSOT was right all along and every description was wrong in the same way. The
 * original listed a Yorkshire pudding and buttery cabbage on a vegan dish. My first
 * correction removed the Yorkshire and the word "buttery" but kept "sauteed cabbage", which
 * is still wrong: there is no unbuttered cabbage to serve. This removes it and says what a
 * guest can actually ask for.
 *
 * It also adds the `vegan` dietary flag to the menu_dishes row, which was an empty array. I
 * held that back until the plate was settled, because a filter flag is a stronger claim than
 * prose and would have put a buttered plate in front of a vegan. Now that the default plate
 * is confirmed vegan, the flag is simply missing data.
 *
 * BOTH COPIES AGAIN. sunday_lunch_menu_items feeds the booking system, menu_dishes feeds the
 * website. They drift independently and both were wrong.
 *
 * Dry run by default. RUN_WELLINGTON_VEGAN_FIX=true applies it.
 */
import { config } from 'dotenv'

config({ path: '.env.local' })

import { assertScriptMutationAllowed } from '@/lib/script-mutation-safety'
import { createAdminClient } from '@/lib/supabase/admin'

const OWNER_USER_ID = 'b44dd268-7c66-4163-8ff3-cc962b2d528c'
const BOOKING_ROW = '7da6244a-1588-44fc-ae2c-94c077ae844f'
const WEBSITE_ROW = '8f455e9d-e7cc-42e7-8639-de63466e17e0'

const DESCRIPTION =
  'Golden puff pastry filled with beetroot and butternut squash, served with triple-cooked, ' +
  'herb-and-garlic crusted roast potatoes, oven-roasted carrots and parsnips and our vegan ' +
  'gravy. Fully vegan as it comes. Ask if you would like buttered cabbage or a Yorkshire ' +
  'pudding added, both of which make the plate no longer vegan.'

const FORBIDDEN: ReadonlyArray<readonly [RegExp, string]> = [
  [/served with[^.]*yorkshire/i, 'a Yorkshire pudding must never be part of the default plate'],
  [/served with[^.]*cabbage/i, 'there is no unbuttered cabbage, so it cannot be on the vegan plate'],
  [/herb-crusted/i, 'the approved phrase is "triple-cooked, herb-and-garlic crusted"'],
  [/vegetarian/i, 'the SSOT requires "vegan", never "vegetarian", for this dish'],
  [/^(Delight in|Indulge in|Savour|Enjoy|Experience|Discover|Treat yourself)/i, 'menu-cliche opener'],
]

async function main(): Promise<void> {
  const supabase = createAdminClient()

  const breaches = FORBIDDEN.filter(([pattern]) => pattern.test(DESCRIPTION))
  if (breaches.length > 0) {
    throw new Error(`Replacement breaks its own rules: ${breaches.map(([, why]) => why).join('; ')}`)
  }
  if (!/vegan/i.test(DESCRIPTION)) throw new Error('The description must say the dish is vegan.')
  console.warn(`NEW DESCRIPTION:\n  ${DESCRIPTION}\n`)

  const { data: bookingBefore } = await supabase
    .from('sunday_lunch_menu_items').select('description').eq('id', BOOKING_ROW).single()
  const { data: websiteBefore } = await supabase
    .from('menu_dishes').select('description,dietary_flags').eq('id', WEBSITE_ROW).single()
  console.warn(`booking row now : ${bookingBefore?.description}`)
  console.warn(`website row now : ${websiteBefore?.description}`)
  console.warn(`website flags   : ${JSON.stringify(websiteBefore?.dietary_flags)} -> ["vegan"]`)

  assertScriptMutationAllowed({
    scriptName: 'wellington-vegan-as-served',
    envVar: 'RUN_WELLINGTON_VEGAN_FIX',
  })

  const { error: e1 } = await supabase
    .from('sunday_lunch_menu_items').update({ description: DESCRIPTION }).eq('id', BOOKING_ROW)
  if (e1) throw new Error(`booking row: ${e1.message}`)

  const existingFlags: string[] = Array.isArray(websiteBefore?.dietary_flags) ? websiteBefore.dietary_flags : []
  const flags = existingFlags.includes('vegan') ? existingFlags : [...existingFlags, 'vegan']
  const { error: e2 } = await supabase
    .from('menu_dishes').update({ description: DESCRIPTION, dietary_flags: flags }).eq('id', WEBSITE_ROW)
  if (e2) throw new Error(`website row: ${e2.message}`)

  await supabase.from('audit_logs').insert({
    user_id: OWNER_USER_ID,
    operation_type: 'update',
    resource_type: 'menu_dish',
    resource_id: WEBSITE_ROW,
    operation_status: 'success',
    old_values: { description: websiteBefore?.description, dietary_flags: websiteBefore?.dietary_flags },
    new_values: { description: DESCRIPTION, dietary_flags: flags },
    additional_info: {
      reason:
        'Owner confirmed the default plate is vegan and that cabbage and Yorkshire are ' +
        'additions on request. The pub makes no unbuttered cabbage, so it cannot be on the ' +
        'default plate. Vegan flag added now the plate is settled.',
      script: 'wellington-vegan-as-served',
    },
  })

  const { data: a } = await supabase.from('sunday_lunch_menu_items').select('description').eq('id', BOOKING_ROW).single()
  const { data: b } = await supabase.from('menu_dishes').select('description,dietary_flags').eq('id', WEBSITE_ROW).single()
  if (a?.description !== DESCRIPTION) throw new Error('The booking row did not take the change.')
  if (b?.description !== DESCRIPTION) throw new Error('The website row did not take the change.')
  if (!(b?.dietary_flags as string[]).includes('vegan')) throw new Error('The vegan flag is not on the website row.')

  console.warn('\nVerified from the database. Both rows updated, website row flagged vegan.')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
