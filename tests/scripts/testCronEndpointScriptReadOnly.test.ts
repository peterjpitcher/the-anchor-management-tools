import fs from 'node:fs'
import path from 'node:path'

describe('scripts/testing/test-cron-endpoint.ts', () => {
  it('remains read-only and does not trigger job processing', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/testing/test-cron-endpoint.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    // Guard against accidental mutation/side-effect calls.
    expect(script).not.toContain("method: 'POST'")
    expect(script).not.toContain('method: "POST"')
    expect(script).not.toContain('process.exit(0)')
    expect(script).not.toContain('process.exit(1)')

    expect(script).not.toContain('.enqueue(')
    expect(script).not.toContain('processJobs(')
    expect(script).not.toContain('.insert(')
    expect(script).not.toContain('.update(')
    expect(script).not.toContain('.delete(')
  })
})

