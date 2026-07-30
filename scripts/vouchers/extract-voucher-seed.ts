#!/usr/bin/env tsx
/**
 * Extracts the voucher seed data (TYPES, TERMS, TERMS_VERSION) verbatim from the
 * vendored design handoff HTML and writes scripts/vouchers/seed-data.json.
 *
 * It also prints the dollar-quoted SQL seed fragments consumed by
 * supabase/migrations/20260802000001_voucher_foundation.sql, so the literals in
 * the migration are generated from the handoff, never retyped.
 *
 * Run: npx tsx scripts/vouchers/extract-voucher-seed.ts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

interface HandoffType {
  id: string
  displayTitle: string
  coverTitle: string
  value: number | null
  requiresBooking: boolean
  alcohol: boolean
  copy: Record<string, string>
  hero: Record<string, string>
  entitlement: string
}

interface SeedType {
  id: string
  display_title: string
  cover_title: string
  value_pence: number | null
  requires_booking: boolean
  alcohol: boolean
  entitlement_html: string
  hero: Record<string, string>
  copy: Record<string, string>
  sort_order: number
}

const EXPECTED_TYPE_IDS = [
  'free-drink',
  'house-wine',
  'food-10',
  'drinks-10',
  'food-drink-25',
  'roast-two',
  'quiz-four',
  'bingo-four',
]

const here = dirname(fileURLToPath(import.meta.url))
const htmlPath = resolve(here, '../../docs/design/voucher-system/Voucher Set (Folded Card, B&W Print).html')
const jsonPath = resolve(here, 'seed-data.json')

const html = readFileSync(htmlPath, 'utf8')

// Slice the seed const declarations out of the page script. Evaluating the
// original literals (rather than re-parsing them) keeps every string
// byte-identical to the handoff, HTML entities included.
const sliceStart = html.indexOf('const TERMS_VERSION')
const sliceEnd = html.indexOf('const termsHTML')
if (sliceStart === -1 || sliceEnd === -1 || sliceEnd <= sliceStart) {
  throw new Error(`Could not locate the TERMS_VERSION/TYPES seed block in ${htmlPath}`)
}
const seedSource = html.slice(sliceStart, sliceEnd)

const sandbox = vm.createContext({})
const extracted = vm.runInContext(`${seedSource}; ({ TERMS_VERSION, TERMS, TYPES })`, sandbox) as {
  TERMS_VERSION: string
  TERMS: [string, string][]
  TYPES: HandoffType[]
}

// Validate before writing anything.
if (extracted.TERMS_VERSION !== 'v2.0') {
  throw new Error(`Unexpected TERMS_VERSION: ${extracted.TERMS_VERSION} (expected v2.0)`)
}
if (!Array.isArray(extracted.TERMS) || extracted.TERMS.length !== 21) {
  throw new Error(`Expected 21 term pairs, found ${extracted.TERMS?.length}`)
}
for (const [index, pair] of extracted.TERMS.entries()) {
  if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string' || typeof pair[1] !== 'string') {
    throw new Error(`TERMS[${index}] is not a [heading, body] string pair`)
  }
}
if (!Array.isArray(extracted.TYPES) || extracted.TYPES.length !== 8) {
  throw new Error(`Expected 8 voucher types, found ${extracted.TYPES?.length}`)
}
const foundIds = extracted.TYPES.map((t) => t.id)
if (JSON.stringify(foundIds) !== JSON.stringify(EXPECTED_TYPE_IDS)) {
  throw new Error(`Type ids do not match the spec order. Found: ${foundIds.join(', ')}`)
}
for (const t of extracted.TYPES) {
  const stringFields: (keyof HandoffType)[] = ['id', 'displayTitle', 'coverTitle', 'entitlement']
  for (const field of stringFields) {
    if (typeof t[field] !== 'string' || (t[field] as string).length === 0) {
      throw new Error(`Type ${t.id}: field ${field} is missing or empty`)
    }
  }
  if (t.value !== null && !Number.isInteger(t.value)) throw new Error(`Type ${t.id}: value is not an integer or null`)
  if (typeof t.requiresBooking !== 'boolean') throw new Error(`Type ${t.id}: requiresBooking is not boolean`)
  if (typeof t.alcohol !== 'boolean') throw new Error(`Type ${t.id}: alcohol is not boolean`)
  if (!t.hero || typeof t.hero !== 'object') throw new Error(`Type ${t.id}: hero missing`)
  if (!t.copy || typeof t.copy !== 'object') throw new Error(`Type ${t.id}: copy set missing`)
}

// The handoff literals are authored for direct injection into HTML, so they carry
// entities (&pound;, &amp;, &rsquo;, &eacute;). Stored values must be plain text:
// the app renders them as React text, and the print template escapes them on the
// way back into HTML. Storing entities instead leaks "&pound;10" into the UI.
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  pound: '£',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
  eacute: 'é',
  egrave: 'è',
  agrave: 'à',
  ccedil: 'ç',
  nbsp: ' ',
  hellip: '…',
  middot: '·',
  ndash: '–',
}

// Structural entities must survive inside a genuine HTML field, otherwise a
// literal & or < would change how the markup parses.
const HTML_STRUCTURAL = new Set(['amp', 'lt', 'gt'])

function decodeEntities(value: string, keepStructural: boolean): string {
  return value
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&([a-zA-Z]+);/g, (match, name: string) => {
      const key = name.toLowerCase()
      if (keepStructural && HTML_STRUCTURAL.has(key)) return match
      const replacement = NAMED_ENTITIES[key]
      if (replacement === undefined) {
        throw new Error(`Unmapped HTML entity "${match}" in the handoff seed data. Add it to NAMED_ENTITIES.`)
      }
      return replacement
    })
}

const decodeText = (value: string): string => decodeEntities(value, false)
const decodeHtml = (value: string): string => decodeEntities(value, true)

function decodeStringMap(source: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(source)) {
    out[key] = typeof value === 'string' ? decodeText(value) : value
  }
  return out
}

// The handoff leaves the entitlement types without a value, but every voucher
// has a cash value for liability reporting (owner, 2026-07-30). These override
// the handoff nulls; the money types already carry their value in the artwork.
const VALUE_PENCE_OVERRIDES: Record<string, number> = {
  'free-drink': 600,
  'house-wine': 2000,
  'roast-two': 4000,
  'quiz-four': 1200,
  'bingo-four': 2000,
}

const types: SeedType[] = extracted.TYPES.map((t, index) => ({
  id: t.id,
  display_title: decodeText(t.displayTitle),
  cover_title: decodeText(t.coverTitle),
  value_pence: VALUE_PENCE_OVERRIDES[t.id] ?? t.value,
  requires_booking: t.requiresBooking,
  alcohol: t.alcohol,
  entitlement_html: decodeHtml(t.entitlement),
  hero: decodeStringMap(t.hero as unknown as Record<string, unknown>),
  copy: decodeStringMap(t.copy as unknown as Record<string, unknown>),
  sort_order: index + 1,
}))

const clauses = extracted.TERMS.map(([heading, body]) => ({
  heading: decodeText(heading),
  body: decodeText(body),
}))

const seed = {
  source: 'docs/design/voucher-system/Voucher Set (Folded Card, B&W Print).html',
  terms_version: extracted.TERMS_VERSION,
  clauses,
  types,
}

writeFileSync(jsonPath, `${JSON.stringify(seed, null, 2)}\n`, 'utf8')

// SQL fragment generation (dollar-quoted; entitlement HTML contains quotes).
const TAG = '$seed$'
function dq(value: string): string {
  if (value.includes(TAG)) throw new Error('Seed value contains the dollar-quote tag; choose another tag')
  return `${TAG}${value}${TAG}`
}
function dqJson(value: unknown): string {
  return `${dq(JSON.stringify(value))}::jsonb`
}

const typeRows = types
  .map((t) =>
    [
      '  (',
      [
        dq(t.id),
        dq(t.display_title),
        dq(t.cover_title),
        t.value_pence === null ? 'null' : String(t.value_pence),
        String(t.requires_booking),
        String(t.alcohol),
        dq(t.entitlement_html),
        dqJson(t.hero),
        dqJson(t.copy),
        String(t.sort_order),
      ].join(', '),
      ')',
    ].join('')
  )
  .join(',\n')

const typesSql = [
  'INSERT INTO public.voucher_types',
  '  (id, display_title, cover_title, value_pence, requires_booking, alcohol, entitlement_html, hero, copy, sort_order)',
  'VALUES',
  typeRows,
  'ON CONFLICT (id) DO NOTHING;',
].join('\n')

const termsSql = [
  'INSERT INTO public.terms_versions (version, effective_from, clauses, published_by)',
  `VALUES (${dq(extracted.TERMS_VERSION)}, DATE '2026-07-30', ${dqJson(clauses)}, ${dq('Design handoff (docs/design/voucher-system)')})`,
  'ON CONFLICT (version) DO NOTHING;',
].join('\n')

process.stdout.write(`${typesSql}\n\n${termsSql}\n`)

const summary = [
  `Wrote ${jsonPath}`,
  `terms_version: ${extracted.TERMS_VERSION}`,
  `types: ${types.length} (${types.map((t) => t.id).join(', ')})`,
  `term pairs: ${clauses.length}`,
]
process.stderr.write(`${summary.join('\n')}\n`)
