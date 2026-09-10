'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardHeader, CardBody, Button, Input, Select, Checkbox, toast } from '@/ds'
import { saveEventTicketSettings } from '@/app/actions/event-ticket-settings'
import type { BookingQuestion } from '@/lib/events/booking-questions'
import { londonLocalInputToUtcIso, utcIsoToLondonLocalInput } from '@/lib/dateUtils'

export interface TicketSettingsEvent {
  id: string
  payment_mode?: string | null
  online_discount_type?: string | null
  online_discount_value?: number | string | null
  online_discount_ends_at?: string | null
  booking_questions?: BookingQuestion[] | null
}

interface Props { event: TicketSettingsEvent; canManage: boolean }

export function EventTicketSettings({ event, canManage }: Props) {
  const router = useRouter()
  const [mode, setMode] = useState(event.payment_mode || 'free')
  const [discountType, setDiscountType] = useState(event.online_discount_type || '')
  const [discount, setDiscount] = useState(event.online_discount_value == null ? '' : String(event.online_discount_value))
  const [endsAt, setEndsAt] = useState(event.online_discount_ends_at ? utcIsoToLondonLocalInput(event.online_discount_ends_at) : '')
  const [questions, setQuestions] = useState<BookingQuestion[]>(event.booking_questions ?? [])
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const paid = mode !== 'free'
  const addQuestion = (label = '') => setQuestions(current => [...current, { id: crypto.randomUUID(), label, type: 'text', required: false }])
  const changeQuestion = (id: string, patch: Partial<BookingQuestion>) => setQuestions(current => current.map(question => question.id === id ? { ...question, ...patch } : question))
  const moveQuestion = (index: number, direction: -1 | 1) => setQuestions(current => {
    const next = [...current]
    ;[next[index], next[index + direction]] = [next[index + direction], next[index]]
    return next
  })
  const save = () => {
    setError(null)
    let deadline: string | null = null
    try {
      deadline = endsAt ? londonLocalInputToUtcIso(endsAt) : null
      if (endsAt && !deadline) throw new Error('Enter a valid discount deadline')
    } catch {
      setError('Enter a valid discount deadline in London time')
      return
    }
    startTransition(async () => {
      try {
        const result = await saveEventTicketSettings(event.id, {
          payment_mode: mode as 'free' | 'cash_only' | 'prepaid',
          online_discount_type: mode === 'prepaid' && discountType ? discountType as 'fixed' | 'percent' : null,
          online_discount_value: mode === 'prepaid' && discountType && discount.trim() ? Number(discount) : null,
          online_discount_ends_at: mode === 'prepaid' && discountType ? deadline : null,
          booking_questions: paid ? questions : [],
        })
        if (result.error) { setError(result.error); return }
        toast.success('Ticket settings saved')
        router.refresh()
      } catch { setError('Ticket settings could not be saved. Please try again.') }
    })
  }
  let expired = false
  try { expired = !!endsAt && Date.parse(londonLocalInputToUtcIso(endsAt) ?? '') <= Date.now() } catch { /* Invalid partial input is reported on save. */ }
  return (
    <Card>
      <CardHeader title="Payment and guest details" subtitle="Choose how guests pay and what each person needs to tell us." />
      <CardBody>
        <fieldset disabled={!canManage || pending} className="space-y-6">
          <Select label="Payment method" value={mode} onChange={event => setMode(event.target.value)} options={[
            { value: 'free', label: 'Free entry' }, { value: 'cash_only', label: 'Pay on arrival' }, { value: 'prepaid', label: 'Pay online' },
          ]} />
          {mode === 'prepaid' && (
            <div className="space-y-3 border-t border-border pt-5">
              <h3 className="font-semibold text-text-strong">Online discount</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <Select label="Discount" value={discountType} onChange={event => setDiscountType(event.target.value)} options={[
                  { value: '', label: 'No discount' }, { value: 'fixed', label: 'Amount off each ticket (£)' }, { value: 'percent', label: 'Percentage off each ticket (%)' },
                ]} />
                {discountType && <Input label={discountType === 'fixed' ? 'Amount off (£)' : 'Percentage off (%)'} type="number" min="0.01" step="0.01" value={discount} onChange={event => setDiscount(event.target.value)} />}
              </div>
              {discountType && <>
                <Input label="Discount ends (London time)" type="datetime-local" value={endsAt} onChange={event => setEndsAt(event.target.value)} />
                <p className="text-sm text-text-muted">Leave blank to keep the discount until bookings close. A guest who starts checkout before the deadline keeps that price until their payment hold expires.</p>
                {expired && <p className="text-sm text-warning" role="status">This deadline has passed. New bookings pay the full ticket price.</p>}
              </>}
            </div>
          )}
          {paid && <div className="space-y-4 border-t border-border pt-5">
            <div><h3 className="font-semibold text-text-strong">Questions for every guest</h3>
              <p className="mt-1 text-sm text-text-muted">Online-paid tickets collect a name for each person. Adding questions also collects individual names for pay-on-arrival bookings. Leave this empty to keep ordinary reservations simple. Saved bookings keep their original answers.</p></div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={() => addQuestion('Do you have any allergies or dietary requirements?')}>Add allergy question</Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => addQuestion('Do you have any accessibility needs we should be aware of?')}>Add accessibility question</Button>
            </div>
            {questions.length === 0 && <p className="rounded-default border border-border p-4 text-sm text-text-muted">No extra questions. {mode === 'prepaid' ? 'Guests will only need to give each ticket holder’s name.' : 'Pay-on-arrival reservations keep the usual quick booking form.'}</p>}
            {questions.map((question, index) => <div key={question.id} className="space-y-3 rounded-default border border-border p-4">
              <div className="flex items-center justify-between gap-2"><h4 className="text-sm font-semibold text-text-strong">Guest question {index + 1}</h4>
                <div className="flex gap-1">
                  <Button type="button" variant="ghost" size="sm" aria-label={`Move question ${index + 1} up`} disabled={index === 0} onClick={() => moveQuestion(index, -1)}>Up</Button>
                  <Button type="button" variant="ghost" size="sm" aria-label={`Move question ${index + 1} down`} disabled={index === questions.length - 1} onClick={() => moveQuestion(index, 1)}>Down</Button>
                  <Button type="button" variant="ghost" size="sm" aria-label={`Remove question ${index + 1}`} onClick={() => setQuestions(current => current.filter(item => item.id !== question.id))}>Remove</Button>
                </div>
              </div>
              <Input label={`Question ${index + 1}`} maxLength={240} value={question.label} onChange={event => changeQuestion(question.id, { label: event.target.value })} />
              <Select label={`Answer format for question ${index + 1}`} value={question.type} onChange={event => changeQuestion(question.id, { type: event.target.value as BookingQuestion['type'], options: event.target.value === 'choice' ? [''] : undefined })} options={[
                { value: 'text', label: 'Written answer' }, { value: 'yes_no', label: 'Yes or no' }, { value: 'choice', label: 'Choose one option' },
              ]} />
              {question.type === 'choice' && <Input label={`Options for question ${index + 1} (separate with commas)`} value={(question.options ?? []).join(',')} onChange={event => changeQuestion(question.id, { options: event.target.value.split(',') })} />}
              <Checkbox label="Answer required" checked={question.required} onChange={checked => changeQuestion(question.id, { required: checked })} />
            </div>)}
            <Button type="button" variant="secondary" disabled={questions.length >= 20} onClick={() => addQuestion()}>Add a question</Button>
          </div>}
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          {canManage && <Button type="button" onClick={save} disabled={pending}>{pending ? 'Saving ticket settings…' : 'Save ticket settings'}</Button>}
        </fieldset>
      </CardBody>
    </Card>
  )
}
