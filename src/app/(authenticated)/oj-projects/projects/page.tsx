'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Card } from '@/components/ui-v2/layout/Card'
import { Button, IconButton } from '@/components/ui-v2/forms/Button'
import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
import { Input } from '@/components/ui-v2/forms/Input'
import { Select } from '@/components/ui-v2/forms/Select'
import { Textarea } from '@/components/ui-v2/forms/Textarea'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { Modal, ModalActions } from '@/components/ui-v2/overlay/Modal'
import { usePermissions } from '@/contexts/PermissionContext'
import { getVendors } from '@/app/actions/vendors'
import { createProject, deleteProject, getProjects, updateProject, updateProjectStatus } from '@/app/actions/oj-projects/projects'
import type { InvoiceVendor } from '@/types/invoices'
import {
  Archive,
  Briefcase,
  Building2,
  Calendar,
  CheckCircle2,
  CircleDollarSign,
  Clock,
  Edit2,
  FileText,
  LayoutDashboard,
  List,
  MoreHorizontal,
  PauseCircle,
  Plus,
  Trash2,
  Users
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatDateDdMmmmYyyy } from '@/lib/dateUtils'

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

export default function OJProjectsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { hasPermission, loading: permissionsLoading } = usePermissions()
  const canView = hasPermission('oj_projects', 'view')
  const canCreate = hasPermission('oj_projects', 'create')
  const canEdit = hasPermission('oj_projects', 'edit')
  const canDelete = hasPermission('oj_projects', 'delete')

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [vendors, setVendors] = useState<InvoiceVendor[]>([])
  const [projects, setProjects] = useState<any[]>([])

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<ProjectForm>({
    vendor_id: '',
    project_name: '',
    brief: '',
    internal_notes: '',
    deadline: '',
    budget_ex_vat: '',
    budget_hours: '',
    status: 'active',
  })

  const [showClosed, setShowClosed] = useState(false)

  const canWrite = canCreate || canEdit
  const isEditing = !!form.id

  useEffect(() => {
    if (permissionsLoading) return
    if (!canView) {
      router.replace('/unauthorized')
      return
    }
    load()
  }, [permissionsLoading, canView])

  useEffect(() => {
    if (loading) return
    if (isModalOpen) return

    const openNew = searchParams.get('new') === '1'
    const editId = searchParams.get('edit')

    if (openNew) {
      openCreate()
      router.replace('/oj-projects/projects')
      return
    }

    if (editId) {
      const project = projects.find((p) => p.id === editId)
      if (project) {
        openEdit(project)
      }
      router.replace('/oj-projects/projects')
    }
  }, [loading, isModalOpen, projects, router, searchParams])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [vendorsRes, projectsRes] = await Promise.all([getVendors(), getProjects({ status: 'all' })])
      if (vendorsRes.error || !vendorsRes.vendors) throw new Error(vendorsRes.error || 'Failed to load vendors')
      if (projectsRes.error || !projectsRes.projects) throw new Error(projectsRes.error || 'Failed to load projects')
      setVendors(vendorsRes.vendors)
      setProjects(projectsRes.projects)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load projects')
    } finally {
      setLoading(false)
    }
  }

  function openCreate() {
    if (!canCreate) {
      toast.error('You do not have permission to create projects')
      return
    }
    setForm({
      vendor_id: '',
      project_name: '',
      brief: '',
      internal_notes: '',
      deadline: '',
      budget_ex_vat: '',
      budget_hours: '',
      status: 'active',
    })
    setIsModalOpen(true)
  }

  function openEdit(project: any) {
    if (!canEdit) {
      toast.error('You do not have permission to edit projects')
      return
    }
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
    setIsModalOpen(true)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (isEditing && !canEdit) return
    if (!isEditing && !canCreate) return

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
      setIsModalOpen(false)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save project')
    } finally {
      setSaving(false)
    }
  }

  async function removeProject(projectId: string, e?: React.MouseEvent) {
    if (e) e.stopPropagation()
    if (!canDelete) {
      toast.error('You do not have permission to delete projects')
      return
    }
    if (!window.confirm('Delete this project? You can only delete projects with no entries.')) return

    try {
      const fd = new FormData()
      fd.append('id', projectId)
      const res = await deleteProject(fd)
      if (res.error) throw new Error(res.error)
      toast.success('Project deleted')
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete project')
    }
  }

  const vendorNameById = useMemo(() => new Map(vendors.map((v) => [v.id, v.name])), [vendors])

  if (permissionsLoading || loading) {
    return <PageLayout title="Projects" subtitle="OJ Projects" loading loadingLabel="Loading Projects…" />
  }

  const navItems = [
    { label: 'Dashboard', href: '/oj-projects', icon: <LayoutDashboard className="w-4 h-4" /> },
    { label: 'Projects', href: '/oj-projects/projects', active: true, icon: <Briefcase className="w-4 h-4" /> },
    { label: 'Entries', href: '/oj-projects/entries', icon: <List className="w-4 h-4" /> },
    { label: 'Clients', href: '/oj-projects/clients', icon: <Users className="w-4 h-4" /> },
    { label: 'Work Types', href: '/oj-projects/work-types', icon: <List className="w-4 h-4" /> },
  ]

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active': return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800"><CheckCircle2 className="w-3 h-3 mr-1" /> Active</span>
      case 'paused': return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800"><PauseCircle className="w-3 h-3 mr-1" /> Paused</span>
      case 'completed': return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800"><CheckCircle2 className="w-3 h-3 mr-1" /> Completed</span>
      case 'archived': return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800"><Archive className="w-3 h-3 mr-1" /> Archived</span>
      default: return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">{status}</span>
    }
  }

  const filteredProjects = projects.filter(p => {
    if (showClosed) return true
    return p.status !== 'completed' && p.status !== 'archived'
  })

  return (
    <PageLayout
      title="Projects"
      subtitle="Client projects and budgets"
      navItems={navItems}
      headerActions={
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showClosed}
              onChange={e => setShowClosed(e.target.checked)}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            Show Closed
          </label>
          <Button onClick={openCreate} disabled={!canCreate}>
            <Plus className="w-4 h-4 mr-2" />
            New Project
          </Button>
        </div>
      }
    >
      {error && <Alert variant="error" description={error} className="mb-6" />}

      {filteredProjects.length === 0 ? (
        <Card className="p-12 text-center text-gray-500 border-dashed border-2 bg-gray-50">
          <Briefcase className="w-12 h-12 mx-auto text-gray-400 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-1">No projects found</h3>
          <p className="mb-6">
            {projects.length > 0
              ? "No active projects. Toggle 'Show Closed' to view history."
              : "Get started by creating your first client project."}
          </p>
          <Button onClick={openCreate} disabled={!canCreate} variant="secondary">Create Project</Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {filteredProjects.map((p) => (
            <Card
              key={p.id}
              className="group hover:ring-1 hover:ring-blue-500 transition-all cursor-pointer relative overflow-hidden"
              onClick={() => router.push(`/oj-projects/projects/${p.id}`)}
              padding="none"
            >
              <div className="p-5 flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded uppercase tracking-wider">
                      {p.project_code}
                    </span>
                    {p.is_retainer && (
                      <span className="text-xs font-medium text-indigo-700 bg-indigo-100 px-1.5 py-0.5 rounded">
                        Retainer{p.retainer_period_yyyymm ? ` ${p.retainer_period_yyyymm}` : ''}
                      </span>
                    )}
                    {getStatusBadge(p.status)}
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900 group-hover:text-blue-600 transition-colors mb-1 truncate">
                    {p.project_name}
                  </h3>
                  <div className="flex items-center gap-4 text-sm text-gray-500 mb-3">
                    <span className="flex items-center gap-1">
                      <Building2 className="w-3.5 h-3.5" />
                      {vendorNameById.get(p.vendor_id) || 'Unknown Client'}
                    </span>
                    {p.deadline && (
                      <span className={cn(
                        "flex items-center gap-1 font-medium",
                        new Date(p.deadline) < new Date() ? "text-red-600" : "text-gray-700"
                      )}>
                        <Calendar className="w-3.5 h-3.5" />
                        Due {formatDateDdMmmmYyyy(p.deadline)}
                      </span>
                    )}
                  </div>

                  {/* Budget Usage Section */}
                  <div className="space-y-2 mt-2">
                    {p.budget_hours > 0 ? (
                      <div>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-gray-600">
                            Hours: <strong>{Number(p.total_hours_used).toFixed(2)}</strong> / {Number(p.budget_hours).toFixed(2)}
                          </span>
                          <span className={cn(
                            "font-medium",
                            p.budget_hours - p.total_hours_used < 0 ? "text-red-600" : "text-green-700"
                          )}>
                            {p.budget_hours - p.total_hours_used < 0 ? 'Over: ' : 'Remaining: '}
                            {Math.abs(p.budget_hours - p.total_hours_used).toFixed(2)}h
                          </span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                          <div
                            className={cn("h-1.5 rounded-full", p.total_hours_used > p.budget_hours ? "bg-red-500" : "bg-blue-500")}
                            style={{ width: `${Math.min((p.total_hours_used / p.budget_hours) * 100, 100)}%` }}
                          />
                        </div>
                      </div>
                    ) : p.budget_ex_vat > 0 ? (
                      <div>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-gray-600">
                            Budget: <strong>£{Number(p.total_spend_ex_vat).toFixed(2)}</strong> / £{Number(p.budget_ex_vat).toFixed(2)}
                          </span>
                          <span className={cn(
                            "font-medium",
                            p.budget_ex_vat - p.total_spend_ex_vat < 0 ? "text-red-600" : "text-green-700"
                          )}>
                            {p.budget_ex_vat - p.total_spend_ex_vat < 0 ? 'Over: ' : 'Remaining: '}
                            £{Math.abs(p.budget_ex_vat - p.total_spend_ex_vat).toFixed(2)}
                          </span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                          <div
                            className={cn("h-1.5 rounded-full", p.total_spend_ex_vat > p.budget_ex_vat ? "bg-red-500" : "bg-emerald-500")}
                            style={{ width: `${Math.min((p.total_spend_ex_vat / p.budget_ex_vat) * 100, 100)}%` }}
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs text-gray-400 italic">No budget set</div>
                    )}
                  </div>

                  {p.brief && (
                    <p className="text-sm text-gray-600 mt-3 line-clamp-2">{p.brief}</p>
                  )}
                </div>

                <div className="flex items-center gap-1 sm:self-center shrink-0">
                  {p.status !== 'completed' && p.status !== 'archived' && (
                    <IconButton
                      variant="ghost"
                      size="sm"
                      onClick={async (e) => {
                        e.stopPropagation()
                        if (!canEdit) return
                        if (!window.confirm('Mark as completed?')) return

                        const fd = new FormData()
                        fd.append('id', p.id)
                        fd.append('status', 'completed')
                        await updateProjectStatus(fd)
                        load()
                      }}
                      disabled={!canEdit}
                      className="text-gray-400 hover:text-green-600"
                      title="Mark as Completed"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                    </IconButton>
                  )}
                  <IconButton
                    variant="ghost"
                    size="sm"
                    onClick={(e) => { e.stopPropagation(); openEdit(p); }}
                    disabled={!canEdit}
                    className="text-gray-400 hover:text-gray-600"
                    title="Edit"
                    aria-label="Edit project"
                  >
                    <Edit2 className="w-4 h-4" />
                  </IconButton>
                  <IconButton
                    variant="ghost"
                    size="sm"
                    onClick={(e) => removeProject(p.id, e)}
                    disabled={!canDelete}
                    className="text-gray-400 hover:text-red-600"
                    title="Delete"
                    aria-label="Delete project"
                  >
                    <Trash2 className="w-4 h-4" />
                  </IconButton>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={isModalOpen} onClose={() => setIsModalOpen(false)} title={isEditing ? 'Edit Project' : 'New Project'}>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormGroup label="Client" required>
              <Select value={form.vendor_id} onChange={(e) => setForm({ ...form, vendor_id: e.target.value })} required>
                <option value="">Select a client</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </Select>
            </FormGroup>

            <FormGroup label="Status">
              <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="completed">Completed</option>
                <option value="archived">Archived</option>
              </Select>
            </FormGroup>

            <div className="md:col-span-2">
              <FormGroup label="Project Name" required>
                <Input
                  value={form.project_name}
                  onChange={(e) => setForm({ ...form, project_name: e.target.value })}
                  required
                  placeholder="e.g. Website Redesign"
                />
              </FormGroup>
            </div>

            <FormGroup label="Deadline">
              <Input type="date" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} />
            </FormGroup>

            <FormGroup label="Budget (ex VAT)">
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.budget_ex_vat}
                onChange={(e) => setForm({ ...form, budget_ex_vat: e.target.value })}
                leftElement={<span className="text-gray-500 pl-3">£</span>}
              />
            </FormGroup>

            <div className="md:col-span-2">
              <FormGroup label="Budget (hours)">
                <Input
                  type="number"
                  min="0"
                  step="0.25"
                  value={form.budget_hours}
                  onChange={(e) => setForm({ ...form, budget_hours: e.target.value })}
                  placeholder="Optional"
                  rightElement={<span className="text-gray-500 pr-3">hrs</span>}
                />
              </FormGroup>
            </div>

            <div className="md:col-span-2">
              <FormGroup label="Brief">
                <Textarea
                  value={form.brief}
                  onChange={(e) => setForm({ ...form, brief: e.target.value })}
                  rows={3}
                  placeholder="Project overview..."
                />
              </FormGroup>
            </div>

            <div className="md:col-span-2">
              <FormGroup label="Internal Notes">
                <Textarea
                  value={form.internal_notes}
                  onChange={(e) => setForm({ ...form, internal_notes: e.target.value })}
                  rows={3}
                  placeholder="Private team notes..."
                />
              </FormGroup>
            </div>
          </div>

          <ModalActions>
            <Button type="button" variant="secondary" onClick={() => setIsModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving} disabled={!canWrite || saving}>
              {isEditing ? 'Save Changes' : 'Create Project'}
            </Button>
          </ModalActions>
        </form>
      </Modal>
    </PageLayout>
  )
}
