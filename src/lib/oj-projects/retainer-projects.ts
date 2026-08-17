/**
 * The single way a monthly retainer project gets created.
 *
 * Two callers need this: the retainer cron, which pre-creates the bucket at the
 * start of each month, and the entries action, which creates it on demand when
 * someone logs retainer work for a month the cron has not reached yet (logging
 * a future-dated entry does exactly that). They used to hold separate copies and
 * drifted apart, leaving three naming conventions live in production:
 *
 *   RET-BAR-2026-01     "Monthly Retainer - January 2026"     (legacy)
 *   OJP-BP-RET-202606   "Barons Pubs [dash] Retainer (Jun 2026)"  (cron)
 *   OJP-BP-54FEC        "Barons Pubs Retainer (Jul 2026)"     (entries action)
 *
 * July 2026 diverged because a July-dated entry was logged on 26 June, so the
 * entries copy won the race and the cron skipped the month.
 *
 * Server-only: it takes a Supabase client. Keep it out of `retainers.ts`, which
 * is pure and imported by client components.
 */

import { deriveClientCode } from '@/lib/oj-projects/utils'

/**
 * Both the cookie-scoped and service-role clients satisfy this. Typed
 * structurally rather than against either concrete client so the helper can be
 * shared by a server action and a cron route.
 */
type OjSupabaseClient = {
  from: (table: string) => any
}

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

/** Postgres unique violation. */
const UNIQUE_VIOLATION = '23505'

export function formatRetainerMonthLabel(periodYyyymm: string): string {
  const match = String(periodYyyymm || '').match(/^(\d{4})-(\d{2})$/)
  if (!match) return String(periodYyyymm || '')
  return `${MONTH_NAMES[Number(match[2]) - 1]} ${match[1]}`
}

export function buildRetainerProjectName(vendorName: string, periodYyyymm: string): string {
  const name = String(vendorName || '').trim() || 'Client'
  return `${name} Retainer (${formatRetainerMonthLabel(periodYyyymm)})`
}

/**
 * Deterministic, so both callers land on the same code for the same month and a
 * re-run is a no-op rather than a second project.
 */
export function buildRetainerProjectCode(clientCode: string, periodYyyymm: string): string {
  return `OJP-${clientCode}-RET-${String(periodYyyymm || '').replace('-', '')}`
}

async function resolveClientCode(
  supabase: OjSupabaseClient,
  vendorId: string
): Promise<string> {
  const { data: settings } = await supabase
    .from('oj_vendor_billing_settings')
    .select('client_code')
    .eq('vendor_id', vendorId)
    .maybeSingle()

  const configured = settings?.client_code
    ? String(settings.client_code).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10)
    : ''
  if (configured) return configured

  const { data: vendor } = await supabase
    .from('invoice_vendors')
    .select('name')
    .eq('id', vendorId)
    .maybeSingle()

  return deriveClientCode(String(vendor?.name || 'CLIENT'))
}

async function resolveVendorName(
  supabase: OjSupabaseClient,
  vendorId: string
): Promise<string> {
  const { data } = await supabase
    .from('invoice_vendors')
    .select('name')
    .eq('id', vendorId)
    .maybeSingle()
  return String(data?.name || '')
}

async function findRetainerProject(
  supabase: OjSupabaseClient,
  vendorId: string,
  periodYyyymm: string
) {
  return supabase
    .from('oj_projects')
    .select('id, project_code, status')
    .eq('vendor_id', vendorId)
    .eq('is_retainer', true)
    .eq('retainer_period_yyyymm', periodYyyymm)
    .maybeSingle()
}

export type RetainerProjectResult =
  | { projectId: string; projectCode: string; created: boolean }
  | { error: string }

/**
 * Returns the retainer project for this client and month, creating it if needed.
 *
 * `oj_projects_retainer_period_uniq` makes a concurrent create fail rather than
 * duplicate, so the unique violation is caught and turned back into a lookup.
 * Without that the loser of the race used to insert a second row, after which
 * every later `.maybeSingle()` threw and entry logging broke for the month.
 */
export async function resolveRetainerProject(
  supabase: OjSupabaseClient,
  input: {
    vendorId: string
    periodYyyymm: string
    includedHours: number
    /**
     * Optional, purely to save a query. Callers that already hold the name pass
     * it; everyone else lets the create path look it up. It is deliberately not
     * required, so the common case (the project already exists) costs exactly
     * one query and never touches invoice_vendors.
     */
    vendorName?: string
  }
): Promise<RetainerProjectResult> {
  const { vendorId, periodYyyymm, includedHours } = input

  const existing = await findRetainerProject(supabase, vendorId, periodYyyymm)
  if (existing.error) return { error: existing.error.message }
  if (existing.data?.id) {
    if (existing.data.status === 'completed' || existing.data.status === 'archived') {
      return { error: 'Cannot add entries to a closed retainer' }
    }
    return {
      projectId: String(existing.data.id),
      projectCode: String(existing.data.project_code || ''),
      created: false,
    }
  }

  const clientCode = await resolveClientCode(supabase, vendorId)
  const vendorName = input.vendorName ?? (await resolveVendorName(supabase, vendorId))
  const monthLabel = formatRetainerMonthLabel(periodYyyymm)
  const budgetHours = Number.isFinite(includedHours) && includedHours > 0 ? includedHours : null

  // project_code has its own unique constraint, and two clients can derive the
  // same short code, so step the suffix rather than reaching for randomness.
  const baseCode = buildRetainerProjectCode(clientCode, periodYyyymm)
  for (let attempt = 0; attempt < 10; attempt++) {
    const projectCode = attempt === 0 ? baseCode : `${baseCode}-${attempt + 1}`

    const { data, error } = await supabase
      .from('oj_projects')
      .insert({
        vendor_id: vendorId,
        project_code: projectCode,
        project_name: buildRetainerProjectName(vendorName, periodYyyymm),
        brief: `Monthly retainer bucket for ${monthLabel}. Log small BAU work here.`,
        internal_notes: `Auto-created by OJ Projects for the ${periodYyyymm} retainer.`,
        deadline: null,
        budget_ex_vat: null,
        budget_hours: budgetHours,
        status: 'active',
        is_retainer: true,
        retainer_period_yyyymm: periodYyyymm,
      })
      .select('id, project_code')
      .single()

    if (!error) {
      return { projectId: String(data.id), projectCode: String(data.project_code), created: true }
    }

    if (error.code !== UNIQUE_VIOLATION) return { error: error.message }

    // Lost a race on the retainer index: the winner's row is the answer.
    const winner = await findRetainerProject(supabase, vendorId, periodYyyymm)
    if (winner.error) return { error: winner.error.message }
    if (winner.data?.id) {
      if (winner.data.status === 'completed' || winner.data.status === 'archived') {
        return { error: 'Cannot add entries to a closed retainer' }
      }
      return {
        projectId: String(winner.data.id),
        projectCode: String(winner.data.project_code || ''),
        created: false,
      }
    }
    // Otherwise the clash was on project_code alone, so try the next suffix.
  }

  return { error: 'Could not allocate a unique retainer project code' }
}
