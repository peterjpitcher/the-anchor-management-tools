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

/** A foreign key as the generated types record it: its name, its columns and where it points. */
type Relationship = { name: string; columns: string[]; target: string }
type Schema = { columns: SchemaColumns; views: Set<string>; relationships: Map<string, Relationship[]> }

let cached: Schema | null = null

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

function stringOf(node: ts.TypeNode | undefined): string | null {
  return node && ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal) ? node.literal.text : null
}

function relationshipsOf(relation: ts.TypeNode | undefined): Relationship[] {
  const list = memberType(relation, 'Relationships')
  if (!list || !ts.isTupleTypeNode(list)) return []
  return list.elements.flatMap((element) => {
    const name = stringOf(memberType(element, 'foreignKeyName'))
    const target = stringOf(memberType(element, 'referencedRelation'))
    const columns = memberType(element, 'columns')
    if (!name || !target || !columns || !ts.isTupleTypeNode(columns)) return []
    return [{ name, target, columns: columns.elements.map(stringOf).filter((column): column is string => column !== null) }]
  })
}

function publicSchema(): Schema {
  if (cached) return cached

  const source = ts.createSourceFile(GENERATED_TYPES, readFileSync(GENERATED_TYPES, 'utf8'), ts.ScriptTarget.Latest, false)
  const database = source.statements.find(
    (statement): statement is ts.TypeAliasDeclaration => ts.isTypeAliasDeclaration(statement) && statement.name.text === 'Database'
  )
  const publicTypes = memberType(database?.type, 'public')

  const schema: Schema = { columns: new Map(), views: new Set(), relationships: new Map() }
  for (const group of ['Tables', 'Views']) {
    for (const relation of members(memberType(publicTypes, group))) {
      const relationName = nameOf(relation)
      if (!relationName) continue
      const rowColumns = members(memberType(relation.type, 'Row')).map(nameOf).filter((name): name is string => name !== null)
      schema.columns.set(relationName, new Set(rowColumns))
      schema.relationships.set(relationName, relationshipsOf(relation.type))
      if (group === 'Views') schema.views.add(relationName)
    }
  }

  if (schema.columns.size === 0) {
    throw new Error('No tables found in src/types/database.generated.ts: has its shape changed?')
  }
  cached = schema
  return schema
}

export function publicSchemaColumns(): SchemaColumns {
  return publicSchema().columns
}

/**
 * The table or view an embedded resource reads. PostgREST accepts three spellings in a select:
 * the related table's own name, a foreign key column on the parent (`customer:customer_id(...)`)
 * and a foreign key's constraint name. Null when none of them fits, which is either a computed
 * relationship or a relationship the generated types do not record.
 */
export function embeddedRelation(parent: string, target: string): string | null {
  const { columns, views, relationships } = publicSchema()
  if (columns.has(target)) return target

  // The types repeat a foreign key once for every view over the table it points at. The key
  // itself points at the table, so that is the one to read the columns from.
  const outward = (relationships.get(parent) ?? []).filter(
    (relationship) => relationship.name === target || (relationship.columns.length === 1 && relationship.columns[0] === target)
  )
  const pointsAt = outward.find((relationship) => !views.has(relationship.target)) ?? outward[0]
  if (pointsAt) return pointsAt.target

  const inward = [...relationships].filter(([, list]) => list.some((relationship) => relationship.name === target && relationship.target === parent))
  const pointsFrom = inward.find(([relation]) => !views.has(relation)) ?? inward[0]
  return pointsFrom ? pointsFrom[0] : null
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

export type SelectReading = {
  /** Every plain column the select names, with the table or view it is read from. */
  columns: ColumnReference[]
  /** The top-level embedded resources, keyed by the name a filter uses for them (alias, else target). */
  embedded: Map<string, string>
  /** Items that could not be read, so nothing in them was checked. */
  unread: string[]
}

const EMBEDDED_RESOURCE = /^(?:(\w+)\s*:\s*)?(?:\.\.\.\s*)?(\w+)(?:\s*!\s*\w+)*\s*\(([\s\S]*)\)$/
const ROW_COUNT = /^(?:\w+\s*:\s*)?count(?:\(\))?$/
const AGGREGATE = /\.(?:count|sum|avg|min|max)\(\)$/

/**
 * Reads a PostgREST select list against `table`. An embedded resource
 * (`alias:target!hint(columns)`) is followed into the table it reads, see `embeddedRelation`.
 * `*` names no column. A JSON path, a cast and an aggregate (`amount.sum()`) are reduced to the
 * column they start from, and `count` or `count()` on its own is the row count, not a column.
 */
export function readSelect(table: string, select: string, schema: SchemaColumns): SelectReading {
  const reading: SelectReading = { columns: [], embedded: new Map(), unread: [] }
  for (const item of selectItems(select)) {
    if (item === '*') continue
    if (ROW_COUNT.test(item) && !schema.get(table)?.has('count')) continue

    const embedded = item.match(EMBEDDED_RESOURCE)
    if (embedded) {
      const [, alias, target, inner] = embedded
      const relation = embeddedRelation(table, target)
      if (relation) {
        reading.embedded.set(alias ?? target, relation)
        const nested = readSelect(relation, inner, schema)
        reading.columns.push(...nested.columns)
        reading.unread.push(...nested.unread)
      } else {
        reading.unread.push(`${table}: ${alias ? `${alias}:` : ''}${target}(...)`)
      }
      continue
    }

    const withoutAlias = /^\w+\s*:\s*[^:]/.test(item) ? item.slice(item.indexOf(':') + 1) : item
    const column = withoutAlias.split('::')[0].split('->')[0].trim().replace(AGGREGATE, '')
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(column)) reading.columns.push({ table, column })
    else reading.unread.push(`${table}: ${item}`)
  }
  return reading
}

/** Every plain column a PostgREST select names, with the table it is read from. See `readSelect`. */
export function columnsNamedBySelect(table: string, select: string, schema: SchemaColumns): ColumnReference[] {
  return readSelect(table, select, schema).columns
}
