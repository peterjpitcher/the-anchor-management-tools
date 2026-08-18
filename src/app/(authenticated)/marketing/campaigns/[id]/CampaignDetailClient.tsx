'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  Empty,
  Input,
  Modal,
  PageLayout,
  Stat,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TablePagination,
  TableRow,
  toast,
} from '@/ds'
import {
  cancelMarketingCampaign,
  pauseMarketingCampaign,
  resumeMarketingCampaign,
  scheduleMarketingCampaign,
  sendMarketingTestEmail,
} from '@/app/actions/marketing-campaigns'
import { londonLocalInputToUtcIso, utcIsoToLondonLocalInput } from '@/lib/dateUtils'
import type { CampaignAudienceDrift } from '@/services/marketing-campaigns'
import type {
  MarketingCampaign,
  MarketingCampaignLinkPerformance,
  MarketingCampaignRecipientWithEngagement,
  MarketingCampaignStats,
} from '@/types/marketing'

import {
  CampaignStatusBadge,
  MARKETING_SECTION_NAV,
  RecipientStatusBadge,
  SKIP_REASON_LABELS,
  formatDateTimeInLondon,
  formatGbp,
  formatPercent,
  skipReasonLabel,
} from '../../_shared/marketing-ui'

/**
 * `skippedByReason` is keyed by whatever string the database held, including the literal
 * 'unknown' the stats query substitutes for a null reason, so it is looked up by string
 * rather than cast to the union.
 */
function skipReasonText(reason: string): string {
  return SKIP_REASON_LABELS[reason as keyof typeof SKIP_REASON_LABELS] ?? reason.replace(/_/g, ' ')
}

interface CampaignDetailClientProps {
  campaign: MarketingCampaign
  /** Present only while scheduled: how far the live audience has moved since approval. */
  audienceDrift: CampaignAudienceDrift | null
  stats: MarketingCampaignStats | null
  statsError: string | null
  recipients: MarketingCampaignRecipientWithEngagement[]
  recipientsTotal: number
  recipientsPage: number
  recipientsPageSize: number
  recipientsError: string | null
  linkPerformance: MarketingCampaignLinkPerformance[]
  linkPerformanceError: string | null
  previewHtml: string | null
  previewError: string | null
  canSend: boolean
}

/** A share of a total, or nothing at all when there is no total to divide by. */
function shareOf(count: number, total: number): string | undefined {
  if (total <= 0) return undefined
  return formatPercent(count / total)
}

export function CampaignDetailClient({
  campaign,
  audienceDrift,
  stats,
  statsError,
  recipients,
  recipientsTotal,
  recipientsPage,
  recipientsPageSize,
  recipientsError,
  linkPerformance,
  linkPerformanceError,
  previewHtml,
  previewError,
  canSend,
}: CampaignDetailClientProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [busy, setBusy] = useState(false)

  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [testSendOpen, setTestSendOpen] = useState(false)
  const [scheduledLocal, setScheduledLocal] = useState(
    campaign.scheduledFor ? utcIsoToLondonLocalInput(campaign.scheduledFor) : '',
  )

  const { status } = campaign
  const canSchedule = canSend && status === 'draft'
  const canPause = canSend && (status === 'sending' || status === 'scheduled')
  const canResume = canSend && status === 'paused'
  const canCancel =
    canSend && (status === 'draft' || status === 'scheduled' || status === 'sending' || status === 'paused')

  const totalPages = Math.max(1, Math.ceil(recipientsTotal / recipientsPageSize))

  function refresh() {
    startTransition(() => {
      router.refresh()
    })
  }

  /** Returns whether the action succeeded, so a caller can keep a dialog open on failure. */
  async function runAction(
    label: string,
    action: () => Promise<{ success?: boolean; error?: string }>,
  ): Promise<boolean> {
    setBusy(true)
    const result = await action()
    setBusy(false)

    if (result.error) {
      toast.error(result.error)
      return false
    }
    toast.success(label)
    refresh()
    return true
  }

  async function handleSchedule() {
    if (!scheduledLocal) {
      toast.error('Pick a date and time first.')
      return
    }
    const scheduledFor = londonLocalInputToUtcIso(scheduledLocal)
    if (!scheduledFor) {
      toast.error('That send time is not a valid date.')
      return
    }

    setScheduleOpen(false)
    await runAction('Campaign scheduled.', () =>
      scheduleMarketingCampaign(campaign.id, { scheduledFor }),
    )
  }

  return (
    <PageLayout
      title={campaign.name}
      subtitle={campaign.subject}
      navItems={MARKETING_SECTION_NAV}
      backButton={{ label: 'Campaigns', href: '/marketing' }}
      headerActions={
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setTestSendOpen(true)}
            disabled={!canSend || busy}
          >
            Test send
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setScheduleOpen(true)}
            disabled={!canSchedule || busy}
          >
            Schedule
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => runAction('Campaign paused.', () => pauseMarketingCampaign(campaign.id))}
            disabled={!canPause || busy}
          >
            Pause
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              runAction('Campaign resumed.', () => resumeMarketingCampaign(campaign.id))
            }
            disabled={!canResume || busy}
          >
            Resume
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() => setCancelOpen(true)}
            disabled={!canCancel || busy}
          >
            Cancel
          </Button>
        </div>
      }
      showHeaderActionsOnMobile
    >
      <div className="space-y-6">
        <Card>
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <CampaignStatusBadge status={status} />
                {campaign.audience.includeTags.map((tag) => (
                  <Badge key={`in-${tag}`} tone="info">
                    {tag}
                  </Badge>
                ))}
                {campaign.audience.excludeTags.map((tag) => (
                  <Badge key={`out-${tag}`} tone="neutral">
                    not {tag}
                  </Badge>
                ))}
              </div>
              <p className="text-sm text-text-muted break-words">{campaign.preheader}</p>
            </div>
            <dl className="shrink-0 space-y-1 text-sm">
              <div className="flex gap-2">
                <dt className="text-text-muted">Scheduled</dt>
                <dd className="text-text">
                  {campaign.scheduledFor
                    ? formatDateTimeInLondon(campaign.scheduledFor)
                    : 'Not scheduled'}
                </dd>
              </div>
              {campaign.startedAt && (
                <div className="flex gap-2">
                  <dt className="text-text-muted">Started</dt>
                  <dd className="text-text">{formatDateTimeInLondon(campaign.startedAt)}</dd>
                </div>
              )}
              {campaign.completedAt && (
                <div className="flex gap-2">
                  <dt className="text-text-muted">Finished</dt>
                  <dd className="text-text">{formatDateTimeInLondon(campaign.completedAt)}</dd>
                </div>
              )}
              {campaign.approvedRecipientCount !== null && (
                <div className="flex gap-2">
                  <dt className="text-text-muted">Approved for</dt>
                  <dd className="text-text">{campaign.approvedRecipientCount} contacts</dd>
                </div>
              )}
              {audienceDrift && audienceDrift.delta !== 0 && (
                <div className="flex gap-2">
                  <dt className="text-text-muted">Will actually send to</dt>
                  <dd className="text-warning-fg font-medium">
                    {audienceDrift.live} contacts
                    <span className="text-text-muted font-normal">
                      {' '}
                      ({audienceDrift.delta > 0 ? '+' : ''}
                      {audienceDrift.delta} since approval)
                    </span>
                  </dd>
                </div>
              )}
            </dl>
          </div>
        </Card>

        {!canSend && (
          <Alert tone="info" title="You can view this campaign but not send it">
            Scheduling, pausing and cancelling need the marketing send permission.
          </Alert>
        )}

        {statsError && (
          <Alert tone="warning" title="Could not load the results">
            {statsError}
          </Alert>
        )}

        {stats && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            <Stat label="Recipients" value={stats.recipients} />
            <Stat label="Sent" value={stats.sent} />
            <Stat
              label="Delivered"
              value={stats.delivered}
              hint={formatPercent(stats.rates.deliveredRate)}
            />
            <Stat
              label="Opened"
              value={stats.opened}
              hint={`${formatPercent(stats.rates.openRate)} approximate, mail apps can prefetch images`}
            />
            <Stat
              label="Clicked"
              value={stats.clicked}
              hint={`${formatPercent(stats.rates.clickRate)} after automated scans are removed`}
            />
            <Stat
              label="Unsubscribed"
              value={stats.unsubscribed}
              hint={formatPercent(stats.rates.unsubscribeRate)}
            />
            <Stat label="Failed" value={stats.failed} />
            <Stat label="Needs review" value={stats.needsReview} />
          </div>
        )}

        {stats && (
          <Card>
            <CardHeader
              title="Engagement"
              subtitle="Counted through our own short links and our own booking records, so these say which call to action worked and whether it turned into business"
            />
            <CardBody>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
                <Stat
                  label="Link visits"
                  value={stats.engagement.clicks}
                  hint="Cleaned visits across every campaign link"
                />
                <Stat
                  label="People who clicked"
                  value={stats.engagement.uniqueClickers}
                  hint={
                    shareOf(stats.engagement.uniqueClickers, stats.sent) ?? 'Nothing sent yet'
                  }
                />
                <Stat
                  label="Filtered activity"
                  value={stats.engagement.filteredClicks}
                  hint="Automated scans and pre-send tests hidden from results"
                />
                <Stat
                  label="Bookings"
                  value={stats.engagement.conversions.bookings}
                  hint="Bookings still carrying this campaign's tag"
                />
                {/* Shown separately from bookings: a question is not a filled table, and the
                    Christmas call to action produces questions rather than bookings. */}
                <Stat
                  label="Enquiries"
                  value={stats.engagement.conversions.enquiries}
                  hint="Enquiry forms completed carrying this campaign's tag"
                />
                <Stat
                  label="Booking value"
                  value={formatGbp(stats.engagement.conversionValue)}
                  hint={
                    stats.engagement.conversionValue === null
                      ? 'Bookings do not record an amount yet'
                      : 'Total across the bookings above'
                  }
                />
              </div>

              <p className="mt-4 text-sm text-text-muted">
                Opens come from the email provider. Clicks come from our own redirector and
                exclude bots plus rapid sweeps across most links. Raw activity is retained for
                auditing, and a later isolated click from the same person still counts.
              </p>

              {linkPerformanceError ? (
                <div className="mt-4">
                  <Alert tone="warning" title="Could not load the link figures">
                    {linkPerformanceError}
                  </Alert>
                </div>
              ) : linkPerformance.length === 0 ? (
                <div className="mt-4">
                  <Empty
                    icon="document"
                    title="No tracked links yet"
                    description="Short links are created when the campaign is scheduled. Until then there is nothing to count."
                  />
                </div>
              ) : (
                <div className="mt-4 overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Where it points</TableHead>
                        <TableHead align="right">Clicks</TableHead>
                        <TableHead align="right">People</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {linkPerformance.map((link) => (
                        <TableRow key={link.shortCode}>
                          <TableCell>
                            <div className="min-w-0">
                              <span className="break-all text-text">{link.originalUrl}</span>
                              <div className="text-xs text-text-muted break-all">
                                {link.shortUrl}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell align="right">{link.clicks}</TableCell>
                          <TableCell align="right">{link.uniqueClickers}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardBody>
          </Card>
        )}

        {stats && stats.skipped > 0 && (
          <Card>
            <CardHeader
              title={`${stats.skipped} contacts were skipped`}
              subtitle="Skipped contacts never reached an inbox, so they are left out of every percentage above"
            />
            <CardBody>
              <div className="flex flex-wrap gap-2">
                {Object.entries(stats.skippedByReason).map(([reason, count]) => (
                  <Badge key={reason} tone="neutral">
                    {skipReasonText(reason)}: {count}
                  </Badge>
                ))}
              </div>
            </CardBody>
          </Card>
        )}

        <Card>
          <CardHeader
            title="Email preview"
            subtitle="How the email looks when it arrives"
          />
          <CardBody>
            {previewError ? (
              <Alert tone="warning" title="Nothing to preview">
                {previewError}
              </Alert>
            ) : previewHtml ? (
              <iframe
                sandbox=""
                srcDoc={previewHtml}
                title="Email preview"
                className="h-[600px] w-full border border-border"
              />
            ) : (
              <Empty icon="document" title="No preview available" />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Recipients"
            subtitle={`${recipientsTotal} in total`}
          />
          <CardBody>
            {recipientsError ? (
              <Alert tone="warning" title="Could not load the recipients">
                {recipientsError}
              </Alert>
            ) : recipients.length === 0 ? (
              <Empty
                icon="users"
                title="No recipients yet"
                description="The audience is frozen when the campaign is scheduled. Until then this list is empty."
              />
            ) : (
              <>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Email</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Why skipped</TableHead>
                        <TableHead>Sent</TableHead>
                        <TableHead>Delivered</TableHead>
                        <TableHead>Opened</TableHead>
                        <TableHead>Clicked</TableHead>
                        <TableHead align="right">Clicks</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {recipients.map((recipient) => (
                        <TableRow key={recipient.id}>
                          <TableCell>
                            <span className="break-all">{recipient.email}</span>
                            {recipient.error && (
                              <div className="text-xs text-danger-fg break-words">
                                {recipient.error}
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            <RecipientStatusBadge status={recipient.status} />
                          </TableCell>
                          <TableCell>
                            {recipient.skipReason ? (
                              skipReasonLabel(recipient.skipReason)
                            ) : (
                              <span className="text-text-muted">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {recipient.sentAt ? (
                              formatDateTimeInLondon(recipient.sentAt)
                            ) : (
                              <span className="text-text-muted">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {recipient.engagement?.deliveredAt ? (
                              <Badge tone="success">Yes</Badge>
                            ) : (
                              <span className="text-text-muted">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {recipient.engagement?.openedAt ? (
                              <Badge tone="success">Yes</Badge>
                            ) : (
                              <span className="text-text-muted">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {recipient.engagement?.clickedAt ? (
                              <Badge tone="success">Yes</Badge>
                            ) : (
                              <span className="text-text-muted">-</span>
                            )}
                          </TableCell>
                          <TableCell align="right">
                            {recipient.clickCount > 0 ? (
                              <div className="min-w-0">
                                <span className="text-text">{recipient.clickCount}</span>
                                {recipient.lastClickedAt && (
                                  <div className="text-xs text-text-muted">
                                    {formatDateTimeInLondon(recipient.lastClickedAt)}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span className="text-text-muted">-</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {totalPages > 1 && (
                  <div className="mt-4">
                    <TablePagination
                      page={recipientsPage}
                      totalPages={totalPages}
                      onPageChange={(next) => {
                        startTransition(() => {
                          router.push(`/marketing/campaigns/${campaign.id}?page=${next}`)
                        })
                      }}
                      pageSize={recipientsPageSize}
                      totalItems={recipientsTotal}
                    />
                  </div>
                )}
              </>
            )}
          </CardBody>
        </Card>

        {isPending && <p className="text-sm text-text-muted">Loading…</p>}
      </div>

      <Modal
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        title="Schedule this campaign"
        width="md"
        footer={
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => setScheduleOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleSchedule} loading={busy}>
              Schedule it
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-text">
            Scheduling freezes the content and the audience. The number of recipients is fixed at
            this moment and cannot be changed afterwards without cancelling.
          </p>
          <Input
            type="datetime-local"
            label="Send at (London time)"
            value={scheduledLocal}
            onChange={(event) => setScheduledLocal(event.target.value)}
            fullWidth
          />
          <p className="text-sm text-text-muted">
            It still waits for the send window and for sending to be switched on.
          </p>
        </div>
      </Modal>

      <ConfirmDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        onConfirm={async () => {
          setCancelOpen(false)
          await runAction('Campaign cancelled.', () => cancelMarketingCampaign(campaign.id))
        }}
        title="Cancel this campaign?"
        message="Anything not yet sent will be stopped. Emails already sent cannot be pulled back, and a cancelled campaign cannot be restarted."
        confirmLabel="Cancel the campaign"
        tone="danger"
      />

      <Modal
        open={testSendOpen}
        onClose={() => setTestSendOpen(false)}
        title="Test send"
        width="md"
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setTestSendOpen(false)} disabled={busy}>
              Close
            </Button>
            <Button
              variant="primary"
              disabled={busy}
              onClick={async () => {
                const sent = await runAction('Test email sent to you.', () =>
                  sendMarketingTestEmail(campaign.id),
                )
                if (sent) setTestSendOpen(false)
              }}
            >
              Send it to me
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <p>
            This sends the campaign to your own email address so you can see it as a recipient
            will. Nothing is recorded against any contact, so it does not affect the audience,
            the frequency cap or the campaign figures.
          </p>
          <p className="text-sm text-text-muted">
            Worth checking in Outlook on Windows, Gmail, and Apple Mail in dark mode. Those are
            the three that render email differently enough to matter.
          </p>
        </div>
      </Modal>
    </PageLayout>
  )
}
