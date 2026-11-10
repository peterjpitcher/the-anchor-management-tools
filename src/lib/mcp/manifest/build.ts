import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import ts from 'typescript'

/**
 * Builds the lists the MCP bridge serves: every server action, every API route a person (rather
 * than a machine) can call, and every table and view. It reads the code, so a new or changed
 * feature reaches the MCP server by re-running `npm run mcp:manifest`, and
 * tests/guards/mcp-manifest.test.ts fails when the committed lists are out of date.
 *
 * Parse only, no type checker: the whole run takes a second or two, which keeps the guard test
 * cheap enough to run on every `npm test`.
 */

export interface ManifestParam {
  name: string
  type: string
  optional: boolean
}

export interface ManifestAction {
  /** `<module>.<export>`, for example `invoices.voidInvoice`. */
  name: string
  /** Path under src/app/actions without the extension, for example `oj-projects/client-balance`. */
  module: string
  export: string
  params: ManifestParam[]
  /** Declarations of the named types and Zod schemas the parameters refer to. */
  typeRefs: Record<string, string>
  doc: string
  readOnly: boolean
}

export interface ManifestRoute {
  /** For example `/api/invoices/[id]/pdf`. */
  path: string
  /** Path under src/app without the extension, for example `api/invoices/[id]/pdf/route`. */
  module: string
  methods: string[]
  /** `session` when the route checks the signed-in person; `other` for token-gated and open routes. */
  auth: 'session' | 'other'
}

export interface ManifestTable {
  name: string
  kind: 'table' | 'view'
  columns: Array<{ name: string; type: string }>
}

export interface McpManifest {
  actions: ManifestAction[]
  routes: ManifestRoute[]
  tables: ManifestTable[]
}

const MAX_DOC_CHARS = 1200
const MAX_TYPE_REF_CHARS = 3000
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

/** Machine endpoints with their own secrets, and the bridge itself. */
const EXCLUDED_ROUTE_PREFIXES = ['api/cron/', 'api/webhooks/', 'api/stripe/', 'api/jobs/', 'api/mcp/']

const BUILT_IN_TYPES = new Set([
  'Array', 'Date', 'FormData', 'File', 'Blob', 'Map', 'Set', 'Partial', 'Pick', 'Omit', 'Promise',
  'Readonly', 'ReadonlyArray', 'Record', 'Required', 'NonNullable', 'Exclude', 'Extract',
  'ReturnType', 'Awaited', 'Parameters', 'z', 'Json', 'URLSearchParams',
])

// ---------------------------------------------------------------------------------------------
// Files

function walk(dir: string, accept: (path: string) => boolean): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir).sort()) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue
      found.push(...walk(path, accept))
    } else if (accept(path)) {
      found.push(path)
    }
  }
  return found
}

function toPosix(path: string): string {
  return path.split(sep).join('/')
}

function parse(path: string): ts.SourceFile {
  return ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
}

function hasUseServerDirective(source: ts.SourceFile): boolean {
  for (const statement of source.statements) {
    if (ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression)) {
      if (statement.expression.text === 'use server') return true
      continue
    }
    return false
  }
  return false
}

function isExported(node: ts.Node): boolean {
  return (ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Export) !== 0
}

function cleanComment(raw: string): string {
  return raw
    .replace(/^\/\*\*?/, '')
    .replace(/\*\/$/, '')
    .split('\n')
    .map((line) => line.replace(/^\s*(\*|\/\/)\s?/, '').trimEnd())
    .join('\n')
    .trim()
}

function leadingDoc(node: ts.Node, source: ts.SourceFile): string {
  const ranges = ts.getLeadingCommentRanges(source.text, node.getFullStart()) ?? []
  const text = ranges.map((range) => cleanComment(source.text.slice(range.pos, range.end))).join('\n').trim()
  return text.length > MAX_DOC_CHARS ? `${text.slice(0, MAX_DOC_CHARS)}...` : text
}

// ---------------------------------------------------------------------------------------------
// Read-only classing

const READ_NAME = /^(get|list|fetch|search|find|count|lookup|preview|describe)([A-Z0-9_]|$)/
const NOT_READ_NAME = /(OrCreate|Ensure|Sync|Send)/
const WRITE_METHODS = new Set(['insert', 'update', 'upsert', 'delete', 'rpc', 'remove', 'upload', 'move'])
const SIDE_EFFECT_CALL = /^(send|notify|queue|enqueue|capture|refund|create|revalidate|log(Audit|Receipt))/
const HARMLESS_CREATE = new Set(['createClient', 'createAdminClient', 'createHash', 'createHmac'])

function callName(call: ts.CallExpression): string | null {
  const callee = call.expression
  if (ts.isIdentifier(callee)) return callee.text
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text
  return null
}

function bodyWrites(body: ts.Node | undefined): boolean {
  if (!body) return true
  let writes = false
  const visit = (node: ts.Node): void => {
    if (writes) return
    if (ts.isCallExpression(node)) {
      const name = callName(node)
      if (name) {
        const isMethod = ts.isPropertyAccessExpression(node.expression)
        if (isMethod && WRITE_METHODS.has(name)) writes = true
        else if (SIDE_EFFECT_CALL.test(name) && !HARMLESS_CREATE.has(name)) writes = true
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(body)
  return writes
}

function classifyReadOnly(exportName: string, body: ts.Node | undefined, overrides: Record<string, 'read' | 'write'>, name: string): boolean {
  const override = overrides[name]
  if (override) return override === 'read'
  if (!READ_NAME.test(exportName) || NOT_READ_NAME.test(exportName)) return false
  return !bodyWrites(body)
}

// ---------------------------------------------------------------------------------------------
// Parameter types and the declarations they name

function referencedNames(typeNode: ts.TypeNode | undefined): string[] {
  if (!typeNode) return []
  const names = new Set<string>()
  const visit = (node: ts.Node): void => {
    if (ts.isTypeReferenceNode(node)) {
      const text = ts.isIdentifier(node.typeName) ? node.typeName.text : node.typeName.right.text
      const head = ts.isIdentifier(node.typeName) ? text : node.typeName.left.getText()
      if (!BUILT_IN_TYPES.has(head)) names.add(ts.isIdentifier(node.typeName) ? text : node.typeName.getText())
    }
    if (ts.isTypeQueryNode(node)) {
      names.add(node.exprName.getText())
    }
    ts.forEachChild(node, visit)
  }
  visit(typeNode)
  return [...names].filter((name) => !name.includes('.'))
}

function findDeclaration(source: ts.SourceFile, name: string): ts.Node | null {
  for (const statement of source.statements) {
    if ((ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name.text === name) {
      return statement
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text === name) return statement
      }
    }
  }
  return null
}

function resolveModuleFile(fromFile: string, specifier: string, srcRoot: string): string | null {
  let base: string
  if (specifier.startsWith('@/')) base = join(srcRoot, specifier.slice(2))
  else if (specifier.startsWith('.')) base = resolve(dirname(fromFile), specifier)
  else return null
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), base]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return null
}

function importedFrom(source: ts.SourceFile, name: string): { specifier: string; original: string } | null {
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
    const bindings = statement.importClause?.namedBindings
    if (!bindings || !ts.isNamedImports(bindings)) continue
    for (const element of bindings.elements) {
      if (element.name.text === name) {
        return { specifier: statement.moduleSpecifier.text, original: element.propertyName?.text ?? name }
      }
    }
  }
  return null
}

function declarationText(node: ts.Node): string {
  const text = node.getText().replace(/^export\s+/, '')
  return text.length > MAX_TYPE_REF_CHARS ? `${text.slice(0, MAX_TYPE_REF_CHARS)}...` : text
}

function collectTypeRefs(
  source: ts.SourceFile,
  names: string[],
  srcRoot: string,
  cache: Map<string, ts.SourceFile>,
  depth = 0,
  out: Record<string, string> = {},
): Record<string, string> {
  for (const name of names) {
    if (out[name] || depth > 2) continue
    let declSource = source
    let declaration = findDeclaration(source, name)
    if (!declaration) {
      const imported = importedFrom(source, name)
      const file = imported ? resolveModuleFile(source.fileName, imported.specifier, srcRoot) : null
      if (imported && file) {
        const target = cache.get(file) ?? parse(file)
        cache.set(file, target)
        declSource = target
        declaration = findDeclaration(target, imported.original)
      }
    }
    if (!declaration) continue
    out[name] = declarationText(declaration)

    // One more level: a type that is `z.infer<typeof Schema>`, or that names other local types.
    const nested: string[] = []
    const visit = (node: ts.Node): void => {
      if (ts.isTypeNode(node)) nested.push(...referencedNames(node))
      if (ts.isTypeQueryNode(node)) nested.push(node.exprName.getText())
      ts.forEachChild(node, visit)
    }
    if (!ts.isVariableStatement(declaration)) visit(declaration)
    collectTypeRefs(declSource, [...new Set(nested)].filter((n) => n !== name), srcRoot, cache, depth + 1, out)
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// Actions

function buildActions(root: string, overrides: Record<string, 'read' | 'write'>): ManifestAction[] {
  const srcRoot = join(root, 'src')
  const actionsRoot = join(srcRoot, 'app', 'actions')
  const cache = new Map<string, ts.SourceFile>()
  const actions: ManifestAction[] = []

  const files = walk(actionsRoot, (path) => /\.ts$/.test(path) && !/\.(test|spec)\.ts$/.test(path))
  for (const file of files) {
    const source = parse(file)
    cache.set(file, source)
    if (!hasUseServerDirective(source)) continue
    const moduleKey = toPosix(relative(actionsRoot, file)).replace(/\.ts$/, '')

    for (const statement of source.statements) {
      let exportName: string | null = null
      let parameters: ts.NodeArray<ts.ParameterDeclaration> | null = null
      let body: ts.Node | undefined

      if (ts.isFunctionDeclaration(statement) && statement.name && isExported(statement)) {
        exportName = statement.name.text
        parameters = statement.parameters
        body = statement.body
      } else if (ts.isVariableStatement(statement) && isExported(statement)) {
        const declaration = statement.declarationList.declarations[0]
        const init = declaration?.initializer
        if (declaration && ts.isIdentifier(declaration.name) && init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
          exportName = declaration.name.text
          parameters = init.parameters
          body = init.body
        }
      }
      if (!exportName || !parameters) continue

      const name = `${moduleKey}.${exportName}`
      const params: ManifestParam[] = parameters.map((parameter) => ({
        name: parameter.name.getText(),
        type: parameter.type ? parameter.type.getText() : 'unknown',
        optional: Boolean(parameter.questionToken || parameter.initializer),
      }))
      const refNames = [...new Set(parameters.flatMap((parameter) => referencedNames(parameter.type)))]

      actions.push({
        name,
        module: moduleKey,
        export: exportName,
        params,
        typeRefs: collectTypeRefs(source, refNames, srcRoot, cache),
        doc: leadingDoc(statement, source),
        readOnly: classifyReadOnly(exportName, body, overrides, name),
      })
    }
  }

  return actions.sort((a, b) => a.name.localeCompare(b.name))
}

// ---------------------------------------------------------------------------------------------
// Routes

function exportedMethods(source: ts.SourceFile): string[] {
  const methods = new Set<string>()
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && isExported(statement) && HTTP_METHODS.includes(statement.name.text)) {
      methods.add(statement.name.text)
    }
    if (ts.isVariableStatement(statement) && isExported(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && HTTP_METHODS.includes(declaration.name.text)) methods.add(declaration.name.text)
      }
    }
    if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) {
        if (HTTP_METHODS.includes(element.name.text)) methods.add(element.name.text)
      }
    }
  }
  return HTTP_METHODS.filter((method) => methods.has(method))
}

function buildRoutes(root: string): ManifestRoute[] {
  const appRoot = join(root, 'src', 'app')
  const routes: ManifestRoute[] = []
  for (const file of walk(join(appRoot, 'api'), (path) => /[\\/]route\.ts$/.test(path))) {
    const moduleKey = toPosix(relative(appRoot, file)).replace(/\.ts$/, '')
    if (EXCLUDED_ROUTE_PREFIXES.some((prefix) => `${moduleKey}/`.startsWith(prefix))) continue
    const text = readFileSync(file, 'utf8')
    const checksPerson = /auth\.getUser\(|checkUserPermission\(|requireUser|getCurrentUser\(/.test(text)
    // Routes that only take an API key (the website's) would refuse the owner's session.
    if (/withApiAuth\(/.test(text) && !checksPerson) continue
    const methods = exportedMethods(parse(file))
    if (methods.length === 0) continue
    routes.push({
      path: `/${moduleKey.replace(/\/route$/, '')}`,
      module: moduleKey,
      methods,
      auth: checksPerson ? 'session' : 'other',
    })
  }
  return routes.sort((a, b) => a.path.localeCompare(b.path))
}

// ---------------------------------------------------------------------------------------------
// Tables

function typeLiteralMember(node: ts.TypeNode | undefined, name: string): ts.TypeNode | undefined {
  if (!node || !ts.isTypeLiteralNode(node)) return undefined
  for (const member of node.members) {
    if (ts.isPropertySignature(member) && member.name.getText() === name) return member.type
  }
  return undefined
}

function buildTables(root: string): ManifestTable[] {
  const source = parse(join(root, 'src', 'types', 'database.generated.ts'))
  const database = source.statements.find(
    (statement): statement is ts.TypeAliasDeclaration => ts.isTypeAliasDeclaration(statement) && statement.name.text === 'Database',
  )
  const publicSchema = typeLiteralMember(database?.type, 'public')
  const tables: ManifestTable[] = []
  for (const [group, kind] of [['Tables', 'table'], ['Views', 'view']] as const) {
    const groupNode = typeLiteralMember(publicSchema, group)
    if (!groupNode || !ts.isTypeLiteralNode(groupNode)) continue
    for (const member of groupNode.members) {
      if (!ts.isPropertySignature(member)) continue
      const row = typeLiteralMember(member.type, 'Row')
      if (!row || !ts.isTypeLiteralNode(row)) continue
      tables.push({
        name: member.name.getText(),
        kind,
        columns: row.members
          .filter(ts.isPropertySignature)
          .map((column) => ({ name: column.name.getText(), type: column.type?.getText() ?? 'unknown' })),
      })
    }
  }
  return tables.sort((a, b) => a.name.localeCompare(b.name))
}

// ---------------------------------------------------------------------------------------------

export function buildMcpManifest(root: string, overrides: Record<string, 'read' | 'write'> = {}): McpManifest {
  return {
    actions: buildActions(root, overrides),
    routes: buildRoutes(root),
    tables: buildTables(root),
  }
}

export const GENERATED_DIR = 'src/lib/mcp/generated'

const GENERATED_NOTICE = 'Generated by `npm run mcp:manifest` from the code. Do not edit by hand.'

/** The committed files, keyed by path relative to the repository root. */
export function renderManifestFiles(manifest: McpManifest): Record<string, string> {
  const json = (value: unknown): string => `${JSON.stringify(value, null, 1)}\n`
  const actionModules = [...new Set(manifest.actions.map((action) => action.module))].sort()
  const loaders = [
    `// ${GENERATED_NOTICE}`,
    '// Lazy imports, so a call loads only the module it needs.',
    '',
    'export const ACTION_MODULES: Record<string, () => Promise<unknown>> = {',
    ...actionModules.map((key) => `  '${key}': () => import('@/app/actions/${key}'),`),
    '}',
    '',
    'export const ROUTE_MODULES: Record<string, () => Promise<unknown>> = {',
    ...manifest.routes.map((route) => `  '${route.module}': () => import('@/app/${route.module}'),`),
    '}',
    '',
  ].join('\n')

  return {
    [`${GENERATED_DIR}/actions.json`]: json(manifest.actions),
    [`${GENERATED_DIR}/routes.json`]: json(manifest.routes),
    [`${GENERATED_DIR}/tables.json`]: json(manifest.tables),
    [`${GENERATED_DIR}/loaders.ts`]: loaders,
  }
}
