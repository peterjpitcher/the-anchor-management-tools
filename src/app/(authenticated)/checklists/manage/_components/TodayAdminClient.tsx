'use client'

import { useState } from 'react'
import toast from 'react-hot-toast'
import { useRouter } from 'next/navigation'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  CardBody,
  Input,
  Switch,
} from '@/ds'
import {
  updateChecklistFlags,
  regenerateToday,
} from '@/app/actions/checklists-admin'
import type { ChecklistFlags } from '@/app/actions/checklists-admin'
import type { TodayChecklistResult } from '@/app/actions/checklists'

type Settings = ChecklistFlags & { spotChecksPerDay: number }

type FlagKey = keyof ChecklistFlags

const FLAG_LABELS: { key: FlagKey; label: string; hint: string }[] = [
  { key: 'moduleEnabled', label: 'Module enabled', hint: 'Master switch. Hides the FOH entry and nav when off.' },
  { key: 'generationEnabled', label: 'Generation enabled', hint: 'The daily generation job no-ops when off.' },
  { key: 'promptsEnabled', label: 'Prompts enabled', hint: 'The mid-shift reminder modal (Phase 4).' },
  { key: 'emailsEnabled', label: 'Emails enabled', hint: 'Outbox rows are held, not sent, when off.' },
]

const GENERATION_STATUS: Record<
  TodayChecklistResult['generationStatus'],
  { label: string; tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral' }
> = {
  complete: { label: 'Complete', tone: 'success' },
  running: { label: 'Running', tone: 'info' },
  failed: { label: 'Failed', tone: 'danger' },
  skipped_closed: { label: 'Closed today', tone: 'neutral' },
  none: { label: 'Not generated', tone: 'warning' },
}

interface TodayAdminClientProps {
  settings?: Settings
  settingsError?: string
  today?: TodayChecklistResult
  todayError?: string
}

export function TodayAdminClient({
  settings,
  settingsError,
  today,
  todayError,
}: TodayAdminClientProps) {
  const router = useRouter()
  const [busyFlag, setBusyFlag] = useState<FlagKey | null>(null)
  const [spotChecks, setSpotChecks] = useState(String(settings?.spotChecksPerDay ?? 2))
  const [savingSpot, setSavingSpot] = useState(false)
  const [regenerating, setRegenerating] = useState(false)

  // Count instance states for today.
  const counts = { pending: 0, done: 0, missed: 0, skipped: 0, not_applicable: 0, breaches: 0 }
  for (const group of today?.groups ?? []) {
    for (const task of group.tasks) {
      if (task.state in counts) counts[task.state as keyof typeof counts] += 1
      if (task.valueBreach) counts.breaches += 1
    }
  }

  async function toggleFlag(key: FlagKey, next: boolean) {
    setBusyFlag(key)
    const res = await updateChecklistFlags({ [key]: next })
    setBusyFlag(null)
    if (res.error) {
      toast.error(res.error)
      return
    }
    toast.success('Setting saved')
    router.refresh()
  }

  async function saveSpotChecks() {
    const n = Number(spotChecks)
    if (Number.isNaN(n) || n < 0 || n > 20) {
      toast.error('Spot checks per day must be between 0 and 20')
      return
    }
    setSavingSpot(true)
    const res = await updateChecklistFlags({ spotChecksPerDay: n })
    setSavingSpot(false)
    if (res.error) {
      toast.error(res.error)
      return
    }
    toast.success('Spot checks per day saved')
    router.refresh()
  }

  async function handleRegenerate() {
    setRegenerating(true)
    const res = await regenerateToday()
    setRegenerating(false)
    if (res.error) {
      toast.error(res.error)
      return
    }
    toast.success("Today's checklist regenerated")
    router.refresh()
  }

  const status = today ? GENERATION_STATUS[today.generationStatus] : null

  return (
    <div className="space-y-4">
      {settingsError && (
        <Alert tone="danger" title="Could not load settings">
          {settingsError}
        </Alert>
      )}

      {/* Generation status + counts */}
      <Card>
        <CardHeader title="Today" subtitle={today?.businessDate} />
        <CardBody className="space-y-4">
          {todayError ? (
            <Alert tone="danger" title="Could not load today's checklist">
              {todayError}
            </Alert>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm text-text-muted">Generation status</span>
                {status && <Badge tone={status.tone}>{status.label}</Badge>}
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={handleRegenerate}
                  loading={regenerating}
                >
                  Regenerate today
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <Stat label="Outstanding" value={counts.pending} />
                <Stat label="Done" value={counts.done} />
                <Stat label="Missed" value={counts.missed} />
                <Stat label="Skipped" value={counts.skipped} />
                <Stat label="N/A" value={counts.not_applicable} />
                <Stat label="Breaches" value={counts.breaches} />
              </div>
            </>
          )}
        </CardBody>
      </Card>

      {/* Flags */}
      <Card>
        <CardHeader title="Switches" subtitle="Every change is audited." />
        <CardBody className="space-y-4">
          {FLAG_LABELS.map(({ key, label, hint }) => (
            <div key={key} className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-text">{label}</p>
                <p className="text-xs text-text-muted">{hint}</p>
              </div>
              <Switch
                checked={settings ? settings[key] : false}
                disabled={!settings || busyFlag === key}
                onChange={(v) => toggleFlag(key, v)}
              />
            </div>
          ))}
          <div className="flex items-end gap-3 border-t border-border pt-4">
            <div className="w-40">
              <Input
                type="number"
                label="Spot checks per day"
                min={0}
                max={20}
                value={spotChecks}
                onChange={(e) => setSpotChecks(e.target.value)}
                disabled={!settings}
              />
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={saveSpotChecks}
              loading={savingSpot}
              disabled={!settings}
            >
              Save
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-default border border-border bg-surface px-3 py-2">
      <div className="text-xs uppercase tracking-wider text-text-muted">{label}</div>
      <div className="text-xl font-semibold text-text-strong">{value}</div>
    </div>
  )
}
