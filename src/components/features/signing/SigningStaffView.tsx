'use client'

import { Alert, Button, Card, CardBody, CardHeader, Checkbox, Input, LinkButton, Textarea } from '@/ds'
import { signingWords, useSigningFlow, type SigningViewModel } from './useSigningFlow'

/**
 * The signing screen in the staff look: worker agreements, policies, client agreements and
 * quotes. Sits inside StandaloneShell, which owns the page's <main>. The guest-brand twin is
 * SigningGuestView; both run on useSigningFlow.
 */
export function SigningStaffView({ model }: { model: SigningViewModel }): React.JSX.Element {
  const flow = useSigningFlow(model)
  const words = signingWords(model.mode)

  if (flow.phase === 'blocked') {
    return (
      <Alert tone="warning" title="There is nothing to sign here">
        {model.blockedMessage}
      </Alert>
    )
  }

  if (flow.phase === 'signed') {
    return (
      <Card>
        <CardHeader title={words.doneHeading} />
        <CardBody>
          <div className="space-y-3 text-sm text-text-muted">
            <p>{words.doneLead}</p>
            {flow.completed ? (
              <p>
                {model.otherSigners.some((signer) => !signer.signed)
                  ? 'We will email your copy once everyone else has signed.'
                  : 'Your copy, with its signing record, is on its way to you by email.'}
              </p>
            ) : (
              <p>You do not need to do anything else.</p>
            )}
            {model.inPerson ? <p>Please hand the device back.</p> : null}
          </div>
        </CardBody>
      </Card>
    )
  }

  if (flow.phase === 'declined') {
    return (
      <Card>
        <CardHeader title="Declined" />
        <CardBody>
          <p className="text-sm text-text-muted">
            We have recorded that you declined this document and let {model.senderName} know. Nothing has been signed.
          </p>
        </CardBody>
      </Card>
    )
  }

  if (flow.phase === 'identity') {
    return (
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault()
          void flow.submitIdentity()
        }}
      >
        <Card>
          <CardHeader title="First, confirm it is you" subtitle="We ask this before showing you the document" />
          <CardBody>
            <Input
              label="Your date of birth"
              type="date"
              autoComplete="bday"
              required
              value={flow.dateOfBirth}
              onChange={(event) => flow.setDateOfBirth(event.target.value)}
            />
          </CardBody>
        </Card>
        {flow.error ? <Alert tone="danger" role="alert">{flow.error}</Alert> : null}
        <Button type="submit" variant="primary" loading={flow.busy}>
          Continue
        </Button>
      </form>
    )
  }

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault()
        void flow.submitSignature()
      }}
    >
      <Card>
        <CardHeader title="1. Read the document" />
        <CardBody>
          <div className="space-y-4">
            {model.summary ? <p className="text-sm text-text-muted">{model.summary}</p> : null}
            <p className="text-sm text-text-muted">
              It opens in a new tab. Read all of it, then come back to this page.
            </p>
            <div onClick={flow.markDocumentOpened}>
              <LinkButton href={model.endpoints.document} target="_blank" rel="noopener" variant="secondary">
                Open the document
              </LinkButton>
            </div>
            {flow.documentOpened ? (
              <p className="text-sm text-text-muted" role="status">Opened. You can come back to it at any time.</p>
            ) : null}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={model.mode === 'acknowledge' ? '2. Confirm' : '2. Sign'} />
        <CardBody>
          <div className="space-y-4">
            <Input
              label="Type your full name"
              hint={words.tickHint}
              autoComplete="name"
              disabled={!flow.documentOpened}
              value={flow.typedName}
              onChange={(event) => flow.setTypedName(event.target.value)}
            />
            <Checkbox
              label={model.agreedText}
              checked={flow.agreed}
              disabled={!flow.documentOpened}
              onChange={flow.setAgreed}
              touchTarget
            />
            {!flow.documentOpened ? (
              <p className="text-sm text-text-muted">Open the document first to unlock this step.</p>
            ) : null}
          </div>
        </CardBody>
      </Card>

      {model.otherSigners.length > 0 ? (
        <p className="text-sm text-text-muted">
          Also signing:{' '}
          {model.otherSigners
            .map((signer) => `${signer.name} (${signer.roleLabel}${signer.signed ? ', signed' : ''})`)
            .join('; ')}
          .
        </p>
      ) : null}

      {flow.error ? <Alert tone="danger" role="alert">{flow.error}</Alert> : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" loading={flow.busy && !flow.declining} disabled={flow.declining}>
          {words.button}
        </Button>
        {!flow.declining ? (
          <Button type="button" variant="ghost" onClick={() => flow.setDeclining(true)}>
            I do not want to {model.mode === 'acknowledge' ? 'confirm' : 'sign'} this
          </Button>
        ) : null}
      </div>

      {flow.declining ? (
        <Card>
          <CardHeader title="Decline this document" />
          <CardBody>
            <div className="space-y-4">
              <Textarea
                label="Reason (optional)"
                hint={`We will pass this to ${model.senderName}.`}
                rows={3}
                maxLength={1000}
                value={flow.declineReason}
                onChange={(event) => flow.setDeclineReason(event.target.value)}
              />
              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" variant="danger" loading={flow.busy} onClick={() => void flow.submitDecline()}>
                  Decline
                </Button>
                <Button type="button" variant="ghost" onClick={() => flow.setDeclining(false)}>
                  Go back
                </Button>
              </div>
            </div>
          </CardBody>
        </Card>
      ) : null}

      <p className="text-xs text-text-muted">
        This link is personal to you and works until {model.expiresOn}. When you sign we record the date and time, your
        internet address, your browser and your approximate location, so there is a clear record of who signed.
      </p>
    </form>
  )
}
