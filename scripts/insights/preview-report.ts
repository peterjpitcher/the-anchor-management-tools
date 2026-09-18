#!/usr/bin/env tsx
/**
 * Renders the Friday manager email to local files so it can be read, and printed, before
 * anything is sent. Nothing is ever sent and nothing is written to the database.
 *
 *   npx tsx scripts/insights/preview-report.ts                 # fixture data
 *   npx tsx scripts/insights/preview-report.ts --live          # production data, read only
 *   npx tsx scripts/insights/preview-report.ts --out <folder>  # choose the output folder
 *
 * Output goes to the system temp folder by default, never into the repository.
 *
 * --live reads production through the service role in .env.local. Every section is read
 * only (a guard test forbids writes in section code). The output contains real names and
 * figures, so keep it off shared drives and delete it after review.
 */
import dotenv from 'dotenv'
import { mkdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const live = args.includes('--live')
  const outIndex = args.indexOf('--out')
  const outDir = outIndex >= 0 && args[outIndex + 1] ? args[outIndex + 1] : path.join(os.tmpdir(), 'anchor-insights-preview')
  const { renderInsightsEmail } = await import('../../src/lib/insights/email/render')

  let report
  let appUrl: string
  if (live) {
    appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
    if (!appUrl) throw new Error('NEXT_PUBLIC_APP_URL is not set in .env.local')
    const { buildWeeklyInsights } = await import('../../src/lib/insights/registry')
    const { createAdminClient } = await import('../../src/lib/supabase/admin')
    report = await buildWeeklyInsights({ createDb: (signal) => createAdminClient({ signal }), now: new Date(), appUrl })
  } else {
    const fixture = await import('../../tests/lib/insights/helpers/report-fixture')
    appUrl = fixture.FIXTURE_APP_URL
    report = fixture.buildFixtureReport()
  }

  const email = renderInsightsEmail(report, { appUrl })
  mkdirSync(outDir, { recursive: true })
  const stem = live ? 'weekly-report-live' : 'weekly-report-fixture'
  writeFileSync(path.join(outDir, `${stem}.html`), email.html)
  writeFileSync(path.join(outDir, `${stem}.txt`), email.text)
  writeFileSync(path.join(outDir, `${stem}.json`), JSON.stringify(report, null, 2))

  const bytes = new TextEncoder().encode(email.html).byteLength
  console.warn(`Subject: ${email.subject}`)
  console.warn(`Sections: ${report.sections.map((section) => `${section.key}=${section.status}`).join(', ')}`)
  console.warn(`Not checked: ${report.notChecked.join(', ') || 'none'}`)
  console.warn(`Actions: ${report.actions.length}; exception rows shown: ${email.rowsShown}; HTML ${bytes} bytes`)
  console.warn(`Written to ${outDir}`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
