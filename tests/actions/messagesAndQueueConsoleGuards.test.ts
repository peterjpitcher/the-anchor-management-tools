import fs from 'node:fs'
import path from 'node:path'

describe('messages + queue actions fail-open regression guards', () => {
  it('does not allow direct console logging in SMS reply/enqueue actions (prefer structured logger)', () => {
    const candidateFiles = [
      'src/app/actions/messageActions.ts',
      'src/app/actions/job-queue.ts',
    ]

    for (const relativePath of candidateFiles) {
      const filePath = path.resolve(process.cwd(), relativePath)
      const content = fs.readFileSync(filePath, 'utf8')
      expect(content).not.toMatch(/\bconsole\.(debug|info|log|warn|error)\b/)
    }
  })
})

