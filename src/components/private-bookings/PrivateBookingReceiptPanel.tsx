'use client'

import { useRef, useState } from 'react'
import { Alert, Button, Card, Modal } from '@/ds'
import { generatePrivateBookingReceipt, previewPrivateBookingReceipt, sendPrivateBookingReceipt } from '@/app/actions/privateBookingReceipt'
import type { BookingReceiptDocument, BookingReceiptModel } from '@/lib/private-bookings/booking-receipt'
import { formatDateFull } from '@/lib/dateUtils'

const money = (value: number): string => `£${value.toFixed(2)}`
interface Props { bookingId: string; canGenerate: boolean }

export function PrivateBookingReceiptPanel({ bookingId, canGenerate }: Props): React.ReactElement {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const locked = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [model, setModel] = useState<BookingReceiptModel | null>(null)
  const [documents, setDocuments] = useState<BookingReceiptDocument[]>([])
  const [sendDocument, setSendDocument] = useState<BookingReceiptDocument | null>(null)

  async function load(): Promise<void> {
    const result = await previewPrivateBookingReceipt(bookingId)
    if (result.error || !result.data) throw new Error(result.error || 'The receipt preview could not be loaded.')
    setModel(result.data.model)
    setDocuments(result.data.documents)
  }
  async function act(action: () => Promise<void>): Promise<void> {
    if (locked.current) return
    locked.current = true; setBusy(true); setError(null); setNotice(null)
    try { await action() } catch (reason) { setError(reason instanceof Error ? reason.message : 'The receipt could not be prepared.') }
    finally { locked.current = false; setBusy(false) }
  }

  return <section className="space-y-3" aria-labelledby="booking-receipt-title">
    <h2 id="booking-receipt-title" className="text-lg font-semibold text-text">Booking receipt</h2>
    <Card><div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-text-muted">Review all charges and dated payments across this booking.</p><Button variant="secondary" disabled={busy} onClick={() => { setOpen(true); void act(load) }}>Preview final receipt</Button></div></Card>
    <Modal open={open} onClose={() => { if (!busy) { setOpen(false); setSendDocument(null) } }} title={model?.kind === 'final_receipt' ? 'Final booking receipt' : 'Booking payment statement'} width="xl" footer={<>
      <Button variant="secondary" disabled={busy} onClick={() => setOpen(false)}>Close</Button>
      {canGenerate && <Button disabled={busy || !model} onClick={() => void act(async () => {
        const result = await generatePrivateBookingReceipt(bookingId)
        if (result.error || !result.data) throw new Error(result.error || 'The document could not be generated.')
        await load(); setNotice('Document saved. Download the stored version below, or send it to the booking contact.')
      })}>Generate {model?.kind === 'final_receipt' ? 'final receipt' : 'statement'}</Button>}
    </>}>
      <div className="space-y-4">
        {error && <Alert variant="error">{error}</Alert>}
        {notice && <Alert variant="success">{notice}</Alert>}
        {busy && !model && <p>Loading charges and payments…</p>}
        {model && <>
          {model.blockers.length > 0 && <Alert variant="warning" title="A final receipt is not ready"><ul className="list-disc pl-5">{model.blockers.map(reason => <li key={reason}>{reason}</li>)}</ul><p className="mt-2">You can generate a payment statement showing the current position.</p></Alert>}
          <dl className="grid grid-cols-2 gap-2 text-sm">{([
            ['Charges', model.totals.charges], ['Credits', model.totals.credits], ['Payments received', model.totals.receipts],
            ['Refunds completed', model.totals.refunds], ['Applied to charges', model.totals.applied], ['Balance due', model.totals.balanceDue],
            ['Credit balance', model.totals.creditBalance], ['Deposit still held', model.totals.depositHeld],
          ] as const).map(([label, amount]) => <div className="contents" key={label}><dt>{label}</dt><dd className="text-right">{money(amount)}</dd></div>)}</dl>
          {model.invoices.map(invoice => <div key={invoice.id} className="rounded-default border border-border p-3"><h3 className="font-medium">{invoice.number} · {formatDateFull(invoice.date)}</h3><ul className="mt-2 space-y-1 text-sm">{invoice.lines.map((line, index) => <li className="flex justify-between gap-3" key={index}><span>{line.description} × {line.quantity}</span><span>{money(line.gross)}</span></li>)}</ul></div>)}
          <h3 className="font-medium">Payments received</h3>
          <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th scope="col" className="p-2">Date</th><th scope="col" className="p-2">Purpose</th><th scope="col" className="p-2">Method</th><th scope="col" className="p-2 text-right">Amount</th></tr></thead><tbody>{model.payments.map(payment => <tr key={payment.id} className="border-t border-border"><td className="p-2">{formatDateFull(payment.date)}{payment.recordedDate && <span className="block text-xs text-text-muted">Recorded date</span>}</td><td className="p-2">{payment.purpose}{payment.reference && <span className="block text-xs">{payment.reference}</span>}</td><td className="p-2">{payment.method.replace(/_/g, ' ')}</td><td className="p-2 text-right">{money(payment.amount)}</td></tr>)}</tbody></table></div>
          {model.refunds.length > 0 && <div><h3 className="font-medium">Refunds</h3>{model.refunds.map(refund => <p key={refund.id} className="text-sm">{refund.date ? formatDateFull(refund.date) : 'Awaiting completion'} · {refund.purpose} · {money(refund.amount)} · {refund.status}</p>)}</div>}
        </>}
        {documents.length > 0 && <div className="space-y-2 border-t border-border pt-3"><h3 className="font-medium">Stored documents</h3>{documents.map(document => <div className="flex flex-wrap items-center justify-between gap-2" key={document.id}><a className="text-sm text-primary underline" href={document.url} target="_blank" rel="noreferrer">{document.kind === 'final_receipt' ? 'Final receipt' : 'Statement'} v{document.version} · {formatDateFull(document.generatedAt)}{document.superseded ? ' (superseded)' : ''}</a>{canGenerate && !document.superseded && <Button size="sm" variant="secondary" disabled={busy} onClick={() => setSendDocument(document)}>Send document</Button>}</div>)}</div>}
        {sendDocument && <div className="space-y-3 rounded-default border border-border p-3"><p className="text-sm">Send {sendDocument.kind === 'final_receipt' ? 'final receipt' : 'statement'} v{sendDocument.version} to the booking contact?</p><div className="flex gap-2"><Button variant="secondary" disabled={busy} onClick={() => setSendDocument(null)}>Cancel</Button><Button disabled={busy} onClick={() => void act(async () => {
          const result = await sendPrivateBookingReceipt(bookingId, sendDocument.id)
          if (result.error) throw new Error(result.error)
          setSendDocument(null); setNotice('Document sent to the booking contact.')
        })}>Send to booking contact</Button></div></div>}
      </div>
    </Modal>
  </section>
}
