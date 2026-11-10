/**
 * Regenerates the MCP bridge's lists (actions, staff routes, tables) from the code.
 *
 *   npm run mcp:manifest
 *   npm run mcp:manifest -- --why <module.action>   (why an action is not classed read only)
 *
 * Run it whenever a server action, an API route or the database types change.
 * tests/guards/mcp-manifest.test.ts fails until the committed files match.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { buildMcpManifest, renderManifestFiles } from '../../src/lib/mcp/manifest/build'
import { ACTION_OVERRIDES } from '../../src/lib/mcp/action-overrides'

const root = process.cwd()

const whyIndex = process.argv.indexOf('--why')
if (whyIndex !== -1) {
  // With a name (`invoices.getInvoice`, or just `getInvoice`): how each matching action is classed
  // and why. Without one: every action that is not read only, with its reason.
  const wanted = process.argv[whyIndex + 1]
  const reasons = new Map<string, string>()
  const { actions } = buildMcpManifest(root, ACTION_OVERRIDES, reasons)
  const matching = actions.filter((action) => !wanted || action.name === wanted || action.export === wanted)
  const result = Object.fromEntries(
    matching
      .filter((action) => wanted || !action.readOnly)
      .map((action) => [action.name, action.readOnly ? 'read only' : `write: ${reasons.get(action.name) ?? 'unknown'}`]),
  )
  process.stdout.write(`${JSON.stringify({ query: wanted ?? null, found: matching.length, actions: result })}\n`)
  process.exit(wanted && matching.length === 0 ? 1 : 0)
}

const manifest = buildMcpManifest(root, ACTION_OVERRIDES)
for (const [path, content] of Object.entries(renderManifestFiles(manifest))) {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), content)
}

const readOnly = manifest.actions.filter((action) => action.readOnly).length
process.stdout.write(
  `${JSON.stringify({
    actions: manifest.actions.length,
    readOnlyActions: readOnly,
    routes: manifest.routes.length,
    tables: manifest.tables.length,
  })}\n`,
)
