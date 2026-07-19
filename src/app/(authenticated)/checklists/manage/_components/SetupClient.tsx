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
  Switch,
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/ds'
import {
  setChecklistActive,
  setTemplateActive,
} from '@/app/actions/checklists-admin'
import type { AdminChecklist, AdminTemplate } from '@/app/actions/checklists-admin'
import { ChecklistModal } from './ChecklistModal'
import { TemplateModal } from './TemplateModal'
import { departmentLabel } from './format'

function anchorSummary(t: AdminTemplate): string {
  switch (t.anchor) {
    case 'open':
      return 'at open'
    case 'close':
      return 'at close'
    case 'every':
      return `every ${t.everyHours ?? '?'}h from open`
    case 'at_times':
      return `at ${(t.atTimes ?? []).map((x) => x.slice(0, 5)).join('/') || '?'}`
    case 'anytime':
      return 'anytime'
    default:
      return t.anchor
  }
}

function cadenceSummary(t: AdminTemplate): string {
  if (t.scheduleKind === 'floating') {
    return `Floating, every ${t.intervalDays ?? '?'}d (tolerance ${t.toleranceDays ?? 0}d)`
  }
  const parts: string[] = []
  if (t.freq) {
    parts.push(t.freqInterval > 1 ? `every ${t.freqInterval} ${t.freq}` : t.freq)
  }
  parts.push(anchorSummary(t))
  if (t.seasonStart && t.seasonEnd) parts.push(`season ${t.seasonStart} to ${t.seasonEnd}`)
  return parts.join(', ')
}

interface SetupClientProps {
  checklists: AdminChecklist[]
  error?: string
}

export function SetupClient({ checklists, error }: SetupClientProps) {
  const router = useRouter()
  const [checklistModal, setChecklistModal] = useState<{
    open: boolean
    checklist?: AdminChecklist
  }>({ open: false })
  const [templateModal, setTemplateModal] = useState<{
    open: boolean
    checklistId: string
    checklistName: string
    template?: AdminTemplate
  }>({ open: false, checklistId: '', checklistName: '' })
  const [busyId, setBusyId] = useState<string | null>(null)

  async function toggleChecklist(checklist: AdminChecklist, next: boolean) {
    setBusyId(checklist.id)
    const res = await setChecklistActive(checklist.id, next)
    setBusyId(null)
    if (res.error) {
      toast.error(res.error)
      return
    }
    toast.success(next ? 'Checklist activated' : 'Checklist archived')
    router.refresh()
  }

  async function toggleTemplate(template: AdminTemplate, next: boolean) {
    setBusyId(template.id)
    const res = await setTemplateActive(template.id, next)
    setBusyId(null)
    if (res.error) {
      // Activation is rejected when the cadence is invalid (spec 3.12).
      toast.error(res.error)
      return
    }
    toast.success(next ? 'Task activated' : 'Task deactivated')
    router.refresh()
  }

  if (error) {
    return (
      <Alert tone="danger" title="Could not load checklists">
        {error}
      </Alert>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-text-muted">
          {checklists.length} checklist{checklists.length === 1 ? '' : 's'}
        </p>
        <Button
          type="button"
          variant="primary"
          onClick={() => setChecklistModal({ open: true })}
        >
          New checklist
        </Button>
      </div>

      {checklists.length === 0 && (
        <Alert tone="info" title="No checklists yet">
          Create the first checklist to start adding tasks.
        </Alert>
      )}

      {checklists.map((checklist) => (
        <Card key={checklist.id}>
          <CardHeader
            title={checklist.name}
            subtitle={`${departmentLabel(checklist.department)}${checklist.description ? ' · ' + checklist.description : ''}`}
            action={
              <div className="flex items-center gap-3">
                <Switch
                  label={checklist.isActive ? 'Active' : 'Archived'}
                  checked={checklist.isActive}
                  disabled={busyId === checklist.id}
                  onChange={(v) => toggleChecklist(checklist, v)}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => setChecklistModal({ open: true, checklist })}
                >
                  Edit
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="primary"
                  onClick={() =>
                    setTemplateModal({
                      open: true,
                      checklistId: checklist.id,
                      checklistName: checklist.name,
                    })
                  }
                >
                  New task
                </Button>
              </div>
            }
          />
          <CardBody className="p-0">
            {checklist.templates.length === 0 ? (
              <p className="px-[var(--spacing-pad-card)] py-4 text-sm text-text-muted">
                No tasks yet.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Task</TableHead>
                    <TableHead>Cadence</TableHead>
                    <TableHead>Value</TableHead>
                    <TableHead align="center">Spot check</TableHead>
                    <TableHead align="center">Active</TableHead>
                    <TableHead align="right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {checklist.templates.map((template) => (
                    <TableRow key={template.id}>
                      <TableCell className="whitespace-normal">
                        <div className="font-medium text-text">{template.title}</div>
                        {template.department && (
                          <div className="text-xs text-text-muted">
                            {departmentLabel(template.department)}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-normal text-text-muted">
                        {cadenceSummary(template)}
                      </TableCell>
                      <TableCell>
                        {template.requiresValue ? (
                          <Badge tone="info">
                            {template.valueMin ?? '-'} to {template.valueMax ?? '-'} {template.valueUnit ?? ''}
                          </Badge>
                        ) : (
                          <span className="text-text-subtle">-</span>
                        )}
                      </TableCell>
                      <TableCell align="center">
                        {template.isSpotCheckable ? (
                          <Badge tone="neutral">Yes</Badge>
                        ) : (
                          <span className="text-text-subtle">No</span>
                        )}
                      </TableCell>
                      <TableCell align="center">
                        <Switch
                          checked={template.isActive}
                          disabled={busyId === template.id}
                          onChange={(v) => toggleTemplate(template, v)}
                        />
                      </TableCell>
                      <TableCell align="right">
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() =>
                            setTemplateModal({
                              open: true,
                              checklistId: checklist.id,
                              checklistName: checklist.name,
                              template,
                            })
                          }
                        >
                          Edit
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardBody>
        </Card>
      ))}

      <ChecklistModal
        open={checklistModal.open}
        checklist={checklistModal.checklist}
        onClose={() => setChecklistModal({ open: false })}
      />
      <TemplateModal
        open={templateModal.open}
        checklistId={templateModal.checklistId}
        checklistName={templateModal.checklistName}
        template={templateModal.template}
        onClose={() =>
          setTemplateModal({ open: false, checklistId: '', checklistName: '' })
        }
      />
    </div>
  )
}
