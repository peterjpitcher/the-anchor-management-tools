'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Card,
  Button,
  LinkButton,
  Input,
  Select,
  Textarea,
  Modal,
  ConfirmDialog,
  Alert,
  Badge,
  toast,
} from '@/ds'
import { formatDateInLondon, formatDateFull, formatDateTime12Hour } from '@/lib/dateUtils'
import {
  redeemVoucher,
  undoVoucherRedeem,
  cancelVoucher,
  replaceVoucher,
  editVoucherHandout,
  assignVoucherCustomer,
  overrideRedeemVoucher,
  listReplacementCandidates,
  searchCustomersForVoucher,
} from '@/app/actions/vouchers'
import type {
  VoucherDetail,
  HandoutStaffOption,
  ReplacementCandidate,
  VoucherCustomerHit,
} from '@/app/actions/vouchers'
import {
  VoucherStatusBadge,
  VOUCHER_EVENT_ACTION_LABELS,
  REMINDER_KIND_LABELS,
  REMINDER_CHANNEL_LABELS,
  REMINDER_STATUS_TONES,
  formatPence,
  newIdempotencyKey,
} from '../_shared/voucher-ui'

interface VoucherDetailClientProps {
  detail: VoucherDetail
  staff: HandoutStaffOption[]
}

type DialogKind =
  | 'redeem'
  | 'override'
  | 'undo'
  | 'cancel'
  | 'replace'
  | 'edit'
  | 'assign'
  | null

export function VoucherDetailClient({ detail, staff }: VoucherDetailClientProps) {
  const router = useRouter()
  const { voucher, type } = detail
  const [dialog, setDialog] = useState<DialogKind>(null)
  const [busy, setBusy] = useState(false)
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey())

  const [staffId, setStaffId] = useState('')
  const [reason, setReason] = useState('')
  const [transactionRef, setTransactionRef] = useState('')
  const [bookingRef, setBookingRef] = useState('')

  const [candidates, setCandidates] = useState<ReplacementCandidate[]>([])
  const [replacementNumber, setReplacementNumber] = useState('')

  const [editWonAt, setEditWonAt] = useState(voucher.wonAtLabel ?? '')
  const [editExpiry, setEditExpiry] = useState(voucher.expiryDate ?? '')
  const [editStaffId, setEditStaffId] = useState(voucher.issuedBy ?? '')

  const [customerQuery, setCustomerQuery] = useState('')
  const [customerHits, setCustomerHits] = useState<VoucherCustomerHit[]>([])
  const [removeCustomerOpen, setRemoveCustomerOpen] = useState(false)
  const [reprintConfirmOpen, setReprintConfirmOpen] = useState(false)

  const openDialog = (kind: Exclude<DialogKind, null>) => {
    setIdempotencyKey(newIdempotencyKey())
    setReason('')
    setTransactionRef('')
    setBookingRef('')
    setStaffId('')
    setReplacementNumber('')
    setEditWonAt(voucher.wonAtLabel ?? '')
    setEditExpiry(voucher.expiryDate ?? '')
    setEditStaffId(voucher.issuedBy ?? '')
    setCustomerQuery('')
    setCustomerHits([])
    if (kind === 'replace') {
      void listReplacementCandidates(voucher.typeId).then((result) => {
        if (result.data) setCandidates(result.data)
        else toast.error(result.error ?? 'Could not load stock cards.')
      })
    }
    setDialog(kind)
  }

  const finish = (message: string) => {
    toast.success(message)
    setDialog(null)
    setRemoveCustomerOpen(false)
    router.refresh()
  }

  const fail = (message?: string) => {
    toast.error(message ?? 'That did not work. Try again.')
  }

  const run = async (fn: () => Promise<{ success?: boolean; error?: string }>, done: string) => {
    setBusy(true)
    const result = await fn()
    setBusy(false)
    if (result.success) finish(done)
    else fail(result.error)
  }

  const handleReprint = async () => {
    try {
      const response = await fetch(`/api/vouchers/batches/${voucher.batchId}/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voucherNumbers: [voucher.voucherNumber] }),
      })
      if (!response.ok) {
        fail('The reprint could not be rendered.')
        return
      }
      const payload = (await response.json()) as { url?: string }
      if (payload.url) {
        window.open(payload.url, '_blank', 'noopener')
        router.refresh()
      } else {
        fail('The reprint did not return a download link.')
      }
    } catch {
      fail('The reprint could not be rendered.')
    }
  }

  const searchCustomers = (query: string) => {
    setCustomerQuery(query)
    if (query.trim().length < 2) {
      setCustomerHits([])
      return
    }
    void searchCustomersForVoucher(query).then((result) => {
      if (result.data) setCustomerHits(result.data)
    })
  }

  const status = voucher.status
  const canAttachCustomer = ['issued', 'redeemed', 'expired'].includes(status)

  return (
    <div className="space-y-6">
      {/* ------------------------------------------------ header */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <span className="font-mono text-2xl font-semibold text-gray-900">
                {voucher.voucherNumber}
              </span>
              <VoucherStatusBadge status={status} />
            </div>
            <div className="mt-1 text-gray-700">{type?.displayTitle ?? voucher.typeId}</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {type?.alcohol && <Badge tone="warning">18+ alcohol</Badge>}
              {type?.requiresBooking && <Badge tone="info">Booking required</Badge>}
              {voucher.valuePence !== null && (
                <Badge tone="neutral">{formatPence(voucher.valuePence)} value</Badge>
              )}
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
            {detail.ageLabel && (
              <>
                <dt className="text-gray-500">Age</dt>
                <dd className="text-gray-900">{detail.ageLabel}</dd>
              </>
            )}
            {voucher.expiryDate && (
              <>
                <dt className="text-gray-500">Expiry</dt>
                <dd className="text-gray-900">{formatDateFull(voucher.expiryDate)}</dd>
              </>
            )}
            <dt className="text-gray-500">Terms</dt>
            <dd>
              <Link href="/vouchers/types" className="underline underline-offset-2">
                {voucher.termsVersion}
              </Link>
            </dd>
          </dl>
        </div>
      </Card>

      {/* ------------------------------------------------ terminal states */}
      {status === 'cancelled' && (
        <Alert tone="danger" title="This voucher is cancelled">
          {voucher.cancelledReason ? `Reason: ${voucher.cancelledReason}. ` : ''}
          Cancelled vouchers are terminal: no reinstatement, no reprint.
        </Alert>
      )}
      {status === 'replaced' && (
        <Alert tone="warning" title="This voucher has been replaced">
          {detail.replacedByNumber ? (
            <span>
              The live card is now{' '}
              <Link
                href={`/vouchers/${detail.replacedByNumber}`}
                className="font-mono underline underline-offset-2"
              >
                {detail.replacedByNumber}
              </Link>
              .
            </span>
          ) : (
            'A replacement card has taken over.'
          )}
        </Alert>
      )}
      {detail.replacesNumber && (
        <Alert tone="info" title="This card is a replacement">
          <span>
            It replaced{' '}
            <Link
              href={`/vouchers/${detail.replacesNumber}`}
              className="font-mono underline underline-offset-2"
            >
              {detail.replacesNumber}
            </Link>
            .
          </span>
        </Alert>
      )}

      {/* ------------------------------------------------ actions */}
      {(status === 'generated' ||
        status === 'issued' ||
        status === 'redeemed' ||
        status === 'expired') && (
        <Card title="Actions">
          <div className="flex flex-wrap gap-2">
            {status === 'generated' && (
              <>
                <LinkButton
                  href={`/vouchers/handout?number=${encodeURIComponent(voucher.voucherNumber)}`}
                  variant="primary"
                >
                  Hand out
                </LinkButton>
                <Button variant="secondary" onClick={() => void handleReprint()}>
                  Reprint
                </Button>
                <Button variant="danger" onClick={() => openDialog('cancel')}>
                  Cancel voucher
                </Button>
              </>
            )}
            {status === 'issued' && (
              <>
                <Button variant="primary" onClick={() => openDialog('redeem')}>
                  Redeem
                </Button>
                <Button variant="secondary" onClick={() => openDialog('edit')}>
                  Edit hand-out details
                </Button>
                <Button variant="secondary" onClick={() => openDialog('replace')}>
                  Replace
                </Button>
                <Button variant="secondary" onClick={() => setReprintConfirmOpen(true)}>
                  Reprint
                </Button>
                <Button variant="danger" onClick={() => openDialog('cancel')}>
                  Cancel voucher
                </Button>
              </>
            )}
            {status === 'redeemed' && (
              <Button variant="secondary" onClick={() => openDialog('undo')}>
                Undo redemption
              </Button>
            )}
            {status === 'expired' && (
              <>
                <Button variant="primary" onClick={() => openDialog('override')}>
                  Redeem despite expiry
                </Button>
                <Button variant="secondary" onClick={() => openDialog('edit')}>
                  Edit expiry
                </Button>
              </>
            )}
          </div>
          {status === 'expired' && (
            <p className="mt-2 text-sm text-gray-500">
              Editing the expiry to a future date puts the voucher back to issued and rebuilds its
              reminders.
            </p>
          )}
        </Card>
      )}

      {/* ------------------------------------------------ hand-out block */}
      {voucher.issuedAt && (
        <Card title="Hand-out">
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2 text-sm">
            <div>
              <dt className="text-gray-500">Handed out</dt>
              <dd className="text-gray-900">{formatDateTime12Hour(voucher.issuedAt)}</dd>
            </div>
            <div>
              <dt className="text-gray-500">By</dt>
              <dd className="text-gray-900">{voucher.issuedByName ?? 'Unknown'}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Won at</dt>
              <dd className="text-gray-900">
                {voucher.wonAtLabel ?? ''}
                {detail.eventName && detail.eventName !== voucher.wonAtLabel
                  ? ` (${detail.eventName})`
                  : ''}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Expiry written on the card</dt>
              <dd className="text-gray-900">
                {voucher.expiryDate ? formatDateFull(voucher.expiryDate) : 'Missing'}
              </dd>
            </div>
          </dl>
        </Card>
      )}

      {/* ------------------------------------------------ customer block */}
      <Card
        title="Customer"
        subtitle="Assigning a customer enables SMS reminders about this voucher"
      >
        <div className="space-y-4">
          {detail.customer ? (
            <div className="flex flex-wrap items-center gap-3">
              <div>
                <Link
                  href={`/customers/${detail.customer.id}`}
                  className="font-medium text-gray-900 underline-offset-2 hover:underline"
                >
                  {detail.customer.name}
                </Link>
                {detail.customer.mobile && (
                  <span className="ml-2 text-sm text-gray-500">{detail.customer.mobile}</span>
                )}
              </div>
              {canAttachCustomer && (
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" onClick={() => openDialog('assign')}>
                    Change
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setRemoveCustomerOpen(true)}>
                    Remove
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-500">No customer assigned.</span>
              {canAttachCustomer && (
                <Button variant="secondary" size="sm" onClick={() => openDialog('assign')}>
                  Assign customer
                </Button>
              )}
            </div>
          )}

          {detail.reminders.length > 0 && (
            <div>
              <div className="text-sm font-medium text-gray-700 mb-2">Reminders</div>
              <ul className="space-y-1 text-sm">
                {detail.reminders.map((reminder) => (
                  <li key={reminder.id} className="flex flex-wrap items-center gap-2">
                    <Badge tone={REMINDER_STATUS_TONES[reminder.status]}>
                      {reminder.status}
                    </Badge>
                    <span className="text-gray-900">
                      {REMINDER_KIND_LABELS[reminder.reminderKind]}
                    </span>
                    <span className="text-gray-500">
                      due{' '}
                      {formatDateInLondon(reminder.scheduledFor, {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                      {reminder.sentAt
                        ? `, sent${
                            reminder.channel
                              ? ` by ${REMINDER_CHANNEL_LABELS[reminder.channel]}`
                              : ''
                          } ${formatDateTime12Hour(reminder.sentAt)}`
                        : ''}
                      {reminder.lastError ? `, error: ${reminder.lastError}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Card>

      {/* ------------------------------------------------ redemption block */}
      {voucher.redeemedAt && (
        <Card title="Redemption">
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2 text-sm">
            <div>
              <dt className="text-gray-500">Redeemed</dt>
              <dd className="text-gray-900">{formatDateTime12Hour(voucher.redeemedAt)}</dd>
            </div>
            <div>
              <dt className="text-gray-500">By</dt>
              <dd className="text-gray-900">{voucher.redeemedByName ?? 'Unknown'}</dd>
            </div>
            {voucher.transactionRef && (
              <div>
                <dt className="text-gray-500">Transaction ref</dt>
                <dd className="text-gray-900">{voucher.transactionRef}</dd>
              </div>
            )}
            {voucher.bookingRef && (
              <div>
                <dt className="text-gray-500">Booking ref</dt>
                <dd className="text-gray-900">{voucher.bookingRef}</dd>
              </div>
            )}
          </dl>
        </Card>
      )}

      {/* ------------------------------------------------ entitlement */}
      {detail.entitlementHtml && (
        <Card title="What the card entitles" subtitle="From the definition printed on this card">
          <div
            className="prose prose-sm max-w-none text-gray-700"
            dangerouslySetInnerHTML={{ __html: detail.entitlementHtml }}
          />
        </Card>
      )}

      {/* ------------------------------------------------ timeline */}
      <Card title="Timeline">
        <ul className="space-y-3">
          {detail.events.map((event) => (
            <li key={event.id} className="flex gap-3">
              <div className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-gray-400" />
              <div>
                <div className="text-sm font-medium text-gray-900">
                  {VOUCHER_EVENT_ACTION_LABELS[event.action]}
                </div>
                <div className="text-xs text-gray-500">
                  {formatDateTime12Hour(event.at)} · {event.actorName} · {event.source}
                </div>
              </div>
            </li>
          ))}
          {detail.events.length === 0 && (
            <li className="text-sm text-gray-500">No events recorded.</li>
          )}
        </ul>
      </Card>

      {/* ------------------------------------------------ dialogs */}
      <Modal
        open={dialog === 'redeem'}
        onClose={() => setDialog(null)}
        title={`Redeem ${voucher.voucherNumber}`}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDialog(null)}>
              Back
            </Button>
            <Button
              variant="primary"
              loading={busy}
              disabled={!staffId}
              onClick={() =>
                void run(
                  () =>
                    redeemVoucher({
                      voucherNumber: voucher.voucherNumber,
                      employeeId: staffId,
                      transactionRef: transactionRef.trim() || undefined,
                      bookingRef: bookingRef.trim() || undefined,
                      idempotencyKey,
                    }),
                  'Voucher redeemed'
                )
              }
            >
              Mark as used
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <Select
            label="Taken by"
            value={staffId}
            onChange={(event) => setStaffId(event.target.value)}
            placeholder="Choose a staff member"
            options={staff.map((member) => ({
              value: member.employeeId,
              label: member.clockedIn ? `${member.name} (clocked in)` : member.name,
            }))}
          />
          <Input
            label="Transaction ref (optional)"
            value={transactionRef}
            onChange={(event) => setTransactionRef(event.target.value)}
            maxLength={100}
          />
          <Input
            label="Booking ref (optional)"
            value={bookingRef}
            onChange={(event) => setBookingRef(event.target.value)}
            maxLength={100}
          />
        </div>
      </Modal>

      <Modal
        open={dialog === 'override'}
        onClose={() => setDialog(null)}
        title={`Redeem ${voucher.voucherNumber} despite expiry`}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDialog(null)}>
              Back
            </Button>
            <Button
              variant="primary"
              loading={busy}
              disabled={!staffId || reason.trim().length < 3}
              onClick={() =>
                void run(
                  () =>
                    overrideRedeemVoucher({
                      voucherNumber: voucher.voucherNumber,
                      reason: reason.trim(),
                      employeeId: staffId,
                      transactionRef: transactionRef.trim() || undefined,
                      bookingRef: bookingRef.trim() || undefined,
                      idempotencyKey,
                    }),
                  'Voucher redeemed despite expiry'
                )
              }
            >
              Redeem anyway
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-gray-600">
            This voucher expired{' '}
            {voucher.expiryDate ? `on ${formatDateFull(voucher.expiryDate)}` : ''}. A manager
            override is recorded in the timeline.
          </p>
          <Textarea
            label="Reason (required)"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={2}
            maxLength={500}
          />
          <Select
            label="Taken by"
            value={staffId}
            onChange={(event) => setStaffId(event.target.value)}
            placeholder="Choose a staff member"
            options={staff.map((member) => ({
              value: member.employeeId,
              label: member.clockedIn ? `${member.name} (clocked in)` : member.name,
            }))}
          />
          <Input
            label="Transaction ref (optional)"
            value={transactionRef}
            onChange={(event) => setTransactionRef(event.target.value)}
            maxLength={100}
          />
          <Input
            label="Booking ref (optional)"
            value={bookingRef}
            onChange={(event) => setBookingRef(event.target.value)}
            maxLength={100}
          />
        </div>
      </Modal>

      <Modal
        open={dialog === 'undo'}
        onClose={() => setDialog(null)}
        title={`Undo the redemption of ${voucher.voucherNumber}`}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDialog(null)}>
              Back
            </Button>
            <Button
              variant="primary"
              loading={busy}
              disabled={reason.trim().length < 3}
              onClick={() =>
                void run(
                  () =>
                    undoVoucherRedeem({
                      voucherNumber: voucher.voucherNumber,
                      reason: reason.trim(),
                      idempotencyKey,
                    }),
                  'Redemption undone, voucher is issued again'
                )
              }
            >
              Undo redemption
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-gray-600">
            The voucher goes back to issued and its redemption details are cleared. The timeline
            keeps the full history.
          </p>
          <Textarea
            label="Reason (required)"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={2}
            maxLength={500}
          />
        </div>
      </Modal>

      <Modal
        open={dialog === 'cancel'}
        onClose={() => setDialog(null)}
        title={`Cancel ${voucher.voucherNumber}`}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDialog(null)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              loading={busy}
              disabled={reason.trim().length < 3}
              onClick={() =>
                void run(
                  () =>
                    cancelVoucher({
                      voucherNumber: voucher.voucherNumber,
                      reason: reason.trim(),
                      idempotencyKey,
                    }),
                  'Voucher cancelled'
                )
              }
            >
              Cancel voucher
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-gray-600">
            Cancelling is permanent: no reinstatement and no reprint afterwards.
          </p>
          <Textarea
            label="Reason (required)"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={2}
            maxLength={500}
          />
        </div>
      </Modal>

      <Modal
        open={dialog === 'replace'}
        onClose={() => setDialog(null)}
        title={`Replace ${voucher.voucherNumber}`}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDialog(null)}>
              Back
            </Button>
            <Button
              variant="primary"
              loading={busy}
              disabled={!replacementNumber || reason.trim().length < 3}
              onClick={() =>
                void run(
                  () =>
                    replaceVoucher({
                      originalNumber: voucher.voucherNumber,
                      replacementNumber,
                      reason: reason.trim(),
                      idempotencyKey,
                    }),
                  'Voucher replaced'
                )
              }
            >
              Replace with selected card
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-gray-600">
            Pick a printed stock card of the same type. It takes over this voucher&apos;s
            customer, event and expiry. Nothing new is printed and this card becomes terminal.
          </p>
          <Select
            label="Replacement card"
            value={replacementNumber}
            onChange={(event) => setReplacementNumber(event.target.value)}
            placeholder={candidates.length === 0 ? 'No stock cards of this type available' : 'Choose a stock card'}
            options={candidates.map((candidate) => ({
              value: candidate.voucherNumber,
              label: candidate.voucherNumber,
            }))}
          />
          <Textarea
            label="Reason (required)"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={2}
            maxLength={500}
          />
        </div>
      </Modal>

      <Modal
        open={dialog === 'edit'}
        onClose={() => setDialog(null)}
        title={`Edit hand-out details of ${voucher.voucherNumber}`}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDialog(null)}>
              Back
            </Button>
            <Button
              variant="primary"
              loading={busy}
              disabled={reason.trim().length < 3}
              onClick={() => {
                const patch: {
                  employeeId?: string
                  wonAtLabel?: string
                  expiryDate?: string
                } = {}
                if (editStaffId && editStaffId !== (voucher.issuedBy ?? '')) {
                  patch.employeeId = editStaffId
                }
                if (editWonAt.trim() && editWonAt.trim() !== (voucher.wonAtLabel ?? '')) {
                  patch.wonAtLabel = editWonAt.trim()
                }
                if (editExpiry && editExpiry !== (voucher.expiryDate ?? '')) {
                  patch.expiryDate = editExpiry
                }
                if (Object.keys(patch).length === 0) {
                  toast.error('Nothing has changed.')
                  return
                }
                void run(
                  () =>
                    editVoucherHandout({
                      voucherNumber: voucher.voucherNumber,
                      reason: reason.trim(),
                      patch,
                    }),
                  'Hand-out details updated'
                )
              }}
            >
              Save changes
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <Input
            label="Won at"
            value={editWonAt}
            onChange={(event) => setEditWonAt(event.target.value)}
            maxLength={200}
          />
          <Input
            type="date"
            label="Expiry date"
            value={editExpiry}
            onChange={(event) => setEditExpiry(event.target.value)}
            hint="Moving the expiry recomputes the status and the reminder schedule."
          />
          <Select
            label="Handed out by"
            value={editStaffId}
            onChange={(event) => setEditStaffId(event.target.value)}
            placeholder="Keep current"
            options={staff.map((member) => ({
              value: member.employeeId,
              label: member.clockedIn ? `${member.name} (clocked in)` : member.name,
            }))}
          />
          <Textarea
            label="Reason (required)"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={2}
            maxLength={500}
          />
        </div>
      </Modal>

      <Modal
        open={dialog === 'assign'}
        onClose={() => setDialog(null)}
        title={detail.customer ? 'Change the customer' : 'Assign a customer'}
      >
        <div className="space-y-3">
          <Input
            label="Search by name or mobile"
            value={customerQuery}
            onChange={(event) => searchCustomers(event.target.value)}
            autoComplete="off"
          />
          {customerHits.length > 0 && (
            <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
              {customerHits.map((hit) => (
                <li key={hit.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () =>
                          assignVoucherCustomer({
                            voucherNumber: voucher.voucherNumber,
                            customerId: hit.id,
                          }),
                        `Voucher assigned to ${hit.name}`
                      )
                    }
                    className="flex w-full items-center justify-between px-4 py-2.5 text-left hover:bg-gray-50"
                  >
                    <span className="text-gray-900">{hit.name}</span>
                    <span className="text-sm text-gray-500">{hit.mobile ?? ''}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-gray-500">
            Reassigning retargets pending reminders. Reminder milestones already sent are never
            repeated for this voucher.
          </p>
        </div>
      </Modal>

      <ConfirmDialog
        open={removeCustomerOpen}
        onClose={() => setRemoveCustomerOpen(false)}
        onConfirm={() =>
          void run(
            () =>
              assignVoucherCustomer({
                voucherNumber: voucher.voucherNumber,
                customerId: null,
              }),
            'Customer removed from the voucher'
          )
        }
        title="Remove the customer?"
        message="Pending SMS reminders for this voucher will be cancelled."
        confirmLabel="Remove customer"
        tone="warning"
      />

      <ConfirmDialog
        open={reprintConfirmOpen}
        onClose={() => setReprintConfirmOpen(false)}
        onConfirm={() => {
          setReprintConfirmOpen(false)
          void handleReprint()
        }}
        title="Reprint an issued card?"
        message="Reprinting an issued card is only allowed when the original is destroyed or unusable."
        confirmLabel="Original destroyed or unusable, reprint"
        tone="warning"
      />
    </div>
  )
}
