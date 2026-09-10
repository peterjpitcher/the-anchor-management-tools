import { readdirSync, readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { EVENT_IMAGE_VARIANTS, EVENT_IMAGE_VARIANT_ORDER } from '../imageVariants'

/**
 * The database names the event image variants one by one in four places, and
 * each of them silently excludes a variant it was not told about:
 *
 * 1. the CHECK on event_images.image_type refuses the row;
 * 2. the partial unique index stops keeping one row per event per variant;
 * 3. and 4. both variant RPCs raise "Unknown event image variant", and their
 *    cache column chains never write or clear the URL.
 *
 * Adding a variant to the config without a migration covering all four would
 * pass every other test and fail on the first real upload. This reads the
 * newest migration that defines each object and holds it to the config.
 */

const MIGRATIONS_DIR = resolve(__dirname, '../../../../supabase/migrations')

const CONFIG_VARIANTS = [...EVENT_IMAGE_VARIANT_ORDER].sort()

/** Values the CHECK allows that are not singleton variants, on purpose. */
const NON_VARIANT_IMAGE_TYPES = ['gallery', 'hero', 'poster', 'thumbnail']

/**
 * The newest migration, in filename order, whose SQL matches. Migrations apply
 * in filename order, so the last file to define something is what the database
 * ends up with; a hardcoded filename would go stale the moment it is superseded.
 */
function newestMigrationMatching(pattern: RegExp): { file: string; sql: string } {
  const match = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .reverse()
    .map((file) => ({ file, sql: readFileSync(resolve(MIGRATIONS_DIR, file), 'utf8') }))
    .find(({ sql }) => pattern.test(sql))

  if (!match) throw new Error(`No migration matches ${pattern}`)
  return match
}

/** The quoted values inside the first `<prefix> ( ... )` after `start`. */
function quotedList(sql: string, prefix: RegExp): string[] {
  const at = sql.search(prefix)
  if (at === -1) throw new Error(`List not found: ${prefix}`)
  const open = sql.indexOf('(', at + (sql.slice(at).match(prefix)?.[0].length ?? 0) - 1)
  let depth = 0
  let end = open
  for (let index = open; index < sql.length; index += 1) {
    if (sql[index] === '(') depth += 1
    if (sql[index] === ')') depth -= 1
    if (depth === 0) {
      end = index
      break
    }
  }
  const inside = sql
    .slice(open + 1, end)
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')
  return [...inside.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort()
}

/** The body of a `create or replace function public.<name>` statement. */
function functionBody(sql: string, name: string): string {
  const start = sql.search(new RegExp(`create or replace function public\\.${name}\\s*\\(`, 'i'))
  if (start === -1) throw new Error(`Function not found: ${name}`)
  const open = sql.indexOf('$$', start)
  const close = sql.indexOf('$$', open + 2)
  return sql.slice(open + 2, close)
}

describe('the image_type CHECK', () => {
  const { file, sql } = newestMigrationMatching(/add constraint event_images_image_type_check/i)
  const allowed = quotedList(sql.slice(sql.search(/add constraint event_images_image_type_check/i)), /check\s*\(\s*image_type\s+in\s*\(/i)

  it(`allows every configured variant (${file})`, () => {
    for (const variant of CONFIG_VARIANTS) expect(allowed).toContain(variant)
  })

  it('allows nothing else beyond the gallery and the legacy three', () => {
    expect(allowed.filter((value) => !CONFIG_VARIANTS.includes(value as never)).sort()).toEqual(
      NON_VARIANT_IMAGE_TYPES
    )
  })
})

describe('the one-row-per-variant index', () => {
  // `if not exists` in the original, plain in later rebuilds; both define it.
  const definition = /create unique index (?:if not exists )?event_images_singleton_variant_uniq/i
  const { file, sql } = newestMigrationMatching(definition)
  const indexSql = sql.slice(sql.search(definition))

  it(`covers exactly the configured variants (${file})`, () => {
    expect(quotedList(indexSql, /where\s+image_type\s+in\s*\(/i)).toEqual(CONFIG_VARIANTS)
  })
})

describe.each([
  ['upsert_event_image_variant', 'p_public_url'],
  ['delete_event_image_variant', 'null'],
])('%s', (name, value) => {
  const { file, sql } = newestMigrationMatching(new RegExp(`create or replace function public\\.${name}\\s*\\(`, 'i'))
  const body = functionBody(sql, name)

  it(`accepts exactly the configured variants (${file})`, () => {
    expect(quotedList(body, /p_variant\s+not\s+in\s*\(/i)).toEqual(CONFIG_VARIANTS)
  })

  it('sets each variant cache column', () => {
    for (const variant of EVENT_IMAGE_VARIANT_ORDER) {
      const column = EVENT_IMAGE_VARIANTS[variant].cacheColumn
      const branch = new RegExp(
        `p_variant\\s*=\\s*'${variant}'\\s+then\\s+update\\s+events\\s+set\\s+${column}\\s*=\\s*${value}\\b`,
        'i'
      )
      expect(body, `${name} does not set ${column} for ${variant}`).toMatch(branch)
    }
  })
})
