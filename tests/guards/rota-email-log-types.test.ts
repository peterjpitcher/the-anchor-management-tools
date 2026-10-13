import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * Every email_type the app writes to rota_email_log must be one the table's check constraint
 * allows.
 *
 * The daily unfilled shift cron wrote 'unfilled_urgent' from 18 August to 13 October 2026 while
 * the check listed ten other values. Postgres refused each insert (23514), the cron did not read
 * the result, and the alerts went out unlogged. Nothing in TypeScript ties the string to the
 * constraint, and a mocked client accepts any value.
 *
 * The allowed list is read from the newest migration that defines the constraint. The written
 * values are read from the source with the TypeScript parser. A writer this guard cannot read
 * (a value that is not a plain string) fails it too, so a new one cannot slip past unseen.
 *
 * To add a type: add it to the check in a new migration, as
 * 20261013155149_rota_email_log_unfilled_urgent.sql does, then write it.
 */

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const MIGRATIONS = join(ROOT, 'supabase/migrations')
const TABLE = 'rota_email_log'
const CONSTRAINT = /ADD CONSTRAINT\s+rota_email_log_email_type_check\s+CHECK\s*\(\s*email_type\s+IN\s*\(([^)]*)\)/gi

interface Written {
  where: string
  value: string
}

function allowedEmailTypes(): { migration: string; types: Set<string> } {
  let found: { migration: string; types: Set<string> } | null = null
  for (const migration of readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(MIGRATIONS, migration), 'utf8')
    for (const match of sql.matchAll(CONSTRAINT)) {
      found = { migration, types: new Set([...match[1].matchAll(/'([^']+)'/g)].map((quoted) => quoted[1])) }
    }
  }
  if (!found || found.types.size === 0) {
    throw new Error('No migration defines rota_email_log_email_type_check in a form this guard can read')
  }
  return found
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) sourceFiles(full, out)
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.|database\.generated/.test(entry.name)) out.push(full)
  }
  return out
}

/** True when the expression is a query chain that starts from `.from('rota_email_log')`. */
function writesToTable(expression: ts.Expression): boolean {
  let node: ts.Node | undefined = expression
  while (node) {
    if (ts.isCallExpression(node)) {
      const callee: ts.Expression = node.expression
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'from') {
        const target = node.arguments[0]
        return Boolean(target && ts.isStringLiteralLike(target) && target.text === TABLE)
      }
      node = ts.isPropertyAccessExpression(callee) ? callee.expression : undefined
    } else if (ts.isPropertyAccessExpression(node) || ts.isAwaitExpression(node) || ts.isParenthesizedExpression(node)) {
      node = node.expression
    } else {
      node = undefined
    }
  }
  return false
}

function propertyNamed(object: ts.ObjectLiteralExpression, name: string): ts.PropertyAssignment | undefined {
  return object.properties.find(
    (property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) &&
      (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
      property.name.text === name,
  )
}

function scan(): { written: Written[]; unreadable: string[] } {
  const written: Written[] = []
  const unreadable: string[] = []

  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, 'utf8')
    if (!text.includes(TABLE)) continue
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    const at = (node: ts.Node): string =>
      `${relative(ROOT, file)}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`

    /** `email_type: alert.emailType`: the values are whatever this file passes as `emailType`. */
    const passedAsEmailType = (from: ts.Node): void => {
      let seen = 0
      const visit = (node: ts.Node): void => {
        if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === 'emailType') {
          seen += 1
          if (ts.isStringLiteralLike(node.initializer)) written.push({ where: at(node), value: node.initializer.text })
          else unreadable.push(`${at(node)} passes an emailType that is not a plain string`)
        }
        ts.forEachChild(node, visit)
      }
      visit(source)
      if (seen === 0) unreadable.push(`${at(from)} writes an emailType that nothing in the file sets`)
    }

    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ['insert', 'upsert', 'update'].includes(node.expression.name.text) &&
        writesToTable(node.expression.expression)
      ) {
        const method = node.expression.name.text
        const payload = node.arguments[0]
        const rows = payload && ts.isArrayLiteralExpression(payload) ? [...payload.elements] : [payload]
        for (const row of rows) {
          if (!row || !ts.isObjectLiteralExpression(row)) {
            unreadable.push(`${at(node)} ${method}s a row that is not written out in place`)
            continue
          }
          const emailType = propertyNamed(row, 'email_type')
          if (!emailType) {
            if (method !== 'update') unreadable.push(`${at(row)} ${method}s a row with no email_type`)
          } else if (ts.isStringLiteralLike(emailType.initializer)) {
            written.push({ where: at(emailType), value: emailType.initializer.text })
          } else if (ts.isPropertyAccessExpression(emailType.initializer) && emailType.initializer.name.text === 'emailType') {
            passedAsEmailType(emailType)
          } else {
            unreadable.push(`${at(emailType)} writes an email_type that is not a plain string`)
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }

  return { written, unreadable }
}

describe('rota_email_log email types', () => {
  const allowed = allowedEmailTypes()
  const { written, unreadable } = scan()

  it('reads the allowed list and the writers, so the checks below are not passing on nothing', () => {
    expect(allowed.types.has('staff_rota')).toBe(true)
    expect(allowed.types.size).toBeGreaterThanOrEqual(10)
    expect(written.map(({ value }) => value)).toContain('staff_rota')
    expect(new Set(written.map(({ where }) => where.split(':')[0])).size).toBeGreaterThanOrEqual(5)
  })

  it('can read every place that writes to the log', () => {
    expect(unreadable).toEqual([])
  })

  it('writes only email types the check constraint allows', () => {
    const refused = written
      .filter(({ value }) => !allowed.types.has(value))
      .map(({ where, value }) => `${where} writes '${value}', which ${allowed.migration} does not allow`)

    expect(refused).toEqual([])
  })
})
