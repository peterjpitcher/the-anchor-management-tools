import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { renderShellHead } from '../blocks/shell'
import { voucherCard, type VoucherCardData } from '../blocks/voucher_card'
import { VOUCHER_SHELL_RULES } from './voucherShellRules'

/**
 * The registry-driven fidelity suite checks one sample per block, which for the voucher card
 * is the 10%, named, standard variant. The designer drew four more, and each one moves a
 * different row: the 25% card changes copy only, the expiring card recolours the date band,
 * the no-name card drops a row and moves its padding onto the headline, and the logo card adds
 * a row and tightens the kicker. Every one gets its own byte-for-byte comparison here.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_DIR = path.join(HERE, '..', 'blocks', '__fixtures__')

function fixture(name: string): string {
  return readFileSync(path.join(FIXTURE_DIR, name), 'utf8')
}

function render(overrides: Partial<VoucherCardData>): string {
  return voucherCard.render(voucherCard.schema.parse({ ...voucherCard.sample, ...overrides }))
}

const TWENTY_FIVE_CONDITIONS = [
  '25% off food for the booked table, in one visit.',
  ...voucherCard.sample.conditions.slice(1),
]

describe('the voucher card variants', () => {
  it.each([
    ['lib_voucher_card_25.html', { headline: '25% off your food', conditions: TWENTY_FIVE_CONDITIONS }],
    ['lib_voucher_card_expiring.html', { expiring: true }],
    ['lib_voucher_card_no_name.html', { first_name: '' }],
    ['lib_voucher_card_logo.html', { show_logo: true }],
  ] as const)('reproduces %s byte for byte', (file, overrides) => {
    expect(render(overrides)).toBe(fixture(file))
  })

  it('treats a name of only spaces as no name, so nobody is greeted "For  ’s table"', () => {
    expect(render({ first_name: '   ' })).toBe(fixture('lib_voucher_card_no_name.html'))
  })

  it('escapes the name, which comes from a customer record anyone can type into', () => {
    const html = render({ first_name: 'Jo <b>&' })
    expect(html).toContain('For Jo &lt;b&gt;&amp;&rsquo;s table')
    expect(html).not.toContain('<b>')
  })

  it('refuses fewer than six conditions, because CAP Code 8.17 wants them all in the email', () => {
    const parsed = voucherCard.schema.safeParse({
      ...voucherCard.sample,
      conditions: voucherCard.sample.conditions.slice(0, 5),
    })
    expect(parsed.success).toBe(false)
  })

  it('carries the number, the closing date and every condition in the plain-text part', () => {
    const text = voucherCard.text(voucherCard.schema.parse({ ...voucherCard.sample, expiring: true }))
    expect(text).toContain('Voucher number: AN-2611-0042')
    expect(text).toContain('Expiring soon. Valid until Thursday 11 December 2026')
    for (const condition of voucherCard.sample.conditions) {
      expect(text).toContain(condition)
    }
  })
})

describe('the voucher card phone rules', () => {
  it('are in the shell, so the classes on the number and date cells do something', () => {
    const head = renderShellHead({ title: 'x', preheader: 'y' })
    expect(head).toContain(VOUCHER_SHELL_RULES)
    expect(voucherCard.render(voucherCard.sample)).toContain('class="vc-num"')
    expect(voucherCard.render(voucherCard.sample)).toContain('class="vc-date"')
  })

  it('match the voucher handover file exactly', () => {
    const handover = readFileSync(
      path.join(HERE, '..', '..', '..', '..', '..', 'docs/design/email-handover/anchor-email-blocks-voucher.html'),
      'utf8',
    )
    expect(handover).toContain(VOUCHER_SHELL_RULES)
  })
})
