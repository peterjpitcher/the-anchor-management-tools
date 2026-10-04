/**
 * The record that says whether a month's Orange Jelly billing pass has finished.
 *
 * One `cron_job_runs` row per billed month: job_name `oj-projects-billing-pass`, run_key the
 * billed month ('2026-10' for the pass that runs in early November 2026), the same value as
 * `oj_billing_runs.period_yyyymm`. Its status is the whole state:
 *
 *   running    the pass has started and has not been seen to finish
 *   completed  the per-client loop reached the end and no client was left in flight
 *   failed     the pass was still unfinished on the 8th, was given up on, and the alert went
 *
 * The rules that read this live in billing-pass.ts. Only a scheduled, real, every-client run
 * of the billing cron writes it: a dry run, a preview, a forced run or a single-client run
 * never creates or changes it.
 */
import type { createAdminClient } from '@/lib/supabase/admin'
import { reportCronFailure } from '@/lib/cron/alerting'
import { formatInvoiceMonth } from '@/lib/invoices/email-copy'
import { BILLING_PASS_JOB_NAME, BILLING_PASS_LAST_DAY } from './billing-pass'

type AdminClient = ReturnType<typeof createAdminClient>

export interface BillingPassRecord {
  id: string
  status: string
}

type DbError = { code?: string; message?: string } | null

/** Throws when the record cannot be read: the caller must not bill on a guess. */
export async function loadBillingPassRecord(
  supabase: AdminClient,
  billedMonth: string
): Promise<BillingPassRecord | null> {
  const { data, error } = await supabase
    .from('cron_job_runs')
    .select('id, status')
    .eq('job_name', BILLING_PASS_JOB_NAME)
    .eq('run_key', billedMonth)
    .maybeSingle()

  if (error) throw new Error(error.message || 'Failed to read the billing pass record')
  return data ? { id: String(data.id), status: String(data.status) } : null
}

/** Records that the pass for `billedMonth` has started. Called once, when there is no record. */
export async function startBillingPass(supabase: AdminClient, billedMonth: string): Promise<void> {
  const { error } = await supabase.from('cron_job_runs').insert({
    job_name: BILLING_PASS_JOB_NAME,
    run_key: billedMonth,
    status: 'running',
    started_at: new Date().toISOString(),
  })

  // 23505: a second invocation started the same pass a moment ago (a cron double-fire). The
  // record exists, which is all this needs; the two runs are kept apart client by client by
  // the billing route's own one-run-per-client guard.
  const dbError = error as DbError
  if (dbError && dbError.code !== '23505') {
    throw new Error(dbError.message || 'Failed to record the start of the billing pass')
  }
}

/**
 * Called when the per-client loop has reached the end. Marks the pass completed, unless a
 * client's billing run for the month is still 'processing': that client was skipped because
 * another invocation had it in flight, or its run died moments ago. Either way the pass is not
 * finished, so the record stays 'running' and the next weekday's run picks that client up.
 */
export async function finishBillingPass(
  supabase: AdminClient,
  billedMonth: string
): Promise<'completed' | 'still_running'> {
  const { data: inFlight, error: inFlightError } = await supabase
    .from('oj_billing_runs')
    .select('id')
    .eq('period_yyyymm', billedMonth)
    .eq('status', 'processing')
    .limit(1)

  if (inFlightError) throw new Error(inFlightError.message || 'Failed to check for unfinished billing runs')
  if ((inFlight ?? []).length > 0) return 'still_running'

  const { data, error } = await supabase
    .from('cron_job_runs')
    .update({ status: 'completed', finished_at: new Date().toISOString(), error_message: null })
    .eq('job_name', BILLING_PASS_JOB_NAME)
    .eq('run_key', billedMonth)
    .select('id')
    .maybeSingle()

  if (error) throw new Error(error.message || 'Failed to mark the billing pass completed')
  if (!data) throw new Error(`Billing pass record for ${billedMonth} not found while marking it completed`)
  return 'completed'
}

/** 'October 2026' for '2026-10'. */
function billedMonthLabel(billedMonth: string): string {
  return `${formatInvoiceMonth(`${billedMonth}-01`)} ${billedMonth.slice(0, 4)}`
}

/**
 * Gives up on a pass that is still unfinished on the 8th: alerts once, naming the clients who
 * were not billed, then marks the record 'failed' so the alert is not raised again every
 * weekday for the rest of the month. Bills nothing.
 *
 * Never throws. If the clients cannot be listed the alert still goes, saying so. If the record
 * cannot be marked, the alert repeats on the next weekday: twice is better than a month's
 * billing given up on in silence.
 */
export async function reportUnfinishedBillingPass(
  supabase: AdminClient,
  input: {
    billedMonth: string
    record: BillingPassRecord | null
    /** Every client the pass would have billed, from the cron's own candidate queries. */
    candidateVendorIds: string[]
  }
): Promise<{ no_billing_run: string[]; unfinished_run: string[] }> {
  const { billedMonth, record, candidateVendorIds } = input
  const month = billedMonthLabel(billedMonth)
  const noRun: string[] = []
  const unfinishedRun: string[] = []
  let listProblem: string | null = null

  try {
    const { data: runs, error: runsError } = await supabase
      .from('oj_billing_runs')
      .select('vendor_id, status')
      .eq('period_yyyymm', billedMonth)
      .limit(1000)
    if (runsError) throw new Error(runsError.message)

    const runStatusByVendor = new Map<string, string>()
    for (const run of runs ?? []) runStatusByVendor.set(String(run.vendor_id), String(run.status))
    // A 'sent' run is a client the pass finished with (billed, or nothing to bill).
    const unbilledIds = candidateVendorIds.filter((vendorId) => runStatusByVendor.get(vendorId) !== 'sent')

    const nameById = new Map<string, string>()
    if (unbilledIds.length > 0) {
      const { data: vendors, error: vendorsError } = await supabase
        .from('invoice_vendors')
        .select('id, name')
        .in('id', unbilledIds)
        .limit(1000)
      if (vendorsError) throw new Error(vendorsError.message)
      for (const vendor of vendors ?? []) nameById.set(String(vendor.id), String(vendor.name || ''))
    }

    for (const vendorId of unbilledIds) {
      const name = nameById.get(vendorId) || vendorId
      const status = runStatusByVendor.get(vendorId)
      if (status) unfinishedRun.push(`${name} (${status})`)
      else noRun.push(name)
    }
  } catch (listError) {
    listProblem = listError instanceof Error ? listError.message : 'unknown error'
    console.error('[oj-billing] Could not list the clients left unbilled by the unfinished pass:', listError)
  }

  const summary =
    `The Orange Jelly billing pass for ${month} did not finish in the first ${BILLING_PASS_LAST_DAY} days of the month. ` +
    `Nothing more will be billed for ${month} automatically.`
  console.error(`[oj-billing] ${summary}`, { no_billing_run: noRun, unfinished_run: unfinishedRun })

  const listOrNone = (names: string[]) =>
    listProblem ? 'Could not be listed, check the billing runs table' : names.length > 0 ? names.join(', ') : 'None'

  await reportCronFailure('oj-projects-billing', new Error(summary), {
    billed_month: month,
    clients_with_no_billing_run: listOrNone(noRun),
    clients_with_an_unfinished_run: listOrNone(unfinishedRun),
    what_to_do:
      'Their unbilled work goes on next month\'s invoice unless the billing job is run by hand with force=true. Check the Vercel logs for /api/cron/oj-projects-billing to see why the pass kept stopping.',
  })

  const nowIso = new Date().toISOString()
  const abandoned = {
    status: 'failed',
    finished_at: nowIso,
    error_message: `Not finished by day ${BILLING_PASS_LAST_DAY}. Given up and alerted at ${nowIso}.`,
  }
  try {
    const { error } = record
      ? await supabase.from('cron_job_runs').update(abandoned).eq('id', record.id)
      : await supabase.from('cron_job_runs').insert({
          job_name: BILLING_PASS_JOB_NAME,
          run_key: billedMonth,
          started_at: nowIso,
          ...abandoned,
        })
    if (error) throw new Error((error as DbError)?.message || 'write refused')
  } catch (markError) {
    console.error('[oj-billing] Could not record that the unfinished-pass alert was raised; it will repeat:', markError)
  }

  return { no_billing_run: noRun, unfinished_run: unfinishedRun }
}
