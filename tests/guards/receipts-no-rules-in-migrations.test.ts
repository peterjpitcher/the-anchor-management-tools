import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Receipt rules are data, made and changed in the app, where every change is checked for
 * duplicates, previewed and audited. They are not to be written by a migration again.
 *
 * Fifty-four rules were upserted by migrations up to August 2026, twenty of them naming members
 * of staff. A rule put in that way skips every guard, cannot be seen being made, and is recreated
 * on any database built from the migrations. Wage payments are now recognised from the employee
 * list, so there is no reason left to seed a rule.
 */

const MIGRATIONS = join(process.cwd(), 'supabase/migrations')
/** Migrations from this point on are covered. Earlier ones are history and stay as they are. */
const FROM = '20261001000000'

/** Removes function bodies: a function may insert a rule at run time (approving a suggestion). */
function withoutFunctionBodies(sql: string): string {
  return sql.replace(/\$([a-zA-Z_]*)\$[\s\S]*?\$\1\$/g, '$$body$$')
}

function withoutComments(sql: string): string {
  return sql.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
}

describe('migrations do not create or change receipt rules', () => {
  const files = readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql') && name.slice(0, 14) >= FROM)

  it('covers the receipts migrations of this build', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it.each(files)('%s writes no rule rows', (name) => {
    const sql = withoutComments(withoutFunctionBodies(readFileSync(join(MIGRATIONS, name), 'utf8')))

    expect(sql).not.toMatch(/insert\s+into\s+(public\.)?receipt_rules\b/i)
    expect(sql).not.toMatch(/update\s+(public\.)?receipt_rules\b/i)
    expect(sql).not.toMatch(/delete\s+from\s+(public\.)?receipt_rules\b/i)
  })

  it('still notices a rule written at the top level of a migration', () => {
    const offending = `
      CREATE FUNCTION f() RETURNS void AS $$ BEGIN INSERT INTO public.receipt_rules (name) VALUES ('in a function'); END; $$ LANGUAGE plpgsql;
      -- INSERT INTO public.receipt_rules (name) VALUES ('in a comment');
      INSERT INTO public.receipt_rules (name) VALUES ('seeded');
    `
    const sql = withoutComments(withoutFunctionBodies(offending))

    expect(sql).toMatch(/insert\s+into\s+(public\.)?receipt_rules\b/i)
    expect(sql.match(/insert\s+into\s+(public\.)?receipt_rules\b/gi)).toHaveLength(1)
  })
})
