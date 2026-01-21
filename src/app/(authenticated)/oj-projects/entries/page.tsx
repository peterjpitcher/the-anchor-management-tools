'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PageLayout } from '@/components/ui-v2/layout/PageLayout'
import { Card } from '@/components/ui-v2/layout/Card'
import { Button } from '@/components/ui-v2/forms/Button'
import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
import { Input } from '@/components/ui-v2/forms/Input'
import { Select } from '@/components/ui-v2/forms/Select'
import { Textarea } from '@/components/ui-v2/forms/Textarea'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { Modal, ModalActions } from '@/components/ui-v2/overlay/Modal'
import { usePermissions } from '@/contexts/PermissionContext'
import { getVendors } from '@/app/actions/vendors'
import { getProjects } from '@/app/actions/oj-projects/projects'
import { getWorkTypes } from '@/app/actions/oj-projects/work-types'
import { deleteEntry, getEntries, updateEntry } from '@/app/actions/oj-projects/entries'
import type { InvoiceVendor } from '@/types/invoices'
import {
  Briefcase,
  Calendar,
  Clock,
  Edit2,
  Filter,
  LayoutDashboard,
  List,
  MapPin,
  RefreshCcw,
  Tag,
  Trash2,
  Users
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatDateDdMmmmYyyy } from '@/lib/dateUtils'

type EntryFormState = {
  id?: string
  entry_type: 'time' | 'mileage'
  vendor_id: string
  project_id: string
  entry_date: string
  start_time: string
  end_time: string
  duration_hours: number
  miles: string
  work_type_id: string
  description: string
  internal_notes: string
  billable: boolean
}

function monthRange(date: Date) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1)
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0)
  const toIso = (d: Date) => {
    const copy = new Date(d.getTime())
    const offsetMinutes = copy.getTimezoneOffset()
    copy.setMinutes(copy.getMinutes() - offsetMinutes)
    return copy.toISOString().split('T')[0]
  }
  return { start: toIso(start), end: toIso(end) }
}

function toLondonTimeHm(iso: string | null) {
  if (!iso) return ''
  try {
    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Europe/London',
    }).format(new Date(iso))
  } catch {
    return ''
  }
}

export default function OJProjectsEntriesPage() {
  const router = useRouter()
  const { hasPermission, loading: permissionsLoading } = usePermissions()
  const canView = hasPermission('oj_projects', 'view')
  const canEdit = hasPermission('oj_projects', 'edit')
  const canDelete = hasPermission('oj_projects', 'delete')

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [vendors, setVendors] = useState<InvoiceVendor[]>([])
  const [projects, setProjects] = useState<any[]>([])
  const [workTypes, setWorkTypes] = useState<any[]>([])
  const [entries, setEntries] = useState<any[]>([])

  const thisMonth = useMemo(() => monthRange(new Date()), [])
  const [vendorId, setVendorId] = useState('')
  const [projectId, setProjectId] = useState('')
  const [status, setStatus] = useState<'all' | 'unbilled' | 'billing_pending' | 'billed' | 'paid'>('all')
  const [entryType, setEntryType] = useState<'all' | 'time' | 'mileage'>('all')
  const [workTypeId, setWorkTypeId] = useState('')
  const [startDate, setStartDate] = useState(thisMonth.start)
  const [endDate, setEndDate] = useState(thisMonth.end)

  const [isEditOpen, setIsEditOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<EntryFormState>({
    entry_type: 'time',
    vendor_id: '',
    project_id: '',
    entry_date: '',
    start_time: '09:00',
    end_time: '10:00',
    duration_hours: 1.0,
    miles: '',
    work_type_id: '',
    description: '',
    internal_notes: '',
    billable: true,
  })

  // Collapsible filter state
  const [filtersOpen, setFiltersOpen] = useState(true)

  const vendorProjects = useMemo(
    () => projects.filter((p) => (vendorId ? p.vendor_id === vendorId : true)),
    [projects, vendorId]
  )

  useEffect(() => {
    if (permissionsLoading) return
    if (!canView) {
      router.replace('/unauthorized')
      return
    }
    load()
  }, [permissionsLoading, canView])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [vendorsRes, projectsRes, workTypesRes, entriesRes] = await Promise.all([
        getVendors(),
        getProjects({ status: 'all' }),
        getWorkTypes(),
        getEntries({
          vendorId: vendorId || undefined,
          projectId: projectId || undefined,
          status,
          entryType,
          startDate: startDate || undefined,
          endDate: endDate || undefined,
          limit: 1000,
        }),
      ])

      if (vendorsRes.error || !vendorsRes.vendors) throw new Error(vendorsRes.error || 'Failed to load clients')
      if (projectsRes.error || !projectsRes.projects) throw new Error(projectsRes.error || 'Failed to load projects')
      if (workTypesRes.error || !workTypesRes.workTypes) throw new Error(workTypesRes.error || 'Failed to load work types')
      if (entriesRes.error || !entriesRes.entries) throw new Error(entriesRes.error || 'Failed to load entries')

      setVendors(vendorsRes.vendors)
      setProjects(projectsRes.projects)
      setWorkTypes(workTypesRes.workTypes)

      const list = workTypeId
        ? (entriesRes.entries || []).filter((e) => String(e.work_type_id || '') === workTypeId)
        : entriesRes.entries || []
      setEntries(list)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load entries')
    } finally {
      setLoading(false)
    }
  }

  function openEdit(entry: any) {
    if (!canEdit) {
      toast.error('You do not have permission to edit entries')
      return
    }
    if (entry.status !== 'unbilled') {
      toast.error('Only unbilled entries can be edited')
      return
    }

    const durationHrs = entry.duration_minutes_raw ? entry.duration_minutes_raw / 60 : 1.0

    setForm({
      id: entry.id,
      entry_type: entry.entry_type,
      vendor_id: entry.vendor_id,
      project_id: entry.project_id,
      entry_date: entry.entry_date,
      start_time: toLondonTimeHm(entry.start_at) || '09:00',
      end_time: toLondonTimeHm(entry.end_at) || '',
      duration_hours: durationHrs,
      miles: entry.miles != null ? String(entry.miles) : '',
      work_type_id: entry.work_type_id || '',
      description: entry.description || '',
      internal_notes: entry.internal_notes || '',
      billable: entry.billable ?? true,
    })
    setIsEditOpen(true)
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.id) return
    if (!canEdit) return

    setSaving(true)
    try {
      const fd = new FormData()
      fd.append('id', form.id)
      fd.append('entry_type', form.entry_type)
      fd.append('vendor_id', form.vendor_id)
      fd.append('project_id', form.project_id)
      fd.append('entry_date', form.entry_date)
      fd.append('description', form.description)
      fd.append('internal_notes', form.internal_notes)
      fd.append('billable', String(form.billable))

      if (form.entry_type === 'time') {
        fd.append('start_time', form.start_time)
        fd.append('duration_minutes', String(form.duration_hours * 60))
        fd.append('work_type_id', form.work_type_id || '')
      } else {
        fd.append('miles', form.miles)
      }

      const res = await updateEntry(fd)
      if (res.error) throw new Error(res.error)

      toast.success('Entry updated')
      if ((res as any)?.warning) {
        toast.warning(String((res as any).warning))
      }
      setIsEditOpen(false)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update entry')
    } finally {
      setSaving(false)
    }
  }

  async function removeEntry(id: string) {
    if (!canDelete) {
      toast.error('You do not have permission to delete entries')
      return
    }
    if (!window.confirm('Delete this entry? This cannot be undone.')) return

    try {
      const fd = new FormData()
      fd.append('id', id)
      const res = await deleteEntry(fd)
      if (res.error) throw new Error(res.error)
      toast.success('Entry deleted')
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete entry')
    }
  }

  if (permissionsLoading || loading) {
    return <PageLayout title="Entries" subtitle="OJ Projects" loading loadingLabel="Loading Entries…" />
  }

  const navItems = [
    { label: 'Dashboard', href: '/oj-projects', icon: <LayoutDashboard className="w-4 h-4" /> },
    { label: 'Projects', href: '/oj-projects/projects', icon: <Briefcase className="w-4 h-4" /> },
    { label: 'Entries', href: '/oj-projects/entries', active: true, icon: <List className="w-4 h-4" /> },
    { label: 'Clients', href: '/oj-projects/clients', icon: <Users className="w-4 h-4" /> },
    { label: 'Work Types', href: '/oj-projects/work-types', icon: <List className="w-4 h-4" /> },
  ]

  const getStatusBadge = (status: string, billable: boolean) => {
    if (!billable) return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">Non-billable</span>

    switch (status) {
      case 'unbilled': return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">Unbilled</span>
      case 'billing_pending': return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">Pending</span>
      case 'billed': return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-indigo-100 text-indigo-800">Billed</span>
      case 'paid': return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">Paid</span>
      default: return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">{status}</span>
    }
  }

  return (
    <PageLayout
      title="Entries"
      subtitle="View and manage time and mileage logs"
      navItems={navItems}
    >
      {error && <Alert variant="error" description={error} className="mb-6" />}

      {/* Filters */}
      <Card className="mb-6 overflow-visible" padding="none">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between cursor-pointer" onClick={() => setFiltersOpen(!filtersOpen)}>
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-gray-500" />
            <h3 className="text-sm font-semibold text-gray-900">Filters</h3>
          </div>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0 rounded-full">
            {filtersOpen ? '−' : '+'}
          </Button>
        </div>

        {filtersOpen && (
          <div className="p-4 bg-gray-50/50">
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
              <FormGroup label="Date Range" className="lg:col-span-2">
                <div className="flex items-center gap-2">
                  <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="bg-white" />
                  <span className="text-gray-400">to</span>
                  <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="bg-white" />
                </div>
              </FormGroup>

              <FormGroup label="Client">
                <Select
                  value={vendorId}
                  onChange={(e) => {
                    setVendorId(e.target.value)
                    setProjectId('')
                  }}
                  className="bg-white"
                >
                  <option value="">All Clients</option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </Select>
              </FormGroup>

              <FormGroup label="Project">
                <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} disabled={!vendorId} className="bg-white">
                  <option value="">All Projects</option>
                  {vendorProjects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.project_code} — {p.project_name}
                    </option>
                  ))}
                </Select>
              </FormGroup>

              <FormGroup label="Status">
                <Select value={status} onChange={(e) => setStatus(e.target.value as any)} className="bg-white">
                  <option value="all">Any Status</option>
                  <option value="unbilled">Unbilled</option>
                  <option value="billing_pending">Billing Pending</option>
                  <option value="billed">Billed</option>
                  <option value="paid">Paid</option>
                </Select>
              </FormGroup>

              <FormGroup label="Entry Type">
                <Select value={entryType} onChange={(e) => setEntryType(e.target.value as any)} className="bg-white">
                  <option value="all">All Types</option>
                  <option value="time">Time</option>
                  <option value="mileage">Mileage</option>
                </Select>
              </FormGroup>

              <div className="flex items-end gap-2 lg:col-span-2 justify-end">
                <Button variant="secondary" onClick={load} className="bg-white">
                  <RefreshCcw className="w-4 h-4 mr-2" /> Refresh
                </Button>
              </div>
            </div>
          </div>
        )}
      </Card>

      <Card padding="none" className="overflow-hidden">
        {entries.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            <List className="w-12 h-12 mx-auto text-gray-300 mb-3" />
            <p>No entries found matching your filters.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-32">Date</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Client</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Project</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Work</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-24">Charge</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-24">Status</th>
                  <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-24">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {entries.map((entry) => (
                  <tr key={entry.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-sm text-gray-900 whitespace-nowrap align-top">
                      <div className="font-medium">{formatDateDdMmmmYyyy(entry.entry_date)}</div>
                      <div className="text-xs text-gray-500 capitalize">{entry.entry_type}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900 align-top">
                      <div className="font-medium">{entry.vendor?.name || 'Unknown Client'}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900 align-top">
                      <div className="font-medium">{entry.project?.project_name || 'Unknown Project'}</div>
                      {entry.project?.project_code && (
                        <div className="text-xs text-gray-500">{entry.project.project_code}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900 align-top">
                      <div className="flex items-center gap-2 font-medium">
                        {entry.entry_type === 'time' ? (
                          <>
                            <Clock className="w-3.5 h-3.5 text-gray-400" />
                            <span>{`${(entry.duration_minutes_rounded || 0) / 60}h`}</span>
                            <span className="text-xs text-gray-400 font-normal">
                              ({toLondonTimeHm(entry.start_at)}–{toLondonTimeHm(entry.end_at)})
                            </span>
                          </>
                        ) : (
                          <>
                            <MapPin className="w-3.5 h-3.5 text-gray-400" />
                            <span>{entry.miles} mi</span>
                          </>
                        )}
                      </div>
                      {(entry.work_type?.name || entry.work_type_name_snapshot) && (
                        <div className="flex items-center gap-1.5 mt-0.5 text-xs text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded w-fit">
                          <Tag className="w-3 h-3" />
                          {entry.work_type?.name || entry.work_type_name_snapshot}
                        </div>
                      )}
                      {entry.description && (
                        <div className="text-xs text-gray-600 mt-1 line-clamp-2">{entry.description}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900 align-top whitespace-nowrap">
                      {new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(
                        entry.entry_type === 'time'
                          ? ((entry.duration_minutes_rounded || 0) / 60) * (entry.hourly_rate_ex_vat_snapshot || 0)
                          : (entry.miles || 0) * (entry.mileage_rate_snapshot || 0)
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm align-top">
                      {getStatusBadge(entry.status, entry.billable !== false)}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-medium align-top">
                      <div className="flex items-center justify-end gap-2">
                        {entry.status === 'unbilled' && (
                          <>
                            <button
                              onClick={() => openEdit(entry)}
                              disabled={!canEdit}
                              className="text-gray-400 hover:text-blue-600 disabled:opacity-30"
                              title="Edit"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => removeEntry(entry.id)}
                              disabled={!canDelete}
                              className="text-gray-400 hover:text-red-600 disabled:opacity-30"
                              title="Delete"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={isEditOpen} onClose={() => setIsEditOpen(false)} title="Edit Entry">
        <form onSubmit={saveEdit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormGroup label="Type" required>
              <Select
                value={form.entry_type}
                onChange={(e) => setForm({ ...form, entry_type: e.target.value as any })}
                required
                disabled
              >
                <option value="time">Time</option>
                <option value="mileage">Mileage</option>
              </Select>
            </FormGroup>

            <FormGroup label="Date" required>
              <Input
                type="date"
                value={form.entry_date}
                onChange={(e) => setForm({ ...form, entry_date: e.target.value })}
                required
              />
            </FormGroup>

            <FormGroup label="Client" required>
              <Select value={form.vendor_id} onChange={(e) => setForm({ ...form, vendor_id: e.target.value, project_id: '' })} required>
                <option value="">Select a client</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </Select>
            </FormGroup>

            <FormGroup label="Project" required>
              <Select
                value={form.project_id}
                onChange={(e) => setForm({ ...form, project_id: e.target.value })}
                required
                disabled={!form.vendor_id}
              >
                <option value="">Select a project</option>
                {projects
                  .filter((p) => p.vendor_id === form.vendor_id)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.project_code} — {p.project_name}
                    </option>
                  ))}
              </Select>
            </FormGroup>

            {form.entry_type === 'time' ? (
              <>
                <FormGroup label="Start" required>
                  <Input type="time" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} required />
                </FormGroup>
                <FormGroup label="Duration (h)" required>
                  <Input
                    type="number"
                    min="0.25"
                    step="0.25"
                    value={form.duration_hours}
                    onChange={(e) => setForm({ ...form, duration_hours: parseFloat(e.target.value) || 0 })}
                    required
                  />
                </FormGroup>
                <FormGroup label="Work Type">
                  <Select value={form.work_type_id} onChange={(e) => setForm({ ...form, work_type_id: e.target.value })}>
                    <option value="">Unspecified</option>
                    {workTypes
                      .filter((w) => w.is_active)
                      .map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                  </Select>
                </FormGroup>
              </>
            ) : (
              <FormGroup label="Miles" required>
                <Input
                  type="number"
                  min="0"
                  step="0.1"
                  value={form.miles}
                  onChange={(e) => setForm({ ...form, miles: e.target.value })}
                  required
                />
              </FormGroup>
            )}

            <div className="md:col-span-2 pt-2">
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  checked={form.billable}
                  onChange={(e) => setForm({ ...form, billable: e.target.checked })}
                />
                Billable Entry
              </label>
            </div>

            <div className="md:col-span-2">
              <FormGroup label="Description">
                <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </FormGroup>
            </div>

            <div className="md:col-span-2">
              <FormGroup label="Internal Notes">
                <Textarea value={form.internal_notes} onChange={(e) => setForm({ ...form, internal_notes: e.target.value })} rows={3} />
              </FormGroup>
            </div>
          </div>

          <ModalActions>
            <Button type="button" variant="secondary" onClick={() => setIsEditOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving} disabled={!canEdit || saving}>
              Save Changes
            </Button>
          </ModalActions>
        </form>
      </Modal>
    </PageLayout>
  )
}
