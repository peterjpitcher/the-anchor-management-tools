/**
 * Corrects the Wellington description in `menu_dishes`, which is the row the WEBSITE renders.
 *
 * READ THIS BEFORE ASSUMING ONE FIX IS ENOUGH. The Sunday roast menu exists twice in this
 * database:
 *
 *   `sunday_lunch_menu_items`  the booking and pre-order system reads this
 *   `menu_dishes`              the website's /sunday-lunch page reads this
 *
 * They hold different text for the same dishes and drift independently. I corrected the
 * Wellington in `sunday_lunch_menu_items` first and the live page did not change, because
 * that is not where the page gets its words. Both rows had the same fault. Fixing either
 * alone leaves the other wrong, and only this one is on the page a guest reads.
 *
 * The fault: the description lists "a fluffy Yorkshire pudding" and "buttery cabbage" on a
 * dish the SSOT defines as fully vegan. Yorkshire pudding is egg and milk. It also opens with
 * "Enjoy a", loses the garlic from the approved potato phrase, and calls the gravy "rich"
 * when the Wellington's default is specifically the vegan one.
 *
 * WHAT THIS DOES NOT DO. `dietary_flags` on this row is an empty array, so the dish is not
 * marked vegan in the data at all and no dietary filter will surface it. The SSOT says it is
 * fully vegan, so the flag looks simply missing. I have not added it, because a filter flag
 * is a stronger claim than prose and the cabbage question is still open: if it is cooked in
 * butter the dish is not vegan and the flag would be actively harmful. That one needs the
 * kitchen, not a script.
 *
 * Dry run by default. RUN_WELLINGTON_MENU_DISH_FIX=true applies it.
 */
import { config } from 'dotenv'

config({ path: '.env.local' })

import { assertScriptMutationAllowed } from '@/lib/script-mutation-safety'
import { createAdminClient } from '@/lib/supabase/admin'

const DISH_ID = '8f455e9d-e7cc-42e7-8639-de63466e17e0'
const OWNER_USER_ID = 'b44dd268-7c66-4163-8ff3-cc962b2d528c'

const CORRECTED =
  'Golden puff pastry filled with beetroot and butternut squash, served with triple-cooked, ' +
  'herb-and-garlic crusted roast potatoes, oven-roasted carrots and parsnips, sauteed cabbage ' +
  'and our vegan gravy.'

const FORBIDDEN: ReadonlyArray<readonly [RegExp, string]> = [
  [/yorkshire/i, 'Yorkshire pudding is egg and milk; this dish is fully vegan'],
  [/buttery|butter\b/i, 'butter is dairy; this dish is fully vegan'],
  [/herb-crusted/i, 'the approved phrase is "triple-cooked, herb-and-garlic crusted"'],
  [/red wine gravy/i, 'the SSOT forbids describing our gravy as red wine gravy'],
  [/vegetarian/i, 'the SSOT requires "vegan", never "vegetarian", for this dish'],
  [/^(Delight in|Indulge in|Savour|Enjoy|Experience|Discover|Treat yourself)/i, 'menu-cliche opener'],
]

async function main(): Promise<void> {
  const supabase = createAdminClient()

  const { data: before, error } = await supabase
    .from('menu_dishes')
    .select('id,name,description,is_active,dietary_flags')
    .eq('id', DISH_ID)
    .single()
  if (error) throw new Error(error.message)

  console.warn(`${before.name} (${before.is_active ? 'active' : 'inactive'})`)
  console.warn(`dietary_flags: ${JSON.stringify(before.dietary_flags)}  <- empty, see the note in this file`)
  console.warn(`\nBEFORE:\n  ${before.description}`)
  console.warn(`\nAFTER:\n  ${CORRECTED}`)

  const breaches = FORBIDDEN.filter(([pattern]) => pattern.test(CORRECTED))
  if (breaches.length > 0) {
    throw new Error(`Replacement breaks its own rules: ${breaches.map(([, why]) => why).join('; ')}`)
  }

  assertScriptMutationAllowed({
    scriptName: 'fix-wellington-in-menu-dishes',
    envVar: 'RUN_WELLINGTON_MENU_DISH_FIX',
  })

  const { error: updateError } = await supabase
    .from('menu_dishes')
    .update({ description: CORRECTED })
    .eq('id', DISH_ID)
  if (updateError) throw new Error(updateError.message)

  const { error: auditError } = await supabase.from('audit_logs').insert({
    user_id: OWNER_USER_ID,
    operation_type: 'update',
    resource_type: 'menu_dish',
    resource_id: DISH_ID,
    operation_status: 'success',
    old_values: { description: before.description },
    new_values: { description: CORRECTED },
    additional_info: {
      reason:
        'The website renders this row. It listed a Yorkshire pudding and buttery cabbage on a ' +
        'dish the SSOT defines as fully vegan. dietary_flags is still empty and needs the ' +
        'kitchen to confirm before anything is added.',
      script: 'fix-wellington-in-menu-dishes',
    },
  })
  if (auditError) console.warn(`  (audit row failed: ${auditError.message})`)

  const { data: after, error: readError } = await supabase
    .from('menu_dishes').select('description').eq('id', DISH_ID).single()
  if (readError) throw new Error(readError.message)
  const stillWrong = FORBIDDEN.filter(([pattern]) => pattern.test(after.description))
  if (stillWrong.length > 0) throw new Error(`Still breaching: ${stillWrong.map(([, w]) => w).join('; ')}`)

  console.warn('\nVerified from the database:')
  console.warn(`  ${after.description}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
