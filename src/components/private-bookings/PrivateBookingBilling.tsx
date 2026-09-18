'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Alert, Button, Card, Input, Modal, Select } from '@/ds'
import {
  cancelPrivateBookingExtraInvoice, deletePrivateBookingExtras, getPrivateBookingBilling,
  issuePrivateBookingExtras, previewPrivateBookingExtras, recordPrivateBookingInvoicePayment,
  resendPrivateBookingExtraInvoice, savePrivateBookingExtras,
} from '@/app/actions/privateBookingExtras'
import { getLineItemCatalog } from '@/app/actions/invoices'
import {
  calculateExtraChargeTotals, type AllocatedBookingPaymentInput, type ExtraChargeBatch,
  type ExtraChargeLine, type ExtraChargePreview, type PrivateBookingBilling as BillingData,
} from '@/lib/private-bookings/extra-charges'
import { DEFAULT_VAT_RATE } from '@/lib/private-bookings/vat'
import { formatDateFull, getTodayIsoDate } from '@/lib/dateUtils'
import type { LineItemCatalogItem } from '@/types/invoices'

interface Props {
  bookingId: string
  canIssue: boolean
  canRecordPayments: boolean
  canAddExtras: boolean
  onChanged: () => void
}
const money = (value: number): string => `£${value.toFixed(2)}`
const emptyLine = (): ExtraChargeLine => ({ description: '', quantity: 1, unit_price: 0, discount_percentage: 0, vat_rate: DEFAULT_VAT_RATE })

export function PrivateBookingBilling({ bookingId, canIssue, canRecordPayments, canAddExtras, onChanged }: Props): React.ReactElement {
  const [billing, setBilling] = useState<BillingData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submitting = useRef(false)
  const [editor, setEditor] = useState(false)
  const [batch, setBatch] = useState<ExtraChargeBatch | null>(null)
  const [batchId, setBatchId] = useState('')
  const [lines, setLines] = useState<ExtraChargeLine[]>([emptyLine()])
  const [dueDate, setDueDate] = useState('')
  const [reference, setReference] = useState('')
  const [catalogue, setCatalogue] = useState<LineItemCatalogItem[]>([])
  const [preview, setPreview] = useState<ExtraChargePreview | null>(null)
  const [allowWithoutOnlinePayment, setAllowWithoutOnlinePayment] = useState(false)
  const [cancelInvoiceId, setCancelInvoiceId] = useState<string | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [receiptId, setReceiptId] = useState('')
  const [paymentAmount, setPaymentAmount] = useState('')
  const [paymentDate, setPaymentDate] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<AllocatedBookingPaymentInput['method']>('bank_transfer')
  const [paymentReference, setPaymentReference] = useState('')
  const [allocations, setAllocations] = useState<Record<string, string>>({})
  const [discardBatch, setDiscardBatch] = useState<ExtraChargeBatch | null>(null)

  const load = useCallback(async (): Promise<void> => {
    const result = await getPrivateBookingBilling(bookingId)
    if (result.error || !result.data) throw new Error(result.error || 'Billing could not be loaded.')
    setBilling(result.data)
  }, [bookingId])

  useEffect(() => { void load().catch(reason => setError(reason instanceof Error ? reason.message : 'Billing could not be loaded.')) }, [load])

  async function act(action: () => Promise<void>): Promise<void> {
    if (submitting.current) return
    submitting.current = true
    setBusy(true)
    setError(null)
    setNotice(null)
    try { await action() } catch (reason) { setError(reason instanceof Error ? reason.message : 'The action could not be completed.') }
    finally { submitting.current = false; setBusy(false) }
  }

  async function changed(): Promise<void> { await load(); onChanged() }

  function openEditor(existing?: ExtraChargeBatch): void {
    setBatch(existing ?? null)
    setBatchId(existing?.id ?? crypto.randomUUID())
    setLines(existing?.lines.map(line => ({ ...line })) ?? [emptyLine()])
    setDueDate(existing?.due_date ?? '')
    setReference(existing?.reference ?? '')
    setPreview(null)
    setAllowWithoutOnlinePayment(false)
    setError(null)
    setEditor(true)
    void getLineItemCatalog().then(result => {
      if ('items' in result && result.items) setCatalogue(result.items.filter(item => item.is_active))
    }).catch(() => { /* Custom descriptions remain available if catalogue loading fails. */ })
  }

  function changeLine(index: number, update: Partial<ExtraChargeLine>): void {
    setLines(current => current.map((line, row) => row === index ? { ...line, ...update } : line))
    setPreview(null)
  }

  async function save(showPreview: boolean): Promise<void> {
    const result = await savePrivateBookingExtras({ bookingId, batchId, expectedRevision: batch?.revision ?? 0, dueDate, reference, lines })
    if (result.error || !result.batch) throw new Error(result.error || 'The draft could not be saved.')
    setBatch(result.batch)
    await load()
    if (showPreview) {
      const reviewed = await previewPrivateBookingExtras(bookingId, result.batch.id)
      if (reviewed.error || !reviewed.preview) throw new Error(reviewed.error || 'The invoice preview could not be loaded.')
      setPreview(reviewed.preview)
    } else { setEditor(false); setNotice('Extra charges saved as a draft. Nothing has been sent.'); onChanged() }
  }

  const totals = useMemo(() => calculateExtraChargeTotals(lines), [lines])
  const payable = billing?.invoices.filter(invoice => invoice.balance > 0 && !['void', 'written_off'].includes(invoice.status)) ?? []
  const allocationTotal = Object.values(allocations).reduce((sum, amount) => sum + Math.round((Number(amount) || 0) * 100), 0)

  return (
    <section id="booking-billing" aria-labelledby="booking-billing-title" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="booking-billing-title" className="text-lg font-semibold text-text">Invoices and extra charges</h2>
        <div className="flex flex-wrap gap-2">
          {canRecordPayments && payable.length > 0 && <Button variant="secondary" disabled={busy} onClick={() => {
            setReceiptId(crypto.randomUUID()); setPaymentAmount(''); setPaymentDate(getTodayIsoDate()); setPaymentReference(''); setAllocations({}); setPaymentOpen(true); setError(null)
          }}>Record invoice payment</Button>}
          {canIssue && canAddExtras && <Button disabled={busy} onClick={() => openEditor()}>Add extra charges</Button>}
        </div>
      </div>
      {error && !editor && !paymentOpen && !cancelInvoiceId && !discardBatch && <Alert variant="error">{error}</Alert>}
      {notice && <Alert variant="success">{notice}</Alert>}
      <Card>
        {!billing ? <p className="text-sm text-text-muted">{error ? 'Billing is unavailable.' : 'Loading invoices…'}</p> : <div className="space-y-4">
          <p className="text-sm text-text-muted">Additional charges: {money(billing.supplementaryTotal)}. Credits: {money(billing.creditsTotal)}. Outstanding across invoices: {money(billing.collectibleBalance)}.</p>
          {billing.invoices.map(invoice => <div key={invoice.id} className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
            <div>
              <Link className="font-medium text-primary underline" href={`/invoices/${invoice.id}`}>{invoice.invoice_number}</Link>
              <p className="text-sm text-text-muted">{invoice.kind === 'original' ? 'Original invoice' : 'Additional invoice'} · {invoice.status.replace(/_/g, ' ')} · Due {formatDateFull(invoice.due_date)}</p>
              <p className="text-sm text-text">{money(invoice.total_amount)} total · {money(invoice.credit_amount)} credited · {money(invoice.paid_amount)} paid · {money(invoice.balance)} due</p>
              <p className="text-xs text-text-muted">{invoice.deliveryState === 'sending' ? 'Sending or awaiting delivery check' : invoice.deliveryState === 'failed' ? 'Email failed' : invoice.sent_at ? `Sent ${formatDateFull(invoice.sent_at)}` : 'Not sent'}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <a className="text-sm text-primary underline" href={`/api/invoices/${invoice.id}/pdf`} target="_blank" rel="noreferrer">Download invoice</a>
              {canIssue && invoice.paymentUrl && <Button size="sm" variant="secondary" disabled={busy} onClick={() => void act(async () => {
                await navigator.clipboard.writeText(invoice.paymentUrl!); setNotice('Payment link copied.')
              })}>Copy payment link</Button>}
              {canIssue && invoice.kind === 'supplementary' && !['void', 'written_off'].includes(invoice.status) && <>
                <Button size="sm" variant="secondary" disabled={busy || invoice.deliveryState === 'sending'} onClick={() => void act(async () => {
                  const result = await resendPrivateBookingExtraInvoice(bookingId, invoice.id)
                  if (result.error || !result.sent) throw new Error(result.error || result.warning || 'The invoice was not sent.')
                  await changed(); setNotice(result.warning || 'Additional invoice sent.')
                })}>{invoice.sent_at ? 'Resend invoice' : 'Retry sending'}</Button>
                {invoice.paid_amount === 0 && <Button size="sm" variant="secondary" disabled={busy} onClick={() => { setCancelInvoiceId(invoice.id); setCancelReason(''); setError(null) }}>Cancel invoice</Button>}
              </>}
            </div>
          </div>)}
          {billing.batches.filter(draft => draft.status === 'draft').map(draft => <div key={draft.id} className="flex flex-wrap justify-between gap-2 rounded-default border border-border p-3">
            <div><p className="text-sm font-medium">Draft extras: {money(calculateExtraChargeTotals(draft.lines).totalAmount)}</p><p className="text-sm text-text-muted">{draft.lines.map(line => line.description).join(', ')}</p></div>
            {canIssue && <div className="flex gap-2"><Button size="sm" variant="secondary" disabled={busy} onClick={() => openEditor(draft)}>Edit draft</Button><Button size="sm" variant="secondary" disabled={busy} onClick={() => { setDiscardBatch(draft); setError(null) }}>Discard draft</Button></div>}
          </div>)}
        </div>}
      </Card>

      <Modal open={editor} onClose={() => { if (!busy) setEditor(false) }} title={preview ? 'Review additional invoice' : 'Extra booking charges'} width="xl" footer={<>
        <Button variant="secondary" disabled={busy} onClick={() => preview ? setPreview(null) : setEditor(false)}>{preview ? 'Edit draft' : 'Close'}</Button>
        {!preview ? <><Button variant="secondary" disabled={busy} onClick={() => void act(() => save(false))}>Save draft</Button><Button disabled={busy} onClick={() => void act(() => save(true))}>Preview invoice</Button></> : <Button disabled={busy || (!preview.paypalEnabled && !allowWithoutOnlinePayment)} onClick={() => void act(async () => {
          const result = await issuePrivateBookingExtras({ bookingId, batchId: preview.batch.id, expectedRevision: preview.batch.revision, sourceHash: preview.sourceHash, allowWithoutOnlinePayment })
          if (result.error) throw new Error(result.error)
          setEditor(false); setPreview(null); await changed()
          setNotice(result.warning || (result.sent ? `Invoice ${result.invoiceNumber} sent.` : 'Invoice created. Email was not sent; use Retry sending.'))
        })}>{busy ? 'Issuing…' : 'Issue and send additional invoice'}</Button>}
      </>}>
        <div className="space-y-4">
          {error && <Alert variant="error">{error}</Alert>}
          {preview ? <>
            <p>Send to {preview.recipientEmail}. Due {formatDateFull(preview.batch.due_date)}.</p>
            <p className="text-sm text-text-muted">This invoice contains only the extras below. Original charges and payments remain on their existing invoice.</p>
            {preview.batch.lines.map((line, index) => <p key={index} className="text-sm">{line.description} · {line.quantity} × {money(line.unit_price)} excluding VAT · {line.discount_percentage}% discount · {line.vat_rate}% VAT</p>)}
            {!preview.paypalEnabled && <Alert variant="warning" title="Online payments are not enabled">
              <p>Enable PayPal in the invoice customer settings to include a payment link.</p>
              <label className="mt-3 flex items-start gap-2"><input type="checkbox" checked={allowWithoutOnlinePayment} onChange={event => setAllowWithoutOnlinePayment(event.target.checked)} />Issue without an online payment link</label>
            </Alert>}
          </> : <>
            <p className="text-sm text-text-muted">Unit prices exclude VAT. The original booking discount does not apply to these extras.</p>
            <div className="grid gap-3 sm:grid-cols-2"><Input label="Payment due date" type="date" value={dueDate} required onChange={event => setDueDate(event.target.value)} /><Input label="Invoice reference (optional)" value={reference} onChange={event => setReference(event.target.value)} maxLength={500} /></div>
            {lines.map((line, index) => <fieldset key={index} className="space-y-3 rounded-default border border-border p-3">
              <legend className="px-1 text-sm font-medium">Extra charge {index + 1}</legend>
              {catalogue.length > 0 && <Select label={`Catalogue item ${index + 1}`} value={line.catalog_item_id ?? ''} onChange={event => {
                const item = catalogue.find(row => row.id === event.target.value)
                changeLine(index, item ? { catalog_item_id: item.id, description: item.description || item.name, unit_price: Number(item.default_price), vat_rate: Number(item.default_vat_rate) } : { catalog_item_id: null })
              }} options={[{ value: '', label: 'Custom item' }, ...catalogue.map(item => ({ value: item.id, label: item.name }))]} />}
              <Input label={`Description ${index + 1}`} value={line.description} maxLength={2000} onChange={event => changeLine(index, { description: event.target.value })} />
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Input label={`Quantity ${index + 1}`} type="number" step="0.01" min="0.01" value={line.quantity} onChange={event => changeLine(index, { quantity: Number(event.target.value) })} />
                <Input label={`Unit price excluding VAT ${index + 1}`} type="number" step="0.01" min="0" value={line.unit_price} onChange={event => changeLine(index, { unit_price: Number(event.target.value) })} />
                <Input label={`Discount % ${index + 1}`} type="number" step="0.01" min="0" max="100" value={line.discount_percentage} onChange={event => changeLine(index, { discount_percentage: Number(event.target.value) })} />
                <Input label={`VAT % ${index + 1}`} type="number" step="0.01" min="0" max="100" value={line.vat_rate} onChange={event => changeLine(index, { vat_rate: Number(event.target.value) })} />
              </div>
              {lines.length > 1 && <Button variant="secondary" size="sm" onClick={() => setLines(current => current.filter((_, row) => row !== index))}>Remove charge {index + 1}</Button>}
            </fieldset>)}
            <Button variant="secondary" disabled={lines.length >= 100} onClick={() => setLines(current => [...current, emptyLine()])}>Add another line</Button>
          </>}
          <dl className="grid grid-cols-2 gap-2 border-t border-border pt-3 text-sm"><dt>Net after discounts</dt><dd className="text-right">{money((preview?.totals ?? totals).subtotalBeforeInvoiceDiscount)}</dd><dt>VAT</dt><dd className="text-right">{money((preview?.totals ?? totals).vatAmount)}</dd><dt className="font-semibold">Additional invoice total</dt><dd className="text-right font-semibold">{money((preview?.totals ?? totals).totalAmount)}</dd></dl>
        </div>
      </Modal>

      <Modal open={paymentOpen} onClose={() => { if (!busy) setPaymentOpen(false) }} title="Record invoice payment" width="lg" footer={<>
        <Button variant="secondary" disabled={busy} onClick={() => setPaymentOpen(false)}>Cancel</Button><Button disabled={busy || allocationTotal <= 0 || allocationTotal !== Math.round(Number(paymentAmount) * 100)} onClick={() => void act(async () => {
          const result = await recordPrivateBookingInvoicePayment({ bookingId, receiptId, amount: Number(paymentAmount), paymentDate, method: paymentMethod, reference: paymentReference, allocations: Object.entries(allocations).filter(([, amount]) => Number(amount) > 0).map(([invoiceId, amount]) => ({ invoiceId, amount: Number(amount) })) })
          if (result.error) throw new Error(result.error)
          setPaymentOpen(false); await changed(); setNotice('Payment recorded against the selected invoices.')
        })}>Record payment</Button>
      </>}>
        <div className="space-y-3">
          {error && <Alert variant="error">{error}</Alert>}
          <Input label="Total payment received" type="number" step="0.01" min="0.01" value={paymentAmount} onChange={event => setPaymentAmount(event.target.value)} />
          <Input label="Date payment received" type="date" value={paymentDate} onChange={event => setPaymentDate(event.target.value)} />
          <Select label="Payment method" value={paymentMethod} onChange={event => setPaymentMethod(event.target.value as AllocatedBookingPaymentInput['method'])} options={[{ value: 'bank_transfer', label: 'Bank transfer' }, { value: 'cash', label: 'Cash' }, { value: 'card', label: 'Card' }, { value: 'cheque', label: 'Cheque' }, { value: 'other', label: 'Other' }]} />
          <Input label="Payment reference (optional)" value={paymentReference} onChange={event => setPaymentReference(event.target.value)} />
          <p className="text-sm text-text-muted">Allocate this receipt to the invoices it pays. PayPal payments are recorded automatically.</p>
          {payable.map(invoice => <Input key={invoice.id} label={`${invoice.invoice_number}: ${money(invoice.balance)} outstanding`} type="number" min="0" max={invoice.balance} step="0.01" value={allocations[invoice.id] ?? ''} onChange={event => setAllocations(current => ({ ...current, [invoice.id]: event.target.value }))} />)}
          <p className="text-sm">Allocated: {money(allocationTotal / 100)} of {money(Number(paymentAmount) || 0)}.</p>
        </div>
      </Modal>

      <Modal open={Boolean(cancelInvoiceId)} onClose={() => { if (!busy) setCancelInvoiceId(null) }} title="Cancel additional invoice" footer={<>
        <Button variant="secondary" disabled={busy} onClick={() => setCancelInvoiceId(null)}>Keep invoice</Button><Button disabled={busy || !cancelReason.trim()} onClick={() => void act(async () => {
          const result = await cancelPrivateBookingExtraInvoice(bookingId, cancelInvoiceId!, cancelReason)
          if (result.error) throw new Error(result.error)
          setCancelInvoiceId(null); await changed(); setNotice('Additional invoice cancelled. Its payment link is no longer payable.')
        })}>Cancel invoice</Button>
      </>}><div className="space-y-3">{error && <Alert variant="error">{error}</Alert>}<p className="text-sm">This withdraws this unpaid additional invoice and its charge. It does not change the original invoice or send a customer message.</p><Input label="Reason for cancellation" value={cancelReason} onChange={event => setCancelReason(event.target.value)} /></div></Modal>

      <Modal open={Boolean(discardBatch)} onClose={() => { if (!busy) setDiscardBatch(null) }} title="Discard draft extras" footer={<>
        <Button variant="secondary" disabled={busy} onClick={() => setDiscardBatch(null)}>Keep draft</Button><Button disabled={busy} onClick={() => void act(async () => {
          const result = await deletePrivateBookingExtras(bookingId, discardBatch!.id, discardBatch!.revision)
          if (result.error) throw new Error(result.error)
          setDiscardBatch(null); await changed(); setNotice('Draft discarded.')
        })}>Discard draft</Button>
      </>}><div className="space-y-3">{error && <Alert variant="error">{error}</Alert>}<p>Discard these unissued extras? No invoice or payment will be changed.</p></div></Modal>
    </section>
  )
}
