import fs from 'node:fs'
import path from 'node:path'

function readScript(relativePath: string): string {
  const scriptPath = path.resolve(process.cwd(), relativePath)
  return fs.readFileSync(scriptPath, 'utf8')
}

describe('scripts/fixes fix-rpc-functions scripts', () => {
  it('remain strictly read-only (no insert/update/delete/upsert)', () => {
    const scripts = [
      'scripts/fixes/fix-rpc-functions.ts',
      'scripts/fixes/fix-rpc-functions-direct.ts'
    ]

    for (const scriptPath of scripts) {
      const script = readScript(scriptPath)
      expect(script).not.toContain('.insert(')
      expect(script).not.toContain('.update(')
      expect(script).not.toContain('.delete(')
      expect(script).not.toContain('.upsert(')
    }
  })

  it('explicitly block --confirm and use script-safe admin/query helpers', () => {
    const script = readScript('scripts/fixes/fix-rpc-functions.ts')
    const direct = readScript('scripts/fixes/fix-rpc-functions-direct.ts')

    expect(script).toContain('--confirm')
    expect(script).toContain('read-only')
    expect(script).toContain('createAdminClient')
    expect(script).toContain('assertScriptQuerySucceeded')
    expect(script).not.toContain('@supabase/supabase-js')

    expect(direct).toContain('--confirm')
    expect(direct).toContain('read-only')
    expect(direct).toContain('createAdminClient')
    expect(direct).toContain('assertScriptQuerySucceeded')
    expect(direct).not.toContain('@supabase/supabase-js')
  })

  it('does not attempt arbitrary SQL execution via rpc(query) or REST rpc/query', () => {
    const script = readScript('scripts/fixes/fix-rpc-functions.ts')
    expect(script).not.toContain(".rpc('query'")
    expect(script).not.toContain('.from(\'_sql\')')

    const direct = readScript('scripts/fixes/fix-rpc-functions-direct.ts')
    expect(direct).not.toContain('/rest/v1/rpc/query')
    expect(direct).not.toContain('executeSql(')
  })

  it('does not force success exits via process.exit(0)', () => {
    const script = readScript('scripts/fixes/fix-rpc-functions.ts')
    const direct = readScript('scripts/fixes/fix-rpc-functions-direct.ts')

    expect(script).not.toContain('process.exit(0)')
    expect(direct).not.toContain('process.exit(0)')
  })
})
