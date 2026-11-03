import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { SIGNING_COMPLETION_HOOKS } from '@/lib/signing/completion-hooks'
import { SIGNING_KIND_DEFINITIONS } from '@/lib/signing/kinds'
import { SINGLE_TEMPLATE_SLUGS, TEMPLATE_MERGE_FIELDS, unknownMergeFields } from '@/lib/signing/template-fields'
import { findDraftMarkers, findMergeFields } from '@/lib/signing/template-render'
import {
  SIGNING_BRANDS,
  SIGNING_DOCUMENT_STATUSES,
  SIGNING_EVENTS,
  SIGNING_IDENTITY_CHECKS,
  SIGNING_KINDS,
  SIGNING_METHODS,
  SIGNING_MODES,
  SIGNING_PARTY_ROLES,
  SIGNING_PARTY_STATUSES,
  SIGNING_SUBJECT_TYPES,
  SIGNING_TEMPLATE_KINDS,
  type SigningTemplateKind,
} from '@/lib/signing/types'

/**
 * Signatures, acceptances and acknowledgements go through one feature (src/lib/signing/), by
 * owner decision on 12 October 2026. A rule is only real when a test enforces it, so this guard
 * holds three things in place:
 *
 * 1. The lists in code match the CHECK constraints in the migration, so a kind cannot exist in
 *    one and not the other.
 * 2. Every kind is complete: defined, with a completion hook, and with merge fields and draft
 *    wording where it is a template kind.
 * 3. Nobody builds a one-off. New code or a new migration that adds its own signed-at column,
 *    signature field or typed-name box fails here and is pointed at the registry.
 */

const ROOT = process.cwd()
const FOUNDATION = readFileSync(join(ROOT, 'supabase/migrations/20261013080854_document_signing_foundation.sql'), 'utf8')
const DRAFTS = readFileSync(join(ROOT, 'supabase/migrations/20261013080952_document_signing_template_drafts.sql'), 'utf8')
interface KindAddition {
  file: string
  sql: string
  /**
   * True when the migration seeds draft wording for its kinds (template kinds). False for
   * generator kinds, whose document the app builds: they have no wording to seed, so the
   * migration replaces only the signing_documents CHECK.
   */
  seedsDrafts: boolean
}

function kindAddition(file: string, seedsDrafts: boolean): KindAddition {
  return { file, sql: readFileSync(join(ROOT, 'supabase/migrations', file), 'utf8'), seedsDrafts }
}

/**
 * Kinds added since the foundation, oldest first. Each such migration replaces the kind CHECKs
 * with a longer list, so the guard reads it beside the first two. One that adds a template kind
 * also seeds its draft wording.
 */
const KIND_ADDITIONS: KindAddition[] = [
  kindAddition('20261014084753_signing_deposit_deduction_agreement.sql', true),
  kindAddition('20261103090100_training_signing_kinds.sql', false),
]
/** Every migration that seeds draft wording. */
const DRAFT_SOURCES = [DRAFTS, ...KIND_ADDITIONS.filter((addition) => addition.seedsDrafts).map((addition) => addition.sql)]

function withoutComments(sql: string): string {
  return sql.replace(/^\s*--.*$/gm, '')
}

/** The values of the CHECK on `column` in the CREATE TABLE of `table`. */
function checkValues(table: string, column: string): string[] {
  const tableSql = FOUNDATION.split(`CREATE TABLE IF NOT EXISTS public.${table} (`)[1]?.split('\n);')[0]
  expect(tableSql, `table ${table} not found in the migration`).toBeTruthy()
  const pattern = new RegExp(`\\n\\s+${column} text[^\\n]*?CHECK \\(${column}(?: IS NULL OR ${column})? = ANY \\(ARRAY\\[([\\s\\S]*?)\\]\\)\\)`)
  const match = (tableSql as string).match(pattern)
  expect(match, `CHECK on ${table}.${column} not found`).toBeTruthy()
  return Array.from((match as RegExpMatchArray)[1].matchAll(/'([a-z0-9_]+)'::text/g)).map((m) => m[1])
}

/**
 * The kinds `table` allows today: the list in its CREATE TABLE, unless a later migration has
 * replaced the constraint, in which case the last replacement. A replacement must drop and add
 * the constraint in one statement (so there is never a moment without it) and may only add to
 * the list it replaces.
 */
function kindCheckValues(table: string): string[] {
  return kindCheckHistory(table).at(-1)?.values ?? checkValues(table, 'kind')
}

/** The kinds a migration added to `table`'s CHECK (empty when it left the CHECK alone). */
function kindsAddedBy(table: string, file: string): string[] {
  return kindCheckHistory(table).find((step) => step.file === file)?.added ?? []
}

/** The CHECK on `table` after the foundation and after each kind addition, in order. */
function kindCheckHistory(table: string): Array<{ file: string; values: string[]; added: string[] }> {
  let values = checkValues(table, 'kind')
  const history: Array<{ file: string; values: string[]; added: string[] }> = [{ file: 'foundation', values, added: values }]
  const pattern = new RegExp(
    `ALTER TABLE public\\.${table}\\s+DROP CONSTRAINT IF EXISTS ${table}_kind_check,\\s+ADD CONSTRAINT ${table}_kind_check CHECK \\(kind = ANY \\(ARRAY\\[([^\\]]*)\\]\\)\\);`
  )
  for (const addition of KIND_ADDITIONS) {
    const statements = withoutComments(addition.sql)
    // Every statement that touches the constraint is the one-statement replacement.
    const mentions = statements.split(';').filter((statement) => statement.includes(`${table}_kind_check`))
    const match = statements.match(pattern)
    if (mentions.length === 0) continue
    expect(mentions.length, `${table}_kind_check must be replaced in exactly one statement`).toBe(1)
    expect(match, `${table}_kind_check is not replaced in one DROP and ADD statement`).toBeTruthy()
    const replaced = Array.from((match as RegExpMatchArray)[1].matchAll(/'([a-z0-9_]+)'::text/g)).map((m) => m[1])
    expect(replaced.slice(0, values.length), `${table}_kind_check dropped or reordered a kind`).toEqual(values)
    expect(replaced.length, `${table}_kind_check added nothing`).toBeGreaterThan(values.length)
    history.push({ file: addition.file, values: replaced, added: replaced.slice(values.length) })
    values = replaced
  }
  return history
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort()
}

interface DraftTemplate {
  kind: SigningTemplateKind
  slug: string
  title: string
  body: string
}

function draftTemplates(): DraftTemplate[] {
  return DRAFT_SOURCES.flatMap((source) =>
    Array.from(source.matchAll(/\('([a-z_]+)', '([a-z0-9-]+)', '([^']+)', \$body\$([\s\S]*?)\$body\$\)/g)).map((m) => ({
      kind: m[1] as SigningTemplateKind,
      slug: m[2],
      title: m[3],
      body: m[4],
    }))
  )
}

describe('signing: code and database agree', () => {
  it.each([
    ['signing_documents', 'mode', SIGNING_MODES],
    ['signing_documents', 'brand', SIGNING_BRANDS],
    ['signing_documents', 'subject_type', SIGNING_SUBJECT_TYPES],
    ['signing_documents', 'status', SIGNING_DOCUMENT_STATUSES],
    ['signing_parties', 'role', SIGNING_PARTY_ROLES],
    ['signing_parties', 'status', SIGNING_PARTY_STATUSES],
    ['signing_parties', 'method', SIGNING_METHODS],
    ['signing_parties', 'identity_check', SIGNING_IDENTITY_CHECKS],
    ['signing_events', 'event', SIGNING_EVENTS],
  ] as const)('%s.%s matches its list in types.ts', (table, column, values) => {
    expect(sorted(checkValues(table, column))).toEqual(sorted(values))
  })

  it.each([
    ['signing_documents', SIGNING_KINDS],
    ['signing_templates', SIGNING_TEMPLATE_KINDS],
  ] as const)('%s.kind matches its list in types.ts, counting the kinds added since the foundation', (table, values) => {
    expect(sorted(kindCheckValues(table))).toEqual(sorted(values))
  })

  it('holds fifteen kinds, nine of them with wording in a template', () => {
    expect(SIGNING_KINDS).toHaveLength(15)
    expect(SIGNING_TEMPLATE_KINDS).toHaveLength(9)
    expect(kindCheckValues('signing_documents')).toHaveLength(15)
    expect(kindCheckValues('signing_templates')).toHaveLength(9)
  })

  it('adds generator kinds only where a migration seeds no wording, and template kinds only where it does', () => {
    for (const addition of KIND_ADDITIONS) {
      const added = kindsAddedBy('signing_documents', addition.file)
      expect(added.length, `${addition.file} adds no kind to signing_documents`).toBeGreaterThan(0)
      const addedTemplates = kindsAddedBy('signing_templates', addition.file)
      if (addition.seedsDrafts) {
        // A template kind is allowed in both tables, and its wording is seeded beside it.
        expect(sorted(addedTemplates), `${addition.file} must add its kinds to signing_templates too`).toEqual(sorted(added))
        expect(addition.sql).toContain('INSERT INTO public.signing_templates')
      } else {
        // A generator kind has no template, so it must not be allowed in signing_templates, and
        // its definition must say the app builds the document.
        expect(addedTemplates, `${addition.file} adds a kind to signing_templates but seeds no wording`).toEqual([])
        expect(withoutComments(addition.sql)).not.toMatch(/signing_templates/)
        for (const kind of added) {
          const definition = SIGNING_KIND_DEFINITIONS[kind as keyof typeof SIGNING_KIND_DEFINITIONS]
          expect(definition, `${kind} has no definition`).toBeTruthy()
          expect(definition.source, `${kind} is added with no wording, so it must be a generator kind`).toBe('generator')
        }
      }
    }
  })

  it('adds a kind without opening anything: no table, grant, function or policy in a later migration', () => {
    for (const addition of KIND_ADDITIONS) {
      const statements = withoutComments(addition.sql)
      expect(statements).not.toMatch(/\b(CREATE|DROP)\s+(TABLE|FUNCTION|POLICY|TRIGGER|VIEW|INDEX)\b/i)
      expect(statements).not.toMatch(/\b(GRANT|REVOKE)\b/i)
      expect(statements).not.toMatch(/SECURITY DEFINER/i)
      expect(statements).not.toMatch(/\b(UPDATE|DELETE)\b/i)
    }
  })

  it('keeps every signing table closed to anon and authenticated', () => {
    for (const table of ['signing_templates', 'signing_documents', 'signing_parties', 'signing_events']) {
      expect(FOUNDATION).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`)
      expect(FOUNDATION).toContain(`REVOKE ALL ON public.${table} FROM PUBLIC, anon, authenticated;`)
    }
    const statements = FOUNDATION.replace(/^\s*--.*$/gm, '')
    expect(statements).not.toMatch(/\bGRANT\s[^;]*\bTO\s+(anon|authenticated|PUBLIC)\b/i)
    expect(statements).not.toMatch(/SECURITY DEFINER/i)
    expect(statements).not.toMatch(/CREATE POLICY/i)
  })
})

describe('signing: every kind is complete', () => {
  it('has a definition and a completion hook for every kind, and no extras', () => {
    expect(sorted(Object.keys(SIGNING_KIND_DEFINITIONS))).toEqual(sorted(SIGNING_KINDS))
    expect(sorted(Object.keys(SIGNING_COMPLETION_HOOKS))).toEqual(sorted(SIGNING_KINDS))
    for (const kind of SIGNING_KINDS) {
      expect(typeof SIGNING_COMPLETION_HOOKS[kind], `${kind} has no completion hook`).toBe('function')
    }
  })

  it('keeps a kind signed only in person off every route a link or a chaser would take', () => {
    for (const kind of SIGNING_KINDS) {
      const definition = SIGNING_KIND_DEFINITIONS[kind]
      if (!definition.inPersonOnly) continue
      expect(definition.signingReminders, `${kind} is signed in person only, so it must not send reminders`).toBe(false)
      expect(definition.allowSendNewLink, `${kind} is signed in person only, so it must not offer a new link`).toBe(false)
      expect(definition.signerRoles, `${kind} is signed in person only, so its signer must be on staff`).toEqual(['worker'])
    }
  })

  it('marks exactly the template kinds as template-sourced', () => {
    const templateSourced = SIGNING_KINDS.filter((kind) => SIGNING_KIND_DEFINITIONS[kind].source === 'template')
    expect(sorted(templateSourced)).toEqual(sorted(SIGNING_TEMPLATE_KINDS))
    expect(sorted(Object.keys(TEMPLATE_MERGE_FIELDS))).toEqual(sorted(SIGNING_TEMPLATE_KINDS))
  })

  it('ships draft wording for every template kind, and one template per single-template kind', () => {
    const drafts = draftTemplates()
    expect(drafts.length).toBeGreaterThanOrEqual(SIGNING_TEMPLATE_KINDS.length)
    for (const kind of SIGNING_TEMPLATE_KINDS) {
      expect(drafts.some((draft) => draft.kind === kind), `no draft template for ${kind}`).toBe(true)
    }
    for (const [kind, slug] of Object.entries(SINGLE_TEMPLATE_SLUGS)) {
      expect(drafts.filter((draft) => draft.kind === kind).map((draft) => draft.slug)).toEqual([slug])
    }
    expect(new Set(drafts.map((draft) => draft.slug)).size).toBe(drafts.length)
  })

  it('ships every draft switched off, marked as a draft, and using only fields its kind is given', () => {
    // is_active defaults to false, and the seed must not name the column at all.
    for (const source of DRAFT_SOURCES) {
      expect(source).toContain('INSERT INTO public.signing_templates (kind, slug, title, body) VALUES')
      expect(withoutComments(source)).not.toMatch(/is_active/i)
      expect(source).toContain('ON CONFLICT (slug) DO NOTHING')
    }
    for (const draft of draftTemplates()) {
      expect(findDraftMarkers(draft.body).length, `${draft.slug} has no [[TO CONFIRM]] marker, so it could be switched on unread`).toBeGreaterThan(0)
      expect(unknownMergeFields(draft.kind, findMergeFields(`${draft.title}\n${draft.body}`)), `${draft.slug} uses a field nobody fills in`).toEqual([])
      // No em dash (the U+2014 character), built at runtime so this file does not contain one.
      expect(draft.body.includes(String.fromCharCode(0x2014)), `${draft.slug} contains an em dash`).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// No one-off signatures
// ---------------------------------------------------------------------------

/** Where signing lives. Everything else is checked. */
const SIGNING_HOME = [
  'src/lib/signing/',
  'src/components/features/signing/',
  'src/components/features/guest/signing/',
  'src/app/sign/',
  'src/app/api/sign/',
  'src/app/api/signing/',
  'src/app/api/portal/signing/',
  'src/app/actions/signing',
  'src/app/(staff-portal)/portal/documents/',
]

/**
 * Identifiers that mean "someone signed or agreed to a document". Deliberately narrow: a shift
 * being accepted or a waitlist offer being accepted is not a signature, so plain `accepted_at`
 * is not here. `(?<![a-z])` keeps `assigned_at` and `reassigned_at` out, and `(?![a-z_])` keeps
 * out a longer name that merely starts the same way.
 */
const ONE_OFF_PATTERN = /(?<![a-z])(e_?signature|signed_at|signedAt|signature_(?:data|image|url)|typed_name|typedName|agreed_at|agreedAt|contract_signed|document_signed)(?![a-z_])/

/** Files that already carried one of these before the signing feature, and why each is fine. */
const EXISTING: Record<string, string> = {
  'src/types/database.generated.ts': 'generated from the database',
}

/** Migrations written before the signing feature. Anything newer is checked. */
const SIGNING_FOUNDATION_VERSION = '20261013080854'

function walk(directory: string, files: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) {
      walk(path, files)
    } else if (/\.(ts|tsx)$/.test(entry)) {
      files.push(path)
    }
  }
  return files
}

describe('signing: no one-off signatures', () => {
  it('finds no signature, signed-at or typed-name field outside the signing feature', () => {
    const offenders: string[] = []
    for (const path of walk(join(ROOT, 'src'))) {
      const file = relative(ROOT, path)
      if (SIGNING_HOME.some((prefix) => file.startsWith(prefix)) || file in EXISTING) continue
      const lines = readFileSync(path, 'utf8').split('\n')
      lines.forEach((line, index) => {
        const match = line.match(ONE_OFF_PATTERN)
        if (match) offenders.push(`${file}:${index + 1} (${match[1]})`)
      })
    }
    expect(
      offenders,
      'Signatures and agreements go through src/lib/signing/ (CLAUDE.md, Domain rules). Add a kind to src/lib/signing/kinds.ts instead of a one-off field.'
    ).toEqual([])
  })

  it('finds no new migration adding its own signature columns', () => {
    const directory = join(ROOT, 'supabase/migrations')
    const offenders: string[] = []
    for (const name of readdirSync(directory)) {
      if (!name.endsWith('.sql') || name.slice(0, 14) <= SIGNING_FOUNDATION_VERSION || name.includes('document_signing')) continue
      const lines = readFileSync(join(directory, name), 'utf8').split('\n')
      lines.forEach((line, index) => {
        if (line.trim().startsWith('--')) return
        const match = line.match(ONE_OFF_PATTERN)
        // Reading the signing tables is fine; defining a signature field elsewhere is not.
        if (match && !/signing_(parties|documents|events|record_)/.test(line)) {
          offenders.push(`${name}:${index + 1} (${match[1]})`)
        }
      })
    }
    expect(
      offenders,
      'A new migration defines its own signature field. Use the signing tables (signing_documents, signing_parties) instead.'
    ).toEqual([])
  })

  it('catches the shapes it is meant to catch, and leaves near misses alone', () => {
    for (const hit of ['waiver_signed_at timestamptz', 'const signedAt = now', 'signature_image text', 'typed_name', 'e_signature', 'esignature', 'agreed_at', 'contract_signed boolean']) {
      expect(ONE_OFF_PATTERN.test(hit), hit).toBe(true)
    }
    for (const miss of ['assigned_at', 'reassigned_at', 'reassignedAt', 'accepted_at', 'contract_accepted_at', 'designed_at', 'x-twilio-signature', 'webhook signature', 'agreed_at_hire']) {
      expect(ONE_OFF_PATTERN.test(miss), miss).toBe(false)
    }
  })
})
