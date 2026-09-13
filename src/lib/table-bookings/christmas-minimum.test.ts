import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CHRISTMAS_MIN_PARTY_SIZE, extractChristmasRuleErrorMessage } from './christmas'

/**
 * The Christmas dinner minimum, held to one figure at every layer that enforces or shows it.
 *
 * On 6 September 2026 the owner lowered it from 6 guests to 4, on every day of the window (website
 * docs/SSOT.md section 7). The website said 4 straight away. This app went on refusing parties of 4
 * and 5, because the figure lived in four places and only one of them was a constant: the gates in
 * create_table_booking_core_v06 and create_table_booking_v05, the christmas-2026 booking period
 * row, and the constant staff read in FOH.
 *
 * There is no Postgres in this run, so the SQL is read from the migrations. The newest file that
 * defines a function is the definition production runs, the same rule create-path-deposit.test.ts
 * relies on.
 */

const MIGRATIONS = join(process.cwd(), 'supabase/migrations')
const newestFirst = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .reverse()

function read(file: string): string {
  return readFileSync(join(MIGRATIONS, file), 'utf8')
}

/** The newest migration that defines the function, and that definition's body. */
function latestDefinitionOf(fn: string): { file: string; body: string } {
  const declaration = new RegExp(`CREATE OR REPLACE FUNCTION "?public"?\\."?${fn}"?\\(`)
  for (const file of newestFirst) {
    const sql = read(file)
    const found = declaration.exec(sql)
    if (!found) continue
    const rest = sql.slice(found.index)
    const asClause = /\bAS (\$[a-z_]*\$)/i.exec(rest)
    if (!asClause) throw new Error(`No body found for ${fn} in ${file}`)
    const bodyStart = asClause.index + asClause[0].length
    return { file, body: rest.slice(bodyStart, rest.indexOf(asClause[1], bodyStart)) }
  }
  throw new Error(`No migration defines ${fn}`)
}

/** The minimum and the message in a function's Christmas party-size gate. */
function christmasGate(fn: string): { minimum: number; message: string } {
  const { file, body } = latestDefinitionOf(fn)
  const gate = /IF v_is_christmas THEN[\s\S]*?IF p_party_size < (\d+) THEN\s*RAISE EXCEPTION '([^']+)'/.exec(body)
  if (!gate) throw new Error(`${fn} in ${file} has no Christmas party-size gate`)
  return { minimum: Number(gate[1]), message: gate[2] }
}

const GATED_FUNCTIONS = ['create_table_booking_core_v06', 'create_table_booking_v05'] as const

describe('the Christmas dinner minimum is 4 guests, everywhere', () => {
  it('is 4 in the application, which is the figure staff are shown', () => {
    expect(CHRISTMAS_MIN_PARTY_SIZE).toBe(4)
  })

  for (const fn of GATED_FUNCTIONS) {
    it(`${fn} refuses below the same minimum`, () => {
      expect(christmasGate(fn).minimum).toBe(CHRISTMAS_MIN_PARTY_SIZE)
    })

    it(`${fn} says so in words that reach staff unchanged`, () => {
      const { message } = christmasGate(fn)
      expect(message).toBe(`Christmas bookings are for ${CHRISTMAS_MIN_PARTY_SIZE} guests or more.`)
      // The create routes pass a database error through to the person booking only when it starts
      // "Christmas bookings ". Anything else becomes a generic failure.
      expect(extractChristmasRuleErrorMessage({ message })).toBe(message)
    })
  }

  it('moves the christmas-2026 booking period to the same minimum', () => {
    // The period row is data, so it moves by migration, and the newest migration that sets it wins.
    // Without this the website path still answers period_party_too_small below the old figure.
    const setter =
      /UPDATE public\.booking_periods\s+SET min_party_size = (\d+)\s+WHERE code = 'christmas-2026'/
    const latest = newestFirst.map((file) => setter.exec(read(file))).find(Boolean)
    expect(latest, 'no migration sets the christmas-2026 minimum').toBeTruthy()
    expect(Number(latest![1])).toBe(CHRISTMAS_MIN_PARTY_SIZE)
  })

  it('leaves the unrelated turn-time band for parties of 5 and 6 where it was', () => {
    expect(latestDefinitionOf('create_table_booking_core_v06').body).toContain(
      "WHEN p_party_size <= 6 THEN public.get_setting_int('turn_time_minutes_5_6', 120)",
    )
  })

  it('re-states EXECUTE exactly as production holds it, rather than inheriting it', () => {
    const coreSql = read(latestDefinitionOf('create_table_booking_core_v06').file)
    expect(coreSql).toMatch(
      /REVOKE ALL ON FUNCTION public\.create_table_booking_core_v06\([\s\S]*?\) FROM PUBLIC, anon, authenticated;/,
    )
    expect(coreSql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.create_table_booking_core_v06\([\s\S]*?\) TO service_role;/,
    )

    const v05Sql = read(latestDefinitionOf('create_table_booking_v05').file)
    expect(v05Sql).toMatch(/REVOKE ALL ON FUNCTION public\.create_table_booking_v05\([\s\S]*?\) FROM PUBLIC, anon;/)
    expect(v05Sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.create_table_booking_v05\([\s\S]*?\) TO authenticated, service_role;/,
    )
  })
})
