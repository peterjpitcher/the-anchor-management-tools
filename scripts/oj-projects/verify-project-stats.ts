#!/usr/bin/env tsx
/**
 * OJ project + stats diagnostic (read-only).
 *
 * Safety:
 * - Strictly read-only; does not support `--confirm`.
 * - Fails closed on env/query errors (non-zero exit).
 */

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertScriptQuerySucceeded } from '@/lib/script-mutation-safety'

const SCRIPT_NAME = 'oj-verify-project-stats'

type Args = {
  confirm: boolean
}

function parseArgs(argv: string[] = process.argv): Args {
  const rest = argv.slice(2)
  return { confirm: rest.includes('--confirm') }
}

async function main() {
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

  const args = parseArgs(process.argv)
  if (args.confirm) {
    throw new Error(`[${SCRIPT_NAME}] This script is strictly read-only and does not support --confirm`)
  }

  const supabase = createAdminClient()
  console.log(`[${SCRIPT_NAME}] read-only starting`)

  const { data: projects, error: projectsError } = await supabase
    .from('oj_projects')
    .select(
      `
        *,
        vendor:invoice_vendors(id, name)
      `
    )
    .order('created_at', { ascending: false })

  const projectRows =
    assertScriptQuerySucceeded({
      operation: 'Load projects',
      data: projects,
      error: projectsError,
    }) ?? []

  if (projectRows.length === 0) {
    console.log(`[${SCRIPT_NAME}] No projects found.`)
    return
  }

  const projectIds = projectRows.map((project) => (project as { id?: unknown }).id).filter((id): id is string => typeof id === 'string')

  const statsMap = new Map<string, unknown>()
  if (projectIds.length > 0) {
    const { data: stats, error: statsError } = await supabase.from('oj_project_stats').select('*').in('project_id', projectIds)

    const statRows =
      assertScriptQuerySucceeded({
        operation: 'Load project stats',
        data: stats,
        error: statsError,
      }) ?? []

    for (const stat of statRows) {
      const projectId = (stat as { project_id?: unknown }).project_id
      if (typeof projectId === 'string') {
        statsMap.set(projectId, stat)
      }
    }
  }

  console.log('[oj-verify-project-stats] Project Stats Verification (first 10):')
  for (const project of projectRows.slice(0, 10)) {
    const id = (project as { id?: unknown }).id
    const name = (project as { project_name?: unknown }).project_name
    const budgetHours = (project as { budget_hours?: unknown }).budget_hours
    const budgetCash = (project as { budget_ex_vat?: unknown }).budget_ex_vat
    const stats = typeof id === 'string' ? (statsMap.get(id) as { total_hours_used?: unknown; total_spend_ex_vat?: unknown } | undefined) : undefined

    const usedHours = Number(stats?.total_hours_used ?? 0)
    const usedCash = Number(stats?.total_spend_ex_vat ?? 0)
    console.log(
      `[${String(name ?? id ?? 'unknown')}] Hours: ${usedHours.toFixed(2)} / ${String(budgetHours ?? '')}, Spend: ${usedCash.toFixed(2)} / ${String(budgetCash ?? '')}`
    )
  }
}

main().catch((error) => {
  console.error(`[${SCRIPT_NAME}] Failed`, error)
  process.exitCode = 1
})
