'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Empty,
  PageLayout,
  Switch,
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
  toast,
} from '@/ds'
import {
  setChecklistActive,
  setTemplateActive,
} from '@/app/actions/checklists-admin'
import type { AdminChecklist, AdminTemplate } from '@/app/actions/checklists-admin'
import { checklistsManageLayout } from '../../_shared/nav'
import { ChecklistModal } from './ChecklistModal'
import { TemplateModal } from './TemplateModal'
import { departmentLabel } from './format'

/** This tab's page chrome: the same title, subtitle and tabs in every state. */
const LAYOUT = checklistsManageLayout('setup')

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
      <PageLayout {...LAYOUT}>
        <Alert tone="danger" title="Could not load checklists">
          {error}
        </Alert>
      </PageLayout>
    )
  }

  return (
    <PageLayout
      {...LAYOUT}
      headerActions={
        <Button
          type="button"
          size="sm"
          variant="primary"
          onClick={() => setChecklistModal({ open: true })}
        >
          New Checklist
        </Button>
      }
    >
      <p className="text-sm text-text-muted">
        {checklists.length} checklist{checklists.length === 1 ? '' : 's'}
      </p>

      {checklists.length === 0 && (
        <Card>
          <Empty
            title="No checklists yet"
            description="Create the first checklist to start adding tasks."
          />
        </Card>
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
                  New Task
                </Button>
              </div>
            }
          />
          {checklist.templates.length === 0 ? (
            <Empty size="sm" title="No tasks yet" />
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
                        <span className="text-text-soft">-</span>
                      )}
                    </TableCell>
                    <TableCell align="center">
                      {template.isSpotCheckable ? (
                        <Badge tone="neutral">Yes</Badge>
                      ) : (
                        <span className="text-text-soft">No</span>
                      )}
                    </TableCell>
                    <TableCell align="center">
                      <Switch
                        aria-label={`${template.title} active`}
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
    </PageLayout>
  )
}
