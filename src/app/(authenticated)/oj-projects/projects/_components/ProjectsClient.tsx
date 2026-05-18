'use client'

import { useMemo, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  Card,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  Badge,
  Button,
  SearchInput,
  Select,
  Modal,
  Field,
  Input,
  Textarea,
  ProgressBar,
  Empty,
  ConfirmDialog,
  IconButton,
  toast,
} from '@/ds'
import { usePermissions } from '@/contexts/PermissionContext'
import {
  getProjects,
  createProject,
  updateProject,
  deleteProject,
} from '@/app/actions/oj-projects/projects'
import { formatDateDdMmmmYyyy } from '@/lib/dateUtils'

function formatCurrency(value: number): string {
  return `£${value.toFixed(2)}`
}

type ProjectForm = {
  id?: string
  vendor_id: string
  project_name: string
  brief: string
  internal_notes: string
  deadline: string
  budget_ex_vat: string
  budget_hours: string
  status: string
}

const emptyForm: ProjectForm = {
  vendor_id: '',
  project_name: '',
  brief: '',
  internal_notes: '',
  deadline: '',
  budget_ex_vat: '',
  budget_hours: '',
  status: 'active',
}

interface ProjectsClientProps {
  initialProjects: any[]
}

export function ProjectsClient({ initialProjects }: ProjectsClientProps): React.ReactElement {
  const router = useRouter()
  const { hasPermission } = usePermissions()
  const canCreate = hasPermission('oj_projects', 'create')
  const canEdit = hasPermission('oj_projects', 'edit')
  const canDelete = hasPermission('oj_projects', 'delete')

  const [projects, setProjects] = useState(initialProjects)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('active')
  const [modalOpen, setModalOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<ProjectForm>(emptyForm)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const isEditing = !!form.id

  const filtered = useMemo(() => {
    let list = projects
    if (statusFilter && statusFilter !== 'all') {
      list = list.filter((p) => p.status === statusFilter)
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(
        (p) =>
          p.project_name?.toLowerCase().includes(q) ||
          p.project_code?.toLowerCase().includes(q) ||
          p.vendor?.name?.toLowerCase().includes(q),
      )
    }
    return list
  }, [projects, search, statusFilter])

  const reload = useCallback(async () => {
    const res = await getProjects({ status: 'all' })
    if (res.projects) setProjects(res.projects)
  }, [])

  function openCreate(): void {
    setForm(emptyForm)
    setModalOpen(true)
  }

  function openEdit(project: any): void {
    setForm({
      id: project.id,
      vendor_id: project.vendor_id,
      project_name: project.project_name || '',
      brief: project.brief || '',
      internal_notes: project.internal_notes || '',
      deadline: project.deadline || '',
      budget_ex_vat: project.budget_ex_vat != null ? String(project.budget_ex_vat) : '',
      budget_hours: project.budget_hours != null ? String(project.budget_hours) : '',
      status: project.status || 'active',
    })
    setModalOpen(true)
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setSaving(true)
    try {
      const fd = new FormData()
      fd.append('vendor_id', form.vendor_id)
      fd.append('project_name', form.project_name)
      fd.append('brief', form.brief)
      fd.append('internal_notes', form.internal_notes)
      fd.append('deadline', form.deadline)
      fd.append('budget_ex_vat', form.budget_ex_vat)
      fd.append('budget_hours', form.budget_hours)
      fd.append('status', form.status)
      if (form.id) fd.append('id', form.id)

      const res = form.id ? await updateProject(fd) : await createProject(fd)
      if (res.error) throw new Error(res.error)
      toast.success(form.id ? 'Project updated' : 'Project created')
      setModalOpen(false)
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save project')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(): Promise<void> {
    if (!deleteId) return
    try {
      const fd = new FormData()
      fd.append('id', deleteId)
      const res = await deleteProject(fd)
      if (res.error) throw new Error(res.error)
      toast.success('Project deleted')
      setDeleteId(null)
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete project')
    }
  }

  const statusTone = (status: string): 'success' | 'warning' | 'info' | 'neutral' => {
    switch (status) {
      case 'active': return 'success'
      case 'paused': return 'warning'
      case 'completed': return 'info'
      default: return 'neutral'
    }
  }

  const statusOptions = [
    { label: 'All', value: 'all' },
    { label: 'Active', value: 'active' },
    { label: 'Paused', value: 'paused' },
    { label: 'Completed', value: 'completed' },
    { label: 'Archived', value: 'archived' },
  ]

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex gap-3 items-center flex-1 w-full sm:w-auto">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search projects..."
            className="flex-1 sm:max-w-xs"
          />
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            options={statusOptions}
            className="w-36"
          />
        </div>
        {canCreate && (
          <Button onClick={openCreate} icon="plus" size="sm">
            New Project
          </Button>
        )}
      </div>

      {/* Table */}
      <Card>
        {filtered.length === 0 ? (
          <Empty title="No projects" description="No projects match your filters." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project Name</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Budget</TableHead>
                <TableHead>Hours Logged</TableHead>
                <TableHead>Last Entry</TableHead>
                <TableHead className="w-20">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((project) => {
                const budgetHours = Number(project.budget_hours || 0)
                const usedHours = Number(project.total_hours_used || 0)
                const budgetMoney = Number(project.budget_ex_vat || 0)
                const spentMoney = Number(project.total_spend_ex_vat || 0)
                const hasBudget = budgetHours > 0 || budgetMoney > 0
                const progress = budgetHours > 0
                  ? Math.min((usedHours / budgetHours) * 100, 100)
                  : budgetMoney > 0
                    ? Math.min((spentMoney / budgetMoney) * 100, 100)
                    : 0

                return (
                  <TableRow
                    key={project.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/oj-projects/projects/${project.id}`)}
                  >
                    <TableCell>
                      <div>
                        <span className="font-medium">{project.project_name}</span>
                        <span className="block text-xs text-text-muted">{project.project_code}</span>
                      </div>
                    </TableCell>
                    <TableCell>{project.vendor?.name || 'Unknown'}</TableCell>
                    <TableCell>
                      <Badge tone={statusTone(project.status)}>{project.status}</Badge>
                    </TableCell>
                    <TableCell>
                      {hasBudget ? (
                        <div className="flex flex-col gap-1 min-w-[160px]">
                          <ProgressBar
                            value={progress}
                            tone={progress > 90 ? 'danger' : 'primary'}
                          />
                          <span className="text-xs text-text-muted">
                            {budgetHours > 0
                              ? `${formatCurrency(spentMoney)} / ${formatCurrency(budgetMoney > 0 ? budgetMoney : usedHours * 75)}`
                              : `${formatCurrency(spentMoney)} / ${formatCurrency(budgetMoney)}`}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-text-muted italic">No budget</span>
                      )}
                    </TableCell>
                    <TableCell>{usedHours.toFixed(1)}h</TableCell>
                    <TableCell className="text-text-muted">
                      {project.updated_at ? formatDateDdMmmmYyyy(project.updated_at) : '-'}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                        {canEdit && (
                          <IconButton
                            icon="edit"
                            size="sm"
                            label="Edit"
                            onClick={() => openEdit(project)}
                          />
                        )}
                        {canDelete && (
                          <IconButton
                            icon="trash"
                            size="sm"
                            label="Delete"
                            onClick={() => setDeleteId(project.id)}
                          />
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* Create/Edit Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={isEditing ? 'Edit Project' : 'New Project'}
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Field label="Project Name" required>
            <Input
              value={form.project_name}
              onChange={(e) => setForm({ ...form, project_name: e.target.value })}
              placeholder="e.g. Website Redesign"
              required
            />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Status">
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
              >
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="completed">Completed</option>
                <option value="archived">Archived</option>
              </select>
            </Field>
            <Field label="Deadline">
              <Input
                type="date"
                value={form.deadline}
                onChange={(e) => setForm({ ...form, deadline: e.target.value })}
              />
            </Field>
            <Field label="Budget (ex VAT)">
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.budget_ex_vat}
                onChange={(e) => setForm({ ...form, budget_ex_vat: e.target.value })}
                placeholder="0.00"
              />
            </Field>
            <Field label="Budget (hours)">
              <Input
                type="number"
                min="0"
                step="0.25"
                value={form.budget_hours}
                onChange={(e) => setForm({ ...form, budget_hours: e.target.value })}
                placeholder="Optional"
              />
            </Field>
          </div>
          <Field label="Brief">
            <Textarea
              value={form.brief}
              onChange={(e) => setForm({ ...form, brief: e.target.value })}
              rows={3}
              placeholder="Project overview..."
            />
          </Field>
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="ghost" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              {isEditing ? 'Save Changes' : 'Create Project'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete Project"
        message="Are you sure? You can only delete projects with no entries."
        confirmLabel="Delete"
        tone="danger"
      />
    </div>
  )
}
