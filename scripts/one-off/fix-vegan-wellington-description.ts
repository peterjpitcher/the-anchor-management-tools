/**
 * Corrects the Sunday roast Wellington description, which contradicts itself on a live page.
 *
 * The row currently reads "...served with triple-cooked herb-crusted roast potatoes, a fluffy
 * Yorkshire pudding, oven-roasted carrots and parsnips, buttery sauteed cabbage and gravy."
 * The same page calls the dish fully vegan. Yorkshire pudding is egg and milk. The
 * description publishes straight from this table to the website, so the page cannot be fixed
 * without fixing the row.
 *
 * Four changes, each against a named rule in the website's docs/SSOT.md:
 *
 *   1. The Yorkshire pudding goes.      §4 accompaniments: Yorkshire comes with the three
 *                                       sliced roasts and the kids roast. The Wellington
 *                                       table row says "No". §7 repeats it.
 *   2. "buttery" leaves the cabbage.    A vegan plate cannot be buttered. This is the safe
 *                                       direction: "sauteed cabbage" claims nothing either
 *                                       way. See the note below, this one needs the kitchen.
 *   3. The gravy is named.              §4 gravy rules: the regular gravy is fully vegan and
 *                                       is the default with the Wellington; the signature
 *                                       gravy contains meat stock. A bare "gravy" on a vegan
 *                                       dish is the same ambiguity as the Yorkshire.
 *   4. The potato phrase is restored.   §4: "The correct phrase is 'triple-cooked,
 *                                       herb-and-garlic crusted'." The row had lost the
 *                                       garlic, as have the other ten active rows.
 *
 * WHAT THIS SCRIPT CANNOT SETTLE. If the cabbage really is cooked in butter, the dish is not
 * vegan and the problem is the kitchen's, not the copy's. Removing the word stops the
 * description asserting dairy; it does not make the plate vegan. That needs the kitchen to
 * confirm, and it is flagged to the owner.
 *
 * Dry run by default. RUN_WELLINGTON_DESCRIPTION_FIX=true applies it.
 */
import { config } from 'dotenv'

config({ path: '.env.local' })

import { assertScriptMutationAllowed } from '@/lib/script-mutation-safety'
import { createAdminClient } from '@/lib/supabase/admin'

const ITEM_ID = '7da6244a-1588-44fc-ae2c-94c077ae844f'
const OWNER_USER_ID = 'b44dd268-7c66-4163-8ff3-cc962b2d528c'

const CORRECTED =
  'Golden puff pastry filled with beetroot and butternut squash, served with triple-cooked, ' +
  'herb-and-garlic crusted roast potatoes, oven-roasted carrots and parsnips, sauteed cabbage ' +
  'and our vegan gravy.'

/** Things that must not appear in this dish's description, with the reason. */
const FORBIDDEN: ReadonlyArray<readonly [RegExp, string]> = [
  [/yorkshire/i, 'Yorkshire pudding contains egg and milk; the Wellington is fully vegan'],
  [/buttery|butter\b/i, 'butter is dairy; the Wellington is fully vegan'],
  [/herb-crusted/i, 'the approved phrase is "triple-cooked, herb-and-garlic crusted"'],
  [/red wine gravy/i, 'the SSOT forbids describing our gravy as red wine gravy'],
  [/vegetarian/i, 'the SSOT requires "vegan", never "vegetarian", for this dish'],
]

async function main(): Promise<void> {
  const supabase = createAdminClient()

  const { data: before, error } = await supabase
    .from('sunday_lunch_menu_items')
    .select('id,name,description,is_active')
    .eq('id', ITEM_ID)
    .single()
  if (error) throw new Error(error.message)

  console.warn(`${before.name} (${before.is_active ? 'active' : 'inactive'})`)
  console.warn(`\nBEFORE:\n  ${before.description}`)
  console.warn(`\nAFTER:\n  ${CORRECTED}`)

  const breaches = FORBIDDEN.filter(([pattern]) => pattern.test(CORRECTED))
  if (breaches.length > 0) {
    throw new Error(`The replacement text breaks its own rules: ${breaches.map(([, why]) => why).join('; ')}`)
  }
  console.warn('\nReplacement text passes every rule it is meant to satisfy.')

  assertScriptMutationAllowed({
    scriptName: 'fix-vegan-wellington-description',
    envVar: 'RUN_WELLINGTON_DESCRIPTION_FIX',
  })

  const { error: updateError } = await supabase
    .from('sunday_lunch_menu_items')
    .update({ description: CORRECTED })
    .eq('id', ITEM_ID)
  if (updateError) throw new Error(updateError.message)

  // Menu descriptions have no server action and therefore no audit trail of their own. This
  // one changes a dietary claim on a live page, so it gets a row written by hand.
  const { error: auditError } = await supabase.from('audit_logs').insert({
    user_id: OWNER_USER_ID,
    operation_type: 'update',
    resource_type: 'sunday_lunch_menu_item',
    resource_id: ITEM_ID,
    operation_status: 'success',
    old_values: { description: before.description },
    new_values: { description: CORRECTED },
    additional_info: {
      reason:
        'The description listed a Yorkshire pudding on a dish the SSOT defines as fully vegan, ' +
        'and published straight to the website. Also restored the approved potato phrase and ' +
        'named the vegan gravy.',
      script: 'fix-vegan-wellington-description',
    },
  })
  if (auditError) console.warn(`  (audit row failed: ${auditError.message})`)

  const { data: after, error: readError } = await supabase
    .from('sunday_lunch_menu_items')
    .select('description')
    .eq('id', ITEM_ID)
    .single()
  if (readError) throw new Error(readError.message)
  if (after.description !== CORRECTED) throw new Error('The row did not take the new description.')

  const stillWrong = FORBIDDEN.filter(([pattern]) => pattern.test(after.description))
  if (stillWrong.length > 0) throw new Error(`Still breaching: ${stillWrong.map(([, why]) => why).join('; ')}`)

  console.warn('\nVerified from the database. The row now reads:')
  console.warn(`  ${after.description}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
