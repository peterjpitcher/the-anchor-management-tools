import Link from 'next/link'
import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { createAdminClient } from '@/lib/supabase/admin'
import { formatErrorMessage } from '@/lib/sms-status'
import {
  Alert,
  Badge,
  Button,
  Card,
  Empty,
  PageLayout,
  Section,
  Stat,
  StatGrid,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/ds'
import { loadUndeliveredGuestMessages } from '@/lib/notifications/undelivered'
import { SMS_FAILURE_TONES } from '../_shared/status-ui'
import { dismissSmsFailureFromForm, retrySmsFailureFromForm } from './actions'
import { UndeliveredGuestMessagesSection } from './UndeliveredGuestMessagesSection'
import { WindowSwitch } from './WindowSwitch'

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
  const undelivered = await loadUndeliveredGuestMessages({ sinceIso })
  const codeCounts = rows.reduce<Record<string, number>>((acc, row) => {
    const code = getFailureCode(row) ?? 'unknown'
    acc[code] = (acc[code] ?? 0) + 1
    return acc
  }, {})

  const windowId = windowHours === 7 * 24 ? '7d' : windowHours === 30 * 24 ? '30d' : '24h'

  return (
    <PageLayout
      title="SMS Failures"
      subtitle={`${windowLabel} · ${rows.length} failed outbound message${rows.length === 1 ? '' : 's'}`}
      backButton={{ label: 'Back to Settings', href: '/settings' }}
      headerActions={<WindowSwitch value={windowId} />}
    >
      {error ? (
        <Alert tone="danger">
          Failed to load SMS failures: {error.message}
        </Alert>
      ) : (
        <StatGrid columns={3}>
          <Stat label="Failed messages" value={rows.length} />
          <Stat label="Most common code" value={Object.entries(codeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '--'} />
          <Stat label="Window" value={windowLabel} />
        </StatGrid>
      )}

      <UndeliveredGuestMessagesSection rows={undelivered.rows} error={undelivered.error} />

      <Section title="Failure Log">
        <Card padding="none">
          {rows.length === 0 ? (
            // A failed load is reported above, never shown as an empty log.
            error ? null : <Empty size="sm" title="No failed SMS messages found for this window" />
          ) : (
            <>
              {/* Mobile: one row per failed message */}
              <ul className="divide-y divide-border md:hidden">
                {rows.map((row) => {
                  const source = getSource(row)
                  const code = getFailureCode(row)

                  return (
                    <li key={row.id} className="px-pad-card py-4">
                      <div className="flex items-start justify-between gap-2">
                        <Link href={`/customers/${row.customer_id}`} className="font-medium text-primary hover:underline">
                          {getCustomerName(row)}
                        </Link>
                        <span className="shrink-0 text-xs text-text-muted">
                          {new Date(row.created_at).toLocaleString('en-GB')}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {code && <Badge tone={SMS_FAILURE_TONES.errorCode}>{code}</Badge>}
                        {row.message_sid.startsWith('local-fail-') && <Badge tone={SMS_FAILURE_TONES.notSent}>not sent</Badge>}
                      </div>
                      <p className="mt-2 text-sm text-text-muted">{getFailureMessage(row)}</p>
                      <dl className="mt-3 space-y-1.5 text-sm">
                        <div className="flex justify-between gap-3">
                          <dt className="text-text-muted">Source</dt>
                          <dd className="text-right">
                            {source.href ? (
                              <Link href={source.href} className="text-primary hover:underline">
                                {source.label}
                              </Link>
                            ) : (
                              source.label
                            )}
                          </dd>
                        </div>
                        <div className="flex justify-between gap-3">
                          <dt className="text-text-muted">To</dt>
                          <dd className="font-mono text-xs text-text-muted">{maskPhone(row.to_number)}</dd>
                        </div>
                        <div>
                          <dt className="text-text-muted">Message</dt>
                          <dd className="mt-1 text-text-muted">{truncate(row.body)}</dd>
                        </div>
                      </dl>
                      <div className="mt-3 flex gap-2">
                        <form action={retrySmsFailureFromForm} className="flex-1">
                          <input type="hidden" name="message_id" value={row.id} />
                          <Button type="submit" size="sm" variant="secondary" fullWidth>
                            Retry
                          </Button>
                        </form>
                        <form action={dismissSmsFailureFromForm} className="flex-1">
                          <input type="hidden" name="message_id" value={row.id} />
                          <Button type="submit" size="sm" variant="ghost" fullWidth>
                            Dismiss
                          </Button>
                        </form>
                      </div>
                    </li>
                  )
                })}
              </ul>

              {/* Desktop: full table */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Error</TableHead>
                      <TableHead>To</TableHead>
                      <TableHead>Message</TableHead>
                      <TableHead align="right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => {
                      const source = getSource(row)
                      const code = getFailureCode(row)

                      return (
                        <TableRow key={row.id} className="align-top">
                          <TableCell className="text-text-muted">
                            {new Date(row.created_at).toLocaleString('en-GB')}
                          </TableCell>
                          <TableCell>
                            <Link href={`/customers/${row.customer_id}`} className="font-medium text-primary hover:underline">
                              {getCustomerName(row)}
                            </Link>
                          </TableCell>
                          <TableCell className="whitespace-normal">
                            {source.href ? (
                              <Link href={source.href} className="text-primary hover:underline">
                                {source.label}
                              </Link>
                            ) : (
                              source.label
                            )}
                          </TableCell>
                          <TableCell className="min-w-[220px] whitespace-normal">
                            <div className="flex flex-wrap items-center gap-2">
                              {code && <Badge tone={SMS_FAILURE_TONES.errorCode}>{code}</Badge>}
                              {row.message_sid.startsWith('local-fail-') && <Badge tone={SMS_FAILURE_TONES.notSent}>not sent</Badge>}
                            </div>
                            <div className="mt-1 text-text-muted">{getFailureMessage(row)}</div>
                          </TableCell>
                          <TableCell className="font-mono text-xs text-text-muted">
                            {maskPhone(row.to_number)}
                          </TableCell>
                          <TableCell className="max-w-md whitespace-normal text-text-muted">{truncate(row.body)}</TableCell>
                          <TableCell>
                            <div className="flex justify-end gap-2">
                              <form action={retrySmsFailureFromForm}>
                                <input type="hidden" name="message_id" value={row.id} />
                                <Button type="submit" size="xs" variant="secondary">
                                  Retry
                                </Button>
                              </form>
                              <form action={dismissSmsFailureFromForm}>
                                <input type="hidden" name="message_id" value={row.id} />
                                <Button type="submit" size="xs" variant="ghost">
                                  Dismiss
                                </Button>
                              </form>
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </Card>
      </Section>
    </PageLayout>
  )
}
