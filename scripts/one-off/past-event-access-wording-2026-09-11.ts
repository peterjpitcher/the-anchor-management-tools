/**
 * Gives the past events the same access wording the upcoming ones got on 11 September 2026.
 *
 * Eight past events still carry the old template, "The beer garden has steps, with a ramp available
 * on request". There is one step, between the bar and the garden, and the garden is step free from
 * the car park (website SSOT §8 and §16). Past event pages stay public, so the wrong sentence was
 * still live on them. The upcoming events were corrected by migration 20260911172000 and its
 * follow-up; this uses the exact text those rows carry now, read from the database, so nothing is
 * retyped and every event says the same thing.
 *
 * Only rows whose notes equal the old template are touched.
 *
 * Dry run by default. RUN_PAST_EVENT_ACCESS_WORDING=true applies it.
 */
import { config } from 'dotenv'

config({ path: '.env.local' })

import { assertScriptMutationAllowed } from '@/lib/script-mutation-safety'
import { createAdminClient } from '@/lib/supabase/admin'

const OWNER_USER_ID = 'b44dd268-7c66-4163-8ff3-cc962b2d528c'
const OLD_TEMPLATE =
  'The bar and dining area are step-free from the level car park. The beer garden has steps, with a ramp available on request. We do not currently have an accessible toilet. Assistance dogs are welcome. Please call 01753 682707 to discuss specific access needs.'
const APPROVED_START = 'Getting in from the car park is step free, and so are the bar and the dining area.'

async function main(): Promise<void> {
  const supabase = createAdminClient()

  // The approved block, exactly as the corrected upcoming events hold it.
  const { data: approvedRows, error: approvedError } = await supabase
    .from('events')
    .select('accessibility_notes')
    .like('accessibility_notes', `${APPROVED_START}%Assistance dogs are always welcome.`)
  if (approvedError) throw new Error(approvedError.message)
  const variants = [...new Set((approvedRows ?? []).map((r) => String(r.accessibility_notes)))]
  if (variants.length !== 1) throw new Error(`Expected one approved access block, found ${variants.length}.`)
  const approved = variants[0]

  const { data: targets, error } = await supabase
    .from('events')
    .select('id,name,date')
    .eq('accessibility_notes', OLD_TEMPLATE)
    .order('date')
  if (error) throw new Error(error.message)

  console.warn(`${targets?.length ?? 0} event(s) still carry the old template:`)
  for (const t of targets ?? []) console.warn(`  ${t.date} ${t.name}`)
  console.warn(`\nThey will read:\n  ${approved}`)

  assertScriptMutationAllowed({ scriptName: 'past-event-access-wording-2026-09-11', envVar: 'RUN_PAST_EVENT_ACCESS_WORDING' })

  for (const t of targets ?? []) {
    const { data, error: updateError } = await supabase
      .from('events')
      .update({ accessibility_notes: approved })
      .eq('id', t.id)
      .eq('accessibility_notes', OLD_TEMPLATE)
      .select('id')
    if (updateError) throw new Error(`${t.name}: ${updateError.message}`)
    if (!data?.length) throw new Error(`${t.name}: changed under us, stopped.`)
    await supabase.from('audit_logs').insert({
      user_id: OWNER_USER_ID,
      operation_type: 'update',
      resource_type: 'event',
      resource_id: t.id,
      operation_status: 'success',
      old_values: { accessibility_notes: OLD_TEMPLATE },
      new_values: { accessibility_notes: approved },
      additional_info: { reason: 'Access wording follows SSOT §16, owner-approved 2026-09-11.', script: 'past-event-access-wording-2026-09-11' },
    })
  }

  const { count } = await supabase
    .from('events')
    .select('id', { count: 'exact', head: true })
    .ilike('accessibility_notes', '%garden has steps%')
  console.warn(`\nVerified from the database: ${count ?? 0} event(s) still say the garden has steps.`)
  if ((count ?? 0) > 0) throw new Error('Some rows did not take the change.')
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
