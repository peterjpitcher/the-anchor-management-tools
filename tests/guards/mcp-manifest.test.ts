import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildMcpManifest, renderManifestFiles } from '@/lib/mcp/manifest/build'
import { ACTION_OVERRIDES } from '@/lib/mcp/action-overrides'

/**
 * Keeps the MCP bridge in step with the app (owner's rule, 10 November 2026: "if anything is
 * updated, the MCP server is updated as well").
 *
 * The bridge's lists of actions, staff routes and tables are generated from the code. This test
 * regenerates them in memory and fails if the committed copies differ, so a PR that adds, renames
 * or removes a server action, an API route or a table cannot merge until `npm run mcp:manifest`
 * has been run and the result committed.
 */

const root = process.cwd()
const manifest = buildMcpManifest(root, ACTION_OVERRIDES)
const files = renderManifestFiles(manifest)

describe('MCP manifest', () => {
  it('finds what it is meant to find', () => {
    // Guards the scan itself: an empty or tiny list would otherwise pass as "in date".
    expect(manifest.actions.length).toBeGreaterThan(800)
    expect(manifest.routes.length).toBeGreaterThan(100)
    expect(manifest.tables.length).toBeGreaterThan(200)
    expect(manifest.actions.map((action) => action.name)).toContain('invoices.getInvoices')
    expect(manifest.routes.map((route) => route.path)).toContain('/api/boh/table-bookings')
    expect(manifest.tables.map((table) => table.name)).toContain('table_bookings')
  })

  it('leaves out machine endpoints and the bridge itself', () => {
    const paths = manifest.routes.map((route) => route.path)
    expect(paths.some((path) => path.startsWith('/api/cron/'))).toBe(false)
    expect(paths.some((path) => path.startsWith('/api/webhooks/'))).toBe(false)
    expect(paths).not.toContain('/api/mcp')
  })

  it.each(Object.keys(files))('%s is up to date (run npm run mcp:manifest if this fails)', (path) => {
    const committed = readFileSync(join(root, path), 'utf8')
    expect(committed === files[path], `${path} is out of date: run npm run mcp:manifest and commit the result`).toBe(true)
  })

  it('every override names a real action', () => {
    const names = new Set(manifest.actions.map((action) => action.name))
    expect(Object.keys(ACTION_OVERRIDES).filter((name) => !names.has(name))).toEqual([])
  })

  it('never classes an obvious writer as read only', () => {
    const wrong = manifest.actions.filter(
      (action) => action.readOnly && /^(create|update|delete|send|cancel|refund|void|approve|remove|record|mark|set)/.test(action.export),
    )
    expect(wrong.map((action) => action.name)).toEqual([])
  })
})
