import { createFakeDb, type FakeDb } from './fakeSupabaseDb'

/**
 * The in-memory fake database with the training tables' column defaults filled in on insert, as
 * Postgres does (supabase/migrations/20261103141837_training_tables.sql). Without them an inserted
 * row comes back with missing columns, which the training mappers rightly refuse.
 *
 * Seeded rows get the same defaults. An upsert fills them only when it inserts; when it updates an existing row it changes
 * only the columns given, as PostgREST's merge upsert does.
 */

type Row = Record<string, unknown>

const NULLABLE: Record<string, string[]> = {
  training_assignments: [
    'due_on', 'window_opens_on', 'version_id', 'started_at', 'last_section_passed_at', 'completed_on', 'expires_on',
    'certificate_number', 'signing_document_id', 'confirmed_at', 'locked_at', 'locked_section', 'declined_at',
    'waived_at', 'waived_by', 'waived_by_name', 'waive_reason', 'cancelled_at', 'cancel_reason', 'external_issuer',
    'external_reference', 'external_issued_on', 'external_file_path', 'signoff_tasks', 'signed_off_by',
    'signed_off_by_name', 'signed_off_on', 'in_person_recorded_by', 'in_person_recorded_by_name', 'due_change_reason',
  ],
  training_profiles: [
    'groups_confirmed_at', 'groups_confirmed_by', 'groups_confirmed_by_name', 'paused_from', 'paused_until',
    'pause_reason', 'adjustment_note',
  ],
  training_events: ['employee_id', 'assignment_id', 'course_id', 'actor_id', 'actor_name', 'note_code', 'note'],
  training_attempts: ['submitted_at', 'answers', 'results', 'wrong_count', 'critical_missed', 'passed'],
  training_reminders: ['assignment_id', 'employee_id'],
}

function defaultsFor(table: string): Row | null {
  const now = new Date().toISOString()
  const nulls = Object.fromEntries((NULLABLE[table] ?? []).map((column) => [column, null]))
  switch (table) {
    case 'training_assignments':
      return { ...nulls, progress: {}, supervised_only: false, trained_in_person: false, created_at: now, updated_at: now }
    case 'training_profiles':
      return { ...nulls, groups: [], created_at: now, updated_at: now }
    case 'training_events':
      return { ...nulls, meta: {}, created_at: now }
    case 'training_attempts':
      return { ...nulls, started_at: now }
    case 'training_reminders':
      return { ...nulls, detail: {}, created_at: now, updated_at: now }
    default:
      return null
  }
}

function withDefaults(table: string, payload: Row | Row[]): Row | Row[] {
  const defaults = defaultsFor(table)
  if (!defaults) return payload
  return Array.isArray(payload) ? payload.map((row) => ({ ...defaultsFor(table), ...row })) : { ...defaults, ...payload }
}

/** Seeded rows are rows as stored, so they take the same defaults as an insert. */
export function createTrainingDb(seed: Record<string, Row[]> = {}): FakeDb {
  const filledSeed = Object.fromEntries(
    Object.entries(seed).map(([table, rows]) => [table, rows.map((row) => withDefaults(table, row) as Row)])
  )
  const db = createFakeDb(filledSeed)
  const from = db.client.from
  db.client.from = (table: string) => {
    const query = from(table)
    return {
      ...query,
      insert: (payload: Row | Row[]) => query.insert(withDefaults(table, payload)),
      upsert: (payload: Row | Row[], options?: { onConflict?: string }) => {
        const keys = (options?.onConflict ?? 'id').split(',').map((key) => key.trim())
        const rows = Array.isArray(payload) ? payload : [payload]
        const filled = rows.map((row) => {
          const exists = db.rows(table).some((existing) => keys.every((key) => (existing[key] ?? null) === (row[key] ?? null)))
          return exists ? row : (withDefaults(table, row) as Row)
        })
        return query.upsert(Array.isArray(payload) ? filled : filled[0], options)
      },
    }
  }
  return db
}
