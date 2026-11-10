/**
 * Regenerates the MCP bridge's lists (actions, staff routes, tables) from the code.
 *
 *   npm run mcp:manifest
 *
 * Run it whenever a server action, an API route or the database types change.
 * tests/guards/mcp-manifest.test.ts fails until the committed files match.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { buildMcpManifest, renderManifestFiles } from '../../src/lib/mcp/manifest/build'
import { ACTION_OVERRIDES } from '../../src/lib/mcp/action-overrides'

const root = process.cwd()
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
