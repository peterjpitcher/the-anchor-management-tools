'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Card, CardTitle } from '@/components/ui-v2/layout/Card'
import { Button } from '@/components/ui-v2/forms/Button'
import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
import { Select } from '@/components/ui-v2/forms/Select'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { usePermissions } from '@/contexts/PermissionContext'
import { deleteProject, getProject, updateProjectStatus } from '@/app/actions/oj-projects/projects'
import { addProjectContact, removeProjectContact } from '@/app/actions/oj-projects/project-contacts'
import { getVendorContacts } from '@/app/actions/vendor-contacts'
import { getEntries } from '@/app/actions/oj-projects/entries'
import { formatDateDdMmmmYyyy } from '@/lib/dateUtils'
import {
  ArrowLeft,
  Briefcase,
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  CreditCard,
  Edit,
  LayoutDashboard,
  List,
  Mail,
  MapPin,
  Phone,
  Plus,
  Tag,
  Trash2,
  UserPlus,
  Users
} from 'lucide-react'

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function formatCurrency(value: number) {
  return `£${value.toFixed(2)}`
}

export default function OJProjectDetailPage() {
  const router = useRouter()
  const params = useParams()
  const projectId = String((params as any)?.id || '')

  const { hasPermission, loading: permissionsLoading } = usePermissions()
  const canView = hasPermission('oj_projects', 'view')
  const canEdit = hasPermission('oj_projects', 'edit')
  const canDelete = hasPermission('oj_projects', 'delete')

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [project, setProject] = useState<any | null>(null)
  const [vendorContacts, setVendorContacts] = useState<any[]>([])
  const [entries, setEntries] = useState<any[]>([])

  const [contactToAdd, setContactToAdd] = useState('')
  const [savingContact, setSavingContact] = useState(false)

  useEffect(() => {
    if (permissionsLoading) return
    if (!canView) {
      router.replace('/unauthorized')
      return
    }
    if (!projectId) {
      setError('Missing project ID')
      setLoading(false)
      return
    }
    load()
  }, [permissionsLoading, canView, projectId])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const projectRes = await getProject(projectId)
      if (projectRes.error || !projectRes.project) throw new Error(projectRes.error || 'Failed to load project')

      const vendorId = projectRes.project.vendor_id

      const [contactsRes, entriesRes] = await Promise.all([
        getVendorContacts(vendorId),
        getEntries({ projectId, limit: 1000 }),
      ])

      if (contactsRes.error) throw new Error(contactsRes.error)
      if (entriesRes.error) throw new Error(entriesRes.error)

      setProject(projectRes.project)
      setVendorContacts(contactsRes.contacts || [])
      setEntries(entriesRes.entries || [])
      setContactToAdd('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load project')
    } finally {
      setLoading(false)
    }
  }

  const totals = useMemo(() => {
    const t = {
      hours: 0,
      total_ex_vat: 0,
      unbilled_ex_vat: 0,
      billed_ex_vat: 0,
      paid_ex_vat: 0,
    }

    for (const entry of entries) {
      if (!entry?.billable) continue

      let exVat = 0
      if (entry.entry_type === 'time') {
        const minutes = Number(entry.duration_minutes_rounded || 0)
        const hours = minutes / 60
        const rate = Number(entry.hourly_rate_ex_vat_snapshot || 0)
        exVat = hours * rate
        t.hours += hours
      } else if (entry.entry_type === 'mileage') {
        const miles = Number(entry.miles || 0)
        const rate = Number(entry.mileage_rate_snapshot || 0.42)
        exVat = miles * rate
      }

      exVat = roundCurrency(exVat)
      t.total_ex_vat += exVat
      if (entry.status === 'paid') t.paid_ex_vat += exVat
      else if (entry.status === 'billed') t.billed_ex_vat += exVat
      else t.unbilled_ex_vat += exVat
    }

    t.hours = roundCurrency(t.hours)
    t.total_ex_vat = roundCurrency(t.total_ex_vat)
    t.unbilled_ex_vat = roundCurrency(t.unbilled_ex_vat)
    t.billed_ex_vat = roundCurrency(t.billed_ex_vat)
    t.paid_ex_vat = roundCurrency(t.paid_ex_vat)
    return t
  }, [entries])

  const budget = project?.budget_ex_vat != null ? Number(project.budget_ex_vat) : null
  const remainingBudget = useMemo(() => {
    if (budget == null) return null
    return roundCurrency(budget - totals.total_ex_vat)
  }, [budget, totals.total_ex_vat])

  const budgetHours = project?.budget_hours != null ? Number(project.budget_hours) : null
  const remainingHours = useMemo(() => {
    if (budgetHours == null) return null
    return roundCurrency(budgetHours - totals.hours)
  }, [budgetHours, totals.hours])

  const percentageUsed = useMemo(() => {
    if (budget == null || budget === 0) return 0
    const used = (totals.total_ex_vat / budget) * 100
    return Math.min(used, 100)
  }, [budget, totals.total_ex_vat])

  const percentageHoursUsed = useMemo(() => {
    if (budgetHours == null || budgetHours === 0) return 0
    const used = (totals.hours / budgetHours) * 100
    return Math.min(used, 100)
  }, [budgetHours, totals.hours])

  const taggedContacts = useMemo(() => {
    const list = Array.isArray(project?.contacts) ? project.contacts : []
    return list.map((pc: any) => ({
      id: pc.id,
      contact: pc.contact,
    }))
  }, [project])

  const availableContactsToTag = useMemo(() => {
    const taggedIds = new Set(taggedContacts.map((t: any) => t.contact?.id).filter(Boolean))
    return (vendorContacts || []).filter((c) => c?.id && !taggedIds.has(c.id))
  }, [vendorContacts, taggedContacts])

  async function addContactTag() {
    if (!canEdit) {
      toast.error('You do not have permission to edit projects')
      return
    }
    if (!contactToAdd) return

    setSavingContact(true)
    try {
      const fd = new FormData()
      fd.append('project_id', projectId)
      fd.append('contact_id', contactToAdd)
      const res = await addProjectContact(fd)
      if (res.error) throw new Error(res.error)
      toast.success('Contact tagged')
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to tag contact')
    } finally {
      setSavingContact(false)
    }
  }

  async function removeContactTag(id: string) {
    if (!canEdit) {
      toast.error('You do not have permission to edit projects')
      return
    }
    if (!window.confirm('Remove this contact from the project?')) return

    try {
      const fd = new FormData()
      fd.append('id', id)
      const res = await removeProjectContact(fd)
      if (res.error) throw new Error(res.error)
      toast.success('Contact removed')
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove contact')
    }
  }

  async function deleteThisProject() {
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
      router.push('/oj-projects/projects')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete project')
    }
  }

  if (permissionsLoading || loading) {
    return <PageLayout title="Project" subtitle="OJ Projects" loading loadingLabel="Loading Details…" />
  }

  if (!project) {
    return (
      <PageLayout title="Project" subtitle="OJ Projects" backButton={{ label: 'Back to Projects', href: '/oj-projects/projects' }}>
        {error ? <Alert variant="error" description={error} /> : <div className="text-sm text-gray-600">Not found.</div>}
      </PageLayout>
    )
  }

  const navItems = [
    { label: 'Dashboard', href: '/oj-projects', icon: <LayoutDashboard className="w-4 h-4" /> },
    { label: 'Projects', href: '/oj-projects/projects', active: true, icon: <Briefcase className="w-4 h-4" /> },
    { label: 'Entries', href: '/oj-projects/entries', icon: <List className="w-4 h-4" /> },
    { label: 'Clients', href: '/oj-projects/clients', icon: <Users className="w-4 h-4" /> },
    { label: 'Work Types', href: '/oj-projects/work-types', icon: <List className="w-4 h-4" /> },
  ]

  return (
    <PageLayout
      title={project.project_code}
      subtitle={project.project_name}
      navItems={navItems}
      backButton={{ label: 'Back to Projects', href: '/oj-projects/projects' }}
      headerActions={
        <div className="flex gap-2">
          <Button
            variant="secondary"
            disabled={!canEdit}
            onClick={() => router.push(`/oj-projects/projects?edit=${projectId}`)}
            title={!canEdit ? 'You do not have permission to edit projects' : undefined}
          >
            <Edit className="w-4 h-4 mr-2" />
            Edit Project
          </Button>
        </div>
      }
    >
      {error && <Alert variant="error" description={error} className="mb-6" />}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">

        {/* Project Info & Budget */}
        <div className="lg:col-span-2 space-y-6">
          {/* Budget Card */}
          <Card className="overflow-visible relative" padding="lg">
            <div className="flex items-start justify-between gap-4 mb-6">
              <div>
                <h3 className="text-gray-500 font-medium text-sm flex items-center gap-2">
                  <CreditCard className="w-4 h-4" /> Project Budget
                </h3>
                <div className="text-3xl font-bold mt-2 text-gray-900">
                  {budget != null ? formatCurrency(budget) : 'No Budget Set'}
                </div>
                {remainingBudget != null && (
                  <div className={`text-sm mt-1 font-medium ${remainingBudget < 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {remainingBudget >= 0 ? 'Remaining available: ' : 'Over budget: '} {formatCurrency(Math.abs(remainingBudget))}
                  </div>
                )}
              </div>

              <div className="text-right">
                <h3 className="text-gray-500 font-medium text-sm mb-2">Total Value (ex VAT)</h3>
                <div className="text-2xl font-semibold text-gray-800">
                  {formatCurrency(totals.total_ex_vat)}
                </div>
                <div className="text-sm text-gray-500 mt-1">
                  {totals.hours.toFixed(2)} billable hours
                </div>
              </div>
            </div>

            {/* Progress Bar for Budget */}
            {budget != null && (
              <div className="w-full bg-gray-100 rounded-full h-2.5 mb-6 overflow-hidden">
                <div
                  className={`h-2.5 rounded-full ${percentageUsed > 100 ? 'bg-red-500' : 'bg-blue-600'}`}
                  style={{ width: `${Math.min(percentageUsed, 100)}%` }}
                ></div>
              </div>
            )}

            <div className="grid grid-cols-3 gap-4 border-t border-gray-100 pt-6">
              <div>
                <div className="text-sm text-gray-500 mb-1">Unbilled</div>
                <div className="font-semibold text-gray-900">{formatCurrency(totals.unbilled_ex_vat)}</div>
              </div>
              <div>
                <div className="text-sm text-gray-500 mb-1">Billed</div>
                <div className="font-semibold text-blue-600">{formatCurrency(totals.billed_ex_vat)}</div>
              </div>
              <div>
                <div className="text-sm text-gray-500 mb-1">Paid</div>
                <div className="font-semibold text-green-600">{formatCurrency(totals.paid_ex_vat)}</div>
              </div>
            </div>
          </Card>

          {/* Hours Budget */}
          {budgetHours != null && (
            <Card className="overflow-visible relative" padding="lg">
              <div className="flex items-start justify-between gap-4 mb-6">
                <div>
                  <h3 className="text-gray-500 font-medium text-sm flex items-center gap-2">
                    <Clock className="w-4 h-4" /> Hours Budget
                  </h3>
                  <div className="text-3xl font-bold mt-2 text-gray-900">
                    {budgetHours.toFixed(2)}h
                  </div>
                  {remainingHours != null && (
                    <div className={`text-sm mt-1 font-medium ${remainingHours < 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {remainingHours >= 0 ? 'Remaining available: ' : 'Over budget: '} {Math.abs(remainingHours).toFixed(2)}h
                    </div>
                  )}
                </div>

                <div className="text-right">
                  <h3 className="text-gray-500 font-medium text-sm mb-2">Hours Used</h3>
                  <div className="text-2xl font-semibold text-gray-800">
                    {totals.hours.toFixed(2)}h
                  </div>
                </div>
              </div>

              <div className="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden">
                <div
                  className={`h-2.5 rounded-full ${totals.hours > budgetHours ? 'bg-red-500' : 'bg-blue-600'}`}
                  style={{ width: `${Math.min(percentageHoursUsed, 100)}%` }}
                ></div>
              </div>
            </Card>
          )}

          {/* Project Entries */}
          <Card
            header={
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <List className="w-5 h-5 text-gray-400" />
                  <CardTitle>Project Entries</CardTitle>
                </div>
                <div className="text-sm text-gray-500">
                  {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
                </div>
              </div>
            }
            padding="none"
          >
            {entries.length === 0 ? (
              <div className="text-center py-12 text-gray-500">No entries recorded yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Work</th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Description</th>
                      <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {entries.map((entry) => (
                      <tr key={entry.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {formatDateDdMmmmYyyy(entry.entry_date)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {entry.entry_type === 'time' ? (
                            <div className="flex flex-col">
                              <span className="font-medium">{formatCurrency((Number(entry.duration_minutes_rounded || 0) / 60) * Number(entry.hourly_rate_ex_vat_snapshot || 0))}</span>
                              <span className="text-xs text-gray-500">{(Number(entry.duration_minutes_rounded || 0) / 60)} hours</span>
                            </div>
                          ) : (
                            <div className="flex flex-col">
                              <span className="font-medium">{formatCurrency(Number(entry.miles || 0) * Number(entry.mileage_rate_snapshot || 0.42))}</span>
                              <span className="text-xs text-gray-500">{entry.miles} miles</span>
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-500 max-w-md truncate" title={entry.description}>
                          {entry.description || '-'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize
                            ${entry.status === 'unbilled' ? 'bg-amber-100 text-amber-800' :
                              entry.status === 'paid' ? 'bg-green-100 text-green-800' :
                                'bg-gray-100 text-gray-800'
                            }`}
                          >
                            {entry.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">

          {/* Client/Project Info */}
          <Card
            className="bg-gray-50 border-gray-200"
            header={<CardTitle>Project Details</CardTitle>}
          >
            <div className="space-y-4">
              <div>
                <div className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-1">Status</div>
                <div className="flex items-center gap-2">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${project.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                    }`}>
                    {project.status === 'active' && <CheckCircle2 className="w-3 h-3 mr-1" />}
                    {project.status.toUpperCase()}
                  </span>
                </div>
              </div>

              <div>
                <div className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-1">Client</div>
                <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
                  <Building2 className="w-4 h-4 text-gray-400" />
                  {project.vendor?.name || 'Unknown Client'}
                </div>
              </div>

              {project.is_retainer && (
                <div>
                  <div className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-1">Retainer Period</div>
                  <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
                    <span>{project.retainer_period_yyyymm || '—'}</span>
                  </div>
                </div>
              )}

              {project.deadline && (
                <div>
                  <div className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-1">Deadline</div>
                  <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
                    <Calendar className="w-4 h-4 text-gray-400" />
                    {formatDateDdMmmmYyyy(project.deadline)}
                  </div>
                </div>
              )}

              {project.internal_notes && (
                <div className="pt-4 border-t border-gray-200">
                  <div className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-2">Internal Notes</div>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{project.internal_notes}</p>
                </div>
              )}
            </div>
          </Card>

          {/* Tagged Contacts */}
          <Card
            header={
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-gray-400" />
                <CardTitle>Tagged Contacts</CardTitle>
              </div>
            }
          >
            <div className="space-y-3 mb-4">
              {taggedContacts.length === 0 ? (
                <div className="text-sm text-gray-500 italic">No contacts tagged.</div>
              ) : (
                taggedContacts.map((tc: any) => (
                  <div key={tc.id} className="flex items-start justify-between gap-2 p-2 rounded bg-gray-50 border border-gray-100">
                    <div className="min-w-0">
                      <div className="font-medium text-sm truncate">{tc.contact?.name || 'Unknown'}</div>
                      <div className="text-xs text-gray-500 truncate">{tc.contact?.email}</div>
                    </div>
                    <button
                      onClick={() => removeContactTag(tc.id)}
                      disabled={!canEdit}
                      className="text-gray-400 hover:text-red-500 p-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="flex gap-2">
              <Select
                value={contactToAdd}
                onChange={(e) => setContactToAdd(e.target.value)}
                disabled={!canEdit}
                className="text-sm"
              >
                <option value="">Select contact...</option>
                {availableContactsToTag.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
              <Button
                onClick={addContactTag}
                loading={savingContact}
                disabled={!canEdit || savingContact || !contactToAdd}
                size="sm"
              >
                <Plus className="w-4 h-4" />
              </Button>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              Tag internal contacts relevant to this project.
            </p>
          </Card>

          <div className="pt-4 space-y-3">
            {project.status !== 'completed' && project.status !== 'archived' ? (
              <Button
                variant="secondary"
                className="w-full justify-center text-green-700 hover:text-green-800 hover:bg-green-50 border-green-200"
                disabled={!canEdit}
                onClick={async () => {
                  if (!window.confirm('Mark project as completed? This will update the status and prevent further entries.')) return
                  const fd = new FormData()
                  fd.append('id', projectId)
                  fd.append('status', 'completed')
                  const res = await updateProjectStatus(fd)
                  if (!res.error) {
                    toast.success('Project completed')
                    load()
                  } else {
                    toast.error(res.error)
                  }
                }}
              >
                <CheckCircle2 className="w-4 h-4 mr-2" /> Mark as Completed
              </Button>
            ) : (
              <Button
                variant="secondary"
                className="w-full justify-center"
                disabled={!canEdit}
                onClick={async () => {
                  const fd = new FormData()
                  fd.append('id', projectId)
                  fd.append('status', 'active')
                  const res = await updateProjectStatus(fd)
                  if (!res.error) {
                    toast.success('Project re-activated')
                    load()
                  } else {
                    toast.error(res.error)
                  }
                }}
              >
                <CheckCircle2 className="w-4 h-4 mr-2" /> Re-activate Project
              </Button>
            )}

            <Button
              variant="danger"
              className="w-full justify-center"
              disabled={!canDelete}
              onClick={deleteThisProject}
            >
              <Trash2 className="w-4 h-4 mr-2" /> Delete Project
            </Button>
          </div>
        </div>
      </div>
    </PageLayout>
  )
}
