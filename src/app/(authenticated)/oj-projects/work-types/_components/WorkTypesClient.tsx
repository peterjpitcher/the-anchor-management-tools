'use client'

import { useState, useCallback } from 'react'
import {
  Alert,
  Card,
  PageLayout,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Badge,
  Button,
  Modal,
  Field,
  Input,
  Switch,
  Empty,
  ConfirmDialog,
  RowActions,
  toast,
} from '@/ds'
import { Icon } from '@/ds/icons'
import { usePermissions } from '@/contexts/PermissionContext'
import {
  getWorkTypes,
  createWorkType,
  updateWorkType,
  disableWorkType,
} from '@/app/actions/oj-projects/work-types'
import { ojProjectsLayout } from '../../_shared/nav'
import { ojActive } from '../../_shared/status-ui'

/** This tab's page chrome: the same title, subtitle and tabs in every state. */
const LAYOUT = ojProjectsLayout('work-types')

type WorkTypeForm = {
  id?: string
  name: string
  sort_order: string
  is_active: boolean
}

const emptyForm: WorkTypeForm = {
  name: '',
  sort_order: '0',
  is_active: true,
}

interface WorkTypesClientProps {
  initialWorkTypes: any[]
  /** Set when the work types failed to load, so the page says so. */
  loadError?: string
}

export function WorkTypesClient({ initialWorkTypes, loadError }: WorkTypesClientProps): React.ReactElement {
  const { hasPermission } = usePermissions()
  const canCreate = hasPermission('oj_projects', 'create')
  const canEdit = hasPermission('oj_projects', 'edit')

  const [workTypes, setWorkTypes] = useState(initialWorkTypes)
  const [modalOpen, setModalOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<WorkTypeForm>(emptyForm)
  const [disableId, setDisableId] = useState<string | null>(null)

  const isEditing = !!form.id

  const reload = useCallback(async () => {
    const res = await getWorkTypes()
    if (res.workTypes) setWorkTypes(res.workTypes)
  }, [])

  function openCreate(): void {
    setForm(emptyForm)
    setModalOpen(true)
  }

  function openEdit(wt: any): void {
    setForm({
      id: wt.id,
      name: wt.name || '',
      sort_order: wt.sort_order != null ? String(wt.sort_order) : '0',
      is_active: wt.is_active ?? true,
    })
    setModalOpen(true)
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setSaving(true)
    try {
      const fd = new FormData()
      fd.append('name', form.name)
      fd.append('sort_order', form.sort_order)
      fd.append('is_active', String(form.is_active))
      if (form.id) fd.append('id', form.id)

      const res = form.id ? await updateWorkType(fd) : await createWorkType(fd)
      if (res.error) throw new Error(res.error)
      toast.success(form.id ? 'Work type updated' : 'Work type created')
      setModalOpen(false)
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save work type')
    } finally {
      setSaving(false)
    }
  }

  async function handleDisable(): Promise<void> {
    if (!disableId) return
    try {
      const fd = new FormData()
      fd.append('id', disableId)
      const res = await disableWorkType(fd)
      if (res.error) throw new Error(res.error)
      toast.success('Work type disabled')
      setDisableId(null)
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to disable work type')
    }
  }

  async function handleToggleActive(wt: any): Promise<void> {
    try {
      const fd = new FormData()
      fd.append('id', wt.id)
      fd.append('name', wt.name)
      fd.append('sort_order', String(wt.sort_order ?? 0))
      fd.append('is_active', String(!wt.is_active))
      const res = await updateWorkType(fd)
      if (res.error) throw new Error(res.error)
      toast.success(wt.is_active ? 'Work type deactivated' : 'Work type activated')
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to toggle work type')
    }
  }

  if (loadError) {
    return (
      <PageLayout {...LAYOUT}>
        <Alert tone="danger" title="Could not load work types">
          {loadError}
        </Alert>
      </PageLayout>
    )
  }

  return (
    <PageLayout
      {...LAYOUT}
      headerActions={
        canCreate ? (
          <Button variant="primary" onClick={openCreate} icon={<Icon name="plus" size={16} />} size="sm">
            New Work Type
          </Button>
        ) : undefined
      }
    >
      <Card padding="none">
        {workTypes.length === 0 ? (
          <Empty size="sm" title="No work types yet" description="Work types you create show here, ready to categorise time entries." />
        ) : (
          <>
            <div className="divide-y divide-border px-pad-card py-3 md:hidden">
              {workTypes.map((wt) => (
                <div key={wt.id} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="font-medium text-text">{wt.name}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-text-muted">
                      <span>Order {wt.sort_order ?? 0}</span>
                      <Badge tone={ojActive(wt.is_active).tone}>{ojActive(wt.is_active).label}</Badge>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {canEdit && (
                      <Switch
                        aria-label={`${wt.name} active`}
                        checked={wt.is_active}
                        onChange={() => handleToggleActive(wt)}
                        size="sm"
                      />
                    )}
                    <RowActions
                      actions={[
                        canEdit && {
                          key: 'edit',
                          label: 'Edit',
                          icon: <Icon name="edit" size={16} />,
                          onSelect: () => openEdit(wt),
                        },
                        canEdit && wt.is_active && {
                          key: 'disable',
                          label: 'Disable',
                          icon: <Icon name="ban" size={16} />,
                          onSelect: () => setDisableId(wt.id),
                        },
                      ]}
                    />
                  </div>
                </div>
              ))}
            </div>
            <Table className="hidden md:block">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Sort Order</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Active</TableHead>
                <TableHead className="w-20">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {workTypes.map((wt) => (
                <TableRow key={wt.id}>
                  <TableCell className="font-medium">{wt.name}</TableCell>
                  <TableCell>{wt.sort_order ?? 0}</TableCell>
                  <TableCell>
                    <Badge tone={ojActive(wt.is_active).tone}>{ojActive(wt.is_active).label}</Badge>
                  </TableCell>
                  <TableCell>
                    {canEdit && (
                      <Switch
                        aria-label={`${wt.name} active`}
                        checked={wt.is_active}
                        onChange={() => handleToggleActive(wt)}
                        size="sm"
                      />
                    )}
                  </TableCell>
                  <TableCell>
                    <RowActions
                      actions={[
                        canEdit && {
                          key: 'edit',
                          label: 'Edit',
                          icon: <Icon name="edit" size={16} />,
                          onSelect: () => openEdit(wt),
                        },
                        canEdit && wt.is_active && {
                          key: 'disable',
                          label: 'Disable',
                          icon: <Icon name="ban" size={16} />,
                          onSelect: () => setDisableId(wt.id),
                        },
                      ]}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            </Table>
          </>
        )}
      </Card>

      {/* Create/Edit Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={isEditing ? 'Edit Work Type' : 'New Work Type'}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="oj-work-type-form" variant="primary" loading={saving}>
              {isEditing ? 'Save Changes' : 'Create Work Type'}
            </Button>
          </>
        }
      >
        <form id="oj-work-type-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field label="Name" required>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Development"
              required
            />
          </Field>
          <Field label="Sort Order">
            <Input
              type="number"
              min="0"
              value={form.sort_order}
              onChange={(e) => setForm({ ...form, sort_order: e.target.value })}
            />
          </Field>
          <Switch
            label="Active"
            checked={form.is_active}
            onChange={(checked) => setForm({ ...form, is_active: checked })}
          />
        </form>
      </Modal>

      {/* Disable Confirmation */}
      <ConfirmDialog
        open={!!disableId}
        onClose={() => setDisableId(null)}
        onConfirm={handleDisable}
        title="Disable Work Type"
        message="This work type will be deactivated. Existing entries will keep their work type label."
        confirmLabel="Disable"
        tone="primary"
      />
    </PageLayout>
  )
}
