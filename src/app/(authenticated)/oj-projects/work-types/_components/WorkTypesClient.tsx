'use client'

import { useState, useCallback } from 'react'
import {
  Card,
  CardHeader,
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
  IconButton,
  toast,
} from '@/ds'
import { usePermissions } from '@/contexts/PermissionContext'
import {
  getWorkTypes,
  createWorkType,
  updateWorkType,
  disableWorkType,
} from '@/app/actions/oj-projects/work-types'

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
}

export function WorkTypesClient({ initialWorkTypes }: WorkTypesClientProps): React.ReactElement {
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

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex justify-end">
        {canCreate && (
          <Button onClick={openCreate} icon="plus" size="sm">
            New Work Type
          </Button>
        )}
      </div>

      {/* Table */}
      <Card>
        {workTypes.length === 0 ? (
          <Empty title="No work types" description="Add a work type to categorize time entries." />
        ) : (
          <Table>
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
                    <Badge tone={wt.is_active ? 'success' : 'neutral'}>
                      {wt.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {canEdit && (
                      <Switch
                        checked={wt.is_active}
                        onChange={() => handleToggleActive(wt)}
                        size="sm"
                      />
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {canEdit && (
                        <IconButton
                          icon="edit"
                          size="sm"
                          label="Edit"
                          onClick={() => openEdit(wt)}
                        />
                      )}
                      {canEdit && wt.is_active && (
                        <IconButton
                          icon="trash"
                          size="sm"
                          label="Disable"
                          onClick={() => setDisableId(wt.id)}
                        />
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* Create/Edit Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={isEditing ? 'Edit Work Type' : 'New Work Type'}
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="ghost" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              {isEditing ? 'Save Changes' : 'Create Work Type'}
            </Button>
          </div>
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
        tone="danger"
      />
    </div>
  )
}
