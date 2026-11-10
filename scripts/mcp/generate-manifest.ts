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
import { buildMcpManifest, explainActionClassing, renderManifestFiles } from '../../src/lib/mcp/manifest/build'
import { ACTION_OVERRIDES } from '../../src/lib/mcp/action-overrides'

const root = process.cwd()

const whyIndex = process.argv.indexOf('--why')
if (whyIndex !== -1) {
  const wanted = process.argv[whyIndex + 1]
  const reasons = explainActionClassing(root, ACTION_OVERRIDES)
  const matches = [...reasons.entries()].filter(([name]) => !wanted || name === wanted || name.endsWith(`.${wanted}`))
  process.stdout.write(
    `${JSON.stringify({ query: wanted ?? null, notReadOnly: Object.fromEntries(matches), readOnly: wanted ? matches.length === 0 : undefined })}\n`,
  )
  process.exit(0)
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
