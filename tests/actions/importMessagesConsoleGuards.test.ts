import fs from 'node:fs'
import path from 'node:path'

describe('import missed messages action fail-open regression guards', () => {
  it('does not allow direct console logging (prefer structured logger)', () => {
    const filePath = path.resolve(process.cwd(), 'src/app/actions/import-messages.ts')
    const content = fs.readFileSync(filePath, 'utf8')
    expect(content).not.toMatch(/\bconsole\.(debug|info|log|warn|error)\b/)
  })
})

