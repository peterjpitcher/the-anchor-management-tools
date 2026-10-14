import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * No Supabase write may throw its result away.
 *
 * supabase-js returns `{ error }` on a refused write instead of throwing. On 14 October 2026
 * about 130 inserts, upserts, updates and deletes in src/ were awaited as bare statements, so a
 * check constraint, a missing column or an RLS refusal vanished. rota_email_log lost eight weeks
 * of rows that way. A write must either read its result or go through settleWrite
 * (src/lib/supabase/settle-write.ts), which reports a failure at error level.
 *
 * This walks the source with the TypeScript parser and flags a write chain (`.from(...)` then
 * insert, upsert, update or delete) whose result is definitely discarded:
 *   - a bare statement, awaited or not, or `void`ed;
 *   - an element of a Promise.all or Promise.allSettled array, or the body of an arrow mapped
 *     into one, when that Promise.all is itself a bare statement;
 *   - a destructure that does not take `error`, or takes it and never reads it.
 * A write passed to settleWrite or settleRotaEmailLogWrite must keep that call's promise.
 */

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const WRITE_METHODS = new Set(['insert', 'upsert', 'update', 'delete'])
const HELPERS = new Set(['settleWrite', 'settleRotaEmailLogWrite'])

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__') sourceFiles(full, out)
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.|database\.generated/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

function isFromCall(node: ts.Node): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'from' &&
    node.arguments.length >= 1
  )
}

/** Climbs `.method(...)` links from a `.from(...)` call; returns the outermost call if a write is on the chain. */
function writeChain(fromCall: ts.CallExpression): { method: string; outermost: ts.Expression } | null {
  let method: string | null = null
  // `(client.from('t') as any).insert(...)` is common, so step over casts and brackets.
  let current = climb(fromCall) as ts.Expression
  for (;;) {
    const access = current.parent
    if (!access || !ts.isPropertyAccessExpression(access) || access.expression !== current) break
    const call = access.parent
    if (!call || !ts.isCallExpression(call) || call.expression !== access) break
    if (!method && WRITE_METHODS.has(access.name.text)) method = access.name.text
    current = climb(call) as ts.Expression
  }
  return method ? { method, outermost: current } : null
}

/** Skips parentheses and type assertions upwards. */
function climb(node: ts.Node): ts.Node {
  let current = node
  while (
    current.parent &&
    (ts.isParenthesizedExpression(current.parent) ||
      ts.isAsExpression(current.parent) ||
      ts.isNonNullExpression(current.parent) ||
      ts.isSatisfiesExpression(current.parent))
  ) {
    current = current.parent
  }
  return current
}

function isDiscardedPromiseAll(call: ts.Node): boolean {
  if (!ts.isCallExpression(call)) return false
  const callee = call.expression.getText()
  if (callee !== 'Promise.all' && callee !== 'Promise.allSettled') return false
  const outer = climb(call)
  const parent = outer.parent
  if (parent && ts.isExpressionStatement(parent)) return true
  if (parent && ts.isAwaitExpression(parent)) {
    const awaited = climb(parent)
    return Boolean(awaited.parent && ts.isExpressionStatement(awaited.parent))
  }
  return false
}

/** True when an identifier declared in `declaration` is never referenced again in its scope. */
function neverRead(identifier: ts.Identifier): boolean {
  let scope: ts.Node | undefined = identifier.parent
  while (scope && !ts.isBlock(scope) && !ts.isSourceFile(scope) && !ts.isFunctionLike(scope)) scope = scope.parent
  if (!scope) return false
  let uses = 0
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === identifier.text) uses += 1
    ts.forEachChild(node, visit)
  }
  visit(scope)
  return uses <= 1
}

function discardReason(outermost: ts.Expression): string | null {
  const self = climb(outermost)
  const parent = self.parent
  if (!parent) return null

  if (ts.isExpressionStatement(parent)) return 'is a bare statement and is never awaited or read'
  if (ts.isVoidExpression(parent)) return 'is voided, so its error is never read'

  if (ts.isCallExpression(parent) && ts.isIdentifier(parent.expression) && HELPERS.has(parent.expression.text)) {
    // The helper never throws, so it is safe anywhere its promise is kept: awaited, returned,
    // or mapped into a Promise.all. Dropping the promise itself is the only way to lose it.
    const helperCall = climb(parent)
    const holder = helperCall.parent
    return holder && (ts.isExpressionStatement(holder) || ts.isVoidExpression(holder))
      ? `is passed to ${parent.expression.text} without awaiting it`
      : null
  }

  if (ts.isArrayLiteralExpression(parent) && parent.parent && isDiscardedPromiseAll(parent.parent)) {
    return 'sits in a Promise.all whose results are never read'
  }

  if (ts.isArrowFunction(parent) && parent.body === self) {
    const mapCall = climb(parent).parent
    if (mapCall && ts.isCallExpression(mapCall) && mapCall.parent && isDiscardedPromiseAll(mapCall.parent)) {
      return 'is mapped into a Promise.all whose results are never read'
    }
  }

  if (ts.isAwaitExpression(parent)) {
    const awaited = climb(parent)
    const holder = awaited.parent
    if (holder && ts.isExpressionStatement(holder)) return 'is awaited as a bare statement, so its error is never read'
    if (holder && ts.isVariableDeclaration(holder) && ts.isObjectBindingPattern(holder.name)) {
      const errorBinding = holder.name.elements.find(
        (element) => (element.propertyName ?? element.name).getText() === 'error',
      )
      if (!errorBinding) return 'is destructured without taking `error`'
      if (ts.isIdentifier(errorBinding.name) && neverRead(errorBinding.name)) {
        return `takes \`${errorBinding.name.text}\` and never reads it`
      }
    }
  }
  return null
}

interface Finding {
  where: string
  problem: string
}

function scan(): { writes: number; findings: Finding[] } {
  let writes = 0
  const findings: Finding[] = []

  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, 'utf8')
    if (!text.includes('.from(')) continue
    const source = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    )
    const visit = (node: ts.Node): void => {
      if (isFromCall(node)) {
        const chain = writeChain(node)
        if (chain) {
          writes += 1
          const reason = discardReason(chain.outermost)
          if (reason) {
            const target = node.arguments[0]
            const table = ts.isStringLiteralLike(target) ? target.text : target.getText()
            const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1
            findings.push({
              where: `${relative(ROOT, file)}:${line}`,
              problem: `${chain.method} into ${table} ${reason}; read the error or use settleWrite`,
            })
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return { writes, findings }
}

describe('Supabase writes', () => {
  const { writes, findings } = scan()

  it('finds the writes, so the guard is not passing on an empty scan', () => {
    expect(writes).toBeGreaterThan(500)
  })

  it('reads the result of every write or reports it through settleWrite', () => {
    expect(findings.map((finding) => `${finding.where} ${finding.problem}`)).toEqual([])
  })
})
