import fs from 'node:fs'
import path from 'node:path'

describe('event image diagnostic scripts', () => {
  it('scripts/testing/test-event-crud-fixed.ts remains read-only', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/testing/test-event-crud-fixed.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).not.toContain('.insert(')
    expect(script).not.toContain('.update(')
    expect(script).not.toContain('.delete(')
    expect(script).not.toContain('.rpc(')
  })

  it('scripts/testing/test-event-image-fields.ts remains read-only', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/testing/test-event-image-fields.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).not.toContain('.insert(')
    expect(script).not.toContain('.update(')
    expect(script).not.toContain('.delete(')
    expect(script).not.toContain('.rpc(')
  })
})

