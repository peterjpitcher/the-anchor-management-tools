'use client'

/**
 * Private-booking SOP workflow panels for the detail page.
 *
 * These panels render against the workflow server actions in
 * `@/app/actions/privateBookingWorkflow`. Money never moves here — the
 * deductions panel only records the manager's decision; refunds still go
 * through the existing refund flow.
 *
 * `canManage` is the manager proxy (manage_deposits || manage). GM-only
 * actions (approve/reject deductions, suppliers, risk; lock/unlock) are
 * enforced server-side; the UI hides them from obvious non-managers and
 * surfaces any server permission error via toast.
 */

import { useState, useEffect, useCallback } from 'react'
import {
  ShieldCheckIcon,
  TruckIcon,
  BanknotesIcon,
  ChatBubbleBottomCenterTextIcon,
  LockClosedIcon,
  LockOpenIcon,
  PlusIcon,
  PencilIcon,
} from '@heroicons/react/24/outline'
import {
  Section,
  Card,
  Button,
  Input,
  Select,
  Textarea,
  Badge,
  Modal,
  FormGroup,
  Form,
  EmptyState,
  toast,
} from '@/ds'
import { formatDateTime12Hour } from '@/lib/dateUtils'
import { formatCurrency } from '@/lib/format'
import type {
  PrivateBookingWithDetails,
  WaiverStatus,
  RiskStatus,
} from '@/types/private-bookings'
import {
  listDeductions,
  proposeDeduction,
  recordDeductionDiscussion,
  decideDeduction,
  listBookingSuppliers,
  addBookingSupplier,
  updateBookingSupplier,
  setSupplierStatus,
  setWaiverStatus,
  uploadSignedWaiver,
  setRiskStatus,
  lockBookingRecord,
  unlockBookingRecord,
  logComplaint,
  updateComplaint,
  listComplaints,
  type PrivateBookingDeduction,
  type PrivateBookingSupplier,
  type PrivateBookingComplaint,
  type DeductionStatus,
  type SupplierStatus as WorkflowSupplierStatus,
  type WaiverStatus as WorkflowWaiverStatus,
  type ComplaintStatus,
} from '@/app/actions/privateBookingWorkflow'

// ---------------------------------------------------------------------------
// Shared badge helpers
// ---------------------------------------------------------------------------

type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'info'

const humanise = (value: string): string =>
  value
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')

function StatusBadge({
  variant,
  children,
}: {
  variant: BadgeVariant
  children: React.ReactNode
}) {
  return <Badge variant={variant}>{children}</Badge>
}

const WAIVER_VARIANT: Record<WaiverStatus, BadgeVariant> = {
  not_required: 'default',
  required: 'error',
  sent: 'warning',
  signed: 'success',
  overdue: 'error',
}

const RISK_VARIANT: Record<RiskStatus, BadgeVariant> = {
  low: 'success',
  normal: 'default',
  high: 'error',
  gm_approval_required: 'warning',
  approved: 'success',
  rejected: 'error',
}

const SUPPLIER_BOOKING_VARIANT: Record<string, BadgeVariant> = {
  not_applicable: 'default',
  requested: 'warning',
  incomplete: 'warning',
  approved: 'success',
  rejected: 'error',
}

const SUPPLIER_ROW_VARIANT: Record<WorkflowSupplierStatus, BadgeVariant> = {
  requested: 'warning',
  incomplete: 'warning',
  approved: 'success',
  rejected: 'error',
}

const FINAL_DETAILS_VARIANT: Record<string, BadgeVariant> = {
  not_requested: 'default',
  requested: 'warning',
  complete: 'success',
  incomplete: 'warning',
  overdue: 'error',
  manager_reviewed: 'success',
}

const POST_EVENT_VARIANT: Record<string, BadgeVariant> = {
  awaiting_inspection: 'warning',
  inspection_complete: 'info',
  deduction_discussion: 'warning',
  refund_processed: 'info',
  complete: 'success',
}

const DEDUCTION_VARIANT: Record<DeductionStatus, BadgeVariant> = {
  proposed: 'warning',
  discussed: 'info',
  approved: 'success',
  rejected: 'error',
  applied: 'info',
}

const COMPLAINT_VARIANT: Record<ComplaintStatus, BadgeVariant> = {
  open: 'error',
  acknowledged: 'warning',
  responded: 'info',
  resolved: 'success',
  closed: 'default',
}

// ---------------------------------------------------------------------------
// 2. Workflow status panel
// ---------------------------------------------------------------------------

export function WorkflowStatusPanel({
  booking,
}: {
  booking: PrivateBookingWithDetails
}) {
  const waiver = booking.waiver_status
  const supplier = booking.supplier_status
  const risk = booking.risk_status
  const finalDetails = booking.final_details_status
  const postEvent = booking.post_event_status
  const isLocked = !!booking.locked_at

  const rows: { label: string; variant: BadgeVariant; text: string }[] = []
  if (waiver && waiver !== 'not_required') {
    rows.push({ label: 'Self-catering waiver', variant: WAIVER_VARIANT[waiver], text: humanise(waiver) })
  }
  if (supplier && supplier !== 'not_applicable') {
    rows.push({ label: 'Suppliers', variant: SUPPLIER_BOOKING_VARIANT[supplier] ?? 'default', text: humanise(supplier) })
  }
  if (risk && risk !== 'normal') {
    rows.push({ label: 'Risk review', variant: RISK_VARIANT[risk] ?? 'default', text: humanise(risk) })
  }
  if (finalDetails) {
    rows.push({ label: 'Final details', variant: FINAL_DETAILS_VARIANT[finalDetails] ?? 'default', text: humanise(finalDetails) })
  }
  if (postEvent) {
    rows.push({ label: 'Post-event', variant: POST_EVENT_VARIANT[postEvent] ?? 'default', text: humanise(postEvent) })
  }

  if (rows.length === 0 && !isLocked) {
    return null
  }

  return (
    <Section id="workflow-status" title="Workflow Status">
      <Card>
        {isLocked && (
          <div className="mb-3 flex items-center gap-2">
            <LockClosedIcon className="h-4 w-4 text-danger" aria-hidden="true" />
            <StatusBadge variant="error">Record locked</StatusBadge>
          </div>
        )}
        {rows.length === 0 ? (
          <p className="text-sm text-gray-500">No workflow steps outstanding.</p>
        ) : (
          <dl className="space-y-2">
            {rows.map((row) => (
              <div key={row.label} className="flex items-center justify-between gap-3">
                <dt className="text-sm text-gray-600">{row.label}</dt>
                <dd>
                  <StatusBadge variant={row.variant}>{row.text}</StatusBadge>
                </dd>
              </div>
            ))}
          </dl>
        )}
      </Card>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// 7. Record lock banner + control
// ---------------------------------------------------------------------------

export function RecordLockBanner({ booking }: { booking: PrivateBookingWithDetails }) {
  if (!booking.locked_at) return null
  return (
    <div className="mb-6 rounded-lg border border-danger-soft bg-danger-soft p-4">
      <div className="flex items-start gap-2">
        <LockClosedIcon className="mt-0.5 h-5 w-5 shrink-0 text-danger-fg" aria-hidden="true" />
        <div>
          <p className="text-sm font-medium text-danger-fg">Record locked</p>
          <p className="text-sm text-danger-fg">
            {booking.locked_reason || 'No reason recorded'}. Deletion and edits are restricted.
          </p>
        </div>
      </div>
    </div>
  )
}

export function RecordLockControl({
  booking,
  canManage,
  onChanged,
}: {
  booking: PrivateBookingWithDetails
  canManage: boolean
  onChanged: () => void
}) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const isLocked = !!booking.locked_at

  if (!canManage) return null

  const handleLock = async () => {
    const trimmed = reason.trim()
    if (!trimmed) {
      toast.error('A reason is required to lock a booking record')
      return
    }
    setBusy(true)
    const result = await lockBookingRecord(booking.id, trimmed)
    setBusy(false)
    if (result.error) {
      toast.error(result.error)
      return
    }
    toast.success('Booking record locked')
    setReason('')
    onChanged()
  }

  const handleUnlock = async () => {
    setBusy(true)
    const result = await unlockBookingRecord(booking.id)
    setBusy(false)
    if (result.error) {
      toast.error(result.error)
      return
    }
    toast.success('Booking record unlocked')
    onChanged()
  }

  return (
    <Section id="record-lock" title="Record Lock">
      <Card>
        {isLocked ? (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              This record is locked ({booking.locked_reason || 'no reason recorded'}).
            </p>
            <Button type="button" variant="secondary" onClick={handleUnlock} loading={busy} disabled={busy}>
              <LockOpenIcon className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Unlock record
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <FormGroup label="Reason for locking" help="Locking restricts deletion and edits (SOP §27).">
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                placeholder="e.g. Dispute under investigation"
              />
            </FormGroup>
            <Button type="button" variant="secondary" onClick={handleLock} loading={busy} disabled={busy}>
              <LockClosedIcon className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Lock record
            </Button>
          </div>
        )}
      </Card>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// 3. Waiver & risk controls
// ---------------------------------------------------------------------------

export function WaiverRiskPanel({
  booking,
  canManage,
  onChanged,
}: {
  booking: PrivateBookingWithDetails
  canManage: boolean
  onChanged: () => void
}) {
  const waiver = booking.waiver_status ?? 'not_required'
  const risk = booking.risk_status ?? 'normal'
  const waiverApplies = waiver !== 'not_required'

  const [waiverFile, setWaiverFile] = useState<File | null>(null)
  const [uploadingWaiver, setUploadingWaiver] = useState(false)
  const [settingWaiver, setSettingWaiver] = useState(false)

  const [riskDecision, setRiskDecision] = useState<RiskStatus>('approved')
  const [riskReason, setRiskReason] = useState('')
  const [settingRisk, setSettingRisk] = useState(false)

  const handleUploadWaiver = async () => {
    if (!waiverFile) {
      toast.error('Please choose a signed waiver file to upload')
      return
    }
    setUploadingWaiver(true)
    const formData = new FormData()
    formData.set('file', waiverFile)
    const result = await uploadSignedWaiver(booking.id, formData)
    setUploadingWaiver(false)
    if (result.error) {
      toast.error(result.error)
      return
    }
    toast.success('Signed waiver uploaded')
    setWaiverFile(null)
    onChanged()
  }

  const handleSetWaiver = async (status: WorkflowWaiverStatus) => {
    setSettingWaiver(true)
    const result = await setWaiverStatus(booking.id, status)
    setSettingWaiver(false)
    if (result.error) {
      toast.error(result.error)
      return
    }
    toast.success('Waiver status updated')
    onChanged()
  }

  const handleSetRisk = async () => {
    const trimmed = riskReason.trim()
    if (!trimmed) {
      toast.error('A reason is required when changing risk status')
      return
    }
    setSettingRisk(true)
    const result = await setRiskStatus(booking.id, riskDecision, trimmed)
    setSettingRisk(false)
    if (result.error) {
      toast.error(result.error)
      return
    }
    toast.success('Risk status updated')
    setRiskReason('')
    onChanged()
  }

  // Only render the panel when there is something to show or act on.
  if (!waiverApplies && risk === 'normal' && !canManage) return null

  return (
    <Section id="waiver-risk" title="Waiver & Risk">
      <Card>
        <div className="space-y-6">
          {waiverApplies && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-medium text-gray-700">Self-catering waiver</h3>
                <StatusBadge variant={WAIVER_VARIANT[waiver]}>{humanise(waiver)}</StatusBadge>
              </div>
              {canManage && (
                <>
                  <FormGroup label="Upload signed waiver" help="PDF or image (JPEG, PNG, WebP, HEIC), max 10 MB.">
                    <input
                      type="file"
                      accept="application/pdf,image/jpeg,image/png,image/webp,image/heic"
                      onChange={(e) => setWaiverFile(e.target.files?.[0] ?? null)}
                      className="block w-full text-sm text-gray-700 file:mr-3 file:rounded-md file:border-0 file:bg-surface-2 file:px-3 file:py-2 file:text-sm file:font-medium file:text-gray-700 hover:file:bg-gray-100"
                    />
                  </FormGroup>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleUploadWaiver}
                      loading={uploadingWaiver}
                      disabled={uploadingWaiver || !waiverFile}
                    >
                      Upload signed waiver
                    </Button>
                    {waiver !== 'sent' && (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => handleSetWaiver('sent')}
                        loading={settingWaiver}
                        disabled={settingWaiver}
                      >
                        Mark as sent
                      </Button>
                    )}
                    {waiver !== 'required' && (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => handleSetWaiver('required')}
                        loading={settingWaiver}
                        disabled={settingWaiver}
                      >
                        Mark as required
                      </Button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          <div className="space-y-3 border-t border-border pt-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-medium text-gray-700">Risk review</h3>
              <StatusBadge variant={RISK_VARIANT[risk]}>{humanise(risk)}</StatusBadge>
            </div>
            {canManage && (
              <div className="space-y-3">
                <FormGroup label="Risk decision">
                  <Select
                    value={riskDecision}
                    onChange={(e) => setRiskDecision(e.target.value as RiskStatus)}
                    options={[
                      { value: 'high', label: 'Flag as high risk' },
                      { value: 'gm_approval_required', label: 'Needs GM approval' },
                      { value: 'approved', label: 'Approve (GM)' },
                      { value: 'rejected', label: 'Reject (GM)' },
                    ]}
                  />
                </FormGroup>
                <FormGroup label="Reason" help="Recorded against the booking. Approving or rejecting is a GM decision.">
                  <Textarea
                    value={riskReason}
                    onChange={(e) => setRiskReason(e.target.value)}
                    rows={2}
                    placeholder="e.g. High-power equipment approved by GM"
                  />
                </FormGroup>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleSetRisk}
                  loading={settingRisk}
                  disabled={settingRisk}
                >
                  <ShieldCheckIcon className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  Update risk status
                </Button>
              </div>
            )}
          </div>
        </div>
      </Card>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// 4. Suppliers panel
// ---------------------------------------------------------------------------

type SupplierFormState = {
  name: string
  supplierType: string
  contactDetails: string
  arrivalTime: string
  departureTime: string
  powerRequirements: string
  documentsRequired: string
  documentsReceived: string
}

const emptySupplierForm: SupplierFormState = {
  name: '',
  supplierType: '',
  contactDetails: '',
  arrivalTime: '',
  departureTime: '',
  powerRequirements: '',
  documentsRequired: '',
  documentsReceived: '',
}

const parseCommaList = (value: string): string[] =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)

const normaliseTime = (value: string): string | null => (value.trim() === '' ? null : value)

function SupplierModal({
  open,
  onClose,
  bookingId,
  supplier,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  bookingId: string
  supplier: PrivateBookingSupplier | null
  onSaved: () => void
}) {
  const [form, setForm] = useState<SupplierFormState>(emptySupplierForm)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    if (supplier) {
      setForm({
        name: supplier.name ?? '',
        supplierType: supplier.supplier_type ?? '',
        contactDetails: supplier.contact_details ?? '',
        arrivalTime: (supplier.arrival_time ?? '').slice(0, 5),
        departureTime: (supplier.departure_time ?? '').slice(0, 5),
        powerRequirements: supplier.power_requirements ?? '',
        documentsRequired: (supplier.documents_required ?? []).join(', '),
        documentsReceived: (supplier.documents_received ?? []).join(', '),
      })
    } else {
      setForm(emptySupplierForm)
    }
  }, [open, supplier])

  const update = (key: keyof SupplierFormState, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) {
      toast.error('Supplier name is required')
      return
    }
    setSaving(true)
    const shared = {
      name: form.name.trim(),
      supplierType: form.supplierType.trim() || null,
      contactDetails: form.contactDetails.trim() || null,
      arrivalTime: normaliseTime(form.arrivalTime),
      departureTime: normaliseTime(form.departureTime),
      powerRequirements: form.powerRequirements.trim() || null,
      documentsRequired: parseCommaList(form.documentsRequired),
      documentsReceived: parseCommaList(form.documentsReceived),
    }
    const result = supplier
      ? await updateBookingSupplier(supplier.id, shared)
      : await addBookingSupplier({ bookingId, ...shared })
    setSaving(false)
    if (result.error) {
      toast.error(result.error)
      return
    }
    toast.success(supplier ? 'Supplier updated' : 'Supplier added')
    onSaved()
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title={supplier ? 'Edit Supplier' : 'Add Supplier'} size="lg">
      <Form onSubmit={handleSubmit} className="space-y-4">
        <FormGroup label="Name" required>
          <Input value={form.name} onChange={(e) => update('name', e.target.value)} required placeholder="e.g. Sound & Light Co." />
        </FormGroup>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormGroup label="Type">
            <Input value={form.supplierType} onChange={(e) => update('supplierType', e.target.value)} placeholder="DJ, caterer, florist..." />
          </FormGroup>
          <FormGroup label="Contact details">
            <Input value={form.contactDetails} onChange={(e) => update('contactDetails', e.target.value)} placeholder="Name / phone / email" />
          </FormGroup>
          <FormGroup label="Arrival time">
            <Input type="time" value={form.arrivalTime} onChange={(e) => update('arrivalTime', e.target.value)} />
          </FormGroup>
          <FormGroup label="Departure time">
            <Input type="time" value={form.departureTime} onChange={(e) => update('departureTime', e.target.value)} />
          </FormGroup>
        </div>
        <FormGroup label="Power requirements">
          <Input value={form.powerRequirements} onChange={(e) => update('powerRequirements', e.target.value)} placeholder="e.g. 2x 13A sockets" />
        </FormGroup>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormGroup label="Documents required" help="Comma-separated (e.g. PLI, PAT).">
            <Input value={form.documentsRequired} onChange={(e) => update('documentsRequired', e.target.value)} placeholder="PLI, PAT certificate" />
          </FormGroup>
          <FormGroup label="Documents received" help="Comma-separated.">
            <Input value={form.documentsReceived} onChange={(e) => update('documentsReceived', e.target.value)} placeholder="PLI" />
          </FormGroup>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={saving} disabled={saving}>
            {supplier ? 'Save changes' : 'Add supplier'}
          </Button>
        </div>
      </Form>
    </Modal>
  )
}

export function SuppliersPanel({
  bookingId,
  canEdit,
  canManage,
  refreshKey,
  onChanged,
}: {
  bookingId: string
  canEdit: boolean
  canManage: boolean
  refreshKey: number
  onChanged: () => void
}) {
  const [suppliers, setSuppliers] = useState<PrivateBookingSupplier[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<PrivateBookingSupplier | null>(null)
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const result = await listBookingSuppliers(bookingId)
    if (result.error) {
      toast.error(result.error)
    } else {
      setSuppliers(result.data ?? [])
    }
    setLoading(false)
  }, [bookingId])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const handleStatus = async (supplierId: string, status: WorkflowSupplierStatus) => {
    setStatusBusyId(supplierId)
    const result = await setSupplierStatus(supplierId, status)
    setStatusBusyId(null)
    if (result.error) {
      toast.error(result.error)
      return
    }
    toast.success('Supplier status updated')
    await load()
    onChanged()
  }

  return (
    <Section
      id="suppliers"
      title="Suppliers"
      actions={
        canEdit ? (
          <Button
            type="button"
            size="sm"
            onClick={() => {
              setEditing(null)
              setModalOpen(true)
            }}
          >
            <PlusIcon className="mr-1 h-4 w-4" aria-hidden="true" />
            Add supplier
          </Button>
        ) : null
      }
    >
      <Card>
        {loading ? (
          <p className="text-sm text-gray-500">Loading suppliers…</p>
        ) : suppliers.length === 0 ? (
          <EmptyState
            icon={<TruckIcon className="h-12 w-12 text-gray-300" />}
            title="No suppliers yet"
            description={canEdit ? 'Add each supplier attending the event (SOP §20).' : 'Suppliers will appear here once added.'}
          />
        ) : (
          <ul className="divide-y divide-border">
            {suppliers.map((supplier) => (
              <li key={supplier.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-gray-900">{supplier.name}</p>
                      <StatusBadge variant={SUPPLIER_ROW_VARIANT[supplier.status]}>{humanise(supplier.status)}</StatusBadge>
                    </div>
                    <div className="mt-1 space-y-0.5 text-xs text-gray-500">
                      {supplier.supplier_type && <p>Type: {supplier.supplier_type}</p>}
                      {supplier.contact_details && <p>Contact: {supplier.contact_details}</p>}
                      {(supplier.arrival_time || supplier.departure_time) && (
                        <p>
                          Arrives {supplier.arrival_time?.slice(0, 5) || 'TBC'}
                          {' · '}
                          leaves {supplier.departure_time?.slice(0, 5) || 'TBC'}
                        </p>
                      )}
                      {supplier.power_requirements && <p>Power: {supplier.power_requirements}</p>}
                      {supplier.documents_required.length > 0 && (
                        <p>Docs required: {supplier.documents_required.join(', ')}</p>
                      )}
                      {supplier.documents_received.length > 0 && (
                        <p>Docs received: {supplier.documents_received.join(', ')}</p>
                      )}
                    </div>
                  </div>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(supplier)
                        setModalOpen(true)
                      }}
                      className="shrink-0 text-gray-400 hover:text-gray-600"
                      aria-label={`Edit supplier ${supplier.name}`}
                    >
                      <PencilIcon className="h-4 w-4" />
                    </button>
                  )}
                </div>
                {canEdit && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {supplier.status !== 'incomplete' && (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => handleStatus(supplier.id, 'incomplete')}
                        loading={statusBusyId === supplier.id}
                        disabled={statusBusyId === supplier.id}
                      >
                        Mark incomplete
                      </Button>
                    )}
                    {canManage && supplier.status !== 'approved' && (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => handleStatus(supplier.id, 'approved')}
                        loading={statusBusyId === supplier.id}
                        disabled={statusBusyId === supplier.id}
                      >
                        Approve (GM)
                      </Button>
                    )}
                    {canManage && supplier.status !== 'rejected' && (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => handleStatus(supplier.id, 'rejected')}
                        loading={statusBusyId === supplier.id}
                        disabled={statusBusyId === supplier.id}
                      >
                        Reject (GM)
                      </Button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {canEdit && (
        <SupplierModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          bookingId={bookingId}
          supplier={editing}
          onSaved={() => {
            void load()
            onChanged()
          }}
        />
      )}
    </Section>
  )
}

// ---------------------------------------------------------------------------
// 5. Deductions panel (post-event, SOP §25)
// ---------------------------------------------------------------------------

export function DeductionsPanel({
  bookingId,
  canManage,
  refreshKey,
}: {
  bookingId: string
  canManage: boolean
  refreshKey: number
}) {
  const [deductions, setDeductions] = useState<PrivateBookingDeduction[]>([])
  const [loading, setLoading] = useState(true)
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [proposing, setProposing] = useState(false)
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const result = await listDeductions(bookingId)
    if (result.error) {
      toast.error(result.error)
    } else {
      setDeductions(result.data ?? [])
    }
    setLoading(false)
  }, [bookingId])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const handlePropose = async () => {
    const value = Number(amount)
    if (!Number.isFinite(value) || value <= 0) {
      toast.error('Enter a deduction amount greater than £0')
      return
    }
    if (!reason.trim()) {
      toast.error('A reason is required for every deduction')
      return
    }
    setProposing(true)
    const result = await proposeDeduction({ bookingId, amount: value, reason: reason.trim() })
    setProposing(false)
    if (result.error) {
      toast.error(result.error)
      return
    }
    toast.success('Deduction proposed')
    setAmount('')
    setReason('')
    await load()
  }

  const handleDiscussion = async (deductionId: string) => {
    const note = (noteDrafts[deductionId] ?? '').trim()
    if (!note) {
      toast.error('Enter a note describing the customer discussion')
      return
    }
    setBusyId(deductionId)
    const result = await recordDeductionDiscussion(deductionId, note)
    setBusyId(null)
    if (result.error) {
      toast.error(result.error)
      return
    }
    toast.success('Discussion recorded')
    setNoteDrafts((prev) => ({ ...prev, [deductionId]: '' }))
    await load()
  }

  const handleDecide = async (deductionId: string, decision: 'approved' | 'rejected') => {
    setBusyId(deductionId)
    const result = await decideDeduction(deductionId, decision)
    setBusyId(null)
    if (result.error) {
      toast.error(result.error)
      return
    }
    toast.success(decision === 'approved' ? 'Deduction approved' : 'Deduction rejected')
    await load()
  }

  if (!canManage && deductions.length === 0 && !loading) {
    return null
  }

  return (
    <Section id="deductions" title="Deposit Deductions">
      <Card>
        <p className="mb-4 text-xs text-gray-500">
          Records the deduction decision only (SOP §25). Money is moved via the existing refund flow, never here.
        </p>

        {loading ? (
          <p className="text-sm text-gray-500">Loading deductions…</p>
        ) : deductions.length === 0 ? (
          <EmptyState
            icon={<BanknotesIcon className="h-12 w-12 text-gray-300" />}
            title="No deductions proposed"
            description="Damage or extra-cost deductions from the deposit will appear here."
          />
        ) : (
          <ul className="space-y-4">
            {deductions.map((deduction) => {
              const decided =
                deduction.status === 'approved' ||
                deduction.status === 'rejected' ||
                deduction.status === 'applied'
              return (
                <li key={deduction.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900">{formatCurrency(deduction.amount)}</p>
                      <p className="mt-0.5 text-sm text-gray-600 whitespace-pre-wrap">{deduction.reason}</p>
                      {deduction.customer_discussion_note && (
                        <p className="mt-1 text-xs text-gray-500">
                          Discussion: {deduction.customer_discussion_note}
                        </p>
                      )}
                    </div>
                    <StatusBadge variant={DEDUCTION_VARIANT[deduction.status]}>{humanise(deduction.status)}</StatusBadge>
                  </div>

                  {!decided && canManage && (
                    <div className="mt-3 space-y-3 border-t border-border pt-3">
                      <FormGroup label="Record customer discussion">
                        <Textarea
                          value={noteDrafts[deduction.id] ?? ''}
                          onChange={(e) =>
                            setNoteDrafts((prev) => ({ ...prev, [deduction.id]: e.target.value }))
                          }
                          rows={2}
                          placeholder="What was agreed with the customer"
                        />
                      </FormGroup>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => handleDiscussion(deduction.id)}
                          loading={busyId === deduction.id}
                          disabled={busyId === deduction.id}
                        >
                          Record discussion
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => handleDecide(deduction.id, 'approved')}
                          loading={busyId === deduction.id}
                          disabled={busyId === deduction.id}
                        >
                          Approve (GM)
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="danger"
                          onClick={() => handleDecide(deduction.id, 'rejected')}
                          loading={busyId === deduction.id}
                          disabled={busyId === deduction.id}
                        >
                          Reject (GM)
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}

        {canManage && (
          <div className="mt-4 space-y-3 border-t border-border pt-4">
            <h3 className="text-sm font-medium text-gray-700">Propose a deduction</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <FormGroup label="Amount (£)">
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                />
              </FormGroup>
              <div className="sm:col-span-2">
                <FormGroup label="Reason">
                  <Input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. Damage to furniture"
                  />
                </FormGroup>
              </div>
            </div>
            <Button type="button" size="sm" onClick={handlePropose} loading={proposing} disabled={proposing}>
              Propose deduction
            </Button>
          </div>
        )}
      </Card>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// 6. Complaints panel (SOP §26)
// ---------------------------------------------------------------------------

const COMPLAINT_CHANNEL_OPTIONS = [
  { value: '', label: 'Select channel…' },
  { value: 'phone', label: 'Phone' },
  { value: 'email', label: 'Email' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'text', label: 'Text' },
  { value: 'in_person', label: 'In person' },
  { value: 'other', label: 'Other' },
]

const COMPLAINT_STATUS_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'acknowledged', label: 'Acknowledged' },
  { value: 'responded', label: 'Responded' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
]

function ComplaintRow({
  complaint,
  canManage,
  onChanged,
}: {
  complaint: PrivateBookingComplaint
  canManage: boolean
  onChanged: () => void
}) {
  const [status, setStatus] = useState<ComplaintStatus>(complaint.status)
  const [resolution, setResolution] = useState(complaint.resolution ?? '')
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    const result = await updateComplaint(complaint.id, { status, resolution: resolution.trim() || null })
    setSaving(false)
    if (result.error) {
      toast.error(result.error)
      return
    }
    toast.success('Complaint updated')
    onChanged()
  }

  return (
    <li className="rounded-lg border border-border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-gray-900 whitespace-pre-wrap">{complaint.summary}</p>
          <p className="mt-1 text-xs text-gray-500">
            {complaint.channel ? `${humanise(complaint.channel)} · ` : ''}
            Received {formatDateTime12Hour(complaint.received_at)}
          </p>
        </div>
        <StatusBadge variant={COMPLAINT_VARIANT[complaint.status]}>{humanise(complaint.status)}</StatusBadge>
      </div>

      <div className="mt-3 space-y-3 border-t border-border pt-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormGroup label="Status">
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value as ComplaintStatus)}
              options={COMPLAINT_STATUS_OPTIONS}
            />
          </FormGroup>
          <FormGroup label="Resolution">
            <Input value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="How it was resolved" />
          </FormGroup>
        </div>
        <Button type="button" size="sm" variant="secondary" onClick={handleSave} loading={saving} disabled={saving}>
          Save complaint
        </Button>
        {!canManage && (
          <p className="text-xs text-gray-500">Resolving or closing a complaint is a manager decision.</p>
        )}
      </div>
    </li>
  )
}

export function ComplaintsPanel({
  bookingId,
  canManage,
  refreshKey,
}: {
  bookingId: string
  canManage: boolean
  refreshKey: number
}) {
  const [complaints, setComplaints] = useState<PrivateBookingComplaint[]>([])
  const [loading, setLoading] = useState(true)
  const [channel, setChannel] = useState('')
  const [summary, setSummary] = useState('')
  const [logging, setLogging] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const result = await listComplaints({ bookingId })
    if (result.error) {
      toast.error(result.error)
    } else {
      setComplaints(result.data ?? [])
    }
    setLoading(false)
  }, [bookingId])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const handleLog = async () => {
    if (!summary.trim()) {
      toast.error('A complaint summary is required')
      return
    }
    setLogging(true)
    const result = await logComplaint({ bookingId, channel: channel || null, summary: summary.trim() })
    setLogging(false)
    if (result.error) {
      toast.error(result.error)
      return
    }
    toast.success('Complaint logged')
    setChannel('')
    setSummary('')
    await load()
  }

  return (
    <Section id="complaints" title="Complaints">
      <Card>
        <p className="mb-4 text-xs text-gray-500">
          Acknowledge within 3 working days and respond within 10 working days (SOP §26).
        </p>

        {loading ? (
          <p className="text-sm text-gray-500">Loading complaints…</p>
        ) : complaints.length === 0 ? (
          <EmptyState
            icon={<ChatBubbleBottomCenterTextIcon className="h-12 w-12 text-gray-300" />}
            title="No complaints logged"
            description="Any complaint about this booking will appear here."
          />
        ) : (
          <ul className="space-y-4">
            {complaints.map((complaint) => (
              <ComplaintRow
                key={complaint.id}
                complaint={complaint}
                canManage={canManage}
                onChanged={load}
              />
            ))}
          </ul>
        )}

        <div className="mt-4 space-y-3 border-t border-border pt-4">
          <h3 className="text-sm font-medium text-gray-700">Log a complaint</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <FormGroup label="Channel">
              <Select value={channel} onChange={(e) => setChannel(e.target.value)} options={COMPLAINT_CHANNEL_OPTIONS} />
            </FormGroup>
            <div className="sm:col-span-2">
              <FormGroup label="Summary">
                <Input value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="What the customer complained about" />
              </FormGroup>
            </div>
          </div>
          <Button type="button" size="sm" onClick={handleLog} loading={logging} disabled={logging}>
            Log complaint
          </Button>
        </div>
      </Card>
    </Section>
  )
}
