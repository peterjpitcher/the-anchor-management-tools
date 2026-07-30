import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildVoucherBatchHtml } from '../../src/lib/voucher-card-template'
import { generatePDFFromHTML } from '../../src/lib/pdf-generator'

type SeedType = { id: string } & Record<string, unknown>
type Seed = {
  terms_version: string
  types: SeedType[]
  clauses: Array<{ heading: string; body: string }>
}

async function main(): Promise<void> {
  const seed = JSON.parse(
    readFileSync(join(__dirname, 'seed-data.json'), 'utf8')
  ) as Seed

  const typeDefinitions: Record<string, unknown> = {}
  for (const type of seed.types) {
    typeDefinitions[type.id] = type
  }

  const sizes = [1, 25, 50, 100]
  const lines: string[] = [
    '# Voucher batch render benchmark (F22)',
    '',
    `Date: ${new Date().toISOString()}`,
    `Machine: local dev (${process.platform} ${process.arch}, Node ${process.version})`,
    '',
    '| Cards | PDF pages | Render ms | PDF bytes |',
    '|---|---|---|---|'
  ]

  for (const size of sizes) {
    const vouchers = Array.from({ length: size }, (_, index) => ({
      voucherNumber: `AN-2607-${String(index + 1).padStart(4, '0')}`,
      typeId: seed.types[index % seed.types.length].id
    }))
    const html = buildVoucherBatchHtml({
      vouchers,
      typeDefinitions,
      termsVersion: seed.terms_version,
      termsClauses: seed.clauses
    })
    const started = Date.now()
    const pdf = await generatePDFFromHTML(html, {
      format: 'A4',
      landscape: true,
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' }
    })
    const elapsed = Date.now() - started
    lines.push(`| ${size} | ${size * 2} | ${elapsed} | ${pdf.length} |`)
    console.warn(`rendered ${size} cards in ${elapsed}ms (${pdf.length} bytes)`)
  }

  lines.push(
    '',
    'Serverless note: local timings exclude cold-start Chromium launch (~2-4s on Vercel).',
    'Cap of 100 cards per batch retained; route maxDuration is 300s.'
  )
  writeFileSync(join(__dirname, '../../tasks/voucher-system-benchmark.md'), `${lines.join('\n')}\n`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
