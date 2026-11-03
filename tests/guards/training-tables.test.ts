import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { publicSchemaColumns } from '../helpers/generatedSchema'

/**
 * Staff training records (answers, results, attempt times, pauses) are personal data, and every
 * read and write goes through the server after its own permission or staff portal identity check
 * (tasks/plan-2026-11-02-staff-training-build.md, section 2). So every training_* table must be
 * closed to the browser keys: row security on, no policy, everything revoked from PUBLIC, anon
 * and authenticated, and granted to service_role only. Every training function is revoked from
 * PUBLIC, anon and authenticated too, because new functions are executable by authenticated by
 * default (CLAUDE.md, Security rules).
 *
 * This guard reads the SQL of every migration, so a later migration that adds a training table
 * or function, or reopens one, fails here before it reaches production. It also checks that the
 * hand-added generated types match the tables the migration creates, until they are regenerated
 * from production after the migrations are applied.
 *
 * scripts/testing/training-postgres.py proves the same rules on a real Postgres (npm run test:pg).
 */

const ROOT = process.cwd()
const MIGRATIONS = join(ROOT, 'supabase/migrations')
const TABLES_MIGRATION = '20261103141837_training_tables.sql'
const KINDS_MIGRATION = '20261103141853_training_signing_kinds.sql'
const PERMISSIONS_MIGRATION = '20261103153829_training_permissions.sql'
const RETIRE_MIGRATION = '20261103141905_retire_policy_drafts_replaced_by_training.sql'
const GENERATED_TYPES = readFileSync(join(ROOT, 'src/types/database.generated.ts'), 'utf8')

const EXPECTED_TABLES = [
  'training_assignments',
  'training_attempts',
  'training_course_versions',
  'training_courses',
  'training_events',
  'training_profiles',
  'training_reminders',
]

/** The only training function that may run as its owner: the deliberate retention removal. */
const SECURITY_DEFINER_ALLOWED = ['training_retention_purge']

interface Migration {
  name: string
  sql: string
  /** The SQL with every comment removed. */
  code: string
}

function withoutComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '')
}

function readMigrations(): Migration[] {
  return readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => {
      const sql = readFileSync(join(MIGRATIONS, name), 'utf8')
      return { name, sql, code: withoutComments(sql) }
    })
}

function migration(name: string): Migration {
  const found = readMigrations().find((item) => item.name === name)
  expect(found, `${name} is missing`).toBeTruthy()
  return found as Migration
}

/** One statement per entry, whitespace collapsed. Good enough for the shapes these migrations use. */
function statements(code: string): string[] {
  return code
    .split(';')
    .map((statement) => statement.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

interface CreatedTable {
  table: string
  migration: Migration
  body: string
}

function createdTrainingTables(migrations: Migration[]): CreatedTable[] {
  const pattern = /CREATE TABLE(?: IF NOT EXISTS)? (?:public\.)?"?(training_[a-z0-9_]+)"? \(([\s\S]*?)\n\);/gi
  return migrations.flatMap((item) =>
    Array.from(item.code.matchAll(pattern)).map((match) => ({ table: match[1], migration: item, body: match[2] }))
  )
}

interface CreatedFunction {
  name: string
  argTypes: string
  migration: Migration
  header: string
}

function createdTrainingFunctions(migrations: Migration[]): CreatedFunction[] {
  const pattern = /CREATE (?:OR REPLACE )?FUNCTION (?:public\.)?"?(training_[a-z0-9_]+)"?\s*\(([^)]*)\)([\s\S]*?)AS \$/gi
  return migrations.flatMap((item) =>
    Array.from(item.code.matchAll(pattern)).map((match) => ({
      name: match[1],
      // "p_employee_id uuid, p_note text DEFAULT NULL" -> "uuid, text"
      argTypes: match[2]
        .split(',')
        .map((arg) => arg.trim())
        .filter(Boolean)
        .map((arg) => arg.replace(/\s+DEFAULT\s+[\s\S]*$/i, '').split(/\s+/).slice(1).join(' '))
        .join(', '),
      migration: item,
      header: match[3],
    }))
  )
}

interface Column {
  name: string
  nullable: boolean
  hasDefault: boolean
}

/** Column definitions in a CREATE TABLE body: one per line, as the training migrations write them. */
function columnsOf(body: string): Column[] {
  const column = /^\s*([a-z_][a-z0-9_]*)\s+(uuid|text\[\]|text|int|integer|boolean|jsonb|date|timestamptz)\b(.*)$/
  return body
    .split('\n')
    .map((line) => line.match(column))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map((match) => ({
      name: match[1],
      nullable: !/\b(NOT NULL|PRIMARY KEY)\b/i.test(match[3]),
      hasDefault: /\bDEFAULT\b/i.test(match[3]),
    }))
}

/** `name: type` lines of one part (Row or Insert) of a table in the generated types. */
function generatedPart(table: string, part: 'Row' | 'Insert'): Map<string, string> {
  const start = GENERATED_TYPES.indexOf(`\n      ${table}: {\n        Row: {\n`)
  expect(start, `${table} is missing from src/types/database.generated.ts`).toBeGreaterThan(-1)
  const partStart = GENERATED_TYPES.indexOf(`        ${part}: {\n`, start)
  const partEnd = GENERATED_TYPES.indexOf('\n        }\n', partStart)
  const lines = GENERATED_TYPES.slice(partStart, partEnd).split('\n').slice(1)
  return new Map(
    lines.map((line) => {
      const [name, ...type] = line.trim().split(': ')
      return [name, type.join(': ')]
    })
  )
}

describe('training tables: closed to the browser keys', () => {
  const migrations = readMigrations()
  const tables = createdTrainingTables(migrations)

  it('reads the migration that creates the seven training tables', () => {
    expect(tables.filter((item) => item.migration.name === TABLES_MIGRATION).map((item) => item.table).sort()).toEqual(EXPECTED_TABLES)
  })

  it('enables row security, revokes from PUBLIC, anon and authenticated, and grants service_role, for every training table', () => {
    expect(tables.length).toBeGreaterThan(0)
    for (const { table, migration: item } of tables) {
      expect(item.code, `${table}: row security not enabled in ${item.name}`).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`)
      expect(item.code, `${table}: not revoked from PUBLIC, anon and authenticated in ${item.name}`).toContain(
        `REVOKE ALL ON TABLE public.${table} FROM PUBLIC, anon, authenticated;`
      )
      expect(item.code, `${table}: not granted to service_role in ${item.name}`).toContain(`GRANT ALL ON TABLE public.${table} TO service_role;`)
    }
  })

  it('never grants a training table to anyone but service_role, adds no policy and never switches row security off', () => {
    const offenders: string[] = []
    for (const item of migrations) {
      for (const statement of statements(item.code)) {
        if (!/\btraining_[a-z0-9_]+/i.test(statement)) continue
        const grant = statement.match(/^GRANT\s.+?\sON\s(?:TABLE\s)?(?:public\.)?"?(training_[a-z0-9_]+)"?\s.*?\bTO\s+(.+)$/i)
        if (grant) {
          const grantees = grant[2].split(',').map((grantee) => grantee.trim().toLowerCase())
          if (grantees.some((grantee) => grantee !== 'service_role')) offenders.push(`${item.name}: ${statement}`)
        }
        if (/^CREATE POLICY\s.+\sON\s(?:public\.)?"?training_/i.test(statement)) offenders.push(`${item.name}: ${statement}`)
        if (/^ALTER TABLE (?:public\.)?"?training_[a-z0-9_]+"?\s+(DISABLE|NO FORCE) ROW LEVEL SECURITY/i.test(statement)) {
          offenders.push(`${item.name}: ${statement}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('has no later migration that opens every table in public to anon or authenticated', () => {
    const offenders = migrations
      .filter((item) => item.name > TABLES_MIGRATION)
      .flatMap((item) =>
        statements(item.code)
          .filter((statement) => /^GRANT\s.+\sON ALL TABLES IN SCHEMA public\s+TO\s+.*\b(anon|authenticated|PUBLIC)\b/i.test(statement))
          .map((statement) => `${item.name}: ${statement}`)
      )
    expect(offenders).toEqual([])
  })

  it('revokes every training function from PUBLIC, anon and authenticated, grants it to service_role only, and pins its search_path', () => {
    const functions = createdTrainingFunctions(migrations)
    expect(functions.filter((item) => item.migration.name === TABLES_MIGRATION).map((item) => item.name).sort()).toEqual([
      'training_attempts_guard',
      'training_course_versions_guard',
      'training_events_guard',
      'training_refuse_truncate',
      'training_retention_purge',
      'training_touch_updated_at',
    ])
    for (const { name, argTypes, migration: item, header } of functions) {
      const signature = `public.${name}(${argTypes})`
      expect(item.code, `${signature}: not revoked in ${item.name}`).toContain(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC, anon, authenticated;`)
      expect(item.code, `${signature}: not granted to service_role in ${item.name}`).toContain(`GRANT EXECUTE ON FUNCTION ${signature} TO service_role;`)
      expect(header, `${signature}: no search_path`).toMatch(/SET search_path TO 'public', 'pg_catalog'/)
      if (/SECURITY DEFINER/i.test(header)) {
        expect(SECURITY_DEFINER_ALLOWED, `${signature} runs as its owner`).toContain(name)
      }
    }
    expect(functions.find((item) => item.name === 'training_retention_purge')?.header).toMatch(/SECURITY DEFINER/)

    const offenders = migrations.flatMap((item) =>
      statements(item.code)
        .filter((statement) => /^GRANT\s.+\sON FUNCTION (?:public\.)?"?training_/i.test(statement))
        .filter((statement) => !/\sTO service_role$/i.test(statement))
        .map((statement) => `${item.name}: ${statement}`)
    )
    expect(offenders).toEqual([])
  })

  it('keeps the training bucket private', () => {
    expect(migration(TABLES_MIGRATION).code).toContain(
      "INSERT INTO storage.buckets (id, name, public)\nVALUES ('training', 'training', false)\nON CONFLICT (id) DO NOTHING;"
    )
  })
})

describe('training tables: the rules the database enforces', () => {
  const code = () => migration(TABLES_MIGRATION).code

  it('allows one open cycle per person and course, one open attempt per section, and one draft per course', () => {
    expect(code()).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS training_assignments_one_open\s+ON public\.training_assignments \(employee_id, course_id\)\s+WHERE status IN \('waiting', 'assigned', 'in_progress', 'locked', 'awaiting_confirmation', 'declined'\);/
    )
    expect(code()).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS training_attempts_one_open\s+ON public\.training_attempts \(assignment_id, section_key\) WHERE submitted_at IS NULL;/)
    expect(code()).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS training_course_versions_one_draft\s+ON public\.training_course_versions \(course_id\) WHERE state = 'draft';/)
    expect(code()).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS training_reminders_claim\s+ON public\.training_reminders \(claim_key\);/)
  })

  it('guards versions, attempts and the timeline with triggers, and refuses TRUNCATE on all three', () => {
    for (const [table, fn] of [
      ['training_course_versions', 'training_course_versions_guard'],
      ['training_attempts', 'training_attempts_guard'],
      ['training_events', 'training_events_guard'],
    ]) {
      expect(code()).toMatch(new RegExp(`BEFORE UPDATE OR DELETE ON public\\.${table}\\s+FOR EACH ROW EXECUTE FUNCTION public\\.${fn}\\(\\);`))
      expect(code()).toMatch(new RegExp(`BEFORE TRUNCATE ON public\\.${table}\\s+FOR EACH STATEMENT EXECUTE FUNCTION public\\.training_refuse_truncate\\(\\);`))
    }
    for (const table of ['training_courses', 'training_profiles', 'training_assignments', 'training_reminders']) {
      expect(code()).toMatch(new RegExp(`BEFORE UPDATE ON public\\.${table}\\s+FOR EACH ROW EXECUTE FUNCTION public\\.training_touch_updated_at\\(\\);`))
    }
  })

  it('lets the retention bypass skip only deletes, and only inside the purge', () => {
    const bypasses = code().match(/current_setting\('training\.retention_purge', true\) = 'on'/g) ?? []
    // The attempts and events guards, each on DELETE only. The versions guard has no bypass.
    expect(bypasses).toHaveLength(2)
    expect(code()).toMatch(/IF TG_OP = 'DELETE' THEN\s+IF current_setting\('training\.retention_purge', true\) = 'on' THEN\s+RETURN OLD;/)
    expect(code()).toMatch(/IF TG_OP = 'DELETE' AND current_setting\('training\.retention_purge', true\) = 'on' THEN\s+RETURN OLD;/)
    const setters = code().match(/set_config\('training\.retention_purge', '(on|off)', true\)/g) ?? []
    expect(setters).toEqual(["set_config('training.retention_purge', 'on', true)", "set_config('training.retention_purge', 'off', true)"])
  })

  it('keys people on employees.employee_id and never cascades a delete', () => {
    expect(code()).not.toMatch(/ON DELETE CASCADE/i)
    expect(code()).not.toMatch(/REFERENCES auth\.users/i)
    for (const table of ['training_profiles', 'training_assignments', 'training_attempts', 'training_events', 'training_reminders']) {
      const body = createdTrainingTables([migration(TABLES_MIGRATION)]).find((item) => item.table === table)?.body ?? ''
      expect(body, table).toMatch(/employee_id uuid[^\n]*REFERENCES public\.employees\(employee_id\) ON DELETE RESTRICT/)
    }
  })
})

describe('training tables: generated types match the migration', () => {
  const tables = createdTrainingTables([migration(TABLES_MIGRATION)])
  const schema = publicSchemaColumns()

  it.each(EXPECTED_TABLES)('%s has every column, with the right nullability and optionality', (table) => {
    const created = tables.find((item) => item.table === table)
    expect(created, `${table} not created`).toBeTruthy()
    const columns = columnsOf((created as CreatedTable).body)
    expect(columns.length).toBeGreaterThan(2)
    expect([...(schema.get(table) ?? [])].sort()).toEqual(columns.map((column) => column.name).sort())

    const row = generatedPart(table, 'Row')
    const insert = generatedPart(table, 'Insert')
    for (const column of columns) {
      expect(row.get(column.name)?.endsWith(' | null'), `${table}.${column.name} nullability`).toBe(column.nullable)
      const optional = insert.has(`${column.name}?`)
      expect(optional || insert.has(column.name), `${table}.${column.name} missing from Insert`).toBe(true)
      expect(optional, `${table}.${column.name} optional on insert`).toBe(column.nullable || column.hasDefault)
    }
  })

  it('lists the retention function', () => {
    expect(GENERATED_TYPES).toContain('      training_retention_purge: {\n        Args: { p_employee_id: string }\n        Returns: Json\n      }\n')
  })
})

describe('training: the other three migrations', () => {
  it('adds the two training kinds to signing_documents only, keeping every earlier kind in order', () => {
    const kinds = migration(KINDS_MIGRATION).code
    const deduction = migration('20261014084753_signing_deposit_deduction_agreement.sql').code
    const list = (code: string, table: string): string[] => {
      const match = code.match(new RegExp(`ADD CONSTRAINT ${table}_kind_check CHECK \\(kind = ANY \\(ARRAY\\[([^\\]]*)\\]\\)\\)`))
      expect(match, `${table}_kind_check`).toBeTruthy()
      return Array.from((match as RegExpMatchArray)[1].matchAll(/'([a-z0-9_]+)'::text/g)).map((m) => m[1])
    }
    expect(list(kinds, 'signing_documents')).toEqual([...list(deduction, 'signing_documents'), 'training_completion', 'training_signoff'])
    // Generator kinds have no wording, so the template kinds are left alone.
    expect(kinds).not.toContain('signing_templates')
    expect(kinds).not.toMatch(/\b(CREATE|DROP)\s+(TABLE|FUNCTION|POLICY|TRIGGER|VIEW|INDEX)\b/i)
    expect(kinds).not.toMatch(/\b(GRANT|REVOKE|UPDATE|DELETE|INSERT)\b/i)
  })

  it('grants the training permissions to super_admin and manager only, and publish to super_admin only', () => {
    const code = migration(PERMISSIONS_MIGRATION).code
    const actions = code.match(/v_actions text\[\] := ARRAY\[([^\]]*)\]/)
    expect(Array.from((actions as RegExpMatchArray)[1].matchAll(/'([a-z_]+)'/g)).map((m) => m[1])).toEqual(['view', 'manage', 'publish'])
    expect(Array.from(code.matchAll(/r\.name = '([^']+)'/g)).map((m) => m[1])).toEqual(['super_admin', 'manager'])
    // Owner decision, 3 November 2026: only the owner publishes courses and changes the switches.
    const grants = Object.fromEntries(
      code
        .split(/INSERT INTO public\.role_permissions/)
        .slice(1)
        .map((block) => [
          (block.match(/r\.name = '([^']+)'/) as RegExpMatchArray)[1],
          Array.from((block.match(/p\.action IN \(([^)]*)\)/) as RegExpMatchArray)[1].matchAll(/'([a-z_]+)'/g)).map((m) => m[1]),
        ])
    )
    expect(grants).toEqual({ super_admin: ['view', 'manage', 'publish'], manager: ['view', 'manage'] })
    expect(code).not.toMatch(/r\.name IN/i)
    expect(code).not.toMatch(/\b(staff|foh_staff|portal_shift_manager|Deputy)'/)
  })

  it('retires exactly the four overlapping policy drafts, and only switches templates off', () => {
    const code = migration(RETIRE_MIGRATION).code
    const slugs = Array.from(code.matchAll(/slug IN \(([^)]*)\)/g)).map((m) => Array.from(m[1].matchAll(/'([a-z0-9-]+)'/g)).map((s) => s[1]))
    expect(slugs.length).toBeGreaterThan(0)
    for (const list of slugs) expect(list).toEqual(['health-and-safety', 'allergens', 'challenge-25', 'data-protection'])
    expect(code).not.toContain('staff-handbook')
    expect(code).not.toMatch(/is_active = true/i)
    expect(code).not.toMatch(/\b(CREATE|DROP|ALTER|GRANT|REVOKE|DELETE|INSERT)\b/i)
  })

  it('writes no em dash in any training migration', () => {
    const emDash = String.fromCharCode(0x2014)
    for (const name of [TABLES_MIGRATION, KINDS_MIGRATION, PERMISSIONS_MIGRATION, RETIRE_MIGRATION]) {
      expect(migration(name).sql.includes(emDash), name).toBe(false)
    }
  })
})
