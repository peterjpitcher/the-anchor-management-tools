import fs from 'node:fs'
import path from 'node:path'

describe('diagnostic actions fail-open regression guards', () => {
  it('does not allow direct console logging in diagnose-messages action (prefer structured logger)', () => {
    const filePath = path.resolve(process.cwd(), 'src/app/actions/diagnose-messages.ts')
    const content = fs.readFileSync(filePath, 'utf8')
    expect(content).not.toMatch(/\bconsole\.(debug|info|log|warn|error)\b/)
  })

  it('does not allow direct console logging in webhook diagnostic action (prefer structured logger)', () => {
    const filePath = path.resolve(process.cwd(), 'src/app/actions/diagnose-webhook-issues.ts')
    const content = fs.readFileSync(filePath, 'utf8')
    expect(content).not.toMatch(/\bconsole\.(debug|info|log|warn|error)\b/)
  })
})

