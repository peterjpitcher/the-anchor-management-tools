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
        <CardHeader title={words.staffDoneHeading} />
        <CardBody>
          <div className="space-y-3 text-sm text-text-muted" role="status">
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
          <p className="text-sm text-text-muted" role="status">
            We have recorded that you declined this document and let the team know. Nothing has been signed.
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
          <CardHeader title="First, Confirm It Is You" subtitle="We ask this before showing you the document" />
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
        <CardHeader title="1. Read the Document" />
        <CardBody>
          <div className="space-y-4">
            {model.summary ? <p className="text-sm text-text-muted">{model.summary}</p> : null}
            <p className="text-sm text-text-muted">
              It opens in a new tab. Read all of it, then come back to this page.
            </p>
            <div onClick={flow.onDocumentLinkClick} onAuxClick={flow.onDocumentLinkClick}>
              <LinkButton href={model.endpoints.document} target="_blank" rel="noopener" variant="secondary">
                Open the Document
              </LinkButton>
            </div>
            {/* Always in the page, so a screen reader announces the words when they arrive. */}
            <p className="text-sm text-text-muted" role="status">
              {flow.documentOpened ? 'Opened. You can come back to it at any time.' : ''}
            </p>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={model.mode === 'acknowledge' ? '2. Confirm' : '2. Sign'} />
        <CardBody>
          <div className="space-y-4">
            {!flow.documentOpened ? (
              <p id="signing-locked-hint" className="text-sm text-text-muted">
                Open the document first to unlock this step.
              </p>
            ) : null}
            <Input
              label="Type your full name"
              hint={words.tickHint}
              autoComplete="name"
              aria-describedby={!flow.documentOpened ? 'signing-locked-hint' : undefined}
              disabled={!flow.documentOpened}
              value={flow.typedName}
              onChange={(event) => flow.setTypedName(event.target.value)}
            />
            <Checkbox
              label={model.agreedText}
              checked={flow.agreed}
              disabled={!flow.documentOpened}
              onChange={flow.setAgreed}
            />
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
          {words.staffButton}
        </Button>
        {!flow.declining ? (
          <Button type="button" variant="ghost" onClick={() => flow.setDeclining(true)}>
            I Do Not Want to {model.mode === 'acknowledge' ? 'Confirm' : 'Sign'} This
          </Button>
        ) : null}
      </div>

      {flow.declining ? (
        <Card>
          <CardHeader title="Decline This Document" />
          <CardBody>
            <div className="space-y-4">
              <Textarea
                label="Reason (optional)"
                hint="We will pass this to the team."
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
                  Go Back
                </Button>
              </div>
            </div>
          </CardBody>
        </Card>
      ) : null}

      <p className="text-xs text-text-muted">
        {model.isPortal
          ? `Please respond by ${model.expiresOn}.`
          : model.inPerson
            ? 'This signing screen works for 30 minutes.'
            : `This link is personal to you and works until ${model.expiresOn}.`}{' '}
        When you sign we record the date and time, your internet address, your browser and your approximate location,
        so there is a clear record of who signed.
      </p>
    </form>
  )
}
