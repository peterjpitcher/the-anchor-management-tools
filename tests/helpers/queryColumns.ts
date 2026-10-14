import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import ts from 'typescript'
import { readSelect, type SchemaColumns } from './generatedSchema'

/**
 * Reads the Supabase queries out of a source file: every column a query chain names, and the
 * table or view it names it against. A chain is anything that starts at `.from('<table>')`.
 *
 * The file is read with the TypeScript parser, as in tests/guards/page-contract.test.ts, so a
 * column name in a comment never counts and a chain that spans many lines is read whole. Nothing
 * is type checked. A table is whatever string the chain starts from; a query, a select list or a
 * payload kept in a constant is followed back to where it is written, in this file or in the
 * module it is imported from. Where the code can take one of several written values (a
 * condition, a loop over a list, a parameter typed as a union of names) every one is read.
 */

/** A column a query names, the table it is named against and the call that names it. */
export type Reference = { file: string; line: number; table: string; column: string; how: string }
export type UnreadReason =
  | 'table is not written in the chain'
  | 'query is not traced to a .from()'
  | 'select list is built at run time'
  | 'select item is not understood'
  | 'filter text is built at run time'
  | 'filter column is built at run time'
  | 'embedded resource is not in the select'
/** A part of a query this reader could not tie to a table and a column, so nothing checked it. */
export type Unread = { file: string; line: number; why: UnreadReason; what: string }
export type Scan = { references: Reference[]; unread: Unread[] }

/** Filter and modifier methods whose first argument is a column. */
const COLUMN_METHODS = new Set([
  'eq', 'neq', 'is', 'in', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'likeAllOf', 'likeAnyOf', 'ilikeAllOf', 'ilikeAnyOf',
  'not', 'filter', 'order', 'contains', 'containedBy', 'overlaps', 'textSearch',
  'rangeGt', 'rangeGte', 'rangeLt', 'rangeLte', 'rangeAdjacent',
])
const WRITE_METHODS = new Set(['update', 'insert', 'upsert'])
/** The builder methods that name columns: the ones this reader looks inside. */
const NAMING_METHODS = new Set([...COLUMN_METHODS, ...WRITE_METHODS, 'select', 'or', 'match'])
/** Everything a PostgREST builder answers to. A call chain made only of these is a query. */
const BUILDER_METHODS = new Set([
  ...COLUMN_METHODS, ...WRITE_METHODS, 'select', 'delete', 'or', 'match', 'limit', 'range', 'single', 'maybeSingle',
  'returns', 'overrideTypes', 'throwOnError', 'abortSignal', 'csv', 'explain',
])
/** `list.map((item) => ...)` and its kin: the callback's first parameter is each item of the list. */
const LIST_METHODS = new Set(['map', 'flatMap', 'forEach', 'filter', 'find', 'some', 'every'])
/** Stands in for a `${value}` inside a filter string. It can never be part of a column name. */
const RUN_TIME_VALUE = '¤'
const COLUMN_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
/** More written values than this for one expression and it is treated as built at run time. */
const MOST_VALUES = 32

type Chain = { tables: string[]; selects: ts.Expression[] }
type NoChain = 'no table in the chain' | 'not a query' | 'not reached on this pass'
type Declaration =
  | { kind: 'value'; value: ts.Expression }
  | { kind: 'each'; of: ts.Expression; at?: number }
  | { kind: 'typed'; type: ts.TypeNode }
  | { kind: 'parameter'; parameter: ts.ParameterDeclaration; of: ts.SignatureDeclaration }
  | { kind: 'imported'; from: string; name: string }
type AnyFunction = ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression

/** The modules constants and helpers have been imported from, parsed once. */
const modules = new Map<string, ts.SourceFile>()

function parse(file: string, text: string): ts.SourceFile {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
}

/** The module an import names, when it is one of ours (`@/...` or a relative path). */
function importedModule(from: ts.SourceFile, specifier: string): ts.SourceFile | null {
  const base = specifier.startsWith('@/')
    ? join(process.cwd(), 'src', specifier.slice(2))
    : specifier.startsWith('.') ? resolve(dirname(resolve(process.cwd(), from.fileName)), specifier) : null
  if (!base) return null
  const path = [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')].find((candidate) => existsSync(candidate))
  if (!path) return null
  const known = modules.get(path) ?? parse(path, readFileSync(path, 'utf8'))
  modules.set(path, known)
  return known
}

function within(node: ts.Node, ancestor: ts.Node): boolean {
  for (let current: ts.Node | undefined = node; current; current = current.parent) {
    if (current === ancestor) return true
  }
  return false
}

function declares(name: ts.BindingName, text: string): boolean {
  if (ts.isIdentifier(name)) return name.text === text
  return name.elements.some((element) => !ts.isOmittedExpression(element) && declares(element.name, text))
}

/**
 * Where `identifier` gets its value: the nearest earlier declaration it can see, a parameter, or
 * an import. A function the identifier is not inside is skipped, so a `query` in one function is
 * never read as the `query` of another.
 */
function declarationOf(identifier: ts.Identifier): Declaration | null {
  if (!declarations.has(identifier)) declarations.set(identifier, declarationFound(identifier))
  return declarations.get(identifier) ?? null
}

/** Found once per identifier. Weak, so a file's syntax tree is let go when its scan is over. */
const declarations = new WeakMap<ts.Identifier, Declaration | null>()

function declarationFound(identifier: ts.Identifier): Declaration | null {
  for (let scope: ts.Node | undefined = identifier.parent; scope; scope = scope.parent) {
    if (!ts.isFunctionLike(scope) && !ts.isSourceFile(scope)) continue

    const earlier: Declaration[] = []
    const visit = (node: ts.Node): void => {
      if (node !== scope && ts.isFunctionLike(node) && !within(identifier, node)) return
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === identifier.text && node.getStart() < identifier.getStart()) {
        const loop = node.parent.parent
        if (node.initializer) earlier.push({ kind: 'value', value: node.initializer })
        else if (ts.isForOfStatement(loop) && within(identifier, loop)) earlier.push({ kind: 'each', of: loop.expression })
        else if (node.type) earlier.push({ kind: 'typed', type: node.type })
      }
      // for (const [table, ids] of [['a', x], ['b', y]]): `table` is the first of each pair.
      if (ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name) && ts.isForOfStatement(node.parent.parent) && within(identifier, node.parent.parent)) {
        const at = node.name.elements.findIndex((element) => ts.isBindingElement(element) && ts.isIdentifier(element.name) && element.name.text === identifier.text)
        if (at >= 0) earlier.push({ kind: 'each', of: node.parent.parent.expression, at })
      }
      ts.forEachChild(node, visit)
    }
    visit(scope)
    if (earlier.length > 0) return earlier[earlier.length - 1]

    if (ts.isFunctionLike(scope)) {
      const parameter = scope.parameters.find((candidate) => declares(candidate.name, identifier.text))
      const looped = parameter === scope.parameters[0] && ts.isCallExpression(scope.parent) && ts.isPropertyAccessExpression(scope.parent.expression) ? scope.parent.expression : null
      if (parameter && ts.isIdentifier(parameter.name) && looped && LIST_METHODS.has(looped.name.text)) return { kind: 'each', of: looped.expression }
      if (parameter) return ts.isIdentifier(parameter.name) ? { kind: 'parameter', parameter, of: scope } : null
    } else {
      for (const statement of scope.statements) {
        const bindings = ts.isImportDeclaration(statement) ? statement.importClause?.namedBindings : undefined
        const element = bindings && ts.isNamedImports(bindings) ? bindings.elements.find((candidate) => candidate.name.text === identifier.text) : undefined
        if (element && ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
          return { kind: 'imported', from: statement.moduleSpecifier.text, name: (element.propertyName ?? element.name).text }
        }
      }
    }
  }
  return null
}

/** What a module exports under `name`: the value of a constant, or a function. */
function exported(module: ts.SourceFile, name: string): ts.Expression | AnyFunction | null {
  for (const statement of module.statements) {
    if (!ts.canHaveModifiers(statement) || !ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) return statement
    if (ts.isVariableStatement(statement)) {
      const declaration = statement.declarationList.declarations.find((candidate) => ts.isIdentifier(candidate.name) && candidate.name.text === name)
      if (declaration?.initializer) return declaration.initializer
    }
  }
  return null
}

/**
 * A helper that takes its table, its columns or the query itself as arguments (`scrub('messages',
 * { body: null })`) is read once for every call of it in the same file, with each parameter
 * standing for what that one call hands over. A loop over a written list is read once for each
 * item in the same way. Reading the parts separately would pair the table of one call, or of one
 * item, with the columns of another.
 *
 * `entered` holds, for the pass being read, the call each function on the way in was entered by
 * and the item each loop is on. A parameter of any other function is not known; a loop not on
 * the way in stands for every item of its list.
 */
type Pass = Map<ts.Node, ts.Expression>
const NOT_ENTERED: Pass = new Map()
const MOST_PASSES = 64
let entered: Pass = NOT_ENTERED
const callsByFile = new WeakMap<ts.SourceFile, Map<string, ts.CallExpression[]>>()

/**
 * What the code around the query being read has already settled about a table name. Inside
 * `if (table === 'oj_entries') { ... }` the table is that one; in the `else`, any other.
 */
type Narrowing = { text: string; name: string; is: boolean }
let narrowings: Narrowing[] = []

/** What a condition settles when it holds, or when it does not: `a === 'x' && b` holding means a is x. */
function settledBy(condition: ts.Expression, holds: boolean): Narrowing[] {
  const expression = ts.isParenthesizedExpression(condition) ? condition.expression : condition
  if (!ts.isBinaryExpression(expression)) return []
  const operator = expression.operatorToken.kind
  if (operator === (holds ? ts.SyntaxKind.AmpersandAmpersandToken : ts.SyntaxKind.BarBarToken)) {
    return [...settledBy(expression.left, holds), ...settledBy(expression.right, holds)]
  }
  const equals = operator === ts.SyntaxKind.EqualsEqualsEqualsToken
  const differs = operator === ts.SyntaxKind.ExclamationEqualsEqualsToken
  if (!(equals || differs) || !ts.isStringLiteral(expression.right)) return []
  return [{ text: expression.left.getText(), name: expression.right.text, is: equals === holds }]
}

function narrowingsAround(node: ts.Node): Narrowing[] {
  const found: Narrowing[] = []
  for (let child = node, parent = node.parent; parent; child = parent, parent = parent.parent) {
    if (ts.isIfStatement(parent) && child !== parent.expression) found.push(...settledBy(parent.expression, child === parent.thenStatement))
    if (ts.isConditionalExpression(parent) && child !== parent.condition) found.push(...settledBy(parent.condition, child === parent.whenTrue))
  }
  return found
}

function narrowed(written: ts.Expression, names: string[]): string[] {
  const text = written.getText()
  return narrowings.filter((narrowing) => narrowing.text === text).reduce(
    (left, narrowing) => left.filter((name) => (name === narrowing.name) === narrowing.is),
    names
  )
}

/** Every call, in the same file, of a function that has a name: `function f` or `const f = () =>`. */
function callsOf(fn: ts.SignatureDeclaration): ts.CallExpression[] {
  const holder = ts.isVariableDeclaration(fn.parent) ? fn.parent.name : ts.isFunctionDeclaration(fn) ? fn.name : undefined
  if (!holder || !ts.isIdentifier(holder)) return []
  const file = fn.getSourceFile()
  let calls = callsByFile.get(file)
  if (!calls) {
    const found = new Map<string, ts.CallExpression[]>()
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) found.set(node.expression.text, [...(found.get(node.expression.text) ?? []), node])
      ts.forEachChild(node, visit)
    }
    visit(file)
    callsByFile.set(file, (calls = found))
  }
  return calls.get(holder.text) ?? []
}

/** The list a loop goes over, when `node` is the loop: `for (const x of list)` or the callback of `list.map(...)`. */
function listLoopedBy(node: ts.Node): ts.Expression | null {
  if (ts.isForOfStatement(node)) return node.expression
  const call = ts.isFunctionLike(node) ? node.parent : undefined
  const looped = call && ts.isCallExpression(call) && ts.isPropertyAccessExpression(call.expression) && call.arguments[0] === node ? call.expression : null
  return looped && LIST_METHODS.has(looped.name.text) ? looped.expression : null
}

/** Each way `node` can be reached: through the calls of the functions around it and the items of the loops around it. */
function passesTo(node: ts.Node, depth = 0): Pass[] {
  const loops: ts.Expression[] = []
  let fn: ts.Node | undefined = node.parent
  for (; fn && !(ts.isFunctionLike(fn) && callsOf(fn).length > 0); fn = fn.parent) {
    const list = listLoopedBy(fn)
    if (list) loops.unshift(list)
  }

  const called = fn && ts.isFunctionLike(fn) && depth < 3 ? fn : null
  let passes: Pass[] = called
    ? callsOf(called).flatMap((call) => passesTo(call, depth + 1).map((outer) => new Map(outer).set(called, call)))
    : [NOT_ENTERED]
  for (const list of loops) {
    passes = passes.flatMap((pass) => {
      entered = pass
      const items = elementsOf(list)
      return items && items.length > 0 ? items.map((item) => new Map(pass).set(list, item)) : [pass]
    })
    if (passes.length > MOST_PASSES) return [NOT_ENTERED]
  }
  return passes.length > MOST_PASSES ? [NOT_ENTERED] : passes
}

/** Names and loops being followed right now. Code can define a thing in terms of itself; following it twice would never end. */
const namesFollowed = new Set<ts.Node>()
const loopsFollowed = new Set<ts.Node>()
function followed<Found>(following: Set<ts.Node>, node: ts.Node, nothing: Found, follow: () => Found): Found {
  if (following.has(node)) return nothing
  following.add(node)
  try {
    return follow()
  } finally {
    following.delete(node)
  }
}

/** The items a loop variable can be: the one this pass is on, else every item of the list. */
function loopedOver(declaration: { of: ts.Expression; at?: number }): ts.Expression[] {
  const on = entered.get(declaration.of)
  const items = on ? [on] : followed(loopsFollowed, declaration.of, [], () => elementsOf(declaration.of) ?? [])
  const at = declaration.at
  if (at === undefined) return items
  return items.map(unwrapped).flatMap((item) => (ts.isArrayLiteralExpression(item) && item.elements[at] ? [item.elements[at]] : []))
}

/** Reads through one more call: `fn` is entered by `call` for the rest of the query being read. */
function enter(fn: ts.Node, call: ts.CallExpression): boolean {
  if (!entered.has(fn)) entered = new Map<ts.Node, ts.Expression>(entered).set(fn, call)
  return entered.get(fn) === call
}

/**
 * What a callback's parameter is handed. In `countRows('messages', (query) => query.eq(...))`,
 * `query` is whatever `countRows` calls its second parameter with, for this call of `countRows`.
 */
function handedToCallback(parameter: ts.ParameterDeclaration, callback: ts.SignatureDeclaration): ts.Expression[] {
  const call = callback.parent
  if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression)) return []
  const helper = functionOf(call.expression)
  const handler = helper?.parameters[call.arguments.findIndex((argument) => argument === callback)]
  if (!helper?.body || !handler || !ts.isIdentifier(handler.name)) return []

  const name = handler.name.text
  const index = callback.parameters.indexOf(parameter)
  const handed: ts.Expression[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name && node.arguments[index]) handed.push(node.arguments[index])
    ts.forEachChild(node, visit)
  }
  visit(helper.body)
  return handed.length > 0 && enter(helper, call) ? handed : []
}

/** What a parameter is handed by the call being read, or its default when that call leaves it out. */
function argumentFor(parameter: ts.ParameterDeclaration, fn: ts.SignatureDeclaration): ts.Expression[] {
  const call = entered.get(fn)
  if (!call || !ts.isCallExpression(call)) return handedToCallback(parameter, fn)
  const argument = call.arguments[fn.parameters.indexOf(parameter)] ?? parameter.initializer
  return argument && !ts.isSpreadElement(argument) ? [argument] : []
}

/**
 * The expressions an identifier can stand for: the value of a constant written in this file or
 * imported from one of ours, or what a parameter is handed (see `argumentFor`).
 */
function valuesOf(identifier: ts.Identifier): ts.Expression[] {
  return followed(namesFollowed, identifier, [], () => valuesFollowed(identifier))
}

function valuesFollowed(identifier: ts.Identifier): ts.Expression[] {
  const declaration = declarationOf(identifier)
  if (declaration?.kind === 'value') return [declaration.value]
  if (declaration?.kind === 'each') return loopedOver(declaration)
  if (declaration?.kind === 'parameter') return argumentFor(declaration.parameter, declaration.of)
  if (declaration?.kind === 'imported') {
    const module = importedModule(identifier.getSourceFile(), declaration.from)
    const found = module ? exported(module, declaration.name) : null
    return found && !ts.isFunctionDeclaration(found) ? [found] : []
  }
  return []
}

/** The one expression an identifier stands for, when there is exactly one. */
function valueOf(identifier: ts.Identifier): ts.Expression | null {
  const values = valuesOf(identifier)
  return values.length === 1 ? values[0] : null
}

/** The function a call runs, when it is written in this file or imported from one of ours. */
function functionOf(callee: ts.Identifier): AnyFunction | null {
  const source = callee.getSourceFile()
  const local = source.statements.find((statement): statement is ts.FunctionDeclaration => ts.isFunctionDeclaration(statement) && statement.name?.text === callee.text)
  if (local) return local

  const declaration = declarationOf(callee)
  const value = declaration?.kind === 'value' ? unwrapped(declaration.value) : null
  if (value && (ts.isArrowFunction(value) || ts.isFunctionExpression(value))) return value
  if (declaration?.kind === 'imported') {
    const module = importedModule(source, declaration.from)
    const found = module ? exported(module, declaration.name) : null
    if (found && (ts.isFunctionDeclaration(found) || ts.isArrowFunction(found) || ts.isFunctionExpression(found))) return found
  }
  return null
}

/** The expressions a function hands back: an arrow's body, or each `return` of its own. */
function returned(fn: AnyFunction): ts.Expression[] {
  if (!fn.body) return []
  if (!ts.isBlock(fn.body)) return [fn.body]
  const found: ts.Expression[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node)) return
    if (ts.isReturnStatement(node) && node.expression) found.push(node.expression)
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(fn.body, visit)
  return found
}

function unwrapped(node: ts.Expression): ts.Expression {
  let current = node
  while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isSatisfiesExpression(current) || ts.isNonNullExpression(current)) {
    current = current.expression
  }
  return current
}

/** The elements of an array the file spells out, with any written array spread into it. */
function elementsOf(node: ts.Expression | undefined, depth = 0): ts.Expression[] | null {
  if (!node || depth > 4) return null
  const expression = unwrapped(node)
  if (ts.isIdentifier(expression)) return elementsOf(valueOf(expression) ?? undefined, depth + 1)
  if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
    return elementsOf(expression.left, depth + 1) ?? elementsOf(expression.right, depth + 1)
  }
  if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression)) {
    const written = membersOf(recordsOf(expression.expression), expression.name.text)
    return written.length === 1 ? elementsOf(written[0], depth + 1) : null
  }
  if (!ts.isArrayLiteralExpression(expression)) return null
  const elements: ts.Expression[] = []
  for (const element of expression.elements) {
    const spread = ts.isSpreadElement(element) ? elementsOf(element.expression, depth + 1) : [element]
    if (!spread) return null
    elements.push(...spread)
  }
  return elements
}

function everyPairing(left: string[], right: string[]): string[] | null {
  return left.length * right.length > MOST_VALUES ? null : left.flatMap((start) => right.map((end) => start + end))
}

function eitherOf(lists: Array<string[] | null>): string[] | null {
  const all: string[] = []
  for (const list of lists) {
    if (!list) return null
    all.push(...list)
  }
  return all.length > MOST_VALUES ? null : [...new Set(all)]
}

/** The type a name stands for, when it is a `type` written in the same file. */
function aliasedType(type: ts.TypeNode): ts.TypeNode {
  if (!ts.isTypeReferenceNode(type) || !ts.isIdentifier(type.typeName)) return type
  const name = type.typeName.text
  const alias = type.getSourceFile().statements.find((statement): statement is ts.TypeAliasDeclaration => ts.isTypeAliasDeclaration(statement) && statement.name.text === name)
  return alias ? alias.type : type
}

/** The names a type allows, when it is a string literal or a union of them. */
function namesOfType(type: ts.TypeNode | undefined, depth = 0): string[] | null {
  if (!type || depth > 3) return null
  const written = aliasedType(type)
  if (ts.isLiteralTypeNode(written) && ts.isStringLiteral(written.literal)) return [written.literal.text]
  if (ts.isUnionTypeNode(written)) return eitherOf(written.types.map((member) => namesOfType(member, depth + 1)))
  return null
}

/** The type of `holder.key`, when `holder` is declared with an object type written in the same file. */
function typeOfMember(holder: ts.Identifier, key: string): ts.TypeNode | undefined {
  const declaration = declarationOf(holder)
  const declared = declaration?.kind === 'typed' ? declaration.type : declaration?.kind === 'parameter' ? declaration.parameter.type : undefined
  const written = declared ? aliasedType(declared) : undefined
  if (!written || !ts.isTypeLiteralNode(written)) return undefined
  return written.members.find((member): member is ts.PropertySignature => ts.isPropertySignature(member) && ts.isIdentifier(member.name) && member.name.text === key)?.type
}

/** What each of `records` writes under `key`. */
function membersOf(records: ts.ObjectLiteralExpression[], key: string | null): ts.Expression[] {
  return records.flatMap((record) => record.properties.flatMap((property) => {
    if (!ts.isPropertyAssignment(property)) return []
    const name = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) ? property.name.text : null
    return key === null || key === name ? [property.initializer] : []
  }))
}

/** The object literals an identifier can stand for: a written constant, or each item of a written list it loops over. */
function recordsOf(holder: ts.Identifier): ts.ObjectLiteralExpression[] {
  const declaration = declarationOf(holder)
  const candidates = declaration?.kind === 'each' ? loopedOver(declaration) : valuesOf(holder)
  return candidates.map(unwrapped).filter(ts.isObjectLiteralExpression)
}

/**
 * The texts the items of a list can be, when the code spells them out: a written array, a
 * constant holding one, a helper that hands one back, or `rows.map((row) => `text`)`, which gives
 * the same text for every row however many rows there are.
 */
function itemTextsOf(node: ts.Expression | undefined, runTime: string | null, depth: number): string[] | null {
  if (!node || depth > 8) return null
  const expression = unwrapped(node)
  const each = (parts: ts.Expression[], read: (part: ts.Expression) => string[] | null): string[] | null => {
    const texts: string[] = []
    for (const part of parts) {
      const found = read(part)
      if (!found) return null
      texts.push(...found)
    }
    return texts
  }

  if (ts.isArrayLiteralExpression(expression)) {
    return each([...expression.elements], (element) =>
      ts.isSpreadElement(element) ? itemTextsOf(element.expression, runTime, depth + 1) : textsOf(element, runTime, depth + 1))
  }
  if (ts.isIdentifier(expression)) {
    const values = valuesOf(expression)
    return values.length === 0 ? null : each(values, (value) => itemTextsOf(value, runTime, depth + 1))
  }
  if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
    return each([expression.left, expression.right], (side) => itemTextsOf(side, runTime, depth + 1))
  }
  if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression)) {
    // `match.emailColumns`: that key of each thing `match` can be, and no items where it is left out.
    const records = recordsOf(expression.expression)
    return records.length === 0 ? null : each(membersOf(records, expression.name.text), (value) => itemTextsOf(value, runTime, depth + 1))
  }
  if (ts.isNewExpression(expression) && ts.isIdentifier(expression.expression) && expression.expression.text === 'Set') {
    return itemTextsOf(expression.arguments?.[0], runTime, depth + 1)
  }
  if (ts.isCallExpression(expression) && ts.isIdentifier(expression.expression)) {
    const helper = functionOf(expression.expression)
    const outside = entered
    if (!helper || !enter(helper, expression)) return null
    const texts = each(returned(helper), (result) => itemTextsOf(result, runTime, depth + 1))
    entered = outside
    return texts
  }
  if (ts.isCallExpression(expression) && ts.isPropertyAccessExpression(expression.expression)) {
    const method = expression.expression.name.text
    const mapper = expression.arguments[0]
    if (method === 'from' && expression.expression.expression.getText() === 'Array') return itemTextsOf(mapper, runTime, depth + 1)
    if (method === 'filter') return itemTextsOf(expression.expression.expression, runTime, depth + 1)
    if ((method === 'map' || method === 'flatMap') && mapper && (ts.isArrowFunction(mapper) || ts.isFunctionExpression(mapper))) {
      if (elementsOf(expression.expression.expression)?.length === 0) return []
      return each(returned(mapper), (result) =>
        method === 'map' ? textsOf(result, runTime, depth + 1) : itemTextsOf(result, runTime, depth + 1))
    }
  }
  return null
}

/**
 * Every text an expression can stand for, when the code spells them all out: a literal, a
 * template, a constant, either arm of a condition, each item of a list being looped over, pieces
 * joined with `+` or `[...].join()`. Null when any part is only known at run time, unless
 * `runTime` is given, in which case a `${value}` in a template becomes that marker.
 */
function textsOf(node: ts.Expression | undefined, runTime: string | null = null, depth = 0): string[] | null {
  if (!node || depth > 8) return null
  const expression = unwrapped(node)

  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) return [expression.text]
  if (expression.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(expression) && expression.text === 'undefined')) return []
  if (ts.isTemplateExpression(expression)) {
    let texts: string[] | null = [expression.head.text]
    for (const span of expression.templateSpans) {
      const pieces = textsOf(span.expression, null, depth + 1) ?? (runTime === null ? null : [runTime])
      texts = texts && pieces ? everyPairing(texts, pieces.map((piece) => piece + span.literal.text)) : null
    }
    return texts
  }
  if (ts.isConditionalExpression(expression)) {
    return eitherOf([textsOf(expression.whenTrue, runTime, depth + 1), textsOf(expression.whenFalse, runTime, depth + 1)])
  }
  if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = textsOf(expression.left, runTime, depth + 1)
    const right = textsOf(expression.right, runTime, depth + 1)
    return left && right ? everyPairing(left, right) : null
  }
  if (ts.isBinaryExpression(expression) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(expression.operatorToken.kind)) {
    return eitherOf([textsOf(expression.left, runTime, depth + 1), textsOf(expression.right, runTime, depth + 1)])
  }
  if (ts.isIdentifier(expression)) {
    const declaration = declarationOf(expression)
    const named = declaration?.kind === 'typed' ? namesOfType(declaration.type) : declaration?.kind === 'parameter' ? namesOfType(declaration.parameter.type) : null
    if (named) return named
    const candidates = declaration?.kind === 'each' ? loopedOver(declaration) : valuesOf(expression)
    return candidates.length === 0 ? null : eitherOf(candidates.map((candidate) => textsOf(candidate, runTime, depth + 1)))
  }
  if (ts.isElementAccessExpression(expression) || ts.isPropertyAccessExpression(expression)) {
    // `RECORD[key]` can be any value of the record; `holder.key` is that key of each thing `holder` can be.
    const holder = unwrapped(expression.expression)
    if (!ts.isIdentifier(holder)) return null
    const key = ts.isPropertyAccessExpression(expression) ? expression.name.text : null
    const named = key === null ? null : namesOfType(typeOfMember(holder, key))
    if (named) return named
    const records = recordsOf(holder)
    return records.length === 0 ? null : eitherOf(membersOf(records, key).map((value) => textsOf(value, runTime, depth + 1)))
  }
  if (ts.isCallExpression(expression) && ts.isIdentifier(expression.expression)) {
    // A helper that hands back text (`withEmailColumns('id, name', emailFirst)`), read for this call of it.
    const helper = functionOf(expression.expression)
    const outside = entered
    if (!helper || !enter(helper, expression)) return null
    const texts = eitherOf(returned(helper).map((result) => textsOf(result, runTime, depth + 1)))
    entered = outside
    return texts && texts.length > 0 ? texts : null
  }
  if (ts.isCallExpression(expression) && ts.isPropertyAccessExpression(expression.expression)) {
    const method = expression.expression.name.text
    const receiver = expression.expression.expression
    if (method === 'trim') return textsOf(receiver, runTime, depth + 1)?.map((text) => text.trim()) ?? null
    if (method === 'join') {
      // Every text an item can be, joined once: enough to read each column or condition it names.
      const items = itemTextsOf(receiver, runTime, depth + 1)
      const separators = expression.arguments[0] ? textsOf(expression.arguments[0], null, depth + 1) : [',']
      return items && separators?.length === 1 ? [items.join(separators[0])] : null
    }
  }
  return null
}

/**
 * The table a query chain reads or writes, and the select lists on the way to it. A chain kept
 * in a variable (`let query = supabase.from('x')...; query = query.eq(...)`) is followed to its
 * declaration, and one handed back by a small helper (`notesTable(client).select(...)`) to that
 * helper's `return`. Storage buckets and rpc calls are not table queries.
 */
function chainOf(node: ts.Expression, depth = 0): Chain | NoChain {
  const selects: ts.Expression[] = []
  const joined = (chains: Array<Chain | NoChain>): Chain | NoChain => {
    const failed = chains.find((chain): chain is NoChain => typeof chain === 'string')
    if (failed || chains.length === 0) return failed ?? 'not a query'
    const found = chains as Chain[]
    return { tables: [...new Set(found.flatMap((chain) => chain.tables))], selects: [...selects, ...found.flatMap((chain) => chain.selects)] }
  }

  let current: ts.Expression = node
  for (;;) {
    if (ts.isCallExpression(current) && ts.isPropertyAccessExpression(current.expression)) {
      const method = current.expression.name.text
      const receiver = current.expression.expression
      if (method === 'from') {
        if (ts.isPropertyAccessExpression(receiver) && receiver.name.text === 'storage') return 'not a query'
        const written = textsOf(current.arguments[0])
        if (!written || written.length === 0) return 'no table in the chain'
        const tables = narrowed(current.arguments[0], written)
        return tables.length > 0 ? { tables, selects } : 'not reached on this pass'
      }
      if (method === 'rpc') return 'not a query'
      if (method === 'select' && current.arguments[0]) selects.push(current.arguments[0])
      current = receiver
    } else if (ts.isNonNullExpression(current) || ts.isParenthesizedExpression(current) || ts.isAsExpression(current)) {
      current = current.expression
    } else if (depth >= 4) {
      return 'not a query'
    } else if (ts.isConditionalExpression(current)) {
      return joined([chainOf(current.whenTrue, depth + 1), chainOf(current.whenFalse, depth + 1)])
    } else if (ts.isIdentifier(current)) {
      return joined(valuesOf(current).map((value) => chainOf(value, depth + 1)))
    } else if (ts.isCallExpression(current) && ts.isIdentifier(current.expression)) {
      const helper = functionOf(current.expression)
      return helper && enter(helper, current) ? joined(returned(helper).map((result) => chainOf(result, depth + 1))) : 'not a query'
    } else {
      return 'not a query'
    }
  }
}

/**
 * True when a call sits on a query builder this reader cannot name the table of: nothing but
 * builder methods between it and a variable, a parameter or a helper call. `z.string().or(...)`,
 * `calendar.events.insert(...)` and `element.classList.contains(...)` are not queries at all.
 */
function isOnABuilder(receiver: ts.Expression): boolean {
  let current = receiver
  for (;;) {
    if (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isNonNullExpression(current) || ts.isAwaitExpression(current)) {
      current = current.expression
    } else if (ts.isCallExpression(current) && ts.isPropertyAccessExpression(current.expression) && BUILDER_METHODS.has(current.expression.name.text)) {
      current = current.expression.expression
    } else {
      return ts.isIdentifier(current) || (ts.isCallExpression(current) && ts.isIdentifier(current.expression))
    }
  }
}

/** True when an argument could be a string: Zod's `.or(z.literal(''))` takes a schema, PostgREST's takes text. */
function mayBeText(node: ts.Expression): boolean {
  const expression = unwrapped(node)
  if (ts.isCallExpression(expression)) {
    return ts.isIdentifier(expression.expression) || (ts.isPropertyAccessExpression(expression.expression) && expression.expression.name.text === 'join')
  }
  return true
}

/** Splits on the commas that separate conditions, not the ones inside `in.(a,b)`, `{a,b}` or quotes. */
function conditions(filters: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quoted = false
  let current = ''
  for (const char of filters) {
    if (char === '"') quoted = !quoted
    if (!quoted && (char === '(' || char === '{')) depth += 1
    if (!quoted && (char === ')' || char === '}')) depth -= 1
    if (char === ',' && depth === 0 && !quoted) {
      parts.push(current)
      current = ''
    } else {
      current += char
    }
  }
  parts.push(current)
  return parts.map((part) => part.trim()).filter(Boolean)
}

/** The columns a PostgREST logic tree filters on: `a.eq.1,and(b.gt.2,c.is.null)` names a, b and c. */
function columnsOfLogicTree(filters: string): Array<string | null> {
  return conditions(filters).flatMap((condition) => {
    const group = condition.match(/^(?:not\.)?(?:and|or)\s*\(([\s\S]*)\)$/)
    if (group) return columnsOfLogicTree(group[1])
    const column = condition.split('.')[0].split('->')[0].trim()
    return [COLUMN_NAME.test(column) ? column : null]
  })
}

/**
 * The object literals a write is handed, when the code spells them out: the argument itself, an
 * array of them, a constant holding either, `rows.map((row) => ({ ... }))`, or either arm of a
 * condition. A payload built somewhere else is not read.
 */
function objectLiterals(node: ts.Expression | undefined, depth = 0): ts.ObjectLiteralExpression[] {
  if (!node || depth > 4) return []
  const expression = unwrapped(node)

  if (ts.isObjectLiteralExpression(expression)) return [expression]
  if (ts.isArrayLiteralExpression(expression)) {
    return expression.elements.flatMap((element) => objectLiterals(ts.isSpreadElement(element) ? element.expression : element, depth + 1))
  }
  if (ts.isConditionalExpression(expression)) {
    return [...objectLiterals(expression.whenTrue, depth + 1), ...objectLiterals(expression.whenFalse, depth + 1)]
  }
  if (ts.isIdentifier(expression)) return valuesOf(expression).flatMap((value) => objectLiterals(value, depth + 1))
  if (ts.isCallExpression(expression) && ts.isPropertyAccessExpression(expression.expression) && expression.expression.name.text === 'map') {
    const mapper = expression.arguments[0]
    if (mapper && (ts.isArrowFunction(mapper) || ts.isFunctionExpression(mapper))) {
      return returned(mapper).flatMap((result) => objectLiterals(result, depth + 1))
    }
  }
  return []
}

/** The keys of an object literal, with the keys of any written literal spread into it. */
function keysOf(literal: ts.ObjectLiteralExpression, depth = 0): Array<{ name: string; node: ts.Node }> {
  return literal.properties.flatMap((property) => {
    if (ts.isSpreadAssignment(property)) {
      return depth > 2 ? [] : objectLiterals(property.expression).flatMap((spread) => keysOf(spread, depth + 1))
    }
    const name = property.name
    return name && (ts.isIdentifier(name) || ts.isStringLiteral(name)) ? [{ name: name.text, node: property }] : []
  })
}

function option(options: ts.Expression | undefined, names: string[]): ts.Expression | undefined {
  if (!options || !ts.isObjectLiteralExpression(options)) return undefined
  return options.properties.find(
    (property): property is ts.PropertyAssignment => ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && names.includes(property.name.text)
  )?.initializer
}

/** Every column the queries in `text` name, and every query part that could not be read. */
export function scanQueryColumns(file: string, text: string, schema: SchemaColumns): Scan {
  const source = parse(file, text)
  const references = new Map<string, Reference>()
  const unread = new Map<string, Unread>()
  const lineOf = (node: ts.Node): number => source.getLineAndCharacterOfPosition(node.getStart()).line + 1
  const refer = (reference: Reference): void => {
    references.set(`${reference.line} ${reference.how} ${reference.table}.${reference.column}`, reference)
  }

  /** The embedded resources of a chain's selects, each with the tables it can stand for. */
  const embeddedOf = (chain: Chain): Map<string, Set<string>> => {
    const embedded = new Map<string, Set<string>>()
    const lists = chain.selects.flatMap((select) => textsOf(select) ?? [])
    for (const reading of chain.tables.flatMap((table) => lists.map((list) => readSelect(table, list, schema)))) {
      for (const [name, table] of reading.embedded) embedded.set(name, (embedded.get(name) ?? new Set<string>()).add(table))
    }
    return embedded
  }
  /** The tables an embedded resource stands for in this chain: its alias in a select, else its own name. */
  const embeddedTables = (chain: Chain, name: string): string[] => {
    const tables = embeddedOf(chain).get(name)
    return tables ? [...tables] : schema.has(name) ? [name] : []
  }

  /** Reads one call on a query builder, for the pass `entered` is on. */
  const read = (node: ts.CallExpression, callee: ts.PropertyAccessExpression, first: ts.Expression): void => {
    const method = callee.name.text
    const receiver = callee.expression
    const line = lineOf(callee.name)
    const how = `.${method}()`
    const skipped = (why: UnreadReason, what: string): void => {
      unread.set(`${line} ${why} ${what}`, { file, line, why, what })
    }
    /** Hands the chain's tables to `check`, or records that the chain has none this reader can name. */
    const onTable = (what: string, check: (chain: Chain) => void): void => {
      const chain = chainOf(receiver)
      if (typeof chain !== 'string') check(chain)
      else if (chain === 'no table in the chain') skipped('table is not written in the chain', what)
      else if (chain === 'not a query' && isOnABuilder(receiver)) skipped('query is not traced to a .from()', what)
    }
    /** Names `column` against the chain's tables, or against the embedded resource `on` belongs to. */
    const name = (chain: Chain, column: string, on: string | null, at = line): void => {
      const tables = on === null ? chain.tables : embeddedTables(chain, on)
      if (tables.length === 0) skipped('embedded resource is not in the select', `${how} names ${on}.${column}`)
      for (const table of tables) refer({ file, line: at, table, column, how })
    }
    /** `.is('receipt_files', null)` asks for rows with nothing embedded under that name: a resource, not a column. */
    const isEmbedded = (chain: Chain, column: string): boolean =>
      chain.tables.every((table) => !schema.get(table)?.has(column)) && embeddedOf(chain).has(column)
    /** A key written in this file is reported where it is written; one from an imported constant, at the call. */
    const lineOfKey = (key: ts.Node): number => (key.getSourceFile() === source ? lineOf(key) : line)
    const embeddedIn = (options: ts.Expression | undefined): string | null => textsOf(option(options, ['referencedTable', 'foreignTable']))?.[0] ?? null

    const literal = ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first)
    // `rows.filter(isLive)` is an array; `.eq(idColumn, id)` on a chain traced to a table is a filter.
    const constant = (): boolean => (ts.isIdentifier(first) || ts.isPropertyAccessExpression(first)) && typeof chainOf(receiver) !== 'string'

    if (COLUMN_METHODS.has(method) && (literal || constant())) {
      onTable(`${how} names ${literal ? first.text : first.getText()}`, (chain) => {
        const written = textsOf(first)
        // Several tables and several columns are a lookup by one key in two lists: which goes with which is not written here.
        if (!written || (written.length > 1 && chain.tables.length > 1)) return skipped('filter column is built at run time', `${how} names ${first.getText()}`)
        for (const text of written) {
          const path = text.split('->')[0].split('::')[0].trim().split('.')
          const column = path[path.length - 1]
          if (!COLUMN_NAME.test(column) || path.length > 2) continue
          if (path.length === 1 && isEmbedded(chain, column)) continue
          name(chain, column, path.length === 2 ? path[0] : embeddedIn(node.arguments[1]))
        }
      })
    } else if (method === 'or' && mayBeText(first)) {
      onTable(how, (chain) => {
        const filters = textsOf(first, RUN_TIME_VALUE)
        if (!filters) return skipped('filter text is built at run time', how)
        for (const column of new Set(filters.flatMap(columnsOfLogicTree))) {
          if (column === null) skipped('filter text is built at run time', how)
          else name(chain, column, embeddedIn(node.arguments[1]))
        }
      })
    } else if (method === 'match' && ts.isObjectLiteralExpression(first)) {
      onTable(how, (chain) => keysOf(first).forEach((key) => name(chain, key.name, null, lineOfKey(key.node))))
    } else if (method === 'select') {
      onTable(how, (chain) => {
        const lists = textsOf(first)
        if (!lists) return skipped('select list is built at run time', how)
        for (const reading of chain.tables.flatMap((table) => lists.map((list) => readSelect(table, list, schema)))) {
          for (const named of reading.columns) refer({ file, line, ...named, how })
          for (const item of reading.unread) skipped('select item is not understood', item)
        }
      })
    } else if (WRITE_METHODS.has(method)) {
      const rows = objectLiterals(first)
      const conflict = method === 'upsert' ? textsOf(option(node.arguments[1], ['onConflict'])) ?? [] : []
      if (rows.length === 0 && conflict.length === 0) return
      onTable(how, (chain) => {
        for (const key of rows.flatMap((row) => keysOf(row))) name(chain, key.name, null, lineOfKey(key.node))
        for (const column of conflict.flatMap((columns) => columns.split(',')).map((part) => part.trim()).filter(Boolean)) {
          for (const table of chain.tables) refer({ file, line, table, column, how: '.upsert() onConflict' })
        }
      })
    }
  }

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && NAMING_METHODS.has(node.expression.name.text)) {
      // `rows.filter((row) => ...)` and `text.match(/x/)` are everywhere and are never queries: not worth a pass.
      const first: ts.Expression | undefined = node.arguments[0]
      if (first && !ts.isArrowFunction(first) && !ts.isFunctionExpression(first) && !ts.isRegularExpressionLiteral(first)) {
        narrowings = narrowingsAround(node)
        for (const pass of passesTo(node)) {
          entered = pass
          read(node, node.expression, first)
        }
        entered = NOT_ENTERED
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return { references: [...references.values()], unread: [...unread.values()] }
}
