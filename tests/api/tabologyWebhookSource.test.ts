import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const routeSource = readFileSync(resolve(process.cwd(), 'src/app/api/webhooks/tabology/route.ts'), 'utf8')

describe('Tabology cash-up webhook source guard', () => {
  it('acknowledges cashup events without writing cashing-up sessions', () => {
    expect(routeSource).toContain("skipped: 'cashup_prefill_disabled'")
    expect(routeSource).toContain("operation_type: 'cashup.webhook_skipped'")
    expect(routeSource).not.toContain('CashingUpService.upsertSession')
    expect(routeSource).not.toContain('mapCashupRanToDto(')
    expect(routeSource).not.toContain(".from('cashup_sessions')")
  })
})
