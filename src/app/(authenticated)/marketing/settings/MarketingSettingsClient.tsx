'use client'

import { useState } from 'react'

import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  Field,
  Input,
  PageLayout,
  Select,
  Switch,
  toast,
} from '@/ds'
import { updateMarketingSettings } from '@/app/actions/marketing-campaigns'
import type { MarketingSettings } from '@/types/marketing'

import {
  HOUR_OPTIONS,
  ISO_DAY_OPTIONS,
  MARKETING_SECTION_NAV,
  formatDateTimeInLondon,
  formatHour,
  formatSendDays,
} from '../_shared/marketing-ui'

export type MarketingReadiness =
  | { ok: true; from: string; replyTo: string | null }
  | { ok: false; missing: string[] }

interface MarketingSettingsClientProps {
  settings: MarketingSettings
  readiness: MarketingReadiness
}

export function MarketingSettingsClient({
  settings: initialSettings,
  readiness,
}: MarketingSettingsClientProps) {
  const [settings, setSettings] = useState(initialSettings)
  const [savingSwitch, setSavingSwitch] = useState(false)
  const [savingWindow, setSavingWindow] = useState(false)
  const [confirmEnable, setConfirmEnable] = useState(false)

  const [form, setForm] = useState({
    startHour: String(initialSettings.sendWindowStartHour),
    endHour: String(initialSettings.sendWindowEndHour),
    sendDays: initialSettings.sendDays,
    frequencyCapDays: String(initialSettings.frequencyCapDays),
    batchSize: String(initialSettings.batchSize),
  })

  async function applySendsEnabled(nextValue: boolean) {
    setSavingSwitch(true)
    const result = await updateMarketingSettings({ sendsEnabled: nextValue })
    setSavingSwitch(false)

    if (result.error || !result.data) {
      toast.error(result.error ?? 'Could not change the send switch')
      return
    }

    setSettings(result.data)
    toast.success(
      nextValue
        ? 'Sending is on. Scheduled campaigns will go out inside the send window.'
        : 'Sending is off. Nothing will go out until you turn it back on.',
    )
  }

  function handleSwitchChange(nextValue: boolean) {
    // Turning sending on is the consequential direction, so it asks first. Turning it off is
    // the safe direction and happens immediately, which is what a kill switch has to do.
    if (nextValue) {
      setConfirmEnable(true)
      return
    }
    void applySendsEnabled(false)
  }

  function toggleDay(day: number) {
    setForm((prev) => ({
      ...prev,
      sendDays: prev.sendDays.includes(day)
        ? prev.sendDays.filter((value) => value !== day)
        : [...prev.sendDays, day].sort((a, b) => a - b),
    }))
  }

  async function handleSaveWindow() {
    const startHour = Number.parseInt(form.startHour, 10)
    const endHour = Number.parseInt(form.endHour, 10)
    const frequencyCapDays = Number.parseInt(form.frequencyCapDays, 10)
    const batchSize = Number.parseInt(form.batchSize, 10)

    if (!form.sendDays.length) {
      toast.error('Pick at least one day for sending.')
      return
    }
    if (!Number.isFinite(startHour) || !Number.isFinite(endHour) || endHour <= startHour) {
      toast.error('The send window must end after it starts.')
      return
    }
    if (!Number.isFinite(frequencyCapDays) || frequencyCapDays < 0) {
      toast.error('The frequency cap must be zero or more days.')
      return
    }
    if (!Number.isFinite(batchSize) || batchSize < 1) {
      toast.error('The batch size must be at least one.')
      return
    }

    setSavingWindow(true)
    const result = await updateMarketingSettings({
      sendWindowStartHour: startHour,
      sendWindowEndHour: endHour,
      sendDays: form.sendDays,
      frequencyCapDays,
      batchSize,
    })
    setSavingWindow(false)

    if (result.error || !result.data) {
      toast.error(result.error ?? 'Could not save the send window')
      return
    }

    setSettings(result.data)
    toast.success('Send window saved.')
  }

  return (
    <PageLayout
      title="Marketing"
      subtitle="Settings for campaign email"
      navItems={MARKETING_SECTION_NAV}
    >
      <div className="space-y-6">
        <Card
          className={
            settings.sendsEnabled
              ? 'border-2 border-success'
              : 'border-2 border-warning bg-warning-soft'
          }
        >
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-xl font-semibold text-text">Campaign sending</h2>
                <Badge tone={settings.sendsEnabled ? 'success' : 'warning'}>
                  {settings.sendsEnabled ? 'On' : 'Off'}
                </Badge>
              </div>
              <p className="text-sm text-text">
                Turning this off stops all campaign sending immediately, including a campaign
                that is part way through. Transactional email such as booking confirmations is
                not affected.
              </p>
              <p className="text-xs text-text-muted">
                Last changed {formatDateTimeInLondon(settings.updatedAt)}.
              </p>
            </div>
            <div className="shrink-0">
              <Switch
                label={settings.sendsEnabled ? 'Sending is on' : 'Sending is off'}
                checked={settings.sendsEnabled}
                onChange={handleSwitchChange}
                disabled={savingSwitch}
              />
            </div>
          </div>
        </Card>

        {!settings.sendsEnabled && (
          <Alert tone="warning" title="Nothing is going out right now">
            Campaigns can still be written and scheduled. They will sit and wait until sending is
            switched on.
          </Alert>
        )}

        <Card>
          <CardHeader
            title="When campaigns can go out"
            subtitle="Emails are only sent on these days, inside these hours, London time"
          />
          <CardBody>
            <div className="space-y-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Send window starts">
                  <Select
                    options={HOUR_OPTIONS}
                    value={form.startHour}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, startHour: event.target.value }))
                    }
                    fullWidth
                  />
                </Field>
                <Field label="Send window ends">
                  <Select
                    options={HOUR_OPTIONS}
                    value={form.endHour}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, endHour: event.target.value }))
                    }
                    fullWidth
                  />
                </Field>
              </div>

              <Field
                label="Days"
                hint="A scheduled campaign waits for the next allowed day if it falls outside these."
              >
                <div className="flex flex-wrap gap-2">
                  {ISO_DAY_OPTIONS.map((day) => {
                    const selected = form.sendDays.includes(day.value)
                    return (
                      <Button
                        key={day.value}
                        type="button"
                        variant={selected ? 'primary' : 'secondary'}
                        size="sm"
                        onClick={() => toggleDay(day.value)}
                        aria-pressed={selected}
                      >
                        {day.short}
                      </Button>
                    )
                  })}
                </div>
              </Field>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input
                  label="Do not email the same contact within"
                  hint="Days. Zero means no limit."
                  type="number"
                  min={0}
                  max={365}
                  value={form.frequencyCapDays}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, frequencyCapDays: event.target.value }))
                  }
                  fullWidth
                />
                <Input
                  label="Emails per batch"
                  hint="How many go out each time the sender runs."
                  type="number"
                  min={1}
                  max={200}
                  value={form.batchSize}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, batchSize: event.target.value }))
                  }
                  fullWidth
                />
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="min-w-0 text-sm text-text-muted">
                  Currently {formatHour(settings.sendWindowStartHour)} to{' '}
                  {formatHour(settings.sendWindowEndHour)} on {formatSendDays(settings.sendDays)}.
                </p>
                <Button variant="primary" onClick={handleSaveWindow} loading={savingWindow}>
                  Save send window
                </Button>
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Configuration"
            subtitle="Read-only. These come from the environment and need a deploy to change."
          />
          <CardBody>
            {readiness.ok ? (
              <dl className="space-y-3 text-sm">
                <div className="flex flex-col gap-1 sm:flex-row sm:gap-3">
                  <dt className="w-40 shrink-0 text-text-muted">Provider</dt>
                  <dd className="min-w-0 break-words text-text">
                    Resend <Badge tone="success">Ready</Badge>
                  </dd>
                </div>
                <div className="flex flex-col gap-1 sm:flex-row sm:gap-3">
                  <dt className="w-40 shrink-0 text-text-muted">From address</dt>
                  <dd className="min-w-0 break-all text-text">{readiness.from}</dd>
                </div>
                <div className="flex flex-col gap-1 sm:flex-row sm:gap-3">
                  <dt className="w-40 shrink-0 text-text-muted">Replies go to</dt>
                  <dd className="min-w-0 break-all text-text">
                    {readiness.replyTo ?? 'The from address'}
                  </dd>
                </div>
                <div className="flex flex-col gap-1 sm:flex-row sm:gap-3">
                  <dt className="w-40 shrink-0 text-text-muted">Open tracking</dt>
                  <dd className="min-w-0 text-text">
                    Off. The sending domain also carries booking confirmations and receipts, and
                    turning tracking on there would rewrite links in those too.
                  </dd>
                </div>
              </dl>
            ) : (
              <Alert tone="danger" title="Marketing email is not configured">
                <div className="space-y-2">
                  <p>Nothing can send until these are set in the hosting environment:</p>
                  <ul className="list-disc space-y-1 pl-5">
                    {readiness.missing.map((item) => (
                      <li key={item} className="break-all">
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              </Alert>
            )}
          </CardBody>
        </Card>
      </div>

      <ConfirmDialog
        open={confirmEnable}
        onClose={() => setConfirmEnable(false)}
        onConfirm={async () => {
          await applySendsEnabled(true)
          setConfirmEnable(false)
        }}
        title="Turn campaign sending on?"
        message="Any campaign already scheduled for a time that has passed will start going out at the next send window. Check the campaign list first if you are not sure what is queued."
        confirmLabel="Turn sending on"
        tone="warning"
      />
    </PageLayout>
  )
}
