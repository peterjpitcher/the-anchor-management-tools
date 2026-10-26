import fs from 'node:fs'
import path from 'node:path'

describe('party-size seat update routes fail-open regression guards', () => {
  it('does not allow direct console logging in FOH/BOH party-size routes (prefer structured logger)', () => {
    const candidateFiles = [
      'src/app/api/foh/bookings/[id]/party-size/route.ts',
      'src/app/api/boh/table-bookings/[id]/party-size/route.ts',
      // Both routes run this shared handler (BK-129).
      'src/lib/table-bookings/party-size-change.ts',
    ]

    for (const relativePath of candidateFiles) {
      const filePath = path.resolve(process.cwd(), relativePath)
      const content = fs.readFileSync(filePath, 'utf8')
      expect(content).not.toMatch(/\bconsole\.(debug|info|log|warn|error)\b/)
    }
  })
})

