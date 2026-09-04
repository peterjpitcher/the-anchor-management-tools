import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Guards the public schema against silent anon exposure.
 *
 * scripts/security/anon-access-allowlist.json records every object the anon role
 * (the public browser key) is allowed to hold a privilege on. This test reads the
 * live catalogue and fails naming anything anon can reach that is not on that list.
 *
 * Why it exists: pg_default_acl handed anon rights on every new object in public,
 * and nothing failed loudly when it did. In summer 2026 that put weekly takings,
 * dish cost prices and customer bookings behind the public key, and made new RPCs
 * anon callable on every build. Migration 20260828120356 removed the defaults;
 * this test is what notices if that ever stops working.
 *
 * It needs a direct Postgres connection: the catalogue is not reachable through
 * PostgREST, so the service role key alone cannot answer the question. Set
 * ANON_SURFACE_DB_URL (or SUPABASE_DB_URL) and have psql on PATH. Without it the
 * live checks skip and say so, so CI without secrets does not fail spuriously.
 *
 * Deliberately not PGURL or DATABASE_URL: .github/workflows/ci.yml already uses
 * PGURL for the throwaway contract database, and pointing this check at an empty
 * database would report the whole allowlist as stale.
 *
 * Sibling: scripts/security/assert-anon-surface.ts asserts the aggregate
 * invariants (nothing SECURITY DEFINER is anon callable, no anon writes, no view
 * without security_invoker, the website's own access intact). That script answers
 * "has a rule been broken". This test answers "has the surface grown".
 */

const ALLOWLIST_RELATIVE_PATH = 'scripts/security/anon-access-allowlist.json'

/**
 * One statement, one JSON value. The function signature is built by hand rather
 * than with regprocedure so it does not change shape with the connection's
 * search_path, which would make every signature look like a new object.
 */
const CATALOGUE_SQL = `
select json_build_object(
  'tables', coalesce((
    select json_agg(c.relname order by c.relname)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
      and has_table_privilege('anon', c.oid, 'SELECT')), '[]'::json),
  'views', coalesce((
    select json_agg(c.relname order by c.relname)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('v', 'm')
      and has_table_privilege('anon', c.oid, 'SELECT')), '[]'::json),
  'functions', coalesce((
    select json_agg(f.sig order by f.sig) from (
      select 'public.' || p.proname || '(' || coalesce((
               select string_agg(format_type(t, null), ',' order by ord)
               from unnest(p.proargtypes) with ordinality as u(t, ord)), '') || ')' as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prokind in ('f', 'p')
        and has_function_privilege('anon', p.oid, 'EXECUTE')
    ) f), '[]'::json),
  'writableObjects', coalesce((
    select json_agg(c.relname order by c.relname)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
      and (has_table_privilege('anon', c.oid, 'INSERT')
        or has_table_privilege('anon', c.oid, 'UPDATE')
        or has_table_privilege('anon', c.oid, 'DELETE')
        or has_table_privilege('anon', c.oid, 'TRUNCATE'))), '[]'::json)
)::text
`

type SurfaceKey = 'tables' | 'views' | 'functions' | 'writableObjects'

interface AnonSurface {
  tables: string[]
  views: string[]
  functions: string[]
  writableObjects: string[]
}

const SURFACE_KEYS: SurfaceKey[] = ['tables', 'views', 'functions', 'writableObjects']

/** Plain words for whoever sees this go red, who may not have the history. */
const KIND_LABELS: Record<SurfaceKey, string> = {
  tables: 'table readable by anon',
  views: 'view readable by anon',
  functions: 'function executable by anon',
  writableObjects: 'object anon can WRITE to',
}

const REMEDY_LINES: Record<SurfaceKey, string> = {
  tables: 'REVOKE ALL ON TABLE public.<name> FROM anon, authenticated;',
  views: 'REVOKE ALL ON TABLE public.<name> FROM anon, authenticated;',
  functions: 'REVOKE EXECUTE ON FUNCTION public.<name>(<argtypes>) FROM PUBLIC, anon;',
  writableObjects: 'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.<name> FROM anon;',
}

function readAllowlist(): AnonSurface {
  const allowlistPath = path.resolve(process.cwd(), ALLOWLIST_RELATIVE_PATH)
  const parsed = JSON.parse(fs.readFileSync(allowlistPath, 'utf8')) as { anon: AnonSurface }
  return parsed.anon
}

function resolveDatabaseUrl(): string | null {
  const raw = process.env.ANON_SURFACE_DB_URL ?? process.env.SUPABASE_DB_URL
  const trimmed = raw?.trim()
  return trimmed ? trimmed : null
}

function psqlIsAvailable(): boolean {
  try {
    execFileSync('psql', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/** A connection string carries a password, so it must never reach an assertion message. */
function redact(text: string, secret: string): string {
  return text.split(secret).join('[connection string redacted]')
}

function fetchLiveSurface(databaseUrl: string): AnonSurface {
  let stdout: string
  try {
    stdout = execFileSync(
      'psql',
      [databaseUrl, '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', CATALOGUE_SQL],
      { encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'] },
    )
  } catch (error) {
    // Prefer psql's own stderr over the Error message, which repeats the whole query.
    const failure = error as { stderr?: Buffer | string; status?: number }
    const stderr = (typeof failure.stderr === 'string' ? failure.stderr : failure.stderr?.toString()) ?? ''
    const detail = stderr.trim() || (error instanceof Error ? error.message : String(error))
    throw new Error(
      'Could not read the live catalogue with psql.\n' +
        'ANON_SURFACE_DB_URL is set, so this check must work rather than skip: a security gate that ' +
        'quietly disappears is worse than no gate. Unset it to skip deliberately.\n' +
        redact(detail, databaseUrl),
    )
  }

  const payload = stdout.trim()
  let parsed: Partial<Record<SurfaceKey, string[] | null>>
  try {
    parsed = JSON.parse(payload) as Partial<Record<SurfaceKey, string[] | null>>
  } catch {
    throw new Error(
      'psql returned something that is not the expected JSON row. Check that the connection string points ' +
        'at the application database and that the account can read the system catalogues.\n' +
        redact(payload.slice(0, 500), databaseUrl),
    )
  }

  return {
    tables: parsed.tables ?? [],
    views: parsed.views ?? [],
    functions: parsed.functions ?? [],
    writableObjects: parsed.writableObjects ?? [],
  }
}

export interface SurfaceDiff {
  unexpected: Array<{ kind: SurfaceKey; name: string }>
  stale: Array<{ kind: SurfaceKey; name: string }>
}

/** Pure, so the comparison itself is covered whether or not a database is configured. */
export function diffAnonSurface(live: AnonSurface, allowed: AnonSurface): SurfaceDiff {
  const diff: SurfaceDiff = { unexpected: [], stale: [] }

  for (const kind of SURFACE_KEYS) {
    const allowedSet = new Set(allowed[kind])
    const liveSet = new Set(live[kind])

    for (const name of [...liveSet].sort()) {
      if (!allowedSet.has(name)) diff.unexpected.push({ kind, name })
    }
    for (const name of [...allowedSet].sort()) {
      if (!liveSet.has(name)) diff.stale.push({ kind, name })
    }
  }

  return diff
}

export function formatUnexpected(unexpected: SurfaceDiff['unexpected']): string {
  const lines = [
    `The anon role can reach ${unexpected.length} object(s) in public that ${ALLOWLIST_RELATIVE_PATH} does not allow.`,
    'The anon key is the public browser key. It needs no credential, so anything on this list is one weak RLS policy away from being public data.',
    '',
  ]

  for (const kind of SURFACE_KEYS) {
    const inKind = unexpected.filter(entry => entry.kind === kind)
    if (inKind.length === 0) continue
    lines.push(`  ${KIND_LABELS[kind]}:`)
    for (const entry of inKind) lines.push(`    ${entry.name}`)
    lines.push(`    Fix: ${REMEDY_LINES[kind]}`)
    lines.push('')
  }

  lines.push(
    'DO NOT widen the allowlist to make this pass. That is the move that caused the original incidents.',
    'Add the explicit REVOKE above to the migration that created the object, in the same migration, and re-run.',
    'Only if the public website genuinely needs the object: add the narrowest possible GRANT to that same migration,',
    'confirm RLS is enabled with a policy that scopes the rows, then add the object to the allowlist with a reason.',
    'Postgres grants EXECUTE on every new function to PUBLIC, so a new function is anon callable unless its migration revokes it.',
    'Then run: npx tsx scripts/security/assert-anon-surface.ts',
  )

  return lines.join('\n')
}

export function formatStale(stale: SurfaceDiff['stale']): string {
  const lines = [
    `${ALLOWLIST_RELATIVE_PATH} lists ${stale.length} object(s) the anon role can no longer reach.`,
    'Either access was tightened (good, prune the entry) or this check is pointed at the wrong database.',
    '',
  ]
  for (const kind of SURFACE_KEYS) {
    const inKind = stale.filter(entry => entry.kind === kind)
    if (inKind.length === 0) continue
    lines.push(`  ${KIND_LABELS[kind]}:`)
    for (const entry of inKind) lines.push(`    ${entry.name}`)
    lines.push('')
  }
  lines.push('Remove the stale entries so the file keeps describing reality. An allowlist nobody trusts is not a control.')
  return lines.join('\n')
}

const databaseUrl = resolveDatabaseUrl()
const canRunLiveChecks = databaseUrl !== null && psqlIsAvailable()

const SKIP_REASON =
  databaseUrl === null
    ? '[anon access allowlist] SKIPPING the live catalogue checks: no database connection is configured.\n' +
      '  Set ANON_SURFACE_DB_URL (or SUPABASE_DB_URL) to a Postgres connection string to run them.\n' +
      '  The catalogue is not reachable through PostgREST, so the service role key alone is not enough.\n' +
      '  Nothing is being asserted about the live grants until that is set.'
    : '[anon access allowlist] SKIPPING the live catalogue checks: psql is not on PATH.\n' +
      '  Install the postgresql-client package, or unset ANON_SURFACE_DB_URL to skip deliberately.\n' +
      '  Nothing is being asserted about the live grants until that is fixed.'

describe('anon access allowlist (file)', () => {
  it('is sorted, unique and free of write grants', () => {
    const allowed = readAllowlist()

    for (const kind of SURFACE_KEYS) {
      const entries = allowed[kind]
      expect(Array.isArray(entries)).toBe(true)
      expect(new Set(entries).size, `${kind} contains duplicates`).toBe(entries.length)
      expect(entries, `${kind} is not sorted, which makes review diffs unreadable`).toEqual([...entries].sort())
    }

    // Anon holding a write privilege has no legitimate use here: every public write
    // goes through an API route using the admin client. TRUNCATE is not filtered by RLS at all.
    expect(allowed.writableObjects, 'the allowlist itself permits anon writes').toEqual([])
  })
})

describe('anon access allowlist (diff logic)', () => {
  const allowed: AnonSurface = {
    tables: ['business_hours'],
    views: [],
    functions: ['public.business_hours_for_date(date)'],
    writableObjects: [],
  }

  it('reports nothing when the live surface matches', () => {
    expect(diffAnonSurface(allowed, allowed)).toEqual({ unexpected: [], stale: [] })
  })

  it('flags an object anon can reach that the allowlist does not cover', () => {
    const live: AnonSurface = {
      ...allowed,
      tables: ['business_hours', 'employee_financial_details'],
      functions: [...allowed.functions, 'public.get_dashboard_stats()'],
      writableObjects: ['feedback'],
    }

    const diff = diffAnonSurface(live, allowed)

    expect(diff.unexpected).toEqual([
      { kind: 'tables', name: 'employee_financial_details' },
      { kind: 'functions', name: 'public.get_dashboard_stats()' },
      { kind: 'writableObjects', name: 'feedback' },
    ])

    const message = formatUnexpected(diff.unexpected)
    expect(message).toContain('employee_financial_details')
    expect(message).toContain('REVOKE EXECUTE ON FUNCTION')
    expect(message).toContain('DO NOT widen the allowlist')
  })

  it('flags an allowlist entry the database no longer grants', () => {
    const live: AnonSurface = { ...allowed, tables: [] }
    const diff = diffAnonSurface(live, allowed)

    expect(diff.stale).toEqual([{ kind: 'tables', name: 'business_hours' }])
    expect(formatStale(diff.stale)).toContain('business_hours')
  })
})

// The reason goes in the test name as well as the log: the default reporter prints
// counts only, so "2 skipped" is the signal a developer actually sees, and the name
// is what tells them why without digging.
const liveIt = canRunLiveChecks ? it : it.skip
const skipSuffix = canRunLiveChecks ? '' : ' [SKIPPED: set ANON_SURFACE_DB_URL to a Postgres connection string]'

describe('anon access allowlist (live database)', () => {
  if (!canRunLiveChecks) {
    // Announced from inside a test rather than at module scope, so the full reason
    // reaches the reporter instead of vanishing into the collection phase.
    it('reports why the live checks are skipped', () => {
      console.warn(SKIP_REASON)
      expect(SKIP_REASON).toContain('SKIPPING the live catalogue checks')
    })
  }

  liveIt('grants anon nothing beyond the allowlist' + skipSuffix, () => {
    const live = fetchLiveSurface(databaseUrl as string)
    const { unexpected } = diffAnonSurface(live, readAllowlist())

    if (unexpected.length > 0) throw new Error(formatUnexpected(unexpected))
    expect(unexpected).toEqual([])
  })

  liveIt('has no stale allowlist entries' + skipSuffix, () => {
    const live = fetchLiveSurface(databaseUrl as string)
    const { stale } = diffAnonSurface(live, readAllowlist())

    if (stale.length > 0) throw new Error(formatStale(stale))
    expect(stale).toEqual([])
  })
})
