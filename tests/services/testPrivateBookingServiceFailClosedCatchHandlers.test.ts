import fs from 'node:fs'
import path from 'node:path'

describe('PrivateBookingService fail-closed regression guards', () => {
  it('does not allow .catch(console.error) which can swallow SMS queue/send failures', () => {
    const filePath = path.resolve(process.cwd(), 'src/services/private-bookings.ts')
    const content = fs.readFileSync(filePath, 'utf8')
    expect(content).not.toContain('.catch(console.error)')
  })
})

