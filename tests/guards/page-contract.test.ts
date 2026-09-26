import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import ts from 'typescript'

/**
 * The page contract in docs/standards/UI_UX.md says every staff page is built the same way:
 * one PageLayout, no PageHeader, SectionNav or breadcrumbs, DS components instead of raw
 * elements, and a loading.tsx for every section. Nothing stopped a page drifting from it. This
 * guard is a ratchet, like tests/guards/design-tokens.test.ts: each file may have at most its
 * baseline count for each rule, and the baseline may only go down.
 *
 * Fixed some? Lower the baseline and commit it with the fix:
 *   UPDATE_PAGE_CONTRACT_BASELINE=1 npx vitest run tests/guards/page-contract.test.ts
 * The update refuses to raise any count.
 *
 * Files are read with the TypeScript parser rather than regular expressions. Comments are not
 * part of the syntax tree, so, as in the tokens guard, nothing in a comment ever counts; a
 * component name inside a string is never mistaken for a use; and an opening tag that spans
 * many lines is read whole.
 *
 * The FOH manager iPad kiosk (src/app/(authenticated)/table-bookings/foh and src/components/foh)
 * stays exactly as it is by owner decision, so most of its baseline entries are permanent. The
 * ratchet still stops them growing.
 */
const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const BASELINE_PATH = join(ROOT, 'tests/guards/page-contract.baseline.json')
const COMPAT_INDEX = join(SRC, 'ds/compat/index.ts')
const AUTHENTICATED = 'src/app/(authenticated)/'

/**
 * Folders inside src/components that are guest pages, not staff screens. Guest pages use only
 * the Guest* components (UI_UX rule 7), so the staff rules never apply to them.
 */
const GUEST_KIT: Array<{ prefix: string; reason: string }> = [
  { prefix: 'src/components/features/guest/', reason: 'The guest design system: GuestShell and the Guest* components.' },
  { prefix: 'src/components/features/shared/Guest', reason: 'The guest buttons and cancel flow of the public manage-booking page.' },
  { prefix: 'src/components/features/feedback/', reason: 'StarRating, used only by the public feedback page and styled on the guest kit.' },
]

/** Everything the app ships, except the design system itself. */
const outsideDs = (file: string): boolean => !file.startsWith('src/ds/')
/** The staff pages and the shared components they are built from. */
const staff = (file: string): boolean =>
  (file.startsWith(AUTHENTICATED) || file.startsWith('src/components/')) &&
  !GUEST_KIT.some((entry) => file.startsWith(entry.prefix))

type Binding = { imported: string; local: string; typeOnly: boolean; line: number }
/** An import, an `export ... from`, a dynamic import() or a require(). */
type ModuleRef = { module: string; kind: 'import' | 'export' | 'dynamic'; line: number; bindings: Binding[] }
type Attribute = { name: string; literal: string | undefined; line: number }
type Tag = { name: string; line: number; attributes: Attribute[]; spreads: string[] }
type StringPiece = { text: string; start: number; group: number }

type FileFacts = {
  file: string
  /** Where each line starts, so a position in a string maps to a line without keeping the tree. */
  lineStarts: readonly number[]
  modules: ModuleRef[]
  /** JSX opening and self-closing tags. */
  tags: Tag[]
  /** Lines where a retired component name is referenced (imports and uses, not closing tags). */
  references: Map<string, number[]>
  /** Lines of calls whose callee is one of CALLS_OF_INTEREST, with bare confirm() calls resolved. */
  calls: Array<{ callee: string; line: number }>
  /** The text of every string literal and template part, grouped by class expression. */
  strings: StringPiece[]
  /** The keys of every `const name = { ... }` object literal, for props spread into a tag. */
  objects: Map<string, Array<{ key: string; line: number }>>
  hasJsx: boolean
  reexportsDefault: boolean
}

const RETIRED_COMPONENTS = new Set(['PageHeader', 'SectionNav'])
const NATIVE_CONFIRM = new Set(['confirm', 'window.confirm', 'globalThis.confirm', 'self.confirm'])
const REDIRECTS = new Set(['redirect', 'permanentRedirect'])
const CALLS_OF_INTEREST = new Set([...NATIVE_CONFIRM, ...REDIRECTS])
/** Calls whose string arguments together make one class list, so cn('fixed', 'inset-0') is one list. */
const CLASS_HELPERS = new Set(['cn', 'clsx', 'classNames', 'twMerge', 'twJoin'])
const VARIANTS = '(?:[a-z0-9@\\[\\]=&>*_.-]+:)*'

function scriptKind(file: string): ts.ScriptKind {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX
  if (file.endsWith('.js')) return ts.ScriptKind.JS
  return ts.ScriptKind.TS
}

/** The node whose statements or parameters a declaration of `name` is visible in. */
function declarationScope(name: ts.Identifier): ts.Node | undefined {
  const decl = name.parent
  if ((ts.isImportSpecifier(decl) || ts.isImportClause(decl) || ts.isNamespaceImport(decl)) && decl.name === name) {
    return name.getSourceFile()
  }
  if ((ts.isFunctionExpression(decl) || ts.isClassExpression(decl)) && decl.name === name) return decl
  if ((ts.isFunctionDeclaration(decl) || ts.isClassDeclaration(decl)) && decl.name === name) return decl.parent
  const declares =
    (ts.isVariableDeclaration(decl) || ts.isBindingElement(decl) || ts.isParameter(decl)) && decl.name === name
  if (!declares) return undefined
  for (let node: ts.Node = decl; node.parent; node = node.parent) {
    if (ts.isParameter(node)) return node.parent
    const scope = node.parent
    if (
      ts.isBlock(scope) ||
      ts.isSourceFile(scope) ||
      ts.isModuleBlock(scope) ||
      ts.isCaseBlock(scope) ||
      ts.isForStatement(scope) ||
      ts.isForInStatement(scope) ||
      ts.isForOfStatement(scope)
    ) {
      return scope
    }
  }
  return undefined
}

function isInside(node: ts.Node, container: ts.Node): boolean {
  for (let current: ts.Node | undefined = node; current; current = current.parent) {
    if (current === container) return true
  }
  return false
}

function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression
  while (
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isParenthesizedExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression
  }
  return current
}

function readFacts(full: string): FileFacts {
  const file = relative(ROOT, full)
  const text = readFileSync(full, 'utf8')
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind(file))
  const lineAt = (pos: number): number => source.getLineAndCharacterOfPosition(pos).line + 1
  const lineOf = (node: ts.Node): number => lineAt(node.getStart(source))

  const facts: FileFacts = {
    file,
    lineStarts: source.getLineStarts(),
    modules: [],
    tags: [],
    references: new Map(),
    calls: [],
    strings: [],
    objects: new Map(),
    hasJsx: false,
    reexportsDefault: false,
  }
  const confirmScopes: ts.Node[] = []
  const bareConfirmCalls: ts.CallExpression[] = []
  let nextGroup = 0

  const visit = (node: ts.Node, group: number): void => {
    let childGroup = group

    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause
      const typeOnly = clause?.isTypeOnly ?? false
      const bindings: Binding[] = []
      if (clause?.name) bindings.push({ imported: 'default', local: clause.name.text, typeOnly, line: lineOf(clause.name) })
      const named = clause?.namedBindings
      if (named && ts.isNamespaceImport(named)) {
        bindings.push({ imported: '*', local: named.name.text, typeOnly, line: lineOf(named) })
      } else if (named) {
        for (const element of named.elements) {
          bindings.push({
            imported: (element.propertyName ?? element.name).text,
            local: element.name.text,
            typeOnly: typeOnly || element.isTypeOnly,
            line: lineOf(element),
          })
        }
      }
      facts.modules.push({ module: node.moduleSpecifier.text, kind: 'import', line: lineOf(node), bindings })
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.exportClause
      const bindings: Binding[] = []
      if (!clause || ts.isNamespaceExport(clause)) {
        bindings.push({ imported: '*', local: clause ? clause.name.text : '*', typeOnly: node.isTypeOnly, line: lineOf(node) })
      } else {
        for (const element of clause.elements) {
          bindings.push({
            imported: (element.propertyName ?? element.name).text,
            local: element.name.text,
            typeOnly: node.isTypeOnly || element.isTypeOnly,
            line: lineOf(element),
          })
          if (element.name.text === 'default') facts.reexportsDefault = true
        }
      }
      facts.modules.push({ module: node.moduleSpecifier.text, kind: 'export', line: lineOf(node), bindings })
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression
      const argument = node.arguments[0]
      let name: string | undefined
      if (ts.isIdentifier(callee)) name = callee.text
      else if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) {
        name = `${callee.expression.text}.${callee.name.text}`
      }
      if ((callee.kind === ts.SyntaxKind.ImportKeyword || name === 'require') && argument && ts.isStringLiteralLike(argument)) {
        const line = lineOf(node)
        facts.modules.push({ module: argument.text, kind: 'dynamic', line, bindings: [{ imported: '*', local: '', typeOnly: false, line }] })
      }
      if (name === 'confirm') bareConfirmCalls.push(node)
      else if (name && CALLS_OF_INTEREST.has(name)) facts.calls.push({ callee: name, line: lineOf(node) })
      if (group < 0 && ts.isIdentifier(callee) && CLASS_HELPERS.has(callee.text)) childGroup = nextGroup++
    } else if (ts.isTemplateExpression(node)) {
      if (group < 0) childGroup = nextGroup++
    } else if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      facts.hasJsx = true
      const attributes: Attribute[] = []
      const spreads: string[] = []
      for (const property of node.attributes.properties) {
        if (ts.isJsxAttribute(property)) {
          const value = property.initializer
          let literal: string | undefined
          if (value && ts.isStringLiteral(value)) literal = value.text
          else if (value && ts.isJsxExpression(value) && value.expression && ts.isStringLiteralLike(value.expression)) {
            literal = value.expression.text
          }
          attributes.push({ name: property.name.getText(source), literal, line: lineOf(property) })
        } else if (ts.isJsxSpreadAttribute(property) && ts.isIdentifier(property.expression)) {
          spreads.push(property.expression.text)
        }
      }
      facts.tags.push({ name: node.tagName.getText(source), line: lineOf(node), attributes, spreads })
    } else if (ts.isJsxFragment(node)) {
      facts.hasJsx = true
    } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const value = unwrap(node.initializer)
      if (ts.isObjectLiteralExpression(value)) {
        const keys = facts.objects.get(node.name.text) ?? []
        for (const property of value.properties) {
          if ((ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) &&
            (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) {
            keys.push({ key: property.name.text, line: lineOf(property) })
          }
        }
        facts.objects.set(node.name.text, keys)
      }
    } else if (ts.isIdentifier(node)) {
      if (RETIRED_COMPONENTS.has(node.text) && !ts.isJsxClosingElement(node.parent)) {
        const lines = facts.references.get(node.text) ?? []
        lines.push(lineOf(node))
        facts.references.set(node.text, lines)
      }
      if (node.text === 'confirm') {
        const scope = declarationScope(node)
        if (scope) confirmScopes.push(scope)
      }
    }

    let piece: { text: string; start: number } | undefined
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateTail(node)) {
      const start = node.getStart(source) + 1
      piece = { text: text.slice(start, node.end - 1), start }
    } else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node)) {
      const start = node.getStart(source) + 1
      piece = { text: text.slice(start, node.end - 2), start }
    }
    if (piece) facts.strings.push({ ...piece, group: group < 0 ? nextGroup++ : group })

    ts.forEachChild(node, (child) => visit(child, childGroup))
  }
  visit(source, -1)

  // A bare confirm() is the browser dialog unless a local binding called confirm is in scope.
  for (const call of bareConfirmCalls) {
    if (!confirmScopes.some((scope) => isInside(call, scope))) facts.calls.push({ callee: 'confirm', line: lineOf(call) })
  }
  return facts
}

const isDsModule = (module: string): boolean => module === '@/ds' || module.startsWith('@/ds/')

/** The names a DS component goes by in a file: its import alias, or Namespace.Name. */
function dsNames(facts: FileFacts, component: string): Set<string> {
  const names = new Set<string>()
  for (const ref of facts.modules) {
    if (ref.kind !== 'import' || !isDsModule(ref.module)) continue
    for (const binding of ref.bindings) {
      if (binding.typeOnly) continue
      if (binding.imported === component) names.add(binding.local)
      if (binding.imported === '*') names.add(`${binding.local}.${component}`)
    }
  }
  return names
}

/** The 1-based line holding a position: the last line that starts at or before it. */
function lineAtPosition(facts: FileFacts, pos: number): number {
  let low = 0
  let high = facts.lineStarts.length - 1
  while (low < high) {
    const mid = (low + high + 1) >> 1
    if (facts.lineStarts[mid] <= pos) low = mid
    else high = mid - 1
  }
  return low + 1
}

/** Every binding imported or re-exported from a matching module; a bare side-effect import counts once. */
function importLines(facts: FileFacts, matches: (module: string) => boolean): number[] {
  return facts.modules
    .filter((ref) => matches(ref.module))
    .flatMap((ref) => (ref.bindings.length > 0 ? ref.bindings.map((binding) => binding.line) : [ref.line]))
}

/** The line of each class that matches, across every string literal and template part. */
function classLines(facts: FileFacts, pattern: RegExp): number[] {
  const lines: number[] = []
  for (const piece of facts.strings) {
    for (const match of piece.text.matchAll(pattern)) {
      lines.push(lineAtPosition(facts, piece.start + (match.index ?? 0)))
    }
  }
  return lines
}

function tagLines(facts: FileFacts, names: string[], skip: (tag: Tag) => boolean = () => false): number[] {
  return facts.tags.filter((tag) => names.includes(tag.name) && !skip(tag)).map((tag) => tag.line)
}

/** The value exports of src/ds/compat/index.ts: the legacy components that are being removed. */
function compatComponents(): Set<string> {
  if (!existsSync(COMPAT_INDEX)) return new Set()
  const source = ts.createSourceFile(COMPAT_INDEX, readFileSync(COMPAT_INDEX, 'utf8'), ts.ScriptTarget.Latest, true)
  const names = new Set<string>()
  for (const statement of source.statements) {
    if (!ts.isExportDeclaration(statement) || statement.isTypeOnly) continue
    const clause = statement.exportClause
    if (!clause || !ts.isNamedExports(clause)) continue
    for (const element of clause.elements) if (!element.isTypeOnly) names.add(element.name.text)
  }
  return names
}
const COMPAT = compatComponents()

const SPACING_PROPS = new Set(['className', 'headerClassName', 'contentClassName'])
const HAND_OVERLAY_CLASSES = ['fixed', 'inset-0']
const HAND_SPINNER = new RegExp(`(?<![\\w-])${VARIANTS}animate-spin(?![\\w-])`, 'g')
const ROUNDED_MD = new RegExp(`(?<![\\w-])${VARIANTS}rounded(?:-(?:t|r|b|l|s|e|tl|tr|bl|br|ss|se|es|ee))?-md(?![\\w-])`, 'g')

type FileRule = {
  id: string
  applies: (file: string) => boolean
  why: string
  /** The line of each violation in the file. */
  find: (facts: FileFacts) => number[]
}

const FILE_RULES: FileRule[] = [
  {
    id: 'page-header',
    applies: outsideDs,
    why: 'PageHeader is retired. Pass title, subtitle, navItems and headerActions to PageLayout.',
    find: (facts) => facts.references.get('PageHeader') ?? [],
  },
  {
    id: 'breadcrumbs',
    applies: outsideDs,
    why: 'No breadcrumbs anywhere. A child page uses backButton, labelled "Back to <Parent>".',
    find: (facts) => facts.tags.flatMap((tag) => tag.attributes.filter((a) => a.name === 'breadcrumbs').map((a) => a.line)),
  },
  {
    id: 'nested-main',
    applies: staff,
    why: 'The app shell renders the only <main>. Pass blocks straight to PageLayout.',
    find: (facts) => tagLines(facts, ['main']),
  },
  {
    id: 'section-nav',
    applies: outsideDs,
    why: 'SectionNav is retired. Pass the section nav constant (<section>/_shared/nav.ts) to PageLayout as navItems.',
    find: (facts) => facts.references.get('SectionNav') ?? [],
  },
  {
    id: 'compat-import',
    applies: outsideDs,
    why: 'src/ds/compat is being removed. Use the current DS component instead.',
    find: (facts) =>
      facts.modules
        .filter((ref) => ref.kind !== 'dynamic' && (ref.module === '@/ds' || ref.module === '@/ds/compat' || ref.module.startsWith('@/ds/compat/')))
        .flatMap((ref) => ref.bindings.filter((b) => !b.typeOnly && COMPAT.has(b.imported)).map((b) => b.line)),
  },
  {
    id: 'pagelayout-spacing',
    applies: outsideDs,
    why: 'Never pass className, headerClassName or contentClassName to PageLayout. It owns the page spacing.',
    find: (facts) => {
      const names = dsNames(facts, 'PageLayout')
      const lines: number[] = []
      const spread = new Set<string>()
      for (const tag of facts.tags) {
        if (!names.has(tag.name)) continue
        for (const attribute of tag.attributes) if (SPACING_PROPS.has(attribute.name)) lines.push(attribute.line)
        for (const name of tag.spreads) {
          for (const { key, line } of facts.objects.get(name) ?? []) {
            if (SPACING_PROPS.has(key) && !spread.has(`${line}:${key}`)) {
              spread.add(`${line}:${key}`)
              lines.push(line)
            }
          }
        }
      }
      return lines
    },
  },
  {
    id: 'native-confirm',
    applies: outsideDs,
    why: 'Confirm a delete or another irreversible action with ConfirmDialog, never the browser confirm().',
    find: (facts) => facts.calls.filter((call) => NATIVE_CONFIRM.has(call.callee)).map((call) => call.line),
  },
  {
    id: 'raw-table',
    applies: staff,
    why: 'Use Table or DataTable from @/ds.',
    find: (facts) => tagLines(facts, ['table']),
  },
  {
    id: 'raw-select',
    applies: staff,
    why: 'Use Select from @/ds.',
    find: (facts) => tagLines(facts, ['select']),
  },
  {
    id: 'raw-textarea',
    applies: staff,
    why: 'Use Textarea from @/ds.',
    find: (facts) => tagLines(facts, ['textarea']),
  },
  {
    id: 'raw-button',
    applies: staff,
    why: 'Use Button, LinkButton or IconButton from @/ds.',
    find: (facts) => tagLines(facts, ['button']),
  },
  {
    id: 'raw-input',
    applies: staff,
    why: 'Use Input, SearchInput, Checkbox, Radio, Switch or FileUpload from @/ds. Only type="hidden" may stay raw.',
    find: (facts) =>
      tagLines(facts, ['input'], (tag) => tag.attributes.some((a) => a.name === 'type' && a.literal === 'hidden')),
  },
  {
    id: 'raw-label',
    applies: staff,
    why: 'Labels come from Field or the label prop of the DS fields, never a raw <label>.',
    find: (facts) => tagLines(facts, ['label']),
  },
  {
    id: 'raw-heading',
    applies: staff,
    why: 'Headings come from PageLayout (h1), Section (h2) and CardHeader (h3). No other heading styles in page code.',
    find: (facts) => tagLines(facts, ['h1', 'h2', 'h3', 'h4']),
  },
  {
    id: 'third-party-icons',
    applies: outsideDs,
    why: 'Use the DS Icon. Add a missing glyph to src/ds/icons/paths.tsx rather than importing another icon set.',
    find: (facts) =>
      importLines(facts, (module) => module.startsWith('@heroicons/react') || module === 'lucide-react' || module.startsWith('lucide-react/')),
  },
  {
    id: 'hot-toast-import',
    applies: (file) => outsideDs(file) && file !== 'src/app/layout.tsx',
    why: 'Import toast from @/ds. The one Toaster lives in src/app/layout.tsx.',
    find: (facts) => importLines(facts, (module) => module === 'react-hot-toast' || module.startsWith('react-hot-toast/')),
  },
  {
    id: 'hand-spinner',
    applies: outsideDs,
    why: 'No hand-made spinners. Use PageLoading (inline for a block), Spinner, or the loading prop of Button and PageLayout.',
    find: (facts) => classLines(facts, HAND_SPINNER),
  },
  {
    id: 'hand-overlay',
    applies: outsideDs,
    why: 'Never a hand-built fixed inset-0 overlay. Use Modal, Drawer, Popover, Dropdown or ConfirmDialog from @/ds.',
    find: (facts) => {
      const groups = new Map<number, StringPiece[]>()
      for (const piece of facts.strings) groups.set(piece.group, [...(groups.get(piece.group) ?? []), piece])
      const lines: number[] = []
      for (const pieces of groups.values()) {
        const found = HAND_OVERLAY_CLASSES.map((cls) =>
          pieces.find((piece) => piece.text.split(/\s+/).some((token) => token.replace(/^(?:[^:\s]+:)*!?/, '') === cls)),
        )
        if (found.every(Boolean)) lines.push(lineAtPosition(facts, found[0]!.start))
      }
      return lines
    },
  },
  {
    id: 'section-padding',
    applies: outsideDs,
    why: 'A default Section adds no padding, so its cards line up with every other card. Drop padding, or use variant="gray" or "bordered".',
    find: (facts) => {
      const names = dsNames(facts, 'Section')
      return facts.tags
        .filter((tag) => names.has(tag.name))
        .filter((tag) => {
          const variant = tag.attributes.find((a) => a.name === 'variant')
          const padding = tag.attributes.find((a) => a.name === 'padding')
          return padding !== undefined && (variant === undefined || variant.literal === 'default')
        })
        .map((tag) => tag.line)
    },
  },
  {
    id: 'rounded-md',
    applies: staff,
    why: 'rounded-md is 10px in this design system, not the Tailwind 6px. Use rounded-sm (6px), rounded-default (8px, fields and buttons) or a DS component.',
    find: (facts) => classLines(facts, ROUNDED_MD),
  },
]

/** Rules about the shape of the route tree rather than the contents of one file. */
type TreeRule = {
  id: string
  why: string
  /** Each violation, keyed by the file it belongs to (which may be a file that should exist). */
  find: (facts: Map<string, FileFacts>) => Array<{ file: string; lines: number[] }>
}

const MAX_IMPORT_DEPTH = 4
const FOLLOWED_IMPORTS = ['./', '../', '@/app/', '@/components/']
const RESOLVE_SUFFIXES = ['', '.tsx', '.ts', '.jsx', '.js', '/index.tsx', '/index.ts', '/index.jsx', '/index.js']

/** The src file a local import points at, or undefined for a package or an unfollowed alias. */
function resolveImport(from: string, module: string, facts: Map<string, FileFacts>): string | undefined {
  if (!FOLLOWED_IMPORTS.some((prefix) => module.startsWith(prefix))) return undefined
  const base = module.startsWith('@/') ? join('src', module.slice(2)) : join(dirname(from), module)
  return RESOLVE_SUFFIXES.map((suffix) => `${base}${suffix}`).find((candidate) => facts.has(candidate))
}

/** Whether a file renders the DS PageLayout, itself or through its local imports. */
function reachesPageLayout(start: string, facts: Map<string, FileFacts>): boolean {
  const seen = new Set([start])
  let frontier = [start]
  for (let depth = 0; depth <= MAX_IMPORT_DEPTH && frontier.length > 0; depth++) {
    const next: string[] = []
    for (const file of frontier) {
      const entry = facts.get(file)
      if (!entry) continue
      const names = dsNames(entry, 'PageLayout')
      if (entry.tags.some((tag) => names.has(tag.name))) return true
      for (const ref of entry.modules) {
        if (ref.bindings.every((binding) => binding.typeOnly) && ref.bindings.length > 0) continue
        const target = resolveImport(file, ref.module, facts)
        if (target && !seen.has(target)) {
          seen.add(target)
          next.push(target)
        }
      }
    }
    frontier = next
  }
  return false
}

function sectionDirectories(): string[] {
  const root = join(ROOT, AUTHENTICATED)
  return readdirSync(root).filter((entry) => statSync(join(root, entry)).isDirectory())
}

const isPage = (file: string): boolean => /\/page\.[jt]sx?$/.test(file)

const TREE_RULES: TreeRule[] = [
  {
    id: 'missing-loading',
    why: 'Every section has a loading.tsx that renders <PageLoading />.',
    find: (facts) => {
      const missing: Array<{ file: string; lines: number[] }> = []
      for (const section of sectionDirectories()) {
        const dir = `${AUTHENTICATED}${section}/`
        const hasPage = [...facts.keys()].some((file) => file.startsWith(dir) && isPage(file))
        if (hasPage && !existsSync(join(ROOT, dir, 'loading.tsx'))) missing.push({ file: `${dir}loading.tsx`, lines: [] })
      }
      return missing
    },
  },
  {
    id: 'page-without-layout',
    why: `Every page renders PageLayout: in the page, within ${MAX_IMPORT_DEPTH} local imports of it, or in a layout.tsx between it and the (authenticated) root. A redirect-only page (no JSX) and a default re-export of another page are exempt.`,
    find: (facts) => {
      const layoutCache = new Map<string, boolean>()
      const layoutRenders = (layout: string): boolean => {
        if (!layoutCache.has(layout)) layoutCache.set(layout, facts.has(layout) && reachesPageLayout(layout, facts))
        return layoutCache.get(layout)!
      }
      const failures: Array<{ file: string; lines: number[] }> = []
      for (const [file, entry] of facts) {
        if (!file.startsWith(AUTHENTICATED) || !isPage(file)) continue
        const redirectOnly = !entry.hasJsx && entry.calls.some((call) => REDIRECTS.has(call.callee))
        if (redirectOnly || entry.reexportsDefault) continue
        if (reachesPageLayout(file, facts)) continue
        // Layouts between the page and the (authenticated) group root, which is excluded.
        let dir = dirname(file)
        let covered = false
        while (`${dir}/` !== AUTHENTICATED && dir.startsWith(AUTHENTICATED) && !covered) {
          covered = ['layout.tsx', 'layout.ts'].some((name) => layoutRenders(`${dir}/${name}`))
          dir = dirname(dir)
        }
        if (!covered) failures.push({ file, lines: [] })
      }
      return failures
    },
  },
]

type Findings = Record<string, Record<string, number[]>>
type Counts = Record<string, Record<string, number>>

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === '__mocks__') continue
      sourceFiles(full, found)
    } else if (/\.[jt]sx?$/.test(entry) && !/\.d\.ts$/.test(entry) && !/\.(test|spec)\.[jt]sx?$/.test(entry)) {
      found.push(full)
    }
  }
  return found
}

function findAll(): Findings {
  const facts = new Map<string, FileFacts>()
  for (const full of sourceFiles(SRC)) {
    const file = relative(ROOT, full)
    if (!outsideDs(file)) continue // the design system itself
    facts.set(file, readFacts(full))
  }
  const findings: Findings = {}
  for (const [file, entry] of facts) {
    for (const rule of FILE_RULES) {
      if (!rule.applies(file)) continue
      const lines = rule.find(entry)
      if (lines.length > 0) (findings[file] ??= {})[rule.id] = lines.sort((a, b) => a - b)
    }
  }
  for (const rule of TREE_RULES) {
    for (const { file, lines } of rule.find(facts)) (findings[file] ??= {})[rule.id] = lines
  }
  return findings
}

/** A structural violation has no lines, so it counts once. */
const countOf = (lines: number[]): number => Math.max(lines.length, 1)

function toCounts(findings: Findings): Counts {
  const counts: Counts = {}
  for (const [file, rules] of Object.entries(findings)) {
    for (const [ruleId, lines] of Object.entries(rules)) (counts[file] ??= {})[ruleId] = countOf(lines)
  }
  return counts
}

function readBaseline(): Counts {
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Counts
  } catch {
    return {}
  }
}

function describeRule(ruleId: string): string {
  return [...FILE_RULES, ...TREE_RULES].find((rule) => rule.id === ruleId)?.why ?? ''
}

function atLines(lines: number[]): string {
  return lines.length === 0 ? '' : ` at line${lines.length === 1 ? '' : 's'} ${lines.join(', ')}`
}

describe('staff pages follow the page contract', () => {
  const findings = findAll()
  const actual = toCounts(findings)
  const baseline = readBaseline()

  if (process.env.UPDATE_PAGE_CONTRACT_BASELINE === '1') {
    it('writes a baseline that is never higher than before', () => {
      const firstRun = Object.keys(baseline).length === 0
      const raised: string[] = []
      for (const [file, rules] of Object.entries(actual)) {
        for (const [ruleId, n] of Object.entries(rules)) {
          const allowed = baseline[file]?.[ruleId] ?? 0
          if (!firstRun && n > allowed) raised.push(`${file} ${ruleId}: ${allowed} -> ${n}${atLines(findings[file][ruleId])}`)
        }
      }
      expect(raised, 'The baseline can only go down. Fix these instead of raising it.').toEqual([])
      const sorted = Object.fromEntries(Object.keys(actual).sort().map((file) => [file, actual[file]]))
      writeFileSync(BASELINE_PATH, `${JSON.stringify(sorted, null, 2)}\n`)
    })
    return
  }

  it('adds no new violations', () => {
    const over: string[] = []
    for (const [file, rules] of Object.entries(actual)) {
      for (const [ruleId, n] of Object.entries(rules)) {
        const allowed = baseline[file]?.[ruleId] ?? 0
        if (n > allowed) {
          over.push(`${file}: ${ruleId} ${n} (allowed ${allowed})${atLines(findings[file][ruleId])}. ${describeRule(ruleId)}`)
        }
      }
    }
    expect(over, 'New page contract violations. See docs/standards/UI_UX.md, "Page contract".').toEqual([])
  })

  it('has a baseline no looser than the code', () => {
    const loose: string[] = []
    for (const [file, rules] of Object.entries(baseline)) {
      for (const [ruleId, allowed] of Object.entries(rules)) {
        const n = actual[file]?.[ruleId] ?? 0
        if (n < allowed) loose.push(`${file}: ${ruleId} baseline ${allowed}, now ${n}`)
      }
    }
    expect(
      loose,
      'Violations were fixed. Lower the baseline: UPDATE_PAGE_CONTRACT_BASELINE=1 npx vitest run tests/guards/page-contract.test.ts',
    ).toEqual([])
  })
})
