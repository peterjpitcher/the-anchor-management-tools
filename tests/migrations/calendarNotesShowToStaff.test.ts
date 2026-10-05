import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationSql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20261005110338_calendar_notes_show_to_staff.sql'),
  'utf8'
)

describe('calendar notes "Show to staff" migration', () => {
  it('adds the tick as a column that is on unless a manager turns it off', () => {
    expect(migrationSql).toMatch(
      /ADD COLUMN IF NOT EXISTS show_to_staff boolean NOT NULL DEFAULT true/
    )
  })

  it('hides the eighteen school and exam notes by id, not by a pattern', () => {
    const hidden = migrationSql.match(/SET show_to_staff = false\s+WHERE id IN \(([\s\S]*?)\);/)
    expect(hidden).not.toBeNull()
    const ids = hidden![1].match(/'[0-9a-f-]{36}'/g) ?? []
    expect(ids).toHaveLength(18)
    expect(new Set(ids).size).toBe(18)
  })

  it('does not re-send the hidden notes to Google, and leaves the sync trigger on afterwards', () => {
    // The trigger queues a Google write on every UPDATE. It is off only inside one DO block,
    // which is a single statement, so a failure rolls the DISABLE back with everything else.
    const block = migrationSql.match(/DO \$\$([\s\S]*?)\$\$;/)
    expect(block).not.toBeNull()
    const body = block![1]
    const disable = body.indexOf('DISABLE TRIGGER queue_calendar_note_google_sync')
    const update = body.indexOf('SET show_to_staff = false')
    const enable = body.indexOf('ENABLE TRIGGER queue_calendar_note_google_sync')
    expect(disable).toBeGreaterThan(-1)
    expect(update).toBeGreaterThan(disable)
    expect(enable).toBeGreaterThan(update)
  })

  it('leaves the Google sync queue and its functions alone', () => {
    expect(migrationSql).not.toContain('calendar_note_google_sync_queue')
    expect(migrationSql).not.toMatch(/CREATE OR REPLACE FUNCTION/i)
    expect(migrationSql).not.toMatch(/DROP TRIGGER/i)
  })
})
