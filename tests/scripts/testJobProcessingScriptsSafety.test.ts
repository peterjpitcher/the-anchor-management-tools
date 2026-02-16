import fs from 'node:fs'
import path from 'node:path'

describe('Job processing scripts safety defaults', () => {
  it('reset-jobs defaults to dry-run and is multi-gated with caps', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/reset-jobs.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).toContain('DRY RUN')
    expect(script).toContain('--confirm')
    expect(script).toContain('--dry-run')
    expect(script).toContain('--limit')
    expect(script).toContain('RUN_JOB_RETRY_MUTATION_SCRIPT')
    expect(script).toContain('ALLOW_JOB_RETRY_MUTATION_SCRIPT')
    expect(script).toContain('ALLOW_JOB_RETRY_SEND_TYPES')

    expect(script).not.toContain('process.exit(')
    expect(script).toContain('process.exitCode')
  })

  it('retry-failed-jobs defaults to dry-run and is multi-gated with caps', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/retry-failed-jobs.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).toContain('DRY RUN')
    expect(script).toContain('--confirm')
    expect(script).toContain('--dry-run')
    expect(script).toContain('--limit')
    expect(script).toContain('RUN_JOB_RETRY_MUTATION_SCRIPT')
    expect(script).toContain('ALLOW_JOB_RETRY_MUTATION_SCRIPT')

    expect(script).not.toContain('process.exit(')
    expect(script).toContain('process.exitCode')
  })

  it('process-jobs defaults to dry-run and is multi-gated with caps', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/process-jobs.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).toContain('DRY RUN')
    expect(script).toContain('--confirm')
    expect(script).toContain('--dry-run')
    expect(script).toContain('--limit')
    expect(script).toContain('RUN_PROCESS_JOBS_MUTATION')
    expect(script).toContain('ALLOW_PROCESS_JOBS_MUTATION')
    expect(script).toContain('ALLOW_PROCESS_JOBS_SEND_TYPES')

    expect(script).not.toContain('process.exit(')
    expect(script).toContain('process.exitCode')
  })
})

