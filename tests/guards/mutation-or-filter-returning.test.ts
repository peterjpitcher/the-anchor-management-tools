import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'

/**
 * An update, delete, insert or upsert that filters with `.or()` and returns rows with `.select()`
 * must return every column the `.or()` names.
 *
 * PostgREST applies a logical filter twice on a write: once in the UPDATE and again to the rows it
 * hands back, which hold only the selected columns. So `.update(...).or('status.is.null,...')
 * .select('id')` fails before it writes anything, with "column private_bookings.status does not
 * exist", although the table has the column. On 14 October 2026 that stopped a signed private
 * booking contract from being marked accepted, the day before the party; the same chain sat in
 * the waiver hook, the "accepted another way" action and the table deposit timeout cron.
 *
 * Only a literal `.or()` string can be read; a built one is skipped. A chain held in a variable
 * (`let update = admin.from(...)...; update = update.eq(...); await update.select('id')`) is
 * followed through the assignments to that name in the same function.
 */
const SRC = join(process.cwd(), 'src')
const WRITES = new Set(['update', 'delete', 'insert', 'upsert'])
const FILTER_OPS = /^(eq|neq|gt|gte|lt|lte|like|ilike|is|in|cs|cd|ov|fts|plfts|phfts|wfts|match|imatch|not)$/

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
  })
}

type Link = { method: string; args: readonly ts.Expression[] }

/** The calls in a chain, outermost last, following a variable back through its assignments. */
function chainOf(expression: ts.Expression, scope: ts.Node, seen: ReadonlySet<string> = new Set()): Link[] {
  const links: Link[] = []
  let current: ts.Expression = expression
  while (ts.isCallExpression(current) && ts.isPropertyAccessExpression(current.expression)) {
    links.unshift({ method: current.expression.name.text, args: current.arguments })
    current = current.expression.expression
  }
  if (ts.isAwaitExpression(current) || ts.isParenthesizedExpression(current)) return [...chainOf(current.expression, scope, seen), ...links]
  if (ts.isIdentifier(current) && !seen.has(current.text)) {
    const name = current.text
    const inner = new Set([...seen, name])
    const earlier: Link[] = []
    const visit = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer) {
        earlier.push(...chainOf(node.initializer, scope, inner))
      } else if (
        ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isIdentifier(node.left) && node.left.text === name
      ) {
        earlier.push(...chainOf(node.right, scope, inner))
      }
      ts.forEachChild(node, visit)
    }
    visit(scope)
    return [...earlier, ...links]
  }
  return links
}

/** The columns a literal `.or()` string filters on, nested `and(...)` groups included. */
function orColumns(text: string): string[] {
  return Array.from(text.matchAll(/(?:^|[(,])\s*([a-z_][a-z0-9_]*)\.([a-z]+)\./gi))
    .filter((match) => FILTER_OPS.test(match[2]))
    .map((match) => match[1])
}

function selectColumns(text: string): Set<string> | 'all' {
  if (text.trim() === '' || text.includes('*')) return 'all'
  return new Set(text.split(',').map((item) => item.trim().split(/[:(!\s]/)[0]).filter(Boolean))
}

function findings(): string[] {
  const found: string[] = []
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, 'utf8')
    if (!text.includes('.or(')) continue
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'select') {
        const parent = node.parent
        const isOutermostSelect = !(ts.isPropertyAccessExpression(parent) && ts.isCallExpression(parent.parent) && (parent.parent.expression as ts.PropertyAccessExpression).name?.text === 'select')
        let scope: ts.Node = node
        while (scope.parent && !ts.isFunctionLike(scope)) scope = scope.parent
        const chain = chainOf(node, scope)
        if (isOutermostSelect && chain.some((link) => WRITES.has(link.method))) {
          const selected = node.arguments[0]
          const columns = selected && ts.isStringLiteralLike(selected) ? selectColumns(selected.text) : selected ? null : 'all'
          if (columns && columns !== 'all') {
            for (const link of chain) {
              const filter = link.args[0]
              if ((link.method !== 'or' && link.method !== 'and') || !filter || !ts.isStringLiteralLike(filter)) continue
              for (const column of orColumns(filter.text)) {
                if (!columns.has(column)) {
                  const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1
                  found.push(`${relative(process.cwd(), file)}:${line} returns no "${column}" but .${link.method}() filters on it`)
                }
              }
            }
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return Array.from(new Set(found)).sort()
}

describe('writes filtered with .or() return the columns they filter on', () => {
  it('reads the columns out of an .or() string', () => {
    expect(orColumns('status.is.null,status.neq.cancelled')).toEqual(['status', 'status'])
    expect(orColumns('and(table_id.eq.1,join_table_id.eq.2)')).toEqual(['table_id', 'join_table_id'])
  })

  it('has no write whose returned rows lack a column its .or() names', () => {
    expect(findings()).toEqual([])
  })
})
