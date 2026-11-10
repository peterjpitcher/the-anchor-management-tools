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
const WRITE_METHODS = new Set(['insert', 'update', 'upsert', 'delete', 'remove', 'upload', 'move'])
/**
 * Calls whose names say they change something. These judge only calls that cannot be looked
 * inside (into a package, or on an object whose type a parse cannot know, such as a Twilio
 * `messages.create`). A call into the app's own code is judged by its body instead, because a
 * name such as `refundedByBooking`, `ensureSorted` or `createClient` says little on its own.
 */
const PACKAGE_WRITE_CALL = /^(send|notify|queue|enqueue|capture|refund|revalidate|log(Audit|Receipt)|create|sync|ensure|reconcile)|OrCreate/
const HARMLESS_PACKAGE_CALL = /^create(\w*Client|Hash|Hmac|Element|Context|SignedUrls?)$/
/** Methods that are writes on a Supabase query, but also exist on hashes, Maps and Sets. */
const AMBIGUOUS_WRITE_METHODS = new Set(['update', 'delete'])
const COLLECTION_OR_HASH = /^(new (Map|Set|WeakMap|WeakSet|URLSearchParams|Headers|FormData)\b|(crypto\.)?create(Hash|Hmac)\()/
/**
 * Postgres functions called through `.rpc()` that only read. Each was checked against
 * production's definitions on 10 November 2026: STABLE, or VOLATILE with no INSERT, UPDATE,
 * DELETE, TRUNCATE or MERGE and no call to a function that has one. Any other `.rpc()` counts
 * as a write, so a new read-only function is classed as a write until it is checked and added.
 * `get_receipt_vendor_transactions` is left out on purpose: it calls `resolve_receipt_vendor`,
 * which writes.
 */
const READ_ONLY_RPCS = new Set([
  'count_receipt_statuses', 'count_receipts_completed_without_receipt', 'events_closed_by_whole_pub_hire',
  'find_table_allocation_candidates', 'get_all_links_analytics', 'get_all_links_analytics_v2',
  'get_amex_card_members', 'get_audit_log_users', 'get_booking_periods', 'get_bulk_sms_recipients',
  'get_cross_promo_audience', 'get_email_capture_audience', 'get_employee_changes_summary',
  'get_event_booking_manage_preview_v05', 'get_event_capacity_snapshot_v05', 'get_invoice_summary_stats',
  'get_lifecycle_campaign_stats', 'get_menu_outstanding_count', 'get_openai_usage_total',
  'get_private_booking_conflicts', 'get_private_booking_diner_clashes', 'get_receipt_ai_usage',
  'get_receipt_detail_groups', 'get_receipt_monthly_category_breakdown', 'get_receipt_monthly_income_breakdown',
  'get_receipt_monthly_status_counts', 'get_receipt_monthly_summary', 'get_receipt_vendor_directory',
  'get_receipt_vendor_monthly_totals', 'get_receipt_vendor_trends', 'get_setting_bool', 'get_setting_int',
  'get_short_link_analytics', 'get_table_booking_settings', 'get_table_return_visit_audience',
  'get_user_permissions', 'get_user_roles', 'get_users_for_admin', 'is_super_admin', 'kitchen_food_loads',
  'mileage_trips_page_v01', 'preview_customer_marketing_audience', 'user_has_permission',
])

function callName(call: ts.CallExpression): string | null {
  const callee = call.expression
  if (ts.isIdentifier(callee)) return callee.text
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text
  return null
}

/** The `.rpc('name')` literal, or null when the call is not an rpc with a literal name. */
function rpcName(call: ts.CallExpression): string | null {
  if (!ts.isPropertyAccessExpression(call.expression) || call.expression.name.text !== 'rpc') return null
  const first = call.arguments[0]
  return first && ts.isStringLiteralLike(first) ? first.text : null
}

function isReadRpc(name: string | null): boolean {
  return name !== null && READ_ONLY_RPCS.has(name)
}

/** A `fetch` that is not a plain GET: a literal non-GET method, or a method we cannot read. */
function fetchWrites(call: ts.CallExpression): boolean {
  const options = call.arguments[1]
  if (!options) return false
  if (!ts.isObjectLiteralExpression(options)) return true
  for (const property of options.properties) {
    if (ts.isShorthandPropertyAssignment(property) && property.name.text === 'method') return true
    if (!ts.isPropertyAssignment(property) || property.name.getText() !== 'method') continue
    const value = property.initializer
    if (!ts.isStringLiteralLike(value)) return true
    return !['GET', 'HEAD'].includes(value.text.toUpperCase())
  }
  return false
}

/**
 * Whether a `.update()` or `.delete()` is on a hash, a Map or a Set rather than a Supabase query:
 * the chain it hangs off starts with `createHash(...)`, `new Map(...)` and the like, directly or
 * through a variable declared that way in the same file. A chain through `.from(...)` is a query.
 */
function onCollectionOrHash(call: ts.CallExpression, source: ts.SourceFile): boolean {
  if (!ts.isPropertyAccessExpression(call.expression)) return false
  let node: ts.Expression = call.expression.expression
  for (;;) {
    if (ts.isCallExpression(node)) {
      const name = callName(node)
      if (name === 'from') return false
      if (name && /^create(Hash|Hmac)$/.test(name)) return true
      node = node.expression
    } else if (ts.isPropertyAccessExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ThisKeyword) return declaredAsCollection(source, node.name.text)
      node = node.expression
    } else if (ts.isNewExpression(node)) {
      return COLLECTION_OR_HASH.test(node.getText(source))
    } else if (ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node) || ts.isAsExpression(node)) {
      node = node.expression
    } else if (ts.isIdentifier(node)) {
      return declaredAsCollection(source, node.text)
    } else {
      return false
    }
  }
}

function declaredAsCollection(source: ts.SourceFile, name: string): boolean {
  let found = false
  const visit = (node: ts.Node): void => {
    if (found) return
    if ((ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)) && node.name.getText(source) === name) {
      const init = node.initializer?.getText(source) ?? ''
      const type = node.type?.getText(source) ?? ''
      if (COLLECTION_OR_HASH.test(init) || /^(Map|Set|WeakMap|WeakSet)</.test(type)) found = true
    }
    if (ts.isParameter(node) && node.name.getText(source) === name && /^(Map|Set|WeakMap|WeakSet)</.test(node.type?.getText(source) ?? '')) {
      found = true
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

/**
 * Why one call changes something by itself, without looking inside what it calls, or null.
 * `resolved` says whether the call leads into the app's own code (and so will be looked inside).
 */
function directWrite(call: ts.CallExpression, source: ts.SourceFile, resolved: boolean): string | null {
  const name = callName(call)
  if (!name) return null
  const isMethod = ts.isPropertyAccessExpression(call.expression)
  if (isMethod && name === 'rpc') return isReadRpc(rpcName(call)) ? null : `rpc(${rpcName(call) ?? '?'})`
  if (isMethod && WRITE_METHODS.has(name)) {
    return AMBIGUOUS_WRITE_METHODS.has(name) && onCollectionOrHash(call, source) ? null : `.${name}()`
  }
  if (name === 'fetch' && fetchWrites(call)) return 'fetch() that is not a GET'
  if (!resolved && PACKAGE_WRITE_CALL.test(name) && !HARMLESS_PACKAGE_CALL.test(name)) return `${name}()`
  return null
}

interface Callable {
  key: string
  source: ts.SourceFile
  body: ts.Node
  cls?: ts.ClassDeclaration
}

function functionBody(node: ts.Node | undefined): ts.Node | undefined {
  if (!node) return undefined
  if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) return node.body
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return node.body
  return undefined
}

/**
 * Decides whether a function writes, following the calls it makes into the app's own code
 * (`@/` and relative imports, local functions, class methods, `this.` calls and object
 * literals), so a `get` action that hands off to a service which syncs or saves is seen for
 * what it is. Calls into packages are judged by name only. Parse only, like the rest of the
 * manifest.
 */
class WriteAnalyser {
  private readonly memo = new Map<string, string | null>()
  private readonly active = new Set<string>()
  private cycleHits = 0

  constructor(
    private readonly srcRoot: string,
    private readonly cache: Map<string, ts.SourceFile>,
  ) {}

  private load(file: string): ts.SourceFile {
    const cached = this.cache.get(file)
    if (cached) return cached
    const source = parse(file)
    this.cache.set(file, source)
    return source
  }

  /**
   * Why `body`, in `source` (and inside `cls` when it is a method), writes, or null when it only
   * reads. The reason names the call, and the chain of app functions that led to it.
   */
  whyWrites(body: ts.Node | undefined, source: ts.SourceFile, cls?: ts.ClassDeclaration): string | null {
    if (!body) return 'no body to read'
    let reason: string | null = null
    const visit = (node: ts.Node): void => {
      if (reason) return
      if (ts.isCallExpression(node)) {
        const target = this.resolveCall(node, source, cls)
        const direct = directWrite(node, source, target !== null)
        if (direct) {
          reason = `${direct} at ${this.where(source, node)}`
          return
        }
        const viaTarget = target ? this.callableWhy(target) : null
        if (target && viaTarget) {
          reason = `${this.label(target)} > ${viaTarget}`
          return
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(body)
    return reason
  }

  private where(source: ts.SourceFile, node: ts.Node): string {
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
    return `${toPosix(relative(dirname(this.srcRoot), source.fileName))}:${line}`
  }

  private label(target: Callable): string {
    return target.key.slice(target.key.indexOf('#') + 1)
  }

  private callableWhy(target: Callable): string | null {
    const known = this.memo.get(target.key)
    if (known !== undefined) return known
    if (this.active.has(target.key)) {
      this.cycleHits += 1
      return null
    }
    const hitsBefore = this.cycleHits
    this.active.add(target.key)
    const result = this.whyWrites(target.body, target.source, target.cls)
    this.active.delete(target.key)
    // A "no" reached while part of a call cycle was still open may be incomplete: keep only
    // answers that do not depend on it.
    if (result || this.cycleHits === hitsBefore) this.memo.set(target.key, result)
    return result
  }

  private resolveCall(call: ts.CallExpression, source: ts.SourceFile, cls?: ts.ClassDeclaration): Callable | null {
    const callee = call.expression
    if (ts.isIdentifier(callee)) return this.resolveName(source, callee.text)
    if (!ts.isPropertyAccessExpression(callee)) return null
    const member = callee.name.text
    if (callee.expression.kind === ts.SyntaxKind.ThisKeyword) {
      return cls ? this.classMember(source, cls, member) : null
    }
    if (ts.isIdentifier(callee.expression)) return this.resolveMember(source, callee.expression.text, member, cls)
    return null
  }

  /** A function called by its bare name: declared in this file, or imported. */
  private resolveName(source: ts.SourceFile, name: string, hops = 0): Callable | null {
    const local = this.localFunction(source, name)
    if (local) return local
    const imported = this.importOf(source, name)
    if (!imported || imported.kind === 'namespace') return null
    const file = resolveModuleFile(source.fileName, imported.specifier, this.srcRoot)
    return file ? this.exportedFunction(this.load(file), imported.original, hops) : null
  }

  /** A function declared in this file by that name: at the top level first, then nested. */
  private localFunction(source: ts.SourceFile, name: string): Callable | null {
    return this.topLevelFunction(source, name) ?? this.nestedFunction(source, name)
  }

  private nestedFunction(source: ts.SourceFile, name: string): Callable | null {
    let found: Callable | null = null
    const visit = (node: ts.Node): void => {
      if (found) return
      if (ts.isFunctionDeclaration(node) && node.name?.text === name && node.body) {
        found = { key: `${source.fileName}#${name}@${node.pos}`, source, body: node.body }
        return
      }
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
        const body = functionBody(node.initializer)
        if (body) {
          found = { key: `${source.fileName}#${name}@${node.pos}`, source, body }
          return
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
    return found
  }

  private topLevelFunction(source: ts.SourceFile, name: string): Callable | null {
    for (const statement of source.statements) {
      if (ts.isFunctionDeclaration(statement) && statement.name?.text === name && statement.body) {
        return { key: `${source.fileName}#${name}`, source, body: statement.body }
      }
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name) continue
          const body = functionBody(declaration.initializer)
          if (body) return { key: `${source.fileName}#${name}`, source, body }
        }
      }
    }
    return null
  }

  private exportedFunction(source: ts.SourceFile, name: string, hops: number): Callable | null {
    const local = this.localFunction(source, name)
    if (local) return local
    if (hops > 3) return null
    for (const reexport of this.reexportsOf(source, name)) {
      const file = resolveModuleFile(source.fileName, reexport.specifier, this.srcRoot)
      const found = file ? this.exportedFunction(this.load(file), reexport.original, hops + 1) : null
      if (found) return found
    }
    return null
  }

  /** `Thing.member(...)`: a class, an object literal, a service instance or a namespace import. */
  private resolveMember(source: ts.SourceFile, objectName: string, member: string, cls?: ts.ClassDeclaration, hops = 0): Callable | null {
    if (cls?.name?.text === objectName) return this.classMember(source, cls, member)
    const local = this.memberOfLocal(source, objectName, member)
    if (local) return local
    const imported = this.importOf(source, objectName)
    if (!imported || hops > 3) return null
    const file = resolveModuleFile(source.fileName, imported.specifier, this.srcRoot)
    if (!file) return null
    const target = this.load(file)
    if (imported.kind === 'namespace') return this.exportedFunction(target, member, 0)
    const original = imported.kind === 'default' ? this.defaultExportName(target) : imported.original
    if (!original) return null
    const found = this.memberOfLocal(target, original, member)
    if (found) return found
    for (const reexport of this.reexportsOf(target, original)) {
      const next = resolveModuleFile(target.fileName, reexport.specifier, this.srcRoot)
      if (!next) continue
      const nextSource = this.load(next)
      const viaReexport = this.memberOfLocal(nextSource, reexport.original, member)
      if (viaReexport) return viaReexport
    }
    return null
  }

  private memberOfLocal(source: ts.SourceFile, objectName: string, member: string): Callable | null {
    for (const statement of source.statements) {
      if (ts.isClassDeclaration(statement) && statement.name?.text === objectName) {
        return this.classMember(source, statement, member)
      }
      if (!ts.isVariableStatement(statement)) continue
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || declaration.name.text !== objectName) continue
        let init = declaration.initializer
        while (init && (ts.isAsExpression(init) || ts.isSatisfiesExpression(init) || ts.isParenthesizedExpression(init))) {
          init = init.expression
        }
        if (!init) return null
        if (ts.isNewExpression(init) && ts.isIdentifier(init.expression)) {
          const className = init.expression.text
          const classDeclaration = source.statements.find(
            (candidate): candidate is ts.ClassDeclaration => ts.isClassDeclaration(candidate) && candidate.name?.text === className,
          )
          if (classDeclaration) return this.classMember(source, classDeclaration, member)
          return this.resolveMember(source, className, member)
        }
        if (ts.isObjectLiteralExpression(init)) return this.objectMember(source, objectName, init, member)
        return null
      }
    }
    return null
  }

  private classMember(source: ts.SourceFile, cls: ts.ClassDeclaration, member: string): Callable | null {
    const className = cls.name?.text ?? 'default'
    for (const element of cls.members) {
      if (!element.name || element.name.getText() !== member) continue
      const body = ts.isMethodDeclaration(element)
        ? element.body
        : ts.isPropertyDeclaration(element)
          ? functionBody(element.initializer)
          : undefined
      if (body) return { key: `${source.fileName}#${className}.${member}`, source, body, cls }
    }
    return null
  }

  private objectMember(source: ts.SourceFile, objectName: string, literal: ts.ObjectLiteralExpression, member: string): Callable | null {
    for (const property of literal.properties) {
      if (!property.name || property.name.getText() !== member) continue
      const key = `${source.fileName}#${objectName}.${member}`
      if (ts.isMethodDeclaration(property) && property.body) return { key, source, body: property.body }
      if (ts.isPropertyAssignment(property)) {
        const body = functionBody(property.initializer)
        if (body) return { key, source, body }
        if (ts.isIdentifier(property.initializer)) return this.resolveName(source, property.initializer.text)
      }
      if (ts.isShorthandPropertyAssignment(property)) return this.resolveName(source, member)
    }
    return null
  }

  private importOf(
    source: ts.SourceFile,
    name: string,
  ): { specifier: string; original: string; kind: 'named' | 'default' | 'namespace' } | null {
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
      const clause = statement.importClause
      if (!clause || clause.isTypeOnly) continue
      const specifier = statement.moduleSpecifier.text
      if (clause.name?.text === name) return { specifier, original: 'default', kind: 'default' }
      const bindings = clause.namedBindings
      if (bindings && ts.isNamespaceImport(bindings) && bindings.name.text === name) {
        return { specifier, original: name, kind: 'namespace' }
      }
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          if (element.name.text === name) return { specifier, original: element.propertyName?.text ?? name, kind: 'named' }
        }
      }
    }
    return null
  }

  private reexportsOf(source: ts.SourceFile, name: string): Array<{ specifier: string; original: string }> {
    const found: Array<{ specifier: string; original: string }> = []
    for (const statement of source.statements) {
      if (!ts.isExportDeclaration(statement) || !statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue
      const specifier = statement.moduleSpecifier.text
      if (!statement.exportClause) {
        found.push({ specifier, original: name })
        continue
      }
      if (ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          if (element.name.text === name) found.push({ specifier, original: element.propertyName?.text ?? name })
        }
      }
    }
    return found
  }

  private defaultExportName(source: ts.SourceFile): string | null {
    for (const statement of source.statements) {
      if (ts.isExportAssignment(statement) && ts.isIdentifier(statement.expression)) return statement.expression.text
      if (ts.isClassDeclaration(statement) && statement.name && isExported(statement)) {
        const flags = ts.getCombinedModifierFlags(statement)
        if (flags & ts.ModifierFlags.Default) return statement.name.text
      }
    }
    return null
  }
}

/** Why an action is not read only, or null when it is. */
function whyNotReadOnly(
  exportName: string,
  body: ts.Node | undefined,
  source: ts.SourceFile,
  analyser: WriteAnalyser,
  overrides: Record<string, 'read' | 'write'>,
  name: string,
): string | null {
  const override = overrides[name]
  if (override) return override === 'read' ? null : 'override in src/lib/mcp/action-overrides.ts'
  if (!READ_NAME.test(exportName)) return 'name does not start with a read word'
  if (NOT_READ_NAME.test(exportName)) return 'name says it creates, ensures, syncs or sends'
  return analyser.whyWrites(body, source)
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

function buildActions(
  root: string,
  overrides: Record<string, 'read' | 'write'>,
  reasons?: Map<string, string>,
): ManifestAction[] {
  const srcRoot = join(root, 'src')
  const actionsRoot = join(srcRoot, 'app', 'actions')
  const cache = new Map<string, ts.SourceFile>()
  const analyser = new WriteAnalyser(srcRoot, cache)
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
      const notReadOnly = whyNotReadOnly(exportName, body, source, analyser, overrides, name)
      if (notReadOnly) reasons?.set(name, notReadOnly)
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
        readOnly: notReadOnly === null,
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

/**
 * Why each action that is not read only is classed that way, for `npm run mcp:manifest -- --why`.
 */
export function explainActionClassing(root: string, overrides: Record<string, 'read' | 'write'> = {}): Map<string, string> {
  const reasons = new Map<string, string>()
  buildActions(root, overrides, reasons)
  return reasons
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
