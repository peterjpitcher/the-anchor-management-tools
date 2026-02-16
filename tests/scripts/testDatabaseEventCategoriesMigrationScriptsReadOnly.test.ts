import fs from 'node:fs'
import path from 'node:path'

function readScript(relativePath: string): string {
  const scriptPath = path.resolve(process.cwd(), relativePath)
  return fs.readFileSync(scriptPath, 'utf8')
}

describe('scripts/database event category migration checks', () => {
  it('remain strictly read-only (no insert/update/delete/upsert)', () => {
    const scripts = [
      'scripts/database/check-event-categories-migration.ts',
      'scripts/database/check-migration-simple.ts'
    ]

    for (const scriptPath of scripts) {
      const script = readScript(scriptPath)
      expect(script).not.toContain('.insert(')
      expect(script).not.toContain('.update(')
      expect(script).not.toContain('.delete(')
      expect(script).not.toContain('.upsert(')
    }
  })

  it('does not attempt to create helper functions via exec_sql', () => {
    const script = readScript('scripts/database/check-event-categories-migration.ts')

    expect(script).not.toContain('exec_sql')
    expect(script).not.toContain('CREATE OR REPLACE FUNCTION')
    expect(script).not.toContain('SECURITY DEFINER')
  })
})

