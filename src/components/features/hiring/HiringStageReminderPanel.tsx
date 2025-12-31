'use client'

import { useState } from 'react'
import toast from 'react-hot-toast'
import { Card } from '@/components/ui-v2/layout/Card'
import { Button } from '@/components/ui-v2/forms/Button'
import { Input } from '@/components/ui-v2/forms/Input'
import { Toggle } from '@/components/ui-v2/forms/Toggle'
import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
import { updateHiringStageReminderConfigAction } from '@/actions/hiring-reminders'
import type { HiringStageReminderConfig } from '@/types/hiring'

const STAGE_FIELDS = [
  { key: 'new', label: 'Application received' },
  { key: 'screening', label: 'Screening' },
  { key: 'screened', label: 'Screened' },
  { key: 'in_conversation', label: 'In conversation' },
  { key: 'interview_scheduled', label: 'Interview scheduled' },
  { key: 'interviewed', label: 'Interview completed' },
  { key: 'offer', label: 'Offer made' },
] as const

type StageKey = typeof STAGE_FIELDS[number]['key']

type ReminderThresholds = Partial<Record<StageKey, number>>

interface HiringStageReminderPanelProps {
  initialConfig: HiringStageReminderConfig
}

function normalizeRecipients(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function parsePositiveInt(value: string): number | undefined {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined
  return parsed
}

export function HiringStageReminderPanel({ initialConfig }: HiringStageReminderPanelProps) {
  const [config, setConfig] = useState<HiringStageReminderConfig>(initialConfig)
  const [recipientsText, setRecipientsText] = useState(initialConfig.recipients.join(', '))
  const [isSaving, setIsSaving] = useState(false)

  const handleThresholdChange = (stage: StageKey, value: string) => {
    const parsed = parsePositiveInt(value)
    setConfig((prev) => ({
      ...prev,
      thresholds: {
        ...(prev.thresholds as ReminderThresholds),
        [stage]: parsed,
      },
    }))
  }

  const handleSave = async () => {
    const recipients = normalizeRecipients(recipientsText)
    if (recipients.length === 0) {
      toast.error('Add at least one recipient email')
      return
    }

    const thresholds = STAGE_FIELDS.reduce((acc, stage) => {
      const value = config.thresholds?.[stage.key as StageKey]
      if (value && value > 0) {
        acc[stage.key] = Math.floor(value)
      }
      return acc
    }, {} as ReminderThresholds)

    setIsSaving(true)
    try {
      const result = await updateHiringStageReminderConfigAction({
        enabled: Boolean(config.enabled),
        recipients,
        cooldownDays: Math.max(1, Math.floor(config.cooldownDays || 1)),
        thresholds,
      })

      if (!result.success) {
        toast.error(result.error || 'Failed to update reminders')
        return
      }

      toast.success('Reminder settings updated')
      setConfig((prev) => ({
        ...prev,
        recipients,
        thresholds,
      }))
      setRecipientsText(recipients.join(', '))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <Card className="p-6 space-y-6">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Stage reminders</h3>
          <p className="text-sm text-gray-500">Email managers when applications sit too long in a stage.</p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <div className="flex items-center gap-3">
            <Toggle
              checked={config.enabled}
              onChange={() => setConfig((prev) => ({ ...prev, enabled: !prev.enabled }))}
            />
            <div>
              <p className="text-sm font-medium text-gray-900">Reminders enabled</p>
              <p className="text-xs text-gray-500">Turn off to pause reminder emails.</p>
            </div>
          </div>

          <FormGroup
            label="Recipients"
            htmlFor="hiring-reminder-recipients"
            help="Comma-separated emails (e.g. manager@the-anchor.pub, owner@the-anchor.pub)."
          >
            <Input
              id="hiring-reminder-recipients"
              value={recipientsText}
              onChange={(event) => setRecipientsText(event.target.value)}
              placeholder="manager@the-anchor.pub"
            />
          </FormGroup>

          <FormGroup
            label="Cooldown days"
            htmlFor="hiring-reminder-cooldown"
            help="Minimum days before another reminder for the same stage."
          >
            <Input
              id="hiring-reminder-cooldown"
              type="number"
              min={1}
              max={365}
              value={config.cooldownDays}
              onChange={(event) => {
                const parsed = parsePositiveInt(event.target.value)
                setConfig((prev) => ({
                  ...prev,
                  cooldownDays: parsed ?? prev.cooldownDays,
                }))
              }}
            />
          </FormGroup>
        </div>

        <div>
          <h4 className="text-sm font-semibold text-gray-900">Stage thresholds (days)</h4>
          <p className="text-xs text-gray-500">Send a reminder once the application exceeds these ages.</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {STAGE_FIELDS.map((stage) => (
            <FormGroup
              key={stage.key}
              label={stage.label}
              htmlFor={`reminder-threshold-${stage.key}`}
            >
              <Input
                id={`reminder-threshold-${stage.key}`}
                type="number"
                min={1}
                value={config.thresholds?.[stage.key] ?? ''}
                onChange={(event) => handleThresholdChange(stage.key, event.target.value)}
                placeholder="Days"
              />
            </FormGroup>
          ))}
        </div>

        <div className="flex justify-end">
          <Button variant="primary" loading={isSaving} onClick={handleSave}>
            Save settings
          </Button>
        </div>
      </Card>
    </div>
  )
}
