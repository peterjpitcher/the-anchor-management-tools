import Link from 'next/link'
import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { createAdminClient } from '@/lib/supabase/admin'
import { formatErrorMessage } from '@/lib/sms-status'
import { Badge, Card, PageLayout, Section, Stat } from '@/ds'

type SmsFailureRow = {
  id: string
  created_at: string
  status: string
  twilio_status: string | null
  error_code: string | null
  error_message: string | null
  template_key: string | null
  message_sid: string
  twilio_message_sid: string | null
  customer_id: string
  private_booking_id: string | null
  table_booking_id: string | null
  event_booking_id: string | null
  to_number: string | null
  body: string
  customer:
    | {
        first_name: string | null
        last_name: string | null
      }
    | Array<{
        first_name: string | null
        last_name: string | null
      }>
    | null
}

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

const WINDOW_OPTIONS = new Set(['24h', '7d', '30d'])

function getWindowHours(windowParam: string | string[] | undefined): number {
  const value = Array.isArray(windowParam) ? windowParam[0] : windowParam
  if (value && WINDOW_OPTIONS.has(value)) {
    if (value === '7d') return 7 * 24
    if (value === '30d') return 30 * 24
  }
  return 24
}

function getWindowLabel(hours: number): string {
  if (hours === 24) return 'Last 24 hours'
  if (hours === 7 * 24) return 'Last 7 days'
  return 'Last 30 days'
}

function maskPhone(value: string | null): string {
  if (!value) return '-'
  return value.replace(/\d(?=\d{3})/g, 'x')
}

function truncate(value: string, max = 120): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  if (compact.length <= max) return compact
  return `${compact.slice(0, max - 1)}...`
}

function firstRelation<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value
}

function getCustomerName(row: SmsFailureRow): string {
  const customer = firstRelation(row.customer)
  const name = [customer?.first_name, customer?.last_name].filter(Boolean).join(' ').trim()
  return name || 'Unknown customer'
}

function getFailureCode(row: SmsFailureRow): string | null {
  return row.error_code || row.twilio_status || null
}

function getFailureMessage(row: SmsFailureRow): string {
  const code = getFailureCode(row)
  return row.error_message || formatErrorMessage(code)
}

function getSource(row: SmsFailureRow): { label: string; href?: string } {
  if (row.table_booking_id) {
    return { label: row.template_key || 'Table booking SMS', href: `/table-bookings/${row.table_booking_id}` }
  }
  if (row.event_booking_id) {
    return { label: row.template_key || 'Event booking SMS', href: '/events' }
  }
  if (row.private_booking_id) {
    return { label: row.template_key || 'Private booking SMS', href: `/private-bookings/${row.private_booking_id}` }
  }
  if (row.template_key) {
    return { label: row.template_key }
  }
  const body = row.body.toLowerCase()
  if (body.includes('thanks for popping in') && body.includes('quick review')) {
    return { label: 'Table review followup' }
  }
  if (body.includes('hope you had a belter') && body.includes('quick review')) {
    return { label: 'Event review followup' }
  }
  if (row.message_sid.startsWith('local-fail-')) {
    return { label: 'Local send attempt' }
  }
  return { label: 'SMS' }
}

export default async function SmsFailuresPage({ searchParams }: PageProps) {
  const canManage = await checkUserPermission('settings', 'manage')
  if (!canManage) {
    redirect('/unauthorized')
  }

  const resolvedSearchParams = searchParams ? await searchParams : {}
  const windowHours = getWindowHours(resolvedSearchParams.window)
  const sinceIso = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString()
  const windowLabel = getWindowLabel(windowHours)

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('messages')
    .select(`
      id,
      created_at,
      status,
      twilio_status,
      error_code,
      error_message,
      template_key,
      message_sid,
      twilio_message_sid,
      customer_id,
      private_booking_id,
      table_booking_id,
      event_booking_id,
      to_number,
      body,
      customer:customers(
        first_name,
        last_name
      )
    `)
    .eq('status', 'failed')
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false })
    .limit(200)

  const rows = (data ?? []) as SmsFailureRow[]
  const codeCounts = rows.reduce<Record<string, number>>((acc, row) => {
    const code = getFailureCode(row) ?? 'unknown'
    acc[code] = (acc[code] ?? 0) + 1
    return acc
  }, {})

  return (
    <PageLayout
      title="SMS Failures"
      subtitle={`${windowLabel} · ${rows.length} failed outbound message${rows.length === 1 ? '' : 's'}`}
      breadcrumbs={[
        { label: 'Settings', href: '/settings' },
        { label: 'SMS Failures' },
      ]}
      backButton={{ label: 'Back to Settings', href: '/settings' }}
      headerActions={
        <div className="flex flex-wrap gap-2">
          <Link href="/settings/sms-failures?window=24h" className="text-sm font-medium text-primary hover:underline">
            24h
          </Link>
          <Link href="/settings/sms-failures?window=7d" className="text-sm font-medium text-primary hover:underline">
            7d
          </Link>
          <Link href="/settings/sms-failures?window=30d" className="text-sm font-medium text-primary hover:underline">
            30d
          </Link>
        </div>
      }
    >
      <div className="space-y-6">
        {error && (
          <Card className="border-danger/30 bg-danger-soft p-4 text-sm text-danger-fg">
            Failed to load SMS failures: {error.message}
          </Card>
        )}

        <Section title="Summary">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Stat label="Failed messages" value={rows.length} color={rows.length > 0 ? 'error' : 'default'} />
            <Stat label="Most common code" value={Object.entries(codeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '--'} />
            <Stat label="Window" value={windowLabel} />
          </div>
        </Section>

        <Section title="Failure Log">
          <Card>
            {rows.length === 0 ? (
              <div className="py-10 text-center text-sm text-text-muted">No failed SMS messages found for this window.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-border text-sm">
                  <thead className="bg-surface-2 text-left text-xs font-semibold text-text-muted">
                    <tr>
                      <th className="px-4 py-3">Time</th>
                      <th className="px-4 py-3">Customer</th>
                      <th className="px-4 py-3">Source</th>
                      <th className="px-4 py-3">Error</th>
                      <th className="px-4 py-3">To</th>
                      <th className="px-4 py-3">Message</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {rows.map((row) => {
                      const source = getSource(row)
                      const code = getFailureCode(row)

                      return (
                        <tr key={row.id} className="align-top">
                          <td className="whitespace-nowrap px-4 py-3 text-text-muted">
                            {new Date(row.created_at).toLocaleString('en-GB')}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3">
                            <Link href={`/customers/${row.customer_id}`} className="font-medium text-primary hover:underline">
                              {getCustomerName(row)}
                            </Link>
                          </td>
                          <td className="px-4 py-3">
                            {source.href ? (
                              <Link href={source.href} className="text-primary hover:underline">
                                {source.label}
                              </Link>
                            ) : (
                              source.label
                            )}
                          </td>
                          <td className="min-w-[220px] px-4 py-3">
                            <div className="flex flex-wrap items-center gap-2">
                              {code && <Badge tone="danger">{code}</Badge>}
                              {row.message_sid.startsWith('local-fail-') && <Badge tone="warning">not sent</Badge>}
                            </div>
                            <div className="mt-1 text-text-muted">{getFailureMessage(row)}</div>
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-text-muted">
                            {maskPhone(row.to_number)}
                          </td>
                          <td className="max-w-md px-4 py-3 text-text-muted">{truncate(row.body)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </Section>
      </div>
    </PageLayout>
  )
}
