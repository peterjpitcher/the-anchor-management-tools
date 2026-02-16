import fs from 'node:fs'
import path from 'node:path'

describe('events actions fail-open regression guards', () => {
  it('does not allow direct console logging in event actions (prefer structured logger)', () => {
    const filePath = path.resolve(process.cwd(), 'src/app/actions/events.ts')
    const content = fs.readFileSync(filePath, 'utf8')

    expect(content).not.toMatch(/\bconsole\.(debug|info|log|warn|error)\b/)
  })
})

