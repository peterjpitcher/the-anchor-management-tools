import fs from 'node:fs'
import path from 'node:path'

describe('scripts/testing/test-customer-labels-cron.ts', () => {
  it('remains read-only and uses the health-check path', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/testing/test-customer-labels-cron.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).toContain('?health=true')

    // Guard against accidental mutation/side-effect calls.
    expect(script).not.toContain("method: 'POST'")
    expect(script).not.toContain('method: "POST"')
    expect(script).not.toContain('process.exit(')

    expect(script).not.toContain('.enqueue(')
    expect(script).not.toContain('processJobs(')
    expect(script).not.toContain('.insert(')
    expect(script).not.toContain('.update(')
    expect(script).not.toContain('.delete(')
    expect(script).not.toContain('.rpc(')
  })
})

