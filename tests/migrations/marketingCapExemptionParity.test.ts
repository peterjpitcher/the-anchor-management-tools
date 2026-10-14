import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The schedule-time guard (`describeFrequencyCapCollision`) lets staff put an ordinary
 * campaign right beside the monthly round-up, because a campaign flagged
 * `ignores_frequency_cap` is invisible to the cap in BOTH directions in SQL. That is only
 * safe while the SQL still says so. If a later migration redefined either function without
 * the exemption, the guard would wave through a send that then reaches nobody.
 *
 * These tests read the newest migration that defines each function, which is the definition
 * production runs, and fail if the exemption has gone.
 */

const migrationsDir = resolve(process.cwd(), 'supabase/migrations')

function latestDefinition(functionName: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${functionName}(`
  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .filter((name) => readFileSync(resolve(migrationsDir, name), 'utf8').includes(marker))

  const latest = files[files.length - 1]
  expect(latest, `no migration defines ${functionName}`).toBeDefined()

  const sql = readFileSync(resolve(migrationsDir, latest), 'utf8')
  const start = sql.lastIndexOf(marker)
  const end = sql.indexOf('$$;', start)
  return sql.slice(start, end)
}

describe('the round-up frequency cap exemption in SQL', () => {
  it('lets an exempt campaign through the cap when claiming recipients', () => {
    const body = latestDefinition('claim_marketing_recipients')
    expect(body).toContain('c.ignores_frequency_cap')
    expect(body).toMatch(/NOT COALESCE\(v_candidate\.ignores_frequency_cap, false\)/)
  })

  it('does not stamp the last-email time for an exempt send, so it cannot cap the next campaign', () => {
    const body = latestDefinition('finalise_marketing_send')
    expect(body).toContain('ignores_frequency_cap')
    expect(body).toContain('marketing_last_email_at = CASE WHEN v_exempt THEN marketing_last_email_at ELSE now() END')
    expect(body).toContain('last_marketing_email_at = CASE WHEN v_exempt THEN last_marketing_email_at ELSE now() END')
  })
})
