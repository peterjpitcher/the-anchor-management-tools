import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'
import { columnsNamedBySelect, publicSchemaColumns, type SchemaColumns } from '../helpers/generatedSchema'

/**
 * A soft delete column may only be named against a table that has one.
 *
 * On 13 October 2026 the Quotes list was found dead in production: three reads in
 * src/app/actions/quotes.ts filtered on `quotes.deleted_at`, a column the table has never had,
 * and PostgREST answers that with a 400 ("column quotes.deleted_at does not exist"). The filter
 * had been there since 3 March. The same fault was fixed on the dashboard on 30 June without
 * anyone looking for its siblings, and nothing noticed either time because production held no
 * quotes and the Supabase clients are not typed against the schema.
 *
 * So this guard reads every query chain that starts at `.from('<table>')` and, wherever a
 * filter, a select list or a write names `deleted_at` or `deleted_by`, checks the table has that
 * column in src/types/database.generated.ts. Only `invoices` has a soft delete today (checked
 * against the live database on 13 October 2026).
 *
 * If this fails for a table that really has the column, the generated types are stale:
 * regenerate them and commit them with the migration, as the workspace rules ask.
 *
 * Files are read with the TypeScript parser, as in tests/guards/page-contract.test.ts, so a
 * column name in a comment never counts and a chain that spans many lines is read whole.
 */
const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const SOFT_DELETE_COLUMNS = new Set(['deleted_at', 'deleted_by'])

const FILTER_METHODS = new Set([
  'eq', 'neq', 'is', 'in', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'not', 'filter', 'order',
  'contains', 'containedBy', 'overlaps',
])
const WRITE_METHODS = new Set(['update', 'insert', 'upsert'])

type Reference = { file: string; line: number; table: string; column: string; how: string }
type Scan = { references: Reference[]; unresolved: string[] }

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === '__mocks__') continue
      sourceFiles(full, found)
    } else if (/\.tsx?$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry) && entry !== 'database.generated.ts') {
      found.push(full)
    }
  }
  return found
}

function literalText(node: ts.Node | undefined): string | null {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null
}

/** The initialiser of the nearest earlier `const name = ...` in the enclosing functions or file. */
function initialiserOf(identifier: ts.Identifier): ts.Expression | null {
  for (let scope: ts.Node | undefined = identifier.parent; scope; scope = scope.parent) {
    if (!ts.isFunctionLike(scope) && !ts.isSourceFile(scope)) continue
    const earlier: ts.Expression[] = []
    const visit = (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === identifier.text &&
        node.initializer && node.getStart() < identifier.getStart()
      ) {
        earlier.push(node.initializer)
      }
      ts.forEachChild(node, visit)
    }
    visit(scope)
    if (earlier.length > 0) return earlier[earlier.length - 1]
  }
  return null
}

/**
 * The table a query chain reads or writes: the `.from('<table>')` it starts from. A chain kept
 * in a variable (`let query = supabase.from('x')...; query = query.eq(...)`) is followed to its
 * declaration. Null when the chain is not a table query we can name (storage, rpc, a parameter).
 */
function tableOfChain(node: ts.Expression, depth = 0): string | null {
  let current: ts.Expression = node
  for (;;) {
    if (ts.isCallExpression(current) && ts.isPropertyAccessExpression(current.expression)) {
      const method = current.expression.name.text
      const receiver = current.expression.expression
      if (method === 'from') {
        if (ts.isPropertyAccessExpression(receiver) && receiver.name.text === 'storage') return null
        return literalText(current.arguments[0])
      }
      if (method === 'rpc') return null
      current = receiver
    } else if (
      ts.isPropertyAccessExpression(current) || ts.isNonNullExpression(current) || ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) || ts.isAwaitExpression(current)
    ) {
      current = current.expression
    } else if (ts.isIdentifier(current) && depth < 3) {
      const initialiser = initialiserOf(current)
      return initialiser ? tableOfChain(initialiser, depth + 1) : null
    } else {
      return null
    }
  }
}

/** Every place `text` names a soft delete column in a query, with the table it is named against. */
function scan(file: string, text: string, schema: SchemaColumns): Scan {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const references: Reference[] = []
  const unresolved: string[] = []
  const lineOf = (node: ts.Node): number => source.getLineAndCharacterOfPosition(node.getStart()).line + 1

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text
      const receiver = node.expression.expression
      const first = node.arguments[0]

      if (FILTER_METHODS.has(method)) {
        const column = literalText(first)
        if (column && SOFT_DELETE_COLUMNS.has(column)) {
          const table = tableOfChain(receiver)
          if (table) references.push({ file, line: lineOf(node), table, column, how: `.${method}()` })
          else unresolved.push(`${file}:${lineOf(node)} .${method}('${column}')`)
        }
      } else if (method === 'select') {
        const select = literalText(first) ?? (first && ts.isIdentifier(first) ? literalText(initialiserOf(first) ?? undefined) : null)
        const table = select ? tableOfChain(receiver) : null
        if (select && table) {
          for (const named of columnsNamedBySelect(table, select, schema)) {
            if (SOFT_DELETE_COLUMNS.has(named.column)) references.push({ file, line: lineOf(node), ...named, how: '.select()' })
          }
        }
      } else if (WRITE_METHODS.has(method) && first) {
        const rows = ts.isObjectLiteralExpression(first) ? [first] : ts.isArrayLiteralExpression(first) ? first.elements.filter(ts.isObjectLiteralExpression) : []
        const table = rows.length > 0 ? tableOfChain(receiver) : null
        if (table) {
          for (const property of rows.flatMap((row) => [...row.properties])) {
            const name = property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) ? property.name.text : null
            if (name && SOFT_DELETE_COLUMNS.has(name)) references.push({ file, line: lineOf(property), table, column: name, how: `.${method}()` })
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return { references, unresolved }
}

function offences(references: Reference[], schema: SchemaColumns): string[] {
  return references
    .filter(({ table, column }) => !schema.get(table)?.has(column))
    .map(({ file, line, table, column, how }) => `${file}:${line} ${how} names ${table}.${column}`)
}

describe('soft delete columns', () => {
  const schema = publicSchemaColumns()

  it('catches each shape of the quotes fault of 13 October 2026', () => {
    const quotesAsItWas = `
      async function getQuotes(supabase) {
        let query = supabase.from('quotes').select('*, vendor:invoice_vendors(*)').is('deleted_at', null)
        query = query.order('quote_date', { ascending: false })
        return query
      }
      async function deleteQuote(supabase, quoteId, userId) {
        await supabase.from('quotes').select('id, status, deleted_at').eq('id', quoteId).single()
        await supabase
          .from('quotes')
          .update({ deleted_at: new Date().toISOString(), deleted_by: userId })
          .eq('id', quoteId)
      }
    `
    const found = scan('src/app/actions/quotes.ts', quotesAsItWas, schema)

    expect(offences(found.references, schema)).toEqual([
      "src/app/actions/quotes.ts:3 .is() names quotes.deleted_at",
      "src/app/actions/quotes.ts:8 .select() names quotes.deleted_at",
      "src/app/actions/quotes.ts:11 .update() names quotes.deleted_at",
      "src/app/actions/quotes.ts:11 .update() names quotes.deleted_by",
    ])
  })

  it('follows a query kept in a variable and a select list kept in a constant', () => {
    const text = `
      const COLUMNS = 'id, invoice:invoices!private_bookings_invoice_id_fkey(id, deleted_at)'
      async function load(supabase, onlyLive) {
        let query = supabase.from('quotes').select('id')
        if (onlyLive) query = query.is('deleted_at', null)
        await supabase.from('private_bookings').select(COLUMNS)
        return query
      }
    `
    const found = scan('src/example.ts', text, schema)

    expect(found.unresolved).toEqual([])
    expect(found.references.map(({ table, column, how }) => `${how} ${table}.${column}`)).toEqual([
      '.is() quotes.deleted_at',
      '.select() invoices.deleted_at',
    ])
    expect(offences(found.references, schema)).toEqual(["src/example.ts:5 .is() names quotes.deleted_at"])
  })

  it('allows the soft delete on invoices, the one table that has it', () => {
    const text = `
      async function removeInvoice(supabase, id, userId) {
        await supabase.from('invoices').select('id, status, deleted_at').eq('id', id).is('deleted_at', null).single()
        await supabase.from('invoices').update({ deleted_at: new Date().toISOString(), deleted_by: userId }).eq('id', id)
      }
    `
    const found = scan('src/example.ts', text, schema)

    expect(found.references).toHaveLength(4)
    expect(offences(found.references, schema)).toEqual([])
  })

  it('names a soft delete column only against a table that has one', () => {
    const references: Reference[] = []
    const unresolved: string[] = []
    for (const file of sourceFiles(SRC)) {
      const text = readFileSync(file, 'utf8')
      if (!text.includes('deleted_at') && !text.includes('deleted_by')) continue
      const found = scan(relative(ROOT, file), text, schema)
      references.push(...found.references)
      unresolved.push(...found.unresolved)
    }

    // A scanner that finds nothing passes for the wrong reason: the invoice reads alone are dozens.
    expect(references.length).toBeGreaterThan(40)
    // A filter whose table cannot be read off the code cannot be checked. Start the chain at
    // .from('<table>'), in the same function, so this guard can see it.
    expect(unresolved).toEqual([])
    expect(offences(references, schema)).toEqual([])
  })
})
