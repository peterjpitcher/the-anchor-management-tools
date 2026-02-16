import fs from 'node:fs'
import path from 'node:path'

describe('scripts/testing/test-and-fix-sms.ts', () => {
  it('does not rely on the Next.js server Supabase client helper', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/testing/test-and-fix-sms.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).not.toContain('@/lib/supabase/server')
  })

  it('remains strictly read-only (no enqueue/process/send, no stdin prompts)', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/testing/test-and-fix-sms.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).not.toContain('sendSMS(')
    expect(script).not.toContain('background-jobs')
    expect(script).not.toContain('jobQueue')
    expect(script).not.toContain('.enqueue(')
    expect(script).not.toContain('processJobs(')
    expect(script).not.toContain('process.stdin')
    expect(script).not.toContain('askQuestion(')

    // Guard against accidental DB mutations.
    expect(script).not.toContain('.insert(')
    expect(script).not.toContain('.update(')
    expect(script).not.toContain('.delete(')

    // Prefer non-terminating exit codes so scripts are testable and fail-closed.
    expect(script).not.toContain('process.exit(')
    expect(script).toContain('process.exitCode')
    expect(script).toContain('--confirm')
    expect(script).toContain('does not support --confirm')
  })

  it('is runnable as a tsx script', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/testing/test-and-fix-sms.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script.startsWith('#!/usr/bin/env tsx')).toBe(true)
  })
})
