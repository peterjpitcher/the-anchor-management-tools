/** One-off approved API key cleanup. Dry-run unless RUN_API_KEY_HARDENING_MUTATION=true. */
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { assertScriptMutationAllowed } from '../../src/lib/script-mutation-safety'

config({ path: '.env.local' })
const mutate = process.env.RUN_API_KEY_HARDENING_MUTATION === 'true'
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const secret = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !secret || new URL(url).hostname !== 'tfcasgxopxegwrabvwat.supabase.co') {
  throw new Error('Expected verified Anchor management production project')
}
const db = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } })
type KeyState = { id: string; name: string; permissions: string[]; is_active: boolean; last_used_at: string | null; updated_at: string | null }
const targets = [
  { id: 'f48a6a54-f8d9-4f32-a9e2-85f31b22968c', name: 'cheersai', expected: ['read:menu', 'read:events', 'payments:capture', 'read:events:artwork'], permissions: ['read:menu', 'read:events', 'read:events:artwork'] },
  { id: 'bad66673-de96-4830-8264-8d2debe55576', name: 'Musi Bingo', expected: ['*'], permissions: ['read:events'] },
  { id: '2dc1c9f1-082f-4077-baf8-d5bd2ea0f19b', name: 'Music Bingo App', expected: ['*'] },
  { id: '3cf3f43f-0645-4212-803d-cee1f162309b', name: 'Development API Key', expected: ['read:events', 'read:menu', 'write:bookings', 'payments:capture'] },
  { id: 'f4043546-bd4a-48eb-af38-06c466547a82', name: 'Development API Key', expected: ['read:events', 'read:menu', 'read:business', 'read:table_bookings', 'write:table_bookings', 'create:bookings', 'read:customers', 'write:customers', 'payments:capture'] },
  { id: '1c80c23c-e765-4148-8d82-2a5d05a9e93e', name: 'Development API Key', expected: ['read:events', 'read:menu', 'write:bookings', 'payments:capture'] },
]
function same(a: string[], b: string[]): boolean { return JSON.stringify([...a].sort()) === JSON.stringify([...b].sort()) }
async function main(): Promise<void> {
  const { data, error } = await db.from('api_keys').select('id,name,permissions,is_active,last_used_at,updated_at').in('id', targets.map(t => t.id))
  if (error || data?.length !== targets.length) throw new Error('Cannot verify all six API keys')
  const plans = targets.map(target => {
    const before = (data as KeyState[]).find(row => row.id === target.id)!
    const after = { permissions: target.permissions ?? before.permissions, is_active: Boolean(target.permissions) }
    if (before.name !== target.name) throw new Error('API key identity changed')
    if (same(before.permissions, after.permissions) && before.is_active === after.is_active) return { before, after, skip: true }
    if (!before.is_active || !same(before.permissions, target.expected)) throw new Error('API key state changed since approval')
    if (!target.permissions && before.last_used_at && before.last_used_at >= '2026-01-01') throw new Error('Dormant API key has recent use; stop for review')
    return { before, after, skip: false }
  })
  for (const plan of plans) {
    process.stdout.write(JSON.stringify({ id: plan.before.id, name: plan.before.name, before: { permissions: plan.before.permissions, is_active: plan.before.is_active }, after: plan.after, mode: mutate ? 'apply' : 'dry-run', alreadyApplied: plan.skip }) + '\n')
  }
  if (!mutate) return
  assertScriptMutationAllowed({ scriptName: 'harden-integration-keys', envVar: 'RUN_API_KEY_HARDENING_MUTATION' })
  for (const { before, after, skip } of plans) {
    if (skip) continue
    let change = db.from('api_keys').update(after).eq('id', before.id).eq('permissions', JSON.stringify(before.permissions)).eq('is_active', before.is_active)
    change = before.updated_at ? change.eq('updated_at', before.updated_at) : change.is('updated_at', null)
    if (!after.is_active) change = before.last_used_at ? change.eq('last_used_at', before.last_used_at) : change.is('last_used_at', null)
    const result = await change.select('id,permissions,is_active,updated_at').single()
    if (result.error || !result.data) throw new Error(`Conditional API key update failed for ${before.id}`)
    const audit = await db.from('audit_logs').insert({
      operation_type: 'update', resource_type: 'api_key', resource_id: before.id, operation_status: 'success',
      old_values: { permissions: before.permissions, is_active: before.is_active }, new_values: after,
      additional_info: { source: 'harden-integration-keys', reason: 'Owner-approved API connection remediation, 2026-09-05' },
    })
    if (audit.error) {
      let rollback = db.from('api_keys').update({ permissions: before.permissions, is_active: before.is_active }).eq('id', before.id).eq('permissions', JSON.stringify(after.permissions)).eq('is_active', after.is_active)
      rollback = result.data.updated_at ? rollback.eq('updated_at', result.data.updated_at) : rollback.is('updated_at', null)
      const restored = await rollback.select('id').single()
      throw new Error(`Audit failed for ${before.id}; rollback ${restored.error ? 'FAILED, manual review required' : 'completed'}`)
    }
    process.stdout.write(`Updated and audited ${before.name} (${before.id})\n`)
  }
  const verified = await db.from('api_keys').select('id,permissions,is_active').in('id', targets.map(t => t.id))
  if (verified.error || !plans.every(p => verified.data?.some(row => row.id === p.before.id && row.is_active === p.after.is_active && same(row.permissions, p.after.permissions)))) throw new Error('Post-change verification failed')
  process.stdout.write('All six key settings verified. No key material changed.\n')
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'API key cleanup failed'); process.exitCode = 1 })
