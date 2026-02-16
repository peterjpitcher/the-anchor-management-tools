import fs from 'node:fs'
import path from 'node:path'

describe('private booking actions fail-open regression guards', () => {
  it('does not allow direct console logging in private booking actions (prefer structured logger)', () => {
    const filePath = path.resolve(process.cwd(), 'src/app/actions/privateBookingActions.ts')
    const content = fs.readFileSync(filePath, 'utf8')
    expect(content).not.toMatch(/\bconsole\.(debug|info|log|warn|error)\b/)
  })
})

