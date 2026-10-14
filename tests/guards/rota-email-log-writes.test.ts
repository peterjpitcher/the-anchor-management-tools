import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * Every write to rota_email_log must go through settleRotaEmailLogWrite, awaited.
 *
 * Each writer used to `await supabase.from('rota_email_log').insert({...})` and drop the result.
 * From 18 August to 13 October 2026 the daily unfilled shift cron wrote an email_type the table's
 * check refused (23514): the email went out, the log row was refused, and nothing said so. The
 * helper in src/lib/rota/email-log.ts reads the result and reports a failure at error level.
 *
 * This walks the source with the TypeScript parser. A write chain (insert, upsert, update or
 * delete) that starts from `.from('rota_email_log')` must be the first argument of an awaited
 * settleRotaEmailLogWrite call, and the helper's `type` must match the row's email_type so the
 * report names the right email. The table name may only appear as the argument of `.from(...)`,
 * so a writer cannot hide it behind a constant.
 */

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const TABLE = 'rota_email_log'
const HELPER = 'settleRotaEmailLogWrite'
const WRITE_METHODS = new Set(['insert', 'upsert', 'update', 'delete'])

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) sourceFiles(full, out)
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.|database\.generated/.test(entry.name)) out.push(full)
  }
  return out
}

function isFromTable(node: ts.Node): node is ts.CallExpression {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return false
  if (node.expression.name.text !== 'from') return false
  const target = node.arguments[0]
  return Boolean(target && ts.isStringLiteralLike(target) && target.text === TABLE)
}

/** The write method called somewhere along the chain that starts at a `.from(TABLE)` call. */
function writeMethodInChain(fromCall: ts.CallExpression): { method: string; call: ts.CallExpression; outermost: ts.Expression } | null {
  let write: { method: string; call: ts.CallExpression } | null = null
  let current: ts.Expression = fromCall
  // Climb `.method(...)` links while this node is the object of the next call in the chain.
  for (;;) {
    const access = current.parent
    if (!access || !ts.isPropertyAccessExpression(access) || access.expression !== current) break
    const call = access.parent
    if (!call || !ts.isCallExpression(call) || call.expression !== access) break
    if (!write && WRITE_METHODS.has(access.name.text)) write = { method: access.name.text, call }
    current = call
  }
  return write ? { ...write, outermost: current } : null
}

function propertyNamed(object: ts.ObjectLiteralExpression, name: string): ts.PropertyAssignment | undefined {
  return object.properties.find(
    (property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) &&
      (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
      property.name.text === name,
  )
}

interface Scan {
  writers: string[]
  problems: string[]
}

function scan(): Scan {
  const writers: string[] = []
  const problems: string[] = []

  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, 'utf8')
    if (!text.includes(TABLE)) continue
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    const at = (node: ts.Node): string =>
      `${relative(ROOT, file)}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`

    const visit = (node: ts.Node): void => {
      if (ts.isStringLiteralLike(node) && node.text === TABLE && !(node.parent && isFromTable(node.parent))) {
        problems.push(`${at(node)} names ${TABLE} outside a .from(...) call, so this guard cannot follow it`)
      }

      if (isFromTable(node)) {
        const write = writeMethodInChain(node)
        if (write) {
          const where = at(write.call)
          writers.push(where)
          const helperCall = write.outermost.parent
          const wrapped =
            helperCall &&
            ts.isCallExpression(helperCall) &&
            ts.isIdentifier(helperCall.expression) &&
            helperCall.expression.text === HELPER &&
            helperCall.arguments[0] === write.outermost

          if (!wrapped) {
            problems.push(`${where} ${write.method}s into ${TABLE} without passing the write to ${HELPER}`)
          } else if (!helperCall.parent || !ts.isAwaitExpression(helperCall.parent)) {
            problems.push(`${where} calls ${HELPER} without awaiting it`)
          } else {
            const row = write.call.arguments[0]
            const context = helperCall.arguments[1]
            const rowType = row && ts.isObjectLiteralExpression(row) ? propertyNamed(row, 'email_type') : undefined
            const contextType = context && ts.isObjectLiteralExpression(context) ? propertyNamed(context, 'type') : undefined
            if (rowType && (!contextType || contextType.initializer.getText() !== rowType.initializer.getText())) {
              problems.push(
                `${where} writes email_type ${rowType.initializer.getText()} but reports failures as ${contextType?.initializer.getText() ?? 'nothing'}`,
              )
            }
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }

  return { writers, problems }
}

describe('rota_email_log writes', () => {
  const { writers, problems } = scan()

  it('finds the known writers, so the guard is not passing on an empty scan', () => {
    const files = new Set(writers.map((where) => where.replace(/:\d+$/, '')))
    expect([...files].sort()).toEqual(
      expect.arrayContaining([
        'src/app/actions/leave.ts',
        'src/app/actions/payroll.ts',
        'src/app/actions/rota.ts',
        'src/app/api/cron/rota-shift-acceptance/route.ts',
        'src/app/api/cron/rota-unfilled-urgent/route.ts',
        'src/lib/rota/send-rota-emails.ts',
      ]),
    )
    expect(writers.length).toBeGreaterThanOrEqual(9)
  })

  it('reads the result of every write and reports a failure', () => {
    expect(problems).toEqual([])
  })
})
