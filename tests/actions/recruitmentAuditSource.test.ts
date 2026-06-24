import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(resolve(process.cwd(), 'src/app/actions/recruitment.ts'), 'utf8')

function auditBlock(operation: string, resource: string) {
  const start = source.indexOf(`operation: '${operation}',\n      resource: '${resource}'`)
  if (start === -1) return ''
  return source.slice(start, source.indexOf("revalidatePath('/recruitment')", start))
}

describe('recruitment audit source coverage', () => {
  it('covers recruitment mutations with non-PII audit payloads', () => {
    expect(source.match(/auditRecruitmentMutation\(\{/g)?.length ?? 0).toBeGreaterThanOrEqual(25)

    const candidateAudit = auditBlock('update', 'recruitment_candidate')
    expect(candidateAudit).toContain('changed_fields')
    expect(candidateAudit).not.toContain('email: formString')
    expect(candidateAudit).not.toContain('phone: formString')

    const erasureAudit = auditBlock('erase', 'recruitment_candidate')
    expect(erasureAudit).toContain('pii_erased: true')
    expect(erasureAudit).toContain('reason_recorded')
    expect(erasureAudit).not.toContain('reason:')
  })
})
