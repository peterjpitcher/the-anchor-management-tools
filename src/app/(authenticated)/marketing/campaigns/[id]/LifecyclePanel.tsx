'use client'

import { useState } from 'react'

import { Alert, Button, Card, CardBody, CardHeader, Input, Stat, StatGrid, toast } from '@/ds'
import { setMarketingLifecycleHoldout } from '@/app/actions/marketing-campaigns'
import { describeReturnVisitFilter, describeSendDays } from '@/lib/email/marketing/lifecycle'
import type { LifecycleCampaignStats, LifecycleGroupOutcome } from '@/services/marketing-lifecycle'
import type { MarketingCampaign } from '@/types/marketing'

import { formatGbp, formatPercent } from '../../_shared/marketing-ui'

interface LifecyclePanelProps {
  campaign: MarketingCampaign
  stats: LifecycleCampaignStats | null
  statsError: string | null
  canSend: boolean
  onChanged: () => void
}

/** "3 of 40 (7.5%)", or a plain dash until any guest has been in the group long enough. */
function bookingRate(booked: number, matured: number): string {
  if (matured === 0) return '-'
  return `${booked} of ${matured} (${formatPercent(booked / matured)})`
}

function GroupRow({ label, group }: { label: string; group: LifecycleGroupOutcome }) {
  return (
    <div className="grid grid-cols-3 gap-2 text-sm">
      <span className="text-text">{label}</span>
      <span className="text-text">{bookingRate(group.booked30, group.matured30)}</span>
      <span className="text-text">{bookingRate(group.booked90, group.matured90)}</span>
    </div>
  )
}

/**
 * The return-visit half of a campaign page: who it picks, when it sends, the control group
 * share, and whether it is bringing people back (spec section 7, "Measure").
 */
export function LifecyclePanel({ campaign, stats, statsError, canSend, onChanged }: LifecyclePanelProps) {
  const [holdout, setHoldout] = useState(String(campaign.holdoutPercent ?? 0))
  const [saving, setSaving] = useState(false)

  const filter = campaign.audience.customerFilter
  const editable = canSend && ['draft', 'sending', 'paused'].includes(campaign.status)
  const holdoutValue = Number(holdout)
  const holdoutValid = holdout.trim() !== '' && Number.isInteger(holdoutValue) && holdoutValue >= 0 && holdoutValue <= 50
  const holdoutChanged = holdoutValid && holdoutValue !== (campaign.holdoutPercent ?? 0)

  async function saveHoldout() {
    setSaving(true)
    const result = await setMarketingLifecycleHoldout({ id: campaign.id, holdoutPercent: holdoutValue })
    setSaving(false)
    if (result.error) {
      toast.error(result.error)
      return
    }
    toast.success('Control group saved.')
    onChanged()
  }

  return (
    <>
      <Card>
        <CardHeader
          title="Return Visit Rule"
          subtitle="Runs on its send days until paused or cancelled, picking new guests each time"
        />
        <CardBody>
          <div className="space-y-4">
            <p className="text-sm text-text">
              {filter ? describeReturnVisitFilter(filter) : 'This campaign has no rule to pick guests by.'}
            </p>
            <dl className="grid gap-2 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-text-muted">Sends on</dt>
                <dd className="text-text">
                  {describeSendDays(campaign.sendDays)}
                  {campaign.promoteAtLocal ? ` from ${campaign.promoteAtLocal}` : ''}
                </dd>
              </div>
              <div>
                <dt className="text-text-muted">Once per guest every</dt>
                <dd className="text-text">{campaign.cooldownDays ?? '-'} days</dd>
              </div>
              <div>
                <dt className="text-text-muted">Held back as the control group</dt>
                <dd className="text-text">{campaign.holdoutPercent ?? 0}%</dd>
              </div>
            </dl>
            <p className="text-sm text-text-muted">
              No email goes out while the kitchen is closed on more than 7 of the next 30 days, so a
              voucher is never sent that could not be used.
            </p>

            {editable && (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="sm:w-48">
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={50}
                    step={1}
                    label="Control group"
                    value={holdout}
                    onChange={(event) => setHoldout(event.target.value)}
                    rightElement="%"
                    error={holdout.trim() !== '' && !holdoutValid ? 'A whole number from 0 to 50' : undefined}
                  />
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={saveHoldout}
                  loading={saving}
                  disabled={!holdoutChanged || saving}
                >
                  Save Control Group
                </Button>
              </div>
            )}
          </div>
        </CardBody>
      </Card>

      {statsError && (
        <Alert tone="warning" title="Could not load the return-visit results">
          {statsError}
        </Alert>
      )}

      {stats && (
        <Card>
          <CardHeader
            title="Is It Bringing People Back?"
            subtitle="The control group gets nothing, so the difference between the two booking rates is what the email adds"
          />
          <CardBody>
            <div className="space-y-4">
              <StatGrid columns={4}>
                <Stat label="Picked" value={stats.selected} />
                <Stat label="Sent" value={stats.sent} />
                <Stat label="Control group" value={stats.holdout} hint="Picked, then held back" />
                <Stat
                  label="Booked before the email"
                  value={stats.bookedSinceSelection}
                  hint="Skipped, no voucher issued"
                />
                <Stat label="Vouchers issued" value={stats.vouchersIssued} />
                <Stat
                  label="Vouchers redeemed"
                  value={stats.vouchersRedeemed}
                  hint={stats.vouchersIssued > 0 ? formatPercent(stats.vouchersRedeemed / stats.vouchersIssued) : undefined}
                />
                <Stat
                  label="Discount given"
                  value={formatGbp(stats.discountGivenPence / 100)}
                  hint="As recorded at the till"
                />
                <Stat
                  label="Booked through the email"
                  value={stats.attributedBookings}
                  hint="Bookings made from this campaign's links"
                />
              </StatGrid>

              <div className="space-y-2">
                <div className="grid grid-cols-3 gap-2 text-sm text-text-muted">
                  <span>Booked a table</span>
                  <span>Within 30 days</span>
                  <span>Within 90 days</span>
                </div>
                <GroupRow label="Sent the email" group={stats.sentGroup} />
                <GroupRow label="Control group" group={stats.holdoutGroup} />
                <p className="text-sm text-text-muted">
                  Each guest counts once they have been in their group for the full 30 or 90 days.
                </p>
              </div>
            </div>
          </CardBody>
        </Card>
      )}
    </>
  )
}
