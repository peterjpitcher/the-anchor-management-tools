import fs from 'node:fs'
import path from 'node:path'

describe('messages unread-count route regression guards', () => {
  it('does not allow direct console logging in the unread-count route handler (prefer structured logger)', () => {
    const filePath = path.resolve(process.cwd(), 'src/app/api/messages/unread-count/route.ts')
    const content = fs.readFileSync(filePath, 'utf8')
    expect(content).not.toMatch(/\bconsole\.(debug|info|log|warn|error)\b/)
  })
})

