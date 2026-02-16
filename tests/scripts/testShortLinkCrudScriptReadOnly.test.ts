import fs from 'node:fs'
import path from 'node:path'

describe('scripts/testing/test-short-link-crud.ts', () => {
  it('remains read-only and does not mutate short_links', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/testing/test-short-link-crud.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    // Guard against accidental mutations.
    expect(script).not.toContain('.insert(')
    expect(script).not.toContain('.update(')
    expect(script).not.toContain('.delete(')
    expect(script).not.toContain('.rpc(')
  })
})

