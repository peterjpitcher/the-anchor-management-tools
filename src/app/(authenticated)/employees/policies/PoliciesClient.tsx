'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Alert, Badge, Button, Card, CardBody, CardHeader, Empty, LinkButton, PageLayout, Select, toast } from '@/ds'
import {
  sendPolicyAcknowledgements,
  type PolicyOverview,
  type PolicyStaffRow,
  type PolicyTemplateSummary,
} from '@/app/actions/signing-staff'
import { formatDateInLondon } from '@/lib/dateUtils'
import { POLICY_BATCH_SIZE } from '@/lib/signing/policy'
import { EMPLOYEES_NAV } from '../_shared/nav'
import { POLICY_STATE_LABEL, POLICY_STATE_TONE } from '../_shared/status-ui'

interface PoliciesClientProps {
  templates: PolicyTemplateSummary[]
  overview: PolicyOverview | null
  loadError: string | null
  canSend: boolean
}

function needsSending(row: PolicyStaffRow): boolean {
  return row.state === 'not_sent' || row.state === 'outdated' || row.state === 'declined'
}

/**
 * Who has confirmed each staff policy, and who has not. A policy is sent to read and confirm
 * through the shared signing feature; this page is the roll call.
 */
export default function PoliciesClient({ templates, overview, loadError, canSend }: PoliciesClientProps): React.JSX.Element {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [progress, setProgress] = useState<string | null>(null)

  const outstanding = overview ? overview.staff.filter(needsSending) : []
  const confirmed = overview ? overview.staff.filter((row) => row.state === 'confirmed').length : 0

  const send = (rows: PolicyStaffRow[]): void => {
    if (!overview || rows.length === 0) return
    startTransition(async () => {
      let sent = 0
      const failed: string[] = []
      for (let start = 0; start < rows.length; start += POLICY_BATCH_SIZE) {
        const batch = rows.slice(start, start + POLICY_BATCH_SIZE)
        setProgress(`Sending ${Math.min(start + batch.length, rows.length)} of ${rows.length}`)
        const result = await sendPolicyAcknowledgements({ slug: overview.slug, employeeIds: batch.map((row) => row.employeeId) })
        if (result.error || !result.data) {
          // An error here stops everyone (the template is off, or permissions): say so once.
          toast.error(result.error ?? 'Could not send the policy.')
          setProgress(null)
          router.refresh()
          return
        }
        sent += result.data.sent
        failed.push(...result.data.failed.map((failure) => `${failure.name}: ${failure.reason}`))
      }
      setProgress(null)
      if (failed.length > 0) {
        toast.error(`Sent to ${sent}. Not sent to ${failed.length}: ${failed.slice(0, 3).join('; ')}${failed.length > 3 ? ' ...' : ''}`)
      } else {
        toast.success(`Sent to ${sent} ${sent === 1 ? 'person' : 'people'}.`)
      }
      router.refresh()
    })
  }

  return (
    <PageLayout title="Employees" subtitle="Policies staff have read and confirmed" navItems={EMPLOYEES_NAV}>
      <div className="space-y-6">
        {loadError ? <Alert tone="danger" title="The policies could not be loaded">{loadError}</Alert> : null}

        {templates.length === 0 && !loadError ? (
          <Empty title="No policies yet" description="Policies are added in Settings, Signing templates." />
        ) : null}

        {overview ? (
          <>
            <Card>
              <CardHeader
                title={overview.title}
                subtitle={`Version ${overview.version}. ${confirmed} of ${overview.staff.length} active staff have confirmed it`}
                action={
                  canSend && overview.isActive && outstanding.length > 0 ? (
                    <Button size="sm" variant="primary" loading={pending} onClick={() => send(outstanding)}>
                      {progress ?? `Send to the ${outstanding.length} who have not confirmed`}
                    </Button>
                  ) : undefined
                }
              />
              <CardBody>
                <div className="space-y-4">
                  {templates.length > 1 ? (
                    <Select
                      label="Policy"
                      value={overview.slug}
                      options={templates.map((template) => ({ value: template.slug, label: template.title }))}
                      onChange={(event) => router.push(`/employees/policies?policy=${event.target.value}`)}
                    />
                  ) : null}
                  {!overview.isActive ? (
                    <Alert
                      tone="warning"
                      title="This policy is switched off"
                      actions={<LinkButton href="/settings/signing-templates" size="sm" variant="secondary">Open signing templates</LinkButton>}
                    >
                      It cannot be sent until its wording has been checked and it is switched on.
                    </Alert>
                  ) : null}
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Staff" />
              <CardBody>
                {overview.staff.length === 0 ? (
                  <Empty title="No active staff" />
                ) : (
                  <ul className="divide-y divide-border">
                    {overview.staff.map((row) => (
                      <li key={row.employeeId} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                        <div className="min-w-0">
                          <LinkButton href={`/employees/${row.employeeId}`} variant="ghost" size="sm">
                            {row.name}
                          </LinkButton>
                          <p className="px-2 text-xs text-text-muted">
                            {row.state === 'confirmed' && row.at
                              ? `Confirmed ${formatDateInLondon(row.at, { day: 'numeric', month: 'short', year: 'numeric' })}`
                              : row.state === 'waiting' && row.at
                                ? `Sent ${formatDateInLondon(row.at, { day: 'numeric', month: 'short', year: 'numeric' })}`
                                : row.state === 'outdated'
                                  ? `Confirmed version ${row.confirmedVersion}, not this one`
                                  : row.email
                                    ? row.email
                                    : 'No email address: sign in person'}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone={POLICY_STATE_TONE[row.state]}>{POLICY_STATE_LABEL[row.state]}</Badge>
                          {canSend && overview.isActive && row.state !== 'confirmed' ? (
                            <Button size="sm" variant="secondary" disabled={pending} onClick={() => send([row])}>
                              {row.state === 'waiting' ? 'Send again' : 'Send'}
                            </Button>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          </>
        ) : null}
      </div>
    </PageLayout>
  )
}
