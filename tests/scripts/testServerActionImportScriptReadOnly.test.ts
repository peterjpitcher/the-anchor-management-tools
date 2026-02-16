import fs from 'node:fs'
import path from 'node:path'

describe('scripts/testing/test-server-action-import.ts', () => {
  it('remains strictly read-only (does not call server actions or mutate DB)', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/testing/test-server-action-import.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script).not.toMatch(/\bqueueBookingConfirmationSMS\s*\(/)
    expect(script).not.toContain('sendSMS(')
    expect(script).not.toContain('jobQueue')
    expect(script).not.toContain('.enqueue(')
    expect(script).not.toContain('processJobs(')

    // Guard against accidental DB mutations.
    expect(script).not.toContain('.insert(')
    expect(script).not.toContain('.update(')
    expect(script).not.toContain('.delete(')
  })

  it('is runnable as a tsx script', () => {
    const scriptPath = path.resolve(process.cwd(), 'scripts/testing/test-server-action-import.ts')
    const script = fs.readFileSync(scriptPath, 'utf8')

    expect(script.startsWith('#!/usr/bin/env tsx')).toBe(true)
  })
})

