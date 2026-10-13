import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

/**
 * The columns of every table and view in the public schema, read from the committed generated
 * types (src/types/database.generated.ts). That file is the repo's copy of the live schema, so a
 * test can ask "does this table have this column?" without a database.
 *
 * The app's Supabase clients are not typed against it, which is why TypeScript says nothing when
 * a query names a column that is not there. PostgREST does: a missing column in a filter or a
 * select is a 400 at run time.
 */
const GENERATED_TYPES = join(process.cwd(), 'src/types/database.generated.ts')

export type SchemaColumns = Map<string, Set<string>>
export type ColumnReference = { table: string; column: string }

let cached: SchemaColumns | null = null

function nameOf(member: ts.TypeElement): string | null {
  const name = member.name
  if (!name) return null
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : null
}

function members(node: ts.TypeNode | undefined): ts.PropertySignature[] {
  return node && ts.isTypeLiteralNode(node) ? node.members.filter(ts.isPropertySignature) : []
}

function memberType(node: ts.TypeNode | undefined, name: string): ts.TypeNode | undefined {
  return members(node).find((member) => nameOf(member) === name)?.type
}

export function publicSchemaColumns(): SchemaColumns {
  if (cached) return cached

  const source = ts.createSourceFile(GENERATED_TYPES, readFileSync(GENERATED_TYPES, 'utf8'), ts.ScriptTarget.Latest, false)
  const database = source.statements.find(
    (statement): statement is ts.TypeAliasDeclaration => ts.isTypeAliasDeclaration(statement) && statement.name.text === 'Database'
  )
  const publicSchema = memberType(database?.type, 'public')

  const columns: SchemaColumns = new Map()
  for (const group of ['Tables', 'Views']) {
    for (const relation of members(memberType(publicSchema, group))) {
      const relationName = nameOf(relation)
      if (!relationName) continue
      const rowColumns = members(memberType(relation.type, 'Row')).map(nameOf).filter((name): name is string => name !== null)
      columns.set(relationName, new Set(rowColumns))
    }
  }

  if (columns.size === 0) {
    throw new Error('No tables found in src/types/database.generated.ts: has its shape changed?')
  }
  cached = columns
  return columns
}

/** Splits a PostgREST select list on its top-level commas, leaving embedded lists whole. */
function selectItems(select: string): string[] {
  const items: string[] = []
  let depth = 0
  let current = ''
  for (const char of select) {
    if (char === '(') depth += 1
    if (char === ')') depth -= 1
    if (char === ',' && depth === 0) {
      items.push(current)
      current = ''
    } else {
      current += char
    }
  }
  items.push(current)
  return items.map((item) => item.trim()).filter(Boolean)
}

/**
 * Every plain column a PostgREST select names, with the table it is read from. An embedded
 * resource (`alias:table!hint(columns)`) is followed when its target is a table or view we know;
 * one named after a foreign key column cannot be resolved here and is skipped. `*`, JSON paths
 * and casts are reduced to the column they start from.
 */
export function columnsNamedBySelect(table: string, select: string, schema: SchemaColumns): ColumnReference[] {
  const named: ColumnReference[] = []
  for (const item of selectItems(select)) {
    const embedded = item.match(/^(?:[\w]+\s*:\s*)?(\w+)(?:\s*!\s*\w+)*\s*\(([\s\S]*)\)$/)
    if (embedded) {
      const [, target, inner] = embedded
      if (schema.has(target)) named.push(...columnsNamedBySelect(target, inner, schema))
      continue
    }
    if (item === '*') continue
    const withoutAlias = /^\w+\s*:\s*[^:]/.test(item) ? item.slice(item.indexOf(':') + 1) : item
    const column = withoutAlias.split('::')[0].split('->')[0].trim()
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(column)) named.push({ table, column })
  }
  return named
}
