import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

type Layer =
  | 'route-entry'
  | 'route-local'
  | 'shared-component'
  | 'ds-compat'
  | 'ds-composite'
  | 'ds-icon'
  | 'ds-primitive'
  | 'ds-shell'

interface ComponentRow {
  path: string
  line: number
  component: string
  layer: Layer
  visibility: 'exported' | 'internal'
}

const root = process.cwd()
const sourceRoot = path.join(root, 'src')

function walk(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return walk(fullPath)
    return entry.isFile() && entry.name.endsWith('.tsx') ? [fullPath] : []
  })
}

function isProductionFile(filePath: string): boolean {
  return !filePath.includes('/__tests__/') && !/\.(test|spec)\.tsx$/.test(filePath)
}

function isPascalCase(name: string): boolean {
  return /^[A-Z][A-Za-z0-9]*$/.test(name)
}

function containsJsx(node: ts.Node): boolean {
  let found = false
  const visit = (child: ts.Node): void => {
    if (
      ts.isJsxElement(child) ||
      ts.isJsxSelfClosingElement(child) ||
      ts.isJsxFragment(child)
    ) {
      found = true
      return
    }
    if (!found) ts.forEachChild(child, visit)
  }
  visit(node)
  return found
}

function hasExportModifier(node: ts.Node): boolean {
  return Boolean(ts.getModifiers(node as ts.HasModifiers)?.some((modifier) =>
    modifier.kind === ts.SyntaxKind.ExportKeyword ||
    modifier.kind === ts.SyntaxKind.DefaultKeyword
  ))
}

function layerFor(relativePath: string): Layer {
  if (relativePath.startsWith('src/ds/compat/')) return 'ds-compat'
  if (relativePath.startsWith('src/ds/composites/')) return 'ds-composite'
  if (relativePath.startsWith('src/ds/icons/')) return 'ds-icon'
  if (relativePath.startsWith('src/ds/primitives/')) return 'ds-primitive'
  if (relativePath.startsWith('src/ds/shell/')) return 'ds-shell'
  if (relativePath.startsWith('src/components/')) return 'shared-component'
  if (/\/components\//.test(relativePath) && !/\/_components\//.test(relativePath)) {
    return 'shared-component'
  }
  if (/\/(page|layout|loading|error|not-found)\.tsx$/.test(relativePath)) return 'route-entry'
  return 'route-local'
}

function csv(value: string | number): string {
  return `"${String(value).replaceAll('"', '""')}"`
}

const rows: ComponentRow[] = []

for (const filePath of walk(sourceRoot).filter(isProductionFile)) {
  const sourceText = fs.readFileSync(filePath, 'utf8')
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )
  const relativePath = path.relative(root, filePath)
  const layer = layerFor(relativePath)

  const add = (name: string, node: ts.Node, exported: boolean): void => {
    if (!isPascalCase(name) || !containsJsx(node)) return
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
    rows.push({
      path: relativePath,
      line: line + 1,
      component: name,
      layer,
      visibility: exported ? 'exported' : 'internal',
    })
  }

  sourceFile.forEachChild((node) => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      add(node.name.text, node, hasExportModifier(node))
      return
    }

    if (ts.isClassDeclaration(node) && node.name) {
      add(node.name.text, node, hasExportModifier(node))
      return
    }

    if (ts.isVariableStatement(node)) {
      const exported = hasExportModifier(node)
      for (const declaration of node.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer) {
          add(declaration.name.text, declaration.initializer, exported)
        }
      }
    }
  })
}

const sameNameCounts = new Map<string, number>()
for (const row of rows) {
  sameNameCounts.set(row.component, (sameNameCounts.get(row.component) ?? 0) + 1)
}

rows.sort((a, b) =>
  a.path.localeCompare(b.path) || a.line - b.line || a.component.localeCompare(b.component)
)

const header = [
  'path',
  'line',
  'component',
  'layer',
  'visibility',
  'same_name_count',
  'initial_status',
]

const output = [
  header.map(csv).join(','),
  ...rows.map((row) => [
    row.path,
    row.line,
    row.component,
    row.layer,
    row.visibility,
    sameNameCounts.get(row.component) ?? 1,
    row.layer === 'route-entry'
      ? 'route'
      : row.layer === 'route-local'
        ? 'local'
        : 'review',
  ].map(csv).join(',')),
].join('\n') + '\n'

fs.writeFileSync(path.join(root, 'tasks/ui-component-index.csv'), output)

const counts = rows.reduce<Record<string, number>>((result, row) => {
  result[row.layer] = (result[row.layer] ?? 0) + 1
  return result
}, {})

console.log(JSON.stringify({ total: rows.length, counts }, null, 2))
