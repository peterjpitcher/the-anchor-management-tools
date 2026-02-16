import fs from 'node:fs'
import path from 'node:path'

describe('scripts/hiring/cleanup-stuck-cvs.ts safety defaults', () => {
  it('defaults to dry-run and is multi-gated with caps', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/hiring/cleanup-stuck-cvs.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).toContain('DRY RUN')
    expect(script).toContain('--confirm')
    expect(script).toContain('--dry-run')
    expect(script).toContain('--limit')
    expect(script).toContain('RUN_CLEANUP_STUCK_CVS_MUTATION')
    expect(script).toContain('ALLOW_CLEANUP_STUCK_CVS_MUTATION_SCRIPT')

    expect(script).not.toContain('process.exit(')
    expect(script).toContain('process.exitCode')
  })

  it('enforces strict positive-integer cap parsing', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/hiring/cleanup-stuck-cvs.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).toContain('/^[1-9]\\d*$/')
    expect(script).toContain('Invalid positive integer')
    expect(script).toContain('Number.isInteger')
    expect(script).not.toContain('const parsed = Number.parseInt(raw, 10)')
  })
})
