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
  Empty,
  ConfirmDialog,
  IconButton,
  Checkbox,
  toast,
} from '@/ds'
import { usePermissions } from '@/contexts/PermissionContext'
import { getEntries, updateEntry, deleteEntry } from '@/app/actions/oj-projects/entries'
import { formatDateDdMmmmYyyy } from '@/lib/dateUtils'

function formatCurrency(value: number): string {
  return `£${value.toFixed(2)}`
}

interface EntriesClientProps {
  initialEntries: any[]
  projects: any[]
  workTypes: any[]
}

export function EntriesClient({
  initialEntries,
  projects,
  workTypes,
}: EntriesClientProps): React.ReactElement {
  const router = useRouter()
  const { hasPermission } = usePermissions()
  const canEdit = hasPermission('oj_projects', 'edit')
  const canDelete = hasPermission('oj_projects', 'delete')

  const [entries, setEntries] = useState(initialEntries)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')

  // Edit modal state
  const [editOpen, setEditOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editForm, setEditForm] = useState({
    id: '',
    entry_type: 'time' as string,
    vendor_id: '',
    project_id: '',
    entry_date: '',
    duration_minutes: '',
    miles: '',
    amount_ex_vat: '',
    work_type_id: '',
    description: '',
    internal_notes: '',
    billable: true,
  })

  // Delete confirm state
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    let list = entries
    if (statusFilter !== 'all') {
      list = list.filter((e) => e.status === statusFilter)
    }
    if (typeFilter !== 'all') {
      list = list.filter((e) => e.entry_type === typeFilter)
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(
        (e) =>
          e.project?.project_name?.toLowerCase().includes(q) ||
          e.project?.project_code?.toLowerCase().includes(q) ||
          e.vendor?.name?.toLowerCase().includes(q) ||
          e.description?.toLowerCase().includes(q),
      )
    }
    return list
  }, [entries, search, statusFilter, typeFilter])

  const reload = useCallback(async () => {
    const res = await getEntries({ limit: 200 })
    if (res.entries) setEntries(res.entries)
  }, [])

  function openEdit(entry: any): void {
    if (entry.status !== 'unbilled') {
      toast.error('Only unbilled entries can be edited')
      return
    }
    setEditForm({
      id: entry.id,
      entry_type: entry.entry_type,
      vendor_id: entry.vendor_id,
      project_id: entry.project_id,
      entry_date: entry.entry_date,
      duration_minutes: entry.duration_minutes_raw ? String(entry.duration_minutes_raw) : '',
      miles: entry.miles != null ? String(entry.miles) : '',
      amount_ex_vat: entry.amount_ex_vat_snapshot != null ? String(entry.amount_ex_vat_snapshot) : '',
      work_type_id: entry.work_type_id || '',
      description: entry.description || '',
      internal_notes: entry.internal_notes || '',
      billable: entry.billable ?? true,
    })
    setEditOpen(true)
  }

  async function handleEditSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setSaving(true)
    try {
      const fd = new FormData()
      fd.append('id', editForm.id)
      fd.append('entry_type', editForm.entry_type)
      fd.append('vendor_id', editForm.vendor_id)
      fd.append('project_id', editForm.project_id)
      fd.append('entry_date', editForm.entry_date)
      fd.append('description', editForm.description)
      fd.append('internal_notes', editForm.internal_notes)
      fd.append('billable', String(editForm.billable))
      if (editForm.entry_type === 'time') {
        fd.append('duration_minutes', editForm.duration_minutes)
        fd.append('work_type_id', editForm.work_type_id)
      } else if (editForm.entry_type === 'mileage') {
        fd.append('miles', editForm.miles)
      } else {
        fd.append('amount_ex_vat', editForm.amount_ex_vat)
      }
      const res = await updateEntry(fd)
      if (res.error) throw new Error(res.error)
      toast.success('Entry updated')
      setEditOpen(false)
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update entry')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(): Promise<void> {
    if (!deleteId) return
    try {
      const fd = new FormData()
      fd.append('id', deleteId)
      const res = await deleteEntry(fd)
      if (res.error) throw new Error(res.error)
      toast.success('Entry deleted')
      setDeleteId(null)
      await reload()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete entry')
    }
  }

  function entryAmount(entry: any): number {
    if (entry.entry_type === 'time') {
      return (Number(entry.duration_minutes_rounded || 0) / 60) * Number(entry.hourly_rate_ex_vat_snapshot || 0)
    } else if (entry.entry_type === 'mileage') {
      return Number(entry.miles || 0) * Number(entry.mileage_rate_snapshot || 0.42)
    }
    return Number(entry.amount_ex_vat_snapshot || 0)
  }

  const typeTone = (type: string): 'info' | 'warning' | 'neutral' => {
    switch (type) {
      case 'time': return 'info'
      case 'mileage': return 'warning'
      default: return 'neutral'
    }
  }

  const statusTone = (status: string): 'success' | 'info' | 'warning' | 'neutral' => {
    switch (status) {
      case 'paid': return 'success'
      case 'billed': return 'info'
      case 'unbilled': return 'warning'
      default: return 'neutral'
    }
  }

  const statusOptions = [
    { label: 'All Statuses', value: 'all' },
    { label: 'Unbilled', value: 'unbilled' },
    { label: 'Billed', value: 'billed' },
    { label: 'Paid', value: 'paid' },
  ]

  const typeOptions = [
    { label: 'All Types', value: 'all' },
    { label: 'Time', value: 'time' },
    { label: 'Mileage', value: 'mileage' },
    { label: 'One-off', value: 'one_off' },
  ]

  const vendorProjectOptions = editForm.vendor_id
    ? projects.filter((p) => p.vendor_id === editForm.vendor_id)
    : projects

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex gap-3 items-center flex-1 w-full sm:w-auto flex-wrap">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search entries..."
            className="flex-1 sm:max-w-xs"
          />
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            options={statusOptions}
            className="w-36"
          />
          <Select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            options={typeOptions}
            className="w-32"
          />
        </div>
      </div>

      {/* Table */}
      <Card>
        {filtered.length === 0 ? (
          <Empty title="No entries" description="No entries match your filters." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Duration/Qty</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-20">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell>{formatDateDdMmmmYyyy(entry.entry_date)}</TableCell>
                  <TableCell>{entry.vendor?.name || 'Unknown'}</TableCell>
                  <TableCell>
                    <div>
                      <span className="font-medium">{entry.project?.project_name || 'Unknown'}</span>
                      {entry.project?.project_code && (
                        <span className="block text-xs text-text-muted">{entry.project.project_code}</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge tone={typeTone(entry.entry_type)}>{entry.entry_type}</Badge>
                  </TableCell>
                  <TableCell>
                    {entry.entry_type === 'time'
                      ? `${(Number(entry.duration_minutes_rounded || 0) / 60).toFixed(1)}h`
                      : entry.entry_type === 'mileage'
                        ? `${entry.miles} mi`
                        : '-'}
                  </TableCell>
                  <TableCell className="font-medium">
                    {formatCurrency(entryAmount(entry))}
                  </TableCell>
                  <TableCell>
                    <Badge tone={statusTone(entry.status)}>{entry.status}</Badge>
                  </TableCell>
                  <TableCell>
                    {entry.status === 'unbilled' && (
                      <div className="flex gap-1">
                        {canEdit && (
                          <IconButton
                            icon="edit"
                            size="sm"
                            label="Edit"
                            onClick={() => openEdit(entry)}
                          />
                        )}
                        {canDelete && (
                          <IconButton
                            icon="trash"
                            size="sm"
                            label="Delete"
                            onClick={() => setDeleteId(entry.id)}
                          />
                        )}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* Edit Modal */}
      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit Entry"
      >
        <form onSubmit={handleEditSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Entry Type">
              <Input value={editForm.entry_type} disabled />
            </Field>
            <Field label="Date" required>
              <Input
                type="date"
                value={editForm.entry_date}
                onChange={(e) => setEditForm({ ...editForm, entry_date: e.target.value })}
                required
              />
            </Field>
          </div>

          <Field label="Project" required>
            <Select
              value={editForm.project_id}
              onChange={(e) => setEditForm({ ...editForm, project_id: e.target.value })}
              options={[
                { label: 'Select project...', value: '' },
                ...vendorProjectOptions.map((p) => ({
                  label: `${p.project_code} - ${p.project_name}`,
                  value: p.id,
                })),
              ]}
            />
          </Field>

          {editForm.entry_type === 'time' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Duration (minutes)" required>
                <Input
                  type="number"
                  min="1"
                  value={editForm.duration_minutes}
                  onChange={(e) => setEditForm({ ...editForm, duration_minutes: e.target.value })}
                  required
                />
              </Field>
              <Field label="Work Type">
                <Select
                  value={editForm.work_type_id}
                  onChange={(e) => setEditForm({ ...editForm, work_type_id: e.target.value })}
                  options={[
                    { label: 'None', value: '' },
                    ...workTypes.filter((w) => w.is_active).map((w) => ({
                      label: w.name,
                      value: w.id,
                    })),
                  ]}
                />
              </Field>
            </div>
          )}

          {editForm.entry_type === 'mileage' && (
            <Field label="Miles" required>
              <Input
                type="number"
                min="0.1"
                step="0.1"
                value={editForm.miles}
                onChange={(e) => setEditForm({ ...editForm, miles: e.target.value })}
                required
              />
            </Field>
          )}

          {editForm.entry_type === 'one_off' && (
            <Field label="Amount (ex VAT)" required>
              <Input
                type="number"
                min="0.01"
                step="0.01"
                value={editForm.amount_ex_vat}
                onChange={(e) => setEditForm({ ...editForm, amount_ex_vat: e.target.value })}
                required
              />
            </Field>
          )}

          <Field label="Description">
            <Input
              value={editForm.description}
              onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
            />
          </Field>
          <Field label="Internal Notes">
            <Textarea
              value={editForm.internal_notes}
              onChange={(e) => setEditForm({ ...editForm, internal_notes: e.target.value })}
              rows={2}
            />
          </Field>

          <Checkbox
            label="Billable"
            checked={editForm.billable}
            onChange={(checked) => setEditForm({ ...editForm, billable: checked })}
          />

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="ghost" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              Save Changes
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title="Delete Entry"
        message="Are you sure you want to delete this entry? This cannot be undone."
        confirmLabel="Delete"
        tone="danger"
      />
    </div>
  )
}
