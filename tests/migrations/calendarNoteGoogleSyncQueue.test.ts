import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationSql = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260730000000_calendar_note_google_sync_queue.sql'
  ),
  'utf8'
)

describe('calendar note Google sync queue migration', () => {
  it('queues every kind of calendar note change and backfills existing notes', () => {
    expect(migrationSql).toMatch(
      /AFTER INSERT OR UPDATE OR DELETE ON public\.calendar_notes/
    )
    expect(migrationSql).toMatch(
      /SELECT id, 'upsert'\s+FROM public\.calendar_notes/
    )
  })

  it('claims only available work with no live lease', () => {
    expect(migrationSql).toContain('queue.available_at <= now()')
    expect(migrationSql).toMatch(
      /queue\.processing_token IS NULL OR\s+queue\.lease_expires_at IS NULL OR\s+queue\.lease_expires_at <= now\(\)/
    )
  })

  it('does not let a stale worker replace a newer live claim', () => {
    expect(migrationSql).toContain(
      'queue.processing_token IS DISTINCT FROM p_processing_token'
    )
    expect(migrationSql).toContain('queue.lease_expires_at > now()')
    expect(migrationSql).toContain('replay_requested boolean NOT NULL DEFAULT false')
    expect(migrationSql).toContain('WHEN queue.replay_requested THEN NULL')
  })

  it('reconciles only old synced live notes in bounded non-overlapping batches', () => {
    expect(migrationSql).toContain("queue.status = 'synced'")
    expect(migrationSql).toContain("queue.operation = 'upsert'")
    expect(migrationSql).toContain(
      'COALESCE(notes.end_date, notes.note_date) >= p_today'
    )
    expect(migrationSql).toContain('queue.updated_at <= p_synced_before')
    expect(migrationSql).toContain(
      'LEAST(GREATEST(COALESCE(p_limit, 25), 1), 25)'
    )
    expect(migrationSql).toContain('FOR UPDATE OF queue SKIP LOCKED')
    expect(migrationSql).toContain('generation = queue.generation + 1')
  })
})
