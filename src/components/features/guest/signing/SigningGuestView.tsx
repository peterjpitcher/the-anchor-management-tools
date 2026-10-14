'use client'

import {
  GuestAlert,
  GuestButton,
  GuestCard,
  GuestCardHeader,
  GuestChoice,
  GuestField,
  GuestInput,
  GuestTextarea,
  guestFieldControlProps,
} from '@/components/features/guest'
import { alsoToSignLine, signingWords, useSigningFlow, type SigningViewModel } from '@/components/features/signing/useSigningFlow'
import { GUEST_MUTED_CLASS, GUEST_NOTE_CLASS } from '../styles'

const BODY_CLASS = GUEST_MUTED_CLASS

/**
 * The signing screen in The Anchor's guest look: booking contracts, waivers, supplier
 * confirmations and job offers. Sits inside GuestShell, which owns the page's <main>. The
 * staff-brand twin is SigningStaffView; both run on useSigningFlow.
 */
export function SigningGuestView({ model }: { model: SigningViewModel }): React.JSX.Element {
  const flow = useSigningFlow(model)
  const words = signingWords(model.mode)
  const alsoToSign = alsoToSignLine(model)

  if (flow.phase === 'blocked') {
    return (
      <GuestAlert tone="notice" title="There is nothing to sign here">
        {model.blockedMessage}
      </GuestAlert>
    )
  }

  if (flow.phase === 'signed') {
    return (
      <GuestAlert tone="success" title={words.doneHeading} role="status">
        {words.doneLead}{' '}
        {flow.completed
          ? model.otherSigners.some((signer) => !signer.signed)
            ? 'We will email your copy once everyone else has signed.'
            : 'Your copy, with its signing record, is on its way to you by email.'
          : 'You do not need to do anything else.'}
        {alsoToSign ? ` ${alsoToSign}` : ''}
        {model.inPerson ? ' Please hand the device back.' : ''}
      </GuestAlert>
    )
  }

  if (flow.phase === 'declined') {
    return (
      <GuestAlert tone="notice" title="Declined" role="status">
        We have recorded that you declined this document and let the team know. Nothing has been signed.
      </GuestAlert>
    )
  }

  if (flow.phase === 'identity') {
    return (
      <form
        className="flex flex-col gap-guest-lg"
        onSubmit={(event) => {
          event.preventDefault()
          void flow.submitIdentity()
        }}
      >
        <GuestCard variant="accent">
          <GuestField id="dateOfBirth" label="Your date of birth" hint="We ask this before showing you the document." required>
            <GuestInput
              {...guestFieldControlProps({ id: 'dateOfBirth', hint: 'We ask this before showing you the document.', required: true })}
              type="date"
              autoComplete="bday"
              value={flow.dateOfBirth}
              onChange={(event) => flow.setDateOfBirth(event.target.value)}
            />
          </GuestField>
        </GuestCard>
        {flow.error ? <GuestAlert tone="problem" role="alert">{flow.error}</GuestAlert> : null}
        <GuestButton as="button" type="submit" variant="primary" size="md" loading={flow.busy} loadingText="Checking…" fullWidth="mobile">
          Continue
        </GuestButton>
      </form>
    )
  }

  return (
    <form
      className="flex flex-col gap-guest-lg"
      onSubmit={(event) => {
        event.preventDefault()
        void flow.submitSignature()
      }}
    >
      <GuestCard>
        <div className="flex flex-col gap-3">
          <GuestCardHeader title="1. Read the document" />
          {model.summary ? <p className={BODY_CLASS}>{model.summary}</p> : null}
          <p className={BODY_CLASS}>It opens in a new tab. Read all of it, then come back to this page.</p>
          <div onClick={flow.onDocumentLinkClick} onAuxClick={flow.onDocumentLinkClick}>
            <GuestButton as="a" href={model.endpoints.document} external variant="outline" size="md" fullWidth="mobile">
              Open the document
            </GuestButton>
          </div>
          {/* Always in the page, so a screen reader announces the words when they arrive. */}
          <p className={BODY_CLASS} role="status">
            {flow.documentOpened ? 'Opened. You can come back to it at any time.' : ''}
          </p>
        </div>
      </GuestCard>

      <GuestCard variant="accent">
        <div className="flex flex-col gap-guest-lg">
          <GuestCardHeader title={model.mode === 'acknowledge' ? '2. Confirm' : '2. Sign'} />
          {!flow.documentOpened ? <p className={BODY_CLASS}>Open the document first to unlock this step.</p> : null}
          <GuestField id="typedName" label="Type your full name" hint={words.tickHint}>
            <GuestInput
              {...guestFieldControlProps({ id: 'typedName', hint: words.tickHint })}
              type="text"
              autoComplete="name"
              disabled={!flow.documentOpened}
              value={flow.typedName}
              onChange={(event) => flow.setTypedName(event.target.value)}
            />
          </GuestField>
          <GuestChoice
            type="checkbox"
            id="agreed"
            name="agreed"
            checked={flow.agreed}
            disabled={!flow.documentOpened}
            onChange={(event) => flow.setAgreed(event.target.checked)}
            label={model.agreedText}
          />
        </div>
      </GuestCard>

      {model.otherSigners.length > 0 ? (
        <p className={BODY_CLASS}>
          Also signing:{' '}
          {model.otherSigners
            .map((signer) => `${signer.name} (${signer.roleLabel}${signer.signed ? ', signed' : ''})`)
            .join('; ')}
          .
        </p>
      ) : null}

      {alsoToSign ? <GuestAlert tone="notice">{alsoToSign}</GuestAlert> : null}

      {flow.error ? <GuestAlert tone="problem" role="alert">{flow.error}</GuestAlert> : null}

      <GuestButton
        as="button"
        type="submit"
        variant="primary"
        size="md"
        loading={flow.busy && !flow.declining}
        loadingText={words.busy}
        disabled={flow.declining}
        fullWidth="mobile"
      >
        {words.button}
      </GuestButton>

      {!flow.declining ? (
        <GuestButton as="button" type="button" variant="link" onClick={() => flow.setDeclining(true)}>
          I do not want to {model.mode === 'acknowledge' ? 'confirm' : 'sign'} this
        </GuestButton>
      ) : (
        <GuestCard variant="danger">
          <div className="flex flex-col gap-3">
            <GuestCardHeader title="Decline this document" />
            <GuestField id="declineReason" label="Reason (optional)" hint="We will pass this to the team.">
              <GuestTextarea
                {...guestFieldControlProps({ id: 'declineReason', hint: 'We will pass this to the team.' })}
                rows={3}
                maxLength={1000}
                value={flow.declineReason}
                onChange={(event) => flow.setDeclineReason(event.target.value)}
              />
            </GuestField>
            <GuestButton as="button" type="button" variant="danger" size="md" loading={flow.busy} loadingText="Saving…" onClick={() => void flow.submitDecline()} fullWidth="mobile">
              Decline
            </GuestButton>
            <GuestButton as="button" type="button" variant="link" onClick={() => flow.setDeclining(false)}>
              Go back
            </GuestButton>
          </div>
        </GuestCard>
      )}

      <p className={GUEST_NOTE_CLASS}>
        {model.inPerson ? 'This signing screen works for 30 minutes.' : `This link is personal to you and works until ${model.expiresOn}.`} When you sign we record the date and time, your
        internet address, your browser and your approximate location, so there is a clear record of who signed.
      </p>
    </form>
  )
}
