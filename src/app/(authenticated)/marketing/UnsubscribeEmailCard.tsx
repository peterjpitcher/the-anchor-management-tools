'use client'

import { useState, type FormEvent } from 'react'

import { unsubscribeMarketingEmailAddress } from '@/app/actions/marketing-contacts'
import { Button, Card, CardBody, CardHeader, Input, toast } from '@/ds'

export function UnsubscribeEmailCard() {
  const [email, setEmail] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = email.trim()
    if (!value) return

    setSaving(true)
    const result = await unsubscribeMarketingEmailAddress(value)
    setSaving(false)

    if (result.error) {
      toast.error(result.error)
      return
    }

    const matches =
      (result.data?.customerMatches ?? 0) + (result.data?.businessContactMatches ?? 0)

    toast.success(
      matches > 0
        ? `${value} is unsubscribed from marketing email.`
        : `${value} is blocked from future marketing email.`,
    )
    setEmail('')
  }

  return (
    <Card>
      <CardHeader
        title="Unsubscribe an email address"
        subtitle="Stops future marketing and prevents the address being added back by an import."
      />
      <CardBody>
        <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={handleSubmit}>
          <div className="min-w-0 flex-1">
            <Input
              type="email"
              label="Email address"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@example.com"
              autoComplete="off"
              required
              disabled={saving}
            />
          </div>
          <Button
            type="submit"
            variant="danger"
            loading={saving}
            disabled={!email.trim()}
          >
            Unsubscribe
          </Button>
        </form>
        <p className="mt-2 text-xs text-text-muted">
          Marketing only. Booking confirmations and reminders will still be sent.
        </p>
      </CardBody>
    </Card>
  )
}
